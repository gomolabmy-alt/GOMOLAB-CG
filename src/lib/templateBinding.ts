import type { CanvasPage, CanvasWidget, StatBarRow, TemplateElementBinding, WidgetType } from '../types/canvas';
import type { MergePart } from '../components/MergeFieldComposer';
import { extractKnockoutStage, resolveGroupSlots } from '../components/TournamentManager';
import { formatTime } from '../stores/canvasStore';
import { computeTimerAccumulatedMs } from './timerCompute';
import { computeCountdownState } from './countdownCompute';
import { useMatchScheduleStore } from '../stores/matchScheduleStore';
import { useRundownStore } from '../stores/rundownStore';
import { useAppSettings } from '../stores/appSettingsStore';
import { useTeamDbStore } from '../stores/teamDbStore';
import { useTournamentStore } from '../stores/tournamentStore';
import { useMatchResultsStore } from '../stores/matchResultsStore';
import { mergeResultRows, formRowOutcome, formRowResultText, formOutcomeImage } from './teamForm';
import { initRallyMatch, initTennisMatch, rallyGamesWon, tennisPointLabel, isTennisDeuce, formatGameResult, formatDuration, normalizePlayerEntry, formatPlayerEntry, type RallyMatchState, type TennisMatchState } from './racketScoring';

export type { MergePart };

// ── Scoreboard's merge-part catalog + resolver ──────────────────────────────
// Moved here (from ScoreboardWidget.tsx / WidgetConfigPanel.tsx) so it has
// one home shared by two consumers: vMix merge-field pushes (unchanged
// behavior, just re-imported) and CG template bindings (new). Neither was
// exported before this move — this is a real relocation, not a re-export of
// something that already lived at module scope elsewhere.
export type ScoreMergePart =
  | 'shortA' | 'textA' | 'teamA' | 'scoreA' | 'logoA'
  | 'shortB' | 'textB' | 'teamB' | 'scoreB' | 'logoB'
  | 'competition' | 'category' | 'group' | 'round' | 'scheduledTime' | 'matchId';

export const SCORE_MERGE_PARTS_A: MergePart[] = [
  { key: 'shortA', label: 'Short Name A', sample: 'CHE' },
  { key: 'textA',  label: 'Text A',       sample: 'Custom text' },
  { key: 'teamA',  label: 'Team A Name',  sample: 'Chelsea' },
  { key: 'scoreA', label: 'Score A',      sample: '3' },
  { key: 'logoA',  label: 'Logo A',       sample: '(image)' },
];
export const SCORE_MERGE_PARTS_B: MergePart[] = [
  { key: 'shortB', label: 'Short Name B', sample: 'ARS' },
  { key: 'textB',  label: 'Text B',       sample: 'Custom text' },
  { key: 'teamB',  label: 'Team B Name',  sample: 'Arsenal' },
  { key: 'scoreB', label: 'Score B',      sample: '1' },
  { key: 'logoB',  label: 'Logo B',       sample: '(image)' },
];
export const SCORE_MERGE_PARTS_INFO: MergePart[] = [
  { key: 'competition',   label: 'Competition',    sample: 'Premier League' },
  { key: 'category',      label: 'Category',       sample: 'Men' },
  { key: 'group',         label: 'Group',          sample: 'Group A' },
  { key: 'round',         label: 'Round',          sample: 'Round 3' },
  { key: 'scheduledTime', label: 'Scheduled Time', sample: '19:00' },
  { key: 'matchId',       label: 'Match ID',       sample: 'MB1' },
];

export function resolveScorePart(config: Record<string, any>, part: ScoreMergePart, matchId?: string): string {
  switch (part) {
    case 'shortA': return config.teamAShortName ?? '';
    case 'textA': return config.teamATextField ?? '';
    case 'teamA': return config.teamAName ?? '';
    case 'scoreA': return String(config.scoreA ?? 0);
    case 'logoA': return config.teamALogo ?? '';
    case 'shortB': return config.teamBShortName ?? '';
    case 'textB': return config.teamBTextField ?? '';
    case 'teamB': return config.teamBName ?? '';
    case 'scoreB': return String(config.scoreB ?? 0);
    case 'logoB': return config.teamBLogo ?? '';
    case 'competition': return config.competition ?? '';
    case 'category': return config.category ?? '';
    // A group name is meaningless once the fixture is a knockout match —
    // falls back to the stage/round text instead, same swap as the Group
    // Field push and on-widget badge (unchanged from the original).
    case 'group': return extractKnockoutStage({ group: config.group, round: config.subtitle }) ? (config.subtitle ?? '') : (config.group ?? '');
    case 'round': return config.subtitle ?? '';
    case 'scheduledTime': return config.scheduledTime ?? '';
    case 'matchId': return matchId ?? '';
    default: return '';
  }
}

// ── Generic binding registry ─────────────────────────────────────────────
// A widget type opts into a curated catalog/resolver pair here; anything
// without an entry still works as a binding source via the generic
// fallback below (getBindableParts/resolveBindingValue), which exposes its
// raw config fields directly — this is what makes "bind to any widget" true
// for the full widget catalog without every widget needing its own entry.
export interface BindableSource {
  getParts: (config: Record<string, any>) => MergePart[];
  /** `pages` — every other widget, for the rare source (a "linked timer"
   *  display widget) whose own live value actually lives on a DIFFERENT
   *  widget it points at by id; every other resolver ignores it and reads
   *  `config` alone, same as before this parameter existed. */
  resolve: (config: Record<string, any>, key: string, pages: CanvasPage[]) => string;
}

const TIMER_PARTS: MergePart[] = [{ key: 'time', label: 'Time', sample: '00:00' }];

/** A "linked timer" display widget (config.linkedTimerSourceId set) mirrors
 *  another Timer widget's state instead of running its own — same
 *  precedence TimerWidget.tsx's own render already uses, so a CG element
 *  bound to either one shows the exact same text the widget itself does. */
function effectiveTimerConfig(config: Record<string, any>, pages: CanvasPage[]): Record<string, any> {
  if (!config.linkedTimerSourceId) return config;
  const source = pages.flatMap((p) => p.widgets).find((w) => w.id === config.linkedTimerSourceId && w.type === 'timer');
  return source?.config ?? config;
}

// "#7 Kevin Sanjaya (Player) / #22 Marcus Gideon (Player)" — every filled
// starter slot on a RacketScoreboardWidget.tsx side (jersey/position
// included when set), joined; an unfilled slot formats as '' via
// formatPlayerEntry and gets dropped by the Boolean filter, so it never
// shows up as a stray "" between slashes.
const startersSummary = (raw: unknown): string =>
  (Array.isArray(raw) ? raw : []).map(normalizePlayerEntry).map(formatPlayerEntry).filter(Boolean).join(' / ');

const BINDABLE_SOURCES: Partial<Record<WidgetType, BindableSource>> = {
  scoreboard: {
    getParts: () => [...SCORE_MERGE_PARTS_A, ...SCORE_MERGE_PARTS_B, ...SCORE_MERGE_PARTS_INFO],
    resolve: (config, key) => resolveScorePart(config, key as ScoreMergePart),
  },
  timer: {
    getParts: () => TIMER_PARTS,
    // Same format precedence as TimerWidget.tsx's own on-screen render:
    // this widget's own `format`/showMs/etc. win, falling back to the
    // linked source's — see timerCompute.ts's shared accumulatedMs.
    resolve: (config, _key, pages) => {
      const dc = effectiveTimerConfig(config, pages);
      const fmt = config.format ?? dc.format ?? 'mm:ss';
      const opts = { showMs: config.showMs ?? dc.showMs, noLeadingZero: config.noLeadingZero ?? dc.noLeadingZero, subMinuteMs: config.subMinuteMs ?? dc.subMinuteMs };
      return formatTime(computeTimerAccumulatedMs(dc), fmt, opts);
    },
  },
  // RacketScoreboardWidget.tsx (badminton/table tennis/tennis/sepaktakraw)
  // — own entry rather than reusing SCORE_MERGE_PARTS_*/resolveScorePart:
  // those read a plain `config.scoreA`/`scoreB` number, but this widget
  // never stores one (see its own doc comment) — the live points/games-won
  // are always DERIVED from config.rallyState/tennisState at read time, the
  // same way the widget's own render does, so a bound CG element and the
  // widget's own on-screen numbers can never drift out of sync.
  'racket-scoreboard': {
    getParts: (config) => [
      { key: 'teamA', label: 'Team A Name', sample: config.teamAName || 'Team A' },
      { key: 'teamB', label: 'Team B Name', sample: config.teamBName || 'Team B' },
      { key: 'shortA', label: 'Short Name A', sample: config.teamAShortName || 'A' },
      { key: 'shortB', label: 'Short Name B', sample: config.teamBShortName || 'B' },
      { key: 'startersA', label: 'Starters A', sample: startersSummary(config.startersA) || '#7 Kevin Sanjaya (Player) / #22 Marcus Gideon (Player)' },
      { key: 'startersB', label: 'Starters B', sample: startersSummary(config.startersB) || '#1 Mohammad Ahsan (Player) / #11 Hendra Setiawan (Player)' },
      { key: 'subsA', label: 'Subs A', sample: (config.subsA ?? []).join(', ') || '(none)' },
      { key: 'subsB', label: 'Subs B', sample: (config.subsB ?? []).join(', ') || '(none)' },
      { key: 'logoA', label: 'Logo A', sample: '(image)' },
      { key: 'logoB', label: 'Logo B', sample: '(image)' },
      { key: 'pointsA', label: 'Team A Points', sample: '15' },
      { key: 'pointsB', label: 'Team B Points', sample: '11' },
      { key: 'gamesWonA', label: 'Team A Games/Sets Won', sample: '1' },
      { key: 'gamesWonB', label: 'Team B Games/Sets Won', sample: '0' },
      { key: 'server', label: 'Server (A or B)', sample: 'A' },
      { key: 'serverName', label: 'Server Name', sample: config.teamAName || 'Team A' },
      { key: 'deuce', label: 'Deuce Label (tennis)', sample: 'DEUCE' },
      // Every completed game/set's own final score, oldest first (e.g.
      // "21-15, 18-21, 21-19") — see resolve() below's own comment on why
      // this is built fresh from rallyState/tennisState rather than stored.
      { key: 'gameResults', label: 'Game/Set Results', sample: '21-15, 18-21, 21-19' },
      // Team Event (Regu) — sepaktakraw only, see RacketScoreboardWidget.tsx's
      // own doc comment on config.teamEventOn. Present (non-empty) only when
      // that mode is actually on, same as deuce is tennis-only above.
      { key: 'reguNumber', label: 'Current Regu # (Team Event)', sample: '2' },
      { key: 'regusWonA', label: 'Regu Wins A (Team Event)', sample: '1' },
      { key: 'regusWonB', label: 'Regu Wins B (Team Event)', sample: '0' },
      // Game Timer — see RacketScoreboardWidget.tsx's own startGameTimer/
      // formatDuration doc comments. Empty whenever no timer's running for
      // the CURRENT game (never started, or already stopped waiting on
      // Start Next Game/Confirm) — same "blank when not applicable"
      // convention deuce/reguNumber above already use.
      { key: 'gameTime', label: 'Current Game Timer', sample: '8:32' },
      { key: 'competition', label: 'Competition', sample: 'Open Championship' },
      { key: 'category', label: 'Category', sample: 'Men' },
      { key: 'round', label: 'Round', sample: 'Final' },
    ],
    resolve: (config, key) => {
      const scoringMode: 'rally' | 'tennis' = config.scoringMode ?? 'rally';
      const rallyState: RallyMatchState = config.rallyState ?? initRallyMatch();
      const tennisState: TennisMatchState = config.tennisState ?? initTennisMatch();
      const server = scoringMode === 'tennis' ? tennisState.server : rallyState.server;
      switch (key) {
        case 'teamA': return config.teamAName ?? '';
        case 'teamB': return config.teamBName ?? '';
        case 'shortA': return config.teamAShortName ?? '';
        case 'shortB': return config.teamBShortName ?? '';
        case 'startersA': return startersSummary(config.startersA);
        case 'startersB': return startersSummary(config.startersB);
        case 'subsA': return (config.subsA ?? []).join(', ');
        case 'subsB': return (config.subsB ?? []).join(', ');
        case 'logoA': return config.teamALogo ?? '';
        case 'logoB': return config.teamBLogo ?? '';
        case 'pointsA': return scoringMode === 'tennis'
          ? (tennisState.inTiebreak ? String(tennisState.tiebreakA) : tennisPointLabel(tennisState.pointsA, tennisState.pointsB).a)
          : String(rallyState.pointsA);
        case 'pointsB': return scoringMode === 'tennis'
          ? (tennisState.inTiebreak ? String(tennisState.tiebreakB) : tennisPointLabel(tennisState.pointsA, tennisState.pointsB).b)
          : String(rallyState.pointsB);
        case 'gamesWonA': return String(scoringMode === 'tennis' ? tennisState.setsA : rallyGamesWon(rallyState, 'A'));
        case 'gamesWonB': return String(scoringMode === 'tennis' ? tennisState.setsB : rallyGamesWon(rallyState, 'B'));
        case 'server': return server;
        case 'serverName': return (server === 'A' ? config.teamAName : config.teamBName) ?? '';
        case 'deuce': return scoringMode === 'tennis' && !tennisState.inTiebreak && isTennisDeuce(tennisState.pointsA, tennisState.pointsB) ? 'DEUCE' : '';
        case 'gameResults': return (scoringMode === 'tennis' ? tennisState.sets : rallyState.games).map(formatGameResult).join(', ');
        case 'reguNumber': return config.teamEventOn ? String((config.reguHistory ?? []).length + 1) : '';
        case 'regusWonA': return config.teamEventOn ? String(config.regusWonA ?? 0) : '';
        case 'regusWonB': return config.teamEventOn ? String(config.regusWonB ?? 0) : '';
        case 'gameTime': return config.gameStartedAt ? formatDuration((config.gameEndedAt ?? Date.now()) - config.gameStartedAt) : '';
        case 'competition': return config.competition ?? '';
        case 'category': return config.category ?? '';
        case 'round': return config.subtitle ?? '';
        default: return '';
      }
    },
  },
  pomodoro: {
    getParts: () => [
      { key: 'time', label: 'Time', sample: '05:00' },
      { key: 'linkedTitle', label: 'Linked Title', sample: 'Kickoff' },
    ],
    // Pure per cgAnimationEngine.ts's rendering model (a plain render-time
    // read, re-evaluated whenever something causes a re-render) — reads
    // Date.now() and the same store state countdownVmixSync.ts's background
    // pusher already does, so a bound CG element always agrees with
    // whatever's actually being pushed to vMix right now. A ticking
    // 'target'-mode countdown needs the CONSUMER re-rendering on its own
    // periodic tick to actually animate live on screen, since nothing in
    // the store itself changes as time passes — see CgTemplateWidget.tsx's
    // hasLiveBinding poll.
    resolve: (config, key) => {
      const state = computeCountdownState(config, Date.now(), {
        scheduleMatches: useMatchScheduleStore.getState().matches,
        rundownSegments: useRundownStore.getState().segments,
        canvasTournamentId: useAppSettings.getState().canvasTournamentId,
      });
      if (key === 'linkedTitle') return state.linkedTitleText;
      return state.timeText;
    },
  },
  // TeamFormWidget.tsx's own last-N-results Win/Loss/Draw history, read
  // against whichever Scoreboard it's linked to — same shared
  // formRowOutcome/formRowResultText/formOutcomeImage lib/teamForm.ts
  // functions its own vMix push already uses, so a bound CG element always
  // agrees with what that push and the widget's own on-canvas table show.
  // Capped at FORM_HISTORY_DEPTH since a bindable-parts dropdown needs a
  // FIXED list of named entries — the widget's own vMix push has no such
  // cap (it pushes every row it finds), but "last 5" is the standard
  // broadcast "Form" convention anyway.
  'team-form': {
    getParts: () => TEAM_FORM_PARTS,
    resolve: (config, key, pages) => resolveTeamFormPart(config, key, pages),
  },
};

const FORM_HISTORY_DEPTH = 5;

const TEAM_FORM_PARTS: MergePart[] = Array.from({ length: FORM_HISTORY_DEPTH }, (_, i) => i + 1).flatMap((n) => [
  { key: `resultImageA${n}`, label: `A — Result ${n} Image`, sample: '(image)' },
  { key: `resultTextA${n}`, label: `A — Result ${n} Text`, sample: 'Round 3: W 3-1 v Arsenal' },
  { key: `resultImageB${n}`, label: `B — Result ${n} Image`, sample: '(image)' },
  { key: `resultTextB${n}`, label: `B — Result ${n} Text`, sample: 'Round 3: L 1-3 v Chelsea' },
]);

/** Can't use lib/autoLink.ts's autoLinkedWidget "fall back to the sole
 *  Scoreboard on the page" convenience here — that needs the Team Form
 *  widget's OWN id, which BindableSource.resolve's (config, key, pages)
 *  signature doesn't carry (unlike the widget's own render, which has
 *  `widgetId` directly). An unlinked Team Form widget (no explicit
 *  config.linkedScoreboardId) simply resolves every part to '' here, same
 *  as any other binding pointed at a half-configured source. */
function resolveTeamFormPart(config: Record<string, any>, key: string, pages: CanvasPage[]): string {
  const m = key.match(/^result(Image|Text)([AB])(\d+)$/);
  if (!m) return '';
  const [, kind, sideLetter, idxStr] = m;
  const side = sideLetter.toLowerCase() as 'a' | 'b';
  const idx = parseInt(idxStr, 10) - 1;
  const linkedScoreboard = pages.flatMap((p) => p.widgets).find((w) => w.id === config.linkedScoreboardId && w.type === 'scoreboard');
  if (!linkedScoreboard) return '';
  const dc = linkedScoreboard.config;
  const teamA = { name: dc.teamAName ?? 'Team A', shortName: dc.teamAShortName };
  const teamB = { name: dc.teamBName ?? 'Team B', shortName: dc.teamBShortName };
  const rows = mergeResultRows(useMatchResultsStore.getState().results, teamA, teamB, dc.category, dc.linkedTournamentId);
  const row = rows[idx];
  if (!row) return '';
  if (kind === 'Image') {
    const outcome = formRowOutcome(row, side);
    return (outcome && formOutcomeImage(config, outcome)) || '';
  }
  return formRowResultText(row, side) ?? '';
}

// ── Group-draw binding (Team Database, not a widget) ────────────────────
// See canvas.ts's own doc comment on TemplateElementBinding.groupSlot for
// the full "why". Its own small, fixed catalog (not run through
// BINDABLE_SOURCES/getBindableParts at all — there's no widget here for
// that registry to key off of; ElementInspector's own UI builds this
// binding shape directly instead of picking a widget + part).
export const GROUP_SLOT_PARTS: MergePart[] = [
  { key: 'name', label: 'Team Name', sample: 'Chelsea' },
  { key: 'shortName', label: 'Short Name', sample: 'CHE' },
  { key: 'logo', label: 'Logo', sample: '(image)' },
];

/** Resolves a `groupSlot` binding to a live string — 'logo' returns the raw
 *  image URL (same convention every other logo-shaped bindable part in this
 *  file already uses; the 'image' kind element that binds to it treats
 *  whatever string comes back as a URL regardless of source). Empty string
 *  when no team currently occupies that exact slot (see resolveGroupSlots'
 *  own "fully manual, no auto-fill" rule — matches the existing Group Field
 *  vMix push's behavior exactly, rather than guessing which team belongs
 *  there). */
export function resolveGroupSlotValue(binding: TemplateElementBinding): string {
  const slot = binding.groupSlot;
  if (!slot) return '';
  const members = useTeamDbStore.getState().teams.filter((t) => t.tournamentId === slot.tournamentId && t.group === slot.group);
  const { slots } = resolveGroupSlots(members, slot.position);
  const team = slots[slot.position - 1];
  if (!team) return '';
  switch (binding.key) {
    case 'shortName': return team.shortName ?? '';
    case 'logo': return team.logo ?? '';
    default: return team.name ?? '';
  }
}

// ── Tournament-field binding (Tournament.logo/categoryLogos, not a widget) ──
// Same no-widget shape as GROUP_SLOT_PARTS above — see canvas.ts's own doc
// comment on TemplateElementBinding.tournamentField for the full "why".
export const TOURNAMENT_FIELD_PARTS: MergePart[] = [
  { key: 'logo', label: 'Tournament Logo', sample: '(image)' },
  { key: 'categoryLogo', label: 'Category Logo', sample: '(image)' },
];

/** Resolves a `tournamentField` binding to a live image URL. 'categoryLogo'
 *  falls back to the tournament's own `logo` when that category has none of
 *  its own — same precedence Tournament.categoryLogos' own doc comment
 *  already describes, so a template bound to "Category Logo" still shows
 *  something sensible for a category nobody's given its own mark yet. */
export function resolveTournamentFieldValue(binding: TemplateElementBinding): string {
  const tf = binding.tournamentField;
  if (!tf) return '';
  const tournament = useTournamentStore.getState().tournaments.find((t) => t.id === tf.tournamentId);
  if (!tournament) return '';
  if (binding.key === 'categoryLogo') return tournament.categoryLogos?.[tf.category ?? ''] || tournament.logo || '';
  return tournament.logo ?? '';
}

function humanizeKey(key: string): string {
  // camelCase / snake_case -> "Camel Case" / "Snake Case"
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

/** Every field a template element could bind to on this widget — curated
 *  where a BindableSource is registered for its type, otherwise every
 *  primitive-valued top-level config field (skips arrays/objects like
 *  `actions`/`elements`/pickers, which aren't meaningful as bound text). */
export function getBindableParts(widget: CanvasWidget): MergePart[] {
  const src = BINDABLE_SOURCES[widget.type];
  if (src) return src.getParts(widget.config);
  return Object.entries(widget.config)
    .filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
    .map(([k, v]) => ({ key: k, label: humanizeKey(k), sample: String(v) }));
}

/** Resolves a template element's binding to a live string, by looking up
 *  the source widget (by id, across every page) and reading the bound
 *  field off its *current* config — this is why a bound element updates on
 *  its own the moment the source widget's config changes, with no push
 *  step: it's a plain render-time read of already-reactive store state. */
export function resolveBindingValue(pages: CanvasPage[], binding: TemplateElementBinding): string {
  if (binding.groupSlot) return resolveGroupSlotValue(binding);
  if (binding.tournamentField) return resolveTournamentFieldValue(binding);
  const widget = pages.flatMap((p) => p.widgets).find((w) => w.id === binding.sourceWidgetId);
  if (!widget) return '';
  const src = BINDABLE_SOURCES[widget.type];
  return src ? src.resolve(widget.config, binding.key, pages) : String(widget.config[binding.key] ?? '');
}

/** True if ANY of this template's elements is bound to a source whose live
 *  value can change without the bound-to widget's own config ever changing
 *  (a 'target'-mode Countdown ticking down purely from Date.now(), see
 *  pomodoro's resolver above) — CgTemplateWidget.tsx polls on a plain
 *  interval when this is true so those elements actually animate live
 *  instead of only updating whenever something else happens to force a
 *  re-render. A widget like Timer/Scoreboard doesn't strictly need this
 *  (their own config is what's actually ticking, so a normal store
 *  subscription already re-renders on its own) — checking by binding
 *  presence rather than by source type keeps this simple and automatically
 *  covers any future time-based source the same way. */
export function hasLiveBinding(elements: { kind?: string; binding?: TemplateElementBinding; config?: Record<string, any>; conditions?: { binding?: TemplateElementBinding }[] }[]): boolean {
  return elements.some((e) =>
    !!e.binding ||
    (e.kind === 'statbar' && ((e.config?.rows as StatBarRow[] | undefined) ?? []).some((r) => !!r.bindingA || !!r.bindingB)) ||
    // A condition (see types/canvas.ts's own doc comment) watching a
    // 'target'-mode Countdown/pomodoro the same way a content binding
    // could needs the exact same periodic re-render this whole function
    // exists for — otherwise a "hide once the clock hits zero" condition
    // would only ever re-check itself whenever something UNRELATED
    // happened to force a re-render, not the moment it actually crosses
    // zero.
    (e.conditions ?? []).some((c) => !!c.binding)
  );
}
