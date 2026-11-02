import { Fragment, useContext, useEffect, useRef, useState } from 'react';
import { Settings, X, Undo2, Save, Check, RotateCcw, Radio, Users, ChevronDown, ChevronUp, Repeat, ClipboardList, Play, Timer, Pencil, ArrowRight, ArrowLeftRight } from 'lucide-react';
import { useCanvasStore } from '../../stores/canvasStore';
import { CanvasActionContext } from '../../lib/canvasContext';
import { useVmixStore } from '../../stores/vmixStore';
import { useMatchResultsStore } from '../../stores/matchResultsStore';
import { useMatchScheduleStore } from '../../stores/matchScheduleStore';
import { useTournamentStore } from '../../stores/tournamentStore';
import { useTeamDbStore } from '../../stores/teamDbStore';
import { resolveImageUrl, transparentLogoUrl } from '../../lib/imageUrl';
import { TeamPicker } from '../TeamPicker';
import { LogoUrlPicker } from '../LogoUrlPicker';
import { SPORT_LABELS, SPORT_DEFAULTS, type SportType, type RacketSportSettings } from '../../types/tournament';
import { computeMatchSignature, buildResultFromConfig, buildLoadMatchPatchRacket, guardScoreboardOverwrite, findDuplicateResult } from '../../utils/scoreboardSnapshot';
import { extractKnockoutStage } from '../TournamentManager';
import { runActions, type ActionItem } from '../../lib/buttonActions';
import {
  type RacketSide, type RallyMatchState, type TennisMatchState, type RacketPlayerEntry,
  initRallyMatch, scoreRallyPoint, advanceRallyGame, isRallyGameOver, rallyGamesWon, adjustRallyPoint,
  initTennisMatch, scoreTennisPoint, tennisPointLabel, isTennisDeuce, formatGameResult, adjustTennisPoint,
  normalizePlayerEntry, formatPlayerEntry, formatDuration,
} from '../../lib/racketScoring';
import { CardSelect, ToggleCard, CustomBox, InputPickerDropdown, FieldPickerDropdown } from '../WidgetConfigPanel';

interface Props {
  widgetId: string;
  config: Record<string, any>;
  w: number;
  h: number;
}

// Substitutes a per-set field NAME TEMPLATE's `{n}` placeholder with the
// 1-based set number — e.g. "team-a-score-s{n}.Text" + 3 → "team-a-score-
// s3.Text". `{n}` can sit anywhere in the string (any separator, any
// position relative to a team letter), unlike the older fixed "{prefix}
// {n}A.Text" shape — see RacketVmixTarget.setScoreTemplateA/B's own doc
// comment for why that mattered.
function expandSetTemplate(template: string, setNumber: number): string {
  return template.replace(/\{n\}/g, String(setNumber));
}

// '#RRGGBB' (an <input type="color"> value) -> 'FFRRGGBB', the ARGB hex
// vMix's SetColor function expects for its Value parameter — same
// convention TeamFormWidget.tsx's own toArgbHex already uses.
function toArgbHex(hex: string): string {
  return 'FF' + hex.replace('#', '').toUpperCase();
}

// Turns a picked REAL field name (assumed to represent Set 1 — pickers
// always show/search with n=1 substituted in) into a reusable {n} template
// by replacing the LAST run of digits in it, same convention
// WidgetConfigPanel.tsx's own racket-scoreboard case uses for this exact
// picker (duplicated rather than shared, same as RacketVmixTarget's own
// precedent) — e.g. "team-a-score-s1.Text" -> "team-a-score-s{n}.Text".
function deriveSetTemplate(fieldName: string): string {
  return /\d/.test(fieldName) ? fieldName.replace(/(\d+)(?!.*\d)/, '{n}') : `${fieldName}{n}`;
}

// Builds a regex matching any field name this template could have produced
// for SOME set number — used to find and clear stale fields beyond the
// current match's max set count (e.g. a best-of-7 template's "…s6/s7"
// fields left over after loading a best-of-3 match). Splits on the first
// literal "{n}" and escapes each side separately so the placeholder itself
// becomes a `(\d+)` capture rather than being escaped as literal text; a
// template with no "{n}" at all (operator typo) just matches itself exactly
// — degrades to "always the same field", never throws.
function setTemplateStaleRegex(template: string): RegExp {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const idx = template.indexOf('{n}');
  if (idx === -1) return new RegExp(`^${esc(template)}$`, 'i');
  const before = template.slice(0, idx);
  const after = template.slice(idx + 3);
  return new RegExp(`^${esc(before)}(\\d+)${esc(after)}$`, 'i');
}

// One vMix input's worth of field mappings for this board — multiple of
// these can run side by side (config.racketVmixTargets), same "+ Add vMix
// Input" convention MatchScheduleWidget's own FixtureVmixTarget[] already
// uses. `id: 'legacy'` is synthesized from the OLD flat config fields
// (config.vmixInputKey/fieldScoreA/etc, from before this was an array) when
// config.racketVmixTargets itself is still empty — see vmixTargets below —
// so an existing widget keeps pushing exactly what it always did with zero
// migration step.
interface RacketVmixTarget {
  id: string;
  inputKey: string;
  inputTitle?: string;
  fieldScoreA?: string;
  fieldScoreB?: string;
  fieldTeamA?: string;
  fieldTeamB?: string;
  /** Short name ONLY (config.teamAShortName/teamBShortName) — unlike
   *  fieldTeamA/B above (always the full name), a dedicated field for
   *  templates that want the short form specifically, pushed to its own
   *  separate field rather than substituted in place of the full one. */
  fieldTeamAShort?: string;
  fieldTeamBShort?: string;
  /** Pushes the team's OWN logo (config.teamALogo/teamBLogo) to a Source
   *  field — distinct from serverIconA/B, which is a dedicated serving
   *  indicator icon, not the team badge. */
  fieldTeamALogo?: string;
  fieldTeamBLogo?: string;
  fieldGamesWonA?: string;
  fieldGamesWonB?: string;
  fieldSetLabel?: string;
  /** Match-info fields — same ones a fixture carries (ScheduledMatch) and
   *  auto-fill from it on load (Match Info section) — pushed as plain
   *  text, same convention every other field here uses. Sport pushes the
   *  sport's own display label (SPORT_LABELS[sport], e.g. "Sepak Takraw"),
   *  not the internal sport id. */
  fieldVenue?: string;
  fieldDate?: string;
  fieldTime?: string;
  fieldCategory?: string;
  fieldGroup?: string;
  fieldSport?: string;
  /** Legacy — a plain prefix assuming the fixed shape "{prefix}{n}A.Text" /
   *  "{prefix}{n}B.Text" (e.g. "Set" → Set1A.Text/Set1B.Text). Still read as
   *  a fallback when neither template below is set, for whatever was
   *  configured before those existed. */
  setScorePrefix?: string;
  /** Per-set score field NAME TEMPLATES — one per side, `{n}` standing in
   *  for the 1-based set number, substituted literally wherever it appears
   *  (any position, any separator) — e.g. "team-a-score-s{n}.Text" for a
   *  field literally named "team-a-score-s1.Text". Takes over from
   *  setScorePrefix above whenever either is set, since not every naming
   *  convention has the team letter trailing right before the set number
   *  the way that fixed shape assumed. */
  setScoreTemplateA?: string;
  setScoreTemplateB?: string;
  /** Field name TEMPLATE (same {n} convention as setScoreTemplateA/B) for an
   *  OVERRIDE target — only needed if you want something OTHER than the set
   *  score's own Text field recolored (vMix's SetTextColour, which this
   *  board uses by default, colors a Text field's own font color directly
   *  by that field's own name — setScoreTemplateA/B above already is that
   *  name, no separate element required). Leave blank to just recolor the
   *  score number itself, which is what almost everyone wants. */
  setScoreColorFieldA?: string;
  setScoreColorFieldB?: string;
  /** '#RRGGBB' (an <input type="color"> value — converted to vMix's own
   *  ARGB hex at push time, see toArgbHex) — when set, the JUST-DECIDED
   *  set's own winner-side color field (setScoreColorFieldA/B above, or
   *  setScoreTemplateA/B itself as a fallback) is colored this the instant
   *  that set ends; setScoreLoseColor does the same for the loser's side. A
   *  simpler, built-in alternative to configuring a full Set Result Trigger
   *  action list just to recolor a field this board already knows how to
   *  address. Either/both optional — unset means no color change happens
   *  automatically. */
  setScoreWinColor?: string;
  setScoreLoseColor?: string;
  /** Applied to every NOT-YET-DECIDED set's score field — the one still
   *  being played right now, and any slot not reached yet (completed sets
   *  keep whatever win/lose color they already got the instant they
   *  concluded; this never touches those). Lets the whole per-set row have
   *  a consistent, app-controlled neutral color instead of whatever the
   *  vMix title itself happens to default a Text field to. Optional —
   *  unset leaves undecided sets at the title's own default color. */
  setScoreDefaultColor?: string;
  /** Colors the LIVE score field (fieldScoreA/B above by default —
   *  pointWinColorFieldA/B below override just this, same "blank means use
   *  the Text field's own name" convention setScoreColorFieldA/B uses) the
   *  instant that side reaches a point that would win the current game/
   *  set/match — same pointSigA/B detection the on-screen Game/Set/Match
   *  Point badge already uses. pointDefaultColor is what it reverts to the
   *  rest of the time (point lost, new game started, etc.) — without it,
   *  the win color would only ever apply once and never clear. */
  pointWinColorFieldA?: string;
  pointWinColorFieldB?: string;
  pointWinColor?: string;
  pointDefaultColor?: string;
  // 'text' (default) pushes the serving team's NAME to fieldServerName,
  // same as before this existed. 'image' pushes a SERVER ICON (serverIconA/B
  // below — an operator-picked image, e.g. a shuttle/ball icon or arrow,
  // NOT the team's own logo) to fieldServerImage instead, swapping between
  // the two images as serve changes side. 'trigger' pushes nothing at all —
  // it instead fires one of 4 action lists (any vMix function, e.g. Overlay
  // In/Out on a "Team A serving" graphic) the moment the server actually
  // CHANGES — see the dedicated effect below for exactly when each fires.
  serverMode?: 'text' | 'image' | 'trigger';
  fieldServerName?: string;
  fieldServerImage?: string;
  /** Icon image pushed to fieldServerImage while that side is serving —
   *  independent of the team's own logo (config.teamALogo/teamBLogo),
   *  since the "who's serving" indicator is usually its own dedicated icon
   *  (a shuttle, a dot, an arrow…), not a second copy of the team badge. */
  serverIconA?: string;
  serverIconB?: string;
  /** 'simple' (default) — pick an input + a text/image field per side
   *  (serverVisible*A/B below) and this just calls vMix's own
   *  SetTextVisibleOn/Off or SetImageVisibleOn/Off directly — the common
   *  case (show one side's "serving" graphic, hide the other's) with
   *  nothing to build. 'advanced' is the full ActionListEditor 4-list setup
   *  (serverShowActionsA/B etc) for anything a plain show/hide can't do —
   *  a different function entirely, multiple actions, a different input
   *  per team, etc. */
  serverTriggerMode?: 'simple' | 'advanced';
  /** Lives on this same target's own inputKey above — no separate Input
   *  picker for these, since it's always the same vMix input every other
   *  field on this target already uses. */
  serverVisibleFieldA?: string;
  serverVisibleTypeA?: 'text' | 'image';
  serverVisibleFieldB?: string;
  serverVisibleTypeB?: 'text' | 'image';
  serverShowActionsA?: ActionItem[];
  serverHideActionsA?: ActionItem[];
  serverShowActionsB?: ActionItem[];
  serverHideActionsB?: ActionItem[];
  /** Starting-lineup push — one Name/Jersey/Position field TRIPLE per
   *  side, same {n}-template convention as setScoreTemplateA/B above
   *  (`{n}` is the 1-based starter SLOT number, e.g.
   *  "PlayerA{n}Name.Text" → "PlayerA1Name.Text" for the first starter).
   *  Reserves a slot for every one of config.playerCount's slots, not just
   *  however many are actually filled in — same "fixed-size GT template
   *  needs somewhere to bind an empty slot" reasoning the per-set score
   *  fields already follow. Any of the three is independently optional. */
  playerNameTemplateA?: string;
  playerJerseyTemplateA?: string;
  playerPositionTemplateA?: string;
  playerNameTemplateB?: string;
  playerJerseyTemplateB?: string;
  playerPositionTemplateB?: string;
  /** UI-only (WidgetConfigPanel.tsx's Player tab) — picker vs manual entry
   *  for the 6 templates above, same convention setScoreTemplateMode uses. */
  playerTemplateMode?: 'picker' | 'manual';
}

// Racket/net-sport (badminton, table tennis, tennis, sepaktakraw) match
// control — the counterpart to ScoreboardWidget.tsx for sports scored in
// SETS/GAMES rather than a single running tally. Settings live in TWO
// places on purpose, same as ScoreboardWidget.tsx: name/color/logo/
// TeamPicker/server-dot are quick-edit inline right here on the widget
// card, and the SAME deeper settings (Tournament, Match Info, Scoring
// Rules, Serving, Appearance, vMix Output) are reachable both from this
// widget's own inline gear-icon panel below (for a fast in-the-moment
// change without leaving the board) AND from WidgetConfigPanel.tsx's own
// 'racket-scoreboard' case (select the widget to reach it) — one writes
// the exact same config fields the other reads, so neither can drift out
// of sync with the other. Shares buildResultFromConfig/
// computeMatchSignature/guardScoreboardOverwrite/findDuplicateResult from
// utils/scoreboardSnapshot.ts with ScoreboardWidget.tsx completely
// unmodified — those already work off plain config-shaped fields
// (teamAName/scoreA/competition/...), so a racket match's own final
// games/sets-won tally slots into scoreA/scoreB exactly the way any other
// sport's goals do.
export function RacketScoreboardWidget({ widgetId, config, w, h }: Props) {
  const store = useCanvasStore();
  const ctx = useContext(CanvasActionContext);
  const isCommentator = !!ctx;
  const { pages } = store;
  const updateWidgetConfig = ctx?.updateWidgetConfig ?? store.updateWidgetConfig;
  const resizeWidget = ctx?.resizeWidget ?? store.resizeWidget;
  // getClient() (not the raw `client` field) — see vmixStore.ts's own doc
  // comment: `client` is only ever set on the HOST, so reading it directly
  // silently drops every push when this widget is driven from a remote
  // interactive client. getClient() proxies through to the host's real
  // connection in that case.
  const client = useVmixStore((s) => s.getClient());
  const vmixState = useVmixStore((s) => s.vmixState);
  const allVmixInputs = vmixState?.inputs ?? [];
  const { addResult, updateResult, results: savedResults } = useMatchResultsStore();
  const { matches: scheduleMatches, markSent: markFixtureSent, markCompleted: markFixtureCompleted } = useMatchScheduleStore();
  const { tournaments } = useTournamentStore();
  const { teams: teamDbTeams } = useTeamDbStore();

  const [showSettings, setShowSettings] = useState(false);
  // Match Settings extends the widget's OWN canvas footprint sideways
  // (resizeWidget) instead of opening a floating popup — the board's own
  // frame gets wider to make room for the panel as a normal sibling inside
  // it, exactly as if the operator had dragged its own resize handle wider,
  // rather than a separate element floating on top of/beside everything
  // else on the canvas. Reverts by the same fixed amount on close. Doesn't
  // try to preserve a width the operator manually changed while the panel
  // happened to be open — same simplicity the plain resize handle itself
  // already has (whatever w is AT THE MOMENT of each toggle is what's
  // grown/shrunk from).
  const SETTINGS_PANEL_WIDTH = 300;
  const toggleSettings = () => {
    resizeWidget(widgetId, showSettings ? w - SETTINGS_PANEL_WIDTH : w + SETTINGS_PANEL_WIDTH, h);
    setShowSettings(v => !v);
  };
  const [savedFlash, setSavedFlash] = useState(false);
  const [duplicateResultId, setDuplicateResultId] = useState<string | null>(null);
  const [rosterOpen, setRosterOpen] = useState<{ A: boolean; B: boolean }>({ A: false, B: false });
  const [playersOpen, setPlayersOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [resetArmed, setResetArmed] = useState(false);
  // Purely local re-render pulse for the live game-timer display below —
  // config.gameStartedAt itself is the actual source of truth (survives
  // remount/reconnect same as every other score field), this just forces a
  // fresh Date.now() read once a second while a timer is actually running
  // so the on-screen mm:ss visibly ticks instead of only updating whenever
  // some other state change happens to re-render the widget anyway.
  const [, setTimerTick] = useState(0);

  const sport: SportType = config.sport ?? 'badminton';
  const scoringMode: 'rally' | 'tennis' = config.scoringMode ?? 'rally';
  // 'vertical' (default) is the original team-card layout, unchanged.
  // 'horizontal' is a compact broadcast-scorebug style: one row per side,
  // flag/logo inline before the name, each completed game/set as its own
  // box, and the live current score as a final highlighted box. 'lowerthird'
  // is a slim bar (competition tag, "Team A vs Team B", full score line) for
  // a lower-third graphic rather than a full on-screen scorebug. 'liveCard'
  // is a dark, mobile-app-style match card (LIVE pill, big "games won"
  // score + "Set N" under it, big colored point totals, pill +1/Undo
  // buttons) modeled on a reference design — see the dedicated
  // liveCardLayout block below. All four share the exact same underlying
  // config/scoring state — this only ever changes how it's DISPLAYED.
  const layoutStyle: 'vertical' | 'horizontal' | 'lowerthird' | 'liveCard' = config.layoutStyle ?? 'vertical';
  // Uniform size control for every +1/-1 score button, in every layout —
  // a plain CSS transform: scale() multiplier (1 = 100%, the original
  // size), set as a CSS custom property on the widget's own root so each
  // layout's own button classes can all reference the same one value
  // rather than needing their own separate size settings.
  const scoreButtonScale = config.scoreButtonScale ?? 1;
  // Start Game button's own size — separate from scoreButtonScale above
  // (that one only ever touches +1/-1), since this is a different kind of
  // control the operator needs to notice and press BEFORE any scoring
  // happens at all, not scale alongside the score buttons that only matter
  // once play is already under way.
  const startButtonScale = config.startButtonScale ?? 1;
  // Color/style, same "off by default, falls back to the theme accent"
  // convention as every other optional color on this widget — an existing
  // widget saved before these fields existed looks exactly the same.
  const startButtonColor = config.startButtonColor || 'var(--accent)';
  const startButtonStyle: 'solid' | 'outline' | 'ghost' = config.startButtonStyle ?? 'solid';
  // Horizontal/Lower Third only (Vertical's own point-btns stay in their
  // established spot) — 'sides': each side's own +1/-1 sits right on that
  // side's own row/name (the default). 'grouped': both sides' +1/-1 (and
  // Undo) sit together in one shared strip instead, closer to how Vertical
  // itself already groups them.
  const scoreButtonPosition: 'sides' | 'grouped' = config.scoreButtonPosition ?? 'sides';
  const teamAColor = config.teamAColor ?? '#e74c3c';
  const teamBColor = config.teamBColor ?? '#3498db';
  // Logo/name/score size — customizable independently of scoreButtonScale
  // above (that one only ever affects +1/-1 buttons). logoSize is new;
  // nameFontSize/scoreFontSize already existed for the vertical layout's
  // own identity/score-row, now applied across all three layouts so
  // switching layoutStyle doesn't silently drop a size an operator already
  // set. Defaults match each element's own original, un-customized size —
  // an existing widget saved before these fields existed looks identical.
  const logoSize = config.logoSize ?? 54;
  const nameFontSize = config.nameFontSize ?? 16;
  const scoreFontSize = config.scoreFontSize ?? 36;
  // Horizontal/Lower Third's own flag and score-box elements aren't square
  // like the vertical layout's logo/big-number, so logoSize/scoreFontSize
  // (pixel values calibrated to vertical) scale THEM proportionally off
  // their own original default dimensions instead of being applied as raw
  // pixel values directly — one shared slider still controls all three
  // layouts' sizing together, just respecting each element's own shape.
  const logoScale = logoSize / 54;
  const scoreScale = scoreFontSize / 36;
  // Starters/Subs/Roster footer — its own independent multiplier (not tied
  // to logoScale/scoreScale above) since the Players tab's own "Player
  // Area Size" setting is about making a cramped 8-9px lineup list easier
  // to read, a separate concern from the main score card's sizing.
  const playerAreaScale = config.playerAreaScale ?? 1;
  // "Require Start to score" — entirely optional (off unless explicitly
  // turned on in Settings): while on, scoring (+1/-1) and changing serve
  // are both locked out until the operator presses Start for the CURRENT
  // game — mirrors real broadcast practice where nothing should move on
  // the board before the match/game officially begins. Self-resolves once
  // Start is pressed, and re-engages automatically for the NEXT game once
  // gameStartedAt resets to undefined again (see startNextGame/scorePoint's
  // own doc comments on when that happens) — so this isn't a one-time gate,
  // it re-applies every single game while the setting stays on.
  const scoringLocked = !!config.requireStartToScore && !config.gameStartedAt;

  const owningPage = pages.find(p => p.widgets.some(w => w.id === widgetId));
  const effTournamentId: string | undefined = config.linkedTournamentId || owningPage?.tournamentId;

  const serviceMode: 'auto' | 'manual' = config.serviceMode ?? 'auto';
  const rallySettings = {
    pointsToWin: config.pointsToWin ?? 21, winBy2: config.winBy2 ?? true, pointCap: config.pointCap, deuceTarget: config.deuceTarget, gamesToWin: config.gamesToWin ?? 2,
    totalGames: config.playAllGames ? config.totalGames : undefined,
    serviceMode, serviceRule: (config.serviceRule ?? 'rally-winner') as 'rally-winner' | 'alternate', serviceAlternateEvery: (config.serviceAlternateEvery ?? 2) as 1 | 2,
  };
  const tennisSettings = {
    setsToWin: config.gamesToWin ?? 2, tiebreakAtGames: config.tiebreakAtGames ?? 6, noAd: !!config.noAd, serviceMode,
    totalSets: config.playAllGames ? config.totalGames : undefined,
  };

  const rallyState: RallyMatchState = config.rallyState ?? initRallyMatch();
  const tennisState: TennisMatchState = config.tennisState ?? initTennisMatch();

  // Applying a whole new sport's own conventional numbers (points-to-win,
  // win-by-2, cap, games-to-win, tiebreak/no-ad, serving rule) in one go,
  // rather than leaving whatever the PREVIOUS sport's numbers happened to
  // be sitting there — an operator picking "Table Tennis" after starting
  // from Badminton's own 21/cap-30/rally-winner defaults almost certainly
  // wants 11/no-cap/alternate-every-2, not a hybrid. Still fully
  // overridable right after, per the "customize point to win" ask this
  // whole settings panel exists for. Same function WidgetConfigPanel.tsx's
  // own 'racket-scoreboard' case uses — kept in sync deliberately, not
  // independently reinvented.
  const applySport = (next: SportType) => {
    const rs: RacketSportSettings = SPORT_DEFAULTS[next].racketScoring
      ?? { mode: 'rally', pointsToWin: 21, winBy2: true, gamesToWin: 2, tiebreakAtGames: 6, noAd: false, serviceMode: 'auto', serviceRule: 'rally-winner', serviceAlternateEvery: 2 };
    updateWidgetConfig(widgetId, {
      sport: next, scoringMode: rs.mode,
      pointsToWin: rs.pointsToWin, winBy2: rs.winBy2, pointCap: rs.pointCap, deuceTarget: rs.deuceTarget, gamesToWin: rs.gamesToWin,
      tiebreakAtGames: rs.tiebreakAtGames, noAd: rs.noAd,
      serviceMode: rs.serviceMode, serviceRule: rs.serviceRule, serviceAlternateEvery: rs.serviceAlternateEvery,
      rallyState: initRallyMatch(), tennisState: initTennisMatch(), pointHistory: [], pointLog: [],
      gameStartedAt: undefined, gameEndedAt: undefined, gameDurationsMs: [],
    });
  };

  const handleTeamPick = (side: RacketSide, picked: { id: string; name: string; shortName?: string; color: string; logo?: string }) => {
    const patch = side === 'A'
      ? { teamAId: picked.id, teamAName: picked.name, teamAShortName: picked.shortName ?? '', teamAColor: picked.color, teamALogo: picked.logo ?? '' }
      : { teamBId: picked.id, teamBName: picked.name, teamBShortName: picked.shortName ?? '', teamBColor: picked.color, teamBLogo: picked.logo ?? '' };
    updateWidgetConfig(widgetId, patch);
  };

  // Starters/Subs/Roster — who's actually playing this side, distinct from
  // teamAName/B (often the club/country, e.g. "Malaysia", not the
  // individual(s) on court). Roster comes from the linked SavedTeam
  // (TeamPicker set teamAId/B); Starters are { name, jerseyNo, position }
  // entries (lib/racketScoring.ts's RacketPlayerEntry, not roster ids) so
  // they work identically whether or not this side is linked at all — an
  // unlinked/freeform side still gets to type a starter (jersey/position
  // included) by hand, same as the team name itself already works either
  // way. Subs stay plain name strings — the bench doesn't need the same
  // per-slot detail a starting lineup does. config.playerCount (default 1,
  // see the Settings panel's own "Players per team" field) is how many
  // starter SLOTS render — badminton/table tennis singles is 1, a doubles
  // pair is 2, a sepaktakraw regu is 3, but this is deliberately a plain
  // number the operator sets per match, not auto-derived from `sport`,
  // since a badminton tournament might still run doubles on the same board.
  const rosterFor = (side: RacketSide) => {
    const teamId = side === 'A' ? config.teamAId : config.teamBId;
    return teamDbTeams.find(t => t.id === teamId)?.players ?? [];
  };
  const startersFor = (side: RacketSide): RacketPlayerEntry[] => {
    const arr: unknown[] = Array.isArray(config[side === 'A' ? 'startersA' : 'startersB']) ? config[side === 'A' ? 'startersA' : 'startersB'] : [];
    const n = Math.max(1, config.playerCount ?? 1);
    // Padded/truncated to exactly `playerCount` slots every render, rather
    // than stored pre-padded — so turning "Players per team" up or down
    // later never has to reconcile a stale array length against it.
    // normalizePlayerEntry also upgrades any pre-existing plain-string
    // starter (widgets created before jersey/position existed) for free.
    return Array.from({ length: n }, (_, i) => normalizePlayerEntry(arr[i]));
  };
  const subsFor = (side: RacketSide): string[] =>
    Array.isArray(config[side === 'A' ? 'subsA' : 'subsB']) ? config[side === 'A' ? 'subsA' : 'subsB'] : [];
  const setStarterSlot = (side: RacketSide, idx: number, patch: Partial<RacketPlayerEntry>) => {
    const field = side === 'A' ? 'startersA' : 'startersB';
    const arr = startersFor(side);
    arr[idx] = { ...arr[idx], ...patch };
    updateWidgetConfig(widgetId, { [field]: arr });
  };
  const addSub = (side: RacketSide, name: string) => {
    if (!name) return;
    const field = side === 'A' ? 'subsA' : 'subsB';
    const arr = subsFor(side);
    if (arr.includes(name)) return;
    updateWidgetConfig(widgetId, { [field]: [...arr, name] });
  };
  const removeSub = (side: RacketSide, name: string) => {
    const field = side === 'A' ? 'subsA' : 'subsB';
    updateWidgetConfig(widgetId, { [field]: subsFor(side).filter(n => n !== name) });
  };
  // Roster row's own quick-add: fills the first empty STARTER slot (jersey
  // number/position included, straight off the roster record) if there is
  // one, otherwise benches the player as a name-only SUB — one button per
  // roster player covers both destinations without needing the operator
  // to pick which list first.
  const addFromRoster = (side: RacketSide, player: { name: string; jerseyNo?: string; position?: string }) => {
    const starters = startersFor(side);
    const emptyIdx = starters.findIndex(s => !s.name);
    if (emptyIdx !== -1) setStarterSlot(side, emptyIdx, { name: player.name, jerseyNo: player.jerseyNo, position: player.position });
    else addSub(side, player.name);
  };

  // Undo — a plain snapshot stack of whichever state object is live (rally
  // or tennis), pushed onto config.pointHistory BEFORE every scoring call
  // rather than derived after the fact, so "undo" is always just "restore
  // the top of the stack", no need to reverse-engineer a scoring rule.
  // Lives in config (not a local ref) so it survives this component
  // unmounting/remounting (a page switch, a sync reconnect) the same way
  // the live score itself already does.
  const pushHistory = () => {
    const history = [...(config.pointHistory ?? [])];
    history.push(scoringMode === 'tennis' ? tennisState : rallyState);
    if (history.length > 50) history.shift(); // cap — an undo stack has no reason to grow unbounded across a whole match
    return history;
  };

  // Match Report's own point-by-point log — one entry PER POINT SCORED
  // (game number + the running score right after that point + who won it),
  // completely separate from pointHistory above (that's only ever a
  // just-enough-to-undo snapshot stack, popped and discarded; this instead
  // only ever grows, kept for the whole match, and is what the "Match
  // Report" section below reads). Captured from the LIVE pre-point score
  // (+1 for whoever just scored) rather than read back off the post-score
  // state, since tennis's own scoreTennisPoint already resets pointsA/B (or
  // tiebreakA/B) to 0 the instant a game/tiebreak/set boundary is crossed
  // within that same call — reading "after" would lose exactly the winning
  // point's own score. Capped the same generous way pointHistory is, so a
  // very long match can't grow this without bound.
  // Fires the instant a set is decided — Set Result Triggers in Settings →
  // vMix Output (config.setWinActionsA/B, setLoseActionsA/B), same ActionItem
  // list/picker a Quick Button uses, so it can drive literally any vMix
  // function (color change, text/image set, overlay, etc.), not just a fixed
  // field push. Fire-and-forget (runActions is async; nothing here waits on
  // it) — a slow/failed vMix call must never hold up live scoring.
  //
  // ALSO — a simpler built-in alternative to a manual trigger, for the
  // common case of just wanting the set's own score field to change color:
  // each vMix target's Per-Set Score Fields (setScoreTemplateA/B) can carry
  // a Win/Lose color (setScoreWinColor/setScoreLoseColor); if set, this
  // colors THAT set's own already-configured field directly — no separate
  // action list to build.
  const fireSetResultActions = (setWinner: RacketSide, setNumber: number) => {
    const winnerActions = setWinner === 'A' ? config.setWinActionsA : config.setWinActionsB;
    const loserActions = setWinner === 'A' ? config.setLoseActionsB : config.setLoseActionsA;
    if (winnerActions?.length) runActions(winnerActions);
    if (loserActions?.length) runActions(loserActions);
    if (client) {
      for (const t of vmixTargets) {
        if (!t.inputKey || (!t.setScoreWinColor && !t.setScoreLoseColor)) continue;
        // Colors the set's own score TEXT field directly (vMix's
        // SetTextColour — a real Text field's own font color, targeted by
        // that field's own name, same as SetText uses) — no separate
        // Colour-type GT element has to exist in the title for this to
        // work. setScoreColorFieldA/B is only an OVERRIDE for the rare case
        // of wanting a genuinely different element recolored instead (e.g.
        // a background shape) — leave it blank and this just colors the
        // score number itself.
        const colorFieldA = t.setScoreColorFieldA || t.setScoreTemplateA || (t.setScorePrefix ? `${t.setScorePrefix}{n}A.Text` : '');
        const colorFieldB = t.setScoreColorFieldB || t.setScoreTemplateB || (t.setScorePrefix ? `${t.setScorePrefix}{n}B.Text` : '');
        const winnerField = setWinner === 'A' ? colorFieldA : colorFieldB;
        const loserField = setWinner === 'A' ? colorFieldB : colorFieldA;
        // Fall back to the SAME default swatch the color pickers themselves
        // show (#2ecc71/#e74c3c) when only ONE side was ever explicitly
        // picked — otherwise the un-picked side's color stayed undefined
        // forever (the swatch default is cosmetic only, never saved until
        // touched), so e.g. a Win color alone left every LOSING set's field
        // completely uncolored instead of the red the picker appeared to
        // promise.
        const winColor = t.setScoreWinColor || '#2ecc71';
        const loseColor = t.setScoreLoseColor || '#e74c3c';
        if (winnerField) client.setTextColor(t.inputKey, expandSetTemplate(winnerField, setNumber), toArgbHex(winColor));
        if (loserField) client.setTextColor(t.inputKey, expandSetTemplate(loserField, setNumber), toArgbHex(loseColor));
      }
    }
  };

  const scorePoint = (side: RacketSide) => {
    if (scoringLocked) return; // Require Start to score — see scoringLocked's own doc comment
    const history = pushHistory();
    const preA = scoringMode === 'tennis' ? (tennisState.inTiebreak ? tennisState.tiebreakA : tennisState.pointsA) : rallyState.pointsA;
    const preB = scoringMode === 'tennis' ? (tennisState.inTiebreak ? tennisState.tiebreakB : tennisState.pointsB) : rallyState.pointsB;
    const gameNum = (scoringMode === 'tennis' ? tennisState.sets.length : rallyState.games.length) + 1;
    const pointLog = [...(config.pointLog ?? []), { game: gameNum, a: preA + (side === 'A' ? 1 : 0), b: preB + (side === 'B' ? 1 : 0), scorer: side }];
    if (pointLog.length > 300) pointLog.shift();
    if (scoringMode === 'tennis') {
      const next = scoreTennisPoint(tennisState, side, tennisSettings);
      const patch: Record<string, unknown> = { tennisState: next, pointHistory: history, pointLog };
      // Tennis closes out a set (or opens/exits a tiebreak) INSTANTLY within
      // this one call — no separate "confirm next game" step the way rally
      // sports get below — so a just-completed SET's own timer needs to
      // stop and get its duration recorded right here, in the same call
      // that the set actually ended, rather than in some later step.
      if (config.gameStartedAt && next.sets.length > tennisState.sets.length) {
        const durations = [...(config.gameDurationsMs ?? []), Date.now() - config.gameStartedAt];
        patch.gameDurationsMs = durations;
        patch.gameStartedAt = undefined;
        patch.gameEndedAt = undefined;
      }
      updateWidgetConfig(widgetId, patch);
      if (next.sets.length > tennisState.sets.length) {
        const justCompleted = next.sets[next.sets.length - 1];
        fireSetResultActions(justCompleted.a > justCompleted.b ? 'A' : 'B', next.sets.length);
      }
    } else {
      const next = scoreRallyPoint(rallyState, side, rallySettings);
      const patch: Record<string, unknown> = { rallyState: next, pointHistory: history, pointLog };
      // Rally sports need a separate confirm step (Start Next Game/Confirm
      // Match Win — see startNextGame below) before the game is actually
      // filed into games[], so the timer can't be fully recorded yet here —
      // just FROZEN at the exact instant the game itself ended (this point),
      // so the display stops ticking immediately rather than keeping to run
      // until the operator gets around to clicking confirm.
      const justEnded = isRallyGameOver(next.pointsA, next.pointsB, rallySettings);
      if (config.gameStartedAt && !config.gameEndedAt && justEnded) {
        patch.gameEndedAt = Date.now();
      }
      updateWidgetConfig(widgetId, patch);
      // Only fire the MOMENT the set actually ends (not on every point of an
      // already-decided, still-unconfirmed set — isRallyGameOver would keep
      // returning the same winner for every point after it, since rally
      // sports don't reset pointsA/B until Start Next Game is confirmed).
      if (justEnded && !isRallyGameOver(rallyState.pointsA, rallyState.pointsB, rallySettings)) {
        fireSetResultActions(next.pointsA > next.pointsB ? 'A' : 'B', rallyState.games.length + 1);
      }
    }
  };

  const undo = () => {
    const history = [...(config.pointHistory ?? [])];
    const prev = history.pop();
    if (!prev) return;
    const pointLog = [...(config.pointLog ?? [])];
    pointLog.pop(); // undo removes exactly the point scorePoint's own log entry above just added
    const patch: Record<string, unknown> = scoringMode === 'tennis' ? { tennisState: prev, pointHistory: history, pointLog } : { rallyState: prev, pointHistory: history, pointLog };
    // Undoing the very point that just ended the game un-ends it — the
    // timer's own freeze (see scorePoint's own doc comment) needs to lift
    // too, so it resumes ticking rather than staying stopped at a moment
    // that, after this undo, never actually happened.
    if (config.gameEndedAt) patch.gameEndedAt = undefined;
    updateWidgetConfig(widgetId, patch);
  };

  // "Swap Last Point" — corrects a point scored for the wrong side by
  // mistake, without the operator having to Undo and re-score by hand.
  // Rather than flipping a flag on the CURRENT (already-wrong) state —
  // which would need to re-derive every rule scoreRallyPoint/
  // scoreTennisPoint already handles (deuce, tiebreak entry/exit, game/set
  // boundaries) — this recomputes from the exact PRE-POINT snapshot (the
  // same one Undo restores, top of pointHistory) as if the CORRECT side had
  // been scored in the first place. pointHistory itself is left untouched
  // (still ends at that same pre-point snapshot), so Undo after a Swap
  // still correctly reverts the whole point, exactly as it would have
  // before the swap. Same limitation Undo already has: can't reach back
  // past a confirmed game/set boundary (pointHistory resets there) — the
  // button is disabled alongside Undo for that same reason.
  const swapLastPoint = () => {
    const history = config.pointHistory ?? [];
    const prev = history[history.length - 1];
    const log: { game: number; a: number; b: number; scorer: RacketSide }[] = config.pointLog ?? [];
    const lastEntry = log[log.length - 1];
    if (!prev || !lastEntry) return;
    const correctSide: RacketSide = lastEntry.scorer === 'A' ? 'B' : 'A';
    if (scoringMode === 'tennis') {
      const prevTennis = prev as TennisMatchState;
      const preA = prevTennis.inTiebreak ? prevTennis.tiebreakA : prevTennis.pointsA;
      const preB = prevTennis.inTiebreak ? prevTennis.tiebreakB : prevTennis.pointsB;
      const next = scoreTennisPoint(prevTennis, correctSide, tennisSettings);
      const pointLog = [...log.slice(0, -1), { game: lastEntry.game, a: preA + (correctSide === 'A' ? 1 : 0), b: preB + (correctSide === 'B' ? 1 : 0), scorer: correctSide }];
      const patch: Record<string, unknown> = { tennisState: next, pointLog };
      // Re-derive the game timer freeze from scratch against the corrected
      // outcome — the wrong point may have ended the set when the right one
      // doesn't (or vice versa), so any existing freeze can't just be kept.
      if (config.gameStartedAt) {
        const justEnded = next.sets.length > prevTennis.sets.length;
        patch.gameEndedAt = justEnded ? Date.now() : undefined;
        if (justEnded) {
          const durations = [...(config.gameDurationsMs ?? []), Date.now() - config.gameStartedAt];
          patch.gameDurationsMs = durations;
          patch.gameStartedAt = undefined;
        }
      }
      updateWidgetConfig(widgetId, patch);
    } else {
      const prevRally = prev as RallyMatchState;
      const next = scoreRallyPoint(prevRally, correctSide, rallySettings);
      const pointLog = [...log.slice(0, -1), { game: lastEntry.game, a: prevRally.pointsA + (correctSide === 'A' ? 1 : 0), b: prevRally.pointsB + (correctSide === 'B' ? 1 : 0), scorer: correctSide }];
      const patch: Record<string, unknown> = { rallyState: next, pointLog };
      if (config.gameStartedAt) {
        patch.gameEndedAt = isRallyGameOver(next.pointsA, next.pointsB, rallySettings) ? Date.now() : undefined;
      }
      updateWidgetConfig(widgetId, patch);
    }
  };

  // Quick manual correction — a "-1" button, or typing a number straight
  // into the score display, both land here. Deliberately separate from
  // scorePoint/undo above: this only ever touches the raw live point count
  // (see adjustRallyPoint/adjustTennisPoint's own doc comments for exactly
  // why — no server change, no pointLog/pointHistory entry, since this
  // isn't a real scored point to log or a real action to undo). Use the
  // actual Undo button to reverse a real point (server included) or a
  // game/set boundary; use this only to fix a wrong NUMBER.
  const adjustPoint = (side: RacketSide, delta: number) => {
    if (scoringLocked) return;
    if (scoringMode === 'tennis') updateWidgetConfig(widgetId, { tennisState: adjustTennisPoint(tennisState, side, delta) });
    else updateWidgetConfig(widgetId, { rallyState: adjustRallyPoint(rallyState, side, delta) });
  };
  const currentPointValue = (side: RacketSide): number => {
    if (scoringMode === 'tennis') return tennisState.inTiebreak ? (side === 'A' ? tennisState.tiebreakA : tennisState.tiebreakB) : (side === 'A' ? tennisState.pointsA : tennisState.pointsB);
    return side === 'A' ? rallyState.pointsA : rallyState.pointsB;
  };
  const setPointValue = (side: RacketSide, raw: string) => {
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n)) return;
    adjustPoint(side, Math.max(0, n) - currentPointValue(side));
  };

  const rallyGameOverWinner = scoringMode === 'rally' ? isRallyGameOver(rallyState.pointsA, rallyState.pointsB, rallySettings) : null;
  // Confirming THIS game (via Start Next Game/advanceRallyGame) might also
  // be the one that closes out the whole match — worth its own "Confirm
  // Match Win" label rather than always saying "Start Next Game" right up
  // to the moment it turns out there IS no next game.
  // With Play All Games on (rallySettings.totalGames set), the match is
  // decided purely by whoever has the most games once totalGames have been
  // played — NOT by whether the just-finished game's own winner personally
  // crosses gamesToWin (they might not: e.g. losing game 3 of a forced 3-
  // game format still ends the match, decided in the OTHER side's favor).
  // So the label just needs "is this the last game of the format?", not
  // "did the game-winner also just clinch it?" — the classic early-finish
  // shape below still needs that second check since there IS no fixed game
  // count to compare against.
  const rallyWouldWinMatch = !!rallyGameOverWinner && (
    rallySettings.totalGames
      ? rallyState.games.length + 1 >= rallySettings.totalGames
      : rallyGamesWon(rallyState, rallyGameOverWinner) + 1 >= rallySettings.gamesToWin
  );
  const startNextGame = () => {
    const patch: Record<string, unknown> = { rallyState: advanceRallyGame(rallyState, rallySettings), pointHistory: [] };
    // The just-finished game's own duration, finally recorded now that it's
    // actually being filed into games[] — frozen at gameEndedAt (the exact
    // point that ended it, set by scorePoint above) rather than Date.now(),
    // so however long the operator took to get around to clicking this
    // button doesn't inflate the recorded time. gameEndedAt itself falls
    // back to right now if it's somehow missing (e.g. a timer started only
    // AFTER the game had already ended, which the Start button's own
    // visibility rules below normally prevent).
    if (config.gameStartedAt) {
      const durations = [...(config.gameDurationsMs ?? []), (config.gameEndedAt ?? Date.now()) - config.gameStartedAt];
      patch.gameDurationsMs = durations;
      patch.gameStartedAt = undefined;
      patch.gameEndedAt = undefined;
    }
    updateWidgetConfig(widgetId, patch);
  };

  // Shared by both "New Match" (replay the SAME two teams from 0-0) and the
  // header's own Reset (which goes further, see fullReset below) — every
  // bit of MATCH state: score, sets, Team Event tally, game timer.
  const matchStateResetPatch = () => ({
    rallyState: initRallyMatch(), tennisState: initTennisMatch(), pointHistory: [], pointLog: [],
    // Reset wipes the WHOLE scoreboard, including any Team Event tally in
    // progress — a fresh start shouldn't leave stale regu wins behind.
    regusWonA: 0, regusWonB: 0, reguHistory: [], reguDraftsA: {}, reguDraftsB: {},
    gameStartedAt: undefined, gameEndedAt: undefined, gameDurationsMs: [],
  });

  const newMatch = () => {
    updateWidgetConfig(widgetId, matchStateResetPatch());
  };

  // Header Reset goes further than "New Match" above — that one deliberately
  // keeps the SAME two teams (a quick "replay this matchup" action), but a
  // genuinely blank "start over" also needs to clear who's even playing:
  // name, short name, logo, color, any linked team-database id, and the
  // roster (starters/subs) — otherwise "Reset" looked like it left the old
  // opponents' names/logos behind.
  const fullReset = () => {
    updateWidgetConfig(widgetId, {
      ...matchStateResetPatch(),
      teamAId: undefined, teamAName: '', teamAShortName: '', teamALogo: '', teamAColor: undefined,
      teamBId: undefined, teamBName: '', teamBShortName: '', teamBLogo: '', teamBColor: undefined,
      startersA: [], startersB: [], subsA: [], subsB: [],
    });
  };

  // Header's own always-available Reset — goes further than "New Match"
  // (see fullReset's own doc comment: clears team identity/roster too, not
  // just score/sets/timer), reachable at ANY point in the match, not only
  // once it's already over. Two-click "arm, then confirm" (same pattern
  // Save's own duplicate-result "Overwrite?" uses — see duplicateResultId
  // above, which also stays armed indefinitely) rather than a native
  // confirm() dialog or a separate modal, since this can wipe real
  // in-progress score (and now team info too) — a single misclick shouldn't
  // be able to. Deliberately does NOT auto-expire the armed state on a
  // timer — an earlier version did (3s), which silently turned a slightly-
  // delayed second click back into a fresh "arm" instead of a confirm,
  // making Reset look unresponsive. Stays armed until actually confirmed,
  // exactly like Overwrite? does.
  const handleResetClick = () => {
    if (!resetArmed) {
      setResetArmed(true);
      return;
    }
    fullReset();
    setResetArmed(false);
  };

  // Game timer — a plain wall-clock start time, not a running "elapsed ms"
  // counter, so the live display below is always just Date.now() minus this
  // (or gameEndedAt minus this, once frozen — see scorePoint's own doc
  // comment on freezing) rather than something that needs its own ticking
  // state persisted anywhere. Purely opt-in: scoring works identically
  // whether or not a timer's running, so skipping Start for a game just
  // means that game's own duration isn't recorded (shows "—" in the report).
  const startGameTimer = () => {
    updateWidgetConfig(widgetId, { gameStartedAt: Date.now(), gameEndedAt: undefined });
  };

  const matchWinnerSide: RacketSide | undefined = scoringMode === 'tennis' ? tennisState.winner : rallyState.winner;
  const gamesWonA = scoringMode === 'tennis' ? tennisState.setsA : rallyGamesWon(rallyState, 'A');
  const gamesWonB = scoringMode === 'tennis' ? tennisState.setsB : rallyGamesWon(rallyState, 'B');

  // ── Team Event (Regu) — sepaktakraw-only. A "regu" is the 3-player side
  // that plays one full match (already modeled above by rallyState/
  // matchWinnerSide); a TEAM tie fields several regu back-to-back (Regu A,
  // Regu B, Regu C…) and is decided by how many individual regu-matches
  // each squad wins, not by points. This layer sits entirely on top of the
  // existing per-regu match: once matchWinnerSide is set (the CURRENT
  // regu's own match is decided), Confirm Regu Win snapshots that regu's
  // result into reguHistory, credits the winner's regu tally, and resets
  // rallyState/tennisState for a fresh 0-0 regu match — same reset newMatch
  // already does, just without touching the tally itself. Off by default
  // (config.teamEventOn) and only ever surfaced for sepaktakraw, so a plain
  // single-regu match (the common case) looks exactly as it always has. */
  const teamEventOn = sport === 'sepaktakraw' && !!config.teamEventOn;
  const regusToWin = config.regusToWin ?? 2;
  const regusWonA = config.regusWonA ?? 0;
  const regusWonB = config.regusWonB ?? 0;
  // pointLog/startersA/startersB are optional on this type (not just in
  // practice) — any regu confirmed before these fields existed was saved
  // without them, and both the report's own groupByGame and the lineup
  // display below default a missing one to "no detail" rather than
  // crashing (see RacketScoreboardWidget.tsx's crash fix history).
  const reguHistory: { regu: number; winner: RacketSide; scoreA: number; scoreB: number; games: string[]; pointLog?: { game: number; a: number; b: number; scorer: RacketSide }[]; startersA?: RacketPlayerEntry[]; startersB?: RacketPlayerEntry[]; gameDurationsMs?: number[] }[] = config.reguHistory ?? [];
  const currentRegu = reguHistory.length + 1;
  const teamTieWinner: RacketSide | null = teamEventOn ? (regusWonA >= regusToWin ? 'A' : regusWonB >= regusToWin ? 'B' : null) : null;
  const confirmReguWin = () => {
    if (!matchWinnerSide) return;
    // pointLog AND this regu's own lineup are carried into the entry too
    // (not just the final game scores) — a Team Event fields a DIFFERENT
    // 3 players per regu, so Match Report/regu history need to remember
    // who actually played each one, not just this side's current (about to
    // be cleared, for the NEXT regu's own lineup) starters.
    const entry = {
      regu: currentRegu, winner: matchWinnerSide, scoreA: gamesWonA, scoreB: gamesWonB,
      games: completedGames.map(formatGameResult), pointLog: config.pointLog ?? [],
      startersA: startersFor('A'), startersB: startersFor('B'),
      // By the time this regu's own matchWinnerSide is set, its last game's
      // duration is already recorded here (scorePoint/startNextGame above
      // both fill this in as the match plays out) — just carried into the
      // entry now, same as pointLog/startersA/B, so Match Report can still
      // show it once the tally moves on to the next regu.
      gameDurationsMs: config.gameDurationsMs ?? [],
    };
    // If the NEXT regu already has a staged/queued lineup (see reguDraftsFor
    // below), it becomes the live starters immediately rather than starting
    // blank — the whole point of being able to queue a regu ahead of time
    // is that it's ready to go the instant its own turn comes up. Consumed
    // (removed from the draft) once it goes live, same as any other queue.
    const nextRegu = currentRegu + 1;
    const draftsA = { ...reguDraftsFor('A') };
    const draftsB = { ...reguDraftsFor('B') };
    const nextStartersA = draftsA[nextRegu] ?? [];
    const nextStartersB = draftsB[nextRegu] ?? [];
    delete draftsA[nextRegu];
    delete draftsB[nextRegu];
    updateWidgetConfig(widgetId, {
      reguHistory: [...reguHistory, entry],
      regusWonA: matchWinnerSide === 'A' ? regusWonA + 1 : regusWonA,
      regusWonB: matchWinnerSide === 'B' ? regusWonB + 1 : regusWonB,
      rallyState: initRallyMatch(), tennisState: initTennisMatch(), pointHistory: [], pointLog: [],
      startersA: nextStartersA, startersB: nextStartersB,
      reguDraftsA: draftsA, reguDraftsB: draftsB,
      gameStartedAt: undefined, gameEndedAt: undefined, gameDurationsMs: [],
    });
  };

  // Queued lineups for regu NOT YET REACHED — a Team Event's own quick-add
  // (see addFromRosterTo below) can stage a player into a future regu
  // number instead of only ever the current live one, so the whole squad's
  // rotation can be planned out ahead of time rather than typed in a rush
  // right as each regu comes up. Keyed by regu number (not array index),
  // consumed by confirmReguWin above the instant that regu actually starts.
  const reguDraftsFor = (side: RacketSide): Record<number, RacketPlayerEntry[]> => {
    const raw = config[side === 'A' ? 'reguDraftsA' : 'reguDraftsB'];
    return raw && typeof raw === 'object' ? raw : {};
  };
  const draftStartersFor = (side: RacketSide, regu: number): RacketPlayerEntry[] => {
    const arr: unknown[] = Array.isArray(reguDraftsFor(side)[regu]) ? reguDraftsFor(side)[regu] : [];
    const n = Math.max(1, config.playerCount ?? 1);
    return Array.from({ length: n }, (_, i) => normalizePlayerEntry(arr[i]));
  };
  const setDraftSlot = (side: RacketSide, regu: number, idx: number, patch: Partial<RacketPlayerEntry>) => {
    const field = side === 'A' ? 'reguDraftsA' : 'reguDraftsB';
    const drafts = { ...reguDraftsFor(side) };
    const arr = draftStartersFor(side, regu);
    arr[idx] = { ...arr[idx], ...patch };
    drafts[regu] = arr;
    updateWidgetConfig(widgetId, { [field]: drafts });
  };
  const clearDraftRegu = (side: RacketSide, regu: number) => {
    const field = side === 'A' ? 'reguDraftsA' : 'reguDraftsB';
    const drafts = { ...reguDraftsFor(side) };
    delete drafts[regu];
    updateWidgetConfig(widgetId, { [field]: drafts });
  };
  // Highest regu number a Team Event's own best-of-N format could ever
  // reach — the quick-add menu below only offers targets up to here (plus
  // Subs), since staging a regu that could never actually be played isn't
  // useful. Same "best of regusToWin*2-1" math the tally label already uses.
  const maxRegu = regusToWin * 2 - 1;
  // Roster row's own TARGETED quick-add — same jersey/position-preserving
  // fill addFromRoster below already does for the CURRENT regu's starters,
  // just aimed at whichever target the operator picked from the menu
  // (Team Event only — see the menu's own render site). Falls back to
  // Subs if the target regu's own starter slots are already full.
  const addFromRosterTo = (side: RacketSide, player: { name: string; jerseyNo?: string; position?: string }, target: number) => {
    const arr = draftStartersFor(side, target);
    const emptyIdx = arr.findIndex(s => !s.name);
    if (emptyIdx !== -1) setDraftSlot(side, target, emptyIdx, { name: player.name, jerseyNo: player.jerseyNo, position: player.position });
    else addSub(side, player.name);
  };

  // Game/Set/Match Point — is `side` one point away from winning the
  // current GAME, the current SET, or the whole MATCH, right now, mid-point
  // (not just mid-game)? Rather than re-deriving every win condition
  // (deuce/tiebreak/winBy2/deuceTarget/totalGames…) a second time here,
  // this just dry-runs the real scoring functions with one extra
  // hypothetical point for `side` and reads off what THAT actually decides
  // — scoreRallyPoint/scoreTennisPoint/advanceRallyGame are all pure
  // (return new state, never mutate), so this is a free, always-correct
  // simulation with zero duplicated rules.
  //
  // Tennis has all three levels for real (a game within a set within a
  // match): winner set → 'match'; else sets.length grew → 'set' (this game
  // also closed the set, whether or not it decided the match); else — only
  // outside a tiebreak, since a tiebreak POINT never completes a "game" in
  // the traditional sense, it completes the set directly — gamesA+gamesB
  // grew → 'game'.
  //
  // Rally sports (badminton/table tennis/sepaktakraw) only have two real
  // levels — there's no "set" layer above their own "game" the way tennis
  // has: winning THIS game either decides the whole match ('match') or it
  // doesn't ('game', relabeled "Set Point" for sepaktakraw specifically at
  // render time — see pointBadgeLabel below — since ISTAF's own rules call
  // sepaktakraw's scoring unit a "set", never a "game").
  //
  // Suppressed once the current game/match/tie is already actually over
  // (nothing to be "point" of), and — deliberately — while Play All Games
  // is forcing extra dead-rubber games, since winning the CURRENT game
  // there doesn't reliably decide the outcome the same simple way (see
  // totalGames's own doc comment).
  const pointSignificanceFor = (side: RacketSide): 'game' | 'set' | 'match' | null => {
    if (matchWinnerSide || rallyGameOverWinner || teamTieWinner) return null;
    if (scoringMode === 'tennis') {
      const hypo = scoreTennisPoint(tennisState, side, tennisSettings);
      if (hypo.winner === side) return 'match';
      if (hypo.sets.length > tennisState.sets.length) return 'set';
      if (!tennisState.inTiebreak && (hypo.gamesA + hypo.gamesB) > (tennisState.gamesA + tennisState.gamesB)) return 'game';
      return null;
    }
    if (rallySettings.totalGames) return null;
    const hypoPoint = scoreRallyPoint(rallyState, side, rallySettings);
    if (isRallyGameOver(hypoPoint.pointsA, hypoPoint.pointsB, rallySettings) !== side) return null;
    return advanceRallyGame(hypoPoint, rallySettings).winner === side ? 'match' : 'game';
  };
  const pointSigA = pointSignificanceFor('A');
  const pointSigB = pointSignificanceFor('B');
  const pointSigSide: RacketSide | null = pointSigA ? 'A' : pointSigB ? 'B' : null;
  const pointSigLevel = pointSigA ?? pointSigB;
  const pointBadgeLabel = (level: 'game' | 'set' | 'match'): string => {
    if (level === 'match') return 'Match Point';
    if (level === 'set') return 'Set Point';
    // 'game' — sepaktakraw's own scoring unit is officially a "set" (per
    // ISTAF's own rules, cited when the deuceTarget feature was built), so
    // "one point from winning it" reads as Set Point there, never Game
    // Point — badminton/table tennis keep the familiar "Game Point".
    return sport === 'sepaktakraw' ? 'Set Point' : 'Game Point';
  };

  const server: RacketSide = scoringMode === 'tennis' ? tennisState.server : rallyState.server;
  // Manual serving mode — see racketScoring.ts's own serviceMode doc
  // comment: with it on, neither engine ever changes `server` on its own,
  // so this is the ONLY way it ever changes. A plain direct patch (not
  // routed through scoreRallyPoint/scoreTennisPoint) since it isn't a
  // scoring event at all, just a display correction.
  const setServerManual = (side: RacketSide) => {
    if (scoringLocked) return;
    updateWidgetConfig(widgetId, scoringMode === 'tennis' ? { tennisState: { ...tennisState, server: side } } : { rallyState: { ...rallyState, server: side } });
  };

  // Every completed game/set so far, oldest first — kept as the full
  // RacketGameScore/TennisSetScore objects (not just {a,b}) so
  // formatGameResult can add tennis's own "(4)" tiebreak-loser suffix where
  // it applies. Used both by the on-widget results list below AND Save
  // Result's own scoreLog entries just below that.
  const completedGames = scoringMode === 'tennis' ? tennisState.sets : rallyState.games;

  // Every configured vMix target — config.racketVmixTargets (the "+ Add
  // vMix Input" list) when set, else a single synthesized entry from the
  // OLD flat fields (config.vmixInputKey/fieldScoreA/etc) so a widget saved
  // before multi-target existed keeps pushing exactly what it always did.
  const vmixTargets: RacketVmixTarget[] = config.racketVmixTargets?.length
    ? config.racketVmixTargets
    : config.vmixInputKey
      ? [{
          id: 'legacy', inputKey: config.vmixInputKey, inputTitle: config.vmixInputTitle,
          fieldScoreA: config.fieldScoreA, fieldScoreB: config.fieldScoreB,
          fieldTeamA: config.fieldTeamA, fieldTeamB: config.fieldTeamB,
          fieldGamesWonA: config.fieldGamesWonA, fieldGamesWonB: config.fieldGamesWonB,
          fieldTeamAShort: config.fieldTeamAShort, fieldTeamBShort: config.fieldTeamBShort,
          fieldTeamALogo: config.fieldTeamALogo, fieldTeamBLogo: config.fieldTeamBLogo,
          fieldSetLabel: config.fieldSetLabel, setScorePrefix: config.setScorePrefix,
          fieldVenue: config.fieldVenue, fieldDate: config.fieldDate, fieldTime: config.fieldTime,
          fieldCategory: config.fieldCategory, fieldGroup: config.fieldGroup, fieldSport: config.fieldSport,
          setScoreTemplateA: config.setScoreTemplateA, setScoreTemplateB: config.setScoreTemplateB,
          setScoreColorFieldA: config.setScoreColorFieldA, setScoreColorFieldB: config.setScoreColorFieldB,
          setScoreWinColor: config.setScoreWinColor, setScoreLoseColor: config.setScoreLoseColor,
          setScoreDefaultColor: config.setScoreDefaultColor,
          pointWinColorFieldA: config.pointWinColorFieldA, pointWinColorFieldB: config.pointWinColorFieldB,
          pointWinColor: config.pointWinColor, pointDefaultColor: config.pointDefaultColor,
          serverMode: 'text', fieldServerName: config.fieldServerName,
        }]
      : [];

  // Reuses the SAME Set Won Color from Settings → vMix Output for the
  // widget's own on-screen completed-set chips, not just the vMix push —
  // every chip here already represents a DECIDED set (by definition, it's
  // in completedGames), so this just shows every one of them in that same
  // "won" color instead of the winning team's own identity color. Falls
  // back to the team's own color when no Set Won Color is configured, same
  // as before this existed.
  const setColorTarget = vmixTargets.find(t => t.setScoreWinColor);
  const setResultColor = (g: { a: number; b: number }) =>
    setColorTarget?.setScoreWinColor || (g.a > g.b ? teamAColor : teamBColor);

  // ── vMix push — everything this widget tracks, not just the bare running
  // score: team names, current point display, sets/games won tally, who's
  // serving (text name or team logo — see RacketVmixTarget.serverMode), the
  // current set/game label, AND a separate A/B score pair for EVERY set
  // (every completed one, plus the one still being played live) — the
  // operator's own request, so a vMix graphic can show the full set-by-set
  // breakdown, not just the current score. Every field here is optional
  // (only pushed when its own vMix field name is actually configured), and
  // runs once per configured target (see vmixTargets above) — a 'trigger'
  // serverMode target pushes nothing here at all (see the dedicated effect
  // right below instead).
  useEffect(() => {
    if (!client || vmixTargets.length === 0) return;
    const label = scoringMode === 'tennis'
      ? (tennisState.inTiebreak ? String(tennisState.tiebreakA) : tennisPointLabel(tennisState.pointsA, tennisState.pointsB).a)
      : String(rallyState.pointsA);
    const labelB = scoringMode === 'tennis'
      ? (tennisState.inTiebreak ? String(tennisState.tiebreakB) : tennisPointLabel(tennisState.pointsA, tennisState.pointsB).b)
      : String(rallyState.pointsB);
    const matchOver = !!matchWinnerSide || !!teamTieWinner;
    const currentSet = scoringMode === 'tennis' ? { a: tennisState.gamesA, b: tennisState.gamesB } : { a: rallyState.pointsA, b: rallyState.pointsB };
    const allSets = matchOver ? completedGames : [...completedGames, currentSet];
    for (const t of vmixTargets) {
      if (!t.inputKey) continue;
      if (t.fieldScoreA) client.setTextField(t.inputKey, t.fieldScoreA, label);
      if (t.fieldScoreB) client.setTextField(t.inputKey, t.fieldScoreB, labelB);
      // Game/Set/Match Point color — the LIVE score field (fieldScoreA/B
      // above, or a dedicated override) changes color the instant that
      // side reaches a point that would WIN the game/set/match, same
      // detection the on-screen badge (pointSigA/B) already uses, and back
      // to pointDefaultColor the instant it no longer does (point lost,
      // next game, etc.) — not just a one-way color change.
      if (t.pointWinColor || t.pointDefaultColor) {
        const colorFieldA = t.pointWinColorFieldA || t.fieldScoreA;
        const colorFieldB = t.pointWinColorFieldB || t.fieldScoreB;
        if (colorFieldA) {
          const color = pointSigA ? t.pointWinColor : t.pointDefaultColor;
          if (color) client.setTextColor(t.inputKey, colorFieldA, toArgbHex(color));
        }
        if (colorFieldB) {
          const color = pointSigB ? t.pointWinColor : t.pointDefaultColor;
          if (color) client.setTextColor(t.inputKey, colorFieldB, toArgbHex(color));
        }
      }
      if (t.fieldTeamA && config.teamAName != null) client.setTextField(t.inputKey, t.fieldTeamA, config.teamAName);
      if (t.fieldTeamB && config.teamBName != null) client.setTextField(t.inputKey, t.fieldTeamB, config.teamBName);
      if (t.fieldTeamAShort) client.setTextField(t.inputKey, t.fieldTeamAShort, config.teamAShortName ?? '');
      if (t.fieldTeamBShort) client.setTextField(t.inputKey, t.fieldTeamBShort, config.teamBShortName ?? '');
      if (t.fieldTeamALogo) client.setImageField(t.inputKey, t.fieldTeamALogo, config.teamALogo || transparentLogoUrl());
      if (t.fieldTeamBLogo) client.setImageField(t.inputKey, t.fieldTeamBLogo, config.teamBLogo || transparentLogoUrl());
      if (t.fieldGamesWonA) client.setTextField(t.inputKey, t.fieldGamesWonA, String(gamesWonA));
      if (t.fieldGamesWonB) client.setTextField(t.inputKey, t.fieldGamesWonB, String(gamesWonB));
      if (t.serverMode === 'image') {
        if (t.fieldServerImage) {
          const icon = server === 'A' ? t.serverIconA : t.serverIconB;
          client.setImageField(t.inputKey, t.fieldServerImage, icon || transparentLogoUrl());
        }
      } else if (t.serverMode !== 'trigger' && t.fieldServerName) {
        client.setTextField(t.inputKey, t.fieldServerName, (server === 'A' ? config.teamAName : config.teamBName) ?? '');
      }
      if (t.fieldSetLabel) {
        const unit = scoringMode === 'tennis' || sport === 'sepaktakraw' ? 'Set' : 'Game';
        client.setTextField(t.inputKey, t.fieldSetLabel, matchOver ? 'Final' : `${unit} ${completedGames.length + 1}`);
      }
      if (t.fieldVenue) client.setTextField(t.inputKey, t.fieldVenue, config.venue ?? '');
      if (t.fieldDate) client.setTextField(t.inputKey, t.fieldDate, config.scheduledDate ?? '');
      if (t.fieldTime) client.setTextField(t.inputKey, t.fieldTime, config.scheduledTime ?? '');
      if (t.fieldCategory) client.setTextField(t.inputKey, t.fieldCategory, config.category ?? '');
      if (t.fieldGroup) client.setTextField(t.inputKey, t.fieldGroup, config.group ?? '');
      if (t.fieldSport) client.setTextField(t.inputKey, t.fieldSport, SPORT_LABELS[sport] ?? '');
      // Per-set score — one A/B pair per set, oldest first. Reserves a slot
      // for EVERY set this match could possibly reach (gamesToWin*2-1 — a
      // best-of-3 always gets 3, a best-of-5 always gets 5), not just
      // however many have been played so far — a GT template built with a
      // fixed number of set boxes would otherwise have no field at all to
      // bind box 3 to until the 3rd set actually started, and no clean way
      // to tell "not reached yet" apart from simply unconfigured. A set not
      // yet reached pushes blank. The one still being played right now
      // (already in allSets, not yet in completedGames) uses the current
      // running score (points for a rally sport, games-within-the-set for
      // tennis), so it shows live instead of only once it's over.
      // Templates (setScoreTemplateA/B) take over from the legacy fixed-
      // shape prefix whenever either is set — see RacketVmixTarget's own
      // doc comment on why "{prefix}{n}A.Text" couldn't cover every real
      // naming convention (team letter isn't always right before the set
      // number). Falls back to the old prefix convention when neither
      // template is set, for a target still configured the old way.
      const templateA = t.setScoreTemplateA || t.setScoreTemplateB
        ? (t.setScoreTemplateA ?? '')
        : (t.setScorePrefix ? `${t.setScorePrefix}{n}A.Text` : '');
      const templateB = t.setScoreTemplateA || t.setScoreTemplateB
        ? (t.setScoreTemplateB ?? '')
        : (t.setScorePrefix ? `${t.setScorePrefix}{n}B.Text` : '');
      if (templateA || templateB) {
        const maxSets = Math.max(allSets.length, (config.gamesToWin ?? 2) * 2 - 1);
        // Same Color Field override fireSetResultActions uses — blank means
        // "color the score Text field itself" (SetTextColour, no separate
        // Colour-type GT element required).
        const colorFieldA = t.setScoreColorFieldA || templateA;
        const colorFieldB = t.setScoreColorFieldB || templateB;
        for (let i = 0; i < maxSets; i++) {
          const g = allSets[i];
          if (templateA) client.setTextField(t.inputKey, expandSetTemplate(templateA, i + 1), g ? String(g.a) : '');
          if (templateB) client.setTextField(t.inputKey, expandSetTemplate(templateB, i + 1), g ? String(g.b) : '');
          // Default color for every NOT-YET-DECIDED slot (the set still
          // being played right now, and any slot not reached yet) —
          // completed sets are never touched here, they keep whatever
          // win/lose color fireSetResultActions already gave them the
          // instant they concluded. Resets a freshly loaded/reset match's
          // boxes back to neutral instead of leaving a PREVIOUS match's
          // win/lose colors behind on them.
          if (t.setScoreDefaultColor && i >= completedGames.length) {
            if (colorFieldA) client.setTextColor(t.inputKey, expandSetTemplate(colorFieldA, i + 1), toArgbHex(t.setScoreDefaultColor));
            if (colorFieldB) client.setTextColor(t.inputKey, expandSetTemplate(colorFieldB, i + 1), toArgbHex(t.setScoreDefaultColor));
          }
        }
        // Clear any leftover set fields beyond maxSets — e.g. a best-of-5
        // match loaded after a previous best-of-7 one left stale "…s6/s7"
        // fields behind otherwise. Never touches any of this target's OTHER
        // explicitly-configured fields (Sets Won, Team, Server, Set Label,
        // …) even if one happens to also match the per-set pattern (e.g. a
        // "SetsWonA" field could coincidentally look like a numbered set
        // field to the regex) — those are never "stale", they're always
        // meant to hold whatever they currently do, including a real "0".
        const ownFieldNames = new Set([
          t.fieldScoreA, t.fieldScoreB, t.fieldTeamA, t.fieldTeamB, t.fieldTeamAShort, t.fieldTeamBShort,
          t.fieldGamesWonA, t.fieldGamesWonB, t.fieldSetLabel, t.fieldServerName,
        ].filter((n): n is string => !!n));
        const vmixInput = vmixState?.inputs?.find(inp => inp.key === t.inputKey);
        if (vmixInput) {
          const reA = templateA ? setTemplateStaleRegex(templateA) : null;
          const reB = templateB ? setTemplateStaleRegex(templateB) : null;
          for (const field of vmixInput.textFields) {
            if (ownFieldNames.has(field.name)) continue;
            const mA = reA?.exec(field.name);
            const mB = reB?.exec(field.name);
            const n = mA ? parseInt(mA[1], 10) : mB ? parseInt(mB[1], 10) : NaN;
            if (!isNaN(n) && n > maxSets) client.setTextField(t.inputKey, field.name, '');
          }
        }
      }
      // Starting lineup — one Name/Jersey/Position triple per starter slot
      // (1-based), same template + stale-clear approach as the per-set
      // score block above, just reserving config.playerCount slots instead
      // of a max-sets count. Any slot past the actual roster count (or
      // simply never filled in) pushes blank, same "not reached yet" reasoning.
      const playerTemplates = [
        t.playerNameTemplateA, t.playerJerseyTemplateA, t.playerPositionTemplateA,
        t.playerNameTemplateB, t.playerJerseyTemplateB, t.playerPositionTemplateB,
      ].filter((s): s is string => !!s);
      if (playerTemplates.length) {
        const maxPlayers = Math.max(config.playerCount ?? 1, 1);
        const startersA = startersFor('A');
        const startersB = startersFor('B');
        for (let i = 0; i < maxPlayers; i++) {
          const pa = startersA[i];
          const pb = startersB[i];
          if (t.playerNameTemplateA) client.setTextField(t.inputKey, expandSetTemplate(t.playerNameTemplateA, i + 1), pa?.name ?? '');
          if (t.playerJerseyTemplateA) client.setTextField(t.inputKey, expandSetTemplate(t.playerJerseyTemplateA, i + 1), pa?.jerseyNo ?? '');
          if (t.playerPositionTemplateA) client.setTextField(t.inputKey, expandSetTemplate(t.playerPositionTemplateA, i + 1), pa?.position ?? '');
          if (t.playerNameTemplateB) client.setTextField(t.inputKey, expandSetTemplate(t.playerNameTemplateB, i + 1), pb?.name ?? '');
          if (t.playerJerseyTemplateB) client.setTextField(t.inputKey, expandSetTemplate(t.playerJerseyTemplateB, i + 1), pb?.jerseyNo ?? '');
          if (t.playerPositionTemplateB) client.setTextField(t.inputKey, expandSetTemplate(t.playerPositionTemplateB, i + 1), pb?.position ?? '');
        }
        const playerOwnFieldNames = new Set([
          t.fieldScoreA, t.fieldScoreB, t.fieldTeamA, t.fieldTeamB, t.fieldTeamAShort, t.fieldTeamBShort,
          t.fieldGamesWonA, t.fieldGamesWonB, t.fieldSetLabel, t.fieldServerName,
        ].filter((n): n is string => !!n));
        const playerVmixInput = vmixState?.inputs?.find(inp => inp.key === t.inputKey);
        if (playerVmixInput) {
          for (const template of playerTemplates) {
            const re = setTemplateStaleRegex(template);
            for (const field of playerVmixInput.textFields) {
              if (playerOwnFieldNames.has(field.name)) continue;
              const m = re.exec(field.name);
              const n = m ? parseInt(m[1], 10) : NaN;
              if (!isNaN(n) && n > maxPlayers) client.setTextField(t.inputKey, field.name, '');
            }
          }
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    config.racketVmixTargets, config.vmixInputKey, config.fieldScoreA, config.fieldScoreB, config.fieldTeamA, config.fieldTeamB,
    config.fieldGamesWonA, config.fieldGamesWonB, config.fieldServerName, config.fieldSetLabel, config.setScorePrefix, config.gamesToWin,
    config.teamAName, config.teamBName, config.teamAShortName, config.teamBShortName, config.teamALogo, config.teamBLogo, rallyState.pointsA, rallyState.pointsB, rallyState.games,
    tennisState.pointsA, tennisState.pointsB, tennisState.tiebreakA, tennisState.tiebreakB, tennisState.inTiebreak,
    tennisState.gamesA, tennisState.gamesB, tennisState.sets, gamesWonA, gamesWonB, server, matchWinnerSide, teamTieWinner,
    config.startersA, config.startersB, config.playerCount, pointSigA, pointSigB,
    config.venue, config.scheduledDate, config.scheduledTime, config.category, config.group, config.sport,
  ]);

  // ── Server triggers — any target with serverMode 'trigger' fires the
  // instant the server actually CHANGES to/from a side, rather than pushing
  // a field. 'simple' (default, serverTriggerMode) just calls vMix's own
  // SetTextVisibleOn/Off or SetImageVisibleOn/Off directly on each side's
  // own picked input+field (serverVisible*A/B) — show whoever just started
  // serving, hide whoever just stopped. 'advanced' instead fires one of 4
  // full ActionListEditor action lists (serverShowActionsA/B etc, any vMix
  // or App function) for anything beyond a plain visibility toggle.
  // lastServerByTarget tracks what was last fired per target id so this
  // only ever fires on a genuine transition (including the very first
  // evaluation after load, so the graphic matches reality immediately
  // instead of waiting for the NEXT change) — never repeatedly for the same
  // server value across unrelated re-renders.
  const lastServerByTarget = useRef<Record<string, RacketSide | undefined>>({});
  useEffect(() => {
    if (!client) return;
    // Debounced — a quick Undo/Swap Last Point correction, or simply this
    // widget being rendered in more than one window at once (editor canvas
    // + a separate CG output window, both watching the same match), can
    // produce a rapid, transient flip of `server` before it settles on its
    // real value. Firing a vMix call for every one of those looked like the
    // visibility trigger toggling on/off "randomly" instead of cleanly
    // switching once per actual serve change — waiting a beat and only
    // acting on whatever `server` settled on collapses that into one call.
    const timer = setTimeout(() => {
      for (const t of vmixTargets) {
        if (t.serverMode !== 'trigger') continue;
        if (lastServerByTarget.current[t.id] === server) continue;
        lastServerByTarget.current[t.id] = server;
        if ((t.serverTriggerMode ?? 'simple') === 'simple') {
          const visFn = (type: 'text' | 'image' | undefined, on: boolean) =>
            type === 'image' ? (on ? 'SetImageVisibleOn' : 'SetImageVisibleOff') : (on ? 'SetTextVisibleOn' : 'SetTextVisibleOff');
          const setVisible = (field: string | undefined, type: 'text' | 'image' | undefined, on: boolean) => {
            if (!field) return;
            client.sendFunction(visFn(type, on), { Input: t.inputKey, SelectedName: field });
          };
          if (server === 'A') {
            setVisible(t.serverVisibleFieldA, t.serverVisibleTypeA, true);
            setVisible(t.serverVisibleFieldB, t.serverVisibleTypeB, false);
          } else {
            setVisible(t.serverVisibleFieldB, t.serverVisibleTypeB, true);
            setVisible(t.serverVisibleFieldA, t.serverVisibleTypeA, false);
          }
        } else {
          const showActions = server === 'A' ? t.serverShowActionsA : t.serverShowActionsB;
          const hideActions = server === 'A' ? t.serverHideActionsB : t.serverHideActionsA;
          if (showActions?.length) runActions(showActions);
          if (hideActions?.length) runActions(hideActions);
        }
      }
    }, 200);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, config.racketVmixTargets, client]);

  // Match Report — config.pointLog (see scorePoint's own doc comment)
  // grouped by game number, oldest game and oldest point within it first,
  // so expanding it reads top-to-bottom exactly like the match was played:
  // "1-0, 1-1, 2-1, … , 21-15" for Game 1, then Game 2 starting back at
  // 0-0, and so on including whichever game is still IN PROGRESS.
  const pointLog: { game: number; a: number; b: number; scorer: RacketSide }[] = config.pointLog ?? [];
  const groupByGame = (log: typeof pointLog | undefined): [number, typeof pointLog][] => {
    const byGame = new Map<number, typeof pointLog>();
    // Defensive: a reguHistory entry saved before pointLog was added to its
    // shape (or any other stale/hand-edited config) won't have this field —
    // treat it as "no point-by-point detail for that regu" rather than
    // crashing the whole report.
    for (const entry of log ?? []) {
      if (!byGame.has(entry.game)) byGame.set(entry.game, []);
      byGame.get(entry.game)!.push(entry);
    }
    return [...byGame.entries()].sort((x, y) => x[0] - y[0]);
  };
  const reportGames: [number, typeof pointLog][] = groupByGame(pointLog);
  // Team Event's own Match Report — every regu's full point-by-point trail,
  // oldest regu first, each regu's own games grouped exactly like a plain
  // single-regu match (reportGames above), just labeled and separated by
  // WHICH regu they belong to. Past regu come from reguHistory's own saved
  // pointLog (see confirmReguWin); the still-in-progress current regu comes
  // from live config.pointLog, same source reportGames above already uses.
  // durations carried the same way (see confirmReguWin's own doc comment).
  const reportRegus: { regu: number; games: [number, typeof pointLog][]; durations: number[] }[] = teamEventOn
    ? [...reguHistory.map(r => ({ regu: r.regu, games: groupByGame(r.pointLog), durations: r.gameDurationsMs ?? [] })), { regu: currentRegu, games: reportGames, durations: config.gameDurationsMs ?? [] }]
    : [];
  // One game's own 2-row block (game number + both teams' running score per
  // point) — shared by the plain single-regu report AND each regu's own
  // block in the Team Event report below, so both stay pixel-identical.
  // `durationMs` is that specific game's own recorded time (see the Game
  // Timer feature — undefined/skipped for a game nobody started a timer
  // for), shown right under the game number since there's no other spare
  // column for it in this per-point layout.
  const renderReportGame = (gameNum: number, entries: typeof pointLog, gi: number, durationMs?: number) => (
    <Fragment key={gameNum}>
      <tr className={gi > 0 ? 'wgt-racket-report-row--sep' : undefined}>
        <td className="wgt-racket-report-gamecell" rowSpan={2}>
          <div>{gameNum}</div>
          {durationMs != null && <div className="wgt-racket-report-duration">{formatDuration(durationMs)}</div>}
        </td>
        <td className="wgt-racket-report-teamcell" style={{ color: teamAColor }}>{config.teamAName || 'Team A'}</td>
        {entries.map((e, i) => (
          <td key={i} className="wgt-racket-report-scorecell" style={e.scorer === 'A' ? { color: teamAColor, fontWeight: 800 } : undefined}>{e.a}</td>
        ))}
      </tr>
      <tr>
        <td className="wgt-racket-report-teamcell" style={{ color: teamBColor }}>{config.teamBName || 'Team B'}</td>
        {entries.map((e, i) => (
          <td key={i} className="wgt-racket-report-scorecell" style={e.scorer === 'B' ? { color: teamBColor, fontWeight: 800 } : undefined}>{e.b}</td>
        ))}
      </tr>
    </Fragment>
  );

  // ── Save Result — games/sets won become scoreA/scoreB (same convention
  // every other sport's goals already use), each completed game/set also
  // recorded as its own scoreLog entry so the detailed breakdown (e.g.
  // "21-15", "18-21") isn't lost even though SavedMatchResult has no
  // dedicated per-set field of its own. ──────────────────────────────────
  const resultConfig = {
    ...config,
    scoreA: gamesWonA, scoreB: gamesWonB,
    linkedTournamentId: effTournamentId,
    scoreLog: completedGames.map((g, i) => ({
      team: (g.a > g.b ? 'A' : 'B') as 'A' | 'B',
      action: `Game ${i + 1}`, points: 1, period: i + 1,
      timeStr: formatGameResult(g),
    })),
    // Total RALLY points across every set — distinct from scoreA/scoreB
    // (sets won) — see SavedMatchResult.racketPointsA/B's own doc comment,
    // e.g. sepaktakraw's official standings PW/PL columns. Only sepaktakraw
    // standings ever read this back (computeStandingsCore in
    // TournamentManager.tsx) — skipped for badminton/table tennis/tennis so
    // their results don't carry an unused field.
    ...(sport === 'sepaktakraw' ? {
      racketPointsA: completedGames.reduce((sum, g) => sum + g.a, 0),
      racketPointsB: completedGames.reduce((sum, g) => sum + g.b, 0),
    } : {}),
  };

  const commitSaveResult = (existingId?: string) => {
    const patch = buildResultFromConfig(resultConfig);
    if (existingId) updateResult(existingId, patch);
    else addResult(patch);
    updateWidgetConfig(widgetId, { lastSavedSignature: computeMatchSignature(resultConfig) });
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  };

  const handleSaveResult = () => {
    const dup = findDuplicateResult(savedResults, resultConfig);
    if (dup && dup.id !== duplicateResultId) { setDuplicateResultId(dup.id); return; }
    commitSaveResult(dup?.id);
    setDuplicateResultId(null);
  };

  // Auto-saves the just-finished match once, the same "don't lose a result
  // to an operator forgetting to press Save" guard ScoreboardWidget.tsx
  // uses before letting a live score get overwritten.
  useEffect(() => {
    if (!matchWinnerSide) return;
    guardScoreboardOverwrite(resultConfig, addResult);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchWinnerSide]);

  // ── Next Fixture — "Regu" format only (teamEventOn off). A Team Regu tie
  // already has its own "next" step (Confirm Regu Win advances to the next
  // regu ON THIS SAME BOARD), but a plain single-regu match has nowhere to
  // go once it's over except back to the Schedule tab — this lets the
  // operator advance straight to whatever's scheduled next without leaving
  // the board. Found by walking the SAME tournament's schedule (already
  // kept in sortMatches order by the store) to the entry right after this
  // board's own currently-loaded fixture — scoped to the SAME venue/court
  // as that fixture, when one's set, so a multi-court tournament's board
  // only ever queues up its own court's matches, never jumps to a
  // different court's. No venue on the current fixture (single-court, or
  // venues aren't in use for this tournament) = no filtering, same as before.
  const nextFixture = (() => {
    // Mid-tie (teamEventOn with the tie not yet decided) has its own "next"
    // step — Confirm/Next Regu advances to the next regu ON THIS SAME
    // board, same opponents — so this is never relevant there. Once the
    // WHOLE tie is decided (teamTieWinner set) it's exactly as relevant as
    // a plain Regu match being over, so it's still computed in that case.
    if ((teamEventOn && !teamTieWinner) || !config.linkedScheduleMatchId || !effTournamentId) return undefined;
    const currentFixture = scheduleMatches.find(m => m.id === config.linkedScheduleMatchId);
    let tournamentFixtures = scheduleMatches.filter(m => m.tournamentId === effTournamentId);
    if (currentFixture?.venue) tournamentFixtures = tournamentFixtures.filter(m => m.venue === currentFixture.venue);
    const idx = tournamentFixtures.findIndex(m => m.id === config.linkedScheduleMatchId);
    return idx >= 0 ? tournamentFixtures[idx + 1] : undefined;
  })();
  const loadNextFixture = () => {
    if (!nextFixture) return;
    // Protects the outgoing match exactly like Send to Scoreboard's own
    // guard does: auto-saves it if it was never saved.
    if (!guardScoreboardOverwrite(resultConfig, addResult)) return;
    if (config.linkedScheduleMatchId) markFixtureCompleted(config.linkedScheduleMatchId);
    // Same "Play Full Sets in Group Stage" tournament setting Send to
    // Scoreboard respects (see RacketSportSettings.forceFullSetsInGroupStage)
    // — a knockout fixture never gets it regardless of the setting.
    const nextTournament = tournaments.find(t => t.id === nextFixture.tournamentId);
    const rsGroup = nextTournament ? (nextTournament.settings ?? SPORT_DEFAULTS[nextTournament.sport]).racketScoring ?? SPORT_DEFAULTS[nextTournament.sport].racketScoring : undefined;
    const isGroupStage = !extractKnockoutStage(nextFixture) && nextFixture.group !== '3rd Place';
    updateWidgetConfig(widgetId, buildLoadMatchPatchRacket(nextFixture, { forceFullSets: isGroupStage && !!rsGroup?.forceFullSetsInGroupStage, gamesToWin: rsGroup?.gamesToWin }));
    markFixtureSent(nextFixture.id);
  };

  // Shortcut tab (WidgetConfigPanel.tsx) dispatch — a hotkey bound to one of
  // RACKET_SHORTCUT_ACTIONS routes through App.RacketAction (canvasStore.ts)
  // which just drops { action, nonce } into config.racketPendingCommand;
  // this is the OTHER end, watching for that and calling the matching LOCAL
  // function directly — same functions the widget's own on-screen buttons
  // already call, so a hotkey behaves byte-for-byte like a real click,
  // including every guard (scoringLocked, no-op when nothing to confirm,
  // etc.) those functions already have. lastHandledNonce (a ref, not state)
  // makes sure each command fires exactly once even though the SAME action
  // fired twice in a row would otherwise look like "no change" to React.
  const lastRacketCommandNonce = useRef<string | undefined>(undefined);
  useEffect(() => {
    const cmd = config.racketPendingCommand as { action?: string; nonce?: string } | undefined;
    if (!cmd?.nonce || cmd.nonce === lastRacketCommandNonce.current) return;
    lastRacketCommandNonce.current = cmd.nonce;
    switch (cmd.action) {
      case 'scoreA': scorePoint('A'); break;
      case 'scoreB': scorePoint('B'); break;
      case 'adjustMinusA': adjustPoint('A', -1); break;
      case 'adjustMinusB': adjustPoint('B', -1); break;
      case 'undo': undo(); break;
      case 'swapLastPoint': swapLastPoint(); break;
      case 'swapServe': setServerManual(server === 'A' ? 'B' : 'A'); break;
      case 'startTimer': if (!config.gameStartedAt) startGameTimer(); break;
      case 'startNextGame': startNextGame(); break;
      case 'newMatch': newMatch(); break;
      case 'reset': handleResetClick(); break;
      case 'nextFixture': loadNextFixture(); break;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.racketPendingCommand]);

  // Live game-timer tick — see setTimerTick's own doc comment. Only ticks
  // while a timer is actually RUNNING (started, not yet frozen by the game
  // it's timing having ended) so a finished/never-started game's display
  // stays perfectly still rather than needlessly re-rendering every second.
  useEffect(() => {
    if (!config.gameStartedAt || config.gameEndedAt) return;
    const id = setInterval(() => setTimerTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [config.gameStartedAt, config.gameEndedAt]);

  const teamPicker = (side: RacketSide) => (
    <TeamPicker
      onPick={picked => handleTeamPick(side, picked)}
      current={{
        name: side === 'A' ? config.teamAName : config.teamBName,
        shortName: side === 'A' ? config.teamAShortName : config.teamBShortName,
        color: side === 'A' ? teamAColor : teamBColor,
        logo: side === 'A' ? config.teamALogo : config.teamBLogo,
      }}
      tournamentId={effTournamentId}
      category={config.category}
    />
  );

  // Starters — one small text input per playerCount slot, each freely
  // editable by hand regardless of whether a team's linked. Subs — a
  // wrapping row of removable chips plus its own "+ sub" text input
  // (Enter to add). Roster — collapsed by default (this side's own full
  // SavedTeam player list is rarely needed once starters are set), toggled
  // open via the small people-icon button; each roster row's "+" adds
  // straight to the next empty starter slot or, once starters are full,
  // to subs (see addFromRoster above).
  const playersSection = (side: RacketSide, color: string) => {
    const roster = rosterFor(side);
    const starters = startersFor(side);
    const subs = subsFor(side);
    const open = rosterOpen[side];
    return (
      <div className="wgt-racket-players-section" onClick={e => e.stopPropagation()}>
        <div className="wgt-racket-starters">
          {starters.map((entry, i) => (
            <div key={i} className="wgt-racket-starter-row">
              <input
                className="wgt-score-mshort wgt-racket-players-input"
                style={{ color }}
                value={entry.name}
                placeholder={`Player ${i + 1}`}
                title="Who's actually playing this match"
                onChange={e => setStarterSlot(side, i, { name: e.target.value })}
              />
              <div className="wgt-racket-starter-meta">
                <input
                  className="wgt-racket-jersey-input"
                  style={{ color }}
                  value={entry.jerseyNo ?? ''}
                  placeholder="#"
                  title="Jersey number"
                  onChange={e => setStarterSlot(side, i, { jerseyNo: e.target.value })}
                />
                <input
                  className="wgt-racket-position-input"
                  style={{ color }}
                  value={entry.position ?? ''}
                  placeholder="Position"
                  title="Position"
                  onChange={e => setStarterSlot(side, i, { position: e.target.value })}
                />
              </div>
            </div>
          ))}
        </div>
        {subs.length > 0 && (
          <div className="wgt-racket-subs">
            {subs.map(name => (
              <span key={name} className="wgt-racket-sub-chip" style={{ borderColor: color, color }}>
                {name}
                <button onClick={() => removeSub(side, name)} title="Remove sub">×</button>
              </span>
            ))}
          </div>
        )}
        <input
          className="wgt-racket-sub-input"
          placeholder="+ Sub (Enter)"
          onKeyDown={e => {
            if (e.key !== 'Enter') return;
            const val = (e.target as HTMLInputElement).value.trim();
            if (val) addSub(side, val);
            (e.target as HTMLInputElement).value = '';
          }}
        />
        {roster.length > 0 && (
          <>
            <button className="wgt-racket-roster-toggle" onClick={() => setRosterOpen(o => ({ ...o, [side]: !o[side] }))} title="Show roster">
              <Users size={10} strokeWidth={2} /> Roster ({roster.length}) {open ? <ChevronUp size={10} strokeWidth={2} /> : <ChevronDown size={10} strokeWidth={2} />}
            </button>
            {open && (
              <div className="wgt-racket-roster-list">
                {roster.map(p => (
                  <div key={p.id} className="wgt-racket-roster-row">
                    <span className="wgt-racket-roster-name">{formatPlayerEntry(p)}</span>
                    {/* Team Event only — plain quick-add elsewhere still just
                       fills the CURRENT regu's starters (or benches once
                       full), same as always. Here, a squad has several
                       regu to plan for, so this becomes a target picker:
                       the current regu's own starters, any FUTURE regu
                       (queued — see reguDraftsFor's own doc comment, goes
                       live automatically once that regu's own turn comes
                       up), or straight to Subs. */}
                    {teamEventOn ? (
                      <select
                        className="wgt-racket-roster-add-select"
                        value=""
                        title="Add to…"
                        onChange={e => {
                          const val = e.target.value;
                          if (val === 'starters') addFromRoster(side, p);
                          else if (val === 'subs') addSub(side, p.name);
                          else if (val) addFromRosterTo(side, p, Number(val));
                          e.target.value = '';
                        }}
                      >
                        <option value="" disabled>+</option>
                        <option value="starters">Starters (Regu {currentRegu})</option>
                        {Array.from({ length: Math.max(0, maxRegu - currentRegu) }, (_, i) => currentRegu + 1 + i).map(n => (
                          <option key={n} value={n}>Queue for Regu {n}</option>
                        ))}
                        <option value="subs">Subs</option>
                      </select>
                    ) : (
                      <button onClick={() => addFromRoster(side, p)} title="Add to starters (or subs, once starters are full)">+</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {/* Queued lineups — any future regu the roster's own target picker
           above has staged a player into (see reguDraftsFor's own doc
           comment). Fully editable here too, same jersey/position fields
           as the live Starters block, so a wrong quick-add doesn't need
           clearing and redoing from scratch. Goes live automatically (and
           disappears from here) the moment that regu's own turn comes up —
           see confirmReguWin. */}
        {teamEventOn && Object.entries(reguDraftsFor(side)).filter(([, arr]) => Array.isArray(arr) && arr.some((e: RacketPlayerEntry) => e?.name)).map(([reguStr]) => {
          const regu = Number(reguStr);
          const draft = draftStartersFor(side, regu);
          return (
            <div key={regu} className="wgt-racket-draft-block">
              <div className="wgt-racket-draft-header">
                <span>Queued — Regu {regu}</span>
                <button onClick={() => clearDraftRegu(side, regu)} title="Clear this queued lineup">×</button>
              </div>
              <div className="wgt-racket-starters">
                {draft.map((entry, i) => (
                  <div key={i} className="wgt-racket-starter-row">
                    <input
                      className="wgt-score-mshort wgt-racket-players-input"
                      style={{ color }}
                      value={entry.name}
                      placeholder={`Player ${i + 1}`}
                      onChange={e => setDraftSlot(side, regu, i, { name: e.target.value })}
                    />
                    <div className="wgt-racket-starter-meta">
                      <input
                        className="wgt-racket-jersey-input"
                        style={{ color }}
                        value={entry.jerseyNo ?? ''}
                        placeholder="#"
                        title="Jersey number"
                        onChange={e => setDraftSlot(side, regu, i, { jerseyNo: e.target.value })}
                      />
                      <input
                        className="wgt-racket-position-input"
                        style={{ color }}
                        value={entry.position ?? ''}
                        placeholder="Position"
                        title="Position"
                        onChange={e => setDraftSlot(side, regu, i, { position: e.target.value })}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const pointLabels = scoringMode === 'tennis'
    ? (tennisState.inTiebreak ? { a: String(tennisState.tiebreakA), b: String(tennisState.tiebreakB) } : tennisPointLabel(tennisState.pointsA, tennisState.pointsB))
    : { a: String(rallyState.pointsA), b: String(rallyState.pointsB) };
  const showDeuceBadge = scoringMode === 'tennis' && !tennisState.inTiebreak && isTennisDeuce(tennisState.pointsA, tennisState.pointsB);

  // Direct score editing — click/type straight into the live score to
  // correct it, same underlying adjustPoint/setPointValue as the -1 button.
  // Only offered when the displayed value IS the raw point count: rally
  // sports always (pointLabels is just String(pointsA/B)), tennis only
  // while inTiebreak (tiebreakA/B, also a raw count). Tennis's own regular
  // game score is a DERIVED label (0/15/30/40/Deuce/Ad) with no safe 1:1
  // mapping back to a typed number, so that case stays a plain read-only
  // span — the -1/+1 buttons still work there regardless, since those go
  // through the raw pointsA/B either way.
  const scoreEditable = (scoringMode === 'rally' || tennisState.inTiebreak) && !scoringLocked;
  const scoreDisplay = (side: RacketSide, className: string, style?: React.CSSProperties) => scoreEditable ? (
    <input
      type="number" min={0} className={`${className} wgt-score-num--editable`} style={style}
      value={currentPointValue(side)}
      onClick={e => e.stopPropagation()}
      onChange={e => setPointValue(side, e.target.value)}
    />
  ) : (
    <span className={className} style={style}>{side === 'A' ? pointLabels.a : pointLabels.b}</span>
  );

  // True once the match has actually moved past 0-0 — a real match needs
  // someone (a coin toss, a shuttle spin) to decide who serves FIRST, which
  // isn't something either serving rule (rally-winner/alternate, or
  // tennis's own fixed alternation) has an opinion on — there's no "winner"
  // yet to hand it to. So regardless of serviceMode, the server indicator
  // stays clickable for BOTH sides until the first point actually lands;
  // after that it reverts to Auto's own rule (read-only) or Manual (always
  // clickable), exactly as before.
  const matchStarted = scoringMode === 'tennis'
    ? (tennisState.pointsA > 0 || tennisState.pointsB > 0 || tennisState.gamesA > 0 || tennisState.gamesB > 0
       || tennisState.tiebreakA > 0 || tennisState.tiebreakB > 0 || tennisState.sets.length > 0)
    : (rallyState.pointsA > 0 || rallyState.pointsB > 0 || rallyState.games.length > 0);
  const canPickServe = (serviceMode === 'manual' || !matchStarted) && !scoringLocked;

  // Always renders a same-sized button for BOTH sides — even when read-only
  // and not currently serving, it stays in the DOM at full size with
  // visibility:hidden rather than being conditionally unmounted, so the
  // score row's own layout never shifts by a pixel as serve moves between
  // sides (a fixed "serve gap" either side of the score, not a slot that
  // pops in and out). See the wgt-racket-serve-slot wrapper at the call
  // site for the other half of that guarantee.
  const serverControl = (side: RacketSide) => {
    const isServing = server === side;
    const visible = isServing || canPickServe;
    return (
      <button
        className={`wgt-racket-server-dot${canPickServe ? ' wgt-racket-server-dot--manual' : ''}${isServing ? ' wgt-racket-server-dot--active' : ''}`}
        style={{ visibility: visible ? 'visible' : 'hidden' }}
        onClick={e => { if (!canPickServe) return; e.stopPropagation(); setServerManual(side); }}
        title={!canPickServe ? (isServing ? 'Serving' : undefined)
          : isServing ? 'Serving — click to move serve to the other side'
          : matchStarted ? 'Click to set this side as serving' : "Click to choose who serves first"}
      ><Radio size={18} strokeWidth={2.5} /></button>
    );
  };

  // Match-over banner / live point buttons — identical regardless of
  // layoutStyle, so computed once here and reused by all three below rather
  // than duplicated in each.
  // Match-over banner — null once there's nothing to announce (still mid-
  // point), so each layout below can put the SCORING buttons wherever makes
  // sense for its own arrangement (see pointButtonsRow) while still sharing
  // this one banner whenever there IS something to confirm/announce.
  const matchOverBanner = (
    teamTieWinner ? (
      <div className="wgt-racket-match-over">
        <span>{teamTieWinner === 'A' ? (config.teamAName || 'Team A') : (config.teamBName || 'Team B')} wins the Team Event ({regusWonA}-{regusWonB})</span>
        <div className="wgt-racket-match-over-actions">
          {/* "New Match" (plain reset, same two teams) stays available
             regardless of nextFixture — only ADDS "Next Match" alongside it
             when there's somewhere to advance to, never replaces it, so a
             genuine reset is never one click away from accidentally loading
             a different fixture's teams instead. */}
          <button className="wgt-racket-newmatch-btn" onClick={newMatch}><RotateCcw size={12} strokeWidth={2} /> New Match</button>
          {nextFixture && (
            <button className="wgt-racket-newmatch-btn" onClick={loadNextFixture}><ArrowRight size={12} strokeWidth={2} /> Next Match</button>
          )}
        </div>
      </div>
    ) : matchWinnerSide ? (
      <div className="wgt-racket-match-over">
        <span>{matchWinnerSide === 'A' ? (config.teamAName || 'Team A') : (config.teamBName || 'Team B')} wins the match</span>
        <div className="wgt-racket-match-over-actions">
          {teamEventOn ? (
            <button className="wgt-racket-newmatch-btn" onClick={confirmReguWin}><RotateCcw size={12} strokeWidth={2} /> Next Regu</button>
          ) : (
            <>
              <button className="wgt-racket-newmatch-btn" onClick={newMatch}><RotateCcw size={12} strokeWidth={2} /> New Match</button>
              {nextFixture && (
                <button className="wgt-racket-newmatch-btn" onClick={loadNextFixture}><ArrowRight size={12} strokeWidth={2} /> Next Match</button>
              )}
            </>
          )}
        </div>
      </div>
    ) : rallyGameOverWinner ? (
      <div className="wgt-racket-match-over">
        <span>{rallyGameOverWinner === 'A' ? (config.teamAName || 'Team A') : (config.teamBName || 'Team B')} wins the {sport === 'sepaktakraw' ? 'set' : 'game'}</span>
        <button className="wgt-racket-newmatch-btn" onClick={startNextGame}>{rallyWouldWinMatch ? 'Confirm Match Win' : `Start Next ${sport === 'sepaktakraw' ? 'Set' : 'Game'}`}</button>
      </div>
    ) : null
  );
  // Vertical layout's own arrangement — both +1 buttons centered together
  // either side of Undo, exactly as before this turn's horizontal/lower-
  // third layouts (which each place their OWN +1 buttons differently, right
  // next to each side's own row instead) were added.
  const pointButtonsRow = (
    <div className="wgt-racket-point-btns">
      <button className="wgt-racket-point-btn wgt-racket-point-btn--minus" style={{ background: teamAColor }} disabled={scoringLocked} onClick={() => adjustPoint('A', -1)} title={scoringLocked ? 'Press Start to begin scoring' : "Correct Team A's score down by 1 (not a real scored point — see Undo for reversing an actual point)"}>-1</button>
      <button className="wgt-racket-point-btn" style={{ background: teamAColor }} disabled={scoringLocked} onClick={() => scorePoint('A')} title={scoringLocked ? 'Press Start to begin scoring' : undefined}>+1</button>
      <button className="wgt-score-undo" onClick={undo} disabled={!(config.pointHistory ?? []).length} title="Undo last point"><Undo2 size={12} strokeWidth={2} /></button>
      <button className="wgt-score-undo" onClick={swapLastPoint} disabled={!(config.pointHistory ?? []).length} title="Scored for the wrong team? Swap the last point over to the other side"><ArrowLeftRight size={12} strokeWidth={2} /></button>
      <button className="wgt-racket-point-btn" style={{ background: teamBColor }} disabled={scoringLocked} onClick={() => scorePoint('B')} title={scoringLocked ? 'Press Start to begin scoring' : undefined}>+1</button>
      <button className="wgt-racket-point-btn wgt-racket-point-btn--minus" style={{ background: teamBColor }} disabled={scoringLocked} onClick={() => adjustPoint('B', -1)} title={scoringLocked ? 'Press Start to begin scoring' : "Correct Team B's score down by 1 (not a real scored point — see Undo for reversing an actual point)"}>-1</button>
    </div>
  );
  const matchControls = matchOverBanner ?? pointButtonsRow;

  // Game/Set/Match Point badge — a small pill above the score, shown
  // regardless of layoutStyle, labeled per whichever level is actually at
  // stake for whichever side is one point from winning it (see
  // pointSignificanceFor/pointBadgeLabel's own doc comments).
  const matchPointBadge = pointSigSide && pointSigLevel && (
    <div className="wgt-racket-pointbadge" style={{ '--rside-color': pointSigSide === 'A' ? teamAColor : teamBColor } as React.CSSProperties}>
      <span className="wgt-racket-pointbadge-team">
        {pointSigSide === 'A' ? (config.teamAShortName || config.teamAName || 'Team A') : (config.teamBShortName || config.teamBName || 'Team B')}
      </span>
      <span className="wgt-racket-pointbadge-sep">·</span>
      {pointBadgeLabel(pointSigLevel)}
    </div>
  );

  // Game timer — a real row in the widget's own body (not tucked into the
  // small header), shown regardless of layoutStyle, right under the header.
  // Once running (config.gameStartedAt set), stays visible EVEN after the
  // game ends (rallyGameOverWinner) — frozen rather than ticking, per
  // config.gameEndedAt — so the operator can see the final time before it's
  // filed away by Confirm/Start Next Game (which is what finally clears
  // gameStartedAt, hiding this again). The Start button only shows the rest
  // of the time: nothing started yet, AND there's an actual live game to
  // time it for (not while a just-finished game awaits confirm, or the
  // match/tie is already fully over — same gating matchControls uses).
  // Fully optional either way — scoring never depends on this running,
  // UNLESS Require Start to Score is separately turned on (scoringLocked).
  const timerDisplay = config.gameStartedAt ? (
    <div className="wgt-racket-timer-row">
      <Timer size={13} strokeWidth={2.5} />
      <span className="wgt-racket-timer-big" title="Timing this game — stops automatically once it's won">
        {formatDuration((config.gameEndedAt ?? Date.now()) - config.gameStartedAt)}
      </span>
    </div>
  ) : (
    // Only worth showing at all when it's actually REQUIRED (scoring is
    // locked until pressed) — when Require Start to Score is off, scoring
    // works regardless of this, so the button existed purely for the
    // optional "time this game" use case most operators don't need and
    // found it just cluttered the widget.
    !!config.requireStartToScore && !teamTieWinner && !matchWinnerSide && !rallyGameOverWinner && (
      <div className="wgt-racket-timer-row">
        <button
          className={`wgt-racket-timer-start-btn wgt-racket-timer-start-btn--${startButtonStyle}`}
          style={{ '--start-btn-color': startButtonColor } as React.CSSProperties}
          onClick={startGameTimer}
          title="Start this game — scoring is locked until you do"
        >
          <Play size={12} strokeWidth={2.5} fill="currentColor" /> Start Game
        </button>
      </div>
    )
  );

  return (
    <div className="wgt-racket" onClick={e => e.stopPropagation()} style={{ '--score-btn-scale': scoreButtonScale, '--start-btn-scale': startButtonScale } as React.CSSProperties}>
      <div className="wgt-racket-main">
      {nextFixture && (
        <div className="wgt-racket-next-fixture">
          <ArrowRight size={12} strokeWidth={2} />
          <span className="wgt-racket-next-fixture-text">
            Next: {nextFixture.teamAShortName || nextFixture.teamAName} vs {nextFixture.teamBShortName || nextFixture.teamBName}
            {nextFixture.round ? ` · ${nextFixture.round}` : ''}{nextFixture.time ? ` · ${nextFixture.time}` : ''}
          </span>
          <button className="wgt-racket-next-fixture-btn" onClick={loadNextFixture} title="Save/close this match and load the next fixture onto this board">
            Next Match
          </button>
        </div>
      )}
      <div className="wgt-racket-header">
        <span className="wgt-racket-sport">{SPORT_LABELS[sport]}{tennisState.inTiebreak && scoringMode === 'tennis' ? ' — Tiebreak' : ''}</span>
        <div className="wgt-racket-header-actions">
          <button
            className={`wgt-racket-save-btn${savedFlash ? ' wgt-racket-save-btn--done' : ''}`}
            onClick={handleSaveResult}
            title={duplicateResultId ? 'A matching result already exists — click again to overwrite it' : 'Save this match to Results'}
          >
            {savedFlash ? <Check size={12} strokeWidth={2.5} /> : <Save size={12} strokeWidth={2} />}
            {duplicateResultId ? 'Overwrite?' : savedFlash ? 'Saved' : 'Save'}
          </button>
          <button
            className={`wgt-racket-reset-btn${resetArmed ? ' wgt-racket-reset-btn--armed' : ''}`}
            onClick={handleResetClick}
            title={resetArmed ? 'Click again to confirm — this wipes the current score/games back to 0-0' : 'Reset this scoreboard back to 0-0'}
          >
            <RotateCcw size={12} strokeWidth={2} />
            {resetArmed ? 'Confirm?' : 'Reset'}
          </button>
          <button className={`wgt-ctimer-settings-btn${showSettings ? ' wgt-ctimer-settings-btn--active' : ''}`} onClick={toggleSettings} title="Settings">
            <Settings size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      {(config.showTimer ?? true) && timerDisplay}

      {(config.showMatchPointBadge ?? true) && matchPointBadge}

      {layoutStyle === 'vertical' && (
      <>
      <div className="wgt-racket-teams">
        <div className="wgt-racket-team" style={{ '--rside-color': teamAColor } as React.CSSProperties}>
          {/* Logo ABOVE the name, color swatch as a small dot overlapping
             its corner — reuses ScoreboardWidget.tsx's own wgt-score-mlogo/
             wgt-score-mcolor classes directly (not a racket-specific
             lookalike), so the two widgets' team cards read as the exact
             same layout, per the user's own ask. */}
          <div className="wgt-score-mlogo-wrap" onClick={e => e.stopPropagation()}>
            <LogoUrlPicker
              compact
              value={config.teamALogo ?? ''}
              onChange={logo => updateWidgetConfig(widgetId, { teamALogo: logo })}
              thumbSize={{ w: logoSize, h: logoSize }}
              thumbContent={config.teamALogo
                ? <img className="wgt-score-mlogo" style={{ width: logoSize, height: logoSize }} src={resolveImageUrl(config.teamALogo)} alt="" />
                : <div className="wgt-score-mlogo-ph" style={{ background: teamAColor, width: logoSize, height: logoSize }} />}
            />
            <input type="color" className="wgt-score-mcolor" value={teamAColor} title="Team A color" onChange={e => updateWidgetConfig(widgetId, { teamAColor: e.target.value })} />
          </div>
          <div className="wgt-racket-identity" onClick={e => e.stopPropagation()}>
            <div className="wgt-racket-identity-row">
              <input className="wgt-score-name" style={{ color: teamAColor, fontSize: nameFontSize }} value={config.teamAName ?? ''} placeholder="Team A" onChange={e => updateWidgetConfig(widgetId, { teamAName: e.target.value })} />
              {teamPicker('A')}
            </div>
            <input className="wgt-score-mshort" style={{ color: teamAColor }} value={config.teamAShortName ?? ''} placeholder="Short" onChange={e => updateWidgetConfig(widgetId, { teamAShortName: e.target.value })} />
          </div>
        </div>
        <div className="wgt-racket-vs">vs</div>
        <div className="wgt-racket-team" style={{ '--rside-color': teamBColor } as React.CSSProperties}>
          <div className="wgt-score-mlogo-wrap" onClick={e => e.stopPropagation()}>
            <LogoUrlPicker
              compact
              value={config.teamBLogo ?? ''}
              onChange={logo => updateWidgetConfig(widgetId, { teamBLogo: logo })}
              thumbSize={{ w: logoSize, h: logoSize }}
              thumbContent={config.teamBLogo
                ? <img className="wgt-score-mlogo" style={{ width: logoSize, height: logoSize }} src={resolveImageUrl(config.teamBLogo)} alt="" />
                : <div className="wgt-score-mlogo-ph" style={{ background: teamBColor, width: logoSize, height: logoSize }} />}
            />
            <input type="color" className="wgt-score-mcolor" value={teamBColor} title="Team B color" onChange={e => updateWidgetConfig(widgetId, { teamBColor: e.target.value })} />
          </div>
          <div className="wgt-racket-identity" onClick={e => e.stopPropagation()}>
            <div className="wgt-racket-identity-row">
              <input className="wgt-score-name" style={{ color: teamBColor, fontSize: nameFontSize }} value={config.teamBName ?? ''} placeholder="Team B" onChange={e => updateWidgetConfig(widgetId, { teamBName: e.target.value })} />
              {teamPicker('B')}
            </div>
            <input className="wgt-score-mshort" style={{ color: teamBColor }} value={config.teamBShortName ?? ''} placeholder="Short" onChange={e => updateWidgetConfig(widgetId, { teamBShortName: e.target.value })} />
          </div>
        </div>
      </div>

      {/* Team Event (Regu) tally — sepaktakraw only, off unless config.
         teamEventOn is set. Sits above the games-won row since it's an even
         BIGGER picture than the match itself: which squad is ahead on regu
         wins across the whole tie, not just games within the current regu's
         own match. reguHistory's own detail (each regu's final game score)
         only needs to matter to whoever's checking, so it's a plain small
         list rather than fighting the games-row for visual weight. */}
      {teamEventOn && (
        <div className="wgt-racket-regu-block">
          <div className="wgt-racket-regu-row">
            <span className="wgt-racket-regu-tally" style={{ color: teamAColor }}>{regusWonA}</span>
            <span className="wgt-racket-regu-label">
              {teamTieWinner ? 'Team Event Final' : `Regu ${currentRegu} · Best of ${regusToWin * 2 - 1}`}
            </span>
            <span className="wgt-racket-regu-tally" style={{ color: teamBColor }}>{regusWonB}</span>
          </div>
          {reguHistory.length > 0 && (
            <div className="wgt-racket-regu-history">
              {reguHistory.map(r => {
                const lineupA = (r.startersA ?? []).map(formatPlayerEntry).filter(Boolean).join(', ');
                const lineupB = (r.startersB ?? []).map(formatPlayerEntry).filter(Boolean).join(', ');
                return (
                  <div key={r.regu} className="wgt-racket-regu-history-entry">
                    <span className="wgt-racket-regu-history-item" style={{ color: r.winner === 'A' ? teamAColor : teamBColor }}>
                      Regu {r.regu}: {r.winner === 'A' ? (config.teamAName || 'Team A') : (config.teamBName || 'Team B')} won {r.scoreA}-{r.scoreB} ({r.games.join(', ')})
                    </span>
                    {(lineupA || lineupB) && (
                      <span className="wgt-racket-regu-history-lineup">
                        {lineupA && <span style={{ color: teamAColor }}>A: {lineupA}</span>}
                        {lineupA && lineupB && ' · '}
                        {lineupB && <span style={{ color: teamBColor }}>B: {lineupB}</span>}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Games/sets won so far, as the running tally either side of each
         completed game's own actual final score (e.g. "21-15") — not just
         how many were won, the real result of every one, same as a real
         broadcast scoreboard's set-by-set line. Shown above the live point
         score since it's the "bigger picture" (who's actually ahead in the
         MATCH), same visual hierarchy a real broadcast graphic uses. */}
      <div className="wgt-racket-games-row">
        <span className="wgt-racket-games-tally" style={{ color: teamAColor }}>{gamesWonA}</span>
        {(config.showCompletedGames ?? true) && (
          <div className="wgt-racket-results">
            {completedGames.map((g, i) => (
              <span key={i} className="wgt-racket-result-chip" style={{ color: setResultColor(g), borderColor: setResultColor(g) }}>
                {formatGameResult(g)}
              </span>
            ))}
          </div>
        )}
        <span className="wgt-racket-games-tally" style={{ color: teamBColor }}>{gamesWonB}</span>
      </div>

      {/* Serve indicators live in their own fixed-size slots either side of
         the score — always rendered (never conditionally unmounted), so
         whichever side is actually serving never changes anyone ELSE's
         position: the slot itself is the same size regardless of which
         button inside it is visible. See serverControl's own doc comment. */}
      <div className="wgt-racket-score-row">
        <div className="wgt-racket-serve-slot">{serverControl('A')}</div>
        {scoreDisplay('A', 'wgt-score-num', { color: teamAColor, fontSize: scoreFontSize })}
        {showDeuceBadge && <span className="wgt-racket-deuce">DEUCE</span>}
        <div className="wgt-racket-colon-wrap">
          <span className="wgt-racket-colon">:</span>
          {/* Unlike each side's own server DOT (only clickable while
             canPickServe — see serverControl's own doc comment), this swap
             button always works, Auto mode included — a quick manual
             correction for a missed/wrong call. In Auto + "Winner serves",
             it only lasts until the next point (whoever wins that becomes
             server regardless of this), same as any other Auto-mode
             correction; in Auto + "Rotate after N points", it actually
             changes who the rotation continues from, since that rule reads
             the CURRENT server rather than re-deriving it from scratch. */}
          <button className="wgt-racket-swap-serve-btn" onClick={() => setServerManual(server === 'A' ? 'B' : 'A')} disabled={scoringLocked} title={scoringLocked ? "Press Start to begin scoring first" : "Swap serve to the other side"}>
            <Repeat size={11} strokeWidth={2.5} />
          </button>
        </div>
        {scoreDisplay('B', 'wgt-score-num', { color: teamBColor, fontSize: scoreFontSize })}
        <div className="wgt-racket-serve-slot">{serverControl('B')}</div>
      </div>

      {matchControls}
      </>
      )}

      {layoutStyle === 'horizontal' && (
        <div className="wgt-racket-horiz">
          {(['A', 'B'] as RacketSide[]).map(side => {
            const color = side === 'A' ? teamAColor : teamBColor;
            const logo = side === 'A' ? config.teamALogo : config.teamBLogo;
            const name = side === 'A' ? config.teamAName : config.teamBName;
            return (
              <div key={side} className="wgt-racket-horiz-row" style={{ '--rside-color': color } as React.CSSProperties}>
                <div className="wgt-racket-serve-slot wgt-racket-horiz-serve-slot">{serverControl(side)}</div>
                {logo
                  ? <img className="wgt-racket-horiz-flag" style={{ width: 22 * logoScale, height: 16 * logoScale }} src={resolveImageUrl(logo)} alt="" />
                  : <div className="wgt-racket-horiz-flag wgt-racket-horiz-flag--ph" style={{ background: color, width: 22 * logoScale, height: 16 * logoScale }} />}
                <input
                  className="wgt-racket-horiz-name" style={{ color, fontSize: nameFontSize }} value={name ?? ''}
                  placeholder={side === 'A' ? 'Team A' : 'Team B'}
                  onClick={e => e.stopPropagation()}
                  onChange={e => updateWidgetConfig(widgetId, side === 'A' ? { teamAName: e.target.value } : { teamBName: e.target.value })}
                />
                <div className="wgt-racket-horiz-boxes">
                  {completedGames.map((g, i) => (
                    <span key={i} className="wgt-racket-horiz-box" style={{ minWidth: 22 * scoreScale, height: 26 * scoreScale, fontSize: 14 * scoreScale }}>{side === 'A' ? g.a : g.b}</span>
                  ))}
                  {scoreDisplay(side, 'wgt-racket-horiz-box wgt-racket-horiz-box--live', { background: color, minWidth: 22 * scoreScale, height: 26 * scoreScale, fontSize: 14 * scoreScale })}
                </div>
                {/* +1/-1 live right on THIS side's own row (scoreButtonPosition
                   'sides', the default) — tap the row you want to score,
                   same "each side owns its own button" convention the
                   vertical layout's point-btns already follow, just
                   repositioned to match this layout's own row-per-side
                   shape. 'grouped' moves both sides' buttons into one
                   shared strip below instead (see wgt-racket-horiz-controls
                   just below), closer to Vertical's own arrangement.
                   Hidden either way once there's a banner to react to. */}
                {!matchOverBanner && scoreButtonPosition === 'sides' && (
                  <>
                    <button className="wgt-racket-horiz-plus wgt-racket-horiz-plus--minus" style={{ background: color }} disabled={scoringLocked} onClick={() => adjustPoint(side, -1)} title={scoringLocked ? 'Press Start to begin scoring' : `Correct ${side === 'A' ? (config.teamAName || 'Team A') : (config.teamBName || 'Team B')}'s score down by 1`}>-1</button>
                    <button className="wgt-racket-horiz-plus" style={{ background: color }} disabled={scoringLocked} onClick={() => scorePoint(side)} title={scoringLocked ? 'Press Start to begin scoring' : undefined}>+1</button>
                  </>
                )}
              </div>
            );
          })}
          {!matchOverBanner && scoreButtonPosition === 'grouped' && (
            <div className="wgt-racket-horiz-controls">
              <button className="wgt-racket-horiz-plus wgt-racket-horiz-plus--minus" style={{ background: teamAColor }} disabled={scoringLocked} onClick={() => adjustPoint('A', -1)} title={scoringLocked ? 'Press Start to begin scoring' : undefined}>-1</button>
              <button className="wgt-racket-horiz-plus" style={{ background: teamAColor }} disabled={scoringLocked} onClick={() => scorePoint('A')} title={scoringLocked ? 'Press Start to begin scoring' : undefined}>+1</button>
              <button className="wgt-score-undo" onClick={undo} disabled={!(config.pointHistory ?? []).length} title="Undo last point"><Undo2 size={12} strokeWidth={2} /></button>
              <button className="wgt-score-undo" onClick={swapLastPoint} disabled={!(config.pointHistory ?? []).length} title="Scored for the wrong team? Swap the last point over to the other side"><ArrowLeftRight size={12} strokeWidth={2} /></button>
              <button className="wgt-racket-horiz-plus" style={{ background: teamBColor }} disabled={scoringLocked} onClick={() => scorePoint('B')} title={scoringLocked ? 'Press Start to begin scoring' : undefined}>+1</button>
              <button className="wgt-racket-horiz-plus wgt-racket-horiz-plus--minus" style={{ background: teamBColor }} disabled={scoringLocked} onClick={() => adjustPoint('B', -1)} title={scoringLocked ? 'Press Start to begin scoring' : undefined}>-1</button>
            </div>
          )}
          <div className="wgt-racket-horiz-controls">
            {!matchOverBanner && scoreButtonPosition === 'sides' && (
              <>
                <button className="wgt-score-undo" onClick={undo} disabled={!(config.pointHistory ?? []).length} title="Undo last point"><Undo2 size={12} strokeWidth={2} /></button>
                <button className="wgt-score-undo" onClick={swapLastPoint} disabled={!(config.pointHistory ?? []).length} title="Scored for the wrong team? Swap the last point over to the other side"><ArrowLeftRight size={12} strokeWidth={2} /></button>
              </>
            )}
            <button className="wgt-racket-swap-serve-btn" onClick={() => setServerManual(server === 'A' ? 'B' : 'A')} disabled={scoringLocked} title={scoringLocked ? "Press Start to begin scoring first" : "Swap serve to the other side"}>
              <Repeat size={11} strokeWidth={2.5} />
            </button>
            {showDeuceBadge && <span className="wgt-racket-deuce">DEUCE</span>}
          </div>
          {matchOverBanner}
        </div>
      )}

      {layoutStyle === 'lowerthird' && (
        <div className="wgt-racket-lt">
          {(config.competition || config.subtitle) && (
            <div className="wgt-racket-lt-tag">{config.competition || config.subtitle}</div>
          )}
          <div className="wgt-racket-lt-bar">
            <div className="wgt-racket-lt-side">
              {config.teamALogo
                ? <img className="wgt-racket-lt-flag" style={{ width: 24 * logoScale, height: 17 * logoScale }} src={resolveImageUrl(config.teamALogo)} alt="" />
                : <div className="wgt-racket-lt-flag wgt-racket-lt-flag--ph" style={{ background: teamAColor, width: 24 * logoScale, height: 17 * logoScale }} />}
              <input
                className="wgt-racket-lt-name" style={{ color: teamAColor, fontSize: nameFontSize, minWidth: `${Math.max((config.teamAName || 'Team A').length, 3)}ch` }} value={config.teamAName ?? ''}
                placeholder="Team A" onClick={e => e.stopPropagation()}
                onChange={e => updateWidgetConfig(widgetId, { teamAName: e.target.value })}
              />
              {/* +1/-1 sit right next to the side they score
                 (scoreButtonPosition 'sides', the default) — same reasoning
                 as the horizontal layout's own per-row buttons. 'grouped'
                 moves both sides' buttons into the shared strip below
                 instead (see wgt-racket-lt-controls further down). */}
              {!matchOverBanner && scoreButtonPosition === 'sides' && (
                <>
                  <button className="wgt-racket-lt-plus wgt-racket-lt-plus--minus" style={{ background: teamAColor }} disabled={scoringLocked} onClick={() => adjustPoint('A', -1)} title={scoringLocked ? 'Press Start to begin scoring' : "Correct this side's score down by 1"}>-1</button>
                  <button className="wgt-racket-lt-plus" style={{ background: teamAColor }} disabled={scoringLocked} onClick={() => scorePoint('A')} title={scoringLocked ? 'Press Start to begin scoring' : undefined}>+1</button>
                </>
              )}
            </div>
            <span className="wgt-racket-lt-vs">vs</span>
            <div className="wgt-racket-lt-side">
              {!matchOverBanner && scoreButtonPosition === 'sides' && (
                <>
                  <button className="wgt-racket-lt-plus" style={{ background: teamBColor }} disabled={scoringLocked} onClick={() => scorePoint('B')} title={scoringLocked ? 'Press Start to begin scoring' : undefined}>+1</button>
                  <button className="wgt-racket-lt-plus wgt-racket-lt-plus--minus" style={{ background: teamBColor }} disabled={scoringLocked} onClick={() => adjustPoint('B', -1)} title={scoringLocked ? 'Press Start to begin scoring' : "Correct this side's score down by 1"}>-1</button>
                </>
              )}
              <input
                className="wgt-racket-lt-name" style={{ color: teamBColor, fontSize: nameFontSize, minWidth: `${Math.max((config.teamBName || 'Team B').length, 3)}ch` }} value={config.teamBName ?? ''}
                placeholder="Team B" onClick={e => e.stopPropagation()}
                onChange={e => updateWidgetConfig(widgetId, { teamBName: e.target.value })}
              />
              {config.teamBLogo
                ? <img className="wgt-racket-lt-flag" style={{ width: 24 * logoScale, height: 17 * logoScale }} src={resolveImageUrl(config.teamBLogo)} alt="" />
                : <div className="wgt-racket-lt-flag wgt-racket-lt-flag--ph" style={{ background: teamBColor, width: 24 * logoScale, height: 17 * logoScale }} />}
            </div>
          </div>
          <div className="wgt-racket-lt-score">
            {completedGames.length === 0 ? (
              <>{scoreDisplay('A', 'wgt-racket-lt-score-live', { fontSize: 13 * scoreScale })}<span className="wgt-racket-lt-score-live" style={{ fontSize: 13 * scoreScale }}> - </span>{scoreDisplay('B', 'wgt-racket-lt-score-live', { fontSize: 13 * scoreScale })}</>
            ) : (
              completedGames.map((g, i) => <span key={i} style={{ fontSize: 13 * scoreScale }}>{g.a}-{g.b}</span>)
            )}
          </div>
          {!matchOverBanner && scoreButtonPosition === 'grouped' && (
            <div className="wgt-racket-lt-controls">
              <button className="wgt-racket-lt-plus wgt-racket-lt-plus--minus" style={{ background: teamAColor }} disabled={scoringLocked} onClick={() => adjustPoint('A', -1)} title={scoringLocked ? 'Press Start to begin scoring' : undefined}>-1</button>
              <button className="wgt-racket-lt-plus" style={{ background: teamAColor }} disabled={scoringLocked} onClick={() => scorePoint('A')} title={scoringLocked ? 'Press Start to begin scoring' : undefined}>+1</button>
              <button className="wgt-score-undo" onClick={undo} disabled={!(config.pointHistory ?? []).length} title="Undo last point"><Undo2 size={12} strokeWidth={2} /></button>
              <button className="wgt-score-undo" onClick={swapLastPoint} disabled={!(config.pointHistory ?? []).length} title="Scored for the wrong team? Swap the last point over to the other side"><ArrowLeftRight size={12} strokeWidth={2} /></button>
              <button className="wgt-racket-lt-plus" style={{ background: teamBColor }} disabled={scoringLocked} onClick={() => scorePoint('B')} title={scoringLocked ? 'Press Start to begin scoring' : undefined}>+1</button>
              <button className="wgt-racket-lt-plus wgt-racket-lt-plus--minus" style={{ background: teamBColor }} disabled={scoringLocked} onClick={() => adjustPoint('B', -1)} title={scoringLocked ? 'Press Start to begin scoring' : undefined}>-1</button>
            </div>
          )}
          <div className="wgt-racket-lt-controls">
            <div className="wgt-racket-serve-slot" style={{ '--rside-color': teamAColor } as React.CSSProperties}>{serverControl('A')}</div>
            {!matchOverBanner && scoreButtonPosition === 'sides' && (
              <>
                <button className="wgt-score-undo" onClick={undo} disabled={!(config.pointHistory ?? []).length} title="Undo last point"><Undo2 size={12} strokeWidth={2} /></button>
                <button className="wgt-score-undo" onClick={swapLastPoint} disabled={!(config.pointHistory ?? []).length} title="Scored for the wrong team? Swap the last point over to the other side"><ArrowLeftRight size={12} strokeWidth={2} /></button>
              </>
            )}
            <div className="wgt-racket-serve-slot" style={{ '--rside-color': teamBColor } as React.CSSProperties}>{serverControl('B')}</div>
          </div>
          {matchOverBanner}
        </div>
      )}

      {/* 'liveCard' — a dark, mobile-app-style match card modeled on a
         reference design: title/subtitle row with a pulsing LIVE pill
         (reuses ScoreboardWidget.tsx's own wgt-score-live-pill/-dot
         classes directly, same "read as the same app" reasoning the team-
         card logo/name inputs above already follow), a big "games won"
         score + "Set N" underneath, then a card with editable team names,
         big colored point totals either side of the existing serve
         indicator, and the SAME matchControls (+1/Undo/+1, or the match-
         over banner) every other layout already uses — restyled via CSS
         into large pill buttons rather than rebuilt from scratch. */}
      {layoutStyle === 'liveCard' && (
        <div className="wgt-racket-lc">
          <div className="wgt-racket-lc-title-row">
            <div className="wgt-racket-lc-title">
              <span className="wgt-racket-lc-titlemain">{config.competition || SPORT_LABELS[sport]}</span>
              <span className="wgt-racket-lc-titlesub">
                {(config.teamAShortName || config.teamAName || 'Team A')} vs {(config.teamBShortName || config.teamBName || 'Team B')}
              </span>
            </div>
            {!!config.gameStartedAt && !matchWinnerSide && !teamTieWinner && (
              <span className="wgt-score-live-pill"><span className="wgt-score-live-dot" />LIVE</span>
            )}
          </div>

          <div className="wgt-racket-lc-meta">
            {config.subtitle || `${SPORT_LABELS[sport]}${scoringMode === 'tennis' ? '' : ` · Best of ${rallySettings.gamesToWin * 2 - 1}`}`}
          </div>

          <div className="wgt-racket-lc-setscore">
            <span style={{ color: teamAColor }}>{gamesWonA}</span>
            <span className="wgt-racket-lc-setscore-sep">-</span>
            <span style={{ color: teamBColor }}>{gamesWonB}</span>
          </div>
          <div className="wgt-racket-lc-setlabel">
            {matchWinnerSide || teamTieWinner ? 'Final' : tennisState.inTiebreak && scoringMode === 'tennis' ? 'Tiebreak' : `Set ${completedGames.length + 1}`}
          </div>

          <div className="wgt-racket-lc-card">
            <div className="wgt-racket-lc-names">
              <div className="wgt-racket-lc-nameside" onClick={e => e.stopPropagation()}>
                {config.teamALogo && <img className="wgt-racket-lc-logo" style={{ width: 44 * logoScale, height: 44 * logoScale }} src={resolveImageUrl(config.teamALogo)} alt="" />}
                <div className="wgt-racket-lc-nametext">
                  <div className="wgt-racket-lc-name-row">
                    <input className="wgt-racket-lc-name-input" style={{ color: teamAColor }} value={config.teamAName ?? ''} placeholder="Team A" onChange={e => updateWidgetConfig(widgetId, { teamAName: e.target.value })} />
                    {teamPicker('A')}
                  </div>
                  {config.teamAShortName && <span className="wgt-racket-lc-shortname" style={{ color: teamAColor }}>{config.teamAShortName}</span>}
                </div>
                <Pencil size={11} strokeWidth={2} style={{ color: teamAColor, opacity: 0.6 }} />
              </div>
              <div className="wgt-racket-lc-nameside wgt-racket-lc-nameside--b" onClick={e => e.stopPropagation()}>
                {config.teamBLogo && <img className="wgt-racket-lc-logo" style={{ width: 44 * logoScale, height: 44 * logoScale }} src={resolveImageUrl(config.teamBLogo)} alt="" />}
                <div className="wgt-racket-lc-nametext">
                  <div className="wgt-racket-lc-name-row">
                    {teamPicker('B')}
                    <input className="wgt-racket-lc-name-input" style={{ color: teamBColor }} value={config.teamBName ?? ''} placeholder="Team B" onChange={e => updateWidgetConfig(widgetId, { teamBName: e.target.value })} />
                  </div>
                  {config.teamBShortName && <span className="wgt-racket-lc-shortname" style={{ color: teamBColor }}>{config.teamBShortName}</span>}
                </div>
                <Pencil size={11} strokeWidth={2} style={{ color: teamBColor, opacity: 0.6 }} />
              </div>
            </div>
            <div className="wgt-racket-lc-scores">
              <div className="wgt-racket-lc-scoreside">
                {serverControl('A')}
                {scoreDisplay('A', 'wgt-racket-lc-scorenum', { color: teamAColor, fontSize: scoreFontSize })}
              </div>
              {/* Bigger, dead-center swap-serve button — same action the
                 vertical/horizontal layouts' own small colon-button already
                 does (setServerManual), just sized up to match this layout's
                 own chunkier, tap-friendly controls. */}
              <button className="wgt-racket-swap-serve-btn wgt-racket-swap-serve-btn--lg" onClick={() => setServerManual(server === 'A' ? 'B' : 'A')} disabled={scoringLocked} title={scoringLocked ? "Press Start to begin scoring first" : "Swap serve to the other side"}>
                <Repeat size={18} strokeWidth={2.5} />
              </button>
              <div className="wgt-racket-lc-scoreside">
                {scoreDisplay('B', 'wgt-racket-lc-scorenum', { color: teamBColor, fontSize: scoreFontSize })}
                {serverControl('B')}
              </div>
            </div>
            <div className="wgt-racket-lc-controls">{matchControls}</div>
          </div>

          {(config.showCompletedGames ?? true) && completedGames.length > 0 && (
            <div className="wgt-racket-lc-completed">
              <div className="wgt-racket-lc-completed-label">Completed Sets</div>
              <div className="wgt-racket-lc-completed-row">
                {completedGames.map((g, i) => (
                  <div key={i} className="wgt-racket-lc-completed-pill" style={{ borderColor: setResultColor(g) }}>
                    <span className="wgt-racket-lc-completed-setn">Set {i + 1}</span>
                    <span style={{ color: setResultColor(g) }}>{formatGameResult(g)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Starters/Subs/Roster — moved to the BOTTOM of the whole widget
         (out of each team's own card up top) and collapsed by default, so
         authoring who's playing doesn't permanently cost vertical space on
         a board an operator mostly just wants to glance at score/serve on.
         Toggle stays visible regardless of collapsed state; the section
         itself only mounts while open. */}
      {(config.showPlayers ?? true) && (
        <>
          <button className="wgt-racket-players-toggle-btn" onClick={() => setPlayersOpen(v => !v)}>
            <Users size={11} strokeWidth={2} /> Players {playersOpen ? <ChevronUp size={11} strokeWidth={2} /> : <ChevronDown size={11} strokeWidth={2} />}
          </button>
          {playersOpen && (
            <div className="wgt-racket-players-footer" style={{ '--rplayer-scale': playerAreaScale } as React.CSSProperties}>
              <div className="wgt-racket-players-col">{playersSection('A', teamAColor)}</div>
              <div className="wgt-racket-players-col">{playersSection('B', teamBColor)}</div>
            </div>
          )}
        </>
      )}

      {/* Match Report — the point-by-point trail behind every game's own
         final score (e.g. how "21-15" actually got there: 1-0, 1-1, 2-1,
         …), not just the completed-game result chips already shown up by
         the score. Collapsed by default for the same reason Players is —
         a full match's worth of points is a lot of chips to always show. */}
      {(config.showMatchReport ?? true) && (
        <>
          <button className="wgt-racket-players-toggle-btn" onClick={() => setReportOpen(v => !v)}>
            <ClipboardList size={11} strokeWidth={2} /> Match Report / Set History {reportOpen ? <ChevronUp size={11} strokeWidth={2} /> : <ChevronDown size={11} strokeWidth={2} />}
          </button>
          {reportOpen && (
            <div className="wgt-racket-report">
              {(teamEventOn ? reportRegus.every(r => r.games.length === 0) : reportGames.length === 0) ? (
                <p className="wgt-racket-report-empty">No points scored yet.</p>
              ) : (
                <div className="wgt-racket-report-scroll">
                  <table className="wgt-racket-report-table">
                    <tbody>
                      {teamEventOn ? (
                        // Team Event — every regu's own point-by-point trail,
                        // oldest first, each under its own "Regu N" separator
                        // row (a bigger/bolder break than the plain per-game one
                        // used both here and inside the single-regu case below).
                        reportRegus.map(r => r.games.length > 0 && (
                          <Fragment key={r.regu}>
                            <tr className="wgt-racket-report-regu-sep">
                              <td colSpan={100}>Regu {r.regu}</td>
                            </tr>
                            {r.games.map(([gameNum, entries], gi) => renderReportGame(gameNum, entries, gi, r.durations[gameNum - 1]))}
                          </Fragment>
                        ))
                      ) : (
                        reportGames.map(([gameNum, entries], gi) => renderReportGame(gameNum, entries, gi, (config.gameDurationsMs ?? [])[gameNum - 1]))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
      </div>

      {showSettings && (
        <div className="wgt-racket-settings-panel" onClick={e => e.stopPropagation()}>
          <div className="wgt-ctimer-settings-header">
            <span>Match Settings</span>
            <button className="wgt-ctimer-settings-close" onClick={toggleSettings} title="Close"><X size={14} strokeWidth={2} /></button>
          </div>

          {/* Same "Match Type" card grid as Tournament Manager's own sport
             picker (see TournamentManager.tsx's SettingsBar) and this
             widget's own WidgetConfigPanel.tsx Scoring Rules section —
             reused here too rather than a plain <select>, same reasoning:
             this widget's own quick-edit panel and the deeper settings
             panel write the exact same config fields (see this component's
             own top-of-file doc comment on "Settings live in TWO places"). */}
          <div className="wgt-ctimer-settings-row wgt-ctimer-settings-row--sportgrid">
            <span className="wgt-ctimer-settings-row-label">Sport</span>
            <div className="tm-ms-sport-grid tm-ms-sport-grid--narrow">
              {(['badminton', 'table_tennis', 'tennis', 'sepaktakraw'] as SportType[]).map(sp => {
                const spRs = SPORT_DEFAULTS[sp].racketScoring!;
                const headline = spRs.mode === 'tennis' ? `${spRs.tiebreakAtGames} games` : `${spRs.pointsToWin} pts`;
                return (
                  <button
                    key={sp}
                    type="button"
                    className={`tm-ms-sport-card${sport === sp ? ' tm-ms-sport-card--active' : ''}`}
                    onClick={() => applySport(sp)}
                  >
                    <span className="tm-ms-sport-card-name">{sp === 'table_tennis' ? 'Table Tennis' : sp[0].toUpperCase() + sp.slice(1)}</span>
                    <span className="tm-ms-sport-card-sub">{headline}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <label className="wgt-ctimer-settings-row">
            Layout
            <CardSelect
              className="tm-ms-sport-grid--narrow"
              value={layoutStyle}
              title="Vertical — the original team-card layout. Horizontal — a compact broadcast scorebug (flag inline, each game/set as its own box). Lower Third — a slim bar for a lower-third graphic. Live Card — a dark mobile-app-style match card."
              onChange={v => updateWidgetConfig(widgetId, { layoutStyle: v })}
              options={[
                { value: 'vertical', label: 'Vertical' },
                { value: 'horizontal', label: 'Horizontal' },
                { value: 'lowerthird', label: 'Lower Third' },
                { value: 'liveCard', label: 'Live Card' },
              ]}
            />
          </label>

          <label className="wgt-ctimer-settings-row">
            Score button size
            <CustomBox>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="range" min={0.5} max={2} step={0.05}
                  value={scoreButtonScale}
                  title="Scales every +1/-1 score button, in every layout"
                  onChange={e => updateWidgetConfig(widgetId, { scoreButtonScale: Number(e.target.value) })}
                />
                <span style={{ fontSize: 10, color: 'var(--text-muted)', minWidth: 30, textAlign: 'right' }}>{Math.round(scoreButtonScale * 100)}%</span>
              </div>
            </CustomBox>
          </label>

          <label className="wgt-ctimer-settings-row">
            Start button size
            <CustomBox>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="range" min={0.5} max={2.5} step={0.05}
                  value={startButtonScale}
                  title="Scales the Start Game button — it already pulses to stay noticeable, this makes it bigger too"
                  onChange={e => updateWidgetConfig(widgetId, { startButtonScale: Number(e.target.value) })}
                />
                <span style={{ fontSize: 10, color: 'var(--text-muted)', minWidth: 30, textAlign: 'right' }}>{Math.round(startButtonScale * 100)}%</span>
              </div>
            </CustomBox>
          </label>
          <label className="wgt-ctimer-settings-row">
            Start button style
            <CardSelect
              className="tm-ms-sport-grid--narrow"
              value={startButtonStyle}
              onChange={v => updateWidgetConfig(widgetId, { startButtonStyle: v })}
              options={[{ value: 'solid', label: 'Solid' }, { value: 'outline', label: 'Outline' }, { value: 'ghost', label: 'Ghost' }]}
            />
          </label>
          <label className="wgt-ctimer-settings-row">
            Start button color
            <CustomBox>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="color"
                  value={config.startButtonColor || '#3b82f6'}
                  title="Also colors the pulse ring"
                  onChange={e => updateWidgetConfig(widgetId, { startButtonColor: e.target.value })}
                />
                {config.startButtonColor && (
                  <button
                    className="wgt-ctimer-settings-close"
                    style={{ width: 18, height: 18, fontSize: 10 }}
                    onClick={() => updateWidgetConfig(widgetId, { startButtonColor: undefined })}
                    title="Reset to theme default"
                  >×</button>
                )}
              </div>
            </CustomBox>
          </label>

          {layoutStyle !== 'vertical' && (
            <label className="wgt-ctimer-settings-row">
              Score button position
              <CardSelect
                className="tm-ms-sport-grid--narrow"
                value={scoreButtonPosition}
                title="Sides — each side's own +1/-1 sits right on its own row/name (default). Grouped — both sides' +1/-1 sit together in one shared strip instead."
                onChange={v => updateWidgetConfig(widgetId, { scoreButtonPosition: v })}
                options={[{ value: 'sides', label: 'Sides' }, { value: 'grouped', label: 'Grouped' }]}
              />
            </label>
          )}

          <div className="wgt-ctimer-settings-divider" />

          {/* Logo/Name/Score size — one slider each, applying across ALL
             THREE layouts at once (see logoScale/scoreScale's own doc
             comment for how the non-vertical layouts' own differently-
             shaped elements stay proportional to these same values). */}
          <label className="wgt-ctimer-settings-row">
            Logo size
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="range" min={24} max={100} step={2} value={logoSize} onChange={e => updateWidgetConfig(widgetId, { logoSize: Number(e.target.value) })} />
              <span style={{ fontSize: 10, color: 'var(--text-muted)', minWidth: 26, textAlign: 'right' }}>{logoSize}px</span>
            </div>
          </label>
          <label className="wgt-ctimer-settings-row">
            Name size
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="range" min={8} max={48} step={1} value={nameFontSize} onChange={e => updateWidgetConfig(widgetId, { nameFontSize: Number(e.target.value) })} />
              <span style={{ fontSize: 10, color: 'var(--text-muted)', minWidth: 26, textAlign: 'right' }}>{nameFontSize}px</span>
            </div>
          </label>
          <label className="wgt-ctimer-settings-row">
            Score size
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="range" min={16} max={100} step={2} value={scoreFontSize} onChange={e => updateWidgetConfig(widgetId, { scoreFontSize: Number(e.target.value) })} />
              <span style={{ fontSize: 10, color: 'var(--text-muted)', minWidth: 26, textAlign: 'right' }}>{scoreFontSize}px</span>
            </div>
          </label>

          <div className="wgt-ctimer-settings-divider" />

          <ToggleCard checked={!!config.requireStartToScore} onChange={v => updateWidgetConfig(widgetId, { requireStartToScore: v })} title="While on, +1/-1 and changing serve are all locked out until the operator presses Start Game for the current game — re-applies fresh every game. Entirely optional, off by default." desc="Require Start to score" />

          <div className="wgt-ctimer-settings-divider" />

          {/* Show/hide — every one of these pieces of content stays fully
             available (the underlying data is never deleted, just not
             painted) and defaults to ON, so an existing widget saved before
             these fields existed looks exactly as it always has. Applies
             across every layoutStyle alike (each row this hides is rendered
             once, shared by all four layouts — see this widget's own
             return statement). */}
          <ToggleCard checked={config.showTimer ?? true} onChange={v => updateWidgetConfig(widgetId, { showTimer: v })} desc="Show game timer" />
          <ToggleCard checked={config.showMatchPointBadge ?? true} onChange={v => updateWidgetConfig(widgetId, { showMatchPointBadge: v })} desc="Show Game/Set/Match Point badge" />
          <ToggleCard checked={config.showCompletedGames ?? true} onChange={v => updateWidgetConfig(widgetId, { showCompletedGames: v })} desc="Show completed sets" />
          <ToggleCard checked={config.showPlayers ?? true} onChange={v => updateWidgetConfig(widgetId, { showPlayers: v })} desc="Show Players section" />
          <ToggleCard checked={config.showMatchReport ?? true} onChange={v => updateWidgetConfig(widgetId, { showMatchReport: v })} desc="Show Match Report / Set History" />

          <label className="wgt-ctimer-settings-row">
            Players per team
            <input
              type="number" min={1} max={6} className="wgt-ctimer-settings-input wgt-ctimer-settings-input--num"
              value={config.playerCount ?? 1}
              title="How many starter slots show per side — 1 for singles, 2 for a doubles pair, 3 for a sepaktakraw regu"
              onChange={e => updateWidgetConfig(widgetId, { playerCount: Math.max(1, Math.min(6, Number(e.target.value) || 1)) })}
            />
          </label>

          {sport === 'sepaktakraw' && (
            <>
              <div className="wgt-ctimer-settings-divider" />
              <ToggleCard checked={!!config.teamEventOn} onChange={v => updateWidgetConfig(widgetId, { teamEventOn: v })} title="A squad fields several regu (Regu 1, Regu 2, Regu 3…) across a team tie — the tie is decided by how many individual regu-matches each squad wins, not by points" desc="Team Event (multiple regu)" />
              {config.teamEventOn && (
                <label className="wgt-ctimer-settings-row">
                  Regu wins needed
                  <input
                    type="number" min={1} className="wgt-ctimer-settings-input wgt-ctimer-settings-input--num"
                    value={config.regusToWin ?? 2}
                    title="e.g. 2 for a best-of-3 regu tie, 3 for a best-of-5"
                    onChange={e => updateWidgetConfig(widgetId, { regusToWin: Math.max(1, Number(e.target.value) || 2) })}
                  />
                </label>
              )}
            </>
          )}

          {scoringMode === 'rally' ? (
            <>
              <label className="wgt-ctimer-settings-row">
                Points to win
                <input type="number" min={1} className="wgt-ctimer-settings-input wgt-ctimer-settings-input--num" value={config.pointsToWin ?? 21} onChange={e => updateWidgetConfig(widgetId, { pointsToWin: Math.max(1, Number(e.target.value) || 21) })} />
              </label>
              <ToggleCard checked={config.deuceTarget != null} onChange={v => updateWidgetConfig(widgetId, v
                    ? { deuceTarget: (config.pointsToWin ?? 21) + 2, winBy2: false, pointCap: undefined }
                    : { deuceTarget: undefined })} title="Sepaktakraw-style: race straight to Points to win with no lead needed, but an exact deadlock at one point short raises the target to a fixed number instead (first to reach it wins outright)" desc="Deadlock rule (sepaktakraw-style)" />
              {config.deuceTarget != null ? (
                <label className="wgt-ctimer-settings-row">
                  Deadlock target (first to reach wins)
                  <input type="number" min={(config.pointsToWin ?? 21) + 1} className="wgt-ctimer-settings-input wgt-ctimer-settings-input--num" value={config.deuceTarget} onChange={e => updateWidgetConfig(widgetId, { deuceTarget: Math.max(1, Number(e.target.value) || (config.pointsToWin ?? 21) + 2) })} />
                </label>
              ) : (
                <>
                  <ToggleCard checked={config.winBy2 ?? true} onChange={v => updateWidgetConfig(widgetId, { winBy2: v })} desc="Win by 2" />
                  <label className="wgt-ctimer-settings-row">
                    Point cap (blank = none)
                    <input type="number" min={1} className="wgt-ctimer-settings-input wgt-ctimer-settings-input--num" value={config.pointCap ?? ''} placeholder="—" onChange={e => updateWidgetConfig(widgetId, { pointCap: e.target.value === '' ? undefined : Math.max(1, Number(e.target.value) || 1) })} />
                  </label>
                </>
              )}
              <label className="wgt-ctimer-settings-row">
                Games to win match
                <input type="number" min={1} className="wgt-ctimer-settings-input wgt-ctimer-settings-input--num" value={config.gamesToWin ?? 2} onChange={e => updateWidgetConfig(widgetId, { gamesToWin: Math.max(1, Number(e.target.value) || 2) })} />
              </label>
            </>
          ) : (
            <>
              <label className="wgt-ctimer-settings-row">
                Sets to win match
                <input type="number" min={1} className="wgt-ctimer-settings-input wgt-ctimer-settings-input--num" value={config.gamesToWin ?? 2} onChange={e => updateWidgetConfig(widgetId, { gamesToWin: Math.max(1, Number(e.target.value) || 2) })} />
              </label>
              <label className="wgt-ctimer-settings-row">
                Tiebreak at (games each)
                <input type="number" min={1} className="wgt-ctimer-settings-input wgt-ctimer-settings-input--num" value={config.tiebreakAtGames ?? 6} onChange={e => updateWidgetConfig(widgetId, { tiebreakAtGames: Math.max(1, Number(e.target.value) || 6) })} />
              </label>
              <ToggleCard checked={!!config.noAd} onChange={v => updateWidgetConfig(widgetId, { noAd: v })} desc="No-Ad scoring (sudden death at deuce)" />
            </>
          )}

          <label className="wgt-ctimer-settings-row wgt-ctimer-settings-row--check" style={{ fontSize: 14, fontWeight: 600 }}>
            <ToggleCard checked={!!config.playAllGames} className="tm-ms-sport-grid--important" onChange={v => updateWidgetConfig(widgetId, { playAllGames: v, totalGames: v ? (config.totalGames ?? (config.gamesToWin ?? 2) * 2 - 1) : config.totalGames })} title={`Play out every ${scoringMode === 'tennis' ? 'set' : 'game'} up to Total ${scoringMode === 'tennis' ? 'Sets' : 'Games'} below, even once the match is already decided — e.g. 3 games with 2 needed to win still plays the 3rd game after a 2-0 lead, instead of stopping there`} /> Play all {scoringMode === 'tennis' ? 'sets' : 'games'} (don't stop early)
          </label>
          {config.playAllGames && (
            <label className="wgt-ctimer-settings-row">
              Total {scoringMode === 'tennis' ? 'sets' : 'games'} to play
              <input
                type="number" min={config.gamesToWin ?? 2} className="wgt-ctimer-settings-input wgt-ctimer-settings-input--num"
                value={config.totalGames ?? (config.gamesToWin ?? 2) * 2 - 1}
                onChange={e => updateWidgetConfig(widgetId, { totalGames: Math.max(config.gamesToWin ?? 2, Number(e.target.value) || (config.gamesToWin ?? 2) * 2 - 1) })}
              />
            </label>
          )}

          <div className="wgt-ctimer-settings-divider" />

          <label className="wgt-ctimer-settings-row">
            Serving
            <CardSelect className="tm-ms-sport-grid--narrow" value={config.serviceMode ?? 'auto'} onChange={v => updateWidgetConfig(widgetId, { serviceMode: v })}
              options={[{ value: 'auto', label: 'Auto' }, { value: 'manual', label: 'Manual' }]} />
          </label>
          {(config.serviceMode ?? 'auto') === 'manual' ? (
            <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '-2px 0 2px' }}>
              Click the server dot next to either side, on the scoreboard itself, to set who's serving.
            </p>
          ) : scoringMode === 'rally' ? (
            <>
              <label className="wgt-ctimer-settings-row">
                Rule
                <CardSelect className="tm-ms-sport-grid--narrow" value={config.serviceRule ?? 'rally-winner'} onChange={v => updateWidgetConfig(widgetId, { serviceRule: v })}
                  options={[{ value: 'rally-winner', label: 'Winner serves (fault)' }, { value: 'alternate', label: 'Rotate after N points' }]} />
              </label>
              {(config.serviceRule ?? 'rally-winner') === 'alternate' && (
                <label className="wgt-ctimer-settings-row">
                  Attempts per turn
                  <CardSelect className="tm-ms-sport-grid--narrow" value={config.serviceAlternateEvery ?? 2} onChange={v => updateWidgetConfig(widgetId, { serviceAlternateEvery: v })}
                    options={[{ value: 1, label: 'One' }, { value: 2, label: 'Two' }]} />
                </label>
              )}
            </>
          ) : (
            <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '-2px 0 2px' }}>
              Tennis's own serve order (strict alternation by game) always applies in Auto.
            </p>
          )}

          <div className="wgt-ctimer-settings-divider" />

          <label className="wgt-ctimer-settings-row">
            Tournament
            <CustomBox>
              <select className="wgt-ctimer-settings-input" value={config.linkedTournamentId ?? ''} onChange={e => updateWidgetConfig(widgetId, { linkedTournamentId: e.target.value })}>
                <option value="">— None —</option>
                {tournaments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </CustomBox>
          </label>
          <label className="wgt-ctimer-settings-row">
            Competition
            <input className="wgt-ctimer-settings-input" value={config.competition ?? ''} onChange={e => updateWidgetConfig(widgetId, { competition: e.target.value })} />
          </label>
          <label className="wgt-ctimer-settings-row">
            Round / Subtitle
            <input className="wgt-ctimer-settings-input" value={config.subtitle ?? ''} onChange={e => updateWidgetConfig(widgetId, { subtitle: e.target.value })} />
          </label>
          <label className="wgt-ctimer-settings-row">
            Category
            <input className="wgt-ctimer-settings-input" value={config.category ?? ''} onChange={e => updateWidgetConfig(widgetId, { category: e.target.value })} />
          </label>
          <label className="wgt-ctimer-settings-row">
            Group
            <input className="wgt-ctimer-settings-input" value={config.group ?? ''} onChange={e => updateWidgetConfig(widgetId, { group: e.target.value })} />
          </label>
          <label className="wgt-ctimer-settings-row">
            Venue
            <input className="wgt-ctimer-settings-input" value={config.venue ?? ''} onChange={e => updateWidgetConfig(widgetId, { venue: e.target.value })} />
          </label>
          <label className="wgt-ctimer-settings-row">
            Date
            <input type="date" className="wgt-ctimer-settings-input" value={config.scheduledDate ?? ''} onChange={e => updateWidgetConfig(widgetId, { scheduledDate: e.target.value })} />
          </label>
          <label className="wgt-ctimer-settings-row">
            Time
            <input type="time" className="wgt-ctimer-settings-input" value={config.scheduledTime ?? ''} onChange={e => updateWidgetConfig(widgetId, { scheduledTime: e.target.value })} />
          </label>

          <div className="wgt-ctimer-settings-divider" />

          {/* Quick single-input vMix setup, right here — writes the SAME
             flat config fields (vmixInputKey/fieldScoreA/etc) the push
             effect's own legacy fallback already reads (see vmixTargets
             above), so this alone is enough to get scores flowing to vMix
             without ever opening the separate widget Settings panel. That
             panel is still where multiple inputs, Team A/B Short Name,
             Server Icon/Trigger modes, and Set Result win/lose colors live
             — genuinely advanced options, not needed for a single board
             pushing to one input. */}
          <label className="wgt-ctimer-settings-row">
            vMix Input
            <InputPickerDropdown
              currentKey={config.vmixInputKey ?? ''}
              currentTitle={config.vmixInputTitle}
              allInputs={allVmixInputs}
              onSelect={(key, title) => updateWidgetConfig(widgetId, { vmixInputKey: key, vmixInputTitle: title })}
            />
          </label>
          {config.vmixInputKey && (
            <>
              <label className="wgt-ctimer-settings-row">
                Score A Field
                <FieldPickerDropdown inputKey={config.vmixInputKey} value={config.fieldScoreA ?? ''} allInputs={allVmixInputs}
                  onChange={v => updateWidgetConfig(widgetId, { fieldScoreA: v })} placeholder="ScoreA.Text" />
              </label>
              <label className="wgt-ctimer-settings-row">
                Score B Field
                <FieldPickerDropdown inputKey={config.vmixInputKey} value={config.fieldScoreB ?? ''} allInputs={allVmixInputs}
                  onChange={v => updateWidgetConfig(widgetId, { fieldScoreB: v })} placeholder="ScoreB.Text" />
              </label>
              <label className="wgt-ctimer-settings-row">
                Team A Field
                <FieldPickerDropdown inputKey={config.vmixInputKey} value={config.fieldTeamA ?? ''} allInputs={allVmixInputs}
                  onChange={v => updateWidgetConfig(widgetId, { fieldTeamA: v })} placeholder="TeamA.Text" />
              </label>
              <label className="wgt-ctimer-settings-row">
                Team B Field
                <FieldPickerDropdown inputKey={config.vmixInputKey} value={config.fieldTeamB ?? ''} allInputs={allVmixInputs}
                  onChange={v => updateWidgetConfig(widgetId, { fieldTeamB: v })} placeholder="TeamB.Text" />
              </label>
              <label className="wgt-ctimer-settings-row">
                Team A Logo Field
                <FieldPickerDropdown inputKey={config.vmixInputKey} value={config.fieldTeamALogo ?? ''} allInputs={allVmixInputs}
                  fieldFilter={(n: string) => n.toLowerCase().endsWith('.source')}
                  onChange={v => updateWidgetConfig(widgetId, { fieldTeamALogo: v })} placeholder="TeamALogo.Source" />
              </label>
              <label className="wgt-ctimer-settings-row">
                Team B Logo Field
                <FieldPickerDropdown inputKey={config.vmixInputKey} value={config.fieldTeamBLogo ?? ''} allInputs={allVmixInputs}
                  fieldFilter={(n: string) => n.toLowerCase().endsWith('.source')}
                  onChange={v => updateWidgetConfig(widgetId, { fieldTeamBLogo: v })} placeholder="TeamBLogo.Source" />
              </label>
              <label className="wgt-ctimer-settings-row">
                Sets Won A Field
                <FieldPickerDropdown inputKey={config.vmixInputKey} value={config.fieldGamesWonA ?? ''} allInputs={allVmixInputs}
                  onChange={v => updateWidgetConfig(widgetId, { fieldGamesWonA: v })} placeholder="SetsWonA.Text" />
              </label>
              <label className="wgt-ctimer-settings-row">
                Sets Won B Field
                <FieldPickerDropdown inputKey={config.vmixInputKey} value={config.fieldGamesWonB ?? ''} allInputs={allVmixInputs}
                  onChange={v => updateWidgetConfig(widgetId, { fieldGamesWonB: v })} placeholder="SetsWonB.Text" />
              </label>
              <label className="wgt-ctimer-settings-row">
                Server Name Field
                <FieldPickerDropdown inputKey={config.vmixInputKey} value={config.fieldServerName ?? ''} allInputs={allVmixInputs}
                  onChange={v => updateWidgetConfig(widgetId, { fieldServerName: v })} placeholder="Server.Text" />
              </label>
              <label className="wgt-ctimer-settings-row">
                Set/Game Label Field
                <FieldPickerDropdown inputKey={config.vmixInputKey} value={config.fieldSetLabel ?? ''} allInputs={allVmixInputs}
                  onChange={v => updateWidgetConfig(widgetId, { fieldSetLabel: v })} placeholder="SetLabel.Text" />
              </label>
              <label className="wgt-ctimer-settings-row">
                Venue Field
                <FieldPickerDropdown inputKey={config.vmixInputKey} value={config.fieldVenue ?? ''} allInputs={allVmixInputs}
                  onChange={v => updateWidgetConfig(widgetId, { fieldVenue: v })} placeholder="Venue.Text" />
              </label>
              <label className="wgt-ctimer-settings-row">
                Date Field
                <FieldPickerDropdown inputKey={config.vmixInputKey} value={config.fieldDate ?? ''} allInputs={allVmixInputs}
                  onChange={v => updateWidgetConfig(widgetId, { fieldDate: v })} placeholder="Date.Text" />
              </label>
              <label className="wgt-ctimer-settings-row">
                Time Field
                <FieldPickerDropdown inputKey={config.vmixInputKey} value={config.fieldTime ?? ''} allInputs={allVmixInputs}
                  onChange={v => updateWidgetConfig(widgetId, { fieldTime: v })} placeholder="Time.Text" />
              </label>
              <label className="wgt-ctimer-settings-row">
                Category Field
                <FieldPickerDropdown inputKey={config.vmixInputKey} value={config.fieldCategory ?? ''} allInputs={allVmixInputs}
                  onChange={v => updateWidgetConfig(widgetId, { fieldCategory: v })} placeholder="Category.Text" />
              </label>
              <label className="wgt-ctimer-settings-row">
                Group Field
                <FieldPickerDropdown inputKey={config.vmixInputKey} value={config.fieldGroup ?? ''} allInputs={allVmixInputs}
                  onChange={v => updateWidgetConfig(widgetId, { fieldGroup: v })} placeholder="Group.Text" />
              </label>
              <label className="wgt-ctimer-settings-row">
                Sport Field
                <FieldPickerDropdown inputKey={config.vmixInputKey} value={config.fieldSport ?? ''} allInputs={allVmixInputs}
                  onChange={v => updateWidgetConfig(widgetId, { fieldSport: v })} placeholder="Sport.Text" />
              </label>
              <label className="wgt-ctimer-settings-row">
                Per-Set Score — Team A
                <FieldPickerDropdown inputKey={config.vmixInputKey}
                  value={config.setScoreTemplateA ? expandSetTemplate(config.setScoreTemplateA, 1) : ''} allInputs={allVmixInputs}
                  onChange={v => updateWidgetConfig(widgetId, { setScoreTemplateA: deriveSetTemplate(v) })} placeholder="team-a-score-s1.Text" />
              </label>
              <label className="wgt-ctimer-settings-row">
                Per-Set Score — Team B
                <FieldPickerDropdown inputKey={config.vmixInputKey}
                  value={config.setScoreTemplateB ? expandSetTemplate(config.setScoreTemplateB, 1) : ''} allInputs={allVmixInputs}
                  onChange={v => updateWidgetConfig(widgetId, { setScoreTemplateB: deriveSetTemplate(v) })} placeholder="team-b-score-s1.Text" />
              </label>
              <p className="app-settings-hint" style={{ margin: '2px 0 8px' }}>
                Per-Set Score: pick Set 1's own field — the pattern for every later set is derived from it automatically.
              </p>
              <label className="wgt-ctimer-settings-row">
                Team A Color Field Override (optional)
                <input className="wgt-ctimer-settings-input" value={config.setScoreColorFieldA ?? ''} placeholder="Leave blank to color Team A's Per-Set field above directly"
                  onChange={e => updateWidgetConfig(widgetId, { setScoreColorFieldA: e.target.value })} />
              </label>
              <label className="wgt-ctimer-settings-row">
                Team B Color Field Override (optional)
                <input className="wgt-ctimer-settings-input" value={config.setScoreColorFieldB ?? ''} placeholder="Leave blank to color Team B's Per-Set field above directly"
                  onChange={e => updateWidgetConfig(widgetId, { setScoreColorFieldB: e.target.value })} />
              </label>
              <p className="app-settings-hint" style={{ margin: '2px 0 8px' }}>
                Leave both blank — the score number's own Text field gets its font color changed directly, no extra setup needed in vMix. Only fill one in if you want a DIFFERENT element recolored instead of the score text itself.
              </p>
              <label className="wgt-ctimer-settings-row">
                Set Won Color
                <input type="color" value={config.setScoreWinColor ?? '#2ecc71'} onChange={e => updateWidgetConfig(widgetId, { setScoreWinColor: e.target.value })} />
              </label>
              <label className="wgt-ctimer-settings-row">
                Set Lost Color
                <input type="color" value={config.setScoreLoseColor ?? '#e74c3c'} onChange={e => updateWidgetConfig(widgetId, { setScoreLoseColor: e.target.value })} />
              </label>
              <p className="app-settings-hint" style={{ margin: '2px 0 8px' }}>
                The instant a set's decided, the score number itself changes to this color automatically — winner's score this color, loser's score the other. No separate trigger to set up.
              </p>
              <label className="wgt-ctimer-settings-row">
                Default Color (not yet decided)
                <input type="color" value={config.setScoreDefaultColor ?? '#ffffff'} onChange={e => updateWidgetConfig(widgetId, { setScoreDefaultColor: e.target.value })} />
              </label>
              <p className="app-settings-hint" style={{ margin: '2px 0 8px' }}>
                Applied to the set currently being played and any set not reached yet — so every box has a consistent, app-controlled color even before it's won or lost, instead of whatever color the vMix title itself defaults to.
              </p>
              <label className="wgt-ctimer-settings-row">
                Game/Set/Match Point Color
                <input type="color" value={config.pointWinColor ?? '#f1c40f'} onChange={e => updateWidgetConfig(widgetId, { pointWinColor: e.target.value })} />
              </label>
              <label className="wgt-ctimer-settings-row">
                Live Score Default Color
                <input type="color" value={config.pointDefaultColor ?? '#ffffff'} onChange={e => updateWidgetConfig(widgetId, { pointDefaultColor: e.target.value })} />
              </label>
              <p className="app-settings-hint" style={{ margin: '2px 0 8px' }}>
                Colors the LIVE Score A/B Field above the instant that side reaches a point that would win the game/set/match (same moment the on-screen badge shows) — back to Default the rest of the time.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
