import type { CgChangeAnimPreset } from '../lib/cgChangePresets';

export type WidgetType =
  | 'button'
  | 'title-field'
  | 'file-path'
  | 'scoreboard'
  | 'score-log'
  | 'score-lower-third'
  | 'player-lower-third'
  | 'timer'
  | 'timeline'
  | 'player-list'
  | 'player-list-next'
  | 'substitution'
  | 'card-display'
  | 'sin-bin-lower-third'
  | 'tbar'
  | 'volume'
  | 'overlay'
  | 'label'
  | 'input-tally'
  | 'transitions'
  | 'panel'
  | 'vmix-titles'
  | 'rugby-lineup'
  | 'rugby-lineup-next'
  | 'card-lower-third'
  | 'placement-lower-third'
  | 'pomodoro'
  | 'image-display'
  | 'recent-matches'
  | 'match-schedule'
  | 'rundown'
  | 'standings'
  | 'bracket'
  | 'team-form'
  | 'player-h2h'
  | 'player-stats'
  | 'player-highlight'
  | 'group-standings'
  | 'racket-scoreboard'
  | 'cg-template';

export type TimelineEventType = 'score' | 'yellow-card' | 'orange-card' | 'red-card' | 'substitution' | 'period' | 'custom';

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  timeStr: string;
  timeMs: number;
  team?: 'A' | 'B';
  player?: string;
  playerOff?: string;
  jerseyNo?: string;
  jerseyNoOff?: string;
  detail?: string;
  scoreA?: number;
  scoreB?: number;
}

export interface CanvasWidget {
  id: string;
  type: WidgetType;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  config: Record<string, any>;
}

// ── Custom CG template (WidgetType 'cg-template') ───────────────────────────
// A free-form graphic built from positioned Text/Image/Rectangle elements —
// see CgTemplateDesigner.tsx. Lives entirely inside one widget's own
// `config.elements`, so every existing system that already treats a widget
// as an opaque {id,type,w,h,config} blob (CG playout, sync, the CG output
// routes) needs zero changes to support it.
export interface TemplateElementBinding {
  /** The widget this element's content is resolved from, live, at render
   *  time — see lib/templateBinding.ts's resolveBindingValue. Absent when
   *  `groupSlot` below is set instead — the two are mutually exclusive
   *  alternate sources for the exact same binding slot. */
  sourceWidgetId?: string;
  /** A key from that source's bindable-parts catalog (curated where one is
   *  registered for its widget type, otherwise one of its raw config
   *  field names — see lib/templateBinding.ts's getBindableParts). When
   *  `groupSlot` is set instead, this is one of 'name' | 'shortName' |
   *  'logo' selecting which of that slot's own team fields to show. */
  key: string;
  /** Binds directly to the Team Database's own group-draw assignment
   *  instead of a widget on the canvas — "whichever team currently sits in
   *  Group A, slot 2" (see teamDbStore.ts's SavedTeam.group/groupPosition
   *  and TournamentManager.tsx's resolveGroupSlots, the same slot-
   *  resolution rule the existing Group Field vMix push already uses) — so
   *  a CG "group draw" template updates itself the moment a team is
   *  actually assigned there (the live draw, or a manual edit in the
   *  Tournament Manager), with no widget in between at all. See
   *  lib/templateBinding.ts's resolveGroupSlotValue. */
  groupSlot?: {
    tournamentId: string;
    /** Matches a Tournament.groups[].name / SavedTeam.group value exactly. */
    group: string;
    /** 1-based — matches SavedTeam.groupPosition. A slot with no team
     *  explicitly assigned that exact position resolves to '' (see
     *  resolveGroupSlots' own "fully manual, no auto-fill" doc comment),
     *  same as the existing Group Field push already does. */
    position: number;
  };
  /** Binds directly to a Tournament's own `logo`/`categoryLogos` — "this
   *  tournament's badge" or "this category's badge" — no widget needed,
   *  same no-widget shape `groupSlot` above already uses. When `groupSlot`
   *  is also absent and this is set, `key` is 'logo' (the tournament's own
   *  overall badge) or 'categoryLogo' (falls back to the tournament's own
   *  `logo` when that category has none of its own — same precedence
   *  Tournament.categoryLogos' own doc comment already describes). See
   *  lib/templateBinding.ts's resolveTournamentFieldValue. */
  tournamentField?: {
    tournamentId: string;
    /** Only meaningful when `key` is 'categoryLogo' — matches a
     *  Tournament.categories[] entry exactly. */
    category?: string;
  };
}

/** Which field of the CURRENT row's own match a 'matchSchedule' row
 *  template's element shows — see TemplateElement's own `matchRole` doc
 *  comment and lib/matchScheduleRow.ts's resolveMatchRoleValue.
 *  `centerText` is the one role with STATUS-dependent behavior baked in
 *  (rather than one fixed field): shows the match's own scheduled `time`
 *  while upcoming, and the score once live or finished — "show the result
 *  instead of vs" without the row template author needing two different
 *  elements/templates just for that swap (a template CAN still use two
 *  separate elements/templates per status instead — see 'matchSchedule' 's
 *  own liveRowTemplateId/finishedRowTemplateId for the "totally different
 *  design, not just swapped text" case). */
export type MatchScheduleRole =
  | 'teamAName' | 'teamBName' | 'teamAShortName' | 'teamBShortName'
  | 'teamALogo' | 'teamBLogo'
  | 'group' | 'round' | 'venue' | 'date'
  | 'centerText';

/** Which field of the CURRENT row's own standings row a 'standings' row
 *  template's element shows — see TemplateElement's own `standingsRole` doc
 *  comment and lib/standingsRow.ts's resolveStandingsRoleValue. `rank` is
 *  this row's 1-based position in the WHOLE table, independent of
 *  pagination. */
export type StandingsRole =
  | 'rank' | 'teamName' | 'shortName' | 'teamLogo'
  | 'played' | 'won' | 'drawn' | 'lost'
  | 'pointsFor' | 'pointsAgainst' | 'diff' | 'pts';

/** Which field of the CURRENT box's own knockout match a 'bracket' row
 *  template's element shows — see TemplateElement's own `bracketRole` doc
 *  comment and lib/bracketRow.ts's resolveBracketRoleValue. `centerText`
 *  mirrors MatchScheduleRole's own: the scheduled time while upcoming, the
 *  score once live or decided. */
export type BracketMatchRole =
  | 'stage' | 'teamAName' | 'teamBName' | 'teamAShortName' | 'teamBShortName'
  | 'teamALogo' | 'teamBLogo' | 'winner'
  | 'centerText';

export interface TemplateElement {
  id: string;
  kind: 'text' | 'image' | 'rect' | 'sequence' | 'shape' | 'ticker' | 'statbar' | 'imagePlaylist' | 'cardCarousel' | 'sound' | 'nestedTemplate' | 'credits' | 'matchSchedule' | 'standings' | 'bracket';
  x: number; y: number; w: number; h: number;
  /** 'text'/'image' reuse LabelWidget's/ImageDisplayWidget's own config
   *  field names verbatim (text/fontSize/color/bgColor/align/bold,
   *  imageUrl/objectFit/bgColor/caption) so their render logic and
   *  WidgetConfigPanel field UI patterns apply unchanged; 'rect' is a small
   *  new shape (fill/opacity/borderRadius). 'text' and 'rect' also read the
   *  same `stroke?: string`/`strokeWidth?: number` pair 'shape' already had
   *  (absent/0 = no stroke, matching every element authored before this
   *  existed) — 'text' renders it via CSS `-webkit-text-stroke` (an outline
   *  drawn OUTSIDE the glyph, same look as 'shape' 's SVG stroke), 'rect'
   *  via an inset `box-shadow` (so the stroke sits inside the box and
   *  follows `borderRadius`'s curve instead of changing the element's own
   *  footprint the way a CSS `border` would). 'sequence' is a frame-by-frame
   *  image sequence — `frames` are ordinary saved-image URLs (see
   *  lib/tgaDecoder.ts + CgTemplateDesigner.tsx's Sequence import), `fps`
   *  drives playback speed (see lib/cgAnimationEngine.ts's sequencePlay).
   *  'shape' is an SVG `<path>` — `d`/`viewBox`/`fill`/`stroke`/
   *  `strokeWidth` (see lib/svgShapes.ts's SHAPE_LIBRARY for built-in picks)
   *  — animated per-state via the 'morph' preset (CgLayerAnim.morphTo,
   *  GSAP's MorphSVGPlugin — see lib/cgAnimationEngine.ts's buildMorph).
   *  'ticker' is a continuously-scrolling news-crawler line of text —
   *  `text`/`fontSize`/`color`/`bold`/`bgColor` same as 'text', plus
   *  `speed?: number` (px/sec, default 120), `direction?: 'left'|'right'`
   *  (default 'left' — scrolls right-to-left, the usual news-ticker
   *  direction), `gap?: number` (px between repeated copies, default 80).
   *  Unlike every other kind's animation (in/loop/out states, CgLayerAnim),
   *  the scroll itself is self-contained and always running the moment this
   *  element mounts — a real ticker just scrolls the whole time it's on
   *  screen, not something an operator authors an entrance/exit for (though
   *  the bar itself can still have an ordinary In/Out on top, same as any
   *  element). See CgTemplateWidget.tsx/CgTemplateDesigner.tsx's own
   *  TemplateElementView/ElementPreview for the shared build-the-loop
   *  logic.
   *  'statbar' is one or more stacked Team-A-vs-Team-B comparison bars —
   *  possession, attacking entries, tries, conversions, or any other stat a
   *  broadcast H2H graphic compares — `rows: StatBarRow[]` (see that
   *  interface below for a row's own fields; a freshly-added statbar always
   *  starts with exactly one). Fields below apply to every row alike, so a
   *  multi-row panel reads as one cohesive block rather than N independently
   *  styled bars: `valueFormat?: 'percent'|'number'` (default 'percent')
   *  controls only how each row's value labels are TEXT-formatted — a row's
   *  own two segments always split proportionally to its raw
   *  valueA:valueB ratio either way — plus `showLabel?`/`showValues?:
   *  boolean` (both default true), `fontSize?: number`, `barHeight?:
   *  number`, `barRadius?: number` (absent = fully round, `barHeight/2`;
   *  0 = square corners), `trackColor?: string` (the unfilled portion
   *  behind every row's two segments, default a faint white wash),
   *  `showSeparators?: boolean` (default true — a thin rule between
   *  consecutive rows; meaningless/ignored with only one row),
   *  `separatorColor?: string`, and `ease?: string` (a GSAP ease
   *  identifier — see lib/useStatbarValues.ts's STATBAR_EASE_OPTIONS for
   *  the curated picks offered in the inspector — GSAP parses eases given
   *  as a plain string like "back.out(1.7)" natively, no separate import
   *  needed; default 'power2.out'). Each row changes smoothly to its own
   *  new proportions instead of snapping (always on per row, no separate
   *  CgChangeAnim needed — a bar reads as "the number ticking over", not a
   *  value-change transition the way text/image do) using this shared
   *  `ease`. See lib/useStatbarValues.ts.
   *  'imagePlaylist' is a multi-image slideshow — `images: string[]` (saved
   *  image URLs, same convention as 'image' 's own imageUrl), `objectFit?:
   *  'contain'|'cover'|'fill'` (default 'cover'), `bgColor?: string |
   *  CgGradient` (letterboxing behind a 'contain' fit). `advanceMode?:
   *  'auto'|'manual'` (default 'auto') — 'auto' advances on its own timer
   *  (`slideDuration?: number`, seconds, default 4) via the same
   *  registerReliableTick driver every other broadcast-timing-critical
   *  thing in this app uses, so it keeps advancing regardless of app-active
   *  state, same guarantee as a Custom Timer widget; 'manual' only advances
   *  when the operator fires CG Playout's "Next Stage" — the exact same
   *  `continueSignal` the whole-template Steps system already reacts to, so
   *  one button press advances both. `loop?: boolean` (default true) — at
   *  the last slide, true wraps back to the first, false just stays on the
   *  last slide (auto mode stops ticking; manual mode's Next Stage becomes a
   *  no-op for this element once there). `transitionPreset?: string` — a key
   *  from lib/cgPresets.ts's own PRESETS/OUT_PRESETS catalog (any ordinary
   *  transform-based one — slideLeft, fadeScale, wipeCircle, flip3D, etc.;
   *  excludes the handful of `_type`-tagged special presets like morph/
   *  typewriter/scramble/sequencePlay/wordSequence, which assume a text or
   *  shape element and don't apply to a plain image swap), default
   *  'fadeIn'. `transitionDuration?: number` (seconds, default 0.6),
   *  `transitionEase?: string` (an EASES entry, default 'power2.inOut').
   *  Unlike 'ticker', this owns no ALWAYS-running animation while idle
   *  between slides — only the transition itself is a GSAP tween, fired by
   *  the advance driver above — so this kind still uses the ordinary In/
   *  Loop/Out states on top for its own entrance/exit, same as 'image'. See
   *  CgTemplateWidget.tsx's/CgTemplateDesigner.tsx's own TemplateElementView/
   *  ElementPreview 'imagePlaylist' branch for the out-then-swap-then-in
   *  transition build. */
  /** 'cardCarousel' is a row of "cards" — each one an ENTIRE separate CG
   *  Template Library entry, rendered at rest (no In/Loop/Out playback of
   *  its own — see CgTemplateLibraryGrid.tsx's TemplateTile, which already
   *  renders a library template exactly this same "just show it" way) —
   *  rather than a bespoke nested composition editor, a "card" is just an
   *  ordinary template anyone can already build/edit in the normal Template
   *  Designer, so multiple cards can share ONE style by pointing at the same
   *  library entry (edit it once, every card using it updates together), or
   *  each can point at its own separate entry for a fully independent look.
   *  `cards: CgCarouselCard[]` (see that interface below) is the ordered
   *  list of slides; `playlistImages?: string[]` is a shared pool a card's
   *  own image element can opt into cycling through (see CgCarouselCard's
   *  own `playlistSlots` doc) instead of a fixed per-card override — the
   *  "content changes with the image playlist, or is its own fixed element"
   *  choice this kind exists for. Playback: `advanceMode?: 'auto'|'manual'`
   *  (default 'auto', same manual-advances-on-Next-Stage wiring
   *  'imagePlaylist' already uses — see CgTemplateWidget.tsx's identical
   *  continueSignal handling), `slideDuration?: number` (seconds, default
   *  4), `loop?: boolean` (default true — false parks on the last card
   *  instead of wrapping). `carouselStyle?: 'coverflow'|'stack'|'wheel'`
   *  (default 'coverflow') picks the look:
   *  - 'coverflow' — the active card centered and full scale, neighbors
   *    peeking in at reduced scale/opacity with a 3D (Y-axis) tilt, cards
   *    beyond the immediate neighbors fully hidden.
   *  - 'stack' — a fanned deck: cards behind the active one displace
   *    diagonally with a flat (Z-axis, not a 3D tilt) rotation, shrinking/
   *    fading the further back, same hidden-beyond-neighbors cutoff as
   *    'coverflow'.
   *  - 'wheel' — every card sits on a real ring (`cardGap` doubles as the
   *    ring's own radius here), spaced by 360°/card-count around it;
   *    there's no hidden cutoff (the whole ring is always "present"), cards
   *    on the far side just naturally shrink/fade/recede via true 3D depth
   *    as part of the same continuous ring math.
   *  All three share the same four tunables rather than each getting its
   *  own field set — one consistent mental model regardless of which look
   *  is picked: `cardGap?: number` (px between adjacent card centers for
   *  'coverflow'/'stack', ring radius for 'wheel'; default 260),
   *  `sideScale?: number` (0..1, default 0.75), `sideRotation?: number`
   *  (degrees, default 35 — meaningless for 'wheel', where each card's own
   *  facing angle instead comes directly from its position on the ring),
   *  `sideOpacity?: number` (0..1, default 0.6), `transitionDuration?:
   *  number` (seconds, default 0.6), `transitionEase?: string` (an EASES
   *  entry, default 'power2.inOut') — every visible card re-tweens to its
   *  new offset's position/scale/rotation/opacity on each advance, which is
   *  what actually produces the motion (there's no single "transition
   *  preset" the way 'imagePlaylist' has — the animation IS the
   *  repositioning). See CgTemplateWidget.tsx's own 'cardCarousel' branch
   *  for the layout math (one function per style) and the advance driver. */
  /** 'matchSchedule' is a paginated, LIVE-data-bound list of fixtures from
   *  matchScheduleStore.ts (the same Schedule an operator already manages
   *  in Tournament Manager / loads onto a Scoreboard via "Load Match") —
   *  each visible row renders one ordinary CG template (built once in the
   *  Template Library, same "a row is just a template" idea 'cardCarousel'
   *   's own cards already use), with its own team/flag/time/score fields
   *  resolved live per match via elements inside that row template tagged
   *  with `matchRole` (see TemplateElement's own doc comment on that field).
   *
   *  Filtering which fixtures appear at all: `tournamentId?: string`
   *  (absent = every tournament's fixtures), `group?: string` (matches
   *  ScheduledMatch.group exactly; absent = every group), sorted by
   *  `sortIndex` then `date`/`time`, same ordering the Schedule tab itself
   *  uses.
   *
   *  Pagination: `rowsPerPage?: number` (default 4, matching the reference
   *  fixtures-card look this was built for) fixtures show at once;
   *  `pageIndex?: number` (default 0, clamped to the last valid page as the
   *  filtered list's own length changes) is CURRENT page. `advanceMode?:
   *  'auto'|'manual'` (default 'manual') — 'manual' only advances when the
   *  operator fires CG Playout's "Next Stage" (the exact same
   *  `continueSignal` 'cardCarousel'/'imagePlaylist' already react to, so
   *  the SAME button/hotkey/Cg.Stage action already wired up for every
   *  other manual-advance element also pages this one — no new trigger
   *  mechanism needed); 'auto' instead pages itself on a timer
   *  (`pageDurationSec?: number`, default 8) via the same
   *  registerReliableTick driver 'imagePlaylist' 's own auto mode uses.
   *  `loop?: boolean` (default true) — at the last page, true wraps back to
   *  page 0, false just stays there (auto mode stops ticking; manual mode's
   *  Next Stage becomes a no-op for this element once there, same
   *  convention 'imagePlaylist'/'cardCarousel' already use for their own
   *  `loop`).
   *
   *  Row design — THREE independent row templates, one per match status,
   *  so a live match can read as visibly different from an upcoming or
   *  finished one at a glance (distinct colors/badges/layout, not just
   *  different text) rather than one design awkwardly trying to cover all
   *  three: `rowTemplateId?: string` (upcoming/scheduled — the default
   *  look every row starts as), `liveRowTemplateId?: string` (falls back to
   *  `rowTemplateId` when unset), `finishedRowTemplateId?: string` (same
   *  fallback). A match's status is derived the same way the rest of the
   *  app already does — 'finished' once it has a saved result
   *  (matchResultsStore.ts), 'live' while it's the match currently loaded
   *  on some on-canvas Scoreboard widget (the same `useLiveFixtureIds`
   *  check MatchScheduleWidget.tsx's own LIVE badge already uses),
   *  'scheduled' otherwise — see lib/matchScheduleRow.ts's own
   *  getMatchStatus/getMatchDisplayScore.
   *
   *  Per-row template still shared across every row of that SAME status by
   *  default (edit rowTemplateId's own template once, every upcoming row
   *  updates together, exactly like 'cardCarousel' 's own "point multiple
   *  cards at one template" convention) — `rowOverrides?: Record<matchId,
   *  { templateId?: string }>` is the escape hatch for "one specific match
   *  gets its own bespoke design regardless of status" (a rivalry match, a
   *  final, a sponsor-branded slot), same shape/spirit as
   *  `CgCarouselCard.overrides` just keyed by match id instead of card id.
   *
   *  `rowGap?: number` (px between stacked rows, default 12), `rowHeight?:
   *  number` (px — every row template is scaled to fit exactly this height,
   *  same "scaled to fit, never upscaled" convention 'nestedTemplate'
   *  already uses; default 90).
   *
   *  See CgTemplateWidget.tsx's/CgTemplateDesigner.tsx's own 'matchSchedule'
   *  branch for the actual per-row render (nested CgTemplateWidget, same
   *  recursion 'cardCarousel'/'nestedTemplate' already use, with
   *  matchRole-tagged elements' values patched in via
   *  lib/matchScheduleRow.ts's buildMatchRowOverrides) and the page-advance
   *  driver (mirrors 'cardCarousel' 's own auto/manual handling exactly). */
  /** 'standings' is a paginated, LIVE-data-bound league/pool table from the
   *  Team Database's own saved results (the exact same computeStandings
   *  StandingsWidget/GroupStandingsWidget already use) — each visible row
   *  renders one ordinary CG template (same "a row is just a template" idea
   *  'matchSchedule' 's own rows already use), with its own
   *  rank/team/flag/W-D-L/points fields resolved live per row via elements
   *  inside that row template tagged with `standingsRole` (see
   *  TemplateElement's own doc comment on that field).
   *
   *  Filtering which teams appear: `tournamentId?: string` (required —
   *  nothing renders without one), `category?: string` (matches
   *  SavedTeam.category exactly; absent = every category), `group?: string`
   *  (matches SavedTeam.group exactly; absent = every team in the
   *  tournament/category, i.e. an overall table rather than one pool's).
   *
   *  Pagination: identical shape to 'matchSchedule' 's own —
   *  `rowsPerPage?: number` (default 8), `pageIndex?: number` (default 0),
   *  `advanceMode?: 'auto'|'manual'` (default 'manual'),
   *  `pageDurationSec?: number` (default 8), `loop?: boolean` (default
   *  true) — see that kind's own doc comment for the full behavior of each,
   *  unchanged here.
   *
   *  Row design — THREE independent row templates, by RANK ZONE instead of
   *  match status (a league table has no "status", but very much has a
   *  promotion/qualification zone and a relegation zone a broadcast graphic
   *  conventionally highlights): `rowTemplateId?: string` (the default,
   *  every row starts as), `topRowTemplateId?: string` (rows 1..`topCount`,
   *  falls back to `rowTemplateId` when unset), `bottomRowTemplateId?:
   *  string` (the last `bottomCount` rows, same fallback). `topCount?:
   *  number`/`bottomCount?: number` (both default 0, i.e. no zone
   *  highlighted, every row uses `rowTemplateId`) — set either to actually
   *  turn that zone on. `rowOverrides?: Record<teamId, { templateId?:
   *  string }>` is the same per-team escape hatch 'matchSchedule' 's own
   *  `rowOverrides` is, for one specific team getting a bespoke design
   *  regardless of rank (a sponsor-branded slot, the hosts).
   *
   *  `rowGap?: number`/`rowHeight?: number` — identical meaning/defaults to
   *  'matchSchedule' 's own.
   *
   *  See CgTemplateWidget.tsx's/CgTemplateDesigner.tsx's own 'standings'
   *  branch for the actual per-row render and lib/standingsRow.ts for the
   *  full recipe — both mirror 'matchSchedule' 's own as closely as the
   *  different data shape allows. */
  /** 'bracket' is a LIVE-data-bound knockout bracket from the app's own
   *  Schedule (the same knockout-stage fixtures BracketWidget/BracketPanel
   *  already display) — each match box renders one ordinary CG template
   *  (same "a box is just a template" idea 'matchSchedule' 's own rows
   *  already use), with its own stage/team/flag/score fields resolved live
   *  per match via elements inside that row template tagged with
   *  `bracketRole` (see TemplateElement's own doc comment on that field).
   *  Laid out in COLUMNS by stage (Quarterfinal, Semifinal, Final, …
   *  earliest round first, left to right) rather than 'matchSchedule' 's
   *  single paginated vertical stack — no connecting bracket lines yet,
   *  just evenly column-spaced boxes (see lib/bracketRow.ts's own
   *  `columns`).
   *
   *  Filtering which matches appear: `tournamentId?: string` (required),
   *  `category?: string` (absent = every category), `tier?: string` (a
   *  Cup/Plate/Bowl/Shield split tournament's own tier — absent/no tiers on
   *  this tournament = every knockout match). `showThirdPlace?: boolean`
   *  (default false) — tacks the 3rd Place Playoff on as its own extra
   *  column after the Final when on, same match BracketWidget's own
   *  `thirdPlaceMatch` already finds.
   *
   *  Row design — THREE independent box templates, by match STATUS exactly
   *  like 'matchSchedule' 's own (`rowTemplateId?: string` for upcoming,
   *  `liveRowTemplateId?: string`, `finishedRowTemplateId?: string`, same
   *  fallback-to-default when unset) — status derived the exact same way
   *  ('finished' once it has a saved result, 'live' while loaded on some
   *  on-canvas Scoreboard, 'scheduled' otherwise). `rowOverrides?:
   *  Record<matchId, { templateId?: string }>` is the same per-match escape
   *  hatch 'matchSchedule' 's own is, for one specific match getting a
   *  bespoke design regardless of status (a Final always looking different
   *  from an ordinary Quarterfinal, say).
   *
   *  Layout: `boxWidth?: number`/`boxHeight?: number` (every box's own row
   *  template is scaled to fit exactly this size, same "scaled to fit,
   *  never upscaled" convention 'matchSchedule' 's own `rowHeight` uses;
   *  defaults 220×90), `columnGap?: number`/`boxGap?: number` (px between
   *  columns / between boxes within a column, both default 24).
   *
   *  See CgTemplateWidget.tsx's/CgTemplateDesigner.tsx's own 'bracket'
   *  branch for the actual per-box render and lib/bracketRow.ts for the
   *  full recipe — both mirror 'matchSchedule' 's own as closely as the
   *  column layout allows. */
  /** `kind:'rect'` only — marks this rect as a pure organizational "Group"
   *  container rather than an ordinary visible rectangle: created by
   *  CgTemplateDesigner.tsx's "Group Selection" action (multi-select two+
   *  layer rows in the Layers panel, Ctrl/Cmd+G) with `fill:'transparent'`,
   *  sized to the selection's own bounding box, and every selected element
   *  reparented under it (their x/y shifted into the new group's own local
   *  space — see groupElements' own comment). Purely a Layers-panel/
   *  authoring convenience: shows a folder icon and defaults its `name` to
   *  "Group" there, and "Ungroup" (available whenever the active selection
   *  has this flag) reverses it — reparents its children back up one level
   *  (shifting their x/y back out) and deletes the now-empty container.
   *  Nothing downstream (the real output, sync, effects) treats this
   *  differently from any other rect with a transparent fill — the SAME
   *  arbitrary-kind parent/child nesting every element already supports
   *  (see `parentId` below) already does all the actual work; this flag
   *  only changes how the Designer PRESENTS one. Dragging/repositioning a
   *  group moves every child with it for free (children render nested
   *  inside its own positioning box — ordinary CSS nesting), but an
   *  animated preset/track on the group itself does NOT cascade to its
   *  children, same pre-existing limitation the "3D Box" quick-insert's own
   *  container already has (see the Blender-style Transform paragraph
   *  below) — a group only carries its children along via its own static
   *  x/y/position, never via GSAP-driven movement.
   *  Also holds, for any kind: `effects?: CgEffect[]` — a stacked, ordered
   *  list of drop-shadow/glow/color-adjustment filters (see
   *  lib/cgEffects.ts's buildFilterString) rendered on a wrapper INSIDE this
   *  element's own animated node, independent of whatever GSAP itself
   *  animates on that node (e.g. a 'blur' track/preset).
   *  `fill`/`bgColor`/`color` may each be a plain solid color string (as
   *  always) OR a `CgGradient` (see lib/cgGradient.ts's resolveBackground/
   *  resolveTextColorStyle/resolveSvgFill, which every renderer routes
   *  these three through). 'text' elements also read `wordWrap?: boolean`
   *  (default true), `valign?: 'top'|'middle'|'bottom'` (default 'middle'),
   *  `autoFit?: boolean` (default false, see lib/useAutoFitFontSize.ts), and
   *  `colorOpacity?: number` (0-100, default 100) — how opaque `color`'s own
   *  fill is, baked directly into its rgba alpha (or, for a gradient, each
   *  stop's own alpha — see resolveTextColorStyle's own doc comment for why
   *  this is color-value alpha rather than a plain CSS `opacity` property).
   *  Turning it down lets whatever's BEHIND the glyphs show through the
   *  letters themselves — most useful paired with a glass-family effect
   *  (see CgEffect's own doc comment) on the same element, whose backdrop
   *  chrome sits behind the real glyphs and would otherwise be completely
   *  hidden by an opaque fill sitting exactly on top of it.
   *  Any kind may also hold `blendMode?: string` — a standard CSS
   *  mix-blend-mode keyword ('multiply', 'screen', 'overlay', 'darken',
   *  'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light',
   *  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity';
   *  absent/'normal' = no blending, the default before this field existed).
   *  Applied on this element's own OUTERMOST box — the same one `conditions`
   *  writes visibility to — so it blends this element's ENTIRE rendered
   *  result (its own content plus any children) against whatever sits
   *  visually behind it, matching how a design tool's "Blend Mode" on a
   *  whole layer/group behaves, not just this element's own fill/text/image
   *  in isolation from its children.
   *  Any kind may also hold `clipToBounds?: boolean` (default false) — a
   *  plain `overflow:hidden` on that same outermost box, clipping this
   *  element's own content AND children to its own rectangular w/h. The
   *  simpler, rectangle-only sibling of `maskId` above (which clips to an
   *  arbitrary shape's path instead) — useful on its own for a child
   *  that's positioned/sized past its parent's own edge, or an effect
   *  (glow/drop-shadow/bevel) that would otherwise visually bleed past the
   *  box, without needing a whole separate mask shape just to square off.
   *  Any kind may also hold `scene3D?: boolean` (only meaningful when this
   *  element has its own children via `parentId` below) + `scene3DPerspective?:
   *  number` (px, default 800) — gives this element's children a SHARED 3D
   *  space (a `perspective`+`transform-style:preserve-3d` context on their
   *  common parent) so their own already-keyframeable rotationX/rotationY/z
   *  compose relative to EACH OTHER (near/far occlusion, one shared vanishing
   *  point), instead of each child rotating in its own isolated 3D space with
   *  no visible depth relationship to its siblings — see
   *  CgTemplateWidget.tsx's/CgTemplateDesigner.tsx's own 'scene3D' comments.
   *  'text' elements may also hold `wordSequence?: CgWordSequenceItem[]` — an
   *  authored, per-word-timed list this element cycles through when one of
   *  its own In/Loop states has its Preset set to 'wordSequence' (see
   *  lib/cgAnimationEngine.ts's buildWordSequence) — a "Machine Gun Text
   *  Effect"-style rapid word-by-word reveal, each word's own hold time
   *  entirely author-chosen (not derived from word length). Independent of
   *  `text` itself — the base `text`/binding value is simply what's showing
   *  before this preset's first tl.call() fires, same relationship
   *  'sequence' elements' `frames`/`fps` have with the 'sequencePlay'
   *  preset.
   *  'text' elements may also hold `textRevealUnit?: 'character'|'word'|
   *  'sentence'` (default 'character'), `textRevealStyle?: string` (a key
   *  into lib/textReveal.ts's own TEXT_REVEAL_STYLES catalog, default
   *  'fadeUp'), `textRevealStagger?: number` (seconds between each unit's
   *  own animation starting, default 0.05), `textRevealDuration?: number`
   *  (seconds, default 0.6), `textRevealEase?: string` (an EASES entry,
   *  default 'power2.out') — read whenever one of this element's own
   *  In/Loop/Out states (or a Step) has its Preset set to 'textReveal' (see
   *  lib/cgAnimationEngine.ts's buildTextReveal): splits the text into the
   *  chosen unit granularity, each getting its own individually-animated
   *  <span>, staggered one after another — the classic "SplitText" reveal.
   *  Independent of `text` itself, same relationship `wordSequence` above
   *  has — these fields are shared by every state that uses this preset
   *  (the split/style/timing don't change per state), not authored
   *  separately per state.
   *  Any kind may also hold a STATIC (not animated/keyframeable) Blender-
   *  style Transform — the Inspector's own "Transform" panel groups it
   *  exactly like Blender's Object Properties does: Location (x/y — the
   *  element's own already-existing, already-animatable `x`/`y` fields
   *  above; `staticTranslateZ?` in px for Z, the one axis with no ordinary
   *  2D equivalent), Rotation (`staticRotateX?`/`staticRotateY?`/
   *  `staticRotateZ?`, degrees), Scale (`staticScaleX?`/`staticScaleY?`/
   *  `staticScaleZ?`, default 1 each — `staticScaleZ` only has a visible
   *  effect on a group's own children pushed out along Z, never on a flat
   *  leaf element's own zero-depth content). Applied as a plain CSS
   *  `transform` directly by both renderers, always in effect regardless
   *  of playback state (unlike every OTHER transform property in this app,
   *  which is 100% GSAP-owned and only ever moves during an authored
   *  animation). This exists for elements that need a fixed, ever-present
   *  3D pose rather than something that animates — e.g. one face of a "3D
   *  Box" quick-insert template (see CgTemplateDesigner.tsx's
   *  create3DBox): each face is rotated/pushed out to its own edge of the
   *  box via these fields, and the box always looks like a real cuboid at
   *  rest, not only while some entrance animation happens to be mid-flight.
   *  Combine with a parent's `scene3D` above so sibling faces compose into
   *  one shared 3D object instead of each floating in its own isolated
   *  space — set on a PARENT itself (a 3D Box's own container, say), this
   *  poses the whole group of children at once (a fixed 3/4 view, say),
   *  since a container's static pose applies to the shared box hosting it
   *  and every child together, not just its own (usually invisible/
   *  transparent) fill. The Inspector's own BlenderOrbitBall/Orbit3DHandle
   *  drives Rotation X/Y interactively (drag to orbit, click a dot to snap
   *  to a view, scroll to change Perspective) — Location/Scale stay plain
   *  numeric fields, matching Blender's own N-panel for those.
   *  IMPORTANT: because this writes the same CSS `transform` property GSAP
   *  itself owns, don't ALSO give an element using these fields a
   *  position/rotation/scale preset or keyframe track — whichever writes
   *  last on a given render/tick wins, so the two would fight. This also
   *  means an animated track on a PARENT can't be used to spin a whole
   *  assembled group the way its static pose can pose it: a track only ever
   *  moves the parent's own content, never its children (they render as a
   *  separate sibling, not a DOM descendant, of whatever a track animates)
   *  — continuously rotating a whole 3D group is accordingly not something
   *  this app supports yet, only posing it at a fixed angle. */
  /** Any kind may also hold `extrudeDepth?: number` (px, 0/absent = off)
   *  and `extrudeColor?: string` — a Blender-style "Extrude" faked with
   *  pure CSS on THIS one element, no new layers (see
   *  lib/cgEffects.ts's buildExtrudeFilter, folded into the element's own
   *  `filter` via resolveElementFilter): a staircase of `drop-shadow()`
   *  steps trailing diagonally behind it, shaded progressively darker,
   *  reads as a solid extruded edge. Works identically for every kind
   *  (drop-shadow follows the element's ACTUAL rendered shape — glyph
   *  outlines for text, an image's own alpha, an SVG path — not just its
   *  rectangle) with this one field pair, unlike a real per-face 3D solid
   *  (which needs separate front/back/side elements — see "+ 3D Box").
   *  A flat illusion: since it paints as part of this element's own 2D
   *  layer, rotating the element in 3D (staticRotateX/Y above) moves the
   *  whole painted effect as one flat card rather than the depth
   *  re-projecting as independent geometry. */
  /** 'sound' is a non-visual layer — a broadcast-stinger-style cue that
   *  plays a synthesized sound effect (lib/sfxLibrary.ts's SFX_LIBRARY) and
   *  nothing else: no DOM node, no pixels, on the real output (see
   *  CgTemplateWidget.tsx, which renders it as nothing at all) — only the
   *  Designer shows a small speaker "chip" for it so it can be selected/
   *  renamed/moved in the Layers list like any other element. Its config
   *  holds no fields of its own; WHICH sound plays, at what volume, and
   *  when (relative to a state's own t=0) are all authored per STATE, the
   *  same as every other kind's animation — see CgLayerAnim's own
   *  `sfxId`/`sfxVolume`/`delay` — so the same sound layer can fire a
   *  different cue (or none) in each state that includes it (e.g. a
   *  "whoosh" on In, nothing on Loop, a soft "click" on Out). */
  /** 'nestedTemplate' — "precompose", the After Effects workflow of
   *  dropping one whole composition into another as a layer, generalized
   *  here from what was previously only 'cardCarousel' 's own special case
   *  (a card referencing a library entry): ANY element in ANY template can
   *  embed ANY OTHER CG Template Library entry (`config.templateId`) as a
   *  fully self-contained layer, playing its own In/Loop/Out independently
   *  — the whole Library already IS an After Effects-style project (many
   *  named compositions); this is what lets any of them be used as a layer
   *  inside any other, not just inside a Card Carousel. Scaled to fit
   *  (never upscaled) and centered within this element's own w/h — see
   *  CgTemplateWidget.tsx's/CgTemplateDesigner.tsx's own 'nestedTemplate'
   *  branch, which is the SAME recipe 'cardCarousel' 's card rendering
   *  already uses. `ancestorTemplateIds` (threaded through every nested
   *  CgTemplateWidget render, same mechanism 'cardCarousel' already relies
   *  on) renders "Circular reference" instead of recursing forever if a
   *  chain of nested templates ever loops back on itself. */
  config: Record<string, any>;
  /** Present = this element's displayed content is resolved live from
   *  another widget's data instead of its own static config.text/imageUrl. */
  binding?: TemplateElementBinding;
  /** Only meaningful on an element nested inside a 'matchSchedule' row
   *  template (see that kind's own doc comment below) — tags WHICH field of
   *  the current row's own match this element shows, resolved fresh for
   *  each rendered row rather than a fixed authored value. A 'text' element
   *  reads its value from the matching field below; an 'image' element
   *  reads `teamALogo`/`teamBLogo` only (every other role is ignored on a
   *  non-text/non-image element, same "silently inert on the wrong kind"
   *  treatment `wordSequence`/`textRevealUnit` etc. already have). Absent
   *  (every element before this existed, and any element not meant to vary
   *  per row) = renders its own plain authored `config.text`/`imageUrl`
   *  completely unchanged, same as a row template used standalone (e.g.
   *  previewed directly in the Template Library) would show. See
   *  lib/matchScheduleRow.ts's own resolveMatchRoleValue for exactly what
   *  each role resolves to and buildMatchRowOverrides for how it's actually
   *  merged into a rendered row's config (mirrors 'cardCarousel' 's own
   *  `CgCarouselCard.overrides`, just computed live from match data instead
   *  of authored per-card). */
  matchRole?: MatchScheduleRole;
  /** Same idea as `matchRole` just above, for an element nested inside a
   *  'standings' row template instead — see that kind's own doc comment and
   *  lib/standingsRow.ts's resolveStandingsRoleValue/buildStandingsRowOverrides. */
  standingsRole?: StandingsRole;
  /** Same idea as `matchRole` just above, for an element nested inside a
   *  'bracket' row template instead — see that kind's own doc comment and
   *  lib/bracketRow.ts's resolveBracketRoleValue/buildBracketRowOverrides. */
  bracketRole?: BracketMatchRole;
  /** Zero or more live "if this value..." rules watching some OTHER
   *  widget's own live field (any bindable source — Timer, Scoreboard,
   *  Custom Timer, Countdown, anything getBindableParts already exposes,
   *  same catalog `binding` above already uses) and reacting to it —
   *  hide/show this element, or fire a one-shot animation, without an
   *  operator ever needing to hand-trigger anything. See lib/
   *  elementCondition.ts's own doc comment for the exact evaluation rules
   *  and lib/useElementConditions.ts for how it's actually applied (a
   *  dedicated wrapper div this element renders inside of ONLY when at
   *  least one condition exists, independent of the in/loop/out state
   *  machine's own opacity/visibility — the two never fight over the same
   *  property on the same node). Every condition here is independent —
   *  each watches its own value and reacts on its own; there's no AND/OR
   *  combining between them. */
  conditions?: ElementCondition[];
  /** Operator-set label shown in the designer's Layers panel — falls back
   *  to "{Kind} {n}" when absent. Editor-only, has no effect on output. */
  name?: string;
  /** Another TemplateElement's id — when set, this element renders NESTED
   *  inside that parent's own DOM node (see CgTemplateWidget.tsx/
   *  CgTemplateDesigner.tsx's recursive render), so its x/y become relative
   *  to the parent's box and it inherits the parent's animated transform for
   *  free via ordinary CSS nesting — no coordinate math anywhere. Absent
   *  (the only case before this field existed) = a root, relative to the
   *  canvas itself, exactly as always. */
  parentId?: string;
  /** Another TemplateElement's id (expected to be kind:'shape') whose path
   *  clips this element's visible area — see lib/cgEffects.ts's
   *  scalePathToUnitBox and the 'mask-<id>' clipPath def each renderer
   *  builds for it. `config.clipToBounds` below is the OTHER, simpler kind
   *  of clipping — this is the only field that clips to an arbitrary
   *  (non-rectangular) shape. */
  maskId?: string;
  /** 'text'/'image' only — plays a brief transition on this element's OWN
   *  displayed value (resolved text, or image URL) whenever it changes
   *  WHILE already on air — a live score ticking over, a name swapping in,
   *  etc. — instead of the new value just silently snapping in. Distinct
   *  from the in/loop/out states (CgAnimState): those replay a layer's
   *  whole entrance/idle/exit, this reacts to ordinary content updates
   *  (cgPlayoutStore's updateLayer, or a binding's live source value
   *  changing) at any point during playback. Absent = snap instantly, the
   *  only behavior before this field existed. See
   *  CgTemplateWidget.tsx's buildChangeTransition. */
  changeAnim?: CgChangeAnim;
}

/** One entry of a 'text' element's `config.wordSequence` — see that field's
 *  own doc comment on TemplateElement for what plays it back ("Machine Gun
 *  Text Effect"-style word-at-a-time cycling, see lib/cgAnimationEngine.ts's
 *  buildWordSequence). Order in the array is playback order. */
export interface CgWordSequenceItem {
  id: string;
  word: string;
  /** Seconds this word stays on screen before the next one replaces it —
   *  entirely author-chosen per word (never computed from word length), so
   *  a longer/more important word, or a deliberate dramatic pause, is just
   *  a bigger number here. */
  duration: number;
}

/** One row of a 'statbar' element — see TemplateElement's own doc comment
 *  for the fields that apply across every row instead of living here. */
export interface StatBarRow {
  id: string;
  label?: string;
  /** Static fallback used when `bindingA`/`bindingB` below aren't set —
   *  absent defaults to an even 50/50 split, same reasoning as everywhere
   *  else in this app that "nothing configured yet" reads better as even
   *  than one side pinned at zero. */
  valueA?: number;
  valueB?: number;
  /** Plain solid color or a CgGradient, same convention as fill/bgColor/
   *  color everywhere else — resolved via lib/cgGradient.ts's
   *  resolveBackground. Absent = a default red/blue pair (colorA/colorB
   *  respectively), matching every statbar authored before rows existed. */
  colorA?: string | CgGradient;
  colorB?: string | CgGradient;
  /** Independent live value sources — a row's two sides don't need to come
   *  from the same widget (e.g. Team A's tries from one Scoreboard, Team
   *  B's from another). Resolves via the exact same lib/templateBinding.ts
   *  machinery as `TemplateElement.binding`, parsed as a number; absent =
   *  this side's own static valueA/valueB instead. */
  bindingA?: TemplateElementBinding;
  bindingB?: TemplateElementBinding;
}

/** One slide of a 'cardCarousel' element — see TemplateElement's own doc
 *  comment for the full picture. */
export interface CgCarouselCard {
  id: string;
  /** A CanvasWidget id from the CG Template Library (libraryPages[0].widgets)
   *  — this card renders THAT template's own config at rest, exactly as
   *  CgTemplateLibraryGrid.tsx's own tile preview does. Absent/unresolved
   *  (a deleted template) renders a "pick a card style" placeholder instead
   *  of crashing. */
  templateId?: string;
  /** Per-card content, keyed by an element id WITHIN the referenced
   *  template's own config.elements — the same {text?, imageUrl?} shape
   *  CgLayerAnim.contentOverride already uses for per-STATE overrides, just
   *  applied per-CARD instead so two cards sharing one templateId can still
   *  show different text/photos. Absent for a given element id = show
   *  whatever that element's own static config already says. */
  overrides?: Record<string, { text?: string; imageUrl?: string }>;
  /** Element ids (within the referenced template, 'image' kind only) that
   *  ignore `overrides` above and instead show
   *  `config.playlistImages[this card's own index % playlistImages.length]`
   *  — the "content changes WITH the image playlist" mode; leaving an image
   *  element out of this list keeps it on `overrides`/its own static
   *  imageUrl instead — the "own element" mode. */
  playlistSlots?: string[];
}

/** One credited person/entry within a CreditsSection — kind:'credits' only.
 *  `role` is optional so the SAME entry shape covers both a department
 *  credit ("Director" / "Jane Smith") and a plain sponsor/name-only line
 *  (just `name`, e.g. a sponsor's own name, no role) without two separate
 *  authoring shapes to maintain. */
export interface CreditsEntry {
  id: string;
  role?: string;
  name: string;
  /** A sponsor/department logo — shown INSTEAD of role/name text (`name`
   *  still doubles as a small caption under the logo when both are set, so
   *  an operator can label a sponsor's own name under its mark without a
   *  separate field). Same resolveImageUrl() every other image field in
   *  this app already goes through — a plain URL, a `logo://` library
   *  reference via LogoUrlPicker, whatever. Absent (the default) renders
   *  the plain role/name text this entry already had before this field
   *  existed. */
  logoUrl?: string;
}

/** One named block within a kind:'credits' element's own `config.sections`
 *  — "DIRECTED BY", "CAST", "SPONSORS", or anything else an operator wants
 *  ("SPECIAL THANKS", a department, a venue) — there's no fixed catalog,
 *  purely author-typed, so this covers literally any end-credits section a
 *  production needs. `title` absent renders just the entries with no
 *  section heading (a plain unlabeled block). See TemplateElement's own
 *  doc comment on the 'credits' kind for how `config.mode` renders these. */
export interface CreditsSection {
  id: string;
  title?: string;
  entries: CreditsEntry[];
}

/** One "if this value..." rule — see TemplateElement's own doc comment on
 *  `conditions` and lib/elementCondition.ts for how it's actually
 *  evaluated. */
export interface ElementCondition {
  /** Which live value to watch — the exact same shape/catalog
   *  TemplateElementBinding's own sourceWidgetId/key already uses (any
   *  bindable source: Timer, Scoreboard, Custom Timer, Countdown, a raw
   *  config field on anything else). Absent = compare `staticValue`
   *  instead, a fixed number rather than anything live — mostly useful
   *  while still deciding on a real source, or for a condition that's
   *  meant to never actually change. */
  binding?: TemplateElementBinding;
  staticValue?: number;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
  /** The threshold `binding`'s (or `staticValue`'s) own current number is
   *  compared against. */
  value: number;
  /** 'hide' — this element is hidden whenever the condition is true,
   *  visible otherwise (e.g. "hide when score is 0"). 'show' — the exact
   *  inverse (e.g. "only show once time remaining is 0"). 'animate' —
   *  visibility is untouched; instead, `animatePreset` plays ONCE, as a
   *  quick standalone flash, every time the condition goes from false to
   *  true (e.g. "pulse when the score changes to something over par") —
   *  never fires on a re-render where it was ALREADY true, only on the
   *  actual false→true edge. */
  action: 'hide' | 'show' | 'animate';
  /** 'animate' only — a key from lib/cgPresets.ts's own PRESETS catalog,
   *  played as a single `.from()` pass (not looped, not tied to the
   *  in/loop/out state machine at all) whenever this condition's own
   *  false→true edge fires. Absent while 'animate' is picked simply does
   *  nothing yet, same as any other not-yet-configured field elsewhere in
   *  this app. */
  animatePreset?: string;
}

export interface CgChangeAnim {
  /** See lib/cgChangePresets.ts's CHANGE_ANIM_PRESETS/BUILDERS for what each
   *  one actually does — an unrecognized value (e.g. a preset later
   *  removed) falls back to 'fall' there rather than crashing. */
  preset: CgChangeAnimPreset;
  /** Seconds — most presets split this evenly between the outgoing and
   *  incoming half; a few (kinetic/morph/wobble) bias more of it toward a
   *  punchier entrance. See buildChangeTransition. */
  duration: number;
  /** 'text' only (ignored for 'image', and for the typewriter/scramble
   *  presets, which already work character-by-character across the WHOLE
   *  string their own way) — when the old and new values are the same
   *  length, diffs them position by position and plays the preset on ONLY
   *  the character(s) that actually changed, leaving the rest sitting
   *  perfectly still instead of the whole string animating as one block.
   *  This is how a real broadcast scoreboard/clock reads as "one digit
   *  ticking over" rather than the whole number visibly replacing itself.
   *  Lengths differing (e.g. "9" -> "10") falls back to animating the
   *  whole string, the same as this being off — there's no single-digit
   *  reading of a length change. Absent = off, animate the whole string
   *  (the only behavior before this field existed). See
   *  CgTemplateWidget.tsx's own per-character branch. */
  perCharacter?: boolean;
}

/** One entry in an element's `config.effects` stack — see
 *  lib/cgEffects.ts's buildFilterString, which composes the enabled ones
 *  (in order) into a single CSS `filter` value. Every field beyond
 *  `id`/`type`/`enabled` is optional and only meaningful for some types
 *  (color/offsetX/offsetY/blurRadius/opacity for dropShadow, color/
 *  blurRadius for glow, blurRadius alone for blur, amount for
 *  brightness/contrast/saturate/hueRotate, angle/bandWidth/duration/gap/
 *  color/opacity for lightSweep, amplitude/frequency/amount/angle/duration
 *  for flagWave).
 *
 *  'lightSweep' (an After-Effects-style shine/flare band that sweeps across
 *  the element) is the one type here that ISN'T a CSS `filter` primitive at
 *  all — there's no such filter — so buildFilterString skips it entirely;
 *  it's rendered as its own animated gradient overlay instead (see
 *  buildLightSweepStyle + lib/useLightSweep.ts, called from
 *  CgTemplateWidget.tsx/CgTemplateDesigner.tsx same as every other shared
 *  per-kind hook). It loops continuously the whole time the element is on
 *  screen, independent of the in/loop/out state machine — same relationship
 *  a 'ticker' element's own scroll has to that timeline — rather than being
 *  something an operator keyframes a single pass of.
 *
 *  'flagWave' (a rippling "waving cloth" distortion, usable on any element's
 *  own content — text, image, an NDI camera, anything) IS a genuine `filter`
 *  primitive (a per-element `url(#flagwave-<id>)` SVG filter reference — see
 *  cgEffects.ts's own doc comment on the recipe: turbulence-driven
 *  displacement for the geometric ripple, plus a simulated light raking
 *  across it for the shaded, actually-looks-3D relief), but like lightSweep
 *  it loops continuously and independently of the in/loop/out state
 *  machine (lib/useFlagWave.ts) rather than being an authored keyframe
 *  pass. Deliberately built this way — not a real cloth mesh/WebGL
 *  simulation — so "3D-looking motion" doesn't mean pulling Three.js back
 *  into this app after this same session removed it for being too heavy.
 *
 *  'bevel' (a raised, lit 3D relief — Photoshop's own "Bevel and Emboss"
 *  layer style) is ALSO a genuine `filter` primitive, same "per-element
 *  `url(#bevel-<id>)` SVG filter reference" shape flagWave uses (see
 *  cgEffects.ts's own doc comment on the recipe: this element's own alpha
 *  channel becomes a height map, lit from one side via <feDiffuseLighting>
 *  so edges facing the light read raised/bright and edges facing away read
 *  shadowed/recessed, then blended back over the original colors). Unlike
 *  flagWave this is STATIC, not continuously animated — a bevel is
 *  normally a fixed lit look, not something that moves on its own.
 *  `edgeOnly?: boolean` restricts the relief to a thin ring at the
 *  element's own outline instead of its whole surface — a "3D stroke"
 *  look, the ring's own width taken from `bandWidth` (reused from
 *  lightSweep, in px here rather than a percentage). Works on any
 *  element's own content the same way flagWave does.
 *
 *  'animatedBg' paints a continuously-moving background PATTERN behind
 *  this element's own content — a real alternative to a flat solid color
 *  or a static CgGradient (see resolveBackground), not a filter on the
 *  content itself. Rendered as its own sibling div (same "paints BEHIND
 *  the real content, independent DOM node" shape glass's own chrome uses)
 *  sized to this element's own box, animated by lib/useAnimatedBg.ts.
 *  `animatedBgStyle?: 'gradientShift'|'stripes'|'pulse'|'colorCycle'|
 *  'glass'|'colorRamp'|'aurora'` (default 'gradientShift') picks the look —
 *  see cgEffects.ts's buildAnimatedBgStyle for exactly what each one
 *  paints. `color`/`color2?: string` are the pattern's two colors (color2
 *  default a darker/complementary shade of color if unset) — 'colorRamp'
 *  instead derives a whole spectrum of stops FROM `color` alone (hue-
 *  rotated steps around it), and 'aurora' additionally reuses `color2` for
 *  its third blob. `angle` (reused) is the gradient/stripe/ramp direction
 *  ('glass'/'aurora' ignore it — a sheen sweeps at its own fixed angle,
 *  aurora's blobs pan diagonally). `duration` (reused) is seconds per full
 *  animation cycle.
 *
 *  'fractalGlass' — a ridged/fluted variant of 'glass', ported from a
 *  specific reference (a CodePen titled "Fractal glass effect",
 *  https://codepen.io/galayder/pen/NWmZOGb — the actual look, once the
 *  earlier SVG-noise-based guesses at "fractal glass" turned out not to be
 *  it): the exact same backdrop blur/saturate recipe (see cgEffects.ts's
 *  buildGlassStyle, still type-agnostic and reused as-is), but its own
 *  `background` is a repeating-linear-gradient ridge/fluting pattern
 *  instead of a flat tint, with a `mix-blend-mode` (color-dodge by default)
 *  on top — see cgEffects.ts's buildFractalGlassRidgeStyle. The blend mode
 *  is what actually produces the "fractal"-looking effect: color-dodge
 *  blows the ridges out unevenly wherever a bright/colorful blurred shape
 *  sits behind the panel (the reference pen composites this over an
 *  animated glowing blob — achievable in this app by placing an
 *  `animatedBg`-effect element, e.g. its own 'aurora'/'pulse' style, behind
 *  the glass panel), not literal fractal math. Pure CSS gradients/blend
 *  modes throughout, no SVG filter of any kind — deliberately, after an
 *  earlier attempt at appending a `url(#...)` SVG filter reference to
 *  `backdrop-filter` itself turned out unreliable in the WebKit engine this
 *  app's own Designer/Preview run in (see buildFractalGlassRidgeStyle's own
 *  doc comment for the fuller history). `texture?: string` picks which
 *  named blend-mode preset to use (a key into cgEffects.ts's
 *  FRACTAL_GLASS_STYLES list — Prism, Aurora, Hologram, Soft Frost, etc.,
 *  each a different CSS blend mode); absent defaults to 'prism'
 *  (color-dodge, matching the reference pen exactly). `bandWidth` (reused
 *  from crystalGlass's identical "a px size" meaning) is the ridge
 *  spacing; absent defaults to 32 (the pen's own `--step`). `opacity`
 *  (reused from glass's own tint-alpha meaning) now scales the ridge
 *  pattern's own contrast instead of a flat wash; absent defaults to 100
 *  (full preset strength). `amplitude` (reused from flagWave's own field)
 *  is how much the ridge pattern itself is softened/blurred, 0-100; absent
 *  defaults to 30. `angle` is the ridge direction; absent defaults to 90
 *  (the pen's own gradient angle). `findGlass`-driven rendering treats
 *  'glass'/'fractalGlass'/'crystalGlass' as one family (see findGlass's own
 *  doc comment) — only one glass-family panel is ever active per element.
 *
 *  'crystalGlass' — another 'glass' variant, same shared backdrop recipe,
 *  PLUS a faceted cut-glass/prism overlay (two overlapping
 *  repeating-linear-gradient hairlines at ±30° from `angle`, blended with
 *  'overlay' mode — see cgEffects.ts's buildCrystalFacetStyle) instead of
 *  fractalGlass's organic warp — a crisp geometric "cut crystal" look
 *  rather than a soft distortion. `bandWidth` (reused from
 *  lightSweep/bevel's own "a px size" meaning) sets each facet cell's
 *  size, px; absent defaults to 36.
 *
 *  'liquidGlass' — a fourth 'glass' variant, TEXT-ONLY (see below), ported
 *  from a specific reference (a CodePen titled "Liquid Glass Clock",
 *  https://codepen.io/alexandrevacassin/pen/YPqqqwr): same shared backdrop
 *  blur/saturate recipe, PLUS a per-element `url(#...)` SVG filter
 *  reference appended to its own `backdrop-filter` (same
 *  `<filter-value-list>` mechanism fractalGlass's own earlier, abandoned
 *  attempt used — see cgEffects.ts's buildGlassStyle's own doc comment on
 *  `backdropFilterExtra`) that splits the backdrop into its R/G/B channels
 *  and displaces each one independently along a shared map (via three
 *  <feColorMatrix>/<feDisplacementMap> pairs recombined with
 *  <feComposite>) — that per-channel offset is chromatic aberration, the
 *  actual ingredient that makes this read as light bending through a real
 *  glass lens rather than a flat blur. The reference pen hand-authors a
 *  bitmap "height map" per glyph (one clock only ever shows ten digits);
 *  this app instead builds the equivalent map DYNAMICALLY per text value/
 *  size, from that same element's own glyph shapes, pre-blurred (see
 *  cgEffects.ts's buildLiquidGlassMapSvg for why a live per-element filter
 *  can't derive this from its own SourceGraphic the way it might seem it
 *  should). Because of that, this effect only actually applies to a 'text'
 *  element with `fontFamily` unset (same restriction, and the same reason,
 *  buildTextGlassMask's own doc comment already explains for glass's
 *  content-shape masking) — on anything else it quietly falls back to the
 *  plain shared glass chrome, no refraction, never an error. `amplitude`
 *  (reused from flagWave's own "how far things displace" meaning) is the
 *  refraction's own strength, 0-100; absent defaults to 40 (matching the
 *  reference pen's own scale exactly). `blurRadius` (reused from glass's
 *  own backdrop-blur meaning) additionally softens the internal map itself.
 *
 *  `rampMask?: boolean` — glass/fractalGlass/crystalGlass/blur only: when
 *  true, the effect's own intensity fades spatially across the element
 *  instead of applying uniformly, via a `mask-image` linear-gradient (for
 *  the glass family, masking the whole chrome panel — see
 *  cgEffects.ts's buildRampMaskImage) or an equivalent feImage-driven
 *  spatial mask inside a dedicated per-element SVG filter (for plain
 *  'blur' — see buildRampBlurFilterProps/findRampBlur, appended by
 *  resolveElementFilter same as flagWave/bevel/innerShadow). Reuses
 *  `angle` (already present on all four effect types) as the ramp's own
 *  direction — the effect is strongest at the edge 180° from `angle` and
 *  fades to none by the opposite edge, i.e. `angle` is literally "which
 *  way to point the ramp so glass/blur builds up toward that side."
 *  Absent/false = uniform, full-strength everywhere, matching every
 *  effect authored before this field existed. */
export interface CgEffect {
  id: string;
  type: 'dropShadow' | 'glow' | 'blur' | 'brightness' | 'contrast' | 'saturate' | 'hueRotate' | 'lightSweep' | 'glass' | 'fractalGlass' | 'crystalGlass' | 'liquidGlass' | 'flagWave' | 'bevel' | 'innerShadow' | 'animatedBg' | 'stroke' | 'waveWarp';
  enabled: boolean;
  /** glass's own tint color (default white) — everywhere else this is the
   *  effect's own primary color (shadow/glow/sweep-band color). animatedBg
   *  also reuses this as its pattern's own primary color (default a mid
   *  blue, #3355ff). stroke also reuses this — the ring's own color
   *  (and its glow's color, when `amount` > 0). Absent defaults to
   *  '#ffffff'. */
  color?: string;
  /** animatedBg only — the pattern's own second color. Absent defaults to
   *  a darkened version of `color` (see cgEffects.ts's shadeHex), so a
   *  freshly-added effect always has a visible two-tone pattern without
   *  the operator needing to pick a second color immediately. */
  color2?: string;
  offsetX?: number;
  offsetY?: number;
  /** glass only, px — how strongly it blurs whatever sits BEHIND this
   *  element (a `backdrop-filter` blur, not the element's own content —
   *  see cgEffects.ts's buildGlassStyle). Absent defaults to 20. bevel also
   *  reuses this, px — how SOFT the relief's own edge transition reads
   *  (feGaussianBlur's own stdDeviation on the alpha-derived height map —
   *  see buildBevelFilterProps); a small value reads as a crisp, hard edge,
   *  a large one as a smooth, rounded one. Absent defaults to 3. stroke
   *  also reuses this, px — its own glow's blur radius (0 = no glow, a
   *  plain crisp ring). Absent defaults to 0. animatedBg's 'prism' style
   *  also reuses this, px — a plain overall CSS blur softening the whole
   *  banded pattern ("Finish" in spirit). Absent defaults to 0 (crisp). */
  blurRadius?: number;
  /** glass only, % (100+) — the backdrop's own saturate() boost, the second
   *  half of the standard "frosted glass" backdrop-filter recipe (a plain
   *  blur alone looks flat/milky; boosting saturation of what's behind is
   *  what gives it that vivid Apple-style glass look). Absent defaults to
   *  180, the same default the glassmorphism convention this is styled
   *  after settled on. flagWave also reuses this — a much smaller 0-20ish
   *  range there, NOT a percentage — see cgEffects.ts's
   *  buildFlagWaveFilterProps for exactly what it maps to (surfaceScale,
   *  how tall the simulated cloth relief reads). Absent defaults to 8.
   *  bevel also reuses this, same 0-20ish "surfaceScale" meaning flagWave's
   *  own reuse has — how pronounced the raised 3D relief reads. Absent
   *  defaults to 4. stroke also reuses this, 0-100 — its own glow's
   *  strength (0 = no glow at all, same as `blurRadius` 0). Absent
   *  defaults to 0. animatedBg's 'prism' style also reuses this, 0-100 —
   *  how much adjacent bands blend into each other (0 = crisp stripes, 100
   *  = barely-banded smooth gradient). Absent defaults to 0. */
  amount?: number;
  /** dropShadow only, 0-100 — CSS drop-shadow() has no opacity knob of its
   *  own, only whatever alpha the shadow color carries, so this composes
   *  into an rgba() at render time (see cgEffects.ts's buildFilterString)
   *  rather than the operator needing to fiddle with an alpha channel on
   *  the plain hex color field above. Absent = 100 (fully opaque), matching
   *  every dropShadow effect authored before this field existed.
   *  lightSweep also reuses this field for its own band's peak brightness
   *  (0-100), same meaning as everywhere else this field appears. glass
   *  also reuses it, 0-100, for its own tint color's alpha — how strongly
   *  the tint washes over the blurred backdrop; absent defaults to 18 (a
   *  subtle wash, not an opaque fill — a fully opaque tint would just hide
   *  the blurred backdrop entirely, defeating the point of glass). stroke
   *  also reuses this, 0-100 — the ring's own overall opacity. Absent
   *  defaults to 100. */
  opacity?: number;
  /** lightSweep only, degrees — the sweep band's own direction, same CSS
   *  linear-gradient() angle convention 'angle' already uses on CgGradient
   *  (0 = bottom-to-top, 90 = left-to-right, clockwise from there). Absent
   *  defaults to a diagonal top-left-to-bottom-right sheen (115).
   *  glass also reuses this, same convention, for which corner its own
   *  tint gradient/edge highlight reads as "lit from" — see
   *  cgEffects.ts's buildGlassStyle/buildGlassEdgeStyle. Absent defaults to
   *  135 (top-left lit, matching the "Frosted Glass Card" look this was
   *  styled after). flagWave also reuses this, degrees — the STARTING
   *  angle its own simulated light comes from before it starts sweeping
   *  (see useFlagWave.ts — a fixed light never looks like it's moving, so
   *  this is only ever the initial value). Absent defaults to 45. bevel
   *  also reuses this, degrees — its own (static, never-sweeping) light
   *  azimuth. Absent defaults to 135, matching glass's own default so a
   *  bevel and a glass panel on the same template read as lit from the
   *  same direction by default. animatedBg also reuses this, degrees —
   *  the pattern's own gradient/stripe direction (same CSS linear-
   *  gradient() convention as everywhere else this field appears).
   *  Absent defaults to 45. waveWarp also reuses this, degrees — AE's own
   *  "Direction": the single axis every wave's displacement travels along
   *  (0 = waves travel left-to-right, 90 = top-to-bottom). Absent defaults
   *  to 0. */
  angle?: number;
  /** lightSweep only, 0-100 — the bright band's own width as a percentage
   *  of one full sweep pass; a small value reads as a thin, sharp flare, a
   *  large one as a broad, soft wash. Absent defaults to 25. bevel also
   *  reuses this — px (NOT a percentage here), only meaningful when
   *  `edgeOnly` is on: how wide a ring around the element's own outline the
   *  relief covers. Absent defaults to 8. waveWarp also reuses this, px —
   *  AE's own "Wave Width": the distance between successive wave crests
   *  (ignored for the two noise wave types, which have no single repeating
   *  crest spacing). Absent defaults to 60. */
  bandWidth?: number;
  /** lightSweep only, seconds — how long one sweep pass across the element
   *  takes. Absent defaults to 1.4. flagWave also reuses this — seconds
   *  for one full oscillation of its own ripple density + one full sweep
   *  of its light direction (see useFlagWave.ts). Absent defaults to 3.
   *  animatedBg also reuses this — seconds for one full cycle of whichever
   *  animatedBgStyle is picked (see lib/useAnimatedBg.ts). Absent defaults
   *  to 6. stroke also reuses this — seconds for one full lap of the dash
   *  marching around the ring's own perimeter, only meaningful while
   *  `animated` is on. Absent defaults to 2. */
  duration?: number;
  /** lightSweep only, seconds — pause between the end of one sweep pass and
   *  the start of the next (0 = back-to-back, continuously sweeping).
   *  Absent defaults to 2.5. */
  gap?: number;
  /** flagWave only, px — how far this element's own pixels actually get
   *  displaced by the ripple (feDisplacementMap's own `scale` — see
   *  cgEffects.ts's buildFlagWaveFilterProps). A small value reads as a
   *  subtle cloth shimmer, a large one as an exaggerated, almost liquid
   *  distortion. Absent defaults to 10. waveWarp also reuses this, px —
   *  AE's own "Wave Height": how far pixels actually get pushed from their
   *  resting position. Absent defaults to 20. */
  amplitude?: number;
  /** flagWave only, a friendly 1-10 "ripple density" dial — how many
   *  separate ripples fit across the element, roughly (internally mapped
   *  to feTurbulence's own baseFrequency, whose useful raw range an
   *  operator shouldn't need to know). Absent defaults to 3. waveWarp also
   *  reuses this — AE's own "Wave Speed": how many full wave cycles travel
   *  past a fixed point per second (0 = frozen at `phase`, negative reverses
   *  direction). Absent defaults to 1. */
  frequency?: number;
  /** bevel only, degrees (0-90) — how HIGH overhead the simulated light
   *  sits; low values (near 0, light skimming the surface) throw long,
   *  dramatic shadows and a strong highlight, high values (near 90,
   *  straight overhead) read flatter/softer. Absent defaults to 55. */
  elevation?: number;
  /** bevel only — feSpecularLighting's own specularExponent: how tight/
   *  glossy the highlight reads, a plastic/metallic shine vs. a soft matte
   *  one. Absent defaults to 12. */
  shininess?: number;
  /** bevel only — restricts the relief to a thin ring at the element's own
   *  outline (see `bandWidth` above for the ring's width) instead of its
   *  whole surface, a "3D stroke" look rather than a 3D-surfaced fill.
   *  Absent/false = the whole surface gets the relief, matching how every
   *  other filter-based effect here already treats its own element. */
  edgeOnly?: boolean;
  /** animatedBg only — which moving pattern to paint (see cgEffects.ts's
   *  buildAnimatedBgStyle for exactly what each one looks like):
   *  'gradientShift' (default) — a soft diagonal two-color gradient,
   *  slowly panning back and forth. 'stripes' — diagonal two-tone bands,
   *  continuously scrolling. 'pulse' — a soft radial glow breathing in
   *  size/opacity. 'colorCycle' — a solid wash smoothly hue-rotating
   *  through the color wheel, starting from `color`. 'mesh' — several
   *  large, soft blobs in `color`/`color2` plus two hue-derived tones,
   *  positioned to blend into one smooth full-bleed field (an Apple-style
   *  "mesh gradient" look) rather than aurora's glowing-blobs-on-a-dark-
   *  base read — drifts diagonally the same way aurora's own cluster does.
   *  'grain' — a plain two-color diagonal gradient (same panning as
   *  'gradientShift') with a static noise/grain texture layered on top
   *  (see cgEffects.ts's buildGrainOverlaySvg); `amplitude` (0-100, default
   *  35) is the grain's own opacity, `frequency` (1-10, default 5) is its
   *  coarseness — a low value reads as big, blotchy grain, a high one as
   *  fine, tight film grain. 'prism' — `stripCount` (default 22) colored
   *  bands sampled across `colors` (an ordered N-color stop list, falling
   *  back to a plain `color`→`color2` 2-stop ramp when `colors` is unset —
   *  every band's own flat color is `colors` sampled at that band's
   *  position, so a 2-color `colors` list reads as a plain ramp and a 6+
   *  color one reads as a rich multi-hue strip), each band's own HEIGHT
   *  following `shapePreset` (see cgEffects.ts's buildPrismSvg for the
   *  actual curve each one traces): 'slant' (default) — a plain linear
   *  ramp, shortest at one edge, tallest at the other. 'lens' — a single
   *  rounded bulge, tallest at `acrossPct` and tapering to both edges.
   *  'crest' — a broad single hump (a softer, flatter-topped lens). 'valley'
   *  — the inverse of crest, shortest in the middle. 'tide' — two humps
   *  across the strip, an asymmetric double wave. `heightPct` (0-100,
   *  default 60) scales every band's own peak height; `acrossPct` (0-100,
   *  default 50) is where that peak sits along the strip (lens/crest/
   *  valley/tide only — slant has no single peak); `alongPct` (0-100,
   *  default 50) is where the WHOLE pattern's own baseline sits vertically
   *  within the element (0 = bottom-anchored, 100 = top-anchored).
   *  `bandDirection?: 'up'|'right'|'down'|'left'` (default 'up') is which way
   *  the bands themselves run (up/down = vertical bands reading left to
   *  right; left/right = horizontal bands reading top to bottom) and which
   *  end `colors`' own first stop starts from. `amount` (reused, 0-100,
   *  default 0) softens the hard edge between adjacent bands into a blend
   *  — 0 reads as crisp, distinct stripes, 100 as one smooth continuous
   *  gradient with the banding barely visible. `facetsPct` (0-100, default
   *  0) layers a extra diagonal highlight/shadow hairline pattern across
   *  each band — a faceted-glass glint, purely decorative texture on top of
   *  the plain bands. `reverseColors?: boolean` flips `colors`' own order
   *  without needing to re-enter them. `blurRadius` (reused, px) is this
   *  whole pattern's own overall softening (a plain CSS blur over
   *  everything, "Finish → Soften" in spirit) — absent/0 = perfectly crisp.
   *  Animated the same panning way every other style here already is
   *  (`duration`, reused, is still "seconds per cycle") — there's no
   *  separate per-band growth/breathing motion the way a live canvas
   *  renderer could do; this is a real static SVG pattern that pans, same
   *  "no canvas/WebGL" constraint every other animatedBg style already
   *  respects. */
  /** 'conic' — a native CSS `conic-gradient()` sweep around a center point,
   *  sampled across `colors` (same N-stop ramp 'prism' uses, same 2-color
   *  fallback). `angle` (reused) is the sweep's own starting angle.
   *  Animated by actually ROTATING the pattern (GSAP's own `rotation`,
   *  which useAnimatedBg.ts's generic `animate.prop` tween already supports
   *  with no extra plumbing — the one style here that doesn't pan).
   *  `duration` (reused) is seconds per full spin.
   *
   *  'wave' — a repeating horizontal sine-wave boundary between bands
   *  sampled across `colors`, tiled and panned sideways (see
   *  cgEffects.ts's buildWaveSvg). `frequency` (reused, 1-10) is how many
   *  waves fit across one tile; `amplitude` (reused, px-ish 0-100) is the
   *  wave's own height. `duration` (reused) is seconds per pan cycle.
   *
   *  'pixel' — a mosaic grid of flat-colored square cells sampled
   *  diagonally across `colors` (see cgEffects.ts's buildPixelSvg).
   *  `stripCount` (reused) is columns (rows derive from the element's own
   *  aspect ratio, so cells stay roughly square); `reverseColors` (reused)
   *  flips the sampling direction. `duration` (reused) is seconds per pan
   *  cycle. */
  /** 'liquidDiffuse' — a cluster of soft overlapping color blobs (sampled
   *  across `colors`, same N-stop list/fallback every multi-color style
   *  here shares) that continuously blur in and out — an "ink spreading in
   *  water" read, sharpening back into focus and diffusing out again,
   *  rather than panning or rotating. The motion IS the blur amount itself
   *  (CSS `filter: blur()` tweened 2px→26px), not a position change — no
   *  `angle`/Color 2/`duration`-reused-elsewhere fields apply here beyond
   *  the usual Speed. */
  animatedBgStyle?: 'gradientShift' | 'stripes' | 'pulse' | 'colorCycle' | 'glass' | 'colorRamp' | 'aurora' | 'mesh' | 'grain' | 'prism' | 'conic' | 'wave' | 'pixel' | 'liquidDiffuse';
  /** 'prism' only — an ordered N-color stop list (2+) each band's own
   *  color is sampled across, replacing the plain `color`/`color2` 2-stop
   *  pair other animatedBg styles use. `weight` is that stop's own relative
   *  share of the ramp (equal weights = evenly spaced stops; a bigger
   *  weight on one color gives it more of the strip before the ramp moves
   *  on to the next) — see cgEffects.ts's resolveColorStops for exactly how
   *  weights normalize into stop positions. Absent/empty = falls back to
   *  `color`→`color2` as a plain 2-stop ramp, same look a freshly-added
   *  prism effect (before the operator has added any colors here) already
   *  gets from those two fields' own defaults. */
  colors?: { id: string; hex: string; weight: number }[];
  /** 'prism' only — how many bands the strip is divided into. Absent
   *  defaults to 22. */
  stripCount?: number;
  /** 'prism' only — see `animatedBgStyle`'s own doc comment above for what
   *  each curve looks like. Absent defaults to 'slant'. */
  shapePreset?: 'crest' | 'valley' | 'tide' | 'slant' | 'lens';
  /** 'prism' only, 0-100 — see `animatedBgStyle`'s own doc comment above.
   *  Absent defaults to 0 (no facet texture). */
  facetsPct?: number;
  /** 'prism' only, 0-100 — see `animatedBgStyle`'s own doc comment above.
   *  Absent defaults to 60. */
  heightPct?: number;
  /** 'prism' only, 0-100 — see `animatedBgStyle`'s own doc comment above.
   *  Absent defaults to 50. */
  acrossPct?: number;
  /** 'prism' only, 0-100 — see `animatedBgStyle`'s own doc comment above.
   *  Absent defaults to 50. */
  alongPct?: number;
  /** 'prism' only — see `animatedBgStyle`'s own doc comment above. Absent
   *  defaults to 'up'. */
  bandDirection?: 'up' | 'right' | 'down' | 'left';
  /** 'prism' only — see `animatedBgStyle`'s own doc comment above. Absent/
   *  false = `colors`' own authored order, unchanged. */
  reverseColors?: boolean;
  /** animatedBg only — how the pattern's own motion repeats (see
   *  lib/useAnimatedBg.ts for the actual GSAP tween each one builds):
   *  'yoyo' (default) — plays `from`→`to` then back `to`→`from`,
   *  continuously, with a smooth ease each way — reads as organic back-
   *  and-forth motion (a pan drifting, a glow breathing). 'loop' — plays
   *  `from`→`to` only, restarting at `from` each time (no reverse leg),
   *  at a constant linear speed — reads as continuous one-direction motion
   *  (water flowing, a conveyor scrolling) rather than bouncing; for a
   *  tiled pattern (stripes/grain/wave/pixel) `from`/`to` already line up
   *  on a tile boundary, so the restart reads as a seamless, unbroken
   *  loop rather than a visible snap. 'once' — plays `from`→`to` a single
   *  time then holds at `to`, never repeating — a one-shot reveal/settle
   *  instead of a continuous ambient loop. */
  loopMode?: 'yoyo' | 'loop' | 'once';
  /** fractalGlass only — which named turbulence preset to warp the backdrop
   *  with (a key into cgEffects.ts's FRACTAL_TEXTURES). Absent defaults to
   *  that list's first entry ('frost'). */
  texture?: string;
  /** glass/fractalGlass/crystalGlass/blur only — see this interface's own
   *  doc comment above for the full recipe. Absent/false = uniform,
   *  full-strength effect everywhere (unchanged from before this field
   *  existed). */
  rampMask?: boolean;
  /** stroke only, px — this effect's own outline thickness. Distinct from
   *  the plain, always-flush `config.stroke`/`config.strokeWidth` pair
   *  'text'/'shape'/'rect' already have (see TemplateElement's own doc
   *  comment) — THIS is a separate, kind-agnostic outline that can sit
   *  outset from the element (see `strokeGap`), run an animated dash (see
   *  `animated`), and carry its own glow (`amount`/`blurRadius` below),
   *  none of which the plain per-kind stroke supports. The two can be used
   *  together (e.g. a solid flush border plus a second, animated, outset
   *  ring) or independently. Absent defaults to 3. */
  strokeWidth?: number;
  /** stroke only, px — how far OUTSET from the element's own edge this
   *  ring sits (0 = flush against the edge, like a plain border). Applied
   *  uniformly on every side. For a 'shape' element the ring follows that
   *  shape's own path (scaled outward from its center), not just its
   *  rectangular bounding box — see cgEffects.ts's buildStrokeGeometry.
   *  Rendered inside the SAME filter-bearing wrapper node as this
   *  element's own dropShadow/glow (when either is also present in this
   *  effects stack), so a dropShadow effect automatically wraps around
   *  this ring too, gap included — no separate wiring needed for that.
   *  Absent defaults to 8. */
  strokeGap?: number;
  /** stroke only — a plain solid ring, or one of two proportional dash
   *  presets (computed from the ring's own real perimeter at render time,
   *  not fixed pixel lengths, so it scales sensibly on any size element).
   *  Absent defaults to 'dashed'. */
  dashStyle?: 'solid' | 'dashed' | 'dotted';
  /** stroke only — "marching ants": continuously animates the dash pattern
   *  around the ring's own perimeter via `stroke-dashoffset`, independent
   *  of and running the whole time this element is mounted (not tied to
   *  the in/loop/out state timelines — same "always running" convention as
   *  lightSweep/flagWave/animatedBg). Meaningless (and ignored) when
   *  `dashStyle` is 'solid' — nothing to march. Absent/false = a static
   *  ring, matching how a freshly-added stroke effect with animation not
   *  yet turned on should look. */
  animated?: boolean;
  /** stroke only — which way the dash marches around the ring once
   *  `animated` is on. Absent defaults to 'forward'. */
  direction?: 'forward' | 'reverse';
  /** waveWarp only — After Effects' own "Wave Warp" parameter set, mirrored
   *  field-for-field (see cgEffects.ts's buildWaveWarpFilterProps/
   *  findWaveWarp and lib/useWaveWarp.ts for the actual geometry). A
   *  continuously-running displacement, independent of the in/loop/out
   *  timeline — same "always running" convention flagWave/lightSweep/stroke
   *  above already use, so it reads as a living distortion the whole time
   *  the element is on screen rather than something authored as a one-shot
   *  transition. Every one of AE's own wave shapes is supported, including
   *  the two noise-driven ones ('noise'/'smoothNoise') that give the
   *  "fractal" ripple look the ask for this effect specifically called
   *  out — those two route through SVG's own `<feTurbulence>`
   *  (`fractalNoise`/`turbulence` respectively), the same organic-noise
   *  primitive flagWave's own cloth ripple already uses; the other six
   *  (sine/square/triangle/sawtooth/circle/semicircle) are a procedurally
   *  generated, seamlessly-tileable 1-D waveform image instead (built once
   *  per settings change, not per animation frame — see
   *  buildWaveWarpMapDataUrl). Absent defaults to 'sine'. */
  waveType?: 'sine' | 'square' | 'circle' | 'semicircle' | 'triangle' | 'sawtooth' | 'noise' | 'smoothNoise';
  /** waveWarp only, degrees (0-360) — a static offset added on top of the
   *  live, continuously-advancing phase (driven by `frequency` below) —
   *  AE's own keyframeable "Phase" property, here just a fixed starting
   *  point rather than something keyframed directly (the live sweep already
   *  covers "it keeps moving"; this covers "where it starts"). Absent
   *  defaults to 0. */
  phase?: number;
  /** waveWarp only — AE's own "Pinning" property: which edge(s), if any,
   *  stay fixed (zero displacement) while the rest of the element still
   *  warps, fading smoothly from pinned (0% displacement) to full strength
   *  over roughly a third of the element's own size — e.g. 'left' keeps the
   *  element's left edge perfectly still while everything to its right
   *  ripples normally, the way a flag pinned to a pole only waves away from
   *  that pole. 'all' pins every edge at once (a ripple that bulges in the
   *  middle, fixed all around — AE's own "All Edges"). Corner-only pinning
   *  (AE also has Top-Left/Top-Right/Bottom-Left/Bottom-Right) isn't
   *  included — a deliberately narrower set than AE's full one, since those
   *  four are rarely used and single-edge/all-edges/opposite-edge-pair
   *  pinning already covers the shapes a broadcast graphic actually needs.
   *  Absent defaults to 'none' (every edge warps freely, same as a
   *  freshly-added effect with no pinning considered at all). */
  pinning?: 'none' | 'left' | 'right' | 'top' | 'bottom' | 'all' | 'leftRight' | 'topBottom';
  /** waveWarp only — AE's own "Anti-aliasing for Best Quality" tiers,
   *  approximated here via the filter region's own padding and the
   *  generated wave map's sampling resolution (see
   *  buildWaveWarpFilterProps) rather than a literal per-pixel analog of
   *  AE's own renderer — 'off' is the tightest/cheapest filter region (can
   *  clip a very tall wave at the element's edge), 'high' pads generously
   *  and samples the map at double resolution for the smoothest edges.
   *  Absent defaults to 'low'. */
  antiAlias?: 'off' | 'low' | 'high';
}

/** A gradient value for a `fill`/`bgColor`/`color` config field — see
 *  lib/cgGradient.ts. Coexists with the plain-string solid-color
 *  convention every one of those fields has always used; nothing reads a
 *  color field expecting ONLY a string, so this is fully backward
 *  compatible with every template authored before it existed. */
export interface CgGradientStop { color: string; offset: number; } // offset 0–100
export interface CgGradient {
  type: 'linear' | 'radial';
  /** Degrees, linear only — CSS linear-gradient() angle convention. */
  angle?: number;
  /** Percent (0-100), radial only — the gradient's center, draggable via
   *  GradientAnchorHandle.tsx on the designer canvas. Absent = 50/50
   *  (dead center), matching every radial gradient authored before this
   *  existed — fully backward compatible. */
  cx?: number;
  cy?: number;
  stops: CgGradientStop[];
}

// ── Custom CG template animation (ported from the gfx-studio-2 app's own
// buildTimeline.js/presets.js — same shapes, so behavior carries over
// exactly) — lives in a 'cg-template' widget's `config.states`, a sibling to
// `config.elements`. See lib/cgAnimationEngine.ts for how these are turned
// into GSAP timelines, and CgTemplateDesigner.tsx/CgTemplateTimeline.tsx for
// how they're authored.
export interface CgKeyframe { t: number; v: any; ease?: string }

export interface CgLayerAnim {
  /** A TemplateElement.id — which element on the template this animates. */
  id: string;
  transformOrigin?: string;
  /** Independent of `tracks` below — both can be set on the SAME layer at
   *  once (a canned preset for the broad motion plus hand-tuned keyframe
   *  tracks layered on top for anything the preset doesn't cover), rather
   *  than being forced to pick exactly one and lose the other. Absent/
   *  'none' plays no preset for this layer at all — CgTemplateDesigner.tsx's
   *  own Inspector always shows the preset picker once a layer exists at
   *  all (see its addAnimation/removeAnimation, which replace the older
   *  destructive 3-way "Animation Mode" switch), and CgTemplateTimeline.tsx
   *  always shows the keyframe track editor (with its own "+ Track") for
   *  that same layer regardless of whether it also has a preset — so
   *  either or both can be authored, in any combination, no mode switch
   *  needed. If a track happens to target the SAME property the preset
   *  also animates, whichever one's tween is active for that property at a
   *  given moment simply wins — same caveat as deliberately double-
   *  authoring any other GSAP-owned property elsewhere in this app. */
  preset?: string;
  duration?: number;
  delay?: number;
  ease?: string;
  /** 'preset' mode only (meaningless/ignored with `tracks` — a keyframe
   *  track has its own PER-TRACK reverse button in the timeline instead,
   *  see CgTemplateTimeline.tsx's reverseTrackKeyframes). Plays the SAME
   *  preset as if time itself ran backward — an "in" state's normal
   *  `.from(preset)` (starts at the preset's values, animates INTO rest)
   *  becomes `.to(preset)` (starts at rest, animates OUT to the preset's
   *  values) and vice versa for "out", with the ease also inverted via
   *  easeUtils.ts's invertEaseName so the motion doesn't just play the same
   *  positions backwards with the now-wrong-direction easing curve. This is
   *  a genuine mathematical time-reversal, not merely "the opposite preset"
   *  (e.g. reversing 'slideLeft' on "in" doesn't become 'slideRight' — it
   *  makes THIS element's own reveal look like it's playing in rewind).
   *  Lets an operator get a "such-and-such but backwards" look (e.g. an
   *  Out that eases in sharply then decelerates, instead of the reverse)
   *  without hand-building the equivalent keyframe track. Ignored for the
   *  handful of `_type`-tagged special presets (morph/typewriter/scramble/
   *  sequencePlay/wordSequence) — see buildPresetAnimation in
   *  cgAnimationEngine.ts, which returns to one of THEIR OWN builders
   *  before this flag is ever read. */
  reversed?: boolean;
  tracks?: Record<string, CgKeyframe[]>;
  /** Per-state content override — independent of `preset`/`tracks`, and
   *  combinable with either. Lets THIS element say/show something different
   *  while THIS state is active (e.g. "Player Name" during In, "Player
   *  Stats" during Step 2) instead of the one fixed base value every state
   *  otherwise shares (TemplateElement.config.text/imageUrl). Applied via a
   *  discrete swap when this state's timeline actually plays — see
   *  applyContentOverride in cgAnimationEngine.ts. */
  contentOverride?: { text?: string; imageUrl?: string };
  /** SVG path data (the 'd' attribute) this state morphs a 'shape' element
   *  TOWARD — only meaningful when `preset === 'morph'`. GSAP's
   *  MorphSVGPlugin reads the path's CURRENT `d` (whatever the previous
   *  state left it at, or the base config's `d` on first use) as the
   *  implicit start, so continuity between states is automatic — same as
   *  the keyframe-track continuity fix above. */
  morphTo?: string;
  /** 'sound'-kind layers only — which library sound (lib/sfxLibrary.ts's
   *  SFX_LIBRARY) THIS state plays for this layer, and how loud (0..1,
   *  default 1). Absent/unrecognized id plays nothing, never throws — same
   *  tolerance every other optional cosmetic field in this app already has
   *  for a since-removed/renamed value. Fires once, at `delay` seconds into
   *  this state's own timeline (reusing the same field every other kind
   *  already uses for "when", rather than a second, sound-only time field)
   *  — see cgAnimationEngine.ts's buildOneTimeline, which schedules it via
   *  `tl.call` and returns before ever needing this layer's element to have
   *  a real DOM node (it doesn't — 'sound' renders no pixels at all). */
  sfxId?: string;
  sfxVolume?: number;
}

export interface CgAnimState {
  duration: number;
  /** Pause points (seconds) the timeline stops at until resumed. */
  stops?: number[];
  loop?: boolean;
  yoyo?: boolean;
  repeatDelay?: number;
  layers: CgLayerAnim[];
  /** Governs what happens once this state's timeline reaches its own
   *  natural end (not a mid-animation stops[] point) — 'auto' (the
   *  default, and the only behavior that existed before this field) moves
   *  straight on to whatever's next (Step 1, or Loop) with no operator
   *  input; 'manual' pauses there and waits for "Next Stage"/Cg.Stage.
   *  Only meaningful on 'in' today — 'loop' repeats by design and 'out' is
   *  terminal, neither has anything to "advance to". CgStepState below
   *  already declares this itself (required there); it's optional here so
   *  every template authored before this field existed keeps behaving
   *  exactly as it always did. */
  advanceMode?: 'auto' | 'manual';
  /** Delay (ms) before auto-advancing, when advanceMode is 'auto'. */
  autoAdvanceMs?: number;
}

/** One entry in a template's ordered Step sequence (config.steps) — a
 *  genuinely separate, fully-authored animation state, not just a pause
 *  point within "in" (that's the older, still-supported `stops[]`
 *  mechanic above). Plays In → Step 1 → Step 2 → … → Loop → Out; see
 *  lib/cgAnimationEngine.ts's buildStepTimelines and
 *  widgets/CgTemplateWidget.tsx's playback effect for how the sequence
 *  actually advances. */
export interface CgStepState extends CgAnimState {
  id: string;
  /** Operator-facing label — "Step 1" by default, renamable in the
   *  designer the same way a template element's own name is. */
  name: string;
  /** 'manual' waits for the same "Next Stage" trigger (continueLayer(),
   *  the CG Playout Panel button, or a Cg.Stage button action) that
   *  already resumes a `stops[]` pause point — its meaning simply
   *  generalizes to "advance to the next step" when a template has any.
   *  'auto' instead advances on its own after `autoAdvanceMs`. */
  advanceMode: 'auto' | 'manual';
  /** Only meaningful when advanceMode === 'auto'. */
  autoAdvanceMs?: number;
}

export interface CanvasPage {
  id: string;
  name: string;
  widgets: CanvasWidget[];
  /** Tournament this canvas is dedicated to — since a canvas is normally
   *  built for one specific tournament, widgets on it fall back to this
   *  instead of each needing its own "which tournament" picker. */
  tournamentId?: string;
  /** Venue this canvas is dedicated to, within its bound tournament — same
   *  fallback idea as `tournamentId`, for a multi-venue tournament where
   *  different canvases (e.g. different physical courts) each cover one
   *  venue. Only meaningful alongside `tournamentId` (mirrors the Sidebar's
   *  own Tournament→Venue cascading picker). */
  venue?: string;
  /** OS-global hotkey that jumps straight to this page (see
   *  collectHotkeyBindings/App.GoToPage) — main canvas pages only. */
  hotkey?: string;
}

export const WIDGET_DEFAULTS: Record<WidgetType, { w: number; h: number; config: Record<string, any> }> = {
  button: {
    w: 140, h: 70,
    config: { label: 'Button', actions: [{ fn: 'Cut', params: {} }], releaseActions: [], mode: 'momentary', color: '#3498db', textColor: '#ffffff', fontSize: 14 },
  },
  'title-field': {
    w: 280, h: 130,
    config: {
      label: 'Title Fields',
      autoSend: false,
      autoSendDelayMs: 400,
      inputs: [{ inputKey: '', fields: ['Title.Text'] }],
    },
  },
  'file-path': {
    w: 260, h: 90,
    config: {
      label: 'File Path',
      inputKey: '',
      fieldName: 'Path.Text',
      accept: 'image/*',
      autoSend: false,
      currentPath: '',
    },
  },
  'racket-scoreboard': {
    w: 340, h: 460,
    config: {
      // 'rally' sports (badminton/table tennis/sepaktakraw) share one
      // scoring engine; 'tennis' is its own — see lib/racketScoring.ts.
      // `sport` just drives labels/defaults/roster positions; the actual
      // rules always come from the fields below, which stay independently
      // editable per the "customize point to win" ask rather than being
      // re-derived from `sport` on every render.
      sport: 'badminton',
      teamAId: '', teamBId: '',
      // 'Team A'/'Team B' — not 'Player A'/'B' — since a side here can just
      // as easily be a doubles pair, a sepaktakraw regu (3 on court), or a
      // whole club/country squad as it can a single player; same neutral
      // convention ScoreboardWidget.tsx already uses for every OTHER sport,
      // individual or team alike.
      teamAName: 'Team A', teamBName: 'Team B',
      teamAShortName: '', teamBShortName: '',
      // Who's actually PLAYING for this side — a doubles pair's two names,
      // a sepaktakraw regu's three, or a singles player — distinct from
      // teamAName/B above, which is often the club/country instead (e.g.
      // "Malaysia"). Plain string arrays (not roster ids) so they work
      // identically whether or not this side is linked to a SavedTeam.
      // playerCount is how many startersA/B SLOTS the widget shows per
      // side — see RacketScoreboardWidget.tsx's own Settings panel.
      playerCount: 1,
      startersA: [], startersB: [],
      subsA: [], subsB: [],
      teamAColor: '#e74c3c', teamBColor: '#3498db',
      teamALogo: '', teamBLogo: '',
      competition: '', subtitle: '', category: '', group: '', tier: '',
      linkedTournamentId: '',
      // Scoring rules — pre-filled from SPORT_DEFAULTS[sport].racketScoring
      // whenever `sport` is (re)picked (see RacketScoreboardWidget.tsx),
      // then stored here rather than re-read live from the tournament, so a
      // widget's own numbers stay stable even if the tournament's own
      // defaults change later, and so every number really is per-match
      // customizable.
      scoringMode: 'rally',
      pointsToWin: 21, winBy2: true, pointCap: 30, gamesToWin: 2,
      tiebreakAtGames: 6, noAd: false,
      // Live match state — see lib/racketScoring.ts's RallyMatchState/
      // TennisMatchState. Only the one matching `scoringMode` is ever
      // meaningful; the other just sits at its own fresh-match default.
      rallyState: { pointsA: 0, pointsB: 0, games: [], server: 'A' },
      tennisState: { pointsA: 0, pointsB: 0, gamesA: 0, gamesB: 0, setsA: 0, setsB: 0, sets: [], inTiebreak: false, tiebreakA: 0, tiebreakB: 0, server: 'A' },
      // Snapshot stack for Undo — see RacketScoreboardWidget.tsx's own
      // doc comment on why this lives in plain config (persisted, unlike a
      // ref) rather than local component state.
      pointHistory: [],
      vmixInputKey: '',
      fieldScoreA: 'ScoreA.Text', fieldScoreB: 'ScoreB.Text',
      fieldTeamA: 'TeamA.Text', fieldTeamB: 'TeamB.Text',
      lastSavedSignature: '',
    },
  },
  scoreboard: {
    w: 340, h: 320,
    config: {
      style: 'basic', teamAName: 'Team A', teamBName: 'Team B',
      teamAShortName: '', teamBShortName: '',
      teamATextField: '', teamBTextField: '',
      competition: '', subtitle: '',
      teamAColor: '#e74c3c', teamBColor: '#3498db', scoreA: 0, scoreB: 0,
      increments: [1, 2, 5, 10], vmixInputKey: '',
      fieldScoreA: 'ScoreA.Text', fieldScoreB: 'ScoreB.Text',
      fieldTeamA: 'TeamA.Text', fieldTeamB: 'TeamB.Text',
      fieldShortA: 'ShortA.Text', fieldShortB: 'ShortB.Text',
      scoreLog: [],
      linkedTimerWidgetId: '', linkedScoreLogWidgetId: '',
      linkedPlayerListA: '', linkedPlayerListB: '',
      linkedScoreboardSourceId: '',
      // Set automatically when a scheduled fixture is loaded (Load Match /
      // Send to Scoreboard) — tags "Save Result" snapshots with the right
      // tournament so they show up in that tournament's Results tab.
      linkedTournamentId: '',
      // Also set automatically on load — lets "Save Result" mark the
      // originating fixture as completed back in the Schedule tab.
      linkedScheduleMatchId: '',
      lastSavedSignature: '',
      // Carried from the fixture when it's a bye/walkover — undefined for a
      // normal match.
      matchType: '',
      walkoverLoser: '',
    },
  },
  'score-log': {
    w: 300, h: 300,
    config: {
      linkedScoreboardId: '', teamFilter: 'all',
    },
  },
  'score-lower-third': {
    w: 300, h: 180,
    config: {
      linkedScoreboardId: '',
      teamFilter: 'all',
      autoSend: false,
      overlayChannel: 1,
      vmixInputs: [
        { id: 'default', actionLabel: '', vmixInputKey: '', vmixInputTitle: '',
          fieldTeam: 'Team.Text', fieldScorer: 'Scorer.Text', fieldJersey: 'Jersey.Text', fieldAction: 'Action.Text' },
      ],
    },
  },
  'placement-lower-third': {
    w: 300, h: 180,
    config: {
      filterTournamentId: '', filterCategory: '',
      activeSlotId: 'p1', autoSend: false, overlayChannel: 1,
      slots: [
        { id: 'p1', rank: 1, label: 'Champion', manualTeamName: '', vmixInputKey: '', fieldLabel: 'Label.Text', fieldTeam: 'Team.Text' },
        { id: 'p2', rank: 2, label: 'Runner-Up', manualTeamName: '', vmixInputKey: '', fieldLabel: 'Label.Text', fieldTeam: 'Team.Text' },
        { id: 'p3', rank: 3, label: '3rd Place', manualTeamName: '', vmixInputKey: '', fieldLabel: 'Label.Text', fieldTeam: 'Team.Text' },
      ],
    },
  },
  'player-lower-third': {
    w: 300, h: 180,
    config: {
      linkedPlayerListId: '',
      autoSend: false,
      overlayChannel: 1,
      vmixInputKey: '',
      vmixInputTitle: '',
      fieldName: 'Name.Text',
      fieldJersey: 'Jersey.Text',
      fieldPosition: 'Position.Text',
      fieldTeam: 'Team.Text',
      highlightedPlayerId: '',
      highlightedName: '',
      highlightedJersey: '',
      highlightedPosition: '',
      highlightedTeam: '',
      highlightedTeamColor: '',
      highlightedSide: 'A',
    },
  },
  timeline: {
    w: 320, h: 420,
    config: {
      title: 'Match Timeline',
      events: [],
      linkedTimerWidgetId: '',
      linkedScoreboardId: '',
      // appearance
      showTeamHeader: true,
      bgColor: '',
      fontSizeEvent: 11,
      fontSizeTime: 10,
      fontSizeTeam: 11,
      fontSizePlayer: 10,
      bubbleHeight: 24,
      bubbleBg: '',
      bubbleTextColor: '',
      rowMinHeight: 48,
      spineWidth: 1,
      spineColor: '',
    },
  },
  timer: {
    w: 220, h: 180,
    config: {
      name: 'Timer', mode: 'countdown', format: 'mm:ss', timerFontSize: 28,
      // All optional, off by default — combine freely with `format`. Applied
      // to the on-screen display always, and to the vMix text output too
      // unless vmixFollowsFormat is turned off, in which case the vmix*
      // fields below take over for vMix only.
      showMs: false, noLeadingZero: false, subMinuteMs: false,
      vmixFollowsFormat: true, vmixFormat: 'mm:ss',
      vmixShowMs: false, vmixNoLeadingZero: false, vmixSubMinuteMs: false,
      periodOverrides: {},
      durationMs: 300000, currentMs: 300000, running: false,
      highPrecision: false, vmixInputKey: '', fieldName: 'Timer.Text',
      periods: 1, periodMode: 'reset', overrun: false, breakDurationMs: 0,
      // When false (default), period end and break end both stop the timer and
      // wait for a manual Play/Resume press. When true, it flows straight
      // through period → break → next period with no manual step.
      autoAdvance: false,
      // Set when a period's timer reaches its scheduled end on its own (not
      // autoAdvance/Final Play) — the operator must confirm before the label
      // actually advances, same prompt as pressing the manual End button.
      awaitingEndConfirm: false,
      // When true (opt-in), confirming "End Period" still requires the
      // confirm prompt, but the half-time/break countdown starts immediately
      // afterward instead of waiting for a second Play press.
      autoStartBreak: false,
      currentPeriod: 1, periodStartMs: 0, overrunning: false, inBreak: false, breakCurrentMs: 0,
      breakVmixInputKey: '', breakFieldName: 'Timer.Text',
      miniVmixInputKey: '', miniFieldName: 'MiniTimer.Text',
      overrunColorEnabled: false, overrunColor: '#ff0000', normalColor: '#ffffff', overrunColorField: '',
      linkedTournamentId: '',
      linkedTimerSourceId: '',
      extraTimePeriods: 0, etDurationMs: 300000, etBreakDurationMs: 0,
      inExtraTime: false, etCurrentPeriod: 1, etCurrentMs: 300000,
      etPeriodStartMs: 0, etInBreak: false, etBreakCurrentMs: 0, etOverrunning: false,
      afterEtMode: 'none', afterEtDurationMs: 0,
      inAfterEt: false, afterEtCurrentMs: 0, afterEtOverrunning: false,
      finalPlayEnabled: false, inFinalPlay: false, finalPlayMs: 0, finalPlayPendingNext: false,
      finalPlayDurationMs: 0,
      finalPlayVmixInputKey: '', finalPlayFieldName: 'FinalPlay.Text',
      finalPlayEndTriggerEnabled: false, finalPlayEndTriggerFn: '', finalPlayEndTriggerInput: '', finalPlayEndTriggerInputTitle: '', finalPlayEndTriggerSelectedName: '', finalPlayEndTriggerValue: '',
      periodEndTriggerEnabled: false, periodEndTriggerFn: '', periodEndTriggerInput: '', periodEndTriggerInputTitle: '', periodEndTriggerValue: '', periodEndTriggerSelectedName: '',
    },
  },
  tbar: {
    w: 280, h: 60,
    config: { label: 'T-Bar', orientation: 'horizontal' },
  },
  volume: {
    w: 72, h: 220,
    config: { target: 'master', inputKey: '', busName: 'M', showMute: true, label: 'Master' },
  },
  overlay: {
    w: 200, h: 110,
    config: { channel: 1 },
  },
  label: {
    w: 160, h: 44,
    config: { text: 'Label', fontSize: 14, color: '#ffffff', bgColor: 'transparent', align: 'center', bold: false },
  },
  'input-tally': {
    w: 130, h: 80,
    config: { inputKey: '', showTitle: true, showType: true },
  },
  transitions: {
    w: 300, h: 60,
    config: { buttons: ['cut', 'fade', 'auto'] },
  },
  'player-list': {
    w: 300, h: 520,
    config: {
      linkedTournamentId: '',
      linkedTeamId: '',
      teamSide: 'A',
      linkedScoreboardId: '',
      layout: 'single',
      linkedTimerWidgetId: '',
      linkedTimelineId: '',
      showTime: true,
      showPosition: true,
      showStats: false,
      viewSize: 'normal',
      starters: [],
      subs: [],
      onField: [],
      entries: {},
      accumulated: {},
      subbedOnPlayers: [],
      vmixTeamInputKey: '',
      vmixTeamInputTitle: '',
      vmixTeamFieldName: 'TeamName.Text',
      vmixTeamFieldShort: 'ShortName.Text',
      vmixTeamAutoSync: false,
    },
  },
  'player-list-next': {
    w: 600, h: 520,
    config: {
      linkedTournamentId: '',
      filterVenue: '',
      filterCategory: '',
      linkedTimerWidgetId: '',
      linkedTimelineId: '',
      showTime: true,
      showPosition: true,
      showStats: false,
      viewSize: 'normal',
      a_starters: [], a_subs: [], a_onField: [], a_entries: {}, a_accumulated: {}, a_subbedOnPlayers: [],
      b_starters: [], b_subs: [], b_onField: [], b_entries: {}, b_accumulated: {}, b_subbedOnPlayers: [],
    },
  },
  substitution: {
    w: 300, h: 360,
    config: {
      linkedTournamentId: '',
      linkedTeamId: '',
      teamSide: 'A',
      linkedPlayerListId: '',
      linkedTimerWidgetId: '',
      linkedTimelineId: '',
    },
  },
  'card-display': {
    w: 260, h: 200,
    config: {
      linkedPlayerListA: '',
      linkedPlayerListB: '',
      showNames: true,
    },
  },
  'sin-bin-lower-third': {
    w: 300, h: 180,
    config: {
      linkedPlayerListId: '',
      autoSend: false,
      overlayChannel: 1,
      vmixInputKey: '',
      vmixInputTitle: '',
      fieldJersey: 'Jersey.Text',
      fieldName: 'Name.Text',
      fieldTimer: 'Timer.Text',
      fieldTeam: 'Team.Text',
    },
  },
  panel: {
    w: 240, h: 200,
    config: { items: [] },
  },
  'vmix-titles': {
    w: 280, h: 260,
    config: { inputs: [], showThumbs: true, autoSend: false },
  },
  'card-lower-third': {
    w: 300, h: 180,
    config: {
      linkedPlayerListA: '',
      linkedPlayerListB: '',
      autoSend: false,
      overlayChannel: 1,
      vmixInputKey: '',
      vmixInputTitle: '',
      fieldJersey: 'Jersey.Text',
      fieldName: 'Name.Text',
      fieldTeam: 'Team.Text',
      fieldCardType: 'Card.Text',
    },
  },
  'rugby-lineup': {
    w: 420, h: 560,
    config: {
      linkedTournamentId: '',
      linkedTeamId: '',
      teamName: 'Team Name',
      teamColor: '#3498db',
      fieldColor: '#2d7a3a',
      players: [
        { number: 1,  position: 'Loosehead Prop',  name: '', x: 27, y: 13, jerseyColor: '#3498db', textColor: '#222222' },
        { number: 2,  position: 'Hooker',           name: '', x: 50, y: 13, jerseyColor: '#3498db', textColor: '#222222' },
        { number: 3,  position: 'Tighthead Prop',   name: '', x: 73, y: 13, jerseyColor: '#3498db', textColor: '#222222' },
        { number: 6,  position: 'Open Flanker',     name: '', x: 13, y: 29, jerseyColor: '#3498db', textColor: '#222222' },
        { number: 4,  position: 'L Lock',           name: '', x: 35, y: 29, jerseyColor: '#3498db', textColor: '#222222' },
        { number: 5,  position: 'R Lock',           name: '', x: 58, y: 29, jerseyColor: '#3498db', textColor: '#222222' },
        { number: 7,  position: 'Blind Flanker',    name: '', x: 80, y: 29, jerseyColor: '#3498db', textColor: '#222222' },
        { number: 8,  position: 'Number 8',         name: '', x: 50, y: 42, jerseyColor: '#3498db', textColor: '#222222' },
        { number: 9,  position: 'Scrum Half',       name: '', x: 50, y: 52, jerseyColor: '#3498db', textColor: '#222222' },
        { number: 10, position: 'Fly Half',         name: '', x: 30, y: 62, jerseyColor: '#3498db', textColor: '#222222' },
        { number: 12, position: 'Inside Centre',    name: '', x: 64, y: 62, jerseyColor: '#3498db', textColor: '#222222' },
        { number: 11, position: 'Left Wing',        name: '', x: 11, y: 76, jerseyColor: '#3498db', textColor: '#222222' },
        { number: 13, position: 'Outside Centre',   name: '', x: 31, y: 76, jerseyColor: '#3498db', textColor: '#222222' },
        { number: 15, position: 'Full Back',        name: '', x: 53, y: 76, jerseyColor: '#3498db', textColor: '#222222' },
        { number: 14, position: 'Right Wing',       name: '', x: 78, y: 76, jerseyColor: '#3498db', textColor: '#222222' },
      ],
    },
  },
  'rugby-lineup-next': {
    w: 420, h: 560,
    config: {
      linkedTournamentId: '',
      filterVenue: '',
      filterCategory: '',
      teamSide: 'A',
      teamColor: '#3498db',
      fieldColor: '#2d7a3a',
    },
  },
  pomodoro: {
    w: 360, h: 200,
    config: {
      label: 'Custom Timer',
      timerMode: 'countdown',
      durationMs: 10 * 60 * 1000,
      currentMs: 10 * 60 * 1000,
      running: false,
      showClock: false,
      clockFormat: '24h',
    },
  },
  'image-display': {
    w: 240, h: 160,
    config: { imageUrl: '', objectFit: 'contain', bgColor: 'transparent' },
  },
  'recent-matches': {
    w: 320, h: 360,
    config: {
      title: 'Latest Results',
      maxResults: 8,
      groupByCompetition: true,
      showDate: true,
    },
  },
  'match-schedule': {
    w: 340, h: 320,
    config: {
      title: 'Upcoming Matches',
      linkedScoreboardId: '',
    },
  },
  rundown: {
    w: 380, h: 420,
    config: { title: 'Rundown' },
  },
  standings: {
    w: 360, h: 320,
    config: {
      title: 'Standings',
      filterTournamentId: '',
      filterCategory: '',
    },
  },
  bracket: {
    w: 520, h: 400,
    config: {
      filterTournamentId: '',
      filterCategory: '',
      filterTier: '',
    },
  },
  'team-form': {
    w: 340, h: 360,
    config: {
      linkedScoreboardId: '',
      // Each pushes ALL of that section's rows joined into one text field
      // (" | "-separated), same convention as score-log's summary output —
      // a vMix text field is one string, not a table, so every stage for
      // that team/section lands in a single field rather than needing a
      // separate numbered field per row.
      vmixResultsAInputKey: '', vmixResultsAInputTitle: '', vmixResultsAField: '',
      vmixUpcomingAInputKey: '', vmixUpcomingAInputTitle: '', vmixUpcomingAField: '',
      vmixResultsBInputKey: '', vmixResultsBInputTitle: '', vmixResultsBField: '',
      vmixUpcomingBInputKey: '', vmixUpcomingBInputTitle: '', vmixUpcomingBField: '',
    },
  },
  'player-h2h': {
    w: 360, h: 320,
    config: {
      linkedScoreboardId: '',
      playerAId: '', playerBId: '',
      // One shared vMix input (like Scoreboard's own single inputKey) with a
      // separate named field per data point per side — these are fixed
      // scalar values (not a variable-length list like Team Form's rows),
      // so individually-addressable fields suit a broadcast title template
      // better than one joined string would.
      vmixInputKey: '', vmixInputTitle: '',
      fieldNameA: '', fieldJerseyA: '', fieldPositionA: '',
      fieldTriesA: '', fieldConversionsA: '', fieldPenaltiesA: '', fieldDropGoalsA: '', fieldYellowCardsA: '', fieldRedCardsA: '', fieldAppearancesA: '',
      fieldNameB: '', fieldJerseyB: '', fieldPositionB: '',
      fieldTriesB: '', fieldConversionsB: '', fieldPenaltiesB: '', fieldDropGoalsB: '', fieldYellowCardsB: '', fieldRedCardsB: '', fieldAppearancesB: '',
    },
  },
  'player-stats': {
    w: 260, h: 280,
    config: {
      linkedScoreboardId: '',
      // Which side's roster the Player picker below offers — set this
      // first in settings, then Player populates from that team.
      teamSide: 'A',
      playerId: '',
      vmixInputKey: '', vmixInputTitle: '',
      vmixAutoSync: false,
      fieldName: '', fieldJersey: '', fieldPosition: '', fieldTeam: '', fieldTeamLogo: '',
      fieldTries: '', fieldConversions: '', fieldPenalties: '', fieldDropGoals: '', fieldYellowCards: '', fieldRedCards: '', fieldAppearances: '',
    },
  },
  'player-highlight': {
    w: 260, h: 300,
    config: {
      linkedScoreboardId: '',
      teamSide: 'A',
      playerId: '',
      highlightTitle: 'MVP',
      customTitles: [] as string[],
      vmixInputKey: '', vmixInputTitle: '',
      vmixAutoSync: false,
      fieldTitle: '', fieldName: '', fieldJersey: '', fieldPosition: '', fieldTeam: '', fieldTeamLogo: '',
      fieldTries: '', fieldConversions: '', fieldPenalties: '', fieldDropGoals: '', fieldYellowCards: '', fieldRedCards: '', fieldAppearances: '',
    },
  },
  'group-standings': {
    w: 300, h: 340,
    config: {
      linkedScoreboardId: '',
      title: '',
      vmixInputKey: '', vmixInputTitle: '',
      vmixAutoSync: false,
      rankPrefix: '', teamPrefix: '', shortTeamPrefix: '', playedPrefix: '', wonPrefix: '', drawnPrefix: '', lostPrefix: '',
      pfPrefix: '', paPrefix: '', diffPrefix: '', ptsPrefix: '',
      mergedPrefix: '', mergedParts: [] as string[], mergedSeparator: ' ',
    },
  },
  'cg-template': {
    // Full broadcast frame, not just a tight box around the graphic —
    // matches the reference app's own template convention (e.g. a
    // lower-third's template is still declared 1920×1080, with its actual
    // bar/text elements positioned low within that frame), so an operator
    // designing "the whole picture" isn't fighting a tiny default canvas.
    w: 1920, h: 1080,
    config: { elements: [] as TemplateElement[] },
  },
};

export const WIDGET_TYPE_LABELS: Record<WidgetType, string> = {
  button: 'Button', 'title-field': 'Title Field', 'file-path': 'File Path',
  scoreboard: 'Scoreboard', 'racket-scoreboard': 'Racket Scoreboard', 'score-log': 'Score Log', 'score-lower-third': 'Score Lower Third', 'player-lower-third': 'Player Highlight', 'sin-bin-lower-third': 'Sin Bin LT',
  timeline: 'Timeline',
  'player-list': 'Player List',
  'player-list-next': 'Player List — Next Match',
  substitution: 'Quick Sub',
  'card-display': 'Card Display',
  timer: 'Timer', tbar: 'T-Bar', volume: 'Volume',
  overlay: 'Overlay', label: 'Label', 'input-tally': 'Input Tally', transitions: 'Transitions',
  panel: 'Custom Panel',
  'vmix-titles': 'vMix Titles',
  'rugby-lineup': 'Rugby Lineup',
  'rugby-lineup-next': 'Rugby Lineup — Next Match',
  'card-lower-third': 'Card LT',
  'placement-lower-third': 'Placement Lower Third',
  pomodoro: 'Custom Timer',
  'image-display': 'Image',
  'recent-matches': 'Latest Results',
  'match-schedule': 'Match Schedule',
  rundown: 'Rundown',
  standings: 'Standings',
  bracket: 'Bracket',
  'team-form': 'Team Form',
  'player-h2h': 'Player H2H',
  'player-stats': 'Player Stats',
  'player-highlight': 'Player Highlight (MVP)',
  'group-standings': 'Group Standings (Live)',
  'cg-template': 'Custom Template',
};

/** A TemplateElement's own kind → display label — shared by
 *  CgTemplateDesigner.tsx's Layers panel and CgTemplateTimeline.tsx's own
 *  per-layer row label, so an unnamed element's fallback name ("Rect 2")
 *  reads identically in both places rather than the timeline showing
 *  something else entirely (its raw `kind` string, or a text element's own
 *  content, neither of which is what the Layers panel calls it). Lives
 *  here rather than in either component file specifically so importing it
 *  into CgTemplateTimeline.tsx (which CgTemplateDesigner.tsx itself
 *  imports) can't create a circular import between the two. */
/** 'credits' — a full production end-credits roll: `config.sections:
 *  CreditsSection[]` (department/cast/sponsor blocks, each with its own
 *  optional `title` + a list of role/name `entries` — see CreditsEntry/
 *  CreditsSection's own doc comments), rendered per `config.mode`:
 *   - 'scroll' (default) — every section stacked into one continuous strip
 *     that scrolls through the element's own box, the classic movie-
 *     credits crawl. `config.scrollDirection` ('vertical', default, or
 *     'horizontal') picks the axis: vertical stacks sections in a column
 *     scrolling bottom-to-top; horizontal lays them out side by side
 *     (each section still its own internal column of title+entries)
 *     scrolling right-to-left, ticker-style. `config.scrollSpeed` (px/s,
 *     default 60) sets how fast; `config.loop` (default true) restarts
 *     from the starting edge the instant it fully scrolls off the far one,
 *     else it scrolls through once and stops empty.
 *   - 'sequence' — one section on screen at a time (centered, static — no
 *     scrolling), holding for `config.slideDuration` seconds (default 3)
 *     then transitioning to the next via `config.transitionPreset` (any
 *     key from lib/cgPresets.ts's own PRESETS/OUT_PRESETS catalog — the
 *     SAME entrance/exit library used everywhere else in this app, so
 *     "many more animations" is really the whole existing preset list:
 *     fades, slides, zooms, flips, rotations, etc. — rather than a
 *     separate hand-built set just for this kind), `config.transitionDuration`
 *     (default 0.6) and `config.transitionEase` (default 'power2.inOut').
 *     `config.loop` (default true) wraps back to the first section after
 *     the last, else it stops holding on the last one.
 *  Both modes share the same look/typography fields: `config.fontFamily`,
 *  `config.align` ('left'|'center'|'right', default 'center'),
 *  `config.titleFontSize`/`titleColor`/`titleBold` (a section's own
 *  heading), `config.roleFontSize`/`roleColor` (an entry's role, e.g.
 *  "Director" — muted/smaller by default), `config.nameFontSize`/
 *  `nameColor`/`nameBold` (an entry's own name/credited party — this is
 *  what still renders for an entry with no `role` at all, e.g. a plain
 *  sponsor name), `config.entryGap`/`sectionGap` (px spacing),
 *  `config.logoHeight` (px, default 60 — any entry with its own `logoUrl`
 *  set renders that image at this height instead of role/name text, `name`
 *  becoming a small caption under it when both are set — see CreditsEntry's
 *  own doc comment). See
 *  lib/useCreditsAnimation.ts for exactly how each mode is actually
 *  driven — one hook call each from CgTemplateWidget.tsx/
 *  CgTemplateDesigner.tsx, same convention every other self-contained
 *  per-kind animation (ticker's scroll, imagePlaylist's slideshow) already
 *  follows. */
export const KIND_LABEL: Record<TemplateElement['kind'], string> = { text: 'Text', image: 'Image', rect: 'Rect', sequence: 'Sequence', shape: 'Shape', ticker: 'Ticker', statbar: 'Stat Bar', imagePlaylist: 'Image Playlist', cardCarousel: 'Card Carousel', sound: 'Sound', nestedTemplate: 'Nested Template', credits: 'End Credits', matchSchedule: 'Match Schedule', standings: 'Standings', bracket: 'Bracket' };

/** Drops any element whose `kind` no longer exists in this app (a template
 *  saved while an older version was still shipping it) — a pure, render-
 *  time normalization, applied by both renderers (CgTemplateDesigner.tsx's/
 *  CgTemplateWidget.tsx's own `elements` constant) wherever a widget's raw
 *  config.elements gets read, so a stale kind can never reach any kind-
 *  keyed lookup (KIND_ICON, KIND_LABEL, either renderer's own if/else
 *  dispatch) and crash on a missing entry — same "tolerate an unrecognized/
 *  removed value instead of throwing" discipline every other optional/
 *  legacy field in this app already has. Currently drops 'model3D',
 *  'camera' and 'cameraView' (the whole Three.js-based 3D World/Camera
 *  feature set, removed for being too heavy on the app's own bundle/
 *  runtime cost) — there's no 2D equivalent to fall back to, so a template
 *  that still has one of these just quietly loses that one layer instead
 *  of crashing. Also drops any child of a dropped element (parentId
 *  pointing at a kind that no longer exists) so nothing is left orphaned.
 *  Never mutates config (a pure filter/map, building new objects), and
 *  deliberately does NOT write the result back to storage — the saved file
 *  keeps its own history untouched; this patch is cheap enough to just
 *  reapply on every read. */
export function migrateLegacyElements(elements: TemplateElement[]): TemplateElement[] {
  const REMOVED_KINDS = new Set(['model3D', 'camera', 'cameraView']);
  const droppedIds = new Set(
    elements.filter((el) => REMOVED_KINDS.has(el.kind as string)).map((el) => el.id)
  );
  return elements.filter((el) => !REMOVED_KINDS.has(el.kind as string) && !(el.parentId && droppedIds.has(el.parentId)));
}

/** A parent's own children, top-of-stack first — same convention a layers
 *  palette conventionally reads (last-added/frontmost sibling on top),
 *  matching gfx-studio-2's own zIndex-descending sort. Extracted here (not
 *  local to either CgTemplateDesigner.tsx's Layers panel or
 *  CgTemplateTimeline.tsx) so both build their own element ORDER from this
 *  one shared primitive instead of independently re-deriving it — exactly
 *  the KIND_LABEL problem above (two places computing "the same thing" that
 *  quietly drifted apart) but for row order instead of row text. */
export function reversedSiblings(elements: TemplateElement[], parentId: string | undefined): TemplateElement[] {
  return elements.filter((el) => el.parentId === parentId).slice().reverse();
}

/** Every element in the same order the Layers panel lists them — reversed
 *  top-of-stack-first siblings (reversedSiblings above), with each
 *  element's own children listed immediately after it, depth-first. Used
 *  anywhere else that lists elements and should read in the same sequence
 *  as the Layers panel (currently: CgTemplateTimeline.tsx's own row order —
 *  it used to just iterate its CgAnimState's `layers` array in whatever
 *  order layers were added animation in, which has no reason to match the
 *  Layers panel's own z-stack/nesting order at all, so the two could show
 *  the same set of elements in two completely different sequences even
 *  though each row's own NAME was already correct). */
export function orderElementsForDisplay(elements: TemplateElement[]): TemplateElement[] {
  const build = (parentId: string | undefined): TemplateElement[] =>
    reversedSiblings(elements, parentId).flatMap((el) => [el, ...build(el.id)]);
  return build(undefined);
}

