import type { SavedMatchResult } from '../stores/matchResultsStore';
import { sortMatches, type ScheduledMatch } from '../stores/matchScheduleStore';
import type { SavedTeam } from '../stores/teamDbStore';

const norm = (s?: string) => (s ?? '').trim().toLowerCase();

/** Strips a "Category · " prefix some round strings carry (legacy data, category
 *  folded into the round field before it had its own column), leaving just the
 *  stage — e.g. "Men · Quarterfinal 2" -> "Quarterfinal 2". */
export function stageLabel(round?: string): string {
  if (!round) return '';
  const idx = round.indexOf(' · ');
  return idx >= 0 ? round.slice(idx + 3) : round;
}

/** A scoreboard only ever carries a team's NAME (teamAName/teamBName), never
 *  its id — resolving the actual SavedTeam record (for its roster, used by
 *  the Player H2H / Player Stats widgets) means matching by name, scoped by
 *  category so two same-named teams in different categories (e.g. a club
 *  fielding both a Boys and a Girls side) are never crossed. */
export function findTeamRecord(
  teams: SavedTeam[], name: string, category: string | undefined, tournamentId: string | undefined,
): SavedTeam | undefined {
  const candidates = teams.filter(t => norm(t.name) === norm(name) && (!tournamentId || t.tournamentId === tournamentId));
  if (candidates.length <= 1) return candidates[0];
  return candidates.find(t => norm(t.category) === norm(category)) ?? candidates[0];
}

function isThisTeam(
  team: { name: string; shortName?: string }, category: string | undefined, tournamentId: string | undefined,
  n?: string, s?: string, recCategory?: string, recRound?: string, recTournamentId?: string,
): boolean {
  const nameKey = norm(team.name);
  const shortKey = norm(team.shortName);
  if (!nameKey || !n) return false;
  const nameOk = norm(n) === nameKey || (!!shortKey && norm(s) === shortKey);
  if (!nameOk) return false;
  if (tournamentId && recTournamentId && recTournamentId !== tournamentId) return false;
  if (!category) return true;
  const effectiveCat = recCategory ?? (recRound?.includes(' · ') ? recRound.split(' · ')[0] : undefined);
  return !effectiveCat || effectiveCat === category;
}

/**
 * Finds the soonest not-yet-sent fixture within scope (same "next up"
 * convention MatchScheduleWidget uses: first item, in schedule order, whose
 * sentAt is unset) and resolves both sides' full SavedTeam records — id-based
 * first (teamAId/teamBId, present on fixtures created after this session's
 * id-threading work), falling back to name+category matching via
 * findTeamRecord for older fixtures that never got backfilled an id.
 */
export function resolveNextFixtureTeams(
  matches: ScheduledMatch[],
  teams: SavedTeam[],
  opts: { tournamentId?: string; venue?: string; category?: string },
): { match: ScheduledMatch; teamA?: SavedTeam; teamB?: SavedTeam } | undefined {
  const scoped = matches
    .filter(m =>
      (!opts.tournamentId || m.tournamentId === opts.tournamentId) &&
      (!opts.venue || norm(m.venue) === norm(opts.venue)) &&
      (!opts.category || norm(m.category) === norm(opts.category)),
    )
    .sort(sortMatches);
  const match = scoped.find(m => !m.sentAt);
  if (!match) return undefined;
  const teamA = (match.teamAId && teams.find(t => t.id === match.teamAId))
    || findTeamRecord(teams, match.teamAName, match.category ?? opts.category, opts.tournamentId);
  const teamB = (match.teamBId && teams.find(t => t.id === match.teamBId))
    || findTeamRecord(teams, match.teamBName, match.category ?? opts.category, opts.tournamentId);
  return { match, teamA, teamB };
}

export interface ResultFormRow {
  stage: string;
  a?: { r: SavedMatchResult; side: 'A' | 'B' };
  b?: { r: SavedMatchResult; side: 'A' | 'B' };
}
export interface UpcomingFormRow {
  stage: string;
  a?: { m: ScheduledMatch; side: 'A' | 'B' };
  b?: { m: ScheduledMatch; side: 'A' | 'B' };
}

/**
 * Merges both teams' own results into one row per stage/round — e.g. "Round
 * 1" shows what each team did that round, side by side (blank when a team
 * has no match recorded for that stage), rather than two independently
 * chronological lists.
 */
export function mergeResultRows(
  results: SavedMatchResult[],
  teamA: { name: string; shortName?: string },
  teamB: { name: string; shortName?: string },
  category: string | undefined,
  tournamentId: string | undefined,
): ResultFormRow[] {
  const rows = new Map<string, ResultFormRow>();
  for (const r of results) {
    const sideA = isThisTeam(teamA, category, tournamentId, r.teamAName, r.teamAShortName, r.category, r.round, r.tournamentId) ? 'A' as const
      : isThisTeam(teamA, category, tournamentId, r.teamBName, r.teamBShortName, r.category, r.round, r.tournamentId) ? 'B' as const : null;
    const sideB = isThisTeam(teamB, category, tournamentId, r.teamAName, r.teamAShortName, r.category, r.round, r.tournamentId) ? 'A' as const
      : isThisTeam(teamB, category, tournamentId, r.teamBName, r.teamBShortName, r.category, r.round, r.tournamentId) ? 'B' as const : null;
    if (!sideA && !sideB) continue;
    const stage = stageLabel(r.round) || '—';
    const key = stage.toLowerCase();
    if (!rows.has(key)) rows.set(key, { stage });
    const row = rows.get(key)!;
    if (sideA) row.a = { r, side: sideA };
    if (sideB) row.b = { r, side: sideB };
  }
  return Array.from(rows.values()).sort((x, y) => {
    const dx = x.a?.r.savedAt ?? x.b?.r.savedAt ?? 0;
    const dy = y.a?.r.savedAt ?? y.b?.r.savedAt ?? 0;
    return dy - dx; // newest first
  });
}

export type FormOutcome = 'W' | 'L' | 'D';

/** Which of Win/Loss/Draw a form row's own side resolved to, from that
 *  side's actual recorded score vs. its opponent's — shared by
 *  TeamFormWidget.tsx's own vMix push (so the pushed text/color/image agree)
 *  and lib/templateBinding.ts's CG template binding (so a bound element
 *  shows exactly the same outcome), same "moved here so it has one home
 *  shared by two consumers" reasoning templateBinding.ts's own
 *  resolveScorePart/SCORE_MERGE_PARTS already documents. */
export function formRowOutcome(row: ResultFormRow, side: 'a' | 'b'): FormOutcome | null {
  const entry = row[side];
  if (!entry) return null;
  const { r, side: s } = entry;
  const own = s === 'A' ? r.scoreA : r.scoreB;
  const opp = s === 'A' ? r.scoreB : r.scoreA;
  return own > opp ? 'W' : own < opp ? 'L' : 'D';
}

/** "{stage}: {outcome} {own}-{opp} v {opponent}" — the full text TeamForm
 *  pushes to vMix text fields and a 'Result Text' CG binding resolves to. */
export function formRowResultText(row: ResultFormRow, side: 'a' | 'b'): string | null {
  const entry = row[side];
  const outcome = formRowOutcome(row, side);
  if (!entry || !outcome) return null;
  const { r, side: s } = entry;
  const own = s === 'A' ? r.scoreA : r.scoreB;
  const opp = s === 'A' ? r.scoreB : r.scoreA;
  const oppName = s === 'A' ? (r.teamBShortName || r.teamBName) : (r.teamAShortName || r.teamAName);
  return `${row.stage}: ${outcome} ${own}-${opp} v ${oppName}`;
}

/** Per-outcome Win/Loss/Draw styling an operator configures once on the
 *  TeamForm widget (formWinText/formWinColor/formWinImage, etc. — each
 *  independently optional, see WidgetConfigPanel.tsx's 'team-form' case) —
 *  shared the same way formRowOutcome above is. */
export function formOutcomeText(config: Record<string, any>, outcome: FormOutcome): string {
  return outcome === 'W' ? (config.formWinText ?? 'W') : outcome === 'L' ? (config.formLossText ?? 'L') : (config.formDrawText ?? 'D');
}
export function formOutcomeColor(config: Record<string, any>, outcome: FormOutcome): string {
  return outcome === 'W' ? (config.formWinColor ?? '#2ecc71') : outcome === 'L' ? (config.formLossColor ?? '#e74c3c') : (config.formDrawColor ?? '#95a5a6');
}
export function formOutcomeImage(config: Record<string, any>, outcome: FormOutcome): string | undefined {
  return outcome === 'W' ? config.formWinImage : outcome === 'L' ? config.formLossImage : config.formDrawImage;
}

export function mergeUpcomingRows(
  matches: ScheduledMatch[],
  teamA: { name: string; shortName?: string },
  teamB: { name: string; shortName?: string },
  category: string | undefined,
  tournamentId: string | undefined,
): UpcomingFormRow[] {
  const rows = new Map<string, UpcomingFormRow>();
  for (const m of matches) {
    if (m.completedAt) continue;
    const sideA = isThisTeam(teamA, category, tournamentId, m.teamAName, m.teamAShortName, m.category, m.round, m.tournamentId) ? 'A' as const
      : isThisTeam(teamA, category, tournamentId, m.teamBName, m.teamBShortName, m.category, m.round, m.tournamentId) ? 'B' as const : null;
    const sideB = isThisTeam(teamB, category, tournamentId, m.teamAName, m.teamAShortName, m.category, m.round, m.tournamentId) ? 'A' as const
      : isThisTeam(teamB, category, tournamentId, m.teamBName, m.teamBShortName, m.category, m.round, m.tournamentId) ? 'B' as const : null;
    if (!sideA && !sideB) continue;
    const stage = stageLabel(m.round) || '—';
    const key = stage.toLowerCase();
    if (!rows.has(key)) rows.set(key, { stage });
    const row = rows.get(key)!;
    if (sideA) row.a = { m, side: sideA };
    if (sideB) row.b = { m, side: sideB };
  }
  return Array.from(rows.values()).sort((x, y) => {
    const dx = x.a?.m.date ?? x.b?.m.date ?? '';
    const dy = y.a?.m.date ?? y.b?.m.date ?? '';
    return dx.localeCompare(dy); // soonest first
  });
}
