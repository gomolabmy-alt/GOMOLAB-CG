// 'matchSchedule' element support — see types/canvas.ts's own doc comment
// on that kind for the full feature (paginated, live-data-bound fixture
// list, one row template per match status). Both renderers
// (CgTemplateWidget.tsx's real output, CgTemplateDesigner.tsx's live
// preview) call into this file so the two stay in lockstep, the same
// relationship they already have with lib/cgEffects.ts.
import { useMemo } from 'react';
import { useMatchScheduleStore, sortMatches, type ScheduledMatch } from '../stores/matchScheduleStore';
import { useMatchResultsStore } from '../stores/matchResultsStore';
import { useLiveScoreboardConfigs } from '../utils/scoreboardSnapshot';
import type { MatchScheduleRole } from '../types/canvas';

export type MatchStatus = 'scheduled' | 'live' | 'finished';

export interface MatchScore {
  scoreA: number;
  scoreB: number;
}

/** Live fixture list (filtered + sorted) plus per-match status/score
 *  lookups — one hook call, shared by every 'matchSchedule' element's own
 *  render (see CgTemplateWidget.tsx's/CgTemplateDesigner.tsx's identical
 *  call). Called UNCONDITIONALLY for every element regardless of kind
 *  (same "always call, only use the result when it's actually this kind"
 *  convention every other per-kind hook in this app already follows —
 *  React's Rules of Hooks forbid calling it only for matchSchedule
 *  elements inside a shared per-element render function) — `tournamentId`/
 *  `group` are simply `undefined` for every non-matchSchedule element,
 *  which resolves to "every match, unfiltered" and costs nothing extra
 *  since nothing downstream reads the result in that case. */
export function useMatchScheduleData(tournamentId: string | undefined, group: string | undefined) {
  const allMatches = useMatchScheduleStore((s) => s.matches);
  const results = useMatchResultsStore((s) => s.results);
  const liveConfigs = useLiveScoreboardConfigs();

  const matches = useMemo(() => {
    return allMatches
      .filter((m) => (!tournamentId || m.tournamentId === tournamentId) && (!group || m.group === group))
      .slice()
      .sort(sortMatches);
  }, [allMatches, tournamentId, group]);

  const getStatus = (match: ScheduledMatch): MatchStatus => {
    if (match.completedAt) return 'finished';
    if (liveConfigs.has(match.id)) return 'live';
    return 'scheduled';
  };

  const getScore = (match: ScheduledMatch, status: MatchStatus): MatchScore | null => {
    if (status === 'finished') {
      // Bye/walkover fixtures never get a real scoreboard/result row —
      // their own user-set scoreline lives directly on the fixture.
      if (match.matchType === 'bye' || match.matchType === 'walkover') {
        return match.scoreA != null && match.scoreB != null ? { scoreA: match.scoreA, scoreB: match.scoreB } : null;
      }
      const result = results.find((r) => r.sourceScheduleId === match.id);
      return result ? { scoreA: result.scoreA, scoreB: result.scoreB } : null;
    }
    if (status === 'live') {
      const cfg = liveConfigs.get(match.id);
      if (!cfg) return null;
      return { scoreA: Number(cfg.scoreA) || 0, scoreB: Number(cfg.scoreB) || 0 };
    }
    return null;
  };

  return { matches, getStatus, getScore };
}

/** How many pages `rowsPerPage`-sized pages this many matches need — always
 *  at least 1, even with zero matches (an empty page still "exists" so a
 *  freshly-added element with no fixtures yet doesn't divide-by-zero or
 *  show a blank state some other way). */
export function matchSchedulePageCount(matchCount: number, rowsPerPage: number): number {
  return Math.max(1, Math.ceil(matchCount / Math.max(1, rowsPerPage)));
}

/** The slice of `matches` visible on `pageIndex` — wraps (same modulo
 *  convention every other paged/looping element in this app already uses)
 *  rather than clamping, so an out-of-range page (e.g. the match list
 *  shrank after the last save) never just goes blank. */
export function paginateMatches(matches: ScheduledMatch[], rowsPerPage: number, pageIndex: number): ScheduledMatch[] {
  const perPage = Math.max(1, rowsPerPage);
  const pageCount = matchSchedulePageCount(matches.length, perPage);
  const page = ((pageIndex % pageCount) + pageCount) % pageCount;
  return matches.slice(page * perPage, page * perPage + perPage);
}

/** What a `matchRole`-tagged TEXT element shows — see MatchScheduleRole's
 *  own doc comment for `centerText`'s special status-dependent behavior.
 *  Image roles (`teamALogo`/`teamBLogo`) are resolved directly in
 *  buildMatchRowOverrides below instead (an image element has no text
 *  value for this to return). */
export function resolveMatchRoleValue(role: MatchScheduleRole, match: ScheduledMatch, status: MatchStatus, score: MatchScore | null): string {
  switch (role) {
    case 'teamAName': return match.teamAName;
    case 'teamBName': return match.teamBName;
    case 'teamAShortName': return match.teamAShortName || match.teamAName;
    case 'teamBShortName': return match.teamBShortName || match.teamBName;
    case 'group': return match.group ?? '';
    case 'round': return match.round ?? '';
    case 'venue': return match.venue ?? '';
    case 'date': return match.date;
    case 'centerText':
      if (status !== 'scheduled' && score) return `${score.scoreA} - ${score.scoreB}`;
      return match.time ?? 'VS';
    default: return '';
  }
}

/** Builds the EFFECTIVE config one 'matchSchedule' row's own template
 *  should render with — that template's own config, with every
 *  `matchRole`-tagged element's value patched in for THIS specific match —
 *  mirrors lib/cardCarousel.ts's own applyCardOverrides exactly (same
 *  "return the same object reference untouched when nothing needs
 *  patching" shortcut), just computed live from match data instead of
 *  reading an operator-authored per-card overrides map. */
export function buildMatchRowOverrides(
  templateConfig: Record<string, any>,
  match: ScheduledMatch,
  status: MatchStatus,
  score: MatchScore | null,
): Record<string, any> {
  const elements: any[] = templateConfig.elements ?? [];
  let changed = false;
  const nextElements = elements.map((el) => {
    const role: MatchScheduleRole | undefined = el.matchRole;
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
    return { ...el, config: { ...el.config, text: resolveMatchRoleValue(role, match, status, score) } };
  });
  if (!changed) return templateConfig;
  return { ...templateConfig, elements: nextElements };
}

/** Which row template to use for `match`, given this 'matchSchedule'
 *  element's own config — a per-match `rowOverrides` entry wins regardless
 *  of status (a bespoke design for one specific fixture), otherwise
 *  whichever of the three per-status templates applies, falling back to
 *  the plain `rowTemplateId` when a status-specific one was never set (see
 *  TemplateElement's own 'matchSchedule' doc comment). */
export function resolveRowTemplateId(config: Record<string, any>, match: ScheduledMatch, status: MatchStatus): string | undefined {
  const override = config.rowOverrides?.[match.id]?.templateId;
  if (override) return override;
  if (status === 'live') return config.liveRowTemplateId ?? config.rowTemplateId;
  if (status === 'finished') return config.finishedRowTemplateId ?? config.rowTemplateId;
  return config.rowTemplateId;
}
