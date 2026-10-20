// Pure scoring engines for set/game-based racket & net sports — badminton,
// table tennis and sepaktakraw all share one "rally point" shape of rule
// (race to N points, win by 2 unless capped, first to win a set number of
// games/sets takes the match), just different conventional N/cap/games
// numbers; tennis is different enough (games within a set, 0/15/30/40/
// deuce/advantage, tiebreaks) to need its own dedicated state machine.
// RacketScoreboardWidget.tsx owns all the actual UI/undo/persistence around
// these and only ever calls the pure reducer functions below — split out
// the same way lib/shootout.ts's penalty-shootout state machine is kept
// separate from ScoreboardWidget.tsx: a scoring RULE is worth reading and
// reasoning about on its own, independent of any rendering.

export type RacketSide = 'A' | 'B';

// ── Starters/lineup entries (name + jersey number + position) ──────────────
// Shared shape for RacketScoreboardWidget.tsx's own starter slots AND
// templateBinding.ts's CG binding fields, so both ever format one the same
// way. A starter can come from a linked SavedTeam's own roster (which
// already carries jerseyNo/position — see types/tournament.ts's Player) or
// be typed by hand on an unlinked/freeform side, where jersey/position are
// simply left blank.
export interface RacketPlayerEntry {
  name: string;
  jerseyNo?: string;
  position?: string;
}

/** Normalizes one starter slot that might still be a plain string — widgets
 *  created before jersey/position existed stored startersA/B as string[] —
 *  into the full { name, jerseyNo, position } shape, so every reader only
 *  ever has to handle one shape going forward. */
export function normalizePlayerEntry(raw: unknown): RacketPlayerEntry {
  if (typeof raw === 'string') return { name: raw };
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    return {
      name: typeof r.name === 'string' ? r.name : '',
      jerseyNo: typeof r.jerseyNo === 'string' && r.jerseyNo ? r.jerseyNo : undefined,
      position: typeof r.position === 'string' && r.position ? r.position : undefined,
    };
  }
  return { name: '' };
}

/** "#7 Lee Zii Jia (Player)" — jersey/position parts only appear when set,
 *  and an entirely empty slot (no name typed yet) formats as '' rather than
 *  a stray "#  ()", so joining a list of these with a separator never
 *  leaves visible gaps for unfilled starter slots. */
export function formatPlayerEntry(entry: RacketPlayerEntry): string {
  if (!entry.name) return '';
  const jersey = entry.jerseyNo ? `#${entry.jerseyNo} ` : '';
  const position = entry.position ? ` (${entry.position})` : '';
  return `${jersey}${entry.name}${position}`;
}

// ── Rally-point sports (badminton / table tennis / sepaktakraw) ────────────

/** Per-tournament (or per-match override) scoring settings for the rally-
 *  point sports — deliberately ONE shared shape (not three sport-specific
 *  ones) since every field here is meant to be freely customizable rather
 *  than sport-locked (the user's own ask: "customize point to win"). The
 *  four SPORT_DEFAULTS entries for badminton/table_tennis/sepaktakraw just
 *  pre-fill this with each sport's own conventional numbers. */
export interface RallyScoringSettings {
  pointsToWin: number;
  winBy2: boolean;
  /** Hard cap on a game's final score even if winBy2 is on and neither side
   *  has pulled 2 clear yet (badminton: 30 — a 29-29 game is won outright by
   *  whoever hits 30 next). Unset = no cap, the game runs until someone
   *  leads by 2 (table tennis's actual real-world rule). Ignored entirely
   *  when `deuceTarget` below is set — the two are mutually exclusive win-
   *  condition shapes, never combined. */
  pointCap?: number;
  /** Sepaktakraw's own decider rule, as an alternative to winBy2/pointCap
   *  above rather than alongside them — see isRallyGameOver's own doc
   *  comment for the full "race to pointsToWin, but a genuine deadlock at
   *  pointsToWin-1 apiece raises the target to this number instead, first
   *  to REACH it (no separate lead requirement) wins outright" rule. Unset
   *  (every non-sepaktakraw sport) keeps the classic winBy2/pointCap shape
   *  exactly as before this field existed. */
  deuceTarget?: number;
  /** Games/sets needed to WIN the match outright — 2 for a best-of-3, 3 for
   *  a best-of-5/7 (not the number of games PLAYED). */
  gamesToWin: number;
  /** When set, overrides the normal "stop the instant gamesToWin is
   *  reached" behavior — every game up to this count gets played out
   *  regardless of whether the match is already mathematically decided
   *  (e.g. 3 games total with 2 needed to win: a 2-0 lead still plays the
   *  3rd game rather than ending at 2-0). The match winner is still simply
   *  whoever won more of the games actually played once this count is
   *  reached. Unset (the default) keeps the classic "ends as soon as
   *  someone clinches it" behavior exactly as before this field existed. */
  totalGames?: number;
  /** 'auto' (default) — scoreRallyPoint updates `server` itself every point
   *  per `serviceRule` below. 'manual' — it never touches `server` at all;
   *  the operator sets it directly (RacketScoreboardWidget.tsx's own
   *  clickable server toggle). */
  serviceMode: 'auto' | 'manual';
  /** Only consulted when serviceMode is 'auto'. 'rally-winner' — whoever
   *  wins the point serves next (the server keeps serving until they lose a
   *  rally/commit a fault, at which point serve passes to the other side —
   *  a "fault" is simply the losing case of this same rule, not a separate
   *  mechanic). 'alternate' — serve rotates by a fixed point count
   *  regardless of who wins, per serviceAlternateEvery below (table
   *  tennis's real rule, and — with serviceAlternateEvery at 1 — modern
   *  sepaktakraw's own "one serve each, alternating" rule too). */
  serviceRule: 'rally-winner' | 'alternate';
  /** Only consulted when serviceRule is 'alternate' — how many points each
   *  side serves before it rotates: 1 = every point (sepaktakraw's actual
   *  rule — "satu servis sahaja berselang-seli"), 2 = the real table tennis
   *  rule. Automatically narrows to 1 once both sides reach pointsToWin-1
   *  (deuce territory) regardless of what's picked here — a no-op when
   *  already 1, but matches ITTF's own deuce serving rule for table tennis. */
  serviceAlternateEvery: 1 | 2;
}

export interface RacketGameScore { a: number; b: number; }

export interface RallyMatchState {
  pointsA: number;
  pointsB: number;
  /** Completed games/sets so far, oldest first. */
  games: RacketGameScore[];
  server: RacketSide;
  /** Set once the MATCH (not just the current game) is decided —
   *  scoreRallyPoint becomes a no-op past this point. */
  winner?: RacketSide;
}

export function initRallyMatch(firstServer: RacketSide = 'A'): RallyMatchState {
  return { pointsA: 0, pointsB: 0, games: [], server: firstServer };
}

export function rallyGamesWon(state: RallyMatchState, side: RacketSide): number {
  return state.games.filter((g) => (side === 'A' ? g.a > g.b : g.b > g.a)).length;
}

/** Is the CURRENT game (not the match) over per `settings`? A pure
 *  predicate rather than folded silently into scoreRallyPoint, so the
 *  widget can show a "Start Next Game" prompt and the just-finished score
 *  for a beat instead of the board silently resetting to 0-0 the instant
 *  the winning point lands.
 *
 *  Two entirely different win-condition SHAPES, picked by whether
 *  `deuceTarget` is set (mutually exclusive, never combined):
 *
 *  - Classic winBy2/pointCap (badminton, table tennis): first to
 *    pointsToWin wins outright UNLESS winBy2 requires a 2-clear lead, in
 *    which case play continues past pointsToWin until either that lead
 *    appears or pointCap is hit (whichever comes first) — a genuine
 *    22-20/24-22-style finish is normal, not just a deadlock escape hatch.
 *
 *  - Sepaktakraw's own deuceTarget rule: race straight to pointsToWin, NO
 *    lead requirement at all for a normal finish (14-9, 15-13, even 15-14
 *    all end the game the instant pointsToWin is reached) — UNLESS the
 *    score passes through a genuine deadlock at pointsToWin-1 apiece
 *    (14-14), which raises the target to deuceTarget (17) instead; once
 *    raised, first to REACH deuceTarget wins outright, again no separate
 *    lead requirement (17-16 ends it, not just 19-17). This is a real,
 *    different shape from win-by-2 — it needs its own branch, not a
 *    winBy2/pointCap combination. */
export function isRallyGameOver(pointsA: number, pointsB: number, settings: RallyScoringSettings): RacketSide | null {
  if (settings.deuceTarget) {
    const deadlocked = pointsA >= settings.pointsToWin - 1 && pointsB >= settings.pointsToWin - 1;
    const target = deadlocked ? settings.deuceTarget : settings.pointsToWin;
    if (pointsA >= target) return 'A';
    if (pointsB >= target) return 'B';
    return null;
  }
  const hi = Math.max(pointsA, pointsB);
  const lead = Math.abs(pointsA - pointsB);
  if (settings.pointCap && hi >= settings.pointCap) return pointsA > pointsB ? 'A' : 'B';
  if (hi >= settings.pointsToWin && (!settings.winBy2 || lead >= 2)) return pointsA > pointsB ? 'A' : 'B';
  return null;
}

/** Scores one rally point for `side` — the sole state transition a rally-
 *  point sport needs. `server` afterward depends on `settings`: 'manual'
 *  leaves it untouched; 'auto' + 'rally-winner' hands it to whoever just
 *  won (modern badminton/sepaktakraw — the point AND the serve go to the
 *  rally's winner, exactly like volleyball's own rally-point scoring, and
 *  a served fault is just the losing case of this same rule); 'auto' +
 *  'alternate' rotates it by a fixed point count regardless of who won
 *  (table tennis's actual rule — see serviceAlternateEvery's own doc
 *  comment for the deuce narrowing). Does NOT auto-start the next game —
 *  see advanceRallyGame below. */
export function scoreRallyPoint(state: RallyMatchState, side: RacketSide, settings: RallyScoringSettings): RallyMatchState {
  if (state.winner) return state; // match already decided — ignore further presses
  const pointsA = state.pointsA + (side === 'A' ? 1 : 0);
  const pointsB = state.pointsB + (side === 'B' ? 1 : 0);
  const server = nextRallyServer(state.server, pointsA, pointsB, side, settings);
  return { ...state, pointsA, pointsB, server };
}

/** A quick manual correction to `side`'s LIVE point count within the
 *  CURRENT game only — a "-1" button, or typing straight into the score
 *  display, both go through this (delta is -1 for the button, or the exact
 *  +/- difference for a typed value). Deliberately does NOT touch `server`
 *  or re-derive anything else the way scoreRallyPoint's own nextRallyServer
 *  does — this is a plain "the number was wrong, fix the number" tool, not
 *  a real scoring event. For reversing an actual just-scored point
 *  (server included) or a game/set boundary, use the real Undo button
 *  instead (RacketScoreboardWidget.tsx's own history-stack undo), which
 *  this does not replace. Clamped at 0 either way, and a no-op once the
 *  match is already decided, same as scoreRallyPoint above. */
export function adjustRallyPoint(state: RallyMatchState, side: RacketSide, delta: number): RallyMatchState {
  if (state.winner) return state;
  const pointsA = side === 'A' ? Math.max(0, state.pointsA + delta) : state.pointsA;
  const pointsB = side === 'B' ? Math.max(0, state.pointsB + delta) : state.pointsB;
  return { ...state, pointsA, pointsB };
}

function nextRallyServer(currentServer: RacketSide, pointsA: number, pointsB: number, winnerOfPoint: RacketSide, settings: RallyScoringSettings): RacketSide {
  if (settings.serviceMode === 'manual') return currentServer;
  if (settings.serviceRule !== 'alternate') return winnerOfPoint; // 'rally-winner'
  const inDeuce = pointsA >= settings.pointsToWin - 1 && pointsB >= settings.pointsToWin - 1;
  const every = inDeuce ? 1 : settings.serviceAlternateEvery;
  const totalPoints = pointsA + pointsB;
  const shouldRotate = totalPoints % every === 0;
  return shouldRotate ? (currentServer === 'A' ? 'B' : 'A') : currentServer;
}

/** Called once the operator confirms the just-finished game (or immediately,
 *  in an auto-advance UI) — files the game's final score away, resets
 *  points to 0-0, and sets `winner` once `gamesToWin` games are actually
 *  banked. No-op if the current game isn't actually over yet, or the match
 *  already is. */
export function advanceRallyGame(state: RallyMatchState, settings: RallyScoringSettings): RallyMatchState {
  if (state.winner) return state;
  const winnerSide = isRallyGameOver(state.pointsA, state.pointsB, settings);
  if (!winnerSide) return state;
  const games = [...state.games, { a: state.pointsA, b: state.pointsB }];
  const gamesA = games.filter((g) => g.a > g.b).length;
  const gamesB = games.filter((g) => g.b > g.a).length;
  // See totalGames's own doc comment — with it set, reaching gamesToWin
  // alone isn't enough to end the match early; every game up to totalGames
  // must actually be played first.
  const enoughGamesPlayed = !settings.totalGames || games.length >= settings.totalGames;
  const matchWinner = enoughGamesPlayed && (gamesA >= settings.gamesToWin || gamesB >= settings.gamesToWin)
    ? (gamesA > gamesB ? 'A' : gamesB > gamesA ? 'B' : undefined)
    : undefined;
  return {
    pointsA: 0, pointsB: 0, games,
    // Loser of the just-finished game serves first next game — the
    // universal rally-sport convention (badminton/table tennis/sepaktakraw
    // alike; volleyball is the one common exception, irrelevant here).
    // Skipped in 'manual' mode, same as every other automatic server
    // change this engine makes — see scoreRallyPoint's own nextRallyServer.
    server: settings.serviceMode === 'manual' ? state.server : (winnerSide === 'A' ? 'B' : 'A'),
    winner: matchWinner,
  };
}

// ── Tennis (games within a set, 0/15/30/40/deuce/advantage, tiebreaks) ─────

export interface TennisScoringSettings {
  /** Sets needed to WIN the match — 2 for best-of-3, 3 for best-of-5. */
  setsToWin: number;
  /** When set, overrides the normal "stop the instant setsToWin is reached"
   *  behavior — every set up to this count gets played out regardless of
   *  whether the match is already decided (e.g. 3 sets total needing 2 to
   *  win: a 2-0 lead still plays the 3rd set). The match winner is simply
   *  whoever won more of the sets actually played once this count is
   *  reached. Unset (the default) keeps the classic early-finish behavior. */
  totalSets?: number;
  /** Games level at which a tiebreak game decides the set instead of
   *  continuing advantage games indefinitely — the standard modern number
   *  is 6 (a 6-6 score plays a tiebreak to 7-6). Applied to every set
   *  including the last — a real 10-point match-tiebreak-instead-of-a-
   *  final-set variant isn't modeled (known v1 simplification). */
  tiebreakAtGames: number;
  /** "No-Ad" scoring — at 40-40 the very next point wins the game outright
   *  instead of entering Deuce/Advantage. Common in doubles and some
   *  college/league formats. */
  noAd: boolean;
  /** 'manual' disables every automatic server change this engine makes
   *  (the per-game alternation below AND the tiebreak's own per-point
   *  rotation) — the operator sets `server` directly instead. Real tennis
   *  serve order isn't actually optional, but this still exists so an
   *  operator can correct a mistake without the engine fighting back on
   *  the very next point. */
  serviceMode: 'auto' | 'manual';
}

export interface TennisSetScore {
  a: number;
  b: number;
  /** Set when this set's own final game score (e.g. 7-6) was decided by a
   *  tiebreak — lets the widget/graphic show the conventional "7-6(4)"
   *  loser's-tiebreak-points suffix via tiebreakLoserPoints. */
  tiebreak?: boolean;
  tiebreakLoserPoints?: number;
}

export interface TennisMatchState {
  /** Raw, UNCAPPED point count within the current game (not yet in a
   *  tiebreak) — deuce/advantage/40 are all derived from these two numbers
   *  by tennisPointLabel/isTennisDeuce below rather than tracked as their
   *  own separate flags, since plain point counting already produces
   *  exactly the right win/deuce/advantage behavior for free. Ignored
   *  entirely while `inTiebreak` is true — see tiebreakA/B instead. */
  pointsA: number;
  pointsB: number;
  gamesA: number;
  gamesB: number;
  setsA: number;
  setsB: number;
  sets: TennisSetScore[];
  inTiebreak: boolean;
  tiebreakA: number;
  tiebreakB: number;
  /** Who opened the CURRENT tiebreak — needed to compute every later
   *  tiebreak point's own server via tiebreakServerFor, and to determine
   *  who serves first in the NEXT set once this one ends. Undefined outside
   *  a tiebreak. */
  tiebreakFirstServer?: RacketSide;
  /** Who serves the current game, or (mid-tiebreak) the current point. */
  server: RacketSide;
  winner?: RacketSide;
}

/** Human-readable final score for one completed game/set — "21-15" for a
 *  rally sport, or tennis's own "7-6(4)" convention for a set decided by a
 *  tiebreak (the loser's own tiebreak points in parens). Shared by
 *  RacketScoreboardWidget.tsx's own on-widget results list and
 *  templateBinding.ts's 'gameResults' CG binding field, so both always
 *  agree on the exact same formatting rather than each re-deriving it. */
export function formatGameResult(g: RacketGameScore | TennisSetScore): string {
  const tiebreakSuffix = 'tiebreak' in g && g.tiebreak ? `(${g.tiebreakLoserPoints})` : '';
  return `${g.a}-${g.b}${tiebreakSuffix}`;
}

/** "8:32" under an hour, "1:08:32" once a game somehow runs that long —
 *  shared by RacketScoreboardWidget.tsx's own header timer/Match Report
 *  duration column and templateBinding.ts's 'gameTime' CG binding field,
 *  so all three always agree on the exact same format. */
export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function initTennisMatch(firstServer: RacketSide = 'A'): TennisMatchState {
  return {
    pointsA: 0, pointsB: 0, gamesA: 0, gamesB: 0, setsA: 0, setsB: 0, sets: [],
    inTiebreak: false, tiebreakA: 0, tiebreakB: 0, server: firstServer,
  };
}

/** 0/15/30/40/Ad display labels for the CURRENT game's raw point counts —
 *  see TennisMatchState.pointsA's own doc comment for why these are
 *  DERIVED rather than stored directly. Both sides show "40" at an actual
 *  deuce (3-3 raw) — isTennisDeuce below is how the widget knows to show a
 *  shared "DEUCE" badge instead of two plain "40"s at that exact point. */
export function tennisPointLabel(pointsA: number, pointsB: number): { a: string; b: string } {
  if (pointsA >= 3 && pointsB >= 3) {
    if (pointsA === pointsB) return { a: '40', b: '40' };
    return pointsA > pointsB ? { a: 'Ad', b: '40' } : { a: '40', b: 'Ad' };
  }
  const LABELS = ['0', '15', '30', '40'];
  return { a: LABELS[Math.min(pointsA, 3)], b: LABELS[Math.min(pointsB, 3)] };
}

export function isTennisDeuce(pointsA: number, pointsB: number): boolean {
  return pointsA >= 3 && pointsA === pointsB;
}

function isTennisGameWon(pointsA: number, pointsB: number, noAd: boolean): RacketSide | null {
  const hi = Math.max(pointsA, pointsB);
  if (hi < 4) return null;
  // noAd: the first side to reach 4 always wins outright, whatever the
  // exact lead — since points only ever increment by exactly one per call
  // starting from 0-0, the FIRST moment either side's count reaches 4 is
  // necessarily also the very next point after any 3-3 (deuce-equivalent)
  // tie, i.e. tennis's own "sudden death at 40-40" rule for free.
  if (noAd) return pointsA > pointsB ? 'A' : 'B';
  if (Math.abs(pointsA - pointsB) >= 2) return pointsA > pointsB ? 'A' : 'B';
  return null;
}

/** Real tiebreak serve rotation: the player who'd have served the next game
 *  serves the breaker's own point 1 alone, then serve alternates every 2
 *  points from there (point 2-3 the other player, 4-5 back, 6-7 the other,
 *  …). Returns who serves point number `n` (1-indexed) of the tiebreak. */
function tiebreakServerFor(n: number, firstServer: RacketSide): RacketSide {
  if (n <= 1) return firstServer;
  const other: RacketSide = firstServer === 'A' ? 'B' : 'A';
  const pairIndex = Math.floor((n - 2) / 2);
  return pairIndex % 2 === 0 ? other : firstServer;
}

/** Shared by both of scoreTennisPoint's own set-ending branches below (a
 *  tiebreak-decided set and an ordinary one) — see totalSets's own doc
 *  comment: with it set, reaching setsToWin alone isn't enough to end the
 *  match early; every set up to totalSets must actually be played first. */
function tennisMatchWinner(setsA: number, setsB: number, setsPlayed: number, settings: TennisScoringSettings): RacketSide | undefined {
  const enoughSetsPlayed = !settings.totalSets || setsPlayed >= settings.totalSets;
  if (!enoughSetsPlayed || (setsA < settings.setsToWin && setsB < settings.setsToWin)) return undefined;
  return setsA > setsB ? 'A' : setsB > setsA ? 'B' : undefined;
}

/** Scores one point for `side` — routes to tiebreak or ordinary-game
 *  scoring depending on `state.inTiebreak`, and transparently handles every
 *  game→set→match boundary (entering a tiebreak at e.g. 6-6, closing a set,
 *  closing the match) in one call, so the widget never has to sequence
 *  multiple "advance" steps itself the way the rally-sport engine's
 *  scoreRallyPoint/advanceRallyGame split needs (a tennis GAME's own
 *  ending is unambiguous and instant — there's no "confirm before
 *  advancing" beat worth adding on top of the sport's own already-eventful
 *  deuce/tiebreak drama). */
export function scoreTennisPoint(state: TennisMatchState, side: RacketSide, settings: TennisScoringSettings): TennisMatchState {
  if (state.winner) return state;

  if (state.inTiebreak) {
    const tiebreakA = state.tiebreakA + (side === 'A' ? 1 : 0);
    const tiebreakB = state.tiebreakB + (side === 'B' ? 1 : 0);
    const n = tiebreakA + tiebreakB;
    const hi = Math.max(tiebreakA, tiebreakB);
    const lead = Math.abs(tiebreakA - tiebreakB);
    if (hi >= 7 && lead >= 2) {
      const winnerSide: RacketSide = tiebreakA > tiebreakB ? 'A' : 'B';
      const gamesA = winnerSide === 'A' ? state.gamesA + 1 : state.gamesA;
      const gamesB = winnerSide === 'B' ? state.gamesB + 1 : state.gamesB;
      const sets = [...state.sets, { a: gamesA, b: gamesB, tiebreak: true, tiebreakLoserPoints: Math.min(tiebreakA, tiebreakB) }];
      const setsA = sets.filter((s) => s.a > s.b).length;
      const setsB = sets.filter((s) => s.b > s.a).length;
      const matchWinner = tennisMatchWinner(setsA, setsB, sets.length, settings);
      return {
        ...state, pointsA: 0, pointsB: 0, gamesA: 0, gamesB: 0, sets, setsA, setsB,
        inTiebreak: false, tiebreakA: 0, tiebreakB: 0, tiebreakFirstServer: undefined,
        // Whoever did NOT open this tiebreak serves first next set — the
        // real rule (serve keeps strictly alternating THROUGH the breaker
        // as if every point were its own mini-game). Skipped in 'manual'.
        server: settings.serviceMode === 'manual' ? state.server : (state.tiebreakFirstServer === 'A' ? 'B' : 'A'),
        winner: matchWinner,
      };
    }
    // Manual mode skips the tiebreak's own per-point rotation too — same
    // "the engine never touches server on its own" contract as everywhere
    // else in this function.
    const tbServer = settings.serviceMode === 'manual' ? state.server : tiebreakServerFor(n + 1, state.tiebreakFirstServer ?? state.server);
    return { ...state, tiebreakA, tiebreakB, server: tbServer };
  }

  const pointsA = state.pointsA + (side === 'A' ? 1 : 0);
  const pointsB = state.pointsB + (side === 'B' ? 1 : 0);
  const gameWinner = isTennisGameWon(pointsA, pointsB, settings.noAd);
  if (!gameWinner) return { ...state, pointsA, pointsB };

  const gamesA = gameWinner === 'A' ? state.gamesA + 1 : state.gamesA;
  const gamesB = gameWinner === 'B' ? state.gamesB + 1 : state.gamesB;
  // Serve ALWAYS alternates by game boundary in tennis, regardless of who
  // just won it — unlike the rally sports above, never "winner serves".
  // Skipped in 'manual' mode, same as every server change in this function.
  const nextServer: RacketSide = settings.serviceMode === 'manual' ? state.server : (state.server === 'A' ? 'B' : 'A');

  if (gamesA === gamesB && gamesA === settings.tiebreakAtGames) {
    return { ...state, pointsA: 0, pointsB: 0, gamesA, gamesB, server: nextServer, inTiebreak: true, tiebreakA: 0, tiebreakB: 0, tiebreakFirstServer: nextServer };
  }

  // A set that DIDN'T just enter a tiebreak (the tie-at-threshold case is
  // already handled above) is over exactly when the leader has reached the
  // threshold with a 2-game cushion — 6-4/6-3/…/6-0, or 7-5 by way of 6-5.
  const setOver = Math.max(gamesA, gamesB) >= settings.tiebreakAtGames && Math.abs(gamesA - gamesB) >= 2;
  if (!setOver) return { ...state, pointsA: 0, pointsB: 0, gamesA, gamesB, server: nextServer };

  const sets = [...state.sets, { a: gamesA, b: gamesB }];
  const setsA = sets.filter((s) => s.a > s.b).length;
  const setsB = sets.filter((s) => s.b > s.a).length;
  const matchWinner = tennisMatchWinner(setsA, setsB, sets.length, settings);
  return { ...state, pointsA: 0, pointsB: 0, gamesA: 0, gamesB: 0, sets, setsA, setsB, server: nextServer, winner: matchWinner };
}

/** Tennis's own version of adjustRallyPoint above — a quick manual "-1"/
 *  typed correction to `side`'s LIVE point count (or tiebreak count, while
 *  inTiebreak) within the CURRENT game only, never touching server or any
 *  game/set boundary. Same scope and same caveat: not a replacement for
 *  the real Undo (history-stack) button, which alone correctly reverses an
 *  actual scored point OR a game/set boundary. */
export function adjustTennisPoint(state: TennisMatchState, side: RacketSide, delta: number): TennisMatchState {
  if (state.winner) return state;
  if (state.inTiebreak) {
    const tiebreakA = side === 'A' ? Math.max(0, state.tiebreakA + delta) : state.tiebreakA;
    const tiebreakB = side === 'B' ? Math.max(0, state.tiebreakB + delta) : state.tiebreakB;
    return { ...state, tiebreakA, tiebreakB };
  }
  const pointsA = side === 'A' ? Math.max(0, state.pointsA + delta) : state.pointsA;
  const pointsB = side === 'B' ? Math.max(0, state.pointsB + delta) : state.pointsB;
  return { ...state, pointsA, pointsB };
}
