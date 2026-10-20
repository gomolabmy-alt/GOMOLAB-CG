// 'bracket' element support — see types/canvas.ts's own doc comment on
// that kind for the full feature (a live-data-bound knockout bracket, one
// row template per match status, laid out in stage columns). Both
// renderers (CgTemplateWidget.tsx's real output, CgTemplateDesigner.tsx's
// live preview) call into this file so the two stay in lockstep — same
// relationship lib/matchScheduleRow.ts already has with those two. Reuses
// BracketWidget.tsx's own filter/stage-order logic (the vMix push side of
// that same widget), just as a hook instead of a one-shot computation.
import { useMemo } from 'react';
import { useMatchScheduleStore, type ScheduledMatch } from '../stores/matchScheduleStore';
import { useMatchResultsStore } from '../stores/matchResultsStore';
import { useTournamentStore } from '../stores/tournamentStore';
import { useLiveFixtureIds } from '../utils/scoreboardSnapshot';
import { extractKnockoutStage, knockoutStageSize, findMatchScore, findMatchWinner, isPlaceholderTeamName } from '../components/TournamentManager';
import type { BracketMatchRole } from '../types/canvas';
import type { MatchStatus, MatchScore } from './matchScheduleRow';

/** Live, filtered, stage-ordered knockout matches for one 'bracket' element
 *  — one hook call, shared by every element's own render. Called
 *  UNCONDITIONALLY for every element regardless of kind (same convention
 *  useMatchScheduleData/useStandingsData already follow) — `tournamentId`
 *  is simply `undefined` for every non-'bracket' element, which resolves to
 *  "no matches" and costs nothing extra downstream. */
export function useBracketData(tournamentId: string | undefined, category: string | undefined, tier: string | undefined) {
  const allMatches = useMatchScheduleStore((s) => s.matches);
  const results = useMatchResultsStore((s) => s.results);
  const liveFixtureIds = useLiveFixtureIds();

  const effectiveCategory = (m: ScheduledMatch): string | undefined =>
    m.category ?? (m.round?.includes(' · ') ? m.round.split(' · ')[0] : undefined);

  const categoryMatches = useMemo(() => !tournamentId ? [] : allMatches.filter((m) =>
    m.tournamentId === tournamentId &&
    (!category || effectiveCategory(m) === category) &&
    !!extractKnockoutStage(m)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [allMatches, tournamentId, category]);

  const tiers = useMemo(() => {
    const set = new Set(categoryMatches.map((m) => m.tier).filter((t): t is string => !!t && !t.includes('/')));
    return Array.from(set);
  }, [categoryMatches]);

  const matches = useMemo(() => tiers.length > 0
    ? categoryMatches.filter((m) => m.tier === tier || (!!m.tier?.includes('/') && m.tier.split('/').includes(tier ?? '')))
    : categoryMatches,
  [categoryMatches, tiers.length, tier]);

  const thirdPlaceMatch = useMemo(() => !tournamentId ? undefined : allMatches.find((m) =>
    m.tournamentId === tournamentId &&
    (!category || effectiveCategory(m) === category) &&
    (tiers.length === 0 || m.tier === tier) &&
    m.group === '3rd Place'
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [allMatches, tournamentId, category, tiers.length, tier]);

  // Grouped by stage, columns sorted biggest-first (Quarterfinal before
  // Semifinal before Final) — same convention BracketWidget's own
  // orderedMatches/BracketView already use, just kept as COLUMNS here
  // (rather than flattened) since this is what a bracket LAYOUT needs.
  const columns = useMemo((): { stage: string; matches: ScheduledMatch[] }[] => {
    const byStage = new Map<string, ScheduledMatch[]>();
    for (const m of matches) {
      const key = extractKnockoutStage(m)!;
      if (!byStage.has(key)) byStage.set(key, []);
      byStage.get(key)!.push(m);
    }
    return Array.from(byStage.entries())
      .sort((a, b) => knockoutStageSize(b[0]) - knockoutStageSize(a[0]))
      .map(([stage, ms]) => ({ stage, matches: ms }));
  }, [matches]);

  const getStatus = (match: ScheduledMatch): MatchStatus => {
    if (match.completedAt) return 'finished';
    if (liveFixtureIds.has(match.id)) return 'live';
    return 'scheduled';
  };
  const getScore = (match: ScheduledMatch, status: MatchStatus): MatchScore | null => {
    if (!tournamentId) return null;
    const score = findMatchScore(match, results, tournamentId);
    return score ? { scoreA: score.a, scoreB: score.b } : null;
  };
  const getWinnerSide = (match: ScheduledMatch): 'A' | 'B' | '' =>
    tournamentId ? (findMatchWinner(match, results, tournamentId)?.side ?? '') : '';

  return { matches, columns, thirdPlaceMatch, tiers, getStatus, getScore, getWinnerSide };
}

/** What a `bracketRole`-tagged TEXT element shows — see BracketMatchRole's
 *  own doc comment. Image roles (`teamALogo`/`teamBLogo`) are resolved
 *  directly in buildBracketRowOverrides below instead. A slot that hasn't
 *  resolved to a real team yet (still showing "Winner of Quarterfinal 1",
 *  "1st Group A", etc. — see isPlaceholderTeamName) or a genuine bye shows
 *  blank rather than the raw placeholder text, same rule
 *  BracketWidget.tsx's own resolveBracketPart already applies. */
export function resolveBracketRoleValue(role: BracketMatchRole, match: ScheduledMatch, status: MatchStatus, score: MatchScore | null, winnerSide: 'A' | 'B' | ''): string {
  const aReal = !!match.teamAName && !isPlaceholderTeamName(match.teamAName);
  const bReal = !!match.teamBName && !isPlaceholderTeamName(match.teamBName);
  switch (role) {
    case 'stage':         return match.tier ? `${match.tier} ${extractKnockoutStage(match)}` : (extractKnockoutStage(match) ?? '');
    case 'teamAName':     return aReal ? match.teamAName : '';
    case 'teamBName':     return bReal ? match.teamBName : '';
    case 'teamAShortName': return aReal ? (match.teamAShortName || match.teamAName) : '';
    case 'teamBShortName': return bReal ? (match.teamBShortName || match.teamBName) : '';
    case 'winner':        return winnerSide;
    case 'centerText':
      if (status === 'finished' && score) return `${score.scoreA} - ${score.scoreB}`;
      if (status === 'live' && score) return `${score.scoreA} - ${score.scoreB}`;
      return match.time ?? 'VS';
    default: return '';
  }
}

/** Builds the EFFECTIVE config one 'bracket' match box's own template
 *  should render with — mirrors lib/matchScheduleRow.ts's
 *  buildMatchRowOverrides exactly, just patching in BracketMatchRole values
 *  (plus the resolved score/winner, since those aren't on ScheduledMatch
 *  itself) instead of MatchScheduleRole ones. */
export function buildBracketRowOverrides(
  templateConfig: Record<string, any>,
  match: ScheduledMatch,
  status: MatchStatus,
  score: MatchScore | null,
  winnerSide: 'A' | 'B' | '',
): Record<string, any> {
  const elements: any[] = templateConfig.elements ?? [];
  let changed = false;
  const nextElements = elements.map((el) => {
    const role: BracketMatchRole | undefined = el.bracketRole;
    if (!role) return el;
    if (role === 'teamALogo' || role === 'teamBLogo') {
      if (el.kind !== 'image') return el;
      const url = role === 'teamALogo' ? match.teamALogo : match.teamBLogo;
      if (!url) return el;
      changed = true;
      return { ...el, config: { ...el.config, imageUrl: url } };
    }
    if (el.kind !== 'text') return el;
    changed = true;
    return { ...el, config: { ...el.config, text: resolveBracketRoleValue(role, match, status, score, winnerSide) } };
  });
  if (!changed) return templateConfig;
  return { ...templateConfig, elements: nextElements };
}

/** Which match-box template to use for `match`, given this 'bracket'
 *  element's own config — mirrors lib/matchScheduleRow.ts's
 *  resolveRowTemplateId exactly (per-match override wins, else one of the
 *  three per-status templates, falling back to the plain `rowTemplateId`). */
export function resolveBracketRowTemplateId(config: Record<string, any>, match: ScheduledMatch, status: MatchStatus): string | undefined {
  const override = config.rowOverrides?.[match.id]?.templateId;
  if (override) return override;
  if (status === 'live') return config.liveRowTemplateId ?? config.rowTemplateId;
  if (status === 'finished') return config.finishedRowTemplateId ?? config.rowTemplateId;
  return config.rowTemplateId;
}
