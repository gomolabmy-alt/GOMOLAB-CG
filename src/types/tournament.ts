import type { ActionItem } from '../lib/buttonActions';

export type SportType =
  | 'football'
  | 'basketball'
  | 'rugby_union'
  | 'rugby_league'
  | 'volleyball'
  | 'handball'
  | 'ice_hockey'
  | 'futsal'
  | 'badminton'
  | 'table_tennis'
  | 'tennis'
  | 'sepaktakraw'
  | 'custom';

export interface Player {
  id: string;
  jerseyNo: string;
  name: string;
  position: string;
  /** Cumulative match stats — same field set as the external roster API
   *  (see src/lib/externalRoster.ts), which is where these are normally
   *  populated from via the Players tab's "Pull from API"; can also be
   *  edited by hand. All optional/undefined until set — most sports and
   *  most players will simply never have these. */
  tries?: number;
  conversions?: number;
  penalties?: number;
  dropGoals?: number;
  yellowCards?: number;
  redCards?: number;
  appearances?: number;
}

export interface StaffMember {
  id: string;
  role: string;
  name: string;
}

export const DEFAULT_STAFF_ROLES = ['Head Coach', 'Manager', 'Medic'];

export interface TournamentGroup {
  /** Display name, e.g. "Group A" — also the value stored in SavedTeam.group. */
  name: string;
  /** Short code prefixed to each team's position within this group (e.g.
   *  prefix "A" + position 1 = "A1") — freely customizable, defaults to the
   *  name's first letter when unset. */
  prefix?: string;
  /** Max team count for this group — the draw won't assign more teams to it
   *  once reached. Unset = unlimited. */
  capacity?: number;
  /** Which Tournament.categories entry this group belongs to (e.g. "Men") —
   *  unset means shared/visible under any category tab in the Draw tab. */
  category?: string;
}

export interface TournamentPot {
  /** Display name, e.g. "Pot 1" — also the value stored in SavedTeam.pot. */
  name: string;
  /** Which Tournament.categories entry this pot belongs to — unset means
   *  shared/visible under any category tab in the Draw tab. */
  category?: string;
}

// A Tournament is a competition/league container — it no longer owns a fixed
// Team A / Team B. Teams belong to a tournament via SavedTeam.tournamentId
// (teamDbStore) and can be any number; widgets reference a specific team by id.
export interface Tournament {
  id: string;
  name: string;
  sport: SportType;
  settings: TournamentSettings;
  createdAt: number;
  /** This tournament's own badge/crest — shown in the title bar's
   *  Tournament picker, the Match Settings panel, and anywhere else a
   *  tournament needs a visual identity distinct from any one team's own
   *  logo (same LogoUrlPicker/server image library every team logo already
   *  uses). Absent = no tournament logo shown (falls back to the generic
   *  Trophy icon wherever one would otherwise render). */
  logo?: string;
  /** Preliminary-draw / pool groups (e.g. "Pool A", "Pool B") — freely added
   *  and removed, teams are assigned to one via SavedTeam.group (which stores
   *  the group's `name`). Standings are computed per group when this is
   *  non-empty, otherwise as one table. */
  groups?: TournamentGroup[];
  /** Seeding pots for the live draw (e.g. "Pot 1", "Pot 2") — teams are
   *  pre-assigned to a pot via SavedTeam.pot before drawing; the draw then
   *  randomly places one team per pot into each group in turn. */
  pots?: TournamentPot[];
  /** Freely-defined competition categories (e.g. "Men", "Women", "U21") —
   *  teams are assigned to one via SavedTeam.category. A club entering more
   *  than one category duplicates its team entry per category since rosters
   *  differ (see teamDbStore.duplicateTeam). */
  categories?: string[];
  /** Per-category badge/crest (e.g. a Men's/Women's division each getting
   *  its own mark distinct from the tournament's own overall `logo` above)
   *  — keyed by category name, same `Record<categoryName, value>`
   *  convention `venuePrefixes` below already uses. A category with no
   *  entry here simply has no logo of its own (falls back to the
   *  tournament's own `logo`, same precedence CG template bindings
   *  already apply for "nothing more specific is set"). */
  categoryLogos?: Record<string, string>;
  /** Pushes this tournament's own `logo` to one or more vMix image fields —
   *  same manual "Push" button + input/field picker as groupListVmix below,
   *  just for a single static image rather than a numbered list. */
  logoVmix?: TournamentLogoVmixTarget[];
  /** Pushes a specific category's own `categoryLogos[category]` to a vMix
   *  image field — one target per category since each needs its own
   *  input/field (unlike `logoVmix`, which always pushes the same tournament
   *  logo). Falls back to the tournament's own `logo` when that category has
   *  no logo of its own, same precedence `categoryLogos`' own doc comment
   *  and the CG template binding (lib/templateBinding.ts's
   *  resolveTournamentFieldValue) already apply. */
  categoryLogoVmix?: CategoryLogoVmixTarget[];
  /** Freely-defined venues (e.g. "Court 1", "Main Hall") — each fixture in
   *  the Schedule tab picks one via ScheduledMatch.venue. Lets a multi-venue
   *  tournament's schedule be filtered down to a single venue per physical
   *  install (see appSettingsStore's canvasTournamentId/canvasVenue). */
  venues?: string[];
  /** Per-venue short code (e.g. "Court 1" → "B") used to build each
   *  fixture's auto match number — keyed by venue name, matching `venues`.
   *  Only meaningful when matchNumberPrefix is set. */
  venuePrefixes?: Record<string, string>;
  /** Base prefix for auto-generated fixture match numbers (e.g. "M" gives
   *  "MB1", "MC2"...) — the number is one running sequence across the whole
   *  schedule in running order regardless of venue; the letter reflects
   *  each fixture's own venue (see src/utils/matchNumber.ts). Empty/
   *  undefined turns the whole match-number feature off. */
  matchNumberPrefix?: string;
  /** How the next team is picked from the current pot — 'random' (default)
   *  picks blindly; 'manual' lets the operator click a specific team chip in
   *  the current pot to draw it (e.g. a physical ball was already pulled by
   *  hand and just needs recording). */
  drawTeamMode?: 'random' | 'manual';
  /** vMix field mapping pushed in real time as each team is drawn, for an
   *  on-air draw graphic — plain text since this is a small, occasional
   *  setup step rather than something needing a full input/field picker. */
  drawVmix?: {
    inputKey?: string;
    fieldTeamName?: string;
    fieldTeamShort?: string;
    fieldTeamLogo?: string;
    fieldGroup?: string;
    fieldPot?: string;
    /** Fired (in addition to the plain field push above) whenever a team
     *  becomes the ARMED one — selected, about to be paired with a
     *  group/slot — e.g. an OverlayIn, or a SetColor highlighting its own
     *  on-air card. Same ActionListEditor/ActionItem list every Button
     *  press/release action already uses. */
    activeActions?: ActionItem[];
    /** Fired whenever a team goes back to just sitting in its pot —
     *  un-armed (deselected without being placed) or simply never picked
     *  yet. The natural "reset" state between Active and Assigned. */
    inactiveActions?: ActionItem[];
    /** Fired once a team is actually placed into a group/slot — e.g. an
     *  OverlayOut (it's done, no longer "in the pot") or a different
     *  SetColor marking it as settled rather than still live. */
    assignedActions?: ActionItem[];
  };
  /** Pushes a whole group's team list to numbered vMix text fields, one
   *  target per on-air "Group A" style title — same numbered-prefix setup as
   *  the Player List widget's vMix Name Sync (pick/type e.g. "Team1.Text"
   *  and the digit + ".Text" suffix is stripped to a reusable prefix, so
   *  team N lands in `{prefix}N.Text`). */
  groupListVmix?: GroupListVmixTarget[];
  /** Pushes a pot's current team list (teams tagged with that pot via
   *  SavedTeam.pot, filtered to ones still awaiting the draw — i.e.
   *  `!t.group`) to numbered vMix text fields — same prefix/autoSync shape
   *  as `groupListVmix` above, so an on-air "who's still in the pot" list
   *  can be either manually pushed or kept auto-filled with each team's
   *  own name live as the draw pulls teams out of it. Unlike a group, a pot
   *  has no explicit per-team slot/position (SavedTeam has no
   *  `potPosition` the way `groupPosition` exists for groups) — teams are
   *  numbered in plain array order, renumbering live as the draw removes
   *  them, not fixed slots with gaps. */
  potListVmix?: PotListVmixTarget[];
  /** Multi-venue cloud sync opt-in — local-only, deliberately never
   *  overwritten by an incoming cloud pull (see src/lib/cloudSync.ts), so
   *  each device decides independently whether its edits to this tournament
   *  get shared. A tournament that arrives via a pull (created by another
   *  venue) starts with this true, since its presence in the cloud already
   *  means some venue opted it in. */
  cloudSyncEnabled?: boolean;
  /** The eventmanagementsystem Event this tournament is linked to (via
   *  "Load Shared Event") — lets the website's live scoring overview page
   *  find this tournament's data. Undefined for a purely local tournament. */
  eventId?: string;
  /** The linked event's name, captured at link time purely for display (so
   *  the toolbar can show which event without re-fetching the event list). */
  eventName?: string;
  /** Cross-venue sharing key (see the event page's "Cross-Venue Key" button
   *  on the website) — only set when `eventId` points to an event owned by
   *  a DIFFERENT vendor than this device's own. Re-sent with every push so
   *  the link keeps working (or stops, if the key's since been revoked/
   *  regenerated) without needing to re-enter it. Undefined for an
   *  own-vendor event link, which needs no key at all. */
  eventShareKey?: string;
  /** True for a tournament that arrived via cloud pull from a DIFFERENT
   *  vendor (a cross-venue event link someone else set up) — read-only:
   *  never included in a push regardless of cloudSyncEnabled, since this
   *  device doesn't own it and the server would reject the write anyway.
   *  Undefined/false for anything actually owned by this device's vendor. */
  foreignVendor?: boolean;
  /** Links this tournament to a same-event tournament on an external public
   *  roster API (currently: AthleticaOS's `/api/public/tournaments/{id}` and
   *  `/api/public/teams/{slug}` endpoints — no auth, read-only) so the
   *  Players tab can pull real player names into a team's roster instead of
   *  typing them in by hand. Set once via "Link roster API"; unset to
   *  disable the feature for this tournament. */
  externalRoster?: ExternalRosterSource;
}

export interface ExternalRosterSource {
  /** Origin the tournament/team endpoints live under, e.g.
   *  "https://staging-api.athleticaos.com" — captured from whatever URL the
   *  user pasted in, so this keeps working if they're on a different
   *  environment (staging vs. production) than the example. */
  baseUrl: string;
  /** The external tournament's own id (not this app's Tournament.id). */
  tournamentId: string;
  /** Cached display label only — refreshed each time the link is (re)set,
   *  never trusted for anything but showing "linked to X" in the UI. */
  tournamentName?: string;
}

export interface GroupListVmixTarget {
  id: string;
  /** Which group's team list (in prefix/position order) this target pushes. */
  group: string;
  inputKey?: string;
  /** e.g. "Team" → writes Team1.Text, Team2.Text, … for each team in the group. */
  fieldPrefix?: string;
  /** e.g. "Short" → writes Short1.Text, Short2.Text, … (optional). */
  fieldShortPrefix?: string;
  /** e.g. "Logo" → writes Logo1.Source, Logo2.Source, … (optional, image field). */
  fieldLogoPrefix?: string;
  /** Push automatically whenever this group's membership changes. */
  autoSync?: boolean;
  /** When on, an empty slot's `fieldPrefix`/`fieldShortPrefix` field writes
   *  that slot's own label (the group's `prefix` + 1-based position, e.g.
   *  "A1", "A2" — see TournamentGroup.prefix) instead of an empty string,
   *  so an on-air graphic reads "A1" before the draw and the real team
   *  name once the draw actually fills that slot — the SAME field replaces
   *  its own text, not a second one appearing alongside it. Off (default)
   *  keeps the original behavior: an empty string for an unfilled slot. */
  showSlotLabelWhenEmpty?: boolean;
}

export interface PotListVmixTarget {
  id: string;
  /** Which pot's team list this target pushes. Matches a Tournament.pots[]
   *  entry's own `name` / SavedTeam.pot value exactly. */
  pot: string;
  inputKey?: string;
  /** e.g. "Team" → writes Team1.Text, Team2.Text, … — one FIXED slot per
   *  team ever assigned to this pot (SavedTeam.pot is never cleared when a
   *  team is drawn into a group, so "every team with this `pot` value,
   *  in stable order" is a constant-size roster for the whole tournament,
   *  unlike `group`, which has no such anchor). A team keeps the SAME slot
   *  number the whole time, before and after being drawn — this is what
   *  makes `activeActions`/`inactiveActions` below meaningful (a given
   *  slot's own "Active"/"Inactive" state), rather than slots shrinking
   *  and renumbering as teams leave the pot, which would leave nothing
   *  stable to attach a per-slot state to. The field itself goes BLANK
   *  once that team is drawn (see `t.group` set — unless
   *  `clearFieldsWhenDrawn` below is off), same "no stale info in a
   *  vacated slot" convention logo fields across this app already use. */
  fieldPrefix?: string;
  /** e.g. "Short" → writes Short1.Text, Short2.Text, … (optional). Same
   *  fixed-slot/blank-when-drawn convention as `fieldPrefix` above. */
  fieldShortPrefix?: string;
  /** e.g. "Logo" → writes Logo1.Source, Logo2.Source, … (optional, image
   *  field). Same fixed-slot convention — goes to the transparent
   *  placeholder once drawn, same as every other logo field in this app. */
  fieldLogoPrefix?: string;
  /** Whether `fieldPrefix`/`fieldShortPrefix`/`fieldLogoPrefix` above go
   *  BLANK (text) / transparent (logo) once a slot's own team is drawn.
   *  Absent/true = clear them (the original behavior). False = leave
   *  whatever was last pushed there untouched once drawn — for an
   *  operator who'd rather drive that slot's own look ENTIRELY through
   *  `inactiveActions` below (e.g. an action list that recolors the text
   *  instead of blanking it, or targets a completely different layer)
   *  instead of this automatic clear fighting with it. */
  clearFieldsWhenDrawn?: boolean;
  /** Push automatically whenever this pot's membership changes — e.g. a
   *  team being drawn out of it. Also fires `activeActions`/
   *  `inactiveActions` below for every slot, same trigger. */
  autoSync?: boolean;
  /** Fired once per slot (1..N, the fixed roster — see `fieldPrefix`'s own
   *  doc comment) whenever that slot's own team is still sitting in this
   *  pot (not yet drawn) — same ActionItem list/ActionListEditor shape the
   *  Draw tab's own Multi-State (Tournament.drawVmix.activeActions) already
   *  uses, just fired per numbered slot instead of for a single "currently
   *  armed" team. Each action's own `Input` param is overridden to this
   *  target's own `inputKey` at fire time (no separate input to pick — see
   *  CollapsibleSection's own UI), and any literal `{n}` token anywhere in
   *  an action's `fn` or any param VALUE is replaced with that slot's own
   *  1-based number first — e.g. an action configured as `fn: "SetColor"`,
   *  `params: { SelectedName: "Color{n}" }` becomes `SetColor` on
   *  `Color3` for slot 3; `fn: "OverlayInput{n}In"` becomes
   *  `OverlayInput3In`. See TournamentManager.tsx's own applySlotTemplate. */
  activeActions?: ActionItem[];
  /** Same shape as `activeActions`, fired instead once that slot's own
   *  team has been drawn out of this pot (its `group` is set). */
  inactiveActions?: ActionItem[];
}

export interface TournamentLogoVmixTarget {
  id: string;
  inputKey?: string;
  /** e.g. "Logo.Source" — the vMix SetImage field name this target writes. */
  fieldName?: string;
}

export interface CategoryLogoVmixTarget {
  id: string;
  /** Matches a Tournament.categories[] entry exactly. */
  category: string;
  inputKey?: string;
  /** e.g. "Logo.Source" — the vMix SetImage field name this target writes. */
  fieldName?: string;
}

export const SPORT_LABELS: Record<SportType, string> = {
  football:    'Football / Soccer',
  basketball:  'Basketball',
  rugby_union: 'Rugby Union',
  rugby_league:'Rugby League',
  volleyball:  'Volleyball',
  handball:    'Handball',
  ice_hockey:  'Ice Hockey',
  futsal:      'Futsal',
  badminton:    'Badminton',
  table_tennis: 'Table Tennis',
  tennis:       'Tennis',
  sepaktakraw:  'Sepaktakraw',
  custom:      'Custom',
};

export const SPORT_POSITIONS: Record<SportType, string[]> = {
  football:    ['GK','CB','LB','RB','LM','CM','RM','CAM','LW','RW','ST','CF'],
  basketball:  ['PG','SG','SF','PF','C'],
  rugby_union: ['Prop','Hooker','Lock','Flanker','No.8','Scrum-half','Fly-half','Centre','Wing','Fullback'],
  rugby_league:['Prop','Hooker','Second-row','Loose Fwd','Halfback','Stand-off','Centre','Wing','Fullback'],
  volleyball:  ['Setter','Outside Hitter','Middle Blocker','Opposite','Libero'],
  handball:    ['GK','Left Wing','Right Wing','Left Back','Right Back','Pivot','Centre Back'],
  ice_hockey:  ['G','LD','RD','LW','RW','C'],
  futsal:      ['Goalkeeper','Fixo','Ala','Pivô'],
  // Singles/doubles racket sports have no specialist "positions" the way an
  // invasion sport does — a roster slot is just "Player" regardless of
  // singles or doubles. Sepaktakraw is the one exception: a regu (team of
  // 3 on court) has real, named roles.
  badminton:    ['Player'],
  table_tennis: ['Player'],
  tennis:       ['Player'],
  sepaktakraw:  ['Tekong','Apit Kiri','Apit Kanan'],
  custom:      [],
};

/** Rugby's own position sets by format — Sevens/Tens field far fewer
 *  specialist roles than the standard Fifteens list above, so a team
 *  playing a shortened format gets its own, non-Fifteens suggestions
 *  rather than a long list of positions it doesn't use (see the "Format"
 *  quick-fill buttons in Tournament Settings, which set Starters to
 *  7/10/15 — getRosterPositions below keys off that same number). */
export const RUGBY_SEVENS_POSITIONS = ['Prop','Hooker','Scrum-half','Fly-half','Centre','Wing'];
export const RUGBY_TENS_POSITIONS = ['Prop','Hooker','Flanker','No.8','Scrum-half','Fly-half','Centre','Wing','Fullback'];

/** Position autocomplete list for a team's roster — same as SPORT_POSITIONS
 *  for every sport, except rugby (union or league), where a 7 or 10
 *  Starters count (Sevens/Tens format) swaps in that format's own shorter
 *  position list instead of the full Fifteens/League one. */
export function getRosterPositions(sport: SportType, maxOnField: number): string[] {
  if (sport === 'rugby_union' || sport === 'rugby_league') {
    if (maxOnField === 7) return RUGBY_SEVENS_POSITIONS;
    if (maxOnField === 10) return RUGBY_TENS_POSITIONS;
  }
  return SPORT_POSITIONS[sport] ?? [];
}

export const SPORT_MAX_ON_FIELD: Record<SportType, number> = {
  football:    11,
  basketball:  5,
  rugby_union: 15,
  rugby_league:13,
  volleyball:  6,
  handball:    7,
  ice_hockey:  6,
  futsal:      5,
  badminton:    2, // doubles — 1 for singles, picked per-match, not per-roster
  table_tennis: 2,
  tennis:       2,
  sepaktakraw:  3, // a regu (on-court team) is 3: Tekong + 2 Apit
  custom:      11,
};

/** Set/game scoring rules for the racket & net sports (badminton, table
 *  tennis, tennis, sepaktakraw) — see lib/racketScoring.ts for the actual
 *  pure scoring engines this configures, and RacketScoreboardWidget.tsx for
 *  the live match-control widget that plays through them. Optional on
 *  TournamentSettings (every pre-existing sport leaves it undefined) and
 *  freely editable regardless of `sport` — SPORT_DEFAULTS below only
 *  pre-fills each new sport's own conventional numbers as a starting point,
 *  per the user's own ask that every number here be customizable rather
 *  than sport-locked. */
export interface RacketSportSettings {
  /** 'rally' = badminton/table tennis/sepaktakraw's shared "race to N
   *  points" shape (lib/racketScoring.ts's RallyScoringSettings, which
   *  pointsToWin/winBy2/pointCap/gamesToWin below map directly onto).
   *  'tennis' = games/sets/deuce/tiebreak (TennisScoringSettings — reuses
   *  gamesToWin below as tennis's own "sets needed to win the match", same
   *  MEANING just a different unit, and adds tiebreakAtGames/noAd). */
  mode: 'rally' | 'tennis';
  pointsToWin: number;
  winBy2: boolean;
  pointCap?: number;
  /** Rally sports only — sepaktakraw's own decider rule, an alternative to
   *  winBy2/pointCap above rather than combined with them: race straight to
   *  pointsToWin (no lead needed for a normal finish), but a genuine
   *  deadlock at pointsToWin-1 apiece raises the target to this number
   *  instead (first to REACH it wins, still no lead requirement). See
   *  lib/racketScoring.ts's isRallyGameOver for the full rule. Unset for
   *  every other sport, which keeps the classic winBy2/pointCap shape. */
  deuceTarget?: number;
  /** Rally sports: games/sets needed to win the MATCH. Tennis: sets needed
   *  to win the match (2 for best-of-3, 3 for best-of-5). */
  gamesToWin: number;
  /** Tennis only. */
  tiebreakAtGames: number;
  noAd: boolean;
  /** 'auto' (default) — the engine updates who's serving on its own, every
   *  point, per serviceRule below. 'manual' — it never touches server on
   *  its own at all; the operator sets it by clicking the server indicator
   *  directly on the widget (see RacketScoreboardWidget.tsx). Applies to
   *  BOTH engines — tennis's own serve order is fixed by the actual rules
   *  (strict alternation by game), so 'auto' there just means "don't fight
   *  a manual correction", not a configurable rule the way rally sports'
   *  serviceRule is. */
  serviceMode: 'auto' | 'manual';
  /** Rally sports only (badminton/table tennis/sepaktakraw) — which real
   *  rule 'auto' mode follows. 'rally-winner': whoever wins the point
   *  serves next — the real badminton/sepaktakraw rule (the server keeps
   *  serving until they lose a rally/commit a fault, at which point serve
   *  passes to the other side). 'alternate': serve rotates by a fixed
   *  point count regardless of who wins, per serviceAlternateEvery below —
   *  table tennis's actual rule. */
  serviceRule: 'rally-winner' | 'alternate';
  /** Only consulted when serviceRule is 'alternate' — how many points each
   *  side serves before it rotates: 1 = every point, 2 = the real table
   *  tennis rule (narrows to 1 automatically once both sides reach
   *  pointsToWin-1, i.e. deuce territory, matching ITTF's own deuce
   *  serving rule regardless of what's picked here). */
  serviceAlternateEvery: 1 | 2;
}

export interface TournamentSettings {
  periods: number;
  periodDurationMs: number;
  halfTimeDurationMs: number;
  maxOnField: number;
  maxSubs: number;
  timerMode: 'countup' | 'countdown';
  /** Winning score auto-applied when a fixture is marked Bye/Walkover in the
   *  Schedule tab (loser always gets 0) — per-tournament since the
   *  convention varies by sport/competition (e.g. rugby often uses 21 or 28;
   *  a racket sport's own walkover is instead expressed as its own
   *  `racketScoring.gamesToWin`, e.g. a 2-0 badminton walkover, so this
   *  field is simply unused whenever `racketScoring` is set). */
  walkoverWinScore: number;
  /** Standings points per outcome — varies by sport/competition convention
   *  (e.g. rugby union commonly 4/2/0, football 3/1/0). Bonus points aren't
   *  modeled; walkovers count as a normal win/loss, byes don't count at all. */
  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;
  /** Set/game scoring rules — only meaningful (and only ever set) for the
   *  racket & net sports; see RacketSportSettings' own doc comment. */
  racketScoring?: RacketSportSettings;
}

export const SPORT_DEFAULTS: Record<SportType, TournamentSettings> = {
  football:    { periods: 2, periodDurationMs: 2700000, halfTimeDurationMs:  900000, maxOnField: 11, maxSubs:  9, timerMode: 'countup',   walkoverWinScore: 3,  pointsWin: 3, pointsDraw: 1, pointsLoss: 0 },
  basketball:  { periods: 4, periodDurationMs:  720000, halfTimeDurationMs:  120000, maxOnField:  5, maxSubs:  7, timerMode: 'countdown', walkoverWinScore: 20, pointsWin: 2, pointsDraw: 0, pointsLoss: 0 },
  rugby_union: { periods: 2, periodDurationMs: 2400000, halfTimeDurationMs:  600000, maxOnField: 15, maxSubs:  8, timerMode: 'countup',   walkoverWinScore: 28, pointsWin: 4, pointsDraw: 2, pointsLoss: 0 },
  rugby_league:{ periods: 2, periodDurationMs: 2400000, halfTimeDurationMs:  600000, maxOnField: 13, maxSubs:  4, timerMode: 'countup',   walkoverWinScore: 28, pointsWin: 2, pointsDraw: 1, pointsLoss: 0 },
  volleyball:  { periods: 5, periodDurationMs:       0, halfTimeDurationMs:  120000, maxOnField:  6, maxSubs:  6, timerMode: 'countup',   walkoverWinScore: 3,  pointsWin: 3, pointsDraw: 0, pointsLoss: 0 },
  handball:    { periods: 2, periodDurationMs: 1800000, halfTimeDurationMs:  600000, maxOnField:  7, maxSubs:  7, timerMode: 'countup',   walkoverWinScore: 10, pointsWin: 2, pointsDraw: 1, pointsLoss: 0 },
  ice_hockey:  { periods: 3, periodDurationMs: 1200000, halfTimeDurationMs:  900000, maxOnField:  6, maxSubs: 14, timerMode: 'countdown', walkoverWinScore: 5,  pointsWin: 2, pointsDraw: 1, pointsLoss: 0 },
  futsal:      { periods: 2, periodDurationMs: 1200000, halfTimeDurationMs:  600000, maxOnField:  5, maxSubs:  5, timerMode: 'countup',   walkoverWinScore: 5,  pointsWin: 3, pointsDraw: 1, pointsLoss: 0 },
  // periods/periodDurationMs/halfTimeDurationMs/timerMode are all inert for
  // these 4 (RacketScoreboardWidget.tsx has no period-clock concept of its
  // own) but still required — TournamentSettings has no optional fields
  // besides racketScoring itself; harmless placeholders. walkoverWinScore
  // likewise unused (see its own doc comment above) — kept equal to
  // gamesToWin/setsToWin just so it reads sensibly if ever surfaced.
  badminton:    { periods: 1, periodDurationMs: 0, halfTimeDurationMs: 0, maxOnField: 2, maxSubs: 0, timerMode: 'countup', walkoverWinScore: 2, pointsWin: 1, pointsDraw: 0, pointsLoss: 0,
    racketScoring: { mode: 'rally', pointsToWin: 21, winBy2: true, pointCap: 30, gamesToWin: 2, tiebreakAtGames: 6, noAd: false, serviceMode: 'auto', serviceRule: 'rally-winner', serviceAlternateEvery: 2 } },
  table_tennis: { periods: 1, periodDurationMs: 0, halfTimeDurationMs: 0, maxOnField: 2, maxSubs: 0, timerMode: 'countup', walkoverWinScore: 3, pointsWin: 1, pointsDraw: 0, pointsLoss: 0,
    racketScoring: { mode: 'rally', pointsToWin: 11, winBy2: true, gamesToWin: 3, tiebreakAtGames: 6, noAd: false, serviceMode: 'auto', serviceRule: 'alternate', serviceAlternateEvery: 2 } },
  tennis:       { periods: 1, periodDurationMs: 0, halfTimeDurationMs: 0, maxOnField: 2, maxSubs: 0, timerMode: 'countup', walkoverWinScore: 2, pointsWin: 1, pointsDraw: 0, pointsLoss: 0,
    racketScoring: { mode: 'tennis', pointsToWin: 4, winBy2: true, gamesToWin: 2, tiebreakAtGames: 6, noAd: false, serviceMode: 'auto', serviceRule: 'rally-winner', serviceAlternateEvery: 2 } },
  // Official ISTAF rules (per the user's own citation): each set races
  // straight to 15 (no lead needed for a normal finish) — UNLESS the score
  // deadlocks at 14-14, which raises the target to 17 instead (still no
  // lead needed beyond reaching it — see deuceTarget/isRallyGameOver's own
  // doc comments). Serve alternates one-at-a-time regardless of who wins
  // the rally ("satu servis sahaja berselang-seli"), not winner-serves.
  sepaktakraw:  { periods: 1, periodDurationMs: 0, halfTimeDurationMs: 0, maxOnField: 3, maxSubs: 2, timerMode: 'countup', walkoverWinScore: 2, pointsWin: 1, pointsDraw: 0, pointsLoss: 0,
    racketScoring: { mode: 'rally', pointsToWin: 15, winBy2: false, deuceTarget: 17, gamesToWin: 2, tiebreakAtGames: 6, noAd: false, serviceMode: 'auto', serviceRule: 'alternate', serviceAlternateEvery: 1 } },
  custom:      { periods: 2, periodDurationMs: 2700000, halfTimeDurationMs:  900000, maxOnField: 11, maxSubs:  7, timerMode: 'countup',   walkoverWinScore: 1,  pointsWin: 3, pointsDraw: 1, pointsLoss: 0 },
};
