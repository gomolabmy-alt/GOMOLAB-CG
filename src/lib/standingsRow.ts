// 'standings' element support — see types/canvas.ts's own doc comment on
// that kind for the full feature (a live-data-bound standings table, one
// row template per rank zone). Both renderers (CgTemplateWidget.tsx's real
// output, CgTemplateDesigner.tsx's live preview) call into this file so the
// two stay in lockstep — same relationship lib/matchScheduleRow.ts already
// has with those two.
import { useMemo } from 'react';
import { useTeamDbStore, type SavedTeam } from '../stores/teamDbStore';
import { useMatchResultsStore } from '../stores/matchResultsStore';
import { useTournamentStore } from '../stores/tournamentStore';
import { computeStandings, isPoolStageResult, type StandingRow } from '../components/TournamentManager';
import type { StandingsRole } from '../types/canvas';

export interface StandingsRankRow extends StandingRow {
  /** 1-based — this row's actual rank in the table, independent of
   *  pagination (row 13 on page 2 of a 12-per-page table is still rank 13). */
  rank: number;
}

/** Live standings rows (filtered + ranked) for one 'standings' element —
 *  one hook call, shared by every element's own render (see
 *  CgTemplateWidget.tsx's/CgTemplateDesigner.tsx's identical call). Called
 *  UNCONDITIONALLY for every element regardless of kind (same "always call,
 *  only use the result when it's actually this kind" convention
 *  useMatchScheduleData's own doc comment describes) — `tournamentId` is
 *  simply `undefined` for every non-'standings' element, which resolves to
 *  "no teams, empty table" and costs nothing extra since nothing downstream
 *  reads the result in that case. */
export function useStandingsData(tournamentId: string | undefined, group: string | undefined, category: string | undefined): { rows: StandingsRankRow[] } {
  const { teams: allTeams } = useTeamDbStore();
  const { results: allResults } = useMatchResultsStore();
  const { tournaments } = useTournamentStore();
  const tournament = tournaments.find((t) => t.id === tournamentId);

  const rows = useMemo((): StandingsRankRow[] => {
    if (!tournament) return [];
    const teams: SavedTeam[] = allTeams.filter((t) =>
      t.tournamentId === tournament.id &&
      (!category || t.category === category) &&
      (!group || t.group === group)
    );
    if (teams.length === 0) return [];
    // Group standings must only count pool-stage results — same rule
    // StandingsWidget/GroupStandingsWidget already apply via isPoolStageResult.
    const results = allResults.filter((r) => r.tournamentId === tournament.id && isPoolStageResult(r));
    return computeStandings(teams, results, tournament.settings ?? { pointsWin: 3, pointsDraw: 1, pointsLoss: 0 } as any)
      .map((r, i) => ({ ...r, rank: i + 1 }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTeams, allResults, tournament?.id, tournament?.settings, group, category]);

  return { rows };
}

/** How many `rowsPerPage`-sized pages this many rows need — always at least
 *  1, mirrors matchSchedulePageCount exactly. */
export function standingsPageCount(rowCount: number, rowsPerPage: number): number {
  return Math.max(1, Math.ceil(rowCount / Math.max(1, rowsPerPage)));
}

/** The slice of `rows` visible on `pageIndex` — wraps (same convention as
 *  paginateMatches) rather than clamping. */
export function paginateStandings(rows: StandingsRankRow[], rowsPerPage: number, pageIndex: number): StandingsRankRow[] {
  const perPage = Math.max(1, rowsPerPage);
  const pageCount = standingsPageCount(rows.length, perPage);
  const page = ((pageIndex % pageCount) + pageCount) % pageCount;
  return rows.slice(page * perPage, page * perPage + perPage);
}

/** What a `standingsRole`-tagged TEXT element shows — see StandingsRole's
 *  own doc comment. Image roles (`teamLogo`) are resolved directly in
 *  buildStandingsRowOverrides below instead. */
export function resolveStandingsRoleValue(role: StandingsRole, row: StandingsRankRow): string {
  const diff = row.pf - row.pa;
  switch (role) {
    case 'rank':       return String(row.rank);
    case 'teamName':   return row.name;
    case 'shortName':  return row.shortName || row.name;
    case 'played':     return String(row.played);
    case 'won':        return String(row.won);
    case 'drawn':      return String(row.drawn);
    case 'lost':       return String(row.lost);
    case 'pointsFor':  return String(row.pf);
    case 'pointsAgainst': return String(row.pa);
    case 'diff':       return `${diff > 0 ? '+' : ''}${diff}`;
    case 'pts':        return String(row.pts);
    default: return '';
  }
}

/** Builds the EFFECTIVE config one 'standings' row's own template should
 *  render with — mirrors lib/matchScheduleRow.ts's buildMatchRowOverrides
 *  exactly, just patching in StandingsRole values instead of
 *  MatchScheduleRole ones. */
export function buildStandingsRowOverrides(templateConfig: Record<string, any>, row: StandingsRankRow): Record<string, any> {
  const elements: any[] = templateConfig.elements ?? [];
  let changed = false;
  const nextElements = elements.map((el) => {
    const role: StandingsRole | undefined = el.standingsRole;
    if (!role) return el;
    if (role === 'teamLogo') {
      if (el.kind !== 'image') return el;
      if (!row.logo) return el;
      changed = true;
      return { ...el, config: { ...el.config, imageUrl: row.logo } };
    }
    if (el.kind !== 'text') return el;
    changed = true;
    return { ...el, config: { ...el.config, text: resolveStandingsRoleValue(role, row) } };
  });
  if (!changed) return templateConfig;
  return { ...templateConfig, elements: nextElements };
}

/** Which row template to use for `row`, given this 'standings' element's
 *  own config — a per-team `rowOverrides` entry wins regardless of rank
 *  zone (a sponsor-branded slot, a rivalry team), otherwise the top-zone
 *  template while `row.rank <= topCount`, the bottom-zone template while
 *  within `bottomCount` of the end, else the plain default — see
 *  TemplateElement's own 'standings' doc comment. */
export function resolveStandingsRowTemplateId(config: Record<string, any>, row: StandingsRankRow, totalRows: number): string | undefined {
  const override = config.rowOverrides?.[row.teamId]?.templateId;
  if (override) return override;
  const topCount = config.topCount ?? 0;
  const bottomCount = config.bottomCount ?? 0;
  if (topCount > 0 && row.rank <= topCount) return config.topRowTemplateId ?? config.rowTemplateId;
  if (bottomCount > 0 && row.rank > totalRows - bottomCount) return config.bottomRowTemplateId ?? config.rowTemplateId;
  return config.rowTemplateId;
}
