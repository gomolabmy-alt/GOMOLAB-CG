import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  X, Type, Image as ImageIcon, Images, GalleryHorizontal, Square, Film, Shapes, PenTool, Link2, Unlink, Play, Octagon, Minus, Plus as PlusIcon, Maximize, MoveHorizontal, BarChart2, Pencil, Archive, Trophy,
  Undo2, Redo2, Magnet, Grid3x3, Copy, Eye, EyeOff, ChevronUp, ChevronDown, Download, Upload, SkipForward, Search, Box, Users, Folder, FolderMinus, ScrollText, BringToFront, SendToBack,
  Crosshair, Frame, Volume2, VolumeX, LayoutTemplate, CalendarDays, ListOrdered, Network, Loader2,
  AlignHorizontalJustifyStart, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { gsap } from 'gsap';
import { useCanvasStore } from '../stores/canvasStore';
import { useAppSettings } from '../stores/appSettingsStore';
import { useTeamDbStore } from '../stores/teamDbStore';
import { nearestScalePreset } from '../stores/appSettingsStore';
import { WIDGET_TYPE_LABELS, KIND_LABEL, reversedSiblings, migrateLegacyElements } from '../types/canvas';
import type { CanvasWidget, CgAnimState, CgCarouselCard, CgChangeAnim, CgEffect, ElementCondition, CgKeyframe, CgLayerAnim, CgStepState, CgWordSequenceItem, CreditsEntry, CreditsSection, StatBarRow, TemplateElement, TemplateElementBinding, MatchScheduleRole, StandingsRole, BracketMatchRole } from '../types/canvas';
import { getBindableParts, resolveBindingValue, hasLiveBinding, GROUP_SLOT_PARTS, TOURNAMENT_FIELD_PARTS } from '../lib/templateBinding';
import { CONDITION_OPERATOR_LABELS, parseConditionNumber } from '../lib/elementCondition';
import { useTournamentStore } from '../stores/tournamentStore';
import { normalizeGroups } from './TournamentManager';
import { resolveImageUrl } from '../lib/imageUrl';
import { PRESETS, OUT_PRESETS, EASES, buildStaticTransform3D } from '../lib/cgPresets';
import { SHAPE_LIBRARY, SHAPE_VIEWBOX, DEFAULT_SHAPE } from '../lib/svgShapes';
import { parseBezierEase, bezierEaseString } from '../lib/easeUtils';
import { EaseCurveEditor } from './EaseCurveEditor';
import { resolveElementFilter, shadeHex, effectTrackKey, parseEffectTrackKey, scalePathToUnitBox, findLightSweep, buildLightSweepGeometry, findGlass, buildGlassStyle, buildGlassEdgeStyle, buildImageGlassMask, buildTextGlassMask, findFlagWave, buildFlagWaveFilterProps, findBevel, buildBevelFilterProps, findInnerShadow, buildInnerShadowFilterProps, findAnimatedBg, buildAnimatedBgStyle, GOOEY_THRESHOLD_MATRIX, buildFractalGlassRidgeStyle, buildCrystalFacetStyle, buildLiquidGlassFilterProps, buildLiquidGlassMapSvg, hexToRgba, findRampBlur, buildRampBlurFilterProps, buildRampMaskSvg, buildRampMaskImage, combineGlassMasks, findStroke, buildStrokeGeometry, buildStrokeGlowFilter, findWaveWarp, buildWaveWarpFilterProps, buildWaveWarpMapSvg, buildWaveWarpPinMaskSvg, waveWarpMapPad } from '../lib/cgEffects';
import { useReorderAnimation } from '../lib/useReorderAnimation';
import { useFlagWave, type FlagWaveNodes } from '../lib/useFlagWave';
import { useWaveWarp, type WaveWarpNodes } from '../lib/useWaveWarp';
import { useSequenceLoop } from '../lib/useSequenceLoop';
import { useAnimatedBg } from '../lib/useAnimatedBg';
import { useElementConditions } from '../lib/useElementConditions';
import { useLightSweep } from '../lib/useLightSweep';
import { useRunningStroke } from '../lib/useRunningStroke';
import { useMatchScheduleData, paginateMatches, resolveRowTemplateId, buildMatchRowOverrides } from '../lib/matchScheduleRow';
import { useStandingsData, paginateStandings, resolveStandingsRowTemplateId, buildStandingsRowOverrides } from '../lib/standingsRow';
import { useBracketData, resolveBracketRowTemplateId, buildBracketRowOverrides } from '../lib/bracketRow';
import { CHANGE_ANIM_PRESETS, TEXT_ONLY_CHANGE_PRESETS, buildChangeTransition } from '../lib/cgChangePresets';
import { resolveBackground, resolveSvgFill, resolveTextColorStyle, isGradient } from '../lib/cgGradient';
import { useAutoFitFontSize } from '../lib/useAutoFitFontSize';
import { useTickerScroll } from '../lib/useTickerScroll';
import { useCreditsAnimation } from '../lib/useCreditsAnimation';
import { CreditsSectionContent, creditsStyleFromConfig } from '../lib/creditsView';
import { GOOGLE_FONTS, ensureGoogleFontLoaded, ensureGoogleFontsLoaded, fontFamilyCss } from '../lib/cgFonts';
import { resolveStatbarValue, statbarPercentA, useStatbarRowTweens, STATBAR_EASE_OPTIONS } from '../lib/useStatbarValues';
import { SEVEN_SEG_VIEWBOX, SEVEN_SEG_WIDTH, SEVEN_SEG_HEIGHT, SEGMENT_NAMES, segmentPathFor, isSevenSegmentDigit, colonDotPaths, DIGIT_SEGMENTS, SEGMENT_PATH_ON, SEGMENT_PATH_OFF } from '../lib/sevenSegment';
import { ColorOrGradientPicker } from './ColorOrGradientPicker';
import { buildStateTimelines, buildStepTimelines, type CgStateName } from '../lib/cgAnimationEngine';
import { tgaFileToPngBase64 } from '../lib/tgaDecoder';
import { LogoUrlPicker } from './LogoUrlPicker';
import { ColorPicker } from './ColorPicker';
import { CgTemplateWidget } from './widgets/CgTemplateWidget';
import { applyCardOverrides } from '../lib/cardCarousel';
import { SFX_LIBRARY, playSfx } from '../lib/sfxLibrary';
import { TEXT_REVEAL_STYLES, TEXT_REVEAL_DEFAULT_EASE } from '../lib/textReveal';
import { isSequenceConsolidated, consolidateSequenceFrames } from '../lib/sequenceConsolidate';
import { ConfirmModal } from './ConfirmModal';
import { TemplateElementWrapper, type SnapGuides } from './TemplateElementWrapper';
import { CgTemplateTimeline, type TimeUnit, type SelectedKf } from './CgTemplateTimeline';
import { ElementPropertiesPanel } from './ElementPropertiesPanel';
import { GradientAnchorHandle } from './GradientAnchorHandle';
import { Orbit3DHandle } from './Orbit3DHandle';

interface Props {
  widgetId: string;
  onClose: () => void;
  /** Set only when this instance was opened as a NESTED edit session —
   *  currently just a 'cardCarousel' card's "Edit Style"/"New Style"
   *  button (see editingCardTemplateId below), stacking a second
   *  CgTemplateDesigner on top of the one already open for the carousel
   *  itself. Without this, that second instance's own top toolbar looks
   *  IDENTICAL to a normal top-level designer — no visual cue at all that
   *  you're now editing a card's own separate template nested inside
   *  another one, or how to get back to it besides the small X button.
   *  When set, renders a small tab bar ABOVE the normal toolbar showing
   *  both — the parent template as a clickable "back" tab, and this one as
   *  the active tab. */
  nestedContext?: { parentLabel: string; cardLabel: string };
}

const NEW_ELEMENT: Record<TemplateElement['kind'], () => Omit<TemplateElement, 'id'>> = {
  text: () => ({ kind: 'text', x: 20, y: 20, w: 240, h: 60, config: { text: 'Text', fontSize: 28, color: '#ffffff', bgColor: 'transparent', align: 'center', bold: false } }),
  image: () => ({ kind: 'image', x: 20, y: 20, w: 140, h: 140, config: { imageUrl: '', objectFit: 'contain', bgColor: 'transparent' } }),
  rect: () => ({ kind: 'rect', x: 20, y: 20, w: 240, h: 80, config: { fill: '#000000', opacity: 0.6, borderRadius: 0 } }),
  sequence: () => ({ kind: 'sequence', x: 20, y: 20, w: 200, h: 200, config: { frames: [] as string[], fps: 24, objectFit: 'cover' } }),
  shape: () => ({ kind: 'shape', x: 20, y: 20, w: 120, h: 120, config: { d: SHAPE_LIBRARY[DEFAULT_SHAPE], viewBox: SHAPE_VIEWBOX, fill: '#ffffff', stroke: 'none', strokeWidth: 0 } }),
  ticker: () => ({ kind: 'ticker', x: 20, y: 20, w: 800, h: 60, config: { text: 'Breaking news ticker text goes here', fontSize: 32, color: '#ffffff', bgColor: '#000000', bold: false, speed: 120, direction: 'left', gap: 80 } }),
  statbar: () => ({ kind: 'statbar', x: 20, y: 20, w: 400, h: 70, config: {
    rows: [{ id: crypto.randomUUID(), label: 'Possession', valueA: 55, valueB: 45, colorA: '#e74c3c', colorB: '#3498db' }],
    valueFormat: 'percent', showLabel: true, showValues: true, fontSize: 20, barHeight: 24, ease: 'power2.out',
  } }),
  imagePlaylist: () => ({ kind: 'imagePlaylist', x: 20, y: 20, w: 320, h: 220, config: {
    images: [] as string[], objectFit: 'cover', bgColor: 'transparent',
    advanceMode: 'auto', slideDuration: 4, loop: true,
    transitionPreset: 'fadeIn', transitionDuration: 0.6, transitionEase: 'power2.inOut',
  } }),
  cardCarousel: () => ({ kind: 'cardCarousel', x: 20, y: 20, w: 500, h: 280, config: {
    cards: [] as CgCarouselCard[], playlistImages: [] as string[],
    advanceMode: 'auto', slideDuration: 4, loop: true,
    carouselStyle: 'coverflow', cardGap: 260, sideScale: 0.75, sideRotation: 35, sideOpacity: 0.6,
    transitionDuration: 0.6, transitionEase: 'power2.inOut',
  } }),
  // No visual config at all — see TemplateElement's own doc comment on the
  // 'sound' kind. w/h/x/y still get ordinary values purely so the
  // Designer's own "chip" placeholder (canvas-preview only, never on the
  // real output) has a sane size/position to drag around by default.
  sound: () => ({ kind: 'sound', x: 20, y: 20, w: 140, h: 32, config: {} }),
  // "Precompose" — see TemplateElement's own doc comment on the
  // 'nestedTemplate' kind. No templateId yet — the Inspector's own picker
  // (mirroring 'cardCarousel' 's own "Style" select) is how one gets
  // assigned, same as a freshly-added card starts with none either.
  nestedTemplate: () => ({ kind: 'nestedTemplate', x: 20, y: 20, w: 320, h: 180, config: {} }),
  // A few sample sections so a freshly-added credits roll is immediately
  // playable/previewable rather than an empty box — same reasoning
  // 'statbar' seeds one sample row. Deliberately mixes a role+name section
  // (CAST) with a name-only one (SPECIAL THANKS/SPONSORS) so both of
  // CreditsEntry's own shapes are visible right away.
  credits: () => ({ kind: 'credits', x: 20, y: 20, w: 500, h: 300, config: {
    mode: 'scroll', scrollSpeed: 60, loop: true,
    slideDuration: 3, transitionPreset: 'fadeIn', transitionDuration: 0.6, transitionEase: 'power2.inOut',
    align: 'center', titleFontSize: 22, titleColor: '#ffffff', titleBold: true,
    roleFontSize: 15, roleColor: '#aaaaaa', nameFontSize: 18, nameColor: '#ffffff', nameBold: false,
    entryGap: 6, sectionGap: 36,
    sections: [
      { id: crypto.randomUUID(), title: 'DIRECTED BY', entries: [{ id: crypto.randomUUID(), name: 'Jane Smith' }] },
      { id: crypto.randomUUID(), title: 'CAST', entries: [
        { id: crypto.randomUUID(), role: 'Lead', name: 'Alex Johnson' },
        { id: crypto.randomUUID(), role: 'Supporting', name: 'Sam Lee' },
      ] },
      { id: crypto.randomUUID(), title: 'SPECIAL THANKS', entries: [
        { id: crypto.randomUUID(), name: 'GOMOLAB' },
        { id: crypto.randomUUID(), name: 'Our Sponsors' },
      ] },
    ] as CreditsSection[],
  } }),
  // No row templates yet — the Inspector's own three "Style" pickers
  // (mirroring 'cardCarousel'/'nestedTemplate' 's own template picker) are
  // how those get assigned. See TemplateElement's own 'matchSchedule' doc
  // comment for every field's default.
  matchSchedule: () => ({ kind: 'matchSchedule', x: 20, y: 20, w: 500, h: 400, config: {
    rowsPerPage: 4, rowGap: 12, rowHeight: 90,
    advanceMode: 'manual', pageDurationSec: 8, loop: true, pageIndex: 0,
    rowOverrides: {} as Record<string, { templateId?: string }>,
  } }),
  // No tournament yet — the Inspector's own picker (mirroring
  // 'matchSchedule' 's own) is how one gets assigned. See TemplateElement's
  // own 'standings' doc comment for every field's default.
  standings: () => ({ kind: 'standings', x: 20, y: 20, w: 400, h: 400, config: {
    rowsPerPage: 8, rowGap: 6, rowHeight: 40,
    advanceMode: 'manual', pageDurationSec: 8, loop: true, pageIndex: 0,
    topCount: 0, bottomCount: 0,
    rowOverrides: {} as Record<string, { templateId?: string }>,
  } }),
  // No tournament yet — see TemplateElement's own 'bracket' doc comment for
  // every field's default.
  bracket: () => ({ kind: 'bracket', x: 20, y: 20, w: 900, h: 500, config: {
    boxWidth: 220, boxHeight: 90, columnGap: 24, boxGap: 24,
    showThirdPlace: false,
    rowOverrides: {} as Record<string, { templateId?: string }>,
  } }),
};

// shadeHex now lives in lib/cgEffects.ts (shared with buildExtrudeFilter,
// which wants the exact same "one base color, several tonal steps" shading
// this file's own 3D Box faces use) — imported above.

// "3D Box" quick-insert — a REAL CSS 3D cuboid (6 faces forming an actual
// box, not a flat rectangle with a rotation preset), styled after the
// classic CSS-3D-cube technique (petebarr's "3D CSS Grid Mondrian
// Compositions" CodePen — the same rotate/translateZ-per-face recipe, just
// generalized from its fixed 250×250×25 to any w/h/depth). Each face is a
// plain 'rect' child rotated + pushed out to its own edge of the box via a
// STATIC (always-on) 3D pose — config.staticRotateX/Y/staticTranslateZ, see
// canvas.ts's own doc comment on `config` for why this is static rather
// than animated — so the box looks like a real cuboid at rest, not only
// while some entrance animation happens to be mid-flight. All 6 share the
// container's one 3D space via scene3D, so they compose into one real,
// occluding object instead of 6 flat independently-tilted rectangles.
// The 6 faces are never meant to be individually edited — the container's
// own "Transform" panel's Rotation X/Y/Z fields pose the WHOLE assembled box
// at any fixed angle at once (a 3/4 view, say), since a container's static
// pose is applied to the box it shares with its children, not just its own
// (invisible, transparent) fill. There's currently no LIVE-SPINNING
// version of this — an ordinary animated preset/keyframe track on the
// container only ever moves the container's own content, never its
// children (they render as a separate sibling, not a DOM descendant, of
// whatever a track animates) — so continuously rotating the whole box is a
// possible future extension, not something this template does yet.
function create3DBoxElements(x: number, y: number, w: number, h: number, depth: number, baseColor: string): TemplateElement[] {
  const half = depth / 2;
  const containerId = crypto.randomUUID();
  const container: TemplateElement = {
    id: containerId, kind: 'rect', x, y, w, h, name: '3D Box',
    config: { fill: 'transparent', scene3D: true, scene3DPerspective: 900 },
  };
  const face = (suffix: string, fw: number, fh: number, color: string, transform: Record<string, number>): TemplateElement => ({
    id: crypto.randomUUID(), kind: 'rect', x: 0, y: 0, w: fw, h: fh, parentId: containerId, name: `3D Box — ${suffix}`,
    config: { fill: color, ...transform },
  });
  return [
    container,
    face('Front', w, h, baseColor, { staticTranslateZ: half }),
    face('Back', w, h, shadeHex(baseColor, -35), { staticRotateY: 180, staticTranslateZ: half }),
    face('Left', depth, h, shadeHex(baseColor, -20), { staticRotateY: -90, staticTranslateZ: half }),
    face('Right', depth, h, shadeHex(baseColor, -20), { staticRotateY: 90, staticTranslateZ: w - half }),
    face('Top', w, depth, shadeHex(baseColor, 25), { staticRotateX: 90, staticTranslateZ: half }),
    face('Bottom', w, depth, shadeHex(baseColor, -45), { staticRotateX: -90, staticTranslateZ: h - half }),
  ];
}

// "Extrude" now lives entirely in lib/cgEffects.ts's buildExtrudeFilter —
// a pure-CSS drop-shadow illusion on config.extrudeDepth/extrudeColor,
// authored directly in ElementInspector below. An earlier version of this
// generated a separate container + 5 new face elements (the same recipe
// create3DBoxElements above still uses for "+ 3D Box") — replaced because
// extrude is meant to stay what it sounds like: ONE element gaining
// thickness, not a new group of layers in the tree.

// Split around where Step tabs get spliced in — see the state-bar JSX
// below: In, then every authored Step in order, then Loop, then Out.
const STATE_TAB_IN: { id: CgStateName; label: string } = { id: 'in', label: 'In' };
const STATE_TABS_AFTER_STEPS: { id: CgStateName; label: string }[] = [
  { id: 'loop', label: 'Loop' },
  { id: 'out', label: 'Out' },
];

const EMPTY_STATE: CgAnimState = { duration: 1, layers: [] };

// ── Cross-state continuity seeding ──────────────────────────────────────
// A brand new keyframe track (via ElementPropertiesPanel's stopwatch or
// CgTemplateTimeline's own "+ Track") should start from wherever the
// sequence already leaves that property, not an arbitrary hardcoded number
// — so continuing an animation into a new Step/Loop/Out never requires
// retyping the correct starting values by hand. `priorStatesChain` orders
// every state/step that plays BEFORE `activeState`, nearest first;
// `resolveSeedValue` walks it looking for the first one that actually
// tracks the given property, using that track's LAST keyframe (the value
// its timeline ultimately settles/holds at, since nothing plays after it
// within that state — matching how GSAP playback continuity already works
// for tracked properties, see cgAnimationEngine.ts's buildKeyframeTracks).
// A predecessor in Preset mode, or with no entry for this prop at all, is
// simply skipped (not specially resolved) rather than falling all the way
// back to the identity default immediately — a Step that itself has no
// track for a property a much earlier Step or "in" already set keeps that
// earlier value, exactly like real playback would leave it.
function priorStatesChain(activeState: string, states: Partial<Record<CgStateName, CgAnimState>>, steps: CgStepState[]): CgAnimState[] {
  if (activeState === STATE_TAB_IN.id) return [];
  if (activeState === 'out') {
    const chain: CgAnimState[] = [];
    if (states.loop) chain.push(states.loop);
    chain.push(...[...steps].reverse());
    if (states.in) chain.push(states.in);
    return chain;
  }
  if (activeState === 'loop') {
    const chain = [...steps].reverse();
    return states.in ? [...chain, states.in] : chain;
  }
  // A Step's own id.
  const idx = steps.findIndex((s) => s.id === activeState);
  const chain = steps.slice(0, Math.max(0, idx)).reverse();
  return states.in ? [...chain, states.in] : chain;
}

function resolveSeedValue(chain: CgAnimState[], elementId: string, prop: string, fallback: any): any {
  for (const st of chain) {
    const kfs = st.layers.find((l) => l.id === elementId)?.tracks?.[prop];
    if (kfs?.length) return kfs[kfs.length - 1].v;
  }
  return fallback;
}

// "Smart guides" candidate alignment lines for one element's drag/resize —
// every OTHER element at the SAME nesting level (siblings sharing one
// parentId, or every root element for a top-level drag — mixing levels
// would compare relative-to-parent coordinates against absolute canvas
// ones, which aren't the same space) plus the canvas/parent box's own
// edges and center. See TemplateElementWrapper.tsx's own SnapGuides doc
// comment for how these actually get matched during a drag.
function computeSnapGuides(siblings: TemplateElement[], canvasW: number, canvasH: number): SnapGuides {
  const vLines = [0, canvasW / 2, canvasW];
  const hLines = [0, canvasH / 2, canvasH];
  for (const s of siblings) {
    vLines.push(s.x, s.x + s.w / 2, s.x + s.w);
    hLines.push(s.y, s.y + s.h / 2, s.y + s.h);
  }
  return { vLines, hLines };
}

const CANVAS_SIZE_PRESETS: { label: string; w: number; h: number }[] = [
  { label: '1920×1080 (Full HD)', w: 1920, h: 1080 },
  { label: '1280×720 (HD)', w: 1280, h: 720 },
  { label: '3840×2160 (4K)', w: 3840, h: 2160 },
];

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const KIND_ICON: Record<TemplateElement['kind'], (size: number) => React.ReactNode> = {
  text: (s) => <Type size={s} strokeWidth={2} />,
  image: (s) => <ImageIcon size={s} strokeWidth={2} />,
  rect: (s) => <Square size={s} strokeWidth={2} />,
  sequence: (s) => <Film size={s} strokeWidth={2} />,
  shape: (s) => <Shapes size={s} strokeWidth={2} />,
  ticker: (s) => <MoveHorizontal size={s} strokeWidth={2} />,
  statbar: (s) => <BarChart2 size={s} strokeWidth={2} />,
  imagePlaylist: (s) => <Images size={s} strokeWidth={2} />,
  cardCarousel: (s) => <GalleryHorizontal size={s} strokeWidth={2} />,
  sound: (s) => <Volume2 size={s} strokeWidth={2} />,
  nestedTemplate: (s) => <LayoutTemplate size={s} strokeWidth={2} />,
  credits: (s) => <ScrollText size={s} strokeWidth={2} />,
  matchSchedule: (s) => <CalendarDays size={s} strokeWidth={2} />,
  standings: (s) => <ListOrdered size={s} strokeWidth={2} />,
  bracket: (s) => <Network size={s} strokeWidth={2} />,
};

// 'imagePlaylist' transition preset choices — the full PRESETS catalog minus
// the handful of `_type`-tagged special presets (morph/typewriter/scramble/
// sequencePlay/wordSequence), which assume a shape/text element and are
// special-cased through cgAnimationEngine.ts rather than being plain tween
// configs a raw image-to-image crossfade can use directly — see this
// element kind's own doc comment in types/canvas.ts.
const PLAYLIST_TRANSITION_PRESETS = Object.keys(PRESETS).filter((k) => !PRESETS[k]._type && k !== 'none');

interface HistorySnapshot {
  elements: TemplateElement[];
  states: Partial<Record<CgStateName, CgAnimState>>;
  steps: CgStepState[];
}
interface PendingImport {
  label?: string;
  w: number;
  h: number;
  elements: TemplateElement[];
  states: Partial<Record<CgStateName, CgAnimState>>;
  steps?: CgStepState[];
  timelineFps?: number;
}

// Full-screen free-form designer for a 'cg-template' widget's own graphic —
// text/image/rectangle/sequence elements, positioned/styled by hand, each
// optionally bound to live data from any other widget in the project (see
// lib/templateBinding.ts), plus an In/Loop/Out animation timeline per
// element (ported from the gfx-studio-2 app's own preset/keyframe system —
// see lib/cgPresets.ts / lib/cgAnimationEngine.ts / CgTemplateTimeline.tsx).
// Editing conveniences (Layers panel, duplicate/z-order, nudge, snap/grid,
// align, undo/redo, JSON export/import) are also ported from gfx-studio-2's
// own designer — see each function's own comment for exactly what carried
// over and what changed. Every change writes straight into the template
// widget's own config.elements/config.states via updateWidgetConfig — the
// exact same store action every other widget's config edit already uses, so
// it's synced/broadcast for free with no new sync message type, and there's
// nothing to "save" — it's live the whole time, like the rest of the app.
export function CgTemplateDesigner({ widgetId, onClose, nestedContext }: Props) {
  // Same collision guard CgTemplateWidget.tsx's own instanceId uses (see its
  // doc comment) — a stacked "Edit Template" session (nestedContext above)
  // means two CgTemplateDesigner instances can genuinely be mounted at
  // once; this keeps their mask-*/effect-clip-* SVG ids from colliding.
  const instanceId = useId().replace(/:/g, '');
  const {
    pages, libraryPages, updateWidgetConfig, resizeWidget,
    updateLibraryWidgetConfig, resizeLibraryWidget, addLibraryWidget,
  } = useCanvasStore();
  // Set while a 'cardCarousel' card's "Edit Style"/"+ New Style" button is
  // open — a SECOND, independent CgTemplateDesigner instance stacked on top
  // of this one (plain DOM order within the same '.tpld-overlay' full-screen
  // convention, so it just paints over this one — see the render below).
  // A card style is an ORDINARY CG Template Library entry, so editing one is
  // exactly the same designer this component already is, just pointed at a
  // different widgetId; closing it returns to the carousel's own inspector.
  const [editingCardTemplateId, setEditingCardTemplateId] = useState<string | null>(null);
  // Timeline panel height — drag the handle at its own top edge to
  // resize it, same "startY/startH, adjust by pointer delta" convention
  // CgMonitorBar.tsx's own resize handle already uses for its box height,
  // persisted the same way (appSettingsStore.ts's cgTimelinePanelHeight).
  const { cgTimelinePanelHeight, setCgTimelinePanelHeight, referenceBg, setReferenceBg, referenceBgOutside, setReferenceBgOutside } = useAppSettings();
  const timelineResizeRef = useRef<{ startY: number; startH: number } | null>(null);
  const onTimelineResizeDown = (e: React.PointerEvent) => {
    timelineResizeRef.current = { startY: e.clientY, startH: cgTimelinePanelHeight };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onTimelineResizeMove = (e: React.PointerEvent) => {
    const r = timelineResizeRef.current;
    if (!r) return;
    // The handle sits at the panel's own TOP edge (it's docked to the
    // bottom of the designer) — dragging UP (smaller clientY) should grow
    // it, the opposite sign from a handle at a panel's BOTTOM edge.
    setCgTimelinePanelHeight(r.startH + (r.startY - e.clientY));
  };
  const onTimelineResizeUp = () => { timelineResizeRef.current = null; };
  // Reactive subscription only — see CgTemplateWidget.tsx's identical
  // comment: a groupSlot binding reads the Team Database directly, so
  // without this the preview would never re-render when a team's actual
  // group assignment changes.
  useTeamDbStore((s) => s.teams);
  // Templates only ever live in the library now, but the designer can still
  // be opened for one created before that split (still sitting on a Main
  // Canvas page) — detect which tree it's actually in and use the matching
  // action set, rather than assuming one or the other.
  const allPages = [...pages, ...libraryPages];
  const widget = allPages.flatMap((p) => p.widgets).find((w) => w.id === widgetId);
  const isInLibrary = libraryPages.some((p) => p.widgets.some((w) => w.id === widgetId));
  const setConfig = isInLibrary ? updateLibraryWidgetConfig : updateWidgetConfig;
  const doResize = isInLibrary ? resizeLibraryWidget : resizeWidget;
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null);
  // A CgStateName ('in'/'loop'/'out') or a Step's own id — widened from the
  // original fixed CgStateName since Steps are an open-ended, authored list.
  const [activeState, setActiveState] = useState<string>('in');
  const [playhead, setPlayhead] = useState(0);
  // Which keyframe's t/v editor is showing in CgTemplateTimeline — lifted up
  // here (rather than local to that component) so a canvas drag can know
  // which keyframe, if any, it should target (see handleElementGestureEnd's
  // drag-to-set-position feature below).
  const [selectedKf, setSelectedKf] = useState<SelectedKf | null>(null);
  const [previewing, setPreviewing] = useState<string | 'all' | null>(null);
  // Set while "Preview All" is paused at a manual-advance Step, so the
  // toolbar can show a "Next Step" button — mirrors the real playout's own
  // "Next Stage" button/Cg.Stage action, just local to this preview.
  const [previewManualStep, setPreviewManualStep] = useState<string | null>(null);
  const previewAdvanceRef = useRef<(() => void) | null>(null);
  const [zoom, setZoom] = useState(1);
  // Display-only — every stored time (state.duration, keyframe .t, preset
  // duration/delay) always stays in seconds; this only governs how the
  // timeline/inspector show and accept typed values (see CgTemplateTimeline's
  // toDisplay/fromDisplay). `timelineFps` is a per-template setting (not
  // shared with a 'sequence' element's own playback `fps`, a separate thing).
  const [timeUnit, setTimeUnit] = useState<TimeUnit>('seconds');
  const otherWidgets = useMemo(
    () => allPages.flatMap((p) => p.widgets.filter((w) => w.id !== widgetId)),
    [pages, libraryPages, widgetId]
  );

  // ── Undo/redo — ported from gfx-studio-2's pushUndo/undo/redo, same
  // "snapshot the whole design, cap at 50" shape. A whole drag/resize/
  // keyframe-drag gesture coalesces into exactly one entry via
  // beginGesture/endGesture below, not one per pointer-move.
  const [past, setPast] = useState<HistorySnapshot[]>([]);
  const [future, setFuture] = useState<HistorySnapshot[]>([]);
  const isGestureRef = useRef(false);
  // Editor-only "hide while I work on other layers" set (Layers panel eye
  // icon) — never written to config, mirrors gfx-studio-2's ephemeral
  // `_hidden` (stripped before their own save/export, never persisted here
  // either — it's reset every time the designer reopens).
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  // Layers panel multi-select (Ctrl/Cmd-click toggles, Shift-click extends a
  // contiguous range) — separate from `localSelectedId` (the single
  // "active" selection the Inspector/canvas handles still drive) so a
  // multi-selection is purely a Layers-panel/Group-selection concern.
  // Cleared on every plain (unmodified) row click, same as any other
  // design tool's layers panel.
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set());
  // Layers panel drag-to-reorder/reparent — see reorderOrReparentElement's
  // own comment. `dragOverRow` tracks the CURRENT hover target + whether
  // the cursor is near enough the row's top/bottom edge to mean "drop
  // beside this row" vs "drop it must be aimed at" (its middle band) —
  // purely for the drop-indicator line/highlight, cleared on drop/leave.
  const [draggingLayerId, setDraggingLayerId] = useState<string | null>(null);
  const [dragOverRow, setDragOverRow] = useState<{ id: string; pos: 'above' | 'below' | 'inside' } | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  // "Smart guides" — center/edge alignment against other elements and the
  // canvas itself (see TemplateElementWrapper.tsx's own SnapGuides/
  // closestSnap). Defaults ON (unlike grid-snap/grid-overlay above) — it's
  // passive (does nothing unless a drag actually comes near an alignment)
  // the same way every design tool that offers this (Figma/Keynote/
  // PowerPoint) already defaults it on, whereas a visible grid is more
  // opinionated about layout and reasonably opt-in only.
  const [smartSnapEnabled, setSmartSnapEnabled] = useState(true);
  const [showSafeArea, setShowSafeArea] = useState(false);
  const [snapSoundEnabled, setSnapSoundEnabled] = useState(false);
  const [snapSoundId, setSnapSoundId] = useState('tick');
  // Which guide line(s) are actively matched RIGHT NOW during a drag/resize
  // — purely transient visual feedback (rendered as thin overlay lines
  // across the canvas), reported by whichever TemplateElementWrapper is
  // currently being dragged and cleared the instant the gesture ends.
  const [activeGuides, setActiveGuides] = useState<SnapGuides>({ vLines: [], hLines: [] });
  // Pen tool — draws a custom shape by clicking points directly on canvas,
  // an alternative to picking from SHAPE_LIBRARY or pasting raw path text.
  // Points are kept in canvas-space pixels the whole time; finishing just
  // re-bases them to their own bounding box (see finishPen below).
  const [penActive, setPenActive] = useState(false);
  const [penPoints, setPenPoints] = useState<{ x: number; y: number }[]>([]);
  const penOverlayRef = useRef<HTMLDivElement>(null);
  // Parsed contents of a picked "import template" JSON file, awaiting the
  // operator's confirmation before it overwrites the current design.
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);

  const elRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // Effects-filter wrapper per element (a DIFFERENT node than elRefs — see
  // renderElementTree below) plus the persistent per-effect live-value store
  // — same relationship to buildEffectKeyframeTracks as CgTemplateWidget.tsx's
  // own copies of these, just for the designer's own live scrub/preview.
  const effectWrapperRefs = useRef<Record<string, HTMLElement | null>>({});
  const effectProxiesRef = useRef<Record<string, Record<string, any>>>({});
  // Keyed by CgStateName ('in'/'loop'/'out') OR a Step's own id — widened
  // from a fixed Record<CgStateName,...> since Steps are an open-ended list.
  const activeTlsRef = useRef<Record<string, gsap.core.Timeline>>({});
  const wrapRef = useRef<HTMLDivElement>(null);
  // Which timeline the ruler's playhead should visibly track during
  // Preview — only when it belongs to the currently active tab, so the
  // ruler you're looking at is the one actually moving (see the ticker
  // effect below). Without this, Preview visibly did nothing on the
  // ruler/timeline panel even though the real animation was playing.
  const watchedRef = useRef<{ name: string; tl: gsap.core.Timeline } | null>(null);

  useEffect(() => {
    const tick = () => {
      const w = watchedRef.current;
      if (w && w.name === activeState) setPlayhead(w.tl.time());
    };
    gsap.ticker.add(tick);
    return () => { gsap.ticker.remove(tick); };
  }, [activeState]);

  // Fit the canvas to the available viewing area — a real broadcast frame
  // (1920×1080 by default, see WIDGET_DEFAULTS) is far bigger than any
  // screen can show at 1:1, so this scales down to fit on open and whenever
  // the canvas size or the available viewport changes; the zoom controls in
  // the toolbar let the operator override it afterward.
  const fitZoom = () => {
    const wrap = wrapRef.current;
    if (!wrap || !widget) return;
    const pad = 40;
    const z = Math.min(1, (wrap.clientWidth - pad) / widget.w, (wrap.clientHeight - pad) / widget.h);
    setZoom(Math.max(0.05, Number.isFinite(z) ? z : 1));
  };
  useEffect(() => {
    fitZoom();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(fitZoom);
    ro.observe(wrap);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget?.w, widget?.h]);

  const elements: TemplateElement[] = migrateLegacyElements(widget?.config.elements ?? []);
  const states: Partial<Record<CgStateName, CgAnimState>> = widget?.config.states ?? {};
  const steps: CgStepState[] = widget?.config.steps ?? [];
  const activeStep = steps.find((s) => s.id === activeState) ?? null;
  const currentState: CgAnimState = activeStep ?? states[activeState as CgStateName] ?? EMPTY_STATE;
  // Computed early (before the `!widget` return below) purely so the
  // keyboard-shortcut effect further down — which needs them — can stay a
  // hook called unconditionally on every render, same reasoning as
  // `elements`/`states` above.
  const selected = elements.find((e) => e.id === localSelectedId) ?? null;
  const selectedAnim = selected ? currentState.layers.find((l) => l.id === selected.id) ?? null : null;

  const resetToRest = () => {
    // Scoped to exactly what a preview/scrub could have left animated — NOT
    // clearProps:'all', which also wipes any OTHER inline style React itself
    // owns on this same node (elRefs.current[el.id] is TemplateElementWrapper's
    // .tpl-el-body — see its own bodyOverflow prop) rather than just what
    // GSAP touched. That silently erased bodyOverflow's own overflow:visible
    // moments after this effect's very first mount, right back to
    // .tpl-el-body's default overflow:hidden — clipping any effect (a drop
    // shadow, a glow) that bleeds past this element's own box, even though
    // the real output never clips it there. See CgTemplateWidget.tsx's
    // identical reasoning on its own equivalent reset, a few lines below.
    elements.forEach((el) => { const node = elRefs.current[el.id]; if (node) gsap.set(node, { clearProps: 'opacity,visibility,transform,filter,clipPath' }); });
    // Same reset for the effects side (see CgTemplateWidget.tsx's identical
    // pair of lines) — a killed preview/scrub tween shouldn't leave a stale
    // animated filter behind, and effectProxiesRef's "wherever the last
    // build left each effect's value" store needs wiping too, so the next
    // preview/scrub starts continuity from the true static base again.
    effectProxiesRef.current = {};
    elements.forEach((el) => {
      const wrapperNode = effectWrapperRefs.current[el.id];
      if (wrapperNode) wrapperNode.style.filter = resolveElementFilter(el.config, instanceId, el.id, el.changeAnim?.preset) || '';
    });
  };
  const stopPreview = () => {
    Object.values(activeTlsRef.current).forEach((tl) => tl?.kill());
    activeTlsRef.current = {};
    watchedRef.current = null;
    setPreviewing(null);
    resetToRest();
  };
  // Clear any leftover inline GSAP styles from preview/scrub whenever the
  // tab changes, so the static editor always reflects the elements' plain
  // authored config, never a stale mid-animation frame.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { stopPreview(); setPlayhead(0); }, [activeState, widgetId]);
  useEffect(() => () => stopPreview(), []);

  // ── History plumbing ─────────────────────────────────────────────────
  const pushHistory = () => {
    setPast((p) => [...p.slice(-49), { elements, states, steps }]);
    setFuture([]);
  };
  const beginGesture = () => {
    if (isGestureRef.current) return;
    pushHistory();
    isGestureRef.current = true;
  };
  const endGesture = () => { isGestureRef.current = false; };
  const undo = () => {
    if (!widget || !past.length) return;
    const prev = past[past.length - 1];
    setFuture((f) => [...f, { elements, states, steps }]);
    setPast((p) => p.slice(0, -1));
    setConfig(widgetId, { elements: prev.elements, states: prev.states, steps: prev.steps });
  };
  const redo = () => {
    if (!widget || !future.length) return;
    const next = future[future.length - 1];
    setPast((p) => [...p, { elements, states, steps }]);
    setFuture((f) => f.slice(0, -1));
    setConfig(widgetId, { elements: next.elements, states: next.states, steps: next.steps });
  };

  const setElements = (next: TemplateElement[]) => setConfig(widgetId, { elements: next });
  // Writes to config.steps when the active tab is a Step (replacing just
  // that step's CgAnimState fields, keeping its id/name/advanceMode), or to
  // config.states as before otherwise.
  const setCurrentState = (next: CgAnimState) => {
    if (activeStep) {
      setConfig(widgetId, { steps: steps.map((s) => (s.id === activeStep.id ? { ...s, ...next } : s)) });
    } else {
      setConfig(widgetId, { states: { ...states, [activeState as CgStateName]: next } });
    }
  };
  // The mutation entry points every element/animation/step edit below goes
  // through — adds one undo step per discrete edit, or (while a drag/
  // resize/keyframe-drag gesture is in progress, per isGestureRef) none,
  // since beginGesture() already pushed exactly one step for the whole
  // gesture. Mirrors gfx-studio-2's pushUndo-before-every-edit convention.
  const commitElements = (next: TemplateElement[]) => {
    if (!isGestureRef.current) pushHistory();
    setElements(next);
  };
  const commitState = (next: CgAnimState) => {
    if (!isGestureRef.current) pushHistory();
    setCurrentState(next);
  };
  // Step-LIST-level edits (add/rename/reorder/delete/advance-mode) — these
  // replace the whole array rather than one step's CgAnimState fields, so
  // they go through setConfig directly instead of setCurrentState above.
  const commitSteps = (next: CgStepState[]) => {
    if (!isGestureRef.current) pushHistory();
    setConfig(widgetId, { steps: next });
  };
  const addStep = () => {
    const step: CgStepState = { id: crypto.randomUUID(), name: `Step ${steps.length + 1}`, duration: 1, layers: [], advanceMode: 'manual' };
    commitSteps([...steps, step]);
    setActiveState(step.id);
  };
  const renameStep = (id: string, name: string) => commitSteps(steps.map((s) => (s.id === id ? { ...s, name } : s)));
  const deleteStep = (id: string) => {
    commitSteps(steps.filter((s) => s.id !== id));
    if (activeState === id) setActiveState('in');
  };
  const moveStepLeft = (id: string) => {
    const i = steps.findIndex((s) => s.id === id);
    if (i <= 0) return;
    const next = [...steps];
    [next[i], next[i - 1]] = [next[i - 1], next[i]];
    commitSteps(next);
  };
  const moveStepRight = (id: string) => {
    const i = steps.findIndex((s) => s.id === id);
    if (i < 0 || i >= steps.length - 1) return;
    const next = [...steps];
    [next[i], next[i + 1]] = [next[i + 1], next[i]];
    commitSteps(next);
  };
  const setStepAdvanceMode = (id: string, mode: 'auto' | 'manual') => commitSteps(steps.map((s) => (s.id === id ? { ...s, advanceMode: mode } : s)));
  const setStepAutoAdvanceMs = (id: string, ms: number) => commitSteps(steps.map((s) => (s.id === id ? { ...s, autoAdvanceMs: Math.max(0, ms) } : s)));

  // ── Keyboard shortcuts — arrows nudge (Shift = 10px), Delete/Backspace
  // removes the selection, Ctrl/Cmd+D duplicates, Ctrl/Cmd+Z / Ctrl/Cmd+
  // Shift+Z (or +Y) undo/redo. Guarded against firing while focus is in a
  // text input/select (e.g. typing into the Text field shouldn't nudge the
  // canvas on every arrow key press).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!widget) return;
      // A 'cardCarousel' card's "Edit Style"/"+ New Style" stacks a SECOND
      // CgTemplateDesigner instance on top of this one (see
      // editingCardTemplateId above) — both are mounted at once, and both
      // register this same window-level listener, so without this guard a
      // single keypress (Delete, Ctrl+Z, an arrow nudge) would fire on BOTH
      // the visible nested designer AND this now-hidden-behind-it one
      // simultaneously. Suppressing THIS instance's own handler whenever
      // it has spawned a child overlay is enough — the child's own handler
      // has no such override, since it never spawns a grandchild.
      if (editingCardTemplateId) return;
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // A <button> keeps keyboard focus after being clicked — the browser's
      // own default behavior then re-fires its click on the NEXT Space
      // press, regardless of what the operator actually meant to do (e.g.
      // pressing Space to nudge focus elsewhere, or just as a stray
      // keypress while looking at the canvas). Whichever toolbar button was
      // last clicked (Preview In/Out/All, Undo, Align, etc.) would
      // otherwise silently re-trigger itself — blur it so Space is inert
      // once the click it belongs to is done.
      if (e.key === ' ' && tag === 'BUTTON') { e.preventDefault(); active?.blur(); return; }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateElement(); return; }
      if (mod && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (e.shiftKey) { if (selected?.config?.isGroup) ungroupElement(selected.id); return; }
        const ids = multiSelectedIds.size >= 2 ? [...multiSelectedIds] : selected ? [selected.id] : [];
        if (ids.length >= 2) groupElements(ids);
        return;
      }
      if (!selected) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteElement(selected.id); return; }
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft') { e.preventDefault(); commitElements(elements.map((el) => el.id === selected.id ? { ...el, x: Math.max(0, el.x - step) } : el)); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); commitElements(elements.map((el) => el.id === selected.id ? { ...el, x: Math.min(widget.w - el.w, el.x + step) } : el)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); commitElements(elements.map((el) => el.id === selected.id ? { ...el, y: Math.max(0, el.y - step) } : el)); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); commitElements(elements.map((el) => el.id === selected.id ? { ...el, y: Math.min(widget.h - el.h, el.y + step) } : el)); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, elements, states, steps, past, future, widget?.w, widget?.h, editingCardTemplateId, multiSelectedIds]);

  if (!widget) return null;

  const timelineFps = widget.config.timelineFps ?? 30;
  // Same display-only conversion CgTemplateTimeline.tsx uses — the Preset
  // Duration/Delay fields below live here instead of there, so they need
  // their own copy rather than importing across component boundaries.
  const toDisplayTime = (s: number) => (timeUnit === 'frames' ? Math.round(s * timelineFps) : Number(s.toFixed(2)));
  const fromDisplayTime = (v: number) => (timeUnit === 'frames' ? v / timelineFps : v);
  const timeUnitLabel = timeUnit === 'frames' ? 'frames' : 's';

  const addElement = (kind: TemplateElement['kind']) => {
    const el: TemplateElement = { id: crypto.randomUUID(), ...NEW_ELEMENT[kind]() };
    commitElements([...elements, el]);
    setLocalSelectedId(el.id);
  };
  // "+ 3D Box" — inserts all 7 elements (container + 6 faces) as one undo
  // step, selecting the container (the one thing an operator actually
  // interacts with afterward — see create3DBoxElements's own comment).
  const addBox3D = () => {
    const boxEls = create3DBoxElements(20, 20, 200, 200, 40, '#4a90e2');
    commitElements([...elements, ...boxEls]);
    setLocalSelectedId(boxEls[0].id);
  };
  const updateElement = (id: string, patch: Partial<TemplateElement>) =>
    commitElements(elements.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const updateElementConfig = (id: string, patch: Record<string, any>) =>
    commitElements(elements.map((e) => (e.id === id ? { ...e, config: { ...e.config, ...patch } } : e)));
  const deleteElement = (id: string) => {
    // Anything parented to, or masked by, the deleted element falls back to
    // a root / unmasked rather than vanishing or dangling on a missing id.
    commitElements(
      elements
        .filter((e) => e.id !== id)
        .map((e) => (e.parentId === id || e.maskId === id) ? { ...e, parentId: e.parentId === id ? undefined : e.parentId, maskId: e.maskId === id ? undefined : e.maskId } : e)
    );
    if (localSelectedId === id) setLocalSelectedId(null);
    setHiddenIds((prev) => { if (!prev.has(id)) return prev; const next = new Set(prev); next.delete(id); return next; });
  };
  const setBinding = (id: string, binding: TemplateElementBinding | undefined) =>
    commitElements(elements.map((e) => (e.id === id ? { ...e, binding } : e)));
  const setConditions = (id: string, conditions: ElementCondition[] | undefined) =>
    commitElements(elements.map((e) => (e.id === id ? { ...e, conditions } : e)));

  // Clones an element (default: the current selection) with a new id, +20/
  // +20 offset, and — unlike a plain array copy — clones its CgLayerAnim
  // entry in EVERY state (in/loop/out) that animates the original, so a
  // duplicated animated element keeps its animation instead of coming out
  // static. Touches elements+states together in one setConfig call/undo step.
  const duplicateElement = (id?: string) => {
    const target = elements.find((e) => e.id === (id ?? localSelectedId));
    if (!target) return;
    const newId = crypto.randomUUID();
    // Effects carry their own id (targeted by keyframe tracks as
    // `effect:<id>:<field>` — see cgEffects.ts's effectTrackKey, and
    // cgAnimationEngine.ts's buildEffectKeyframeTracks, which keys its
    // per-effect proxy purely by that id). A plain `...target` spread keeps
    // the SAME effect objects/ids on the copy — harmless while both stay
    // static, but the moment either copy's same-id effect gets keyframed,
    // both elements would share one proxy and fight over its value. Fresh
    // ids per copied effect (config only — every element kind's effects
    // live at config.effects, never elsewhere) avoids that at the source.
    const effectIdMap = new Map<string, string>((target.config?.effects ?? []).map((fx: CgEffect): [string, string] => [fx.id, crypto.randomUUID()]));
    const newConfig = effectIdMap.size
      ? { ...target.config, effects: target.config.effects.map((fx: CgEffect) => ({ ...fx, id: effectIdMap.get(fx.id)! })) }
      : target.config;
    const newEl: TemplateElement = {
      ...target,
      id: newId,
      config: newConfig,
      x: Math.min(Math.max(0, widget.w - target.w), target.x + 20),
      y: Math.min(Math.max(0, widget.h - target.h), target.y + 20),
      name: `${target.name || KIND_LABEL[target.kind]} copy`,
    };
    // A `tracks` entry can itself keyframe one of THIS element's own effects
    // (an `effect:<id>:<field>` key — see cgEffects.ts's effectTrackKey) —
    // remapped to the copy's fresh effect id alongside everything else above,
    // so a duplicated element that animates its own effect keeps doing so
    // independently instead of the copy's track silently pointing at an id
    // that only the original still has.
    const remapAnim = (anim: CgLayerAnim): CgLayerAnim => {
      if (!anim.tracks || !effectIdMap.size) return { ...anim, id: newId };
      const tracks: CgLayerAnim['tracks'] = {};
      Object.entries(anim.tracks).forEach(([prop, kfs]) => {
        const parsed = parseEffectTrackKey(prop);
        const mappedId = parsed && effectIdMap.get(parsed.effectId);
        tracks[mappedId ? effectTrackKey(mappedId, parsed!.field) : prop] = kfs;
      });
      return { ...anim, id: newId, tracks };
    };
    const newStates: Partial<Record<CgStateName, CgAnimState>> = { ...states };
    (Object.keys(states) as CgStateName[]).forEach((k) => {
      const st = states[k];
      const anim = st?.layers.find((l) => l.id === target.id);
      if (st && anim) newStates[k] = { ...st, layers: [...st.layers, remapAnim(anim)] };
    });
    const newSteps = steps.map((step) => {
      const anim = step.layers.find((l) => l.id === target.id);
      return anim ? { ...step, layers: [...step.layers, remapAnim(anim)] } : step;
    });
    pushHistory();
    setConfig(widgetId, { elements: [...elements, newEl], states: newStates, steps: newSteps });
    setLocalSelectedId(newId);
  };

  // Z-order — elements render in array order (later = on top, matching
  // TemplateElementWrapper/CgTemplateWidget's plain document order stacking)
  // — "bring forward"/"send backward" swap with the adjacent array neighbor
  // that shares the SAME parentId (undefined counts as one group, the
  // roots) — swapping with the raw next/previous array index regardless of
  // parent would let a child jump in front of some unrelated element that
  // simply happened to sit next to it in the flat array.
  const moveElementUp = (id: string) => {
    const el = elements.find((e) => e.id === id);
    if (!el) return;
    const siblingIdx = elements.map((e, i) => ({ e, i })).filter(({ e }) => e.parentId === el.parentId);
    const pos = siblingIdx.findIndex(({ e }) => e.id === id);
    if (pos < 0 || pos >= siblingIdx.length - 1) return;
    const next = [...elements];
    const a = siblingIdx[pos].i, b = siblingIdx[pos + 1].i;
    [next[a], next[b]] = [next[b], next[a]];
    commitElements(next);
  };
  const moveElementDown = (id: string) => {
    const el = elements.find((e) => e.id === id);
    if (!el) return;
    const siblingIdx = elements.map((e, i) => ({ e, i })).filter(({ e }) => e.parentId === el.parentId);
    const pos = siblingIdx.findIndex(({ e }) => e.id === id);
    if (pos <= 0) return;
    const next = [...elements];
    const a = siblingIdx[pos].i, b = siblingIdx[pos - 1].i;
    [next[a], next[b]] = [next[b], next[a]];
    commitElements(next);
  };
  // This element's own x/y resolved all the way up to the canvas's own
  // root space — walks `parentId` summing each ancestor's own x/y along the
  // way (every level is a plain local offset relative to its OWN parent —
  // see TemplateElement's own doc comment on `parentId`). Used only by
  // reorderOrReparentElement/groupElements/ungroupElement below, to convert
  // an element's x/y across a change of parent without it visually jumping.
  const absoluteElementPos = (id: string | undefined): { x: number; y: number } => {
    if (!id) return { x: 0, y: 0 };
    const el = elements.find((e) => e.id === id);
    if (!el) return { x: 0, y: 0 };
    const p = absoluteElementPos(el.parentId);
    return { x: p.x + el.x, y: p.y + el.y };
  };
  // True if `nodeId` is `ancestorId` itself or sits somewhere under it —
  // the guard reorderOrReparentElement/the Group button's own "same
  // parent" check both need, so a drag can never park an element inside
  // its own descendant (which would otherwise orphan that whole branch in
  // a cycle no renderer could ever walk out of).
  const isElementOrDescendant = (ancestorId: string, nodeId: string): boolean => {
    if (ancestorId === nodeId) return true;
    let cur = elements.find((e) => e.id === nodeId);
    while (cur?.parentId) {
      if (cur.parentId === ancestorId) return true;
      cur = elements.find((e) => e.id === cur!.parentId);
    }
    return false;
  };
  // Layers panel drag-and-drop — dropping a row "above"/"below" another
  // moves it to that row's own sibling level (same parentId), right next
  // to it; "inside" makes it that row's own newest (topmost-rendering)
  // child instead. Elements render in array order (later = on top — see
  // moveElementUp's own comment above), and the Layers list displays that
  // reversed (top of the visual list = highest/frontmost array index) — so
  // "display above target" means the dragged element needs a HIGHER array
  // index than target (closer to the front), and "display below" a lower
  // one. Re-parenting converts the dragged element's x/y across the change
  // via absoluteElementPos so it never visually jumps, exactly like
  // groupElements/ungroupElement below do for the exact same reason.
  const reorderOrReparentElement = (draggedId: string, targetId: string, pos: 'above' | 'below' | 'inside') => {
    if (draggedId === targetId) return;
    const dragged = elements.find((e) => e.id === draggedId);
    const target = elements.find((e) => e.id === targetId);
    if (!dragged || !target) return;
    const newParentId = pos === 'inside' ? targetId : target.parentId;
    // Dropping into itself, or into/beside a spot that's actually one of
    // its own descendants, would create a cycle — silently ignored, same
    // as the Inspector's own Parent picker already filters these out of
    // its own dropdown rather than letting one through.
    if (newParentId && isElementOrDescendant(draggedId, newParentId)) return;
    const draggedAbs = absoluteElementPos(draggedId);
    const newParentAbs = absoluteElementPos(newParentId);
    const movedDragged: TemplateElement = { ...dragged, parentId: newParentId, x: draggedAbs.x - newParentAbs.x, y: draggedAbs.y - newParentAbs.y };
    const without = elements.filter((e) => e.id !== draggedId);
    let insertAt: number;
    if (pos === 'inside') {
      // Lands as the new TOPMOST child of target (last among its
      // siblings) — the highest array index currently used by any of
      // target's own existing children, or right after target itself when
      // it has none yet.
      insertAt = without.findIndex((e) => e.id === targetId) + 1;
      without.forEach((e, i) => { if (e.parentId === targetId && i + 1 > insertAt) insertAt = i + 1; });
    } else {
      const targetIdx = without.findIndex((e) => e.id === targetId);
      insertAt = pos === 'above' ? targetIdx + 1 : targetIdx;
    }
    commitElements([...without.slice(0, insertAt), movedDragged, ...without.slice(insertAt)]);
  };
  // "Group Selection" (Ctrl/Cmd+G, or the Layers panel's own Group button)
  // — wraps 2+ selected elements in a brand-new invisible container — a
  // plain `kind:'rect'` with `fill:'transparent'` and `config.isGroup: true`
  // (see TemplateElement's own doc comment on that flag for exactly what
  // it does and doesn't do), sized to the selection's own bounding box and
  // inserted where the frontmost (topmost-rendering) selected element used
  // to sit — so the group's OWN stacking position relative to whatever
  // wasn't selected looks identical to before. Every selected element's
  // x/y shifts by the group's own new top-left so nothing visually moves.
  // When every selected element already shares the same immediate parent
  // (the overwhelmingly common case — a Layers-panel multi-selection is
  // usually already at one level), the group is created right there,
  // alongside them. A MIXED-parent selection doesn't just silently refuse
  // — it falls back to grouping at the canvas ROOT instead, converting
  // every element's own position via absoluteElementPos (root-space) so
  // nothing jumps regardless of how deep each one used to sit; this does
  // flatten their prior nesting depth (each becomes a direct child of the
  // new group, wherever it used to be), a reasonable, predictable trade-off
  // for "just group them" over refusing outright.
  const groupElements = (ids: string[]) => {
    const targets = ids.map((id) => elements.find((e) => e.id === id)).filter((e): e is TemplateElement => !!e);
    if (targets.length < 2) return;
    // Grouping an element together with its own descendant (also selected)
    // would try to make that descendant its own indirect ancestor once
    // both get reparented under the new group — refuse rather than corrupt
    // the tree.
    if (targets.some((a) => targets.some((b) => a.id !== b.id && isElementOrDescendant(a.id, b.id)))) return;
    const sameParent = targets.every((e) => e.parentId === targets[0].parentId);
    const parentId = sameParent ? targets[0].parentId : undefined;
    const parentAbs = absoluteElementPos(parentId);
    const positions = new Map(targets.map((e) => {
      const abs = absoluteElementPos(e.id);
      return [e.id, { x: abs.x - parentAbs.x, y: abs.y - parentAbs.y }] as const;
    }));
    const minX = Math.min(...targets.map((e) => positions.get(e.id)!.x));
    const minY = Math.min(...targets.map((e) => positions.get(e.id)!.y));
    const maxX = Math.max(...targets.map((e) => positions.get(e.id)!.x + e.w));
    const maxY = Math.max(...targets.map((e) => positions.get(e.id)!.y + e.h));
    const groupId = crypto.randomUUID();
    const group: TemplateElement = {
      id: groupId, kind: 'rect', name: 'Group', parentId,
      x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY),
      config: { fill: 'transparent', opacity: 1, borderRadius: 0, isGroup: true },
    };
    const targetIds = new Set(targets.map((e) => e.id));
    // Frontmost selected element's own array slot — the group takes over
    // that exact position, keeping its stacking relative to un-selected
    // siblings unchanged; the selected elements themselves get removed
    // from their old slots and re-appended (in their OWN prior relative
    // order) right after the group, i.e. as its own children, so their
    // mutual stacking survives too.
    const frontmostIdx = Math.max(...elements.map((e, i) => (targetIds.has(e.id) ? i : -1)));
    const remaining = elements.filter((e) => !targetIds.has(e.id));
    const insertAt = remaining.findIndex((_, i) => elements.indexOf(remaining[i]) > frontmostIdx);
    const reparentedTargets = elements.filter((e) => targetIds.has(e.id)).map((e) => {
      const p = positions.get(e.id)!;
      return { ...e, parentId: groupId, x: p.x - minX, y: p.y - minY };
    });
    const at = insertAt === -1 ? remaining.length : insertAt;
    commitElements([...remaining.slice(0, at), group, ...reparentedTargets, ...remaining.slice(at)]);
    setLocalSelectedId(groupId);
    setMultiSelectedIds(new Set());
  };
  // "Ungroup" — the inverse of groupElements above: every direct child
  // moves up to the group's OWN parent (x/y shifted back out by the
  // group's top-left, undoing exactly what grouping shifted in), right
  // where the group itself used to sit, then the now-empty group is
  // deleted. Only ever offered for an element with config.isGroup set (see
  // its own doc comment) — never for an arbitrary parent (e.g. a "3D Box"
  // container), whose children are its own fixed 6 faces, not an ad hoc
  // Layers-panel grouping meant to be reversible.
  const ungroupElement = (id: string) => {
    const group = elements.find((e) => e.id === id);
    if (!group || !group.config?.isGroup) return;
    const children = elements.filter((e) => e.parentId === id);
    if (children.length === 0) { deleteElement(id); return; }
    const groupIdx = elements.indexOf(group);
    const withoutGroupOrChildren = elements.filter((e) => e.id !== id && e.parentId !== id);
    const insertAt = withoutGroupOrChildren.findIndex((_, i) => elements.indexOf(withoutGroupOrChildren[i]) > groupIdx);
    const reparented = children.map((e) => ({ ...e, parentId: group.parentId, x: e.x + group.x, y: e.y + group.y }));
    const at = insertAt === -1 ? withoutGroupOrChildren.length : insertAt;
    commitElements([...withoutGroupOrChildren.slice(0, at), ...reparented, ...withoutGroupOrChildren.slice(at)]);
    setLocalSelectedId(reparented[0]?.id ?? null);
  };
  // "Bring to Front"/"Send to Back" for a WHOLE multi-selection at once —
  // unlike moveElementUp/moveElementDown above (one element, one sibling
  // step), this jumps straight to either edge of each affected element's
  // OWN sibling group, all in a single undo step. Elements from DIFFERENT
  // parents in the same selection are each reordered independently within
  // their own parent's sibling run (an element never jumps to a different
  // parent's stack) — grouped here by which array SLOTS belong to which
  // parentId, then those slots are refilled in the new order, so elements
  // belonging to unrelated parents interleaved in the flat array are left
  // completely undisturbed.
  const moveSelectionToEdge = (ids: Set<string>, toFront: boolean) => {
    if (ids.size === 0) return;
    const slotsByParent = new Map<string | undefined, number[]>();
    elements.forEach((e, i) => {
      if (!slotsByParent.has(e.parentId)) slotsByParent.set(e.parentId, []);
      slotsByParent.get(e.parentId)!.push(i);
    });
    const next = [...elements];
    slotsByParent.forEach((slots) => {
      const selectedSlots = slots.filter((i) => ids.has(elements[i].id));
      if (selectedSlots.length === 0) return;
      const unselectedSlots = slots.filter((i) => !ids.has(elements[i].id));
      const order = toFront ? [...unselectedSlots, ...selectedSlots] : [...selectedSlots, ...unselectedSlots];
      const values = order.map((i) => elements[i]);
      slots.forEach((slot, k) => { next[slot] = values[k]; });
    });
    commitElements(next);
  };
  const renameElement = (id: string, name: string) => {
    setRenamingId(null);
    const trimmed = name.trim();
    if (!trimmed) return;
    commitElements(elements.map((e) => (e.id === id ? { ...e, name: trimmed } : e)));
  };
  const toggleHidden = (id: string) => setHiddenIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Aligns the selected element to the canvas frame's edge/center — matches
  // gfx-studio-2's alignLayer exactly (single-selection, canvas-relative).
  const alignElement = (mode: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom') => {
    if (!selected) return;
    const patch: Partial<TemplateElement> =
      mode === 'left' ? { x: 0 }
      : mode === 'right' ? { x: widget.w - selected.w }
      : mode === 'centerX' ? { x: Math.round((widget.w - selected.w) / 2) }
      : mode === 'top' ? { y: 0 }
      : mode === 'bottom' ? { y: widget.h - selected.h }
      : { y: Math.round((widget.h - selected.h) / 2) };
    commitElements(elements.map((e) => (e.id === selected.id ? { ...e, ...patch } : e)));
  };

  // Native Save/Open dialogs (see src-tauri/src/commands.rs) — same
  // dynamic-import pattern importSequence below already uses, so the
  // designer doesn't need @tauri-apps/api as a static import for a route
  // that's only ever reachable from the desktop app anyway.
  const exportTemplate = async () => {
    if (!isTauri) return;
    const { invoke } = await import('@tauri-apps/api/core');
    const data = { kind: 'gomolab-cg-template-export', version: 1, label: widget.label, w: widget.w, h: widget.h, elements, states, steps, timelineFps };
    await invoke('save_text_file_dialog', { defaultName: `${(widget.label || 'template').replace(/[^a-z0-9]/gi, '_')}.json`, content: JSON.stringify(data, null, 2) });
  };
  const importTemplate = async () => {
    if (!isTauri) return;
    const { invoke } = await import('@tauri-apps/api/core');
    const text = await invoke<string | null>('open_text_file_dialog');
    if (!text) return;
    try {
      const data = JSON.parse(text);
      if (data?.kind !== 'gomolab-cg-template-export' || !Array.isArray(data.elements)) return;
      setPendingImport({ label: data.label, w: data.w ?? widget.w, h: data.h ?? widget.h, elements: data.elements, states: data.states ?? {}, steps: data.steps ?? [], timelineFps: data.timelineFps });
    } catch { /* not valid JSON — silently ignored, same tolerance as elsewhere */ }
  };
  const confirmImport = () => {
    if (!pendingImport) return;
    pushHistory();
    setConfig(widgetId, { elements: pendingImport.elements, states: pendingImport.states, steps: pendingImport.steps ?? [], timelineFps: pendingImport.timelineFps });
    doResize(widgetId, pendingImport.w, pendingImport.h);
    setLocalSelectedId(null);
    setPendingImport(null);
  };

  const importSequence = async (intoElementId?: string) => {
    if (!isTauri) return;
    const { invoke } = await import('@tauri-apps/api/core');
    const files = await invoke<{ name: string; dataBase64: string }[]>('pick_sequence_frames');
    if (!files.length) return;
    // TGA -> PNG still happens here (browser-side decode, same as always —
    // see lib/tgaDecoder.ts); the difference from before is what happens
    // AFTER: every frame's PNG bytes are handed to save_sequence in ONE call
    // rather than one import_image call per frame, so a 200-frame sequence
    // becomes one file in the library instead of 200 loose ones (see
    // save_sequence's own doc comment in commands.rs).
    const pngFrames: string[] = [];
    for (const f of files) {
      let { name, dataBase64 } = f;
      if (name.toLowerCase().endsWith('.tga')) {
        const bytes = Uint8Array.from(atob(dataBase64), (c) => c.charCodeAt(0));
        dataBase64 = await tgaFileToPngBase64(bytes.buffer);
      }
      pngFrames.push(dataBase64);
    }
    const result = await invoke<{ name: string; urls: string[] }>('save_sequence', { frames: pngFrames });
    const frameUrls = result.urls;
    if (intoElementId) {
      updateElementConfig(intoElementId, { frames: frameUrls });
    } else {
      const el: TemplateElement = { id: crypto.randomUUID(), ...NEW_ELEMENT.sequence(), config: { ...NEW_ELEMENT.sequence().config, frames: frameUrls } };
      commitElements([...elements, el]);
      setLocalSelectedId(el.id);
    }
  };

  const previewState = (name: string) => {
    stopPreview();
    // Scoped to just this one state — NOT the full `states` object. Even
    // though only `tls[name]` below ever gets played, buildStateTimelines'
    // hide-until-revealed logic (see cgAnimationEngine.ts) applies as soon
    // as the 'in' timeline is merely CONSTRUCTED, immediately setting
    // visibility:hidden on 'in'-animated elements — a side effect of
    // building it, independent of whether it's ever actually restarted.
    // Passing the full `states` here meant previewing Out (or Loop) built
    // the 'in' timeline right alongside it "for free", hiding the element
    // before Out's own (visibility-untouched) animation ever ran — so Out
    // visibly did nothing, even though its transform/opacity tween was
    // genuinely playing the whole time, just on an invisible element.
    // Previewing 'in' itself was never affected, since playing it reveals
    // the element via its own timeline right after. Matches scrub()'s
    // already-correct single-state-scoped build below. A Step's own
    // CgAnimState lives in `steps`, not `states` — resolved here the same
    // way `currentState` above does.
    const step = steps.find((s) => s.id === name);
    const stateConfig = step ?? states[name as CgStateName] ?? EMPTY_STATE;
    const tls = buildStateTimelines({ [name as CgStateName]: stateConfig }, elements, elRefs.current, effectWrapperRefs.current, effectProxiesRef.current);
    activeTlsRef.current = tls;
    const tl = tls[name as CgStateName];
    if (!tl) return;
    setPreviewing(name);
    watchedRef.current = { name, tl };
    tl.eventCallback('onComplete', () => { setPreviewing((p) => (p === name ? null : p)); watchedRef.current = null; });
    tl.restart();
  };
  const previewAll = () => {
    stopPreview();
    const tls = buildStateTimelines(states, elements, elRefs.current, effectWrapperRefs.current, effectProxiesRef.current);
    const stepTls = buildStepTimelines(steps, elements, elRefs.current, effectWrapperRefs.current, effectProxiesRef.current);
    activeTlsRef.current = { ...tls };
    steps.forEach((step, i) => { activeTlsRef.current[step.id] = stepTls[i]; });
    setPreviewing('all');
    const finish = () => { setPreviewing((p) => (p === 'all' ? null : p)); setPreviewManualStep(null); watchedRef.current = null; previewAdvanceRef.current = null; };

    // Same "In → (600ms) → Out" chain as before — deliberately skips Loop
    // (an infinitely-repeating `tl.repeat(-1)` timeline never fires
    // onComplete, so chaining through it would hang forever) — Steps slot
    // in between In and that existing Out step, in authored order.
    const playOutOrFinish = () => {
      if (tls.out) { watchedRef.current = { name: 'out', tl: tls.out }; tls.out.eventCallback('onComplete', finish); setTimeout(() => tls.out!.restart(), 600); }
      else finish();
    };
    let stepIndex = -1;
    const playNextStepOrOut = () => {
      stepIndex += 1;
      if (stepIndex < stepTls.length) {
        const stepTl = stepTls[stepIndex];
        const stepConfig = steps[stepIndex];
        watchedRef.current = { name: stepConfig.id, tl: stepTl };
        const isManual = stepConfig.advanceMode === 'manual';
        setPreviewManualStep(isManual ? stepConfig.id : null);
        previewAdvanceRef.current = isManual ? playNextStepOrOut : null;
        stepTl.eventCallback('onComplete', () => {
          if (stepConfig.advanceMode === 'auto') setTimeout(playNextStepOrOut, stepConfig.autoAdvanceMs ?? 0);
        });
        stepTl.restart();
      } else {
        setPreviewManualStep(null);
        previewAdvanceRef.current = null;
        playOutOrFinish();
      }
    };

    if (tls.in) {
      watchedRef.current = { name: 'in', tl: tls.in };
      // Mirrors CgTemplateWidget.tsx's real playback: 'manual' pauses here
      // and reuses the same manual-Step preview affordance (the "Next
      // Step" button) rather than needing its own UI, since that button's
      // only job is calling previewAdvanceRef.current — 'auto' behaves
      // exactly as before this field existed.
      tls.in.eventCallback('onComplete', () => {
        const advanceMode = states.in?.advanceMode ?? 'auto';
        if (advanceMode === 'manual') {
          setPreviewManualStep('in');
          previewAdvanceRef.current = playNextStepOrOut;
          return;
        }
        const ms = states.in?.autoAdvanceMs ?? 0;
        if (ms > 0) setTimeout(playNextStepOrOut, ms);
        else playNextStepOrOut();
      });
      tls.in.restart();
    } else {
      playNextStepOrOut();
    }
  };
  const scrub = (t: number) => {
    setPlayhead(t);
    // Kill whatever scrub built last time before building a fresh one —
    // rebuilding from scratch on every call (rather than caching) keeps any
    // in-progress animation edit immediately reflected while dragging, but
    // this used to never kill the PREVIOUS call's timeline, leaking a new
    // un-killed GSAP timeline on every single pointer-move of a scrub drag
    // (dozens per gesture). Tracking it in activeTlsRef (the same map
    // previewState/stopPreview already use) also means switching tabs or
    // hitting Stop correctly cleans it up too.
    activeTlsRef.current[activeState]?.kill();
    // .kill() stops a timeline but does NOT revert whatever inline styles
    // it already applied — so the FIRST scrub always looked right (nothing
    // to leave behind yet), but every rebuild after that constructed its
    // `.from()` tweens relative to wherever the killed timeline's last
    // seek had left the element (e.g. mid-slide, half-transparent),
    // instead of the element's true authored rest state — visibly
    // "stuck"/wrong-looking scrubbing from the second drag onward. Reset
    // exactly the properties presets/keyframes animate (same scoped list
    // the real "in" playback effect uses, not clearProps:'all' — that
    // wipes React's own position/size styles too, a bug fixed earlier).
    elements.forEach((el) => {
      const node = elRefs.current[el.id];
      if (node) gsap.set(node, { clearProps: 'opacity,visibility,transform,filter,clipPath' });
    });
    // Same reasoning as above, for effect keyframes — scrub() always
    // rebuilds ONE state in isolation (never a chained sequence), so unlike
    // previewAll there's no genuine cross-state continuity to preserve
    // between scrub calls; reseeding fresh from the static base every time
    // is the correct, leak-free behavior here.
    effectProxiesRef.current = {};
    elements.forEach((el) => {
      const wrapperNode = effectWrapperRefs.current[el.id];
      if (wrapperNode) wrapperNode.style.filter = resolveElementFilter(el.config, instanceId, el.id, el.changeAnim?.preset) || '';
    });
    const tls = buildStateTimelines({ [activeState as CgStateName]: currentState }, elements, elRefs.current, effectWrapperRefs.current, effectProxiesRef.current);
    const tl = tls[activeState as CgStateName];
    if (tl) activeTlsRef.current = { ...activeTlsRef.current, [activeState]: tl };
    // suppressEvents:true — dragging the ruler shouldn't re-fire tl.call()
    // side effects (typewriter/scramble's own text mutations use Math.random(),
    // so re-triggering them on every pixel of a scrub would look like
    // glitching garbage rather than a clean scrub); tween/keyframe-driven
    // properties still interpolate correctly either way.
    if (tl) { tl.pause(); tl.seek(t, true); }

    // Sequence frames are driven by a tl.call() (see buildSequencePlayback
    // in cgAnimationEngine.ts) — a side effect suppressEvents:true above
    // deliberately skips, same as scramble/typewriter's, so it doesn't
    // rapid-fire during a drag. Unlike those two, a sequence's frame choice
    // is pure/deterministic (no Math.random()), so it's computed and
    // applied directly here instead.
    //
    // elRefs.current[id] is TemplateElementWrapper's outer .tpl-el-body —
    // fine for opacity/transform/visibility (which cascade to children),
    // but backgroundImage only ever paints on the exact node it's set on,
    // and ElementPreview's own div (a direct, sole child of that wrapper)
    // already has its own static backgroundImage covering it — so this
    // reaches one level in to the actual node that needs the update,
    // rather than the wrapper.
    for (const layerAnim of currentState.layers) {
      if (layerAnim.preset !== 'sequencePlay') continue;
      const baseElement = elements.find((e) => e.id === layerAnim.id);
      // A looping sequence (config.loop) is driven entirely by its own
      // independent real-time clock (lib/useSequenceLoop.ts), not by
      // buildSequencePlayback's tl.call() schedule at all (that function
      // deliberately schedules nothing for one — see its own doc comment)
      // — there's no meaningful "frame at scrub position t" for it to sync
      // to here, and writing to its own first layer node directly would
      // just fight that hook's double-buffered writes the same way a
      // React-rendered static style used to. Scrubbing simply has no
      // effect on a looping sequence; it keeps cycling on its own
      // regardless of where the state timeline's own scrub handle sits.
      if (baseElement?.config?.loop) continue;
      const node = elRefs.current[layerAnim.id]?.firstElementChild as HTMLElement | null;
      if (!node) continue;
      const frames: string[] = baseElement?.config?.frames ?? [];
      if (!frames.length) continue;
      const delay = layerAnim.delay || 0;
      if (t < delay) continue; // not started yet — leave it hidden, as the timeline's own tl.set already does
      const fps = baseElement?.config?.fps || 24;
      const idx = Math.min(frames.length - 1, Math.floor((t - delay) * fps));
      node.style.backgroundImage = `url("${resolveImageUrl(frames[idx])}")`;
    }

    // wordSequence — same reasoning as sequencePlay right above (its own
    // tl.call()s are skipped by suppressEvents:true, and its word choice at
    // any given time is pure/deterministic), just computed here instead of
    // scheduled with the timeline. Unlike a sequence frame, text content
    // DOES cascade correctly from elRefs.current[id] (.tpl-el-body) itself
    // — same node buildWordSequence's own el.textContent write targets — so
    // no need to reach one level deeper the way the frame case does.
    for (const layerAnim of currentState.layers) {
      if (layerAnim.preset !== 'wordSequence') continue;
      const node = elRefs.current[layerAnim.id];
      if (!node) continue;
      const baseElement = elements.find((e) => e.id === layerAnim.id);
      const items: CgWordSequenceItem[] = baseElement?.config?.wordSequence ?? [];
      if (!items.length) continue;
      const delay = layerAnim.delay || 0;
      if (t < delay) continue;
      let cursor = delay;
      let word = items[0]?.word ?? '';
      for (const item of items) {
        const duration = Math.max(0.02, item.duration || 0.15);
        if (t < cursor + duration) { word = item.word; break; }
        cursor += duration;
        word = item.word;
      }
      node.textContent = word;
    }
  };

  // A keyframe selected in one state/element stops being meaningful the
  // instant you switch tabs or select a different element — stale
  // cross-state/cross-element references would otherwise silently target
  // the wrong layer on the next canvas drag (see handleElementGestureEnd).
  useEffect(() => {
    setSelectedKf(null);
  }, [activeState, localSelectedId]);

  // Clicking ANY selected keyframe — in the timeline below, or in
  // ElementPropertiesPanel's own prev/next-keyframe nav — jumps the canvas
  // playhead to that exact moment, so dragging it (position keyframes) or
  // just reading its live value (every other property) starts from wherever
  // it actually sits. Used to be limited to x/y only; every property
  // benefits the same way AE's own Timeline panel jumps the current-time
  // indicator when you click a keyframe on any row.
  useEffect(() => {
    if (!selectedKf) return;
    const kf = currentState.layers.find((l) => l.id === selectedKf.layerId)?.tracks?.[selectedKf.prop]?.[selectedKf.idx];
    if (kf) scrub(kf.t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKf]);

  // Drag/resize-to-set-keyframes: once a selected element's Animation Mode
  // is "Keyframes", moving or resizing it on canvas redirects the gesture
  // into x/y (move) or width/height (resize) keyframes instead of the
  // element's base rest position/size — either at the current playhead
  // (nothing selected in the timeline) or at whichever keyframe is selected
  // there. Whichever of those tracks don't exist yet are created on the
  // spot — no need to add them via +Track first, and a move never requires
  // an existing 'x' or 'y' track specifically, nor a resize a 'width'/
  // 'height' one; both pairs always merge together as one edit. Anything
  // else (Animation Mode isn't Keyframes, or a plain click with no actual
  // move/resize) falls straight through to today's plain base-element edit.
  const dragStartRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  const handleElementGestureStart = (el: TemplateElement) => {
    dragStartRef.current = { x: el.x, y: el.y, w: el.w, h: el.h };
    beginGesture();
  };

  const handleElementGestureEnd = (el: TemplateElement) => {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    const anim = currentState.layers.find((l) => l.id === el.id);
    const inKeyframesMode = !!anim?.tracks;

    if (start && inKeyframesMode && selected?.id === el.id) {
      const latest = elements.find((e) => e.id === el.id);
      const deltaX = (latest?.x ?? start.x) - start.x;
      const deltaY = (latest?.y ?? start.y) - start.y;
      const deltaW = (latest?.w ?? start.w) - start.w;
      const deltaH = (latest?.h ?? start.h) - start.h;
      // TemplateElementWrapper's move handle only ever changes x/y, and its
      // resize handle only ever changes w/h — never both in one gesture —
      // so exactly one of these is meaningful per call.
      const moved = deltaX !== 0 || deltaY !== 0;
      const resized = deltaW !== 0 || deltaH !== 0;

      if (moved || resized) {
        // Revert the base rest position/size — the gesture authored a
        // keyframe offset, it never actually meant to redefine the base.
        commitElements(elements.map((e) => (e.id === el.id ? { ...e, x: start.x, y: start.y, w: start.w, h: start.h } : e)));

        const axes = moved ? (['x', 'y'] as const) : (['width', 'height'] as const);
        const deltaOf: Record<string, number> = { x: deltaX, y: deltaY, width: deltaW, height: deltaH };
        const kfForSelection = selectedKf && selectedKf.layerId === el.id && (axes as readonly string[]).includes(selectedKf.prop)
          ? anim!.tracks![selectedKf.prop]?.[selectedKf.idx]
          : null;
        const targetTime = kfForSelection ? kfForSelection.t : playhead;

        const newTracks: Record<string, CgKeyframe[]> = { ...(anim!.tracks ?? {}) };
        axes.forEach((axis) => {
          const delta = deltaOf[axis];
          const kfs = newTracks[axis] ?? [{ t: 0, v: 0 }]; // auto-create if this track doesn't exist yet
          const idx = kfs.findIndex((k) => Math.abs(k.t - targetTime) < 0.005);
          if (idx >= 0) {
            newTracks[axis] = kfs.map((k, i) => (i === idx ? { ...k, v: (Number(k.v) || 0) + delta } : k));
          } else {
            // Same "hold whatever the previous keyframe's value was" seed
            // CgTemplateTimeline's own addKeyframeAtPlayhead uses.
            const before = [...kfs].reverse().find((k) => k.t <= targetTime);
            const v = (before ? Number(before.v) || 0 : 0) + delta;
            newTracks[axis] = [...kfs, { t: Number(targetTime.toFixed(2)), v }].sort((a, b) => a.t - b.t);
          }
        });

        commitState({ ...currentState, layers: currentState.layers.map((l) => (l.id === el.id ? { ...l, tracks: newTracks } : l)) });
        scrub(targetTime);
      }
    }

    endGesture();
  };

  // Creates a bare layer entry for the selected element in the CURRENT
  // state — the one entry point into "this element has ANY animation at
  // all" for this state. Once it exists, the preset picker (defaulting to
  // 'none', i.e. no preset yet) and the timeline's own "+ Track" both work
  // independently on it — no separate "Mode" to pick between them anymore
  // (see CgLayerAnim's own doc comment for why they coexist rather than
  // being mutually exclusive).
  const addAnimation = () => {
    if (!selected || selectedAnim) return;
    commitState({ ...currentState, layers: [...currentState.layers, { id: selected.id, preset: 'none' }] });
  };
  // Clears EVERYTHING for this element in this state at once (preset AND
  // every keyframe track) — the equivalent of the old "Mode: None". Picking
  // 'none' in the Preset dropdown only clears the preset half; there was no
  // single "start over completely" action otherwise once tracks existed
  // independently of the preset.
  const removeAnimation = () => {
    if (!selected) return;
    commitState({ ...currentState, layers: currentState.layers.filter((l) => l.id !== selected.id) });
  };
  const updateSelectedAnim = (patch: Partial<CgLayerAnim>) => {
    if (!selected || !selectedAnim) return;
    commitState({ ...currentState, layers: currentState.layers.map((l) => (l.id === selected.id ? { ...l, ...patch } : l)) });
  };

  // Bound convenience wrapper around resolveSeedValue/priorStatesChain (see
  // their own comments above) — passed down to CgTemplateTimeline.tsx's own
  // "+ Track" (replacing its old hardcoded v:0 seed) and used directly by
  // ElementPropertiesPanel for its stopwatch-toggle/untracked-value fallback.
  const getSeedValue = (elementId: string, prop: string, fallback: any): any =>
    resolveSeedValue(priorStatesChain(activeState, states, steps), elementId, prop, fallback);

  // Only ever touches `preset` itself — never `tracks` (previously this
  // wiped any existing keyframe tracks whenever the preset changed, back
  // when the two were mutually exclusive; see CgLayerAnim's own doc
  // comment for why they now coexist instead). Adjustable via its own
  // Duration/Delay/Ease/Transform Origin knobs just below (all already
  // per-element fields on THIS layer, via updateSelectedAnim, same as
  // every other preset field here — never the shared PRESETS/OUT_PRESETS
  // definition itself, so picking "Slide Left" here can never change what
  // "Slide Left" means for any other element/template that also uses it).
  const applyPreset = (presetName: string) => {
    if (!selected || !selectedAnim) return;
    updateSelectedAnim({ preset: presetName });
  };

  // Per-state content override (text/imageUrl) — independent of the
  // preset/tracks above, so it works the same create-update-or-remove way
  // addAnimation/removeAnimation do, but never destroys an existing preset/
  // tracks entry, and never leaves behind an empty bare layer once every
  // override on it has been cleared and it has no animation either.
  const updateContentOverride = (patch: Record<string, string | undefined>) => {
    if (!selected) return;
    const merged: Record<string, string> = { ...(selectedAnim?.contentOverride ?? {}) };
    Object.entries(patch).forEach(([k, v]) => { if (v === undefined) delete merged[k]; else merged[k] = v; });
    const hasOverride = Object.keys(merged).length > 0;
    const contentOverride = hasOverride ? (merged as { text?: string; imageUrl?: string }) : undefined;

    let layers: CgLayerAnim[];
    if (selectedAnim) {
      const next = { ...selectedAnim, contentOverride };
      layers = !contentOverride && !next.preset && !next.tracks
        ? currentState.layers.filter((l) => l.id !== selected.id)
        : currentState.layers.map((l) => (l.id === selected.id ? next : l));
    } else if (contentOverride) {
      layers = [...currentState.layers, { id: selected.id, contentOverride }];
    } else {
      return;
    }
    commitState({ ...currentState, layers });
  };

  const presetLib = activeState === 'out' ? OUT_PRESETS : PRESETS;
  const hasAnim = !!selectedAnim;

  // One hidden <clipPath> per distinct shape referenced as a maskId — see
  // CgTemplateWidget.tsx's identical block, kept in lockstep so masks look
  // the same in the Designer as they do on the real output.
  const maskIds = [...new Set(elements.map((e) => e.maskId).filter((id): id is string => !!id))];
  // Same idea for 'flagWave' — see CgTemplateWidget.tsx's identical block
  // and cgEffects.ts's own doc comment on the filter recipe.
  const flagWaveRefs = useRef<Record<string, FlagWaveNodes>>({});
  const flagWaveEls = elements.filter((e) => findFlagWave(e.config.effects));
  // Same idea for 'waveWarp' — see CgTemplateWidget.tsx's identical block.
  const waveWarpRefs = useRef<Record<string, WaveWarpNodes>>({});
  const waveWarpEls = elements.filter((e) => findWaveWarp(e.config.effects));
  // Same idea for 'bevel' — see CgTemplateWidget.tsx's identical block.
  const bevelEls = elements.filter((e) => findBevel(e.config.effects));
  // Same idea for 'innerShadow' — see CgTemplateWidget.tsx's identical block.
  const innerShadowEls = elements.filter((e) => findInnerShadow(e.config.effects));
  // Same idea for a ramp-masked 'blur' — see CgTemplateWidget.tsx's identical block.
  const rampBlurEls = elements.filter((e) => findRampBlur(e.config.effects));
  // Same idea for gooeyMorph — see CgTemplateWidget.tsx's identical block.
  const gooeyEls = elements.filter((e) => e.kind === 'text' && e.changeAnim?.preset === 'gooeyMorph');

  // Reference background — see appSettingsStore.ts's own doc comment on
  // referenceBg: purely a visual aid behind the canvas's own transparent
  // areas, computed fresh from that global preference and never written
  // anywhere near widget.config, so there's no path for it to leak into
  // the actual template or its real output.
  const referenceBgStyle: React.CSSProperties =
    referenceBg.type === 'color' ? { background: referenceBg.color ?? '#1a1a1a' }
    : referenceBg.type === 'image' && referenceBg.imageUrl ? {
        backgroundImage: `url("${resolveImageUrl(referenceBg.imageUrl)}")`,
        backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
      }
    : {
        // Transparent — a real checkerboard (clearer than a flat wash) so
        // it unambiguously reads as "nothing here", the same visual
        // language broadcast/compositing tools already use for alpha.
        backgroundImage:
          'linear-gradient(45deg, rgba(128,128,128,0.25) 25%, transparent 25%, transparent 75%, rgba(128,128,128,0.25) 75%), linear-gradient(45deg, rgba(128,128,128,0.25) 25%, transparent 25%, transparent 75%, rgba(128,128,128,0.25) 75%)',
        backgroundSize: '16px 16px',
        backgroundPosition: '0 0, 8px 8px',
        backgroundColor: '#2a2a2a',
      };

  const handlePenCanvasClick = (e: React.MouseEvent) => {
    const rect = penOverlayRef.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;
    // Clicking back near the first point closes the path, same affordance
    // every pen-tool-style editor uses instead of requiring Enter/dblclick.
    if (penPoints.length >= 3) {
      const first = penPoints[0];
      if (Math.hypot((x - first.x) * zoom, (y - first.y) * zoom) < 10) { finishPen(); return; }
    }
    setPenPoints((pts) => [...pts, { x: Math.round(x), y: Math.round(y) }]);
  };

  // Closes the in-progress path — creates a new 'shape' element sized to
  // its own drawn bounding box, or, if a shape element was already
  // selected when the tool was invoked, overwrites that element's own
  // config.d/viewBox/x/y/w/h instead (direct on-canvas path editing, an
  // alternative to pasting raw path text).
  const finishPen = () => {
    if (penPoints.length < 2) { setPenActive(false); setPenPoints([]); return; }
    const minX = Math.min(...penPoints.map((p) => p.x));
    const minY = Math.min(...penPoints.map((p) => p.y));
    const w = Math.max(10, Math.max(...penPoints.map((p) => p.x)) - minX);
    const h = Math.max(10, Math.max(...penPoints.map((p) => p.y)) - minY);
    const d = `M${penPoints.map((p) => `${p.x - minX},${p.y - minY}`).join(' L')} Z`;
    if (selected?.kind === 'shape') {
      commitElements(elements.map((e) => (e.id === selected.id ? { ...e, x: minX, y: minY, w, h, config: { ...e.config, d, viewBox: `0 0 ${w} ${h}` } } : e)));
    } else {
      const el: TemplateElement = { id: crypto.randomUUID(), kind: 'shape', x: minX, y: minY, w, h, config: { d, viewBox: `0 0 ${w} ${h}`, fill: '#ffffff', stroke: 'none', strokeWidth: 0 } };
      commitElements([...elements, el]);
      setLocalSelectedId(el.id);
    }
    setPenActive(false);
    setPenPoints([]);
  };

  useEffect(() => {
    if (!penActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setPenActive(false); setPenPoints([]); }
      else if (e.key === 'Enter') { finishPen(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [penActive, penPoints, selected]);

  // Renders one level of the parent/child tree — every root (parentId
  // undefined) at the top call, then each element's own children nested
  // inside its own TemplateElementWrapper so their x/y resolve relative to
  // it and they inherit its animated transform via ordinary CSS, the same
  // approach CgTemplateWidget.tsx's real-output renderer uses. An element
  // with no children (everything before this feature existed) renders
  // through exactly the same JSX as before, just reached recursively.
  const renderElementTree = (parentId: string | undefined, parentEl: TemplateElement | undefined): React.ReactNode => (
    <>
      {elements.filter((el) => el.parentId === parentId).map((el) => {
        const childElements = elements.filter((c) => c.parentId === el.id);
        const filterStr = resolveElementFilter(el.config, instanceId, el.id, el.changeAnim?.preset);
        const hasMask = !!el.maskId && elements.some((e) => e.id === el.maskId && e.kind === 'shape');
        // 'glass' effect — see CgTemplateWidget.tsx's identical comment on
        // why this is its own set of inline style properties rather than
        // part of filterStr above.
        const glassEffect = findGlass(el.config.effects);
        const liquidGlassApplies = glassEffect?.type === 'liquidGlass' && el.kind === 'text' && !el.config.fontFamily;
        const liquidGlassFilterUrl = liquidGlassApplies ? `url(#${instanceId}-liquidglass-${el.id})` : undefined;
        const glassStyle = glassEffect ? buildGlassStyle(glassEffect, liquidGlassFilterUrl) : null;
        const glassEdge = glassEffect ? buildGlassEdgeStyle(glassEffect) : null;
        const fractalRidge = glassEffect?.type === 'fractalGlass' ? buildFractalGlassRidgeStyle(glassEffect) : null;
        const crystalFacet = glassEffect?.type === 'crystalGlass' ? buildCrystalFacetStyle(glassEffect) : null;
        const rampMaskImage = glassEffect ? buildRampMaskImage(glassEffect) : undefined;
        // On 'text'/'image', see CgTemplateWidget.tsx's identical comment —
        // glass hugs the actual glyphs/opaque pixels instead of its whole
        // rectangular box. Uses el.config.fontSize directly (not autoFit's
        // own live-measured size, which is ElementPreview's own internal
        // state, out of reach here) — a fine approximation for the preview.
        // Text masking only when fontFamily is unset — see
        // buildTextGlassMask's own doc comment for why a custom font can't
        // be matched reliably.
        const glassContentMask = !glassEffect ? null
          : el.kind === 'image' ? buildImageGlassMask(resolveImageUrl(el.binding ? resolveBindingValue(allPages, el.binding) : (el.config.imageUrl ?? '')), el.config.objectFit)
          : el.kind === 'text' && !el.config.fontFamily ? buildTextGlassMask(el.binding ? resolveBindingValue(allPages, el.binding) : (el.config.text ?? 'Text'), el.w, el.h, { fontSize: el.config.fontSize ?? 14, bold: el.config.bold, align: el.config.align, valign: el.config.valign })
          : null;
        // liquidGlass's own chromatic-aberration map — see
        // CgTemplateWidget.tsx's identical comment on why this one <filter>
        // is rendered as a small local <svg> sibling instead of the shared
        // top-level defs block every other per-element filter here uses.
        const liquidGlassProps = liquidGlassApplies ? buildLiquidGlassFilterProps(glassEffect!) : null;
        const liquidGlassMapSvg = liquidGlassApplies
          ? buildLiquidGlassMapSvg(el.binding ? resolveBindingValue(allPages, el.binding) : (el.config.text ?? 'Text'), el.w, el.h, { fontSize: el.config.fontSize ?? 14, bold: el.config.bold, align: el.config.align, valign: el.config.valign }, liquidGlassProps!.mapBlur)
          : null;
        // See CgTemplateWidget.tsx's identical combineGlassMasks comment.
        const glassMask = combineGlassMasks(glassContentMask, rampMaskImage);
        const preview = <ElementPreview el={el} allElements={elements} pages={allPages} widgetId={widgetId} instanceId={instanceId} getFlagWaveRefs={(id) => flagWaveRefs.current[id]} getWaveWarpRefs={(id) => waveWarpRefs.current[id]} />;
        // Which of this element's own color fields can hold a gradient,
        // per kind — same field names ElementInspector's own
        // ColorOrGradientPicker instances already edit.
        const gradientFields: string[] =
          el.kind === 'rect' || el.kind === 'shape' ? ['fill']
          : el.kind === 'text' ? ['color', 'bgColor']
          : el.kind === 'image' || el.kind === 'imagePlaylist' ? ['bgColor']
          : [];
        // config.scene3D — see CgTemplateWidget.tsx's identical-purpose
        // comment: a shared 3D space for this element's own children
        // (rendered below via renderElementTree(el.id, el)), so their own
        // rotationX/rotationY/z keyframes compose relative to EACH OTHER
        // instead of each sitting in its own isolated, unrelated 3D space.
        const scene3D = !!el.config.scene3D && childElements.length > 0;
        const scene3DStyle: React.CSSProperties | undefined = scene3D
          ? { perspective: `${el.config.scene3DPerspective ?? 800}px`, transformStyle: 'preserve-3d' }
          : undefined;
        const extraHandles = (
          <>
            {gradientFields.filter((f) => isGradient(el.config[f])).map((f) => (
              <GradientAnchorHandle
                key={f}
                gradient={el.config[f]}
                w={el.w} h={el.h} zoom={zoom}
                onGestureStart={beginGesture}
                onGestureEnd={endGesture}
                onChange={(v) => updateElementConfig(el.id, { [f]: v })}
              />
            ))}
            {/* Per-ELEMENT 3D pose handle — independent of the shared-with-
               children `scene3D` var above, which only additionally gates
               the children's own perspective/preserve-3d wrapper. THIS
               element gets an orbit handle for its OWN staticRotateX/Y the
               moment its own config.scene3D is on, group or leaf alike —
               see cgPresets.ts's buildStaticTransform3D for whether that
               pairs with a self-perspective too (leaf) or deliberately not
               (a group with its own children, to avoid double-perspective —
               see that function's own doc comment). */}
            {!!el.config.scene3D && (
              <Orbit3DHandle
                w={el.w} h={el.h}
                rotateX={el.config.staticRotateX ?? 0}
                rotateY={el.config.staticRotateY ?? 0}
                perspective={el.config.scene3DPerspective ?? 800}
                onGestureStart={beginGesture}
                onGestureEnd={endGesture}
                onChange={(rx, ry) => updateElementConfig(el.id, { staticRotateX: rx, staticRotateY: ry })}
                onPerspectiveChange={(v) => updateElementConfig(el.id, { scene3DPerspective: v })}
              />
            )}
          </>
        );
        const snapGuides = computeSnapGuides(
          elements.filter((e) => e.parentId === parentId && e.id !== el.id),
          parentEl?.w ?? widget.w,
          parentEl?.h ?? widget.h,
        );
        return (
          <TemplateElementWrapper
            key={el.id}
            x={el.x} y={el.y} w={el.w} h={el.h}
            canvasW={parentEl?.w ?? widget.w} canvasH={parentEl?.h ?? widget.h}
            zoom={zoom}
            selected={el.id === localSelectedId}
            hidden={hiddenIds.has(el.id)}
            snapEnabled={snapEnabled}
            guides={snapGuides}
            smartSnapEnabled={smartSnapEnabled}
            onActiveGuides={setActiveGuides}
            snapSoundEnabled={snapSoundEnabled}
            snapSoundId={snapSoundId}
            // Also opened up whenever this element has any effect at all
            // (drop shadow, glow, blur…) — .tpl-el-body's default
            // overflow:hidden was clipping a shadow/glow's bleed at this
            // element's own box edge, invisible in the designer even though
            // the real output never clips it there (CgTemplateWidget.tsx's
            // equivalent wrapper has no overflow:hidden of its own). A mask
            // (hasMask) still correctly clips regardless — that's a
            // separate clip-path on the content itself, unaffected by this
            // outer box's own overflow setting.
            // config.clipToBounds takes PRIORITY over that convenience
            // default — this is `.tpl-el-body` (via TemplateElementWrapper),
            // the actual common ancestor of BOTH `preview` and
            // renderElementTree(el.id, el)'s own children just below (both
            // rendered as ITS direct children, not nested inside
            // conditionsRef's own div — that div's own `overflow` (see
            // ElementPreview's return statement) only ever bounds `preview`
            // in the Designer, unlike CgTemplateWidget.tsx's identical prop
            // where children DO nest inside it). An explicit clip request
            // means CLIP, even while editing.
            bodyOverflow={el.config.clipToBounds ? 'hidden' : (childElements.length > 0 || !!filterStr) ? 'visible' : undefined}
            onSelect={() => setLocalSelectedId(el.id)}
            onChange={(patch) => updateElement(el.id, patch)}
            onDelete={() => deleteElement(el.id)}
            onGestureStart={() => handleElementGestureStart(el)}
            onGestureEnd={() => handleElementGestureEnd(el)}
            contentRef={(node) => { elRefs.current[el.id] = node; }}
            extraHandles={extraHandles}
            scene3DStyle={scene3DStyle}
            staticTransform={buildStaticTransform3D(el.config, childElements.length > 0)}
          >
            {/* liquidGlass's own chromatic-aberration <filter> — see
               CgTemplateWidget.tsx's identical comment on why this is a
               small local defs block rather than the shared top-level one
               every other per-element filter here uses. */}
            {liquidGlassMapSvg && liquidGlassProps && (
              <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
                <defs>
                  <filter id={`${instanceId}-liquidglass-${el.id}`} primitiveUnits="objectBoundingBox" x="-0.2" y="-0.2" width="1.4" height="1.4">
                    <feImage href={`data:image/svg+xml,${encodeURIComponent(liquidGlassMapSvg)}`} preserveAspectRatio="none" x="0" y="0" width="1" height="1" result="map" />
                    <feGaussianBlur in="SourceGraphic" stdDeviation="0.01" result="blur" />
                    <feColorMatrix in="blur" type="matrix" result="red_channel" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" />
                    <feDisplacementMap in="red_channel" in2="map" scale={liquidGlassProps.scale} xChannelSelector="B" yChannelSelector="R" result="red_displaced" />
                    <feColorMatrix in="blur" type="matrix" result="green_channel" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" />
                    <feDisplacementMap in="green_channel" in2="map" scale={liquidGlassProps.scale} xChannelSelector="B" yChannelSelector="R" result="green_displaced" />
                    <feColorMatrix in="blur" type="matrix" result="blue_channel" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" />
                    <feDisplacementMap in="blue_channel" in2="map" scale={liquidGlassProps.scale} xChannelSelector="B" yChannelSelector="R" result="blue_displaced" />
                    <feComposite in="red_displaced" in2="green_displaced" operator="arithmetic" k1={0} k2={1} k3={1} k4={0} result="rg_added" />
                    <feComposite in="rg_added" in2="blue_displaced" operator="arithmetic" k1={0} k2={1} k3={1} k4={0} />
                  </filter>
                </defs>
              </svg>
            )}
            {/* Glass's own blur/tint/shadow + two-tone edge highlight —
               rendered as a SIBLING of the filtered div below, deliberately
               NOT nested inside it. See CgTemplateWidget.tsx's identical,
               much longer comment: `filter` on an ancestor establishes a
               new "backdrop root" a descendant's `backdrop-filter` can't
               see past, so combining Glass with ANY other effect on the
               same element (which puts a real `filter` value on that div)
               silently cut Glass off from whatever was actually behind this
               element — the "multiple effects together break" bug this
               fixes. Its own clipPath mirrors the filtered div's below
               (both independently need it — a mask clips glass's own tint/
               blur same as it clips everything else here). */}
            {glassStyle && (
              <div style={{
                position: 'absolute', inset: 0, pointerEvents: 'none',
                clipPath: hasMask ? `url(#${instanceId}-mask-${el.maskId})` : undefined,
                borderRadius: el.config.borderRadius,
                // See CgTemplateWidget.tsx's identical, longer comment —
                // backdrop-filter needs its own WebKit compositing layer
                // to keep repainting once any ancestor's transform
                // changes (e.g. CgMonitorBar.tsx's PROGRAM box scaling
                // this whole template to fit its small monitor box).
                willChange: 'backdrop-filter', transform: 'translateZ(0)',
                backdropFilter: glassStyle.backdropFilter, WebkitBackdropFilter: glassStyle.backdropFilter,
                background: fractalRidge ? fractalRidge.background : glassStyle.background,
                boxShadow: fractalRidge ? fractalRidge.boxShadow : glassStyle.boxShadow,
                ...(fractalRidge ? { mixBlendMode: fractalRidge.mixBlendMode, filter: `blur(${fractalRidge.selfBlur}px)` } : null),
                ...(glassMask ? {
                  WebkitMaskImage: glassMask.maskImage, maskImage: glassMask.maskImage,
                  WebkitMaskSize: glassMask.maskSize, maskSize: glassMask.maskSize,
                  WebkitMaskPosition: glassMask.maskPosition, maskPosition: glassMask.maskPosition,
                  WebkitMaskRepeat: glassMask.maskRepeat, maskRepeat: glassMask.maskRepeat,
                  ...(glassMask.maskComposite ? { maskComposite: glassMask.maskComposite } : null),
                } : null),
              }}>
                {glassEdge && (
                  <>
                    <div style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', border: `1px solid ${glassEdge.shadowColor}`, WebkitMaskImage: glassEdge.shadowMask, maskImage: glassEdge.shadowMask }} />
                    <div style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', border: '1px solid #ffffff', WebkitMaskImage: glassEdge.highlightMask, maskImage: glassEdge.highlightMask }} />
                  </>
                )}
                {/* crystalGlass's own cut-facet overlay — see
                   CgTemplateWidget.tsx's identical comment. */}
                {crystalFacet && (
                  <div style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', backgroundImage: crystalFacet.backgroundImage, backgroundSize: crystalFacet.backgroundSize, mixBlendMode: crystalFacet.mixBlendMode }} />
                )}
                {/* fractalGlass's own second, more-blurred ridge pass — see
                   CgTemplateWidget.tsx's identical comment. */}
                {fractalRidge && (
                  <div style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', background: fractalRidge.backgroundHighlight, filter: `blur(${fractalRidge.highlightBlur}px)` }} />
                )}
              </div>
            )}
            {/* Also wrapped whenever ANY effect entry exists at all (even
               currently all-disabled, so filterStr is '') — mirrors
               CgTemplateWidget.tsx's own needsWrapper widening, keeping this
               ref stable rather than popping in/out of existence as a
               checkbox toggles mid-edit. */}
            {(filterStr || hasMask || el.config.effects?.length) ? (
              <div
                ref={(node) => {
                  effectWrapperRefs.current[el.id] = node;
                  // See CgTemplateWidget.tsx's identical comment — `filter`
                  // is deliberately kept OUT of the style object below so
                  // GSAP's own animated writes (buildEffectKeyframeTracks)
                  // never get stomped by an unrelated re-render reapplying
                  // the plain static value; this still applies that static
                  // value imperatively whenever it genuinely changes (a
                  // config edit here in the designer).
                  if (node) {
                    const next = filterStr || '';
                    if ((node as any).__cgStaticFilter !== next) {
                      node.style.filter = next;
                      (node as any).__cgStaticFilter = next;
                    }
                  }
                }}
                // position:relative — a lightSweep effect's own overlay
                // (rendered by ElementPreview as a sibling of its per-kind
                // content) is position:absolute/inset:0 and needs THIS box
                // as its containing block, not whatever positioned ancestor
                // happens to sit further up (TemplateElementWrapper's own
                // root, in practice) — that would still usually cover the
                // same area by coincidence (both fill the same 100%/100%
                // chain) but only this makes it correct on purpose.
                // transformStyle:preserve-3d unconditionally, same reasoning
                // as CgTemplateWidget.tsx's identical addition — a no-op
                // outside a scene3D ancestor, but required for a CHILD that
                // itself has effects/a mask (the only case reaching this div
                // at all) to keep participating in that ancestor's shared 3D
                // space instead of flattening back to 2D at this level.
                // Glass's own chrome does NOT go here anymore — see the
                // dedicated sibling div just above (rendered outside this
                // filtered node entirely — see ITS OWN comment for why).
                style={{
                  width: '100%', height: '100%', position: 'relative', clipPath: hasMask ? `url(#${instanceId}-mask-${el.maskId})` : undefined, transformStyle: 'preserve-3d',
                }}
              >
                {preview}
              </div>
            ) : preview}
            {renderElementTree(el.id, el)}
          </TemplateElementWrapper>
        );
      })}
    </>
  );

  return (
    <div className="tpld-overlay">
      {nestedContext && (
        <div className="tpld-nested-tabbar">
          <button className="tpld-nested-tab" onClick={onClose} title="Back to the carousel template — this card style stays exactly as you left it">
            <GalleryHorizontal size={12} strokeWidth={2} /> {nestedContext.parentLabel}
          </button>
          <span className="tpld-nested-tab-sep">›</span>
          <span className="tpld-nested-tab tpld-nested-tab--active" title="You're editing this card's own composition — it's an ordinary template, so any other card using the same one updates too">
            <Pencil size={12} strokeWidth={2} /> {nestedContext.cardLabel}
          </span>
        </div>
      )}
      <div className="tpld-toolbar">
        <span className="tpld-title">Custom Template — {widget.label || 'Untitled'}</span>
        <div className="tpld-toolbar-group">
          <button className="tpld-tool-btn" onClick={() => addElement('text')}><Type size={14} strokeWidth={2} /> Text</button>
          <button className="tpld-tool-btn" onClick={() => addElement('image')}><ImageIcon size={14} strokeWidth={2} /> Image</button>
          <button className="tpld-tool-btn" onClick={() => addElement('rect')}><Square size={14} strokeWidth={2} /> Rectangle</button>
          <button className="tpld-tool-btn" onClick={() => addElement('shape')}><Shapes size={14} strokeWidth={2} /> Shape</button>
          <button className="tpld-tool-btn" title="A continuously-scrolling news-crawler line of text" onClick={() => addElement('ticker')}><MoveHorizontal size={14} strokeWidth={2} /> Ticker</button>
          <button className="tpld-tool-btn" title="A two-sided comparison bar — possession, attacks, tries, conversions, or any other Team A vs Team B stat" onClick={() => addElement('statbar')}><BarChart2 size={14} strokeWidth={2} /> Stat Bar</button>
          <button className="tpld-tool-btn" title="A multi-image slideshow — auto/manual/looping, with a GSAP transition between slides" onClick={() => addElement('imagePlaylist')}><Images size={14} strokeWidth={2} /> Image Playlist</button>
          <button className="tpld-tool-btn" title="A row of cards — each one its own full CG Template Library entry, sharable across cards or fully independent — auto/manual/looping with a 3D coverflow motion" onClick={() => addElement('cardCarousel')}><GalleryHorizontal size={14} strokeWidth={2} /> Card Carousel</button>
          <button className="tpld-tool-btn" title="A non-visual layer — plays a synthesized sound effect in whichever states you add it to. Never appears on the real output, only as a marker here in the Designer." onClick={() => addElement('sound')}><Volume2 size={14} strokeWidth={2} /> Sound</button>
          <button className="tpld-tool-btn" title="Precompose — embed ANY other CG Template Library entry as a self-contained layer, playing its own In/Loop/Out independently, the way After Effects lets you drop one composition into another." onClick={() => addElement('nestedTemplate')}><LayoutTemplate size={14} strokeWidth={2} /> Nested Template</button>
          <button className="tpld-tool-btn" title="A full production end-credits roll — department/cast/sponsor sections, each with its own role/name entries, either a classic bottom-to-top scroll or one section at a time with any entrance/exit animation" onClick={() => addElement('credits')}><ScrollText size={14} strokeWidth={2} /> End Credits</button>
          <button className="tpld-tool-btn" title="A paginated, LIVE-bound list of fixtures from the app's own Schedule — each row plays a template you build once, with team/flag/time/score filling in automatically per match. Separate looks for upcoming/live/finished, plus a per-match custom override." onClick={() => addElement('matchSchedule')}><CalendarDays size={14} strokeWidth={2} /> Match Schedule</button>
          <button className="tpld-tool-btn" title="A paginated, LIVE-bound league/pool table from the Team Database's own saved results — each row plays a template you build once, with rank/team/flag/W-D-L/points filling in automatically. Separate looks for a promotion/qualification zone and a relegation zone, plus a per-team custom override." onClick={() => addElement('standings')}><ListOrdered size={14} strokeWidth={2} /> Standings</button>
          <button className="tpld-tool-btn" title="A LIVE-bound knockout bracket from the app's own Schedule, laid out in stage columns (Quarterfinal, Semifinal, Final, …) — each match box plays a template you build once, with stage/team/flag/score filling in automatically per match. Separate looks for upcoming/live/finished, plus a per-match custom override." onClick={() => addElement('bracket')}><Network size={14} strokeWidth={2} /> Bracket</button>
          <button className="tpld-tool-btn" title="A real 3D cuboid (6 faces forming an actual box, not a flat rotated rectangle) — select it and use its Transform panel's Rotation X/Y/Z fields (or the orbit ball, once Enable 3D is checked) to pose the whole box at any angle" onClick={addBox3D}><Box size={14} strokeWidth={2} /> 3D Box</button>
          <button
            className={`tpld-tool-btn${penActive ? ' tpld-tool-btn--active' : ''}`}
            title={selected?.kind === 'shape' ? "Draw points on canvas to redraw this shape's path" : 'Draw points on canvas to create a new shape'}
            onClick={() => { if (penActive) { setPenActive(false); setPenPoints([]); } else { setPenActive(true); } }}
          ><PenTool size={14} strokeWidth={2} /> Pen</button>
          <button className="tpld-tool-btn" onClick={() => importSequence()} disabled={!isTauri}><Film size={14} strokeWidth={2} /> Sequence</button>
        </div>
        <div className="tpld-toolbar-group">
          <button className="tpld-tool-btn" title="Export template as JSON" onClick={exportTemplate} disabled={!isTauri}><Download size={14} strokeWidth={2} /></button>
          <button className="tpld-tool-btn" title="Import template from JSON" onClick={importTemplate} disabled={!isTauri}><Upload size={14} strokeWidth={2} /></button>
        </div>
        <div className="tpld-size-group">
          <select className="field-input" style={{ width: 150, flexShrink: 0 }} value="" onChange={(e) => {
            const preset = CANVAS_SIZE_PRESETS.find((p) => p.label === e.target.value);
            if (preset) doResize(widgetId, preset.w, preset.h);
          }}>
            <option value="">Canvas size…</option>
            {CANVAS_SIZE_PRESETS.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
          </select>
          <label>W <input type="number" className="field-input" style={{ width: 70, flexShrink: 0 }} value={widget.w} onChange={(e) => doResize(widgetId, Math.max(40, Number(e.target.value) || widget.w), widget.h)} /></label>
          <label>H <input type="number" className="field-input" style={{ width: 70, flexShrink: 0 }} value={widget.h} onChange={(e) => doResize(widgetId, widget.w, Math.max(40, Number(e.target.value) || widget.h))} /></label>
          <div className="tpld-zoom-group">
            <button className="tpld-tool-btn" title="Zoom out" onClick={() => setZoom((z) => nearestScalePreset(z, -1))}><Minus size={12} strokeWidth={2} /></button>
            <button className="tpld-tool-btn" title="Fit to view" onClick={fitZoom}><Maximize size={12} strokeWidth={2} /> {Math.round(zoom * 100)}%</button>
            <button className="tpld-tool-btn" title="Zoom in" onClick={() => setZoom((z) => nearestScalePreset(z, 1))}><PlusIcon size={12} strokeWidth={2} /></button>
          </div>
          <div className="tpld-zoom-group">
            <button className={`tpld-tool-btn${timeUnit === 'seconds' ? ' tpld-tool-btn--active' : ''}`} title="Show/edit timing in seconds" onClick={() => setTimeUnit('seconds')}>Sec</button>
            <button className={`tpld-tool-btn${timeUnit === 'frames' ? ' tpld-tool-btn--active' : ''}`} title="Show/edit timing in frames" onClick={() => setTimeUnit('frames')}>Frames</button>
            {timeUnit === 'frames' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                fps <input type="number" min={1} max={240} className="field-input" style={{ width: 44 }}
                  value={timelineFps} onChange={(e) => setConfig(widgetId, { timelineFps: Math.max(1, Number(e.target.value) || timelineFps) })} />
              </label>
            )}
          </div>
        </div>
        <button className="tpld-close" onClick={onClose}><X size={18} strokeWidth={2} /></button>
      </div>

      <div className="tpld-state-bar">
        <button className={`tpld-state-tab${activeState === STATE_TAB_IN.id ? ' tpld-state-tab--active' : ''}`} onClick={() => setActiveState(STATE_TAB_IN.id)}>
          {STATE_TAB_IN.label}
        </button>

        {steps.map((step) => (
          <StepTab
            key={step.id}
            step={step}
            active={activeState === step.id}
            renaming={renamingId === step.id}
            onSelect={() => setActiveState(step.id)}
            onStartRename={() => setRenamingId(step.id)}
            onCommitRename={(name) => { setRenamingId(null); const trimmed = name.trim(); if (trimmed) renameStep(step.id, trimmed); }}
            onCancelRename={() => setRenamingId(null)}
            onMoveLeft={() => moveStepLeft(step.id)}
            onMoveRight={() => moveStepRight(step.id)}
            onDelete={() => deleteStep(step.id)}
            canMoveLeft={steps.indexOf(step) > 0}
            canMoveRight={steps.indexOf(step) < steps.length - 1}
          />
        ))}
        <button className="tpld-tool-btn" title="Add a Step between In and Loop" onClick={addStep}><PlusIcon size={12} strokeWidth={2} /> Step</button>

        {STATE_TABS_AFTER_STEPS.map((t) => (
          <button key={t.id} className={`tpld-state-tab${activeState === t.id ? ' tpld-state-tab--active' : ''}`} onClick={() => setActiveState(t.id)}>
            {t.label}
          </button>
        ))}

        {(activeStep || activeState === STATE_TAB_IN.id) && (
          <div className="tpld-toolbar-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
              Advance
              <select className="field-input" value={currentState.advanceMode ?? 'auto'} onChange={(e) => commitState({ ...currentState, advanceMode: e.target.value as 'auto' | 'manual' })}>
                <option value="manual">Manual (Next Stage)</option>
                <option value="auto">Auto</option>
              </select>
            </label>
            {(currentState.advanceMode ?? 'auto') === 'auto' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                after (ms)
                <input type="number" min={0} step={100} className="field-input" style={{ width: 64 }}
                  value={currentState.autoAdvanceMs ?? 0} onChange={(e) => commitState({ ...currentState, autoAdvanceMs: Math.max(0, Number(e.target.value) || 0) })} />
              </label>
            )}
          </div>
        )}

        <div className="tpld-toolbar-group">
          <button className="tpld-tool-btn" title="Undo (Ctrl/Cmd+Z)" onClick={undo} disabled={!past.length}><Undo2 size={13} strokeWidth={2} /></button>
          <button className="tpld-tool-btn" title="Redo (Ctrl/Cmd+Shift+Z)" onClick={redo} disabled={!future.length}><Redo2 size={13} strokeWidth={2} /></button>
        </div>

        <div className="tpld-toolbar-group">
          <button className={`tpld-tool-btn${snapEnabled ? ' tpld-tool-btn--active' : ''}`} title="Snap to grid" onClick={() => setSnapEnabled((v) => !v)}><Magnet size={13} strokeWidth={2} /></button>
          <button className={`tpld-tool-btn${showGrid ? ' tpld-tool-btn--active' : ''}`} title="Show grid" onClick={() => setShowGrid((v) => !v)}><Grid3x3 size={13} strokeWidth={2} /></button>
          <button className={`tpld-tool-btn${smartSnapEnabled ? ' tpld-tool-btn--active' : ''}`} title="Snap to guides — center/edge alignment against other elements and the canvas itself" onClick={() => setSmartSnapEnabled((v) => !v)}><Crosshair size={13} strokeWidth={2} /></button>
          <button className={`tpld-tool-btn${showSafeArea ? ' tpld-tool-btn--active' : ''}`} title="Safe area guide (90% action-safe / 80% title-safe) — a visual aid only, never part of the actual output" onClick={() => setShowSafeArea((v) => !v)}><Frame size={13} strokeWidth={2} /></button>
          <button className={`tpld-tool-btn${snapSoundEnabled ? ' tpld-tool-btn--active' : ''}`} title="Play a sound when snapping to a guide" onClick={() => setSnapSoundEnabled((v) => !v)}>
            {snapSoundEnabled ? <Volume2 size={13} strokeWidth={2} /> : <VolumeX size={13} strokeWidth={2} />}
          </button>
          {snapSoundEnabled && (
            <select className="field-input" style={{ width: 90, flexShrink: 0 }} value={snapSoundId} onChange={(e) => { setSnapSoundId(e.target.value); playSfx(e.target.value, 0.5); }} title="Which sound plays on snap">
              {SFX_LIBRARY.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          )}
        </div>

        <div className="tpld-toolbar-group" title="Reference background — a visual aid only while designing (e.g. previewing over a sample video frame), never saved into the template or shown on the real output">
          <button className={`tpld-tool-btn${referenceBg.type === 'transparent' ? ' tpld-tool-btn--active' : ''}`} onClick={() => setReferenceBg({ type: 'transparent' })}>Transparent</button>
          <button className={`tpld-tool-btn${referenceBg.type === 'color' ? ' tpld-tool-btn--active' : ''}`} onClick={() => setReferenceBg({ type: 'color' })}>Color</button>
          {referenceBg.type === 'color' && (
            <ColorPicker value={referenceBg.color ?? '#1a1a1a'} onChange={(v) => setReferenceBg({ type: 'color', color: v })} title="Reference background color" />
          )}
          <button className={`tpld-tool-btn${referenceBg.type === 'image' ? ' tpld-tool-btn--active' : ''}`} onClick={() => setReferenceBg({ type: 'image' })}>Image</button>
          {referenceBg.type === 'image' && (
            <LogoUrlPicker compact thumbSize={{ w: 26, h: 18 }} value={referenceBg.imageUrl ?? ''} onChange={(url) => setReferenceBg({ type: 'image', imageUrl: url })} />
          )}
        </div>

        <div className="tpld-toolbar-group" title="The workspace area OUTSIDE the canvas bounds — same visual-aid-only rule as the canvas's own reference background above">
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Outside</span>
          <button className={`tpld-tool-btn${referenceBgOutside === 'solid' ? ' tpld-tool-btn--active' : ''}`} onClick={() => setReferenceBgOutside('solid')}>Solid</button>
          <button className={`tpld-tool-btn${referenceBgOutside === 'transparent' ? ' tpld-tool-btn--active' : ''}`} onClick={() => setReferenceBgOutside('transparent')}>Transparent</button>
        </div>

        <div className="tpld-toolbar-group">
          <button className="tpld-tool-btn" title="Align left" disabled={!selected} onClick={() => alignElement('left')}><AlignHorizontalJustifyStart size={13} strokeWidth={2} /></button>
          <button className="tpld-tool-btn" title="Center horizontally" disabled={!selected} onClick={() => alignElement('centerX')}><AlignHorizontalJustifyCenter size={13} strokeWidth={2} /></button>
          <button className="tpld-tool-btn" title="Align right" disabled={!selected} onClick={() => alignElement('right')}><AlignHorizontalJustifyEnd size={13} strokeWidth={2} /></button>
          <button className="tpld-tool-btn" title="Align top" disabled={!selected} onClick={() => alignElement('top')}><AlignVerticalJustifyStart size={13} strokeWidth={2} /></button>
          <button className="tpld-tool-btn" title="Center vertically" disabled={!selected} onClick={() => alignElement('centerY')}><AlignVerticalJustifyCenter size={13} strokeWidth={2} /></button>
          <button className="tpld-tool-btn" title="Align bottom" disabled={!selected} onClick={() => alignElement('bottom')}><AlignVerticalJustifyEnd size={13} strokeWidth={2} /></button>
        </div>

        <div className="tpld-preview-group">
          <button className="cgo-copy-btn" onClick={() => previewState('in')}><Play size={12} strokeWidth={2} /> In</button>
          {activeStep && (
            <button className="cgo-copy-btn" onClick={() => previewState(activeStep.id)}><Play size={12} strokeWidth={2} /> {activeStep.name}</button>
          )}
          <button className="cgo-copy-btn" onClick={() => previewState('out')}><Play size={12} strokeWidth={2} /> Out</button>
          <button className="cgo-copy-btn" onClick={previewAll}><Play size={12} strokeWidth={2} /> All</button>
          {previewManualStep && (
            <button className="cgo-copy-btn" title="Advance past this manual Step, same as the real Next Stage button" onClick={() => previewAdvanceRef.current?.()}>
              <SkipForward size={12} strokeWidth={2} /> Next Step
            </button>
          )}
          <button className="cgo-copy-btn" onClick={stopPreview} disabled={!previewing}><Octagon size={12} strokeWidth={2} /> Stop</button>
        </div>
      </div>

      <div className="tpld-body">
        <LayersPanel
          elements={elements}
          selectedId={localSelectedId}
          multiSelectedIds={multiSelectedIds}
          hiddenIds={hiddenIds}
          renamingId={renamingId}
          onSelectRow={(id, mods) => {
            if (mods.metaKey || mods.ctrlKey) {
              setMultiSelectedIds((prev) => {
                const next = new Set(prev);
                if (localSelectedId && !next.has(localSelectedId)) next.add(localSelectedId);
                if (next.has(id)) next.delete(id); else next.add(id);
                return next;
              });
              setLocalSelectedId(id);
            } else {
              setMultiSelectedIds(new Set());
              setLocalSelectedId(id);
            }
          }}
          onToggleHidden={toggleHidden}
          onStartRename={setRenamingId}
          onCommitRename={renameElement}
          onCancelRename={() => setRenamingId(null)}
          onMoveUp={moveElementUp}
          onMoveDown={moveElementDown}
          onDuplicate={duplicateElement}
          onDelete={deleteElement}
          draggingLayerId={draggingLayerId}
          dragOverRow={dragOverRow}
          onDragStartRow={setDraggingLayerId}
          onDragOverRow={setDragOverRow}
          onDropRow={(draggedId, targetId, pos) => { reorderOrReparentElement(draggedId, targetId, pos); setDraggingLayerId(null); setDragOverRow(null); }}
          onDragEndRow={() => { setDraggingLayerId(null); setDragOverRow(null); }}
          onGroup={() => groupElements(multiSelectedIds.size >= 2 ? [...multiSelectedIds] : [])}
          onUngroup={() => { if (localSelectedId) ungroupElement(localSelectedId); }}
          onBringToFront={() => moveSelectionToEdge(multiSelectedIds.size > 0 ? multiSelectedIds : localSelectedId ? new Set([localSelectedId]) : new Set(), true)}
          onSendToBack={() => moveSelectionToEdge(multiSelectedIds.size > 0 ? multiSelectedIds : localSelectedId ? new Set([localSelectedId]) : new Set(), false)}
        />

        <div
          className="tpld-canvas-wrap"
          ref={wrapRef}
          onClick={() => setLocalSelectedId(null)}
          style={referenceBgOutside === 'solid' ? { background: 'var(--bg-1)' } : undefined}
        >
          <div style={{ width: widget.w * zoom, height: widget.h * zoom, flexShrink: 0 }}>
            <div className="tpld-canvas" style={{
              width: widget.w, height: widget.h,
              transform: `scale(${zoom})`,
              transformOrigin: 'top left',
              ...referenceBgStyle,
            }}>
              {showGrid && <div className="tpld-grid-overlay" />}
              {showSafeArea && (
                <div className="tpld-safe-area-overlay">
                  <div className="tpld-safe-area-box tpld-safe-area-box--action" />
                  <span className="tpld-safe-area-label tpld-safe-area-label--action">Action Safe (90%)</span>
                  <div className="tpld-safe-area-box tpld-safe-area-box--title" />
                  <span className="tpld-safe-area-label tpld-safe-area-label--title">Title Safe (80%)</span>
                </div>
              )}
              {activeGuides.vLines.map((v) => <div key={`v${v}`} className="tpld-smart-guide tpld-smart-guide--v" style={{ left: v }} />)}
              {activeGuides.hLines.map((h) => <div key={`h${h}`} className="tpld-smart-guide tpld-smart-guide--h" style={{ top: h }} />)}
              {(maskIds.length > 0 || flagWaveEls.length > 0 || bevelEls.length > 0 || innerShadowEls.length > 0 || rampBlurEls.length > 0 || waveWarpEls.length > 0 || gooeyEls.length > 0) && (
                <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
                  <defs>
                    {maskIds.map((maskId) => {
                      const shape = elements.find((e) => e.id === maskId && e.kind === 'shape');
                      if (!shape) return null;
                      return (
                        <clipPath key={maskId} id={`${instanceId}-mask-${maskId}`} clipPathUnits="objectBoundingBox">
                          <path d={scalePathToUnitBox(shape.config.d ?? '', shape.w, shape.h)} />
                        </clipPath>
                      );
                    })}
                    {flagWaveEls.map((el) => {
                      const fx = findFlagWave(el.config.effects)!;
                      const p = buildFlagWaveFilterProps(fx);
                      const entry = (flagWaveRefs.current[el.id] ??= { turbulence: null, light: null });
                      return (
                        <filter key={el.id} id={`${instanceId}-flagwave-${el.id}`} x="-20%" y="-20%" width="140%" height="140%">
                          <feTurbulence ref={(node) => { entry.turbulence = node; }} type="fractalNoise" baseFrequency={p.baseFrequency} numOctaves={2} seed={7} result="turbulence" />
                          <feDisplacementMap in="SourceGraphic" in2="turbulence" scale={p.scale} xChannelSelector="R" yChannelSelector="G" result="displaced" />
                          <feDiffuseLighting in="turbulence" lightingColor="#ffffff" surfaceScale={p.surfaceScale} diffuseConstant={1} result="light">
                            <feDistantLight ref={(node) => { entry.light = node; }} azimuth={p.azimuth} elevation={60} />
                          </feDiffuseLighting>
                          <feComposite in="light" in2="SourceAlpha" operator="in" result="lightMasked" />
                          <feBlend in="displaced" in2="lightMasked" mode="multiply" />
                        </filter>
                      );
                    })}
                    {bevelEls.map((el) => {
                      const fx = findBevel(el.config.effects)!;
                      const p = buildBevelFilterProps(fx);
                      return (
                        // See CgTemplateWidget.tsx's identical filter's own
                        // long comment for why colorInterpolationFilters
                        // and the highlight/shadow/spec normalization below
                        // both exist — without them a flat area's own
                        // baseline lighting washes out the WHOLE shape
                        // instead of just its edges.
                        <filter key={el.id} id={`${instanceId}-bevel-${el.id}`} x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
                          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="alphaMap" />
                          {p.edgeOnly && <feMorphology in="alphaMap" operator="erode" radius={p.ringWidth} result="eroded" />}
                          {p.edgeOnly && <feComposite in="alphaMap" in2="eroded" operator="out" result="alphaMap" />}
                          <feGaussianBlur in="alphaMap" stdDeviation={p.softness} result="bump" />
                          <feDiffuseLighting in="bump" surfaceScale={p.surfaceScale} diffuseConstant={1} lightingColor="#ffffff" result="diffuse">
                            <feDistantLight azimuth={p.azimuth} elevation={p.elevation} />
                          </feDiffuseLighting>
                          <feComponentTransfer in="diffuse" result="highlight">
                            <feFuncR type="linear" slope="1" intercept={-p.diffuseBaseline} />
                            <feFuncG type="linear" slope="1" intercept={-p.diffuseBaseline} />
                            <feFuncB type="linear" slope="1" intercept={-p.diffuseBaseline} />
                          </feComponentTransfer>
                          <feComponentTransfer in="diffuse" result="shadowRaw">
                            <feFuncR type="linear" slope="-1" intercept={p.diffuseBaseline} />
                            <feFuncG type="linear" slope="-1" intercept={p.diffuseBaseline} />
                            <feFuncB type="linear" slope="-1" intercept={p.diffuseBaseline} />
                          </feComponentTransfer>
                          <feSpecularLighting in="bump" surfaceScale={p.surfaceScale} specularConstant={0.6} specularExponent={p.shininess} lightingColor="#ffffff" result="spec">
                            <feDistantLight azimuth={p.azimuth} elevation={p.elevation} />
                          </feSpecularLighting>
                          <feComponentTransfer in="spec" result="specNorm">
                            <feFuncR type="linear" slope="1" intercept={-p.specBaseline} />
                            <feFuncG type="linear" slope="1" intercept={-p.specBaseline} />
                            <feFuncB type="linear" slope="1" intercept={-p.specBaseline} />
                          </feComponentTransfer>
                          <feComposite in="specNorm" in2="SourceAlpha" operator="in" result="specClipped" />
                          <feBlend in="highlight" in2="specClipped" mode="screen" result="highlightPlusSpec" />
                          <feComposite in="highlightPlusSpec" in2="SourceAlpha" operator="in" result="litClipped" />
                          <feComposite in="shadowRaw" in2="SourceAlpha" operator="in" result="shadowClipped" />
                          <feComponentTransfer in="shadowClipped" result="shadowInverted">
                            <feFuncR type="linear" slope="-1" intercept="1" />
                            <feFuncG type="linear" slope="-1" intercept="1" />
                            <feFuncB type="linear" slope="-1" intercept="1" />
                          </feComponentTransfer>
                          <feBlend in="SourceGraphic" in2="litClipped" mode="screen" result="withHighlight" />
                          <feBlend in="withHighlight" in2="shadowInverted" mode="multiply" />
                        </filter>
                      );
                    })}
                    {innerShadowEls.map((el) => {
                      const fx = findInnerShadow(el.config.effects)!;
                      const p = buildInnerShadowFilterProps(fx);
                      return (
                        <filter key={el.id} id={`${instanceId}-innershadow-${el.id}`} x="-30%" y="-30%" width="160%" height="160%">
                          <feComponentTransfer in="SourceAlpha" result="invertedAlpha">
                            <feFuncA type="table" tableValues="1 0" />
                          </feComponentTransfer>
                          <feOffset in="invertedAlpha" dx={p.offsetX} dy={p.offsetY} result="offsetInverted" />
                          <feGaussianBlur in="offsetInverted" stdDeviation={p.blur} result="blurredInverted" />
                          <feComposite in="blurredInverted" in2="SourceAlpha" operator="in" result="innerShadowAlpha" />
                          <feFlood floodColor={p.color} floodOpacity={p.opacity} result="shadowColor" />
                          <feComposite in="shadowColor" in2="innerShadowAlpha" operator="in" result="coloredInnerShadow" />
                          <feComposite in="coloredInnerShadow" in2="SourceGraphic" operator="over" />
                        </filter>
                      );
                    })}
                    {rampBlurEls.map((el) => {
                      const fx = findRampBlur(el.config.effects)!;
                      const p = buildRampBlurFilterProps(fx);
                      const maskSvg = buildRampMaskSvg(el.w, el.h, p.angle);
                      return (
                        <filter key={el.id} id={`${instanceId}-rampblur-${el.id}`} x="0%" y="0%" width="100%" height="100%">
                          <feImage href={`data:image/svg+xml,${encodeURIComponent(maskSvg)}`} x="0" y="0" width={el.w} height={el.h} result="rampMask" />
                          <feGaussianBlur in="SourceGraphic" stdDeviation={p.blur} result="blurred" />
                          <feComposite in="blurred" in2="rampMask" operator="in" result="blurredMasked" />
                          <feComposite in="blurredMasked" in2="SourceGraphic" operator="over" />
                        </filter>
                      );
                    })}
                    {waveWarpEls.map((el) => {
                      const fx = findWaveWarp(el.config.effects)!;
                      const p = buildWaveWarpFilterProps(fx);
                      const entry = (waveWarpRefs.current[el.id] ??= { offset: null });
                      const isNoise = p.waveType === 'noise' || p.waveType === 'smoothNoise';
                      const pad = waveWarpMapPad(el.w, el.h);
                      const mapSvg = isNoise ? null : buildWaveWarpMapSvg(p.waveType, p.wavelength, p.angleDeg, p.antiAlias, el.w, el.h);
                      const pinMaskSvg = p.pinning === 'none' ? null : buildWaveWarpPinMaskSvg(p.pinning, el.w, el.h);
                      return (
                        <filter key={el.id} id={`${instanceId}-wavewarp-${el.id}`} x="-60%" y="-60%" width="220%" height="220%">
                          {isNoise ? (
                            <feTurbulence type={p.waveType === 'noise' ? 'fractalNoise' : 'turbulence'} baseFrequency={p.baseFrequency} numOctaves={2} seed={11} stitchTiles="stitch" result="wavefield" />
                          ) : (
                            <feImage href={`data:image/svg+xml,${encodeURIComponent(mapSvg!)}`} x={-pad} y={-pad} width={el.w + pad * 2} height={el.h + pad * 2} result="wavefield" />
                          )}
                          <feOffset ref={(node) => { entry.offset = node; }} in="wavefield" dx={0} dy={0} result="offsetfield" />
                          <feDisplacementMap in="SourceGraphic" in2="offsetfield" scale={p.scale} xChannelSelector="R" yChannelSelector="G" result={pinMaskSvg ? 'displaced' : undefined} />
                          {pinMaskSvg && (
                            <>
                              <feImage href={`data:image/svg+xml,${encodeURIComponent(pinMaskSvg)}`} x="0" y="0" width={el.w} height={el.h} result="pinMaskImg" />
                              <feColorMatrix in="pinMaskImg" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="pinAlpha" />
                              <feComposite in="displaced" in2="pinAlpha" operator="in" result="displacedPinned" />
                              <feComposite in="SourceGraphic" in2="pinAlpha" operator="out" result="sourcePinned" />
                              <feMerge>
                                <feMergeNode in="sourcePinned" />
                                <feMergeNode in="displacedPinned" />
                              </feMerge>
                            </>
                          )}
                        </filter>
                      );
                    })}
                    {/* x/y/width/height widen the filter's own default
                       region — see CgTemplateWidget.tsx's identical block
                       for why a typical text box's own tight default
                       margin clips this preset's own (up to 100px) blur
                       away to nothing instead of letting it melt. */}
                    {gooeyEls.map((el) => (
                      <filter key={el.id} id={`${instanceId}-gooey-${el.id}`} x="-150%" y="-150%" width="400%" height="400%">
                        <feColorMatrix in="SourceGraphic" type="matrix" values={GOOEY_THRESHOLD_MATRIX} />
                      </filter>
                    ))}
                  </defs>
                </svg>
              )}
              {renderElementTree(undefined, undefined)}
              {penActive && (
                <div ref={penOverlayRef} className="tpld-pen-overlay" onClick={handlePenCanvasClick} onDoubleClick={finishPen}>
                  <svg width={widget.w} height={widget.h} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                    {penPoints.length > 1 && <polyline points={penPoints.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth={1.5} />}
                    {penPoints.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={4} fill={i === 0 ? '#ff8800' : 'var(--accent)'} />)}
                  </svg>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="tpld-inspector">
          {!selected ? (
            <div className="tpld-inspector-empty">Select an element, or add one from the toolbar.</div>
          ) : (
            <>
              <ElementInspector
                el={selected}
                elements={elements}
                otherWidgets={otherWidgets}
                onConfigChange={(patch) => updateElementConfig(selected.id, patch)}
                onBindingChange={(b) => setBinding(selected.id, b)}
                onConditionsChange={(c) => setConditions(selected.id, c)}
                onReplaceFrames={() => importSequence(selected.id)}
                onSetParent={(parentId) => updateElement(selected.id, { parentId })}
                onSetMask={(maskId) => updateElement(selected.id, { maskId })}
                onSetMatchRole={(matchRole) => updateElement(selected.id, { matchRole })}
                onSetStandingsRole={(standingsRole) => updateElement(selected.id, { standingsRole })}
                onSetBracketRole={(bracketRole) => updateElement(selected.id, { bracketRole })}
                onChangeAnimChange={(changeAnim) => updateElement(selected.id, { changeAnim })}
                onPositionChange={(x, y) => updateElement(selected.id, { x, y })}
                libraryWidgets={libraryPages[0]?.widgets ?? []}
                onEditCardTemplate={setEditingCardTemplateId}
                onNewCardTemplate={() => { addLibraryWidget('cg-template'); return useCanvasStore.getState().librarySelectedWidgetId!; }}
              />

              <div className="tpld-fields" style={{ marginTop: 14 }}>
                <div className="tpld-fields-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>{selected.kind === 'sound' ? 'Sound Effect' : 'Animation'} — {activeStep ? activeStep.name : activeState === STATE_TAB_IN.id ? STATE_TAB_IN.label : STATE_TABS_AFTER_STEPS.find((t) => t.id === activeState)?.label}</span>
                  {hasAnim && (
                    <button className="cgo-copy-btn" title={selected.kind === 'sound' ? 'Removes this sound cue from this state entirely' : 'Removes this element\'s preset AND every keyframe track for this state — its per-property keyframe TRACKS still stay editable independently below without this, this is only for clearing everything at once'} onClick={removeAnimation}>
                      <X size={11} strokeWidth={2} /> Remove
                    </button>
                  )}
                </div>

                {!hasAnim ? (
                  <div className="field-row">
                    <button className="cgo-copy-btn" onClick={addAnimation}><PlusIcon size={12} strokeWidth={2} /> {selected.kind === 'sound' ? 'Add to this state' : 'Add Animation'}</button>
                  </div>
                ) : selected.kind === 'sound' ? (
                  <>
                    <p className="app-settings-hint" style={{ margin: '0 0 8px' }}>
                      Plays once, right as this state's own timeline reaches "Play at" — audible on the real output, not just here. The same sound layer can play at a different moment (or a different sound) in each state it's added to.
                    </p>
                    <div className="field-row">
                      <label className="field-label">Sound</label>
                      <select className="field-input" value={selectedAnim!.sfxId ?? ''} onChange={(e) => updateSelectedAnim({ sfxId: e.target.value || undefined })}>
                        <option value="">No sound</option>
                        {SFX_LIBRARY.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                      {selectedAnim!.sfxId && (
                        <button className="tplt-track-reverse" title="Preview this sound" onClick={() => playSfx(selectedAnim!.sfxId, selectedAnim!.sfxVolume)}>▶</button>
                      )}
                    </div>
                    <div className="field-row">
                      <label className="field-label">Volume</label>
                      <input className="field-input" type="number" min={0} max={1} step={0.05}
                        value={selectedAnim!.sfxVolume ?? 1}
                        onChange={(e) => updateSelectedAnim({ sfxVolume: Math.max(0, Math.min(1, Number(e.target.value))) })} />
                    </div>
                    <div className="field-row">
                      <label className="field-label">Play at ({timeUnitLabel})</label>
                      <input className="field-input" type="number" min={0} step={timeUnit === 'frames' ? 1 : 0.05}
                        value={toDisplayTime(selectedAnim!.delay ?? 0)}
                        onChange={(e) => updateSelectedAnim({ delay: fromDisplayTime(Number(e.target.value)) })} />
                    </div>
                  </>
                ) : (
                  <>
                    <p className="app-settings-hint" style={{ margin: '0 0 8px' }}>
                      A preset and hand-tuned keyframe tracks work independently and can be combined — pick a preset here for the broad motion, and/or add per-property tracks in the timeline below for anything the preset doesn't cover.
                    </p>
                    <div className="field-row">
                      <label className="field-label">Preset</label>
                      <select className="field-input" value={selectedAnim!.preset ?? 'none'} onChange={(e) => applyPreset(e.target.value)}>
                        {Object.keys(presetLib).map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    {(selectedAnim!.preset ?? 'none') !== 'none' && (
                      <>
                        <div className="field-row">
                          <label className="field-label">Duration ({timeUnitLabel})</label>
                          <input className="field-input" type="number" min={0} step={timeUnit === 'frames' ? 1 : 0.05}
                            value={toDisplayTime(selectedAnim!.duration ?? 0.5)}
                            onChange={(e) => updateSelectedAnim({ duration: fromDisplayTime(Number(e.target.value)) })} />
                        </div>
                        <div className="field-row">
                          <label className="field-label">Delay ({timeUnitLabel})</label>
                          <input className="field-input" type="number" min={0} step={timeUnit === 'frames' ? 1 : 0.05}
                            value={toDisplayTime(selectedAnim!.delay ?? 0)}
                            onChange={(e) => updateSelectedAnim({ delay: fromDisplayTime(Number(e.target.value)) })} />
                        </div>
                        <div className="field-row">
                          <label className="field-label">Ease</label>
                          <select className="field-input" value={parseBezierEase(selectedAnim!.ease) ? 'custom' : (selectedAnim!.ease ?? 'power2.out')}
                            onChange={(e) => {
                              if (e.target.value === 'custom') {
                                const seed = parseBezierEase(selectedAnim!.ease) ?? [0.25, 0.1, 0.25, 1] as [number, number, number, number];
                                updateSelectedAnim({ ease: bezierEaseString(...seed) });
                              } else {
                                updateSelectedAnim({ ease: e.target.value });
                              }
                            }}>
                            {EASES.map((e2) => <option key={e2} value={e2}>{e2}</option>)}
                            <option value="custom">Custom curve…</option>
                          </select>
                        </div>
                        {parseBezierEase(selectedAnim!.ease) && (
                          <div className="field-row">
                            <label className="field-label" />
                            <EaseCurveEditor value={parseBezierEase(selectedAnim!.ease)!} onChange={(v) => updateSelectedAnim({ ease: bezierEaseString(...v) })} />
                          </div>
                        )}
                        {!presetLib[selectedAnim!.preset ?? '']?._type && (
                          <div className="field-row">
                            <label className="field-label" title="Plays this exact preset as if time itself ran backward — the ease inverts too, not just the positions, so the motion genuinely looks reversed rather than just 'the opposite preset' (reversing Slide Left doesn't become Slide Right — it makes this reveal look like it's playing in rewind).">Reverse</label>
                            <input type="checkbox" checked={!!selectedAnim!.reversed} onChange={(e) => updateSelectedAnim({ reversed: e.target.checked || undefined })} />
                          </div>
                        )}
                      </>
                    )}
                    <div className="field-row">
                      <label className="field-label">Transform Origin</label>
                      <input className="field-input" placeholder="e.g. left center" value={selectedAnim!.transformOrigin ?? ''} onChange={(e) => updateSelectedAnim({ transformOrigin: e.target.value })} />
                    </div>
                    {selectedAnim!.preset === 'morph' && selected.kind === 'shape' && (
                      <>
                        <div className="field-row">
                          <label className="field-label">Morph to</label>
                          <select className="field-input" value="" onChange={(e) => { const d = SHAPE_LIBRARY[e.target.value]; if (d) updateSelectedAnim({ morphTo: d }); }}>
                            <option value="">Pick from library…</option>
                            {Object.keys(SHAPE_LIBRARY).map((name) => <option key={name} value={name}>{name}</option>)}
                          </select>
                        </div>
                        <div className="field-row">
                          <label className="field-label">Target path (SVG d)</label>
                          <textarea className="field-input" rows={3} value={selectedAnim!.morphTo ?? ''} onChange={(e) => updateSelectedAnim({ morphTo: e.target.value })} placeholder="Paste a custom target SVG path 'd'…" />
                        </div>
                      </>
                    )}
                    {selectedAnim!.preset === 'wordSequence' && selected.kind === 'text' && (
                      <WordSequenceFields
                        items={selected.config.wordSequence ?? []}
                        onChange={(items) => updateElementConfig(selected.id, { wordSequence: items })}
                      />
                    )}
                    {selectedAnim!.preset === 'textReveal' && selected.kind === 'text' && (
                      <>
                        <div className="tpld-fields-label" style={{ marginTop: 10 }} title="Splits this element's own text into individually-animated units, each staggered one after another — the classic 'SplitText' reveal. Applies to whichever states/steps also have their own Preset set to 'Text Reveal' — same text-splitting/style, just each gets its own timing on this element.">Text Reveal</div>
                        <div className="field-row">
                          <label className="field-label">Unit</label>
                          <select className="field-input" value={selected.config.textRevealUnit ?? 'character'} onChange={(e) => updateElementConfig(selected.id, { textRevealUnit: e.target.value })}>
                            <option value="character">Character</option>
                            <option value="word">Word</option>
                            <option value="sentence">Sentence</option>
                          </select>
                        </div>
                        <div className="field-row">
                          <label className="field-label">Style</label>
                          <select
                            className="field-input"
                            value={selected.config.textRevealStyle ?? 'fadeUp'}
                            onChange={(e) => {
                              const styleKey = e.target.value;
                              const defaultEase = TEXT_REVEAL_DEFAULT_EASE[styleKey];
                              updateElementConfig(selected.id, defaultEase ? { textRevealStyle: styleKey, textRevealEase: defaultEase } : { textRevealStyle: styleKey });
                            }}
                          >
                            {Object.entries(TEXT_REVEAL_STYLES).map(([key, def]) => <option key={key} value={key}>{def.label}</option>)}
                          </select>
                        </div>
                        {TEXT_REVEAL_STYLES[selected.config.textRevealStyle ?? 'fadeUp']?.loop ? (
                          <p className="app-settings-hint" style={{ margin: '4px 0 8px' }}>
                            Continuous — plays for as long as this element is on screen, independent of Duration/Stagger below. Best used on the Loop state, not In/Out.
                          </p>
                        ) : (
                          <>
                            <div className="field-row" title="Seconds between each unit's own animation starting — a small value reads as a fast cascade, a large one as a slow build.">
                              <label className="field-label">Stagger (s)</label>
                              <input className="field-input" type="number" min={0} step={0.01} value={selected.config.textRevealStagger ?? 0.05} onChange={(e) => updateElementConfig(selected.id, { textRevealStagger: Math.max(0, Number(e.target.value) || 0) })} />
                            </div>
                            <div className="field-row" title="How long each unit's own animation takes.">
                              <label className="field-label">Duration (s)</label>
                              <input className="field-input" type="number" min={0.05} step={0.05} value={selected.config.textRevealDuration ?? 0.6} onChange={(e) => updateElementConfig(selected.id, { textRevealDuration: Math.max(0.05, Number(e.target.value) || 0.05) })} />
                            </div>
                            <div className="field-row">
                              <label className="field-label">Ease</label>
                              <select className="field-input" value={selected.config.textRevealEase ?? 'power2.out'} onChange={(e) => updateElementConfig(selected.id, { textRevealEase: e.target.value })}>
                                {EASES.map((ease) => <option key={ease} value={ease}>{ease}</option>)}
                              </select>
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </>
                )}

              </div>

              {/* AE-style unified property list — every Transform property
                 (always shown) plus this element's own Effects, each with
                 its own stopwatch to toggle keyframing right there, instead
                 of a bare "edit tracks in the timeline below" tip. Shown
                 regardless of Mode: a Preset-mode layer's stopwatch converts
                 it to Keyframes mode first (same expansion applyPreset
                 itself uses), so switching to fine per-property control
                 never requires manually flipping Mode first. A 'sound'
                 layer has no transform/effects of its own (no DOM node at
                 all — see cgAnimationEngine.ts's buildOneTimeline) so this
                 whole panel is meaningless for it and skipped entirely. */}
              {selected.kind !== 'sound' && (
                <ElementPropertiesPanel
                  el={selected}
                  currentState={currentState}
                  selectedAnim={selectedAnim}
                  presetLib={presetLib}
                  isOut={activeState === 'out'}
                  onChangeState={commitState}
                  onConfigChange={(patch) => updateElementConfig(selected.id, patch)}
                  getSeedValue={getSeedValue}
                  playhead={playhead}
                  selectedKf={selectedKf}
                  onSelectKeyframe={setSelectedKf}
                />
              )}

              {(selected.kind === 'text' || selected.kind === 'image') && (
                <div className="tpld-fields" style={{ marginTop: 14 }}>
                  <div className="tpld-fields-label">Content for this state</div>
                  {selected.kind === 'text' && (
                    <div className="field-row">
                      <label className="field-label">Text</label>
                      <input
                        className="field-input"
                        placeholder="(same as previous state)"
                        value={selectedAnim?.contentOverride?.text ?? ''}
                        onChange={(e) => updateContentOverride({ text: e.target.value || undefined })}
                      />
                      {selectedAnim?.contentOverride?.text !== undefined && (
                        <button className="tpld-tool-btn" title="Clear override — use whatever the previous state left it as" onClick={() => updateContentOverride({ text: undefined })}>
                          <X size={12} strokeWidth={2} />
                        </button>
                      )}
                    </div>
                  )}
                  {selected.kind === 'image' && (
                    <div className="field-row">
                      <label className="field-label">Image</label>
                      <LogoUrlPicker value={selectedAnim?.contentOverride?.imageUrl ?? ''} onChange={(url) => updateContentOverride({ imageUrl: url || undefined })} placeholder="(same as previous state)" />
                      {selectedAnim?.contentOverride?.imageUrl !== undefined && (
                        <button className="tpld-tool-btn" title="Clear override — use whatever the previous state left it as" onClick={() => updateContentOverride({ imageUrl: undefined })}>
                          <X size={12} strokeWidth={2} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div
        className="tpld-timeline-resize-handle"
        onPointerDown={onTimelineResizeDown}
        onPointerMove={onTimelineResizeMove}
        onPointerUp={onTimelineResizeUp}
        title="Drag to resize the timeline panel"
      />
      <CgTemplateTimeline
        state={currentState}
        elements={elements}
        onChange={commitState}
        getSeedValue={getSeedValue}
        playhead={playhead}
        onScrub={scrub}
        fps={timelineFps}
        timeUnit={timeUnit}
        onDragStart={beginGesture}
        onDragEnd={endGesture}
        selectedKf={selectedKf}
        onSelectKeyframe={setSelectedKf}
        height={cgTimelinePanelHeight}
      />

      {pendingImport && (
        <ConfirmModal
          title="Import Template"
          message="Importing will replace this template's elements and animation. This can't be undone by closing the designer, but Ctrl/Cmd+Z will still undo it. Continue?"
          confirmLabel="Import"
          onCancel={() => setPendingImport(null)}
          onConfirm={confirmImport}
        />
      )}

      {editingCardTemplateId && (
        <CgTemplateDesigner
          widgetId={editingCardTemplateId}
          onClose={() => setEditingCardTemplateId(null)}
          nestedContext={{
            parentLabel: widget.label || 'Untitled',
            cardLabel: (libraryPages[0]?.widgets ?? []).find((w) => w.id === editingCardTemplateId)?.label || 'Untitled',
          }}
        />
      )}
    </div>
  );
}

// One Step tab in the state bar — same rename convention as the Layers
// panel (double-click, or here an explicit pencil since the tab itself is
// already a click target for selecting it), plus move-left/right (reorders
// within config.steps — Steps have no separate "z-order", their order IS
// playback order) and delete, shown only while this tab is the active one
// so the state bar doesn't get crowded with controls for every step at once.
function StepTab({ step, active, renaming, onSelect, onStartRename, onCommitRename, onCancelRename, onMoveLeft, onMoveRight, onDelete, canMoveLeft, canMoveRight }: {
  step: CgStepState;
  active: boolean;
  renaming: boolean;
  onSelect: () => void;
  onStartRename: () => void;
  onCommitRename: (name: string) => void;
  onCancelRename: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onDelete: () => void;
  canMoveLeft: boolean;
  canMoveRight: boolean;
}) {
  if (renaming) {
    return (
      <input
        className="tpld-step-rename"
        autoFocus
        defaultValue={step.name}
        onBlur={(e) => onCommitRename(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') { e.preventDefault(); onCancelRename(); }
        }}
      />
    );
  }
  return (
    <div className={`tpld-state-tab tpld-step-tab${active ? ' tpld-state-tab--active' : ''}`} onClick={onSelect}>
      <span onDoubleClick={(e) => { e.stopPropagation(); onStartRename(); }} title="Double-click to rename">{step.name}</span>
      {active && (
        <span className="tpld-step-tab-actions" onClick={(e) => e.stopPropagation()}>
          <button onClick={onMoveLeft} disabled={!canMoveLeft} title="Move earlier"><ChevronUp size={10} strokeWidth={2} style={{ transform: 'rotate(-90deg)' }} /></button>
          <button onClick={onMoveRight} disabled={!canMoveRight} title="Move later"><ChevronUp size={10} strokeWidth={2} style={{ transform: 'rotate(90deg)' }} /></button>
          <button onClick={onDelete} title="Delete step"><X size={10} strokeWidth={2} /></button>
        </span>
      )}
    </div>
  );
}

// Left-side layers palette — ported from gfx-studio-2's #layersList, with
// one difference: our element ids are opaque UUIDs (not hand-typed
// meaningful names), so rows show an editable `name` instead of the raw id.
// Z-order is BOTH explicit per-row up/down buttons (one sibling step) AND a
// drag-to-reorder/reparent gesture across the whole list — the drag is
// POINTER-EVENT-based (pointerdown/move/up + elementFromPoint), deliberately
// NOT the native HTML5 draggable/dragstart/dragover/drop API: that API is
// unreliable for in-page reordering inside a WKWebView (this app's actual
// desktop runtime on macOS) — dragstart/dragover often simply never fire
// there, which is exactly the "drag and drop doesn't work" symptom an
// earlier version of this panel had, working fine only in a plain Chromium
// tab. Pointer events have no such gap and are what every OTHER drag
// gesture in this app (canvas element dragging/resizing, gradient handles)
// already uses.
function LayersPanel({
  elements, selectedId, multiSelectedIds, hiddenIds, renamingId,
  onSelectRow, onToggleHidden, onStartRename, onCommitRename, onCancelRename,
  onMoveUp, onMoveDown, onDuplicate, onDelete,
  draggingLayerId, dragOverRow, onDragStartRow, onDragOverRow, onDropRow, onDragEndRow,
  onGroup, onUngroup, onBringToFront, onSendToBack,
}: {
  elements: TemplateElement[];
  selectedId: string | null;
  /** Ctrl/Cmd-click accumulated selection, Layers-panel-only — see
   *  CgTemplateDesigner.tsx's own doc comment on its `multiSelectedIds`
   *  state for why this is separate from `selectedId`. */
  multiSelectedIds: Set<string>;
  hiddenIds: Set<string>;
  renamingId: string | null;
  onSelectRow: (id: string, mods: { metaKey: boolean; ctrlKey: boolean }) => void;
  onToggleHidden: (id: string) => void;
  onStartRename: (id: string) => void;
  onCommitRename: (id: string, name: string) => void;
  onCancelRename: () => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  draggingLayerId: string | null;
  dragOverRow: { id: string; pos: 'above' | 'below' | 'inside' } | null;
  onDragStartRow: (id: string) => void;
  onDragOverRow: (v: { id: string; pos: 'above' | 'below' | 'inside' } | null) => void;
  onDropRow: (draggedId: string, targetId: string, pos: 'above' | 'below' | 'inside') => void;
  onDragEndRow: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  /** Jumps the WHOLE current selection (multi-select if any, else just the
   *  single active one) straight to the front/back of its own sibling
   *  stack in one step — see CgTemplateDesigner.tsx's own
   *  moveSelectionToEdge for the actual reorder. */
  onBringToFront: () => void;
  onSendToBack: () => void;
}) {
  // Top-of-stack first (last among its own siblings renders on top) —
  // matches how a layers palette visually reads, same convention
  // gfx-studio-2 uses (sorted by zIndex descending). Children are listed
  // immediately under their parent, indented — every element with no
  // parent (everything before parenting existed) is a "root" here, so this
  // degenerates to the exact same flat, reversed list as before. Sibling
  // order itself comes from types/canvas.ts's reversedSiblings — shared
  // with CgTemplateTimeline.tsx's own row order (orderElementsForDisplay,
  // built from this exact same primitive) so the two can't drift apart the
  // way their row TEXT once did (see KIND_LABEL's own doc comment there).
  const buildRows = (parentId: string | undefined, depth: number): { el: TemplateElement; index: number; depth: number; isTop: boolean; isBottom: boolean }[] => {
    const siblings = reversedSiblings(elements, parentId);
    return siblings.flatMap((el, i) => [
      { el, index: elements.indexOf(el), depth, isTop: i === 0, isBottom: i === siblings.length - 1 },
      ...buildRows(el.id, depth + 1),
    ]);
  };
  const rows = buildRows(undefined, 0);
  const selectedEl = elements.find((e) => e.id === selectedId);
  const canGroup = multiSelectedIds.size >= 2;
  const canUngroup = !!selectedEl?.config?.isGroup;
  const canMoveEdge = multiSelectedIds.size > 0 || !!selectedId;

  // Pointer-driven drag state for the gesture currently in progress (if
  // any) — a plain ref, not React state: it only ever matters WITHIN one
  // pointerdown→pointerup gesture, read/written entirely inside these same
  // handlers, so there's nothing here a re-render needs to see. `moved`
  // distinguishes a genuine drag from a plain click (a pointerdown+pointerup
  // with negligible movement in between still needs to SELECT the row, not
  // reorder it) — see onPointerDown/Move/Up below for the full gesture.
  const dragGestureRef = useRef<{ id: string; x: number; y: number; moved: boolean; metaKey: boolean; ctrlKey: boolean } | null>(null);
  // Our OWN double-click detection (a stationary pointerup on the same row
  // within 400ms of the previous one) rather than the browser's native
  // `dblclick` — a row's own onPointerDown below calls setPointerCapture,
  // and a captured element isn't guaranteed to still receive a synthesized
  // dblclick the same way an uncaptured one would (observed to simply never
  // fire in practice) — this sidesteps that entirely instead of fighting it.
  const lastClickRef = useRef<{ id: string; time: number } | null>(null);
  // Reordering (drag, Move Up/Down, Bring to Front/Send to Back, Group/
  // Ungroup) re-sorts `rows` below — animate that move (slide to the row's
  // new spot) instead of letting it just snap there, same as the Standings
  // table / substitution lists elsewhere in this app.
  const listRef = useReorderAnimation<HTMLDivElement>();

  return (
    <div className="tpld-layers">
      <div className="tpld-layers-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>Layers</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="tpld-layer-icon-btn" disabled={!canMoveEdge} onClick={onBringToFront} title="Bring selection to front">
            <BringToFront size={12} strokeWidth={2} />
          </button>
          <button className="tpld-layer-icon-btn" disabled={!canMoveEdge} onClick={onSendToBack} title="Send selection to back">
            <SendToBack size={12} strokeWidth={2} />
          </button>
          <button className="tpld-layer-icon-btn" disabled={!canGroup} onClick={onGroup} title={canGroup ? 'Group selection (Ctrl/Cmd+G)' : 'Ctrl/Cmd-click 2+ layers to group them'}>
            <Folder size={12} strokeWidth={2} />
          </button>
          <button className="tpld-layer-icon-btn" disabled={!canUngroup} onClick={onUngroup} title="Ungroup (Ctrl/Cmd+Shift+G)">
            <FolderMinus size={12} strokeWidth={2} />
          </button>
        </div>
      </div>
      <div className="tpld-layers-list" ref={listRef}>
        {rows.length === 0 && <div className="tpld-layers-empty">No elements yet.</div>}
        {rows.map(({ el, index, depth, isTop, isBottom }) => {
          const displayName = el.name || (el.config?.isGroup ? 'Group' : `${KIND_LABEL[el.kind]} ${index + 1}`);
          const isHidden = hiddenIds.has(el.id);
          const isMultiSelected = multiSelectedIds.has(el.id);
          const dragIndicator = dragOverRow?.id === el.id ? dragOverRow.pos : null;
          return (
            <div
              key={el.id}
              data-layer-id={el.id}
              data-flip-key={el.id}
              className={`tpld-layer-row${el.id === selectedId ? ' tpld-layer-row--active' : ''}${isMultiSelected ? ' tpld-layer-row--multi' : ''}${dragIndicator === 'inside' ? ' tpld-layer-row--drop-inside' : ''}`}
              style={{
                ...(depth > 0 ? { paddingLeft: 8 + depth * 14 } : undefined),
                ...(dragIndicator === 'above' ? { boxShadow: 'inset 0 2px 0 0 var(--accent)' } : null),
                ...(dragIndicator === 'below' ? { boxShadow: 'inset 0 -2px 0 0 var(--accent)' } : null),
                opacity: draggingLayerId === el.id ? 0.4 : 1,
                touchAction: 'none',
              }}
              onPointerDown={(e) => {
                if (renamingId === el.id) return;
                const target = e.target as HTMLElement;
                if (target.closest('.tpld-layer-actions') || target.closest('.tpld-layer-icon-btn') || target.tagName === 'INPUT') return;
                dragGestureRef.current = { id: el.id, x: e.clientX, y: e.clientY, moved: false, metaKey: e.metaKey, ctrlKey: e.ctrlKey };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                const g = dragGestureRef.current;
                if (!g) return;
                if (!g.moved) {
                  if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < 4) return;
                  g.moved = true;
                  onDragStartRow(g.id);
                }
                const hoveredRow = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('.tpld-layer-row') as HTMLElement | null;
                const hoveredId = hoveredRow?.getAttribute('data-layer-id');
                if (!hoveredRow || !hoveredId || hoveredId === g.id) { onDragOverRow(null); return; }
                const rect = hoveredRow.getBoundingClientRect();
                const frac = (e.clientY - rect.top) / rect.height;
                const pos = frac < 0.25 ? 'above' : frac > 0.75 ? 'below' : 'inside';
                onDragOverRow({ id: hoveredId, pos });
              }}
              onPointerUp={(e) => {
                const g = dragGestureRef.current;
                dragGestureRef.current = null;
                if (!g) return;
                if (g.moved) {
                  if (dragOverRow) onDropRow(g.id, dragOverRow.id, dragOverRow.pos);
                  onDragEndRow();
                  lastClickRef.current = null;
                  return;
                }
                const now = Date.now();
                const last = lastClickRef.current;
                if (last && last.id === g.id && now - last.time < 400) {
                  lastClickRef.current = null;
                  onStartRename(g.id);
                } else {
                  lastClickRef.current = { id: g.id, time: now };
                  onSelectRow(g.id, { metaKey: g.metaKey, ctrlKey: g.ctrlKey });
                }
              }}
              onPointerCancel={() => { dragGestureRef.current = null; onDragEndRow(); }}
            >
              <button className="tpld-layer-icon-btn" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onToggleHidden(el.id); }} title={isHidden ? 'Show in editor' : 'Hide in editor'}>
                {isHidden ? <EyeOff size={12} strokeWidth={2} /> : <Eye size={12} strokeWidth={2} />}
              </button>
              <span className="tpld-layer-kind">{el.config?.isGroup ? <Folder size={12} strokeWidth={2} /> : (KIND_ICON[el.kind] ?? KIND_ICON.rect)(12)}</span>
              {renamingId === el.id ? (
                <input
                  className="tpld-layer-rename"
                  autoFocus
                  defaultValue={displayName}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => onCommitRename(el.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') { e.preventDefault(); onCancelRename(); }
                  }}
                />
              ) : (
                <span className="tpld-layer-name" title="Double-click to rename · drag to reorder or drop onto another layer to nest it" onDoubleClick={(e) => { e.stopPropagation(); onStartRename(el.id); }}>{displayName}</span>
              )}
              <div className="tpld-layer-actions">
                <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onMoveUp(el.id); }} disabled={isTop} title="Bring forward"><ChevronUp size={11} strokeWidth={2} /></button>
                <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onMoveDown(el.id); }} disabled={isBottom} title="Send backward"><ChevronDown size={11} strokeWidth={2} /></button>
                <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onDuplicate(el.id); }} title="Duplicate"><Copy size={11} strokeWidth={2} /></button>
                <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onDelete(el.id); }} title="Delete"><X size={11} strokeWidth={2} /></button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// WYSIWYG: a bound element previews its actual live resolved value, the
// exact same resolveBindingValue call CgTemplateWidget.tsx uses for the
// real output — so what's shown here while designing already matches what
// ships to air.
function ElementPreview({ el, allElements, pages, widgetId, instanceId, getFlagWaveRefs, getWaveWarpRefs }: { el: TemplateElement; allElements: TemplateElement[]; pages: ReturnType<typeof useCanvasStore.getState>['pages']; /** The template CURRENTLY being edited — the one root a 'cardCarousel'/'nestedTemplate' preview render tree ever starts from, so it's the only cycle worth guarding against here (see either branch's own comment). */ widgetId: string; /** CgTemplateDesigner's own useId() — see that component's doc comment on why clip-path ids below need it. */ instanceId: string; /** Reads flagWaveRefs.current[id] — see CgTemplateWidget.tsx's identical prop for what it's for. */ getFlagWaveRefs: (id: string) => FlagWaveNodes | undefined; /** Reads waveWarpRefs.current[id] — see CgTemplateWidget.tsx's identical prop for what it's for. */ getWaveWarpRefs: (id: string) => WaveWarpNodes | undefined }) {
  // Mirrors CgTemplateWidget.tsx's own identical forceTick mechanism (see
  // its own comment for the full "why" — a 'target'-mode Countdown ticks
  // purely off Date.now(), nothing in the store itself changes as time
  // passes, so without this the designer's own live preview of a bound
  // element would sit frozen the whole time this template is open for
  // editing, only ever updating when something UNRELATED forced a
  // re-render — exactly the "goes stale as soon as I open the designer"
  // symptom this fixes. One ElementPreview instance per element (unlike
  // CgTemplateWidget.tsx, which owns every element at once), so this
  // checks just `el`'s own binding rather than the whole template's.
  const [, forceTick] = useState(0);
  const liveBindingSourcesKey = [el.binding?.sourceWidgetId, ...(el.kind === 'statbar' ? (el.config.rows ?? []).map((r: StatBarRow) => `${r.bindingA?.sourceWidgetId}:${r.bindingB?.sourceWidgetId}`) : [])].join('|');
  useEffect(() => {
    if (!hasLiveBinding([el])) return;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveBindingSourcesKey]);

  // Called unconditionally regardless of kind (React's rules of hooks) —
  // `enabled` is what actually turns it on, only ever true for a 'text'
  // element with config.autoFit set. Mirrors CgTemplateWidget.tsx's
  // TemplateElementView exactly, so the Designer's preview matches the
  // real output.
  const textRef = useRef<HTMLDivElement | null>(null);
  const textContentForFit = el.kind === 'text' ? (el.binding ? resolveBindingValue(pages, el.binding) : (el.config.text ?? 'Text')) : '';
  const fitFontSize = useAutoFitFontSize(el.kind === 'text' && !!el.config.autoFit, textRef, el.config.fontSize ?? 14, el.config.wordWrap ?? true, [textContentForFit, el.w, el.h]);

  // config.changeAnim, text only — mirrors CgTemplateWidget.tsx's own
  // identical value-watch effect exactly (same refs, same preset dispatch),
  // so an operator authoring an "On Value Change" preset actually SEES it
  // play here (editing the Text field, or a live binding ticking over)
  // instead of the designer just snapping straight to the new value with no
  // way to preview the transition short of publishing to the real output.
  // Text only for now (matching digitMorph/gooeyMorph's own text-only
  // scope) — 'image' elements still snap here, same as before this change.
  const [displayedValue, setDisplayedValue] = useState(textContentForFit);
  const prevLiveValueRef = useRef(textContentForFit);
  const changeAnimNodeRef = useRef<HTMLElement | null>(null);
  const charRefs = useRef<(HTMLElement | null)[]>([]);
  const segmentRefs = useRef<(SVGPathElement | null)[][]>([]);
  const gooeyPrevRef = useRef<HTMLSpanElement | null>(null);
  const gooeyNextRef = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    if (el.kind !== 'text') return;
    const liveValue = textContentForFit;
    if (liveValue === prevLiveValueRef.current) return;
    const previousValue = prevLiveValueRef.current;
    prevLiveValueRef.current = liveValue;
    const anim = el.changeAnim;
    if (!anim) { setDisplayedValue(liveValue); return; }

    // digitMorph — see CgTemplateWidget.tsx's identical branch.
    if (anim.preset === 'digitMorph' && previousValue.length === liveValue.length) {
      const prevStr = previousValue;
      const nextStr = liveValue;
      const dur = anim.duration || 0.4;
      for (let i = 0; i < nextStr.length; i++) {
        if (prevStr[i] === nextStr[i]) continue;
        if (!isSevenSegmentDigit(prevStr[i]) || !isSevenSegmentDigit(nextStr[i])) continue;
        const segEls = segmentRefs.current[i];
        if (!segEls) continue;
        SEGMENT_NAMES.forEach((name, segIdx) => {
          const pathEl = segEls[segIdx];
          if (!pathEl) return;
          const wasOn = DIGIT_SEGMENTS[prevStr[i]].includes(name);
          const isOn = DIGIT_SEGMENTS[nextStr[i]].includes(name);
          if (wasOn === isOn) return;
          gsap.killTweensOf(pathEl);
          gsap.to(pathEl, { morphSVG: isOn ? SEGMENT_PATH_ON[name] : SEGMENT_PATH_OFF[name], duration: dur, ease: 'power2.inOut' });
        });
      }
      setDisplayedValue(liveValue);
      return;
    }

    // gooeyMorph — see CgTemplateWidget.tsx's identical branch and
    // cgEffects.ts's GOOEY_THRESHOLD_MATRIX doc comment.
    if (anim.preset === 'gooeyMorph') {
      const prevNode = gooeyPrevRef.current;
      const nextNode = gooeyNextRef.current;
      if (!prevNode || !nextNode) { setDisplayedValue(liveValue); return; }
      gsap.killTweensOf([prevNode, nextNode]);
      prevNode.textContent = previousValue;
      setDisplayedValue(liveValue);
      const dur = Math.max(0.1, anim.duration || 1);
      const proxy = { t: 0.001 };
      gsap.to(proxy, {
        t: 1, duration: dur, ease: 'none',
        onUpdate: () => {
          const f = proxy.t;
          nextNode.style.filter = `blur(${Math.min(8 / f - 8, 100)}px)`;
          nextNode.style.opacity = `${Math.pow(f, 0.4)}`;
          const inv = Math.max(0.001, 1 - f);
          prevNode.style.filter = `blur(${Math.min(8 / inv - 8, 100)}px)`;
          prevNode.style.opacity = `${Math.pow(inv, 0.4)}`;
        },
        onComplete: () => {
          nextNode.style.filter = '';
          nextNode.style.opacity = '1';
          prevNode.style.filter = '';
          prevNode.style.opacity = '0';
        },
      });
      return;
    }

    const isGradient = 'background' in resolveTextColorStyle(el.config.color, '#ffffff');
    const perCharEligible = !!anim.perCharacter && !isGradient
      && anim.preset !== 'typewriter' && anim.preset !== 'scramble'
      && previousValue.length === liveValue.length && previousValue.length > 0;

    if (perCharEligible) {
      const prevStr = previousValue;
      const nextStr = liveValue;
      const distance = Math.max(8, (el.config.fontSize ?? 14) * 0.6);
      const swapCharAt = (idx: number) => setDisplayedValue((cur: string) => {
        const arr = (typeof cur === 'string' ? cur : nextStr).split('');
        arr[idx] = nextStr[idx];
        return arr.join('');
      });
      for (let i = 0; i < nextStr.length; i++) {
        if (prevStr[i] === nextStr[i]) continue;
        const charNode = charRefs.current[i];
        if (!charNode) { swapCharAt(i); continue; }
        gsap.killTweensOf(charNode);
        buildChangeTransition(anim.preset, charNode, distance, anim.duration || 0.4, () => swapCharAt(i));
      }
      return;
    }

    const node = changeAnimNodeRef.current;
    if (!node) { setDisplayedValue(liveValue); return; }
    gsap.killTweensOf(node);
    const distance = Math.max(20, Math.max(el.w, el.h) * 0.2);
    const textValues = { from: previousValue, to: liveValue };
    buildChangeTransition(anim.preset, node, distance, anim.duration || 0.4, () => setDisplayedValue(liveValue), textValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textContentForFit]);

  // 'ticker' — mirrors CgTemplateWidget.tsx's own identical hook call
  // exactly, so the designer's preview scrolls the same way the real
  // output does (see lib/useTickerScroll.ts).
  const tickerTrackRef = useRef<HTMLDivElement | null>(null);
  const tickerUnitRef = useRef<HTMLSpanElement | null>(null);
  const tickerText = el.kind === 'ticker' ? (el.binding ? resolveBindingValue(pages, el.binding) : (el.config.text ?? 'Ticker text')) : '';
  const tickerRepeats = useTickerScroll(el.kind === 'ticker', tickerTrackRef, tickerUnitRef, el.w, {
    text: tickerText, fontSize: el.config.fontSize ?? 32, bold: !!el.config.bold, speed: el.config.speed ?? 120, direction: el.config.direction ?? 'left', gap: el.config.gap ?? 80,
  });
  useEffect(() => { ensureGoogleFontLoaded(el.config.fontFamily); }, [el.config.fontFamily]);

  // 'credits' — mirrors CgTemplateWidget.tsx's own identical hook call
  // exactly (see lib/useCreditsAnimation.ts).
  const creditsScrollRef = useRef<HTMLDivElement | null>(null);
  const creditsSectionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const creditsSections: CreditsSection[] = el.kind === 'credits' ? (el.config.sections ?? []) : [];
  useCreditsAnimation(el.kind === 'credits', el, el.w, el.h, creditsScrollRef, (i) => creditsSectionRefs.current[i], creditsSections.length);

  // Any kind with an enabled 'flagWave' effect — mirrors
  // CgTemplateWidget.tsx's own identical hook call exactly, so the
  // Designer's own preview ripples the same way the real output does.
  const flagWaveFx = findFlagWave(el.config.effects);
  const flagWaveProps = flagWaveFx ? buildFlagWaveFilterProps(flagWaveFx) : null;
  useFlagWave(
    !!flagWaveFx,
    () => getFlagWaveRefs(el.id),
    flagWaveProps?.baseFrequency ?? 0.01,
    flagWaveProps?.azimuth ?? 45,
    flagWaveProps?.cycleDuration ?? 3,
  );

  // Any kind with an enabled 'waveWarp' effect — mirrors
  // CgTemplateWidget.tsx's own identical hook call exactly.
  const waveWarpFx = findWaveWarp(el.config.effects);
  const waveWarpProps = waveWarpFx ? buildWaveWarpFilterProps(waveWarpFx) : null;
  useWaveWarp(
    !!waveWarpFx,
    () => getWaveWarpRefs(el.id),
    waveWarpProps?.pxPerSecond ?? 0,
    waveWarpProps?.phasePx ?? 0,
    waveWarpProps?.angleDeg ?? 0,
  );

  // A looping 'sequence' element's own double-buffered frame layers — see
  // lib/useSequenceLoop.ts's own doc comment. Local to this element
  // instance, same as CgTemplateWidget.tsx's identical pair.
  const seqLayerARef = useRef<HTMLDivElement | null>(null);
  const seqLayerBRef = useRef<HTMLDivElement | null>(null);
  // A 'sequence' element with config.loop on — mirrors CgTemplateWidget.tsx's
  // own identical hook call, so a live "Play" preview here loops the same
  // way the real output does (the scrub-bar's OWN separate frame math,
  // just above this component, only ever runs while actively dragging the
  // scrub handle — the two can very briefly fight for one frame if a scrub
  // drag happens to overlap this hook's own tick, a minor cosmetic
  // authoring-time-only edge case, never visible on the real output).
  const sequenceLoading = useSequenceLoop(
    el.kind === 'sequence' && !!el.config.loop,
    () => ({ a: seqLayerARef.current, b: seqLayerBRef.current }),
    el.config.frames ?? [],
    el.config.fps ?? 24,
    undefined,
    el.config.blend ? Math.max(0, el.config.blendMs ?? 150) : 0,
  );
  // Brief "✓ Loaded" confirmation once this element's own head-start batch
  // finishes (see useSequenceLoop.ts) — same visual language as App.tsx's
  // own whole-project `cg-asset-preload-toast--done` banner, just scoped to
  // THIS element instead of the whole project, and Designer-only (never
  // shown on the real output — CgTemplateWidget.tsx doesn't have this).
  const [sequenceJustLoaded, setSequenceJustLoaded] = useState(false);
  const wasSequenceLoadingRef = useRef(false);
  useEffect(() => {
    const was = wasSequenceLoadingRef.current;
    wasSequenceLoadingRef.current = sequenceLoading;
    if (was && !sequenceLoading) {
      setSequenceJustLoaded(true);
      const t = setTimeout(() => setSequenceJustLoaded(false), 2500);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [sequenceLoading]);

  // Any kind with an enabled 'animatedBg' effect — mirrors
  // CgTemplateWidget.tsx's own identical hook call exactly.
  const animatedBgFx = findAnimatedBg(el.config.effects);
  const animatedBgStyleObj = animatedBgFx ? buildAnimatedBgStyle(animatedBgFx) : null;
  const animatedBgRef = useRef<HTMLDivElement | null>(null);
  useAnimatedBg(!!animatedBgFx, animatedBgRef, animatedBgStyleObj, animatedBgFx?.duration ?? 6, animatedBgFx?.loopMode ?? 'yoyo');
  // Same maskId lookup renderElementTree's own closure already does for
  // itself (a SEPARATE function scope — ElementPreview has no access to
  // its local `hasMask`), needed here too since the animatedBg div below
  // renders inside THIS component, not that one.
  const hasMask = !!el.maskId && allElements.some((e) => e.id === el.maskId && e.kind === 'shape');

  // `conditions` — mirrors CgTemplateWidget.tsx's own identical hook call.
  // Targets a dedicated wrapper div (rendered at the very end below,
  // around this whole component's own output) rather than any node the
  // in/loop/out state machine itself animates.
  const conditionsRef = useRef<HTMLDivElement | null>(null);
  useElementConditions(el.conditions, pages, conditionsRef);

  // 'statbar' — mirrors CgTemplateWidget.tsx's own identical resolve+tween
  // calls exactly (see lib/useStatbarValues.ts and StatBarRow).
  const statbarNodesRef = useRef<Record<string, HTMLDivElement | null>>({});
  const statbarRows: StatBarRow[] = el.kind === 'statbar' ? (el.config.rows ?? []) : [];
  const statbarRowValues = statbarRows.map((row) => {
    const valueA = resolveStatbarValue(row.bindingA ? resolveBindingValue(pages, row.bindingA) : undefined, row.valueA);
    const valueB = resolveStatbarValue(row.bindingB ? resolveBindingValue(pages, row.bindingB) : undefined, row.valueB);
    return { id: row.id, valueA, valueB, pctA: statbarPercentA(valueA, valueB) };
  });
  useStatbarRowTweens(statbarNodesRef, statbarRowValues.map((r) => ({ id: r.id, pct: r.pctA })), el.config.ease ?? 'power2.out');

  // 'lightSweep' effect (any kind) — mirrors CgTemplateWidget.tsx's own
  // identical hook call exactly, so the designer's preview sweeps the same
  // way the real output does (see lib/cgEffects.ts's buildLightSweepGeometry
  // and lib/useLightSweep.ts).
  const lightSweepEffect = findLightSweep(el.config.effects);
  const sweepGeom = lightSweepEffect ? buildLightSweepGeometry(lightSweepEffect, el.w, el.h) : null;
  const sweepBandRef = useRef<HTMLDivElement | null>(null);
  useLightSweep(!!lightSweepEffect, sweepBandRef, sweepGeom?.distance ?? 0, lightSweepEffect?.duration ?? 1.4, lightSweepEffect?.gap ?? 2.5);

  // 'stroke' effect (any kind) — mirrors CgTemplateWidget.tsx's own
  // identical hook call exactly, so the designer's preview marches the same
  // way the real output does (see lib/cgEffects.ts's buildStrokeGeometry
  // and lib/useRunningStroke.ts).
  const strokeEffect = findStroke(el.config.effects) ?? null;
  const strokeGeom = strokeEffect
    ? buildStrokeGeometry(strokeEffect, el.w, el.h, el.kind === 'shape', el.config.d, el.config.viewBox, el.config.borderRadius)
    : null;
  const strokeNodeRef = useRef<SVGGeometryElement | null>(null);
  useRunningStroke(strokeEffect, strokeNodeRef);
  const strokeGlowFilter = strokeEffect ? buildStrokeGlowFilter(strokeEffect) : '';

  // 'matchSchedule' — see types/canvas.ts's own doc comment and
  // lib/matchScheduleRow.ts. Called unconditionally, same "always call,
  // only use it for the right kind" convention as every hook above.
  const matchScheduleDesignerData = useMatchScheduleData(el.config.tournamentId, el.config.group);
  // 'standings'/'bracket' — see types/canvas.ts's own doc comments and
  // lib/standingsRow.ts/lib/bracketRow.ts. Called unconditionally, same
  // convention as matchScheduleDesignerData just above.
  const standingsDesignerData = useStandingsData(el.config.tournamentId, el.config.group, el.config.category);
  const bracketDesignerData = useBracketData(el.config.tournamentId, el.config.category, el.config.tier);
  // Same idea as renderElementTree's own glassMask (see its doc comment) —
  // this element's own moving highlight band, masked to just its actual
  // glyphs/opaque pixels instead of sweeping across its whole rectangular
  // box. Computed HERE (inside ElementPreview, not up in renderElementTree
  // alongside glassMask) since that's where textContentForFit/fitFontSize
  // — the live, autofit-aware values, better than renderElementTree's own
  // "close enough for editing" approximation — already live.
  const sweepMask = !lightSweepEffect ? null
    : el.kind === 'image' ? buildImageGlassMask(resolveImageUrl(el.binding ? resolveBindingValue(pages, el.binding) : (el.config.imageUrl ?? '')), el.config.objectFit)
    : el.kind === 'text' && !el.config.fontFamily ? buildTextGlassMask(textContentForFit, el.w, el.h, { fontSize: fitFontSize, bold: el.config.bold, align: el.config.align, valign: el.config.valign })
    : null;
  // Same idea again, for 'animatedBg' — see CgTemplateWidget.tsx's identical
  // block for the full "why" (its own moving background was filling this
  // element's whole rectangular box regardless of kind, same pre-fix bug
  // glass/lightSweep had). Computed here rather than up in renderElementTree
  // for the same live-autofit-values reason sweepMask just above is.
  const animatedBgMask = !animatedBgFx ? null
    : el.kind === 'image' ? buildImageGlassMask(resolveImageUrl(el.binding ? resolveBindingValue(pages, el.binding) : (el.config.imageUrl ?? '')), el.config.objectFit)
    : el.kind === 'text' && !el.config.fontFamily ? buildTextGlassMask(textContentForFit, el.w, el.h, { fontSize: fitFontSize, bold: el.config.bold, align: el.config.align, valign: el.config.valign })
    : null;

  let content: React.ReactNode;
  if (el.kind === 'rect') {
    content = <div style={{
      width: '100%', height: '100%', background: resolveBackground(el.config.fill, '#000'),
      opacity: el.config.opacity ?? 1, borderRadius: el.config.borderRadius ?? 0,
      // See CgTemplateWidget.tsx's identical rect stroke — inset box-shadow,
      // not a CSS border, for the same "no layout impact, follows
      // borderRadius" reasons.
      boxShadow: el.config.strokeWidth ? `inset 0 0 0 ${el.config.strokeWidth}px ${el.config.stroke ?? '#000000'}` : undefined,
    }} />;
  } else if (el.kind === 'shape') {
    const { fill: shapeFill, defs: shapeFillDefs } = resolveSvgFill(el.config.fill, `shapefill-${el.id}`, '#ffffff');
    content = (
      <svg viewBox={el.config.viewBox ?? SHAPE_VIEWBOX} style={{ width: '100%', height: '100%' }}>
        {shapeFillDefs && <defs>{shapeFillDefs}</defs>}
        <path d={el.config.d ?? SHAPE_LIBRARY[DEFAULT_SHAPE]} fill={shapeFill} stroke={el.config.stroke ?? 'none'} strokeWidth={el.config.strokeWidth ?? 0} />
      </svg>
    );
  } else if (el.kind === 'sequence') {
    const frames: string[] = el.config.frames ?? [];
    const fit = el.config.objectFit ?? 'cover';
    const looping = !!el.config.loop;
    const layerStyle: React.CSSProperties = { position: 'absolute', inset: 0, backgroundSize: fit, backgroundPosition: 'center', backgroundRepeat: 'no-repeat' };
    content = frames.length ? (
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {looping ? (
          // Double-buffered — see lib/useSequenceLoop.ts's own doc comment.
          // Neither layer gets a React-rendered backgroundImage: the hook
          // owns both EXCLUSIVELY from the moment they mount (an earlier,
          // single-layer version of this let React's own re-renders fight
          // the hook's imperative writes, producing a visible blink back to
          // frame 1).
          <>
            <div ref={seqLayerARef} style={layerStyle} />
            <div ref={seqLayerBRef} style={layerStyle} />
          </>
        ) : (
          <div style={{ ...layerStyle, backgroundImage: frames[0] ? `url("${resolveImageUrl(frames[0])}")` : undefined }} />
        )}
        {/* A HEAD-START batch of frames is preloaded before the loop starts
           ticking (see useSequenceLoop.ts's own doc comment on why) — this
           explicit placeholder is what shows during that brief window
           instead of a blank hole, which otherwise looked like the image
           had simply gone missing rather than "still loading". */}
        {sequenceLoading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)' }}>
            <Loader2 size={Math.min(28, Math.max(14, el.w * 0.08))} strokeWidth={2} color="#fff" style={{ animation: 'spin 0.7s linear infinite' }} />
          </div>
        )}
        {/* Fires once the preload above finishes — same visual language as
           App.tsx's own whole-project cg-asset-preload-toast--done banner. */}
        {sequenceJustLoaded && (
          <div className="cg-asset-preload-toast cg-asset-preload-toast--done" style={{ position: 'absolute', bottom: 4, left: 4, right: 'auto' }}>
            <span>✓ Sequence loaded</span>
          </div>
        )}
      </div>
    ) : (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#888' }}>No frames</div>
    );
  } else if (el.kind === 'ticker') {
    const gap = el.config.gap ?? 80;
    content = (
      <div style={{ width: '100%', height: '100%', overflow: 'hidden', background: resolveBackground(el.config.bgColor, 'transparent'), display: 'flex', alignItems: 'center' }}>
        <div ref={tickerTrackRef} style={{ display: 'flex', whiteSpace: 'nowrap', willChange: 'transform' }}>
          {Array.from({ length: tickerRepeats }, (_, i) => (
            <span
              key={i}
              ref={i === 0 ? tickerUnitRef : undefined}
              style={{ display: 'inline-block', paddingRight: gap, fontSize: (el.config.fontSize ?? 32) + 'px', fontFamily: fontFamilyCss(el.config.fontFamily), color: el.config.color ?? '#ffffff', fontWeight: el.config.bold ? 700 : 400, flexShrink: 0 }}
            >
              {tickerText}
            </span>
          ))}
        </div>
      </div>
    );
  } else if (el.kind === 'statbar') {
    const fontSize = el.config.fontSize ?? 20;
    const barHeight = el.config.barHeight ?? 24;
    const barRadius = el.config.barRadius ?? barHeight / 2;
    const trackColor = el.config.trackColor ?? '#333333';
    const separatorColor = el.config.separatorColor ?? '#444444';
    const showSeparators = el.config.showSeparators ?? true;
    const isPercent = (el.config.valueFormat ?? 'percent') === 'percent';
    content = (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10, fontFamily: fontFamilyCss(el.config.fontFamily) }}>
        {statbarRows.map((row, i) => {
          const { valueA, valueB, pctA } = statbarRowValues[i];
          const colorA = row.colorA ?? '#e74c3c';
          const colorB = row.colorB ?? '#3498db';
          // See CgTemplateWidget.tsx's identical comment — solid-only label
          // text color, gradients are for the bar segment fill itself.
          const labelColorA = typeof colorA === 'string' ? colorA : '#e74c3c';
          const labelColorB = typeof colorB === 'string' ? colorB : '#3498db';
          // See CgTemplateWidget.tsx's identical comment — labelB is 100 -
          // the rounded labelA, not independently rounded, so the two
          // always sum to a clean 100 instead of occasionally drifting to
          // 101 on a .5 split.
          const roundedA = Math.round(pctA);
          const labelA = isPercent ? `${roundedA}%` : String(Math.round(valueA));
          const labelB = isPercent ? `${100 - roundedA}%` : String(Math.round(valueB));
          return (
            <div key={row.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {i > 0 && showSeparators && <div style={{ height: 1, background: separatorColor }} />}
              {(el.config.showLabel ?? true) && row.label && (
                <div style={{ textAlign: 'center', fontSize, color: el.config.labelColor ?? '#ffffff', fontWeight: 700 }}>{row.label}</div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {(el.config.showValues ?? true) && (
                  <span style={{ fontSize, color: labelColorA, fontWeight: 700, minWidth: fontSize * 2, textAlign: 'right' }}>{labelA}</span>
                )}
                <div style={{ flex: 1, height: barHeight, display: 'flex', borderRadius: barRadius, overflow: 'hidden', background: trackColor }}>
                  <div ref={(node) => { statbarNodesRef.current[row.id] = node; }} style={{ background: resolveBackground(colorA, '#e74c3c'), height: '100%' }} />
                  <div style={{ flex: 1, background: resolveBackground(colorB, '#3498db'), height: '100%' }} />
                </div>
                {(el.config.showValues ?? true) && (
                  <span style={{ fontSize, color: labelColorB, fontWeight: 700, minWidth: fontSize * 2, textAlign: 'left' }}>{labelB}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  } else if (el.kind === 'image') {
    const raw = el.binding ? resolveBindingValue(pages, el.binding) : (el.config.imageUrl ?? '');
    const url = resolveImageUrl(raw);
    content = url ? (
      <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: el.config.objectFit ?? 'contain' }} draggable={false} />
    ) : (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#888', background: el.config.bgColor === 'transparent' ? 'rgba(255,255,255,0.05)' : resolveBackground(el.config.bgColor, 'transparent') }}>
        {el.binding ? 'No image' : 'Image'}
      </div>
    );
  } else if (el.kind === 'imagePlaylist') {
    // Static preview only — the first slide, no auto-advance/transition
    // cycling live in the designer (same "acceptable v1 limitation" call
    // already made for 'sequence' above: authoring the slides/settings is
    // what matters here, actually watching it play is what the real output
    // and Preview All are for).
    const images: string[] = el.config.images ?? [];
    const url = images[0] ? resolveImageUrl(images[0]) : '';
    content = url ? (
      <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: el.config.objectFit ?? 'cover' }} draggable={false} />
    ) : (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#888', background: resolveBackground(el.config.bgColor, 'rgba(255,255,255,0.05)') }}>
        {images.length ? 'Image Playlist' : 'No images'}
      </div>
    );
  } else if (el.kind === 'cardCarousel') {
    // Static preview only — the active (first) card's own referenced
    // template, centered and scaled to fit, no coverflow motion live in the
    // designer (same "authoring matters here, watching it play is what the
    // real output/Preview All are for" call already made for 'sequence'/
    // 'imagePlaylist' above).
    const cards: CgCarouselCard[] = el.config.cards ?? [];
    const firstCard = cards[0];
    const cardWidget = firstCard?.templateId ? pages.flatMap((p) => p.widgets).find((w) => w.id === firstCard.templateId) : undefined;
    // Guards the Designer's OWN preview against a template that (directly
    // or via a longer chain) ends up referencing the widget CURRENTLY
    // BEING EDITED — the only cycle that can actually infinite-loop THIS
    // render, since it's the only root this call tree ever starts from.
    // (CgTemplateWidget.tsx's own recursive rendering — the real output,
    // and every level below this first one, here or on air — already
    // carries this same ancestor chain forward on its own.)
    const isCardCircular = !!firstCard?.templateId && firstCard.templateId === widgetId;
    content = cardWidget && !isCardCircular ? (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <div style={{ width: cardWidget.w, height: cardWidget.h, transform: `scale(${Math.min(el.w / cardWidget.w, el.h / cardWidget.h, 1)})`, flexShrink: 0 }}>
          <CgTemplateWidget config={applyCardOverrides(cardWidget.config, firstCard, el.config.playlistImages ?? [], 0)} w={cardWidget.w} h={cardWidget.h} ancestorTemplateIds={[widgetId]} />
        </div>
      </div>
    ) : (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#888', background: 'rgba(255,255,255,0.05)' }}>
        {isCardCircular ? 'Circular reference' : cards.length ? 'Pick a card style' : 'No cards'}
      </div>
    );
  } else if (el.kind === 'nestedTemplate') {
    // Live preview — a real nested CgTemplateWidget, same "authoring
    // matters here" treatment 'cardCarousel' 's own preview above gets.
    // See that branch's own comment on the ancestorTemplateIds={[widgetId]}
    // guard — same reasoning, same one root this render tree ever starts
    // from.
    const nestedWidget = el.config.templateId ? pages.flatMap((p) => p.widgets).find((w) => w.id === el.config.templateId) : undefined;
    const isCircular = el.config.templateId === widgetId;
    content = nestedWidget && !isCircular ? (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <div style={{ width: nestedWidget.w, height: nestedWidget.h, transform: `scale(${Math.min(el.w / nestedWidget.w, el.h / nestedWidget.h, 1)})`, flexShrink: 0 }}>
          <CgTemplateWidget config={nestedWidget.config} w={nestedWidget.w} h={nestedWidget.h} ancestorTemplateIds={[widgetId]} />
        </div>
      </div>
    ) : (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#888', background: 'rgba(255,255,255,0.05)', textAlign: 'center', padding: 8 }}>
        {isCircular ? 'Circular reference' : 'Pick a template in the Inspector'}
      </div>
    );
  } else if (el.kind === 'matchSchedule') {
    // Static preview of whichever page `config.pageIndex` currently points
    // at — same "authoring matters here, watching it page live is what the
    // real output/Preview All are for" treatment 'cardCarousel' 's own
    // preview above gets (no live auto/manual advance in the Designer).
    const msRowsPerPage = Math.max(1, el.config.rowsPerPage ?? 4);
    const msRowHeight = el.config.rowHeight ?? 90;
    const msRowGap = el.config.rowGap ?? 12;
    const msPageMatches = paginateMatches(matchScheduleDesignerData.matches, msRowsPerPage, el.config.pageIndex ?? 0);
    content = (
      <div style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}>
        {msPageMatches.length === 0 && (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#888' }}>No fixtures</div>
        )}
        {msPageMatches.map((match, i) => {
          const status = matchScheduleDesignerData.getStatus(match);
          const score = matchScheduleDesignerData.getScore(match, status);
          const templateId = resolveRowTemplateId(el.config, match, status);
          const rowWidget = templateId ? pages.flatMap((p) => p.widgets).find((w) => w.id === templateId) : undefined;
          const isRowCircular = !!templateId && templateId === widgetId;
          return (
            <div key={match.id} style={{ position: 'absolute', left: 0, top: i * (msRowHeight + msRowGap), width: '100%', height: msRowHeight, overflow: 'hidden' }}>
              {rowWidget && !isRowCircular ? (
                <div style={{ width: rowWidget.w, height: rowWidget.h, transform: `scale(${Math.min(el.w / rowWidget.w, msRowHeight / rowWidget.h, 1)})`, transformOrigin: 'top left' }}>
                  <CgTemplateWidget config={buildMatchRowOverrides(rowWidget.config, match, status, score)} w={rowWidget.w} h={rowWidget.h} ancestorTemplateIds={[widgetId]} />
                </div>
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#888', background: 'rgba(255,255,255,0.05)', textAlign: 'center', padding: 8 }}>
                  {isRowCircular ? 'Circular reference' : `Pick a ${status} row style`}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  } else if (el.kind === 'standings') {
    // Static preview of whichever page `config.pageIndex` currently points
    // at — same treatment 'matchSchedule' 's own preview above gets.
    const stRowsPerPage = Math.max(1, el.config.rowsPerPage ?? 8);
    const stRowHeight = el.config.rowHeight ?? 40;
    const stRowGap = el.config.rowGap ?? 6;
    const stPageRows = paginateStandings(standingsDesignerData.rows, stRowsPerPage, el.config.pageIndex ?? 0);
    content = (
      <div style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}>
        {stPageRows.length === 0 && (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#888' }}>No teams</div>
        )}
        {stPageRows.map((row, i) => {
          const templateId = resolveStandingsRowTemplateId(el.config, row, standingsDesignerData.rows.length);
          const rowWidget = templateId ? pages.flatMap((p) => p.widgets).find((w) => w.id === templateId) : undefined;
          const isRowCircular = !!templateId && templateId === widgetId;
          return (
            <div key={row.teamId} style={{ position: 'absolute', left: 0, top: i * (stRowHeight + stRowGap), width: '100%', height: stRowHeight, overflow: 'hidden' }}>
              {rowWidget && !isRowCircular ? (
                <div style={{ width: rowWidget.w, height: rowWidget.h, transform: `scale(${Math.min(el.w / rowWidget.w, stRowHeight / rowWidget.h, 1)})`, transformOrigin: 'top left' }}>
                  <CgTemplateWidget config={buildStandingsRowOverrides(rowWidget.config, row)} w={rowWidget.w} h={rowWidget.h} ancestorTemplateIds={[widgetId]} />
                </div>
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#888', background: 'rgba(255,255,255,0.05)', textAlign: 'center', padding: 8 }}>
                  {isRowCircular ? 'Circular reference' : 'Pick a row style'}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  } else if (el.kind === 'bracket') {
    // Column layout (earliest round first, left to right) — a real static
    // layout like 'matchSchedule' 's own, not motion-driven.
    const brBoxW = el.config.boxWidth ?? 220;
    const brBoxH = el.config.boxHeight ?? 90;
    const brColGap = el.config.columnGap ?? 24;
    const brBoxGap = el.config.boxGap ?? 24;
    const brColumns = el.config.showThirdPlace && bracketDesignerData.thirdPlaceMatch
      ? [...bracketDesignerData.columns, { stage: '3rd Place', matches: [bracketDesignerData.thirdPlaceMatch] }]
      : bracketDesignerData.columns;
    content = (
      <div style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}>
        {brColumns.length === 0 && (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#888' }}>No knockout fixtures</div>
        )}
        {brColumns.map((col, ci) => (
          <div key={col.stage} style={{ position: 'absolute', left: ci * (brBoxW + brColGap), top: 0, width: brBoxW }}>
            {col.matches.map((match, mi) => {
              const status = bracketDesignerData.getStatus(match);
              const score = bracketDesignerData.getScore(match, status);
              const winnerSide = bracketDesignerData.getWinnerSide(match);
              const templateId = resolveBracketRowTemplateId(el.config, match, status);
              const rowWidget = templateId ? pages.flatMap((p) => p.widgets).find((w) => w.id === templateId) : undefined;
              const isBoxCircular = !!templateId && templateId === widgetId;
              return (
                <div key={match.id} style={{ position: 'absolute', left: 0, top: mi * (brBoxH + brBoxGap), width: brBoxW, height: brBoxH, overflow: 'hidden' }}>
                  {rowWidget && !isBoxCircular ? (
                    <div style={{ width: rowWidget.w, height: rowWidget.h, transform: `scale(${Math.min(brBoxW / rowWidget.w, brBoxH / rowWidget.h, 1)})`, transformOrigin: 'top left' }}>
                      <CgTemplateWidget config={buildBracketRowOverrides(rowWidget.config, match, status, score, winnerSide)} w={rowWidget.w} h={rowWidget.h} ancestorTemplateIds={[widgetId]} />
                    </div>
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#888', background: 'rgba(255,255,255,0.05)', textAlign: 'center', padding: 8 }}>
                      {isBoxCircular ? 'Circular reference' : `Pick a ${status} box style`}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  } else if (el.kind === 'credits') {
    const creditsStyle = creditsStyleFromConfig(el.config);
    const mode = el.config.mode ?? 'scroll';
    content = mode === 'sequence' ? (
      <div style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}>
        {creditsSections.map((section, i) => (
          <div
            key={section.id}
            ref={(node) => { creditsSectionRefs.current[i] = node; }}
            style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4%' }}
          >
            <CreditsSectionContent section={section} style={creditsStyle} />
          </div>
        ))}
      </div>
    ) : (
      <div style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}>
        <div
          ref={creditsScrollRef}
          style={(el.config.scrollDirection ?? 'vertical') === 'horizontal' ? {
            position: 'absolute', top: 0, bottom: 0, display: 'flex', flexDirection: 'row', gap: creditsStyle.sectionGap,
            alignItems: 'center', padding: '4% 0',
          } : {
            position: 'absolute', left: 0, right: 0, display: 'flex', flexDirection: 'column', gap: creditsStyle.sectionGap,
            alignItems: creditsStyle.align === 'left' ? 'flex-start' : creditsStyle.align === 'right' ? 'flex-end' : 'center',
            padding: '0 4%',
          }}
        >
          {creditsSections.map((section) => <CreditsSectionContent key={section.id} section={section} style={creditsStyle} />)}
        </div>
      </div>
    );
  } else if (el.kind === 'sound') {
    // Designer-only placeholder — see TemplateElement's own doc comment on
    // the 'sound' kind: it's never rendered at all on the real output
    // (CgTemplateWidget.tsx just skips it), this "chip" exists purely so
    // there's something to select/drag/rename in the canvas, distinctively
    // styled (dashed border, tinted fill) so it never reads as if it might
    // actually appear on air.
    content = (
      <div style={{
        width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        background: 'rgba(155, 89, 255, 0.18)', border: '1px dashed rgba(155, 89, 255, 0.6)', borderRadius: 4,
        fontSize: 11, color: '#c9a8ff', overflow: 'hidden', whiteSpace: 'nowrap', padding: '0 6px',
      }}>
        <Volume2 size={13} strokeWidth={2} /> {el.name || 'Sound'}
      </div>
    );
  } else {
    // 'text' — `displayedValue` (not textContentForFit directly), and
    // digitMorph's segment `d`s/gooeyMorph's two nodes are now GSAP-owned
    // exactly like CgTemplateWidget.tsx's own identical branch (see the
    // value-change effect above) — the designer's preview genuinely plays
    // whatever "On Value Change" preset is selected now, not a static
    // stand-in.
    const textContent = displayedValue;
    const wordWrap = el.config.wordWrap ?? true;
    const valign = el.config.valign ?? 'middle';
    const gradientColor = resolveTextColorStyle(el.config.color, '#fff', el.config.colorOpacity);
    const isGradientText = 'background' in gradientColor;
    const perCharMode = !!el.changeAnim?.perCharacter && !isGradientText
      && el.changeAnim.preset !== 'typewriter' && el.changeAnim.preset !== 'scramble';
    const digitMorphMode = el.changeAnim?.preset === 'digitMorph';
    const gooeyMode = el.changeAnim?.preset === 'gooeyMorph';
    const digitMorphFill = hexToRgba(typeof el.config.color === 'string' ? el.config.color : '#ffffff', el.config.colorOpacity ?? 100);
    const digitH = fitFontSize;
    const digitW = digitH * (SEVEN_SEG_WIDTH / SEVEN_SEG_HEIGHT);
    content = (
      <div ref={(node) => { textRef.current = node; changeAnimNodeRef.current = node; }} style={{
        width: '100%', height: '100%', display: 'flex',
        alignItems: valign === 'top' ? 'flex-start' : valign === 'bottom' ? 'flex-end' : 'center',
        justifyContent: el.config.align === 'left' ? 'flex-start' : el.config.align === 'right' ? 'flex-end' : 'center',
        fontSize: fitFontSize,
        fontFamily: fontFamilyCss(el.config.fontFamily),
        background: resolveBackground(el.config.bgColor, 'transparent'),
        ...(!isGradientText ? gradientColor : null),
        fontWeight: el.config.bold ? 700 : 400,
        whiteSpace: wordWrap ? 'normal' : 'nowrap',
        overflowWrap: wordWrap ? 'break-word' : undefined,
        wordBreak: wordWrap ? 'break-word' : undefined,
        overflow: 'hidden',
        position: 'relative',
        // See CgTemplateWidget.tsx's identical text stroke comment.
        WebkitTextStroke: el.config.strokeWidth ? `${el.config.strokeWidth}px ${el.config.stroke ?? '#000000'}` : undefined,
      }}>
        {gooeyMode ? (
          <>
            <span ref={gooeyPrevRef} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'inherit', justifyContent: 'inherit' }} />
            <span ref={gooeyNextRef} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'inherit', justifyContent: 'inherit' }}>{textContent}</span>
          </>
        ) : digitMorphMode ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: digitW * 0.15 }}>
            {[...(textContent ?? '')].map((ch, i) => {
              if (isSevenSegmentDigit(ch)) {
                return (
                  <svg key={i} viewBox={SEVEN_SEG_VIEWBOX} width={digitW} height={digitH} style={{ flexShrink: 0, overflow: 'visible' }}>
                    {SEGMENT_NAMES.map((name, segIdx) => (
                      <path
                        key={name}
                        ref={(node) => {
                          if (!segmentRefs.current[i]) segmentRefs.current[i] = [];
                          segmentRefs.current[i][segIdx] = node;
                          // Set only once on mount — see CgTemplateWidget.tsx's
                          // identical comment: every update after that is
                          // exclusively GSAP's own morphSVG tween.
                          if (node && node.getAttribute('d') === null) node.setAttribute('d', segmentPathFor(name, ch));
                        }}
                        fill={digitMorphFill}
                      />
                    ))}
                  </svg>
                );
              }
              if (ch === ':') {
                const [top, bottom] = colonDotPaths();
                return (
                  <svg key={i} viewBox={SEVEN_SEG_VIEWBOX} width={digitW * 0.4} height={digitH} style={{ flexShrink: 0, overflow: 'visible' }}>
                    <path d={top} fill={digitMorphFill} />
                    <path d={bottom} fill={digitMorphFill} />
                  </svg>
                );
              }
              return <span key={i}>{ch === ' ' ? ' ' : ch}</span>;
            })}
          </span>
        ) : perCharMode ? (
          <span style={{ display: 'inline-block' }}>
            {[...(textContent ?? '')].map((ch, i) => (
              <span key={i} ref={(node) => { charRefs.current[i] = node; }} style={{ display: 'inline-block' }}>
                {ch === ' ' ? ' ' : ch}
              </span>
            ))}
          </span>
        ) : isGradientText ? <span style={gradientColor}>{textContent}</span> : textContent}
      </div>
    );
  }

  return (
    <div
      ref={conditionsRef}
      style={{
        width: '100%', height: '100%',
        // See CgTemplateWidget.tsx's identical addition's own comment.
        mixBlendMode: (el.config.blendMode && el.config.blendMode !== 'normal') ? el.config.blendMode : undefined,
        overflow: el.config.clipToBounds ? 'hidden' : undefined,
      }}
    >
      {animatedBgStyleObj && (
        <div
          ref={animatedBgRef}
          style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            clipPath: hasMask ? `url(#${instanceId}-mask-${el.maskId})` : undefined,
            borderRadius: el.config.borderRadius,
            background: animatedBgStyleObj.background,
            backgroundSize: animatedBgStyleObj.backgroundSize,
            filter: animatedBgStyleObj.staticFilter,
            ...(animatedBgMask ? {
              WebkitMaskImage: animatedBgMask.maskImage, maskImage: animatedBgMask.maskImage,
              WebkitMaskSize: animatedBgMask.maskSize, maskSize: animatedBgMask.maskSize,
              WebkitMaskPosition: animatedBgMask.maskPosition, maskPosition: animatedBgMask.maskPosition,
              WebkitMaskRepeat: animatedBgMask.maskRepeat, maskRepeat: animatedBgMask.maskRepeat,
            } : null),
          }}
        />
      )}
      {content}
      {sweepGeom && (
        <div style={{
          position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', mixBlendMode: 'screen',
          ...(sweepMask ? {
            WebkitMaskImage: sweepMask.maskImage, maskImage: sweepMask.maskImage,
            WebkitMaskSize: sweepMask.maskSize, maskSize: sweepMask.maskSize,
            WebkitMaskPosition: sweepMask.maskPosition, maskPosition: sweepMask.maskPosition,
            WebkitMaskRepeat: sweepMask.maskRepeat, maskRepeat: sweepMask.maskRepeat,
          } : null),
        }}>
          <div style={{ position: 'absolute', left: sweepGeom.left, top: sweepGeom.top, width: sweepGeom.boxSize, height: sweepGeom.boxSize, transform: `rotate(${lightSweepEffect!.angle ?? 115}deg)` }}>
            <div ref={sweepBandRef} style={{ position: 'absolute', inset: 0, background: sweepGeom.gradient }} />
          </div>
        </div>
      )}
      {/* 'stroke' effect's own ring — mirrors CgTemplateWidget.tsx's
         identical addition exactly, see its own long comment for why this
         sits inside the same filter-bearing subtree as the rest of this
         element's content (so dropShadow/glow wrap around it too, gap
         included) and why its own glow is a separate, narrower filter. */}
      {strokeGeom && strokeEffect && (
        <svg
          viewBox={strokeGeom.viewBox}
          width={strokeGeom.boxW}
          height={strokeGeom.boxH}
          style={{ position: 'absolute', left: strokeGeom.left, top: strokeGeom.top, overflow: 'visible', pointerEvents: 'none', filter: strokeGlowFilter || undefined }}
        >
          {strokeGeom.rect ? (
            <rect
              ref={(node) => { strokeNodeRef.current = node; }}
              x={strokeGeom.rect.x} y={strokeGeom.rect.y} width={strokeGeom.rect.width} height={strokeGeom.rect.height} rx={strokeGeom.rect.rx}
              fill="none"
              stroke={hexToRgba(strokeEffect.color ?? '#ffffff', strokeEffect.opacity ?? 100)}
              strokeWidth={strokeEffect.strokeWidth ?? 3}
            />
          ) : (
            <g transform={strokeGeom.groupTransform}>
              <path
                ref={(node) => { strokeNodeRef.current = node; }}
                d={strokeGeom.d}
                fill="none"
                stroke={hexToRgba(strokeEffect.color ?? '#ffffff', strokeEffect.opacity ?? 100)}
                strokeWidth={strokeEffect.strokeWidth ?? 3}
              />
            </g>
          )}
        </svg>
      )}
    </div>
  );
}

// Font dropdown (curated Google Fonts, loaded on demand — see lib/cgFonts.ts)
// plus a free-text fallback for anything else (a font already installed
// locally, e.g. a corporate brand font on the playout machine). `customMode`
// is local UI state, never itself written to config — it only decides
// whether the free-text input is showing — so callers MUST pass
// `key={el.id}` (every call site here does): without it, switching which
// element is selected would reuse this same component instance and leave
// customMode stuck from whichever element was selected before, instead of
// re-deriving fresh from the newly-selected element's own value.
// A searchable dropdown — not a plain <select> — specifically so every
// Google Font in the (100+ entry) list can show as a real, live sample of
// ITSELF (its own name, rendered in its own face) rather than just plain
// text naming it: a <select>'s own <option> elements can't reliably render
// per-option font-family across platforms/WebKit, and 100+ plain names alone
// tell an operator nothing about what a font actually looks like. Opens via
// a portal into document.body (same reasoning as LogoUrlPicker.tsx's own
// popup — the Inspector panel this lives in scrolls, which would clip a
// plain absolutely-positioned dropdown extending past its visible area).
function FontPicker({ value, onChange }: { value: string | undefined; onChange: (v: string | undefined) => void }) {
  const isGoogleFont = !!value && GOOGLE_FONTS.includes(value);
  const [customMode, setCustomMode] = useState(!!value && !isGoogleFont);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = GOOGLE_FONTS.filter((f) => f.toLowerCase().includes(query.trim().toLowerCase()));

  // Every font currently on screen in the list gets its own real preview —
  // loaded once, in one batched request, the moment the dropdown opens (not
  // on every keystroke while searching: narrowing the list never needs
  // fonts that were already fetched to load again, and ensureGoogleFontsLoaded
  // is itself a no-op per-font once loaded, so this only ever grows the set).
  useEffect(() => {
    if (!open) return;
    ensureGoogleFontsLoaded(GOOGLE_FONTS);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (anchorRef.current) {
      const r = anchorRef.current.getBoundingClientRect();
      setPos({ left: r.left, top: r.bottom + 4, width: r.width });
    }
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node) &&
          anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const pick = (f: string | undefined) => {
    setCustomMode(false);
    onChange(f);
    setOpen(false);
    setQuery('');
  };

  const displayLabel = customMode ? 'Custom / local font…' : (value || 'Default');
  const displayFont = !customMode && isGoogleFont ? fontFamilyCss(value) : undefined;

  const dropdown = pos && (
    <div
      ref={popupRef}
      style={{
        position: 'fixed', left: pos.left, top: pos.top, width: Math.max(pos.width, 260), zIndex: 10000,
        background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 6,
        boxShadow: '0 4px 16px rgba(0,0,0,.5)', display: 'flex', flexDirection: 'column', maxHeight: 320,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
        <Search size={12} strokeWidth={2} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <input
          ref={searchRef}
          className="field-input"
          style={{ border: 'none', padding: '2px 0', background: 'transparent' }}
          placeholder="Search fonts…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        />
      </div>
      <div style={{ overflowY: 'auto' }}>
        <div
          onClick={() => pick(undefined)}
          style={{ padding: '7px 10px', cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}
          className="font-picker-row"
        >
          Default
        </div>
        {filtered.map((f) => (
          <div
            key={f}
            onClick={() => pick(f)}
            title={f}
            style={{ padding: '7px 10px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}
            className="font-picker-row"
          >
            <span style={{ fontFamily: fontFamilyCss(f), fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f}</span>
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ padding: '10px', fontSize: 12, color: 'var(--text-muted)' }}>No fonts match "{query}"</div>
        )}
        <div
          onClick={() => { setCustomMode(true); setOpen(false); setQuery(''); }}
          style={{ padding: '7px 10px', cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}
          className="font-picker-row"
        >
          Custom / local font…
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div ref={anchorRef}>
        <button
          type="button"
          className="field-input"
          onClick={() => setOpen((v) => !v)}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', textAlign: 'left', cursor: 'pointer' }}
        >
          <span style={{ fontFamily: displayFont, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayLabel}</span>
          <ChevronDown size={12} strokeWidth={2} style={{ flexShrink: 0, opacity: 0.6 }} />
        </button>
      </div>
      {open && dropdown && createPortal(dropdown, document.body)}
      {customMode && (
        <input
          className="field-input"
          placeholder="Exact font name installed on this machine"
          value={isGoogleFont ? '' : (value ?? '')}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      )}
    </div>
  );
}

// One side of a 'statbar' element — same "Data source" binding UI the
// single el.binding field already uses elsewhere in this file (bind to any
// widget, any bindable field — see lib/templateBinding.ts), duplicated
// rather than shared with that one because a statbar needs TWO independent
// instances of it (bindingA/bindingB) where every other bindable kind only
// ever needs one. Unbound, it's a plain static number input instead of a
// text/URL field, since a bar's own two sides are always numeric.
// The authored word list for a 'text' element's 'wordSequence' preset (see
// cgAnimationEngine.ts's buildWordSequence) — same Add/Remove-row shape as
// StatBarRow's own editor further down, just simpler (two plain fields per
// row instead of full color/binding pickers).
function WordSequenceFields({ items, onChange }: {
  items: CgWordSequenceItem[];
  onChange: (items: CgWordSequenceItem[]) => void;
}) {
  const update = (id: string, patch: Partial<CgWordSequenceItem>) =>
    onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  return (
    <div className="field-row">
      <label className="field-label" title="Each word's own hold time — the next one replaces it once that runs out. Not computed from word length; set it however dramatic you want that word to be.">Words</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
        {items.map((item, i) => (
          <div key={item.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 16, textAlign: 'right' }}>{i + 1}</span>
            <input className="field-input" style={{ flex: 1 }} placeholder="word" value={item.word} onChange={(e) => update(item.id, { word: e.target.value })} />
            <input className="field-input" style={{ width: 64 }} type="number" min={0.02} step={0.05} value={item.duration}
              onChange={(e) => update(item.id, { duration: Math.max(0.02, Number(e.target.value) || 0.15) })} title="Seconds" />
            <button className="tplt-track-remove" title="Remove word" onClick={() => onChange(items.filter((it) => it.id !== item.id))}>
              <X size={11} strokeWidth={2} />
            </button>
          </div>
        ))}
        <button className="cgo-copy-btn" onClick={() => onChange([...items, { id: crypto.randomUUID(), word: '', duration: 0.15 }])}>
          <PlusIcon size={12} strokeWidth={2} /> Add Word
        </button>
      </div>
    </div>
  );
}

// Editor for a `groupSlot` binding (see canvas.ts's own doc comment) — a
// tournament + group + 1-based position + which of that slot's own team
// fields to show, entirely independent of any widget on the canvas.
function GroupSlotBindingFields({ binding, onChange }: {
  binding: TemplateElementBinding;
  onChange: (b: TemplateElementBinding | undefined) => void;
}) {
  const { tournaments } = useTournamentStore();
  const slot = binding.groupSlot!;
  const tournament = tournaments.find((t) => t.id === slot.tournamentId);
  const groups = tournament?.groups ?? [];
  const update = (patch: Partial<typeof slot>) => onChange({ ...binding, groupSlot: { ...slot, ...patch } });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Group Draw</span>
        <button className="cgo-copy-btn" onClick={() => onChange(undefined)}><Unlink size={12} strokeWidth={2} /> Unbind</button>
      </div>
      <select className="field-input" value={slot.tournamentId} onChange={(e) => update({ tournamentId: e.target.value, group: '' })}>
        <option value="">— choose tournament —</option>
        {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <select className="field-input" value={slot.group} disabled={groups.length === 0} onChange={(e) => update({ group: e.target.value })}>
        <option value="">— choose group —</option>
        {groups.map((g) => <option key={g.name} value={g.name}>{g.name}</option>)}
      </select>
      <div className="field-row" style={{ padding: 0 }}>
        <label className="field-label">Slot #</label>
        <input className="field-input" type="number" min={1} style={{ width: 60 }}
          value={slot.position} onChange={(e) => update({ position: Math.max(1, Number(e.target.value) || 1) })} />
      </div>
      <select className="field-input" value={binding.key} onChange={(e) => onChange({ ...binding, key: e.target.value })}>
        {GROUP_SLOT_PARTS.map((p) => <option key={p.key} value={p.key}>{p.label} ({p.sample})</option>)}
      </select>
    </div>
  );
}

// Editor for a `tournamentField` binding (see canvas.ts's own doc comment) —
// a tournament + which field (its own logo, or one category's logo),
// entirely independent of any widget on the canvas — same shape as
// GroupSlotBindingFields above, just for Tournament.logo/categoryLogos.
function TournamentFieldBindingFields({ binding, onChange }: {
  binding: TemplateElementBinding;
  onChange: (b: TemplateElementBinding | undefined) => void;
}) {
  const { tournaments } = useTournamentStore();
  const tf = binding.tournamentField!;
  const tournament = tournaments.find((t) => t.id === tf.tournamentId);
  const categories = tournament?.categories ?? [];
  const update = (patch: Partial<typeof tf>) => onChange({ ...binding, tournamentField: { ...tf, ...patch } });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Tournament</span>
        <button className="cgo-copy-btn" onClick={() => onChange(undefined)}><Unlink size={12} strokeWidth={2} /> Unbind</button>
      </div>
      <select className="field-input" value={tf.tournamentId} onChange={(e) => update({ tournamentId: e.target.value, category: '' })}>
        <option value="">— choose tournament —</option>
        {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <select className="field-input" value={binding.key} onChange={(e) => onChange({ ...binding, key: e.target.value })}>
        {TOURNAMENT_FIELD_PARTS.map((p) => <option key={p.key} value={p.key}>{p.label} ({p.sample})</option>)}
      </select>
      {binding.key === 'categoryLogo' && (
        <select className="field-input" value={tf.category ?? ''} disabled={categories.length === 0} onChange={(e) => update({ category: e.target.value })}>
          <option value="">— choose category —</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      )}
    </div>
  );
}

function StatbarSidePicker({ label, binding, otherWidgets, onBindingChange, staticValue, onStaticChange }: {
  label: string;
  binding: TemplateElementBinding | undefined;
  otherWidgets: CanvasWidget[];
  onBindingChange: (b: TemplateElementBinding | undefined) => void;
  staticValue: number;
  onStaticChange: (v: number) => void;
}) {
  const sourceWidget = binding ? otherWidgets.find((w) => w.id === binding.sourceWidgetId) : null;
  const parts = sourceWidget ? getBindableParts(sourceWidget) : [];
  return (
    <div className="field-row">
      <label className="field-label">{label}</label>
      {binding ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Bound</span>
            <button className="cgo-copy-btn" onClick={() => onBindingChange(undefined)}><Unlink size={12} strokeWidth={2} /> Unbind</button>
          </div>
          <select className="field-input" value={binding.sourceWidgetId}
            onChange={(e) => onBindingChange({ sourceWidgetId: e.target.value, key: '' })}>
            {otherWidgets.map((w) => <option key={w.id} value={w.id}>{w.label || WIDGET_TYPE_LABELS[w.type]}</option>)}
          </select>
          <select className="field-input" value={binding.key}
            onChange={(e) => onBindingChange({ sourceWidgetId: binding.sourceWidgetId, key: e.target.value })}>
            <option value="">— choose field —</option>
            {parts.map((p) => <option key={p.key} value={p.key}>{p.label} ({p.sample})</option>)}
          </select>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input className="field-input" type="number" style={{ width: 80 }} value={staticValue} onChange={(e) => onStaticChange(Number(e.target.value) || 0)} />
          <button className="cgo-copy-btn" disabled={otherWidgets.length === 0}
            onClick={() => onBindingChange({ sourceWidgetId: otherWidgets[0]?.id, key: '' })}>
            <Link2 size={12} strokeWidth={2} /> Bind…
          </button>
        </div>
      )}
    </div>
  );
}

function ElementInspector({ el, elements, otherWidgets, onConfigChange, onBindingChange, onConditionsChange, onReplaceFrames, onSetParent, onSetMask, onSetMatchRole, onSetStandingsRole, onSetBracketRole, onChangeAnimChange, onPositionChange, libraryWidgets, onEditCardTemplate, onNewCardTemplate }: {
  el: TemplateElement;
  elements: TemplateElement[];
  otherWidgets: CanvasWidget[];
  onConfigChange: (patch: Record<string, any>) => void;
  onBindingChange: (b: TemplateElementBinding | undefined) => void;
  /** "Variables" — zero or more live if-this-value rules, see
   *  ElementCondition's own doc comment in types/canvas.ts. */
  onConditionsChange: (c: ElementCondition[] | undefined) => void;
  onReplaceFrames: () => void;
  onSetParent: (parentId: string | undefined) => void;
  onSetMask: (maskId: string | undefined) => void;
  /** 'text'/'image' only — see TemplateElement's own `matchRole` doc
   *  comment. A dedicated callback, same reasoning onSetParent/onSetMask
   *  already have — it's a top-level TemplateElement field, not part of
   *  `config`, so it can't go through onConfigChange. */
  onSetMatchRole: (role: MatchScheduleRole | undefined) => void;
  /** Same idea as `onSetMatchRole` just above, for `standingsRole`/
   *  `bracketRole` instead — see TemplateElement's own doc comments on
   *  those fields. */
  onSetStandingsRole: (role: StandingsRole | undefined) => void;
  onSetBracketRole: (role: BracketMatchRole | undefined) => void;
  onChangeAnimChange: (v: CgChangeAnim | undefined) => void;
  /** Transform panel's own Location X/Y — plain el.x/el.y, the same
   *  position dragging already sets, just editable by number too (Blender's
   *  own Object Properties panel always has both a viewport gizmo AND
   *  numeric fields for the same value). */
  onPositionChange: (x: number, y: number) => void;
  /** 'cardCarousel' only — every CG Template Library entry, for the "which
   *  style does this card use" picker. */
  libraryWidgets: CanvasWidget[];
  /** 'cardCarousel' only — opens a SECOND, stacked CgTemplateDesigner for
   *  the given library template id (see CgTemplateDesigner's own
   *  editingCardTemplateId). */
  onEditCardTemplate: (templateId: string) => void;
  /** 'cardCarousel' only — creates a fresh, blank CG Template Library entry
   *  and returns its new id (so the caller can both assign it to the card
   *  AND immediately open it via onEditCardTemplate). */
  onNewCardTemplate: () => string;
}) {
  // 'matchSchedule' only — every authored tournament, for the "which
  // fixtures does this filter down to" picker, plus the currently-filtered
  // match list itself, for the per-match "Custom Style" override list
  // below. Called unconditionally (same "always call, only use it for the
  // right kind" convention as every other per-kind hook in this file) —
  // harmless/free for any other kind, since nothing reads the result then.
  const { tournaments } = useTournamentStore();
  const matchScheduleInspectorData = useMatchScheduleData(el.config.tournamentId, el.config.group);
  // 'standings'/'bracket' only — same unconditional-call convention as
  // matchScheduleInspectorData just above.
  const standingsInspectorData = useStandingsData(el.config.tournamentId, el.config.group, el.config.category);
  const bracketInspectorData = useBracketData(el.config.tournamentId, el.config.category, el.config.tier);
  // 'sequence' only — while a "Consolidate to 1 file" re-pack is in flight
  // (a real network round-trip per frame, not instant like every other
  // field here).
  const [consolidatingSequence, setConsolidatingSequence] = useState(false);
  // 'statbar' only — a row's own patch, and a fresh id generator for
  // "+ Add Row" — kept here (not a standalone helper) since every use
  // needs `el.config.rows` in scope anyway.
  const statbarRowsCfg: StatBarRow[] = el.config.rows ?? [];
  const updateStatbarRow = (id: string, patch: Partial<StatBarRow>) =>
    onConfigChange({ rows: statbarRowsCfg.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  // 'credits' only — same "kept here, needs el.config in scope" reasoning
  // as statbar's rows just above.
  const creditsSectionsCfg: CreditsSection[] = el.config.sections ?? [];
  const updateCreditsSection = (si: number, patch: Partial<CreditsSection>) =>
    onConfigChange({ sections: creditsSectionsCfg.map((s, i) => (i === si ? { ...s, ...patch } : s)) });
  const removeCreditsSection = (si: number) =>
    onConfigChange({ sections: creditsSectionsCfg.filter((_, i) => i !== si) });
  const addCreditsEntry = (si: number) =>
    onConfigChange({ sections: creditsSectionsCfg.map((s, i) => (i === si ? { ...s, entries: [...s.entries, { id: crypto.randomUUID(), name: '' }] } : s)) });
  const updateCreditsEntry = (si: number, ei: number, patch: Partial<CreditsEntry>) =>
    onConfigChange({ sections: creditsSectionsCfg.map((s, i) => (i === si ? { ...s, entries: s.entries.map((e, j) => (j === ei ? { ...e, ...patch } : e)) } : s)) });
  const removeCreditsEntry = (si: number, ei: number) =>
    onConfigChange({ sections: creditsSectionsCfg.map((s, i) => (i === si ? { ...s, entries: s.entries.filter((_, j) => j !== ei) } : s)) });
  const sourceWidget = el.binding ? otherWidgets.find((w) => w.id === el.binding!.sourceWidgetId) : null;
  const parts = sourceWidget ? getBindableParts(sourceWidget) : [];

  // A candidate parent can't be this element itself or any of its own
  // descendants — either would create a render/data cycle. Walks the
  // candidate's own ancestor chain looking for `el.id`.
  const isDescendant = (candidateId: string): boolean => {
    let cur = elements.find((e) => e.id === candidateId);
    const seen = new Set<string>();
    while (cur?.parentId) {
      if (cur.parentId === el.id || seen.has(cur.parentId)) return true;
      seen.add(cur.parentId);
      cur = elements.find((e) => e.id === cur!.parentId);
    }
    return false;
  };
  const parentCandidates = elements.filter((e) => e.id !== el.id && !isDescendant(e.id));
  const maskCandidates = elements.filter((e) => e.id !== el.id && e.kind === 'shape');
  // scene3D is only meaningful once this element actually HAS children to
  // share a 3D space between — hidden otherwise rather than shown disabled,
  // consistent with how this whole panel already hides kind-specific
  // sections rather than graying them out.
  const hasOwnChildren = elements.some((e) => e.parentId === el.id);

  return (
    <div className="tpld-fields">
      <div className="tpld-fields-label">{el.config?.isGroup ? 'Group' : KIND_LABEL[el.kind]}</div>

      {(el.kind === 'text' || el.kind === 'image' || el.kind === 'ticker') && (
        <div className="field-row">
          <label className="field-label">Data source</label>
          {el.binding?.groupSlot ? (
            <GroupSlotBindingFields binding={el.binding} onChange={onBindingChange} />
          ) : el.binding?.tournamentField ? (
            <TournamentFieldBindingFields binding={el.binding} onChange={onBindingChange} />
          ) : el.binding ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Bound</span>
                <button className="cgo-copy-btn" onClick={() => onBindingChange(undefined)}><Unlink size={12} strokeWidth={2} /> Unbind</button>
              </div>
              <select className="field-input" value={el.binding.sourceWidgetId}
                onChange={(e) => onBindingChange({ sourceWidgetId: e.target.value, key: '' })}>
                {otherWidgets.map((w) => (
                  <option key={w.id} value={w.id}>{w.label || WIDGET_TYPE_LABELS[w.type]}</option>
                ))}
              </select>
              <select className="field-input" value={el.binding.key}
                onChange={(e) => onBindingChange({ sourceWidgetId: el.binding!.sourceWidgetId, key: e.target.value })}>
                <option value="">— choose field —</option>
                {parts.map((p) => <option key={p.key} value={p.key}>{p.label} ({p.sample})</option>)}
              </select>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
              <button className="cgo-copy-btn" disabled={otherWidgets.length === 0}
                onClick={() => onBindingChange({ sourceWidgetId: otherWidgets[0]?.id, key: '' })}>
                <Link2 size={12} strokeWidth={2} /> Bind to a widget…
              </button>
              <button className="cgo-copy-btn"
                title="Bind directly to a team's own group-draw slot (Group A, position 2, etc.) from the Team Database — no widget needed, updates itself the moment the actual draw assigns a team there."
                onClick={() => onBindingChange({ key: 'name', groupSlot: { tournamentId: '', group: '', position: 1 } })}>
                <Users size={12} strokeWidth={2} /> Bind to Group Draw…
              </button>
              <button className="cgo-copy-btn"
                title="Bind directly to a tournament's own logo, or one category's own logo — no widget needed, updates itself the moment the logo is changed in the Tournament Database."
                onClick={() => onBindingChange({ key: 'logo', tournamentField: { tournamentId: '' } })}>
                <Trophy size={12} strokeWidth={2} /> Bind to Tournament…
              </button>
            </div>
          )}
        </div>
      )}

      {(el.kind === 'text' || el.kind === 'image') && (
        <div className="field-row">
          <label className="field-label" title="Plays a brief transition on this element's own displayed value whenever it changes WHILE already on air (a live score ticking over, a name swapping in) instead of the new value just snapping in — unrelated to the In/Loop/Out states above.">On Value Change</label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="checkbox"
              checked={!!el.changeAnim}
              onChange={(e) => onChangeAnimChange(e.target.checked ? { preset: el.changeAnim?.preset ?? 'fall', duration: el.changeAnim?.duration ?? 0.4 } : undefined)}
            />
            {el.changeAnim ? (
              <>
                <select
                  className="field-input" style={{ fontSize: 11, width: 90 }}
                  value={el.changeAnim.preset}
                  onChange={(e) => onChangeAnimChange({ ...el.changeAnim!, preset: e.target.value as CgChangeAnim['preset'] })}
                >
                  {CHANGE_ANIM_PRESETS.filter((p) => el.kind === 'text' || !TEXT_ONLY_CHANGE_PRESETS.has(p.value)).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
                <input
                  type="number" min={0.1} max={5} step={0.1} className="field-input" style={{ width: 56 }}
                  value={el.changeAnim.duration}
                  onChange={(e) => onChangeAnimChange({ ...el.changeAnim!, duration: Math.max(0.1, Number(e.target.value) || 0.4) })}
                  title="Duration (seconds)"
                />
                {el.kind === 'text' && !TEXT_ONLY_CHANGE_PRESETS.has(el.changeAnim.preset) && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)', width: '100%' }}
                    title="When the old and new values are the same length, animates ONLY the character(s) that actually changed — the rest sits still. Reads like a real scoreboard/clock digit ticking over instead of the whole value replacing itself. A length change (e.g. '9' to '10') always animates the whole value, same as this being off.">
                    <input
                      type="checkbox"
                      checked={!!el.changeAnim.perCharacter}
                      onChange={(e) => onChangeAnimChange({ ...el.changeAnim!, perCharacter: e.target.checked })}
                    />
                    Only animate the changed character(s)
                  </label>
                )}
              </>
            ) : (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Off — {el.kind === 'text' ? 'new value snaps in' : 'new image snaps in'}</span>
            )}
          </div>
        </div>
      )}

      {/* "Variables" — zero or more live if-this-value rules watching ANY
         OTHER widget's own bindable field (same catalog the Data source
         binding above uses — Timer, Scoreboard, Countdown, anything) and
         reacting to it: hide/show THIS element, or fire a one-shot preset
         animation. Available on every element kind, unlike Data
         source/On Value Change above which only make sense for
         text/image/ticker — a shape or a whole group can just as well
         want to hide once a timer hits zero. See types/canvas.ts's
         ElementCondition and lib/elementCondition.ts's own doc comments
         for exactly how each rule is evaluated. */}
      <div className="field-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label className="field-label" style={{ margin: 0 }}
            title="React live to some OTHER widget's value — hide/show this element, or play an animation, the moment it crosses a threshold. Works with Timers (counts down to 0:00), Scoreboards, Countdowns, anything bindable.">
            Variables
          </label>
          <button className="cgo-copy-btn"
            onClick={() => onConditionsChange([...(el.conditions ?? []), { operator: 'eq', value: 0, action: 'hide' }])}>
            <PlusIcon size={12} strokeWidth={2} /> Add
          </button>
        </div>
        {(el.conditions ?? []).map((cond, i) => {
          const conditions = el.conditions ?? [];
          const update = (patch: Partial<ElementCondition>) =>
            onConditionsChange(conditions.map((c, ci) => (ci === i ? { ...c, ...patch } : c)));
          const remove = () => onConditionsChange(conditions.filter((_, ci) => ci !== i));
          return (
            <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 8, marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Rule {i + 1}</span>
                <button className="cgo-copy-btn" onClick={remove}><X size={12} strokeWidth={2} /></button>
              </div>
              <StatbarSidePicker
                label="Watch"
                binding={cond.binding}
                otherWidgets={otherWidgets}
                onBindingChange={(b) => update({ binding: b })}
                staticValue={cond.staticValue ?? 0}
                onStaticChange={(v) => update({ staticValue: v })}
              />
              <div className="field-row" style={{ padding: 0 }}>
                <label className="field-label">Is</label>
                <select className="field-input" value={cond.operator} onChange={(e) => update({ operator: e.target.value as ElementCondition['operator'] })}>
                  {Object.entries(CONDITION_OPERATOR_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
                <input
                  className="field-input" style={{ width: 70 }} defaultValue={String(cond.value)}
                  key={`${i}-${cond.value}`}
                  onBlur={(e) => update({ value: parseConditionNumber(e.target.value) })}
                  title="Plain number, or mm:ss / hh:mm:ss for a Timer-bound value (e.g. type 0:00 for 'hits zero') — converted to seconds automatically to match how the live Timer value itself gets compared."
                />
              </div>
              <div className="field-row" style={{ padding: 0 }}>
                <label className="field-label">Then</label>
                <select className="field-input" value={cond.action} onChange={(e) => update({ action: e.target.value as ElementCondition['action'] })}>
                  <option value="hide">Hide this element</option>
                  <option value="show">Show this element</option>
                  <option value="animate">Play an animation</option>
                </select>
              </div>
              {cond.action === 'animate' && (
                <div className="field-row" style={{ padding: 0 }}>
                  <label className="field-label">Preset</label>
                  <select className="field-input" value={cond.animatePreset ?? PLAYLIST_TRANSITION_PRESETS[0]} onChange={(e) => update({ animatePreset: e.target.value })}>
                    {PLAYLIST_TRANSITION_PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {el.kind === 'text' && (
        <>
          {!el.binding && (
            <div className="field-row">
              <label className="field-label">Text</label>
              <input className="field-input" value={el.config.text ?? ''} onChange={(e) => onConfigChange({ text: e.target.value })} />
            </div>
          )}
          <div className="field-row">
            <label className="field-label">Font</label>
            <FontPicker key={el.id} value={el.config.fontFamily} onChange={(v) => onConfigChange({ fontFamily: v })} />
          </div>
          <div className="field-row">
            <label className="field-label">Font Size</label>
            <input className="field-input" type="number" min={8} max={200} value={el.config.fontSize ?? 14} onChange={(e) => onConfigChange({ fontSize: Number(e.target.value) })} />
          </div>
          <div className="field-row">
            <label className="field-label">Text Color</label>
            <ColorOrGradientPicker value={el.config.color} onChange={(v) => onConfigChange({ color: v })} fallback="#ffffff" />
          </div>
          <div className="field-row" title="How opaque the text's own fill is — turn this down to let a Glass-family effect on this element (or whatever's behind it) show through the letters themselves, instead of solid glyphs hiding it. 100 = fully opaque, same as every text element before this existed.">
            <label className="field-label">Text Opacity</label>
            <input className="field-input" type="number" min={0} max={100} value={el.config.colorOpacity ?? 100} onChange={(e) => onConfigChange({ colorOpacity: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />
          </div>
          <div className="field-row">
            <label className="field-label">Stroke</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <ColorPicker value={el.config.stroke && el.config.stroke !== 'none' ? el.config.stroke : '#000000'} onChange={(v) => onConfigChange({ stroke: v })} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                <input type="checkbox" checked={!el.config.strokeWidth} onChange={(e) => onConfigChange({ strokeWidth: e.target.checked ? 0 : 2 })} />
                None
              </label>
            </div>
          </div>
          {!!el.config.strokeWidth && (
            <div className="field-row">
              <label className="field-label">Stroke Width</label>
              <input className="field-input" type="number" min={0} max={30} value={el.config.strokeWidth ?? 0} onChange={(e) => onConfigChange({ strokeWidth: Math.max(0, Number(e.target.value) || 0) })} />
            </div>
          )}
          <div className="field-row">
            <label className="field-label">Background</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                <input type="checkbox" checked={!el.config.bgColor || el.config.bgColor === 'transparent'} onChange={(e) => onConfigChange({ bgColor: e.target.checked ? 'transparent' : '#000000' })} />
                Transparent
              </label>
              {el.config.bgColor && el.config.bgColor !== 'transparent' && (
                <ColorOrGradientPicker value={el.config.bgColor} onChange={(v) => onConfigChange({ bgColor: v })} fallback="#000000" />
              )}
            </div>
          </div>
          <div className="field-row">
            <label className="field-label">Bold</label>
            <input type="checkbox" checked={el.config.bold ?? false} onChange={(e) => onConfigChange({ bold: e.target.checked })} />
          </div>
          <div className="field-row">
            <label className="field-label">Align</label>
            <select className="field-input" value={el.config.align ?? 'center'} onChange={(e) => onConfigChange({ align: e.target.value })}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
          <div className="field-row">
            <label className="field-label">Vertical Align</label>
            <select className="field-input" value={el.config.valign ?? 'middle'} onChange={(e) => onConfigChange({ valign: e.target.value })}>
              <option value="top">Top</option>
              <option value="middle">Middle</option>
              <option value="bottom">Bottom</option>
            </select>
          </div>
          <div className="field-row">
            <label className="field-label">Word Wrap</label>
            <input type="checkbox" checked={el.config.wordWrap ?? true} onChange={(e) => onConfigChange({ wordWrap: e.target.checked })} />
          </div>
          <div className="field-row">
            <label className="field-label">Auto-fit</label>
            <input type="checkbox" checked={el.config.autoFit ?? false} onChange={(e) => onConfigChange({ autoFit: e.target.checked })} title="Shrink font size so the text always fits the box instead of wrapping/overflowing" />
          </div>
        </>
      )}

      {el.kind === 'ticker' && (
        <>
          {!el.binding && (
            <div className="field-row">
              <label className="field-label">Text</label>
              <input className="field-input" value={el.config.text ?? ''} onChange={(e) => onConfigChange({ text: e.target.value })} />
            </div>
          )}
          <div className="field-row">
            <label className="field-label">Font</label>
            <FontPicker key={el.id} value={el.config.fontFamily} onChange={(v) => onConfigChange({ fontFamily: v })} />
          </div>
          <div className="field-row">
            <label className="field-label">Font Size</label>
            <input className="field-input" type="number" min={8} max={200} value={el.config.fontSize ?? 32} onChange={(e) => onConfigChange({ fontSize: Number(e.target.value) })} />
          </div>
          <div className="field-row">
            <label className="field-label">Text Color</label>
            <ColorOrGradientPicker value={el.config.color} onChange={(v) => onConfigChange({ color: v })} fallback="#ffffff" />
          </div>
          <div className="field-row" title="How opaque the text's own fill is — turn this down to let a Glass-family effect on this element (or whatever's behind it) show through the letters themselves, instead of solid glyphs hiding it. 100 = fully opaque, same as every text element before this existed.">
            <label className="field-label">Text Opacity</label>
            <input className="field-input" type="number" min={0} max={100} value={el.config.colorOpacity ?? 100} onChange={(e) => onConfigChange({ colorOpacity: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />
          </div>
          <div className="field-row">
            <label className="field-label">Background</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                <input type="checkbox" checked={!el.config.bgColor || el.config.bgColor === 'transparent'} onChange={(e) => onConfigChange({ bgColor: e.target.checked ? 'transparent' : '#000000' })} />
                Transparent
              </label>
              {el.config.bgColor && el.config.bgColor !== 'transparent' && (
                <ColorOrGradientPicker value={el.config.bgColor} onChange={(v) => onConfigChange({ bgColor: v })} fallback="#000000" />
              )}
            </div>
          </div>
          <div className="field-row">
            <label className="field-label">Bold</label>
            <input type="checkbox" checked={el.config.bold ?? false} onChange={(e) => onConfigChange({ bold: e.target.checked })} />
          </div>
          <div className="field-row">
            <label className="field-label" title="Pixels per second — how fast the text scrolls, independent of how long it is">Speed (px/s)</label>
            <input className="field-input" type="number" min={10} max={2000} value={el.config.speed ?? 120} onChange={(e) => onConfigChange({ speed: Math.max(10, Number(e.target.value) || 120) })} />
          </div>
          <div className="field-row">
            <label className="field-label">Direction</label>
            <select className="field-input" value={el.config.direction ?? 'left'} onChange={(e) => onConfigChange({ direction: e.target.value })}>
              <option value="left">Right to left</option>
              <option value="right">Left to right</option>
            </select>
          </div>
          <div className="field-row">
            <label className="field-label" title="Space between the end of the text and its own repeat, as it loops">Gap (px)</label>
            <input className="field-input" type="number" min={0} max={2000} value={el.config.gap ?? 80} onChange={(e) => onConfigChange({ gap: Math.max(0, Number(e.target.value) || 0) })} />
          </div>
        </>
      )}

      {el.kind === 'statbar' && (
        <>
          <div className="tpld-fields-label" style={{ marginTop: 0 }}>Rows</div>
          {statbarRowsCfg.map((row, i) => (
            <div key={row.id} style={{ border: '1px solid var(--border, #333)', borderRadius: 6, padding: 8, marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>Row {i + 1}</span>
                <button className="tplt-track-remove" disabled={statbarRowsCfg.length <= 1} title={statbarRowsCfg.length <= 1 ? "A stat bar needs at least one row" : "Remove row"}
                  onClick={() => onConfigChange({ rows: statbarRowsCfg.filter((r) => r.id !== row.id) })}>
                  <X size={11} strokeWidth={2} />
                </button>
              </div>
              <div className="field-row">
                <label className="field-label">Label</label>
                <input className="field-input" placeholder="e.g. Possession" value={row.label ?? ''} onChange={(e) => updateStatbarRow(row.id, { label: e.target.value })} />
              </div>
              <StatbarSidePicker
                label="Side A"
                binding={row.bindingA}
                otherWidgets={otherWidgets}
                onBindingChange={(b) => updateStatbarRow(row.id, { bindingA: b })}
                staticValue={row.valueA ?? 50}
                onStaticChange={(v) => updateStatbarRow(row.id, { valueA: v })}
              />
              <div className="field-row">
                <label className="field-label">Side A Color</label>
                <ColorOrGradientPicker value={row.colorA} onChange={(v) => updateStatbarRow(row.id, { colorA: v })} fallback="#e74c3c" />
              </div>
              <StatbarSidePicker
                label="Side B"
                binding={row.bindingB}
                otherWidgets={otherWidgets}
                onBindingChange={(b) => updateStatbarRow(row.id, { bindingB: b })}
                staticValue={row.valueB ?? 50}
                onStaticChange={(v) => updateStatbarRow(row.id, { valueB: v })}
              />
              <div className="field-row">
                <label className="field-label">Side B Color</label>
                <ColorOrGradientPicker value={row.colorB} onChange={(v) => updateStatbarRow(row.id, { colorB: v })} fallback="#3498db" />
              </div>
            </div>
          ))}
          <div className="field-row">
            <button className="cgo-copy-btn" onClick={() => onConfigChange({
              rows: [...statbarRowsCfg, { id: crypto.randomUUID(), label: `Row ${statbarRowsCfg.length + 1}`, valueA: 50, valueB: 50, colorA: '#e74c3c', colorB: '#3498db' }],
            })}>
              <PlusIcon size={12} strokeWidth={2} /> Add Row
            </button>
          </div>

          <div className="tpld-fields-label" style={{ marginTop: 14 }}>Style</div>
          <div className="field-row">
            <label className="field-label" title="Every row's own two segments always split proportionally to its raw A:B ratio either way — this only changes how the value labels are worded">Value Labels</label>
            <select className="field-input" value={el.config.valueFormat ?? 'percent'} onChange={(e) => onConfigChange({ valueFormat: e.target.value })}>
              <option value="percent">Percent (e.g. 58%)</option>
              <option value="number">Raw number (e.g. 3)</option>
            </select>
          </div>
          <div className="field-row">
            <label className="field-label">Show Label</label>
            <input type="checkbox" checked={el.config.showLabel ?? true} onChange={(e) => onConfigChange({ showLabel: e.target.checked })} />
          </div>
          {(el.config.showLabel ?? true) && (
            <div className="field-row">
              <label className="field-label">Label Color</label>
              <ColorPicker value={el.config.labelColor ?? '#ffffff'} onChange={(v) => onConfigChange({ labelColor: v })} />
            </div>
          )}
          <div className="field-row">
            <label className="field-label">Show Values</label>
            <input type="checkbox" checked={el.config.showValues ?? true} onChange={(e) => onConfigChange({ showValues: e.target.checked })} />
          </div>
          <div className="field-row">
            <label className="field-label">Font Size</label>
            <input className="field-input" type="number" min={8} max={100} value={el.config.fontSize ?? 20} onChange={(e) => onConfigChange({ fontSize: Number(e.target.value) })} />
          </div>
          <div className="field-row">
            <label className="field-label">Bar Height</label>
            <input className="field-input" type="number" min={4} max={200} value={el.config.barHeight ?? 24} onChange={(e) => onConfigChange({ barHeight: Number(e.target.value) })} />
          </div>
          <div className="field-row">
            <label className="field-label" title="Empty = fully round (half the bar's own height); 0 = square corners">Bar Corner Radius</label>
            <input className="field-input" type="number" min={0} max={200} placeholder="auto" value={el.config.barRadius ?? ''} onChange={(e) => onConfigChange({ barRadius: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value) || 0) })} />
          </div>
          <div className="field-row">
            <label className="field-label">Track Color</label>
            <ColorPicker value={el.config.trackColor ?? '#333333'} onChange={(v) => onConfigChange({ trackColor: v })} title="The unfilled portion behind each row's two segments" />
          </div>
          {statbarRowsCfg.length > 1 && (
            <>
              <div className="field-row">
                <label className="field-label">Row Separator</label>
                <input type="checkbox" checked={el.config.showSeparators ?? true} onChange={(e) => onConfigChange({ showSeparators: e.target.checked })} />
              </div>
              {(el.config.showSeparators ?? true) && (
                <div className="field-row">
                  <label className="field-label">Separator Color</label>
                  <ColorPicker value={el.config.separatorColor ?? '#444444'} onChange={(v) => onConfigChange({ separatorColor: v })} />
                </div>
              )}
            </>
          )}
          <div className="field-row">
            <label className="field-label" title="How each row's bar segment eases into a new width when its value changes — pulled straight from GSAP's own ease library">Animation</label>
            <select className="field-input" value={el.config.ease ?? 'power2.out'} onChange={(e) => onConfigChange({ ease: e.target.value })}>
              {STATBAR_EASE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="field-row">
            <label className="field-label">Font</label>
            <FontPicker key={el.id} value={el.config.fontFamily} onChange={(v) => onConfigChange({ fontFamily: v })} />
          </div>
        </>
      )}

      {el.kind === 'image' && (
        <>
          {!el.binding && (
            <div className="field-row">
              <label className="field-label">Image</label>
              <LogoUrlPicker value={el.config.imageUrl ?? ''} onChange={(url) => onConfigChange({ imageUrl: url })} placeholder="Pick from library…" />
            </div>
          )}
          <div className="field-row">
            <label className="field-label">Fit</label>
            <select className="field-input" value={el.config.objectFit ?? 'contain'} onChange={(e) => onConfigChange({ objectFit: e.target.value })}>
              <option value="contain">Contain</option>
              <option value="cover">Cover</option>
              <option value="fill">Stretch</option>
              <option value="none">Original size</option>
            </select>
          </div>
          <div className="field-row">
            <label className="field-label">Background</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                <input type="checkbox" checked={!el.config.bgColor || el.config.bgColor === 'transparent'} onChange={(e) => onConfigChange({ bgColor: e.target.checked ? 'transparent' : '#000000' })} />
                Transparent
              </label>
              {el.config.bgColor && el.config.bgColor !== 'transparent' && (
                <ColorOrGradientPicker value={el.config.bgColor} onChange={(v) => onConfigChange({ bgColor: v })} fallback="#000000" />
              )}
            </div>
          </div>
        </>
      )}

      {el.kind === 'sequence' && (
        <>
          <div className="field-row">
            <label className="field-label">Frames</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{(el.config.frames ?? []).length} frame(s)</span>
              <button className="cgo-copy-btn" onClick={onReplaceFrames} disabled={!isTauri}><Film size={12} strokeWidth={2} /> Replace…</button>
              {!isSequenceConsolidated(el.config.frames ?? []) && (el.config.frames ?? []).length > 0 && (
                <button
                  className="cgo-copy-btn"
                  disabled={!isTauri || consolidatingSequence}
                  title="This sequence still has one separate file per frame in the shared images library (from before sequences were bundled into a single file) — re-packs it into one file, same as a fresh Replace… import already does."
                  onClick={async () => {
                    setConsolidatingSequence(true);
                    try {
                      const next = await consolidateSequenceFrames(el.config.frames ?? []);
                      onConfigChange({ frames: next });
                    } finally {
                      setConsolidatingSequence(false);
                    }
                  }}
                >
                  <Archive size={12} strokeWidth={2} /> {consolidatingSequence ? 'Consolidating…' : 'Consolidate to 1 file'}
                </button>
              )}
            </div>
          </div>
          <div className="field-row">
            <label className="field-label">FPS</label>
            <input className="field-input" type="number" min={1} max={60} value={el.config.fps ?? 24} onChange={(e) => onConfigChange({ fps: Number(e.target.value) })} />
          </div>
          <div className="field-row">
            <label className="field-label">Fit</label>
            <select className="field-input" value={el.config.objectFit ?? 'cover'} onChange={(e) => onConfigChange({ objectFit: e.target.value })}>
              <option value="contain">Contain</option>
              <option value="cover">Cover</option>
              <option value="fill">Stretch</option>
            </select>
          </div>
          <div className="field-row" title="Keeps cycling through these frames the whole time this element is on screen, independent of whatever state (In/Loop/Out/a Step) it's authored in — same self-contained 'just keeps going' convention a Ticker's own scroll already has. Off plays through once and holds the last frame, same as before this existed.">
            <label className="field-label">Loop</label>
            <input type="checkbox" checked={!!el.config.loop} onChange={(e) => onConfigChange({ loop: e.target.checked })} />
          </div>
          {el.config.loop && (
            <>
              <div className="field-row" title="Crossfades between frames instead of cutting instantly. Mainly useful for a low-FPS or hand-drawn sequence where a hard cut reads as choppy — a high-FPS video-like sequence usually looks best with this off (an instant cut, same as before this existed).">
                <label className="field-label">Blend</label>
                <input type="checkbox" checked={!!el.config.blend} onChange={(e) => onConfigChange({ blend: e.target.checked })} />
              </div>
              {el.config.blend && (
                <div className="field-row" title="How long each crossfade takes, in milliseconds. Too long relative to the time each frame is actually shown (1000/FPS) and consecutive crossfades start overlapping each other.">
                  <label className="field-label">Blend (ms)</label>
                  <input className="field-input" type="number" min={10} max={2000} step={10} value={el.config.blendMs ?? 150} onChange={(e) => onConfigChange({ blendMs: Math.max(10, Number(e.target.value) || 150) })} />
                </div>
              )}
            </>
          )}
        </>
      )}

      {el.kind === 'imagePlaylist' && (
        <>
          <div className="tpld-fields-label" style={{ marginTop: 0 }}>Slides</div>
          {(el.config.images ?? []).map((url: string, i: number) => {
            const images: string[] = el.config.images ?? [];
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 14, flexShrink: 0 }}>{i + 1}</span>
                <div style={{ flex: 1 }}>
                  <LogoUrlPicker value={url} onChange={(v) => { const next = [...images]; next[i] = v; onConfigChange({ images: next }); }} placeholder="Pick from library…" />
                </div>
                <button className="tplt-track-remove" title="Move up" disabled={i === 0}
                  onClick={() => { const next = [...images]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; onConfigChange({ images: next }); }}>
                  <ChevronUp size={11} strokeWidth={2} />
                </button>
                <button className="tplt-track-remove" title="Move down" disabled={i === images.length - 1}
                  onClick={() => { const next = [...images]; [next[i + 1], next[i]] = [next[i], next[i + 1]]; onConfigChange({ images: next }); }}>
                  <ChevronDown size={11} strokeWidth={2} />
                </button>
                <button className="tplt-track-remove" title="Remove slide"
                  onClick={() => onConfigChange({ images: images.filter((_, j) => j !== i) })}>
                  <X size={11} strokeWidth={2} />
                </button>
              </div>
            );
          })}
          <div className="field-row">
            <button className="cgo-copy-btn" onClick={() => onConfigChange({ images: [...(el.config.images ?? []), ''] })}>
              <PlusIcon size={12} strokeWidth={2} /> Add Slide
            </button>
          </div>

          <div className="tpld-fields-label" style={{ marginTop: 14 }}>Playback</div>
          <div className="field-row">
            <label className="field-label" title="Auto slide advances itself on a timer; Manual only advances when the operator fires CG Playout's Next Stage — the same button that advances this template's own Steps">Advance</label>
            <select className="field-input" value={el.config.advanceMode ?? 'auto'} onChange={(e) => onConfigChange({ advanceMode: e.target.value })}>
              <option value="auto">Auto slide</option>
              <option value="manual">Manual (Next Stage)</option>
            </select>
          </div>
          {(el.config.advanceMode ?? 'auto') === 'auto' && (
            <div className="field-row">
              <label className="field-label">Slide Duration</label>
              <input className="field-input" type="number" min={0.5} step={0.5} value={el.config.slideDuration ?? 4} onChange={(e) => onConfigChange({ slideDuration: Math.max(0.5, Number(e.target.value) || 4) })} />
            </div>
          )}
          <div className="field-row">
            <label className="field-label" title="At the last slide: on wraps back to the first, off just stays there">Loop</label>
            <input type="checkbox" checked={el.config.loop ?? true} onChange={(e) => onConfigChange({ loop: e.target.checked })} />
          </div>
          <div className="field-row">
            <label className="field-label">Fit</label>
            <select className="field-input" value={el.config.objectFit ?? 'cover'} onChange={(e) => onConfigChange({ objectFit: e.target.value })}>
              <option value="contain">Contain</option>
              <option value="cover">Cover</option>
              <option value="fill">Stretch</option>
            </select>
          </div>
          <div className="field-row">
            <label className="field-label">Background</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                <input type="checkbox" checked={!el.config.bgColor || el.config.bgColor === 'transparent'} onChange={(e) => onConfigChange({ bgColor: e.target.checked ? 'transparent' : '#000000' })} />
                Transparent
              </label>
              {el.config.bgColor && el.config.bgColor !== 'transparent' && (
                <ColorOrGradientPicker value={el.config.bgColor} onChange={(v) => onConfigChange({ bgColor: v })} fallback="#000000" />
              )}
            </div>
          </div>

          <div className="tpld-fields-label" style={{ marginTop: 14 }}>Transition</div>
          <div className="field-row">
            <label className="field-label" title="Almost the entire GSAP preset catalog used elsewhere in this app — same look, applied between slides instead of on entrance/exit">Preset</label>
            <select className="field-input" value={el.config.transitionPreset ?? 'fadeIn'} onChange={(e) => onConfigChange({ transitionPreset: e.target.value })}>
              {PLAYLIST_TRANSITION_PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="field-row">
            <label className="field-label">Duration</label>
            <input className="field-input" type="number" min={0.1} step={0.1} value={el.config.transitionDuration ?? 0.6} onChange={(e) => onConfigChange({ transitionDuration: Math.max(0.1, Number(e.target.value) || 0.6) })} />
          </div>
          <div className="field-row">
            <label className="field-label">Ease</label>
            <select className="field-input" value={el.config.transitionEase ?? 'power2.inOut'} onChange={(e) => onConfigChange({ transitionEase: e.target.value })}>
              {EASES.map((ez) => <option key={ez} value={ez}>{ez}</option>)}
            </select>
          </div>
        </>
      )}

      {el.kind === 'cardCarousel' && (
        <>
          <div className="tpld-fields-label" style={{ marginTop: 0 }}>Cards</div>
          {(el.config.cards ?? []).map((card: CgCarouselCard, i: number) => {
            const cards: CgCarouselCard[] = el.config.cards ?? [];
            const updateCard = (patch: Partial<CgCarouselCard>) => onConfigChange({ cards: cards.map((c) => (c.id === card.id ? { ...c, ...patch } : c)) });
            const updateOverride = (elementId: string, patch: { text?: string; imageUrl?: string }) => {
              const overrides = { ...(card.overrides ?? {}) };
              const merged = { ...(overrides[elementId] ?? {}), ...patch };
              if (merged.text === undefined && merged.imageUrl === undefined) delete overrides[elementId];
              else overrides[elementId] = merged;
              updateCard({ overrides });
            };
            const togglePlaylistSlot = (elementId: string, on: boolean) => {
              const slots = card.playlistSlots ?? [];
              updateCard({ playlistSlots: on ? [...slots, elementId] : slots.filter((id) => id !== elementId) });
            };
            const cardWidget = card.templateId ? libraryWidgets.find((w) => w.id === card.templateId) : undefined;
            const overridableEls: TemplateElement[] = (cardWidget?.config.elements ?? []).filter((e: TemplateElement) => e.kind === 'text' || e.kind === 'image');
            return (
              <div key={card.id} style={{ border: '1px solid var(--border, #333)', borderRadius: 6, padding: 8, marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>Card {i + 1}</span>
                  <button className="tplt-track-remove" title="Move up" disabled={i === 0}
                    onClick={() => { const next = [...cards]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; onConfigChange({ cards: next }); }}>
                    <ChevronUp size={11} strokeWidth={2} />
                  </button>
                  <button className="tplt-track-remove" title="Move down" disabled={i === cards.length - 1}
                    onClick={() => { const next = [...cards]; [next[i + 1], next[i]] = [next[i], next[i + 1]]; onConfigChange({ cards: next }); }}>
                    <ChevronDown size={11} strokeWidth={2} />
                  </button>
                  <button className="tplt-track-remove" title="Remove card" onClick={() => onConfigChange({ cards: cards.filter((c) => c.id !== card.id) })}>
                    <X size={11} strokeWidth={2} />
                  </button>
                </div>
                <div className="field-row">
                  <label className="field-label">Style</label>
                  <select className="field-input" value={card.templateId ?? ''} onChange={(e) => updateCard({ templateId: e.target.value || undefined })}>
                    <option value="">— pick a card style —</option>
                    {libraryWidgets.map((w) => <option key={w.id} value={w.id}>{w.label || 'Untitled'}</option>)}
                  </select>
                </div>
                <div className="field-row" style={{ padding: 0, gap: 6 }}>
                  <button className="cgo-copy-btn" disabled={!card.templateId} onClick={() => card.templateId && onEditCardTemplate(card.templateId)}>
                    <Pencil size={12} strokeWidth={2} /> Edit Style
                  </button>
                  <button className="cgo-copy-btn" title="Create a new, blank card style and assign it to this card" onClick={() => { const id = onNewCardTemplate(); updateCard({ templateId: id }); onEditCardTemplate(id); }}>
                    <PlusIcon size={12} strokeWidth={2} /> New Style
                  </button>
                </div>
                {overridableEls.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4, paddingTop: 6, borderTop: '1px solid var(--border, #333)' }}>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Content for this card (blank = use the style's own default)</span>
                    {overridableEls.map((oel, j) => {
                      const label = oel.name || `${KIND_LABEL[oel.kind]} ${j + 1}`;
                      const ov = card.overrides?.[oel.id];
                      const onPlaylist = (card.playlistSlots ?? []).includes(oel.id);
                      return (
                        <div key={oel.id} className="field-row">
                          <label className="field-label" title={label}>{label}</label>
                          {oel.kind === 'text' ? (
                            <input className="field-input" placeholder="(style default)" value={ov?.text ?? ''} onChange={(e) => updateOverride(oel.id, { text: e.target.value || undefined })} />
                          ) : onPlaylist ? (
                            <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>Slide {i + 1} of the shared images below</span>
                          ) : (
                            <LogoUrlPicker value={ov?.imageUrl ?? ''} onChange={(url) => updateOverride(oel.id, { imageUrl: url || undefined })} placeholder="(style default)" />
                          )}
                          {oel.kind === 'image' && (
                            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, whiteSpace: 'nowrap' }} title="This card's own copy of this photo comes from the carousel's shared Slide Images list below instead of a fixed picture">
                              <input type="checkbox" checked={onPlaylist} onChange={(e) => togglePlaylistSlot(oel.id, e.target.checked)} />
                              Cycle
                            </label>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          <div className="field-row">
            <button className="cgo-copy-btn" onClick={() => onConfigChange({ cards: [...(el.config.cards ?? []), { id: crypto.randomUUID() } as CgCarouselCard] })}>
              <PlusIcon size={12} strokeWidth={2} /> Add Card
            </button>
          </div>

          <div className="tpld-fields-label" style={{ marginTop: 14 }} title="Shared by every card whose image element has its own 'Cycle' checkbox on — each such card shows the slide at its own position in this list (wrapping if there are more cards than images)">Shared Slide Images</div>
          {(el.config.playlistImages ?? []).map((url: string, i: number) => {
            const images: string[] = el.config.playlistImages ?? [];
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 14, flexShrink: 0 }}>{i + 1}</span>
                <div style={{ flex: 1 }}>
                  <LogoUrlPicker value={url} onChange={(v) => { const next = [...images]; next[i] = v; onConfigChange({ playlistImages: next }); }} placeholder="Pick from library…" />
                </div>
                <button className="tplt-track-remove" title="Move up" disabled={i === 0}
                  onClick={() => { const next = [...images]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; onConfigChange({ playlistImages: next }); }}>
                  <ChevronUp size={11} strokeWidth={2} />
                </button>
                <button className="tplt-track-remove" title="Move down" disabled={i === images.length - 1}
                  onClick={() => { const next = [...images]; [next[i + 1], next[i]] = [next[i], next[i + 1]]; onConfigChange({ playlistImages: next }); }}>
                  <ChevronDown size={11} strokeWidth={2} />
                </button>
                <button className="tplt-track-remove" title="Remove"
                  onClick={() => onConfigChange({ playlistImages: images.filter((_, j) => j !== i) })}>
                  <X size={11} strokeWidth={2} />
                </button>
              </div>
            );
          })}
          <div className="field-row">
            <button className="cgo-copy-btn" onClick={() => onConfigChange({ playlistImages: [...(el.config.playlistImages ?? []), ''] })}>
              <PlusIcon size={12} strokeWidth={2} /> Add Image
            </button>
          </div>

          <div className="tpld-fields-label" style={{ marginTop: 14 }}>Playback</div>
          <div className="field-row">
            <label className="field-label" title="Auto advances itself on a timer; Manual only advances when the operator fires CG Playout's Next Stage — the same button that advances this template's own Steps">Advance</label>
            <select className="field-input" value={el.config.advanceMode ?? 'auto'} onChange={(e) => onConfigChange({ advanceMode: e.target.value })}>
              <option value="auto">Auto slide</option>
              <option value="manual">Manual (Next Stage)</option>
            </select>
          </div>
          {(el.config.advanceMode ?? 'auto') === 'auto' && (
            <div className="field-row">
              <label className="field-label">Slide Duration</label>
              <input className="field-input" type="number" min={0.5} step={0.5} value={el.config.slideDuration ?? 4} onChange={(e) => onConfigChange({ slideDuration: Math.max(0.5, Number(e.target.value) || 4) })} />
            </div>
          )}
          <div className="field-row">
            <label className="field-label" title="At the last card: on wraps back to the first, off just stays there">Loop</label>
            <input type="checkbox" checked={el.config.loop ?? true} onChange={(e) => onConfigChange({ loop: e.target.checked })} />
          </div>

          <div className="tpld-fields-label" style={{ marginTop: 14 }}>Carousel Layout</div>
          <div className="field-row">
            <label className="field-label">Style</label>
            <select className="field-input" value={el.config.carouselStyle ?? 'coverflow'} onChange={(e) => onConfigChange({ carouselStyle: e.target.value })}>
              <option value="coverflow">3D Coverflow</option>
              <option value="stack">Stacked Deck</option>
              <option value="wheel">Circular Rotation</option>
            </select>
          </div>
          <div className="field-row">
            <label className="field-label" title={el.config.carouselStyle === 'wheel' ? 'The ring\'s own radius' : 'Horizontal spacing between adjacent card centers'}>{el.config.carouselStyle === 'wheel' ? 'Ring Radius' : 'Card Gap'}</label>
            <input className="field-input" type="number" min={0} value={el.config.cardGap ?? 260} onChange={(e) => onConfigChange({ cardGap: Math.max(0, Number(e.target.value) || 0) })} />
          </div>
          <div className="field-row">
            <label className="field-label" title="How much smaller the neighboring/farthest cards render than the active one">Side Scale</label>
            <input type="range" min={0.3} max={1} step={0.05} value={el.config.sideScale ?? 0.75} onChange={(e) => onConfigChange({ sideScale: Number(e.target.value) })} />
          </div>
          <div className="field-row">
            <label className="field-label" title={el.config.carouselStyle === 'stack' ? 'How sharply the stacked cards fan out (degrees)' : el.config.carouselStyle === 'wheel' ? 'Unused for Circular Rotation — every card\'s own facing angle comes from its position on the ring instead' : '3D tilt (degrees) applied to the neighboring cards'}>Side Rotation</label>
            <input className="field-input" type="number" min={0} max={89} disabled={el.config.carouselStyle === 'wheel'} value={el.config.sideRotation ?? 35} onChange={(e) => onConfigChange({ sideRotation: Math.max(0, Math.min(89, Number(e.target.value) || 0)) })} />
          </div>
          <div className="field-row">
            <label className="field-label">Side Opacity</label>
            <input type="range" min={0} max={1} step={0.05} value={el.config.sideOpacity ?? 0.6} onChange={(e) => onConfigChange({ sideOpacity: Number(e.target.value) })} />
          </div>
          <div className="field-row">
            <label className="field-label" title="How long each card takes to reposition on advance">Transition Duration</label>
            <input className="field-input" type="number" min={0.1} step={0.1} value={el.config.transitionDuration ?? 0.6} onChange={(e) => onConfigChange({ transitionDuration: Math.max(0.1, Number(e.target.value) || 0.6) })} />
          </div>
          <div className="field-row">
            <label className="field-label">Transition Ease</label>
            <select className="field-input" value={el.config.transitionEase ?? 'power2.inOut'} onChange={(e) => onConfigChange({ transitionEase: e.target.value })}>
              {EASES.map((ez) => <option key={ez} value={ez}>{ez}</option>)}
            </select>
          </div>
        </>
      )}

      {el.kind === 'nestedTemplate' && (
        <>
          <div className="tpld-fields-label">Precompose</div>
          <p className="app-settings-hint" style={{ margin: '0 0 8px' }}>
            Embeds another CG Template Library entry as a self-contained layer — it plays its own In/Loop/Out independently, the way After Effects lets you drop one composition into another. Scaled to fit (never upscaled) and centered within this element's own box.
          </p>
          <div className="field-row">
            <label className="field-label">Template</label>
            <select className="field-input" value={el.config.templateId ?? ''} onChange={(e) => onConfigChange({ templateId: e.target.value || undefined })}>
              <option value="">— pick a template —</option>
              {libraryWidgets.map((w) => <option key={w.id} value={w.id}>{w.label || 'Untitled'}</option>)}
            </select>
          </div>
          <div className="field-row" style={{ padding: 0, gap: 6 }}>
            <button className="cgo-copy-btn" disabled={!el.config.templateId} onClick={() => el.config.templateId && onEditCardTemplate(el.config.templateId)}>
              <Pencil size={12} strokeWidth={2} /> Edit Template
            </button>
            <button className="cgo-copy-btn" title="Create a new, blank template and embed it here" onClick={() => { const id = onNewCardTemplate(); onConfigChange({ templateId: id }); onEditCardTemplate(id); }}>
              <PlusIcon size={12} strokeWidth={2} /> New Template
            </button>
          </div>
        </>
      )}

      {el.kind === 'matchSchedule' && (
        <>
          <div className="tpld-fields-label">Match Schedule</div>
          <p className="app-settings-hint" style={{ margin: '0 0 8px' }}>
            A paginated, LIVE-bound fixture list from the app's own Schedule (Tournament Manager) — each row plays an ordinary template you build once, tagging its elements with a "Match Field" (below, in that row template's own Text/Image inspector) so team names/flags/time/score fill in per match automatically.
          </p>
          <div className="field-row">
            <label className="field-label">Tournament</label>
            <select className="field-input" value={el.config.tournamentId ?? ''} onChange={(e) => onConfigChange({ tournamentId: e.target.value || undefined })}>
              <option value="">All tournaments</option>
              {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="field-row">
            <label className="field-label">Group</label>
            <input className="field-input" value={el.config.group ?? ''} onChange={(e) => onConfigChange({ group: e.target.value || undefined })} placeholder="All groups" />
          </div>
          <div className="field-row">
            <label className="field-label">Matches Per Page</label>
            <input className="field-input" type="number" min={1} max={20} value={el.config.rowsPerPage ?? 4} onChange={(e) => onConfigChange({ rowsPerPage: Math.max(1, Number(e.target.value) || 1) })} />
          </div>
          <div className="field-row">
            <label className="field-label">Row Height</label>
            <input className="field-input" type="number" min={20} value={el.config.rowHeight ?? 90} onChange={(e) => onConfigChange({ rowHeight: Math.max(20, Number(e.target.value) || 90) })} />
          </div>
          <div className="field-row">
            <label className="field-label">Row Gap</label>
            <input className="field-input" type="number" min={0} value={el.config.rowGap ?? 12} onChange={(e) => onConfigChange({ rowGap: Math.max(0, Number(e.target.value) || 0) })} />
          </div>
          <div className="field-row">
            <label className="field-label" title="Preview only — which page the Designer's own canvas shows right now. The real output always starts on page 0 and advances from there via Next Stage/auto-timer.">Preview Page</label>
            <input className="field-input" type="number" min={0} value={el.config.pageIndex ?? 0} onChange={(e) => onConfigChange({ pageIndex: Math.max(0, Number(e.target.value) || 0) })} />
          </div>
          <div className="field-row">
            <label className="field-label" title="'Manual' only turns the page when the operator fires CG Playout's Next Stage (the same button/hotkey every other manual-advance element already uses) — no separate trigger to set up. 'Auto' instead turns the page on its own timer.">Advance</label>
            <select className="field-input" value={el.config.advanceMode ?? 'manual'} onChange={(e) => onConfigChange({ advanceMode: e.target.value })}>
              <option value="manual">Manual (Next Stage)</option>
              <option value="auto">Auto</option>
            </select>
          </div>
          {(el.config.advanceMode ?? 'manual') === 'auto' && (
            <div className="field-row">
              <label className="field-label">Page Duration (s)</label>
              <input className="field-input" type="number" min={1} step={0.5} value={el.config.pageDurationSec ?? 8} onChange={(e) => onConfigChange({ pageDurationSec: Math.max(1, Number(e.target.value) || 8) })} />
            </div>
          )}
          <div className="field-row">
            <label className="field-label" title="At the last page: on wraps back to page 1; off just stays there (auto mode stops turning pages; manual mode's Next Stage becomes a no-op for this element until more fixtures are added).">
              <input type="checkbox" checked={el.config.loop ?? true} onChange={(e) => onConfigChange({ loop: e.target.checked })} /> Loop
            </label>
          </div>

          {([
            { key: 'rowTemplateId', label: 'Upcoming Row Style', hint: 'Every fixture not yet live or finished uses this design — edit it once, every upcoming row updates together.' },
            { key: 'liveRowTemplateId', label: 'Live Row Style', hint: 'Used while a fixture is the match currently loaded on any on-canvas Scoreboard. Falls back to the Upcoming style when not set — set this to make a live match visually stand out (different color/badge/layout).' },
            { key: 'finishedRowTemplateId', label: 'Finished Row Style', hint: 'Used once a fixture has a saved result. Falls back to the Upcoming style when not set.' },
          ] as const).map(({ key, label, hint }) => (
            <div key={key}>
              <div className="tpld-fields-label" title={hint}>{label}</div>
              <div className="field-row">
                <label className="field-label">Template</label>
                <select className="field-input" value={el.config[key] ?? ''} onChange={(e) => onConfigChange({ [key]: e.target.value || undefined })}>
                  <option value="">— pick a template —</option>
                  {libraryWidgets.map((w) => <option key={w.id} value={w.id}>{w.label || 'Untitled'}</option>)}
                </select>
              </div>
              <div className="field-row" style={{ padding: 0, gap: 6 }}>
                <button className="cgo-copy-btn" disabled={!el.config[key]} onClick={() => el.config[key] && onEditCardTemplate(el.config[key])}>
                  <Pencil size={12} strokeWidth={2} /> Edit Template
                </button>
                <button className="cgo-copy-btn" title="Create a new, blank template for this row style" onClick={() => { const id = onNewCardTemplate(); onConfigChange({ [key]: id }); onEditCardTemplate(id); }}>
                  <PlusIcon size={12} strokeWidth={2} /> New Template
                </button>
              </div>
            </div>
          ))}

          <div className="tpld-fields-label" style={{ marginTop: 14 }} title="A specific fixture can use its own bespoke design regardless of status — a rivalry match, a final, a sponsor-branded slot — overriding whichever of the three status styles above it would otherwise get.">Per-Match Custom Style</div>
          {matchScheduleInspectorData.matches.length === 0 ? (
            <p className="app-settings-hint" style={{ margin: '0 0 8px' }}>No fixtures match the filters above yet.</p>
          ) : (
            <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {matchScheduleInspectorData.matches.map((m) => {
                const overrides = el.config.rowOverrides ?? {};
                const current = overrides[m.id]?.templateId ?? '';
                const setOverride = (templateId: string) => {
                  const next = { ...overrides };
                  if (templateId) next[m.id] = { templateId };
                  else delete next[m.id];
                  onConfigChange({ rowOverrides: next });
                };
                return (
                  <div key={m.id} className="field-row" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <span style={{ flex: 1, fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`${m.teamAName} vs ${m.teamBName}`}>
                      {m.teamAName} vs {m.teamBName}
                    </span>
                    <select className="field-input" style={{ flex: 1 }} value={current} onChange={(e) => setOverride(e.target.value)}>
                      <option value="">(use status default)</option>
                      {libraryWidgets.map((w) => <option key={w.id} value={w.id}>{w.label || 'Untitled'}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {el.kind === 'standings' && (() => {
        const stTournament = tournaments.find((t) => t.id === el.config.tournamentId);
        const stCategories = stTournament?.categories ?? [];
        const stGroups = stTournament ? normalizeGroups(stTournament.groups).filter((g) => !el.config.category || !g.category || g.category === el.config.category) : [];
        return (
        <>
          <div className="tpld-fields-label">Standings</div>
          <p className="app-settings-hint" style={{ margin: '0 0 8px' }}>
            A paginated, LIVE-bound league/pool table from the Team Database's own saved results — each row plays an ordinary template you build once, tagging its elements with a "Standings Field" (below, in that row template's own Text/Image inspector) so rank/team/flag/W-D-L/points fill in per row automatically.
          </p>
          <div className="field-row">
            <label className="field-label">Tournament</label>
            <select className="field-input" value={el.config.tournamentId ?? ''} onChange={(e) => onConfigChange({ tournamentId: e.target.value || undefined, category: undefined, group: undefined })}>
              <option value="">— pick a tournament —</option>
              {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          {stCategories.length > 0 && (
            <div className="field-row">
              <label className="field-label">Category</label>
              <select className="field-input" value={el.config.category ?? ''} onChange={(e) => onConfigChange({ category: e.target.value || undefined, group: undefined })}>
                <option value="">All categories</option>
                {stCategories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}
          <div className="field-row">
            <label className="field-label" title="Absent = an overall table across every team in the tournament/category instead of one pool's.">Group</label>
            <select className="field-input" value={el.config.group ?? ''} onChange={(e) => onConfigChange({ group: e.target.value || undefined })}>
              <option value="">All groups (overall table)</option>
              {stGroups.map((g) => <option key={g.name} value={g.name}>{g.name}</option>)}
            </select>
          </div>
          <div className="field-row">
            <label className="field-label">Rows Per Page</label>
            <input className="field-input" type="number" min={1} max={30} value={el.config.rowsPerPage ?? 8} onChange={(e) => onConfigChange({ rowsPerPage: Math.max(1, Number(e.target.value) || 1) })} />
          </div>
          <div className="field-row">
            <label className="field-label">Row Height</label>
            <input className="field-input" type="number" min={10} value={el.config.rowHeight ?? 40} onChange={(e) => onConfigChange({ rowHeight: Math.max(10, Number(e.target.value) || 40) })} />
          </div>
          <div className="field-row">
            <label className="field-label">Row Gap</label>
            <input className="field-input" type="number" min={0} value={el.config.rowGap ?? 6} onChange={(e) => onConfigChange({ rowGap: Math.max(0, Number(e.target.value) || 0) })} />
          </div>
          <div className="field-row">
            <label className="field-label" title="Preview only — which page the Designer's own canvas shows right now. The real output always starts on page 0 and advances from there via Next Stage/auto-timer.">Preview Page</label>
            <input className="field-input" type="number" min={0} value={el.config.pageIndex ?? 0} onChange={(e) => onConfigChange({ pageIndex: Math.max(0, Number(e.target.value) || 0) })} />
          </div>
          <div className="field-row">
            <label className="field-label" title="'Manual' only turns the page when the operator fires CG Playout's Next Stage — no separate trigger to set up. 'Auto' instead turns the page on its own timer.">Advance</label>
            <select className="field-input" value={el.config.advanceMode ?? 'manual'} onChange={(e) => onConfigChange({ advanceMode: e.target.value })}>
              <option value="manual">Manual (Next Stage)</option>
              <option value="auto">Auto</option>
            </select>
          </div>
          {(el.config.advanceMode ?? 'manual') === 'auto' && (
            <div className="field-row">
              <label className="field-label">Page Duration (s)</label>
              <input className="field-input" type="number" min={1} step={0.5} value={el.config.pageDurationSec ?? 8} onChange={(e) => onConfigChange({ pageDurationSec: Math.max(1, Number(e.target.value) || 8) })} />
            </div>
          )}
          <div className="field-row">
            <label className="field-label" title="At the last page: on wraps back to page 1; off just stays there.">
              <input type="checkbox" checked={el.config.loop ?? true} onChange={(e) => onConfigChange({ loop: e.target.checked })} /> Loop
            </label>
          </div>

          <div className="tpld-fields-label" style={{ marginTop: 14 }}>Default Row Style</div>
          <div className="field-row">
            <label className="field-label">Template</label>
            <select className="field-input" value={el.config.rowTemplateId ?? ''} onChange={(e) => onConfigChange({ rowTemplateId: e.target.value || undefined })}>
              <option value="">— pick a template —</option>
              {libraryWidgets.map((w) => <option key={w.id} value={w.id}>{w.label || 'Untitled'}</option>)}
            </select>
          </div>
          <div className="field-row" style={{ padding: 0, gap: 6 }}>
            <button className="cgo-copy-btn" disabled={!el.config.rowTemplateId} onClick={() => el.config.rowTemplateId && onEditCardTemplate(el.config.rowTemplateId)}>
              <Pencil size={12} strokeWidth={2} /> Edit Template
            </button>
            <button className="cgo-copy-btn" title="Create a new, blank template for this row style" onClick={() => { const id = onNewCardTemplate(); onConfigChange({ rowTemplateId: id }); onEditCardTemplate(id); }}>
              <PlusIcon size={12} strokeWidth={2} /> New Template
            </button>
          </div>

          {([
            { countKey: 'topCount', templateKey: 'topRowTemplateId', label: 'Top Zone', hint: 'Rows 1..N use this design instead — e.g. a promotion/qualification highlight. N = 0 turns this zone off entirely.' },
            { countKey: 'bottomCount', templateKey: 'bottomRowTemplateId', label: 'Bottom Zone', hint: 'The last N rows use this design instead — e.g. a relegation highlight. N = 0 turns this zone off entirely.' },
          ] as const).map(({ countKey, templateKey, label, hint }) => (
            <div key={countKey}>
              <div className="tpld-fields-label" style={{ marginTop: 14 }} title={hint}>{label}</div>
              <div className="field-row">
                <label className="field-label">Rows (N)</label>
                <input className="field-input" type="number" min={0} value={el.config[countKey] ?? 0} onChange={(e) => onConfigChange({ [countKey]: Math.max(0, Number(e.target.value) || 0) })} />
              </div>
              {(el.config[countKey] ?? 0) > 0 && (
                <>
                  <div className="field-row">
                    <label className="field-label">Template</label>
                    <select className="field-input" value={el.config[templateKey] ?? ''} onChange={(e) => onConfigChange({ [templateKey]: e.target.value || undefined })}>
                      <option value="">(use default row style)</option>
                      {libraryWidgets.map((w) => <option key={w.id} value={w.id}>{w.label || 'Untitled'}</option>)}
                    </select>
                  </div>
                  <div className="field-row" style={{ padding: 0, gap: 6 }}>
                    <button className="cgo-copy-btn" disabled={!el.config[templateKey]} onClick={() => el.config[templateKey] && onEditCardTemplate(el.config[templateKey])}>
                      <Pencil size={12} strokeWidth={2} /> Edit Template
                    </button>
                    <button className="cgo-copy-btn" title="Create a new, blank template for this zone" onClick={() => { const id = onNewCardTemplate(); onConfigChange({ [templateKey]: id }); onEditCardTemplate(id); }}>
                      <PlusIcon size={12} strokeWidth={2} /> New Template
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}

          <div className="tpld-fields-label" style={{ marginTop: 14 }} title="One specific team can use its own bespoke design regardless of rank zone — a sponsor-branded slot, the hosts.">Per-Team Custom Style</div>
          {standingsInspectorData.rows.length === 0 ? (
            <p className="app-settings-hint" style={{ margin: '0 0 8px' }}>No teams match the filters above yet.</p>
          ) : (
            <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {standingsInspectorData.rows.map((row) => {
                const overrides = el.config.rowOverrides ?? {};
                const current = overrides[row.teamId]?.templateId ?? '';
                const setOverride = (templateId: string) => {
                  const next = { ...overrides };
                  if (templateId) next[row.teamId] = { templateId };
                  else delete next[row.teamId];
                  onConfigChange({ rowOverrides: next });
                };
                return (
                  <div key={row.teamId} className="field-row" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <span style={{ flex: 1, fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={row.name}>
                      #{row.rank} {row.name}
                    </span>
                    <select className="field-input" style={{ flex: 1 }} value={current} onChange={(e) => setOverride(e.target.value)}>
                      <option value="">(use zone default)</option>
                      {libraryWidgets.map((w) => <option key={w.id} value={w.id}>{w.label || 'Untitled'}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>
          )}
        </>
        );
      })()}

      {el.kind === 'bracket' && (() => {
        const brTournament = tournaments.find((t) => t.id === el.config.tournamentId);
        const brCategories = brTournament?.categories ?? [];
        return (
        <>
          <div className="tpld-fields-label">Bracket</div>
          <p className="app-settings-hint" style={{ margin: '0 0 8px' }}>
            A LIVE-bound knockout bracket from the app's own Schedule, laid out in stage columns — each match box plays an ordinary template you build once, tagging its elements with a "Bracket Field" (below, in that row template's own Text/Image inspector) so stage/team/flag/score fill in per match automatically.
          </p>
          <div className="field-row">
            <label className="field-label">Tournament</label>
            <select className="field-input" value={el.config.tournamentId ?? ''} onChange={(e) => onConfigChange({ tournamentId: e.target.value || undefined, category: undefined, tier: undefined })}>
              <option value="">— pick a tournament —</option>
              {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          {brCategories.length > 0 && (
            <div className="field-row">
              <label className="field-label">Category</label>
              <select className="field-input" value={el.config.category ?? ''} onChange={(e) => onConfigChange({ category: e.target.value || undefined, tier: undefined })}>
                <option value="">All categories</option>
                {brCategories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}
          {bracketInspectorData.tiers.length > 0 && (
            <div className="field-row">
              <label className="field-label" title="A Cup/Plate/Bowl/Shield split tournament's own tier.">Tier</label>
              <select className="field-input" value={el.config.tier ?? ''} onChange={(e) => onConfigChange({ tier: e.target.value || undefined })}>
                <option value="">— pick a tier —</option>
                {bracketInspectorData.tiers.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          )}
          <div className="field-row">
            <label className="field-label" title="Tacks the 3rd Place Playoff on as its own extra column after the Final.">
              <input type="checkbox" checked={!!el.config.showThirdPlace} onChange={(e) => onConfigChange({ showThirdPlace: e.target.checked })} /> Show 3rd Place
            </label>
          </div>
          <div className="field-row">
            <label className="field-label">Box Width</label>
            <input className="field-input" type="number" min={40} value={el.config.boxWidth ?? 220} onChange={(e) => onConfigChange({ boxWidth: Math.max(40, Number(e.target.value) || 220) })} />
          </div>
          <div className="field-row">
            <label className="field-label">Box Height</label>
            <input className="field-input" type="number" min={20} value={el.config.boxHeight ?? 90} onChange={(e) => onConfigChange({ boxHeight: Math.max(20, Number(e.target.value) || 90) })} />
          </div>
          <div className="field-row">
            <label className="field-label">Column Gap</label>
            <input className="field-input" type="number" min={0} value={el.config.columnGap ?? 24} onChange={(e) => onConfigChange({ columnGap: Math.max(0, Number(e.target.value) || 24) })} />
          </div>
          <div className="field-row">
            <label className="field-label">Box Gap</label>
            <input className="field-input" type="number" min={0} value={el.config.boxGap ?? 24} onChange={(e) => onConfigChange({ boxGap: Math.max(0, Number(e.target.value) || 24) })} />
          </div>

          {([
            { key: 'rowTemplateId', label: 'Upcoming Box Style', hint: 'Every match not yet live or finished uses this design — edit it once, every upcoming box updates together.' },
            { key: 'liveRowTemplateId', label: 'Live Box Style', hint: 'Used while a match is currently loaded on any on-canvas Scoreboard. Falls back to the Upcoming style when not set.' },
            { key: 'finishedRowTemplateId', label: 'Finished Box Style', hint: 'Used once a match has a saved result. Falls back to the Upcoming style when not set.' },
          ] as const).map(({ key, label, hint }) => (
            <div key={key}>
              <div className="tpld-fields-label" style={{ marginTop: 14 }} title={hint}>{label}</div>
              <div className="field-row">
                <label className="field-label">Template</label>
                <select className="field-input" value={el.config[key] ?? ''} onChange={(e) => onConfigChange({ [key]: e.target.value || undefined })}>
                  <option value="">— pick a template —</option>
                  {libraryWidgets.map((w) => <option key={w.id} value={w.id}>{w.label || 'Untitled'}</option>)}
                </select>
              </div>
              <div className="field-row" style={{ padding: 0, gap: 6 }}>
                <button className="cgo-copy-btn" disabled={!el.config[key]} onClick={() => el.config[key] && onEditCardTemplate(el.config[key])}>
                  <Pencil size={12} strokeWidth={2} /> Edit Template
                </button>
                <button className="cgo-copy-btn" title="Create a new, blank template for this box style" onClick={() => { const id = onNewCardTemplate(); onConfigChange({ [key]: id }); onEditCardTemplate(id); }}>
                  <PlusIcon size={12} strokeWidth={2} /> New Template
                </button>
              </div>
            </div>
          ))}

          <div className="tpld-fields-label" style={{ marginTop: 14 }} title="One specific match can use its own bespoke design regardless of status — a Final, a rivalry match, a sponsor-branded slot.">Per-Match Custom Style</div>
          {bracketInspectorData.matches.length === 0 ? (
            <p className="app-settings-hint" style={{ margin: '0 0 8px' }}>No knockout fixtures match the filters above yet.</p>
          ) : (
            <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {bracketInspectorData.matches.map((m) => {
                const overrides = el.config.rowOverrides ?? {};
                const current = overrides[m.id]?.templateId ?? '';
                const setOverride = (templateId: string) => {
                  const next = { ...overrides };
                  if (templateId) next[m.id] = { templateId };
                  else delete next[m.id];
                  onConfigChange({ rowOverrides: next });
                };
                return (
                  <div key={m.id} className="field-row" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <span style={{ flex: 1, fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`${m.teamAName} vs ${m.teamBName}`}>
                      {m.teamAName} vs {m.teamBName}
                    </span>
                    <select className="field-input" style={{ flex: 1 }} value={current} onChange={(e) => setOverride(e.target.value)}>
                      <option value="">(use status default)</option>
                      {libraryWidgets.map((w) => <option key={w.id} value={w.id}>{w.label || 'Untitled'}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>
          )}
        </>
        );
      })()}

      {el.kind === 'credits' && (
        <>
          <div className="field-row">
            <label className="field-label">Mode</label>
            <select className="field-input" value={el.config.mode ?? 'scroll'} onChange={(e) => onConfigChange({ mode: e.target.value })}>
              <option value="scroll">Scroll (classic crawl)</option>
              <option value="sequence">Sequence (one section at a time)</option>
            </select>
          </div>
          {(el.config.mode ?? 'scroll') === 'scroll' ? (
            <>
              <div className="field-row">
                <label className="field-label">Direction</label>
                <select className="field-input" value={el.config.scrollDirection ?? 'vertical'} onChange={(e) => onConfigChange({ scrollDirection: e.target.value })}>
                  <option value="vertical">Vertical (bottom → top)</option>
                  <option value="horizontal">Horizontal (right → left)</option>
                </select>
              </div>
              <div className="field-row">
                <label className="field-label">Scroll Speed</label>
                <input className="field-input" type="number" min={5} value={el.config.scrollSpeed ?? 60} onChange={(e) => onConfigChange({ scrollSpeed: Math.max(5, Number(e.target.value) || 60) })} title="Pixels per second" />
              </div>
              <div className="field-row">
                <label className="field-label">Loop</label>
                <input type="checkbox" checked={el.config.loop ?? true} onChange={(e) => onConfigChange({ loop: e.target.checked })} />
              </div>
            </>
          ) : (
            <>
              <div className="field-row">
                <label className="field-label">Hold Duration (s)</label>
                <input className="field-input" type="number" min={0.5} step={0.5} value={el.config.slideDuration ?? 3} onChange={(e) => onConfigChange({ slideDuration: Math.max(0.5, Number(e.target.value) || 3) })} />
              </div>
              <div className="field-row">
                <label className="field-label">Transition</label>
                <select className="field-input" value={el.config.transitionPreset ?? 'fadeIn'} onChange={(e) => onConfigChange({ transitionPreset: e.target.value })}>
                  {PLAYLIST_TRANSITION_PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="field-row">
                <label className="field-label">Transition Duration</label>
                <input className="field-input" type="number" min={0.1} step={0.1} value={el.config.transitionDuration ?? 0.6} onChange={(e) => onConfigChange({ transitionDuration: Math.max(0.1, Number(e.target.value) || 0.6) })} />
              </div>
              <div className="field-row">
                <label className="field-label">Transition Ease</label>
                <select className="field-input" value={el.config.transitionEase ?? 'power2.inOut'} onChange={(e) => onConfigChange({ transitionEase: e.target.value })}>
                  {EASES.map((ez) => <option key={ez} value={ez}>{ez}</option>)}
                </select>
              </div>
              <div className="field-row">
                <label className="field-label">Loop</label>
                <input type="checkbox" checked={el.config.loop ?? true} onChange={(e) => onConfigChange({ loop: e.target.checked })} />
              </div>
            </>
          )}

          <div className="tpld-fields-label" style={{ marginTop: 10 }}>Style</div>
          <div className="field-row">
            <label className="field-label">Font</label>
            <FontPicker key={el.id} value={el.config.fontFamily} onChange={(v) => onConfigChange({ fontFamily: v })} />
          </div>
          <div className="field-row">
            <label className="field-label">Align</label>
            <select className="field-input" value={el.config.align ?? 'center'} onChange={(e) => onConfigChange({ align: e.target.value })}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
          <div className="field-row">
            <label className="field-label">Title</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input className="field-input" type="number" min={8} style={{ width: 55 }} value={el.config.titleFontSize ?? 22} onChange={(e) => onConfigChange({ titleFontSize: Number(e.target.value) || 22 })} title="Font size" />
              <ColorPicker value={el.config.titleColor ?? '#ffffff'} onChange={(v) => onConfigChange({ titleColor: v })} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                <input type="checkbox" checked={el.config.titleBold ?? true} onChange={(e) => onConfigChange({ titleBold: e.target.checked })} /> Bold
              </label>
            </div>
          </div>
          <div className="field-row">
            <label className="field-label">Role</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input className="field-input" type="number" min={8} style={{ width: 55 }} value={el.config.roleFontSize ?? 15} onChange={(e) => onConfigChange({ roleFontSize: Number(e.target.value) || 15 })} title="Font size" />
              <ColorPicker value={el.config.roleColor ?? '#aaaaaa'} onChange={(v) => onConfigChange({ roleColor: v })} />
            </div>
          </div>
          <div className="field-row">
            <label className="field-label">Name</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input className="field-input" type="number" min={8} style={{ width: 55 }} value={el.config.nameFontSize ?? 18} onChange={(e) => onConfigChange({ nameFontSize: Number(e.target.value) || 18 })} title="Font size" />
              <ColorPicker value={el.config.nameColor ?? '#ffffff'} onChange={(v) => onConfigChange({ nameColor: v })} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                <input type="checkbox" checked={!!el.config.nameBold} onChange={(e) => onConfigChange({ nameBold: e.target.checked })} /> Bold
              </label>
            </div>
          </div>
          <div className="field-row">
            <label className="field-label">Entry Gap</label>
            <input className="field-input" type="number" min={0} style={{ width: 55 }} value={el.config.entryGap ?? 6} onChange={(e) => onConfigChange({ entryGap: Math.max(0, Number(e.target.value) || 0) })} />
          </div>
          <div className="field-row">
            <label className="field-label">Section Gap</label>
            <input className="field-input" type="number" min={0} style={{ width: 55 }} value={el.config.sectionGap ?? 36} onChange={(e) => onConfigChange({ sectionGap: Math.max(0, Number(e.target.value) || 0) })} />
          </div>
          <div className="field-row" title="Any credit given its own Logo (below) renders at this height instead of role/name text.">
            <label className="field-label">Logo Height</label>
            <input className="field-input" type="number" min={8} style={{ width: 55 }} value={el.config.logoHeight ?? 60} onChange={(e) => onConfigChange({ logoHeight: Math.max(8, Number(e.target.value) || 60) })} />
          </div>

          <div className="tpld-fields-label" style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Sections</span>
            <button className="cgo-copy-btn" onClick={() => onConfigChange({ sections: [...creditsSectionsCfg, { id: crypto.randomUUID(), title: 'New Section', entries: [] }] })}>
              <PlusIcon size={12} strokeWidth={2} /> Add Section
            </button>
          </div>
          {creditsSectionsCfg.map((section, si) => (
            <div key={section.id} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 8, marginTop: 6 }}>
              <div className="field-row" style={{ display: 'flex', flexDirection: 'row', padding: 0, gap: 4, alignItems: 'center' }}>
                <input className="field-input" placeholder="Section title (optional — e.g. SPONSORS)" value={section.title ?? ''} onChange={(e) => updateCreditsSection(si, { title: e.target.value })} />
                <button className="cgo-copy-btn" onClick={() => removeCreditsSection(si)} title="Remove section"><X size={12} strokeWidth={2} /></button>
              </div>
              {section.entries.map((entry, ei) => (
                <div key={entry.id} className="field-row" style={{ display: 'flex', flexDirection: 'row', padding: 0, marginTop: 4, gap: 4, alignItems: 'center' }}>
                  <LogoUrlPicker
                    compact thumbSize={{ w: 24, h: 24 }}
                    value={entry.logoUrl ?? ''}
                    onChange={(url) => updateCreditsEntry(si, ei, { logoUrl: url || undefined })}
                  />
                  <input className="field-input" style={{ width: 80 }} placeholder="Role (optional)" value={entry.role ?? ''} disabled={!!entry.logoUrl} title={entry.logoUrl ? 'Ignored while this credit has a logo' : undefined} onChange={(e) => updateCreditsEntry(si, ei, { role: e.target.value })} />
                  <input className="field-input" placeholder={entry.logoUrl ? 'Caption (optional)' : 'Name'} value={entry.name} onChange={(e) => updateCreditsEntry(si, ei, { name: e.target.value })} />
                  <button className="cgo-copy-btn" onClick={() => removeCreditsEntry(si, ei)} title="Remove credit"><X size={11} strokeWidth={2} /></button>
                </div>
              ))}
              <button className="cgo-copy-btn" style={{ marginTop: 6 }} onClick={() => addCreditsEntry(si)}><PlusIcon size={11} strokeWidth={2} /> Add Credit</button>
            </div>
          ))}
        </>
      )}

      {el.kind === 'rect' && (
        <>
          <div className="field-row">
            <label className="field-label">Fill</label>
            <ColorOrGradientPicker value={el.config.fill} onChange={(v) => onConfigChange({ fill: v })} fallback="#000000" />
          </div>
          <div className="field-row">
            <label className="field-label">Opacity</label>
            <input type="range" min={0} max={1} step={0.05} value={el.config.opacity ?? 1} onChange={(e) => onConfigChange({ opacity: Number(e.target.value) })} />
          </div>
          <div className="field-row">
            <label className="field-label">Corner Radius</label>
            <input className="field-input" type="number" min={0} value={el.config.borderRadius ?? 0} onChange={(e) => onConfigChange({ borderRadius: Number(e.target.value) })} />
          </div>
          <div className="field-row">
            <label className="field-label">Stroke</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <ColorPicker value={el.config.stroke && el.config.stroke !== 'none' ? el.config.stroke : '#000000'} onChange={(v) => onConfigChange({ stroke: v })} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                <input type="checkbox" checked={!el.config.strokeWidth} onChange={(e) => onConfigChange({ strokeWidth: e.target.checked ? 0 : 2 })} />
                None
              </label>
            </div>
          </div>
          {!!el.config.strokeWidth && (
            <div className="field-row">
              <label className="field-label">Stroke Width</label>
              <input className="field-input" type="number" min={0} max={60} value={el.config.strokeWidth ?? 0} onChange={(e) => onConfigChange({ strokeWidth: Math.max(0, Number(e.target.value) || 0) })} />
            </div>
          )}
        </>
      )}

      {el.kind === 'shape' && (
        <>
          <div className="field-row">
            <label className="field-label">Shape</label>
            <select className="field-input" value="" onChange={(e) => { const d = SHAPE_LIBRARY[e.target.value]; if (d) onConfigChange({ d, viewBox: SHAPE_VIEWBOX }); }}>
              <option value="">Pick from library…</option>
              {Object.keys(SHAPE_LIBRARY).map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
          <div className="field-row">
            <label className="field-label">Path (SVG d)</label>
            <textarea className="field-input" rows={3} value={el.config.d ?? ''} onChange={(e) => onConfigChange({ d: e.target.value })} placeholder="Paste a custom SVG path 'd' attribute…" />
          </div>
          <div className="field-row">
            <label className="field-label">Fill</label>
            <ColorOrGradientPicker value={el.config.fill && el.config.fill !== 'none' ? el.config.fill : undefined} onChange={(v) => onConfigChange({ fill: v })} fallback="#ffffff" />
          </div>
          <div className="field-row">
            <label className="field-label">Stroke</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <ColorPicker value={el.config.stroke && el.config.stroke !== 'none' ? el.config.stroke : '#000000'} onChange={(v) => onConfigChange({ stroke: v })} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                <input type="checkbox" checked={!el.config.stroke || el.config.stroke === 'none'} onChange={(e) => onConfigChange({ stroke: e.target.checked ? 'none' : '#000000' })} />
                None
              </label>
            </div>
          </div>
          <div className="field-row">
            <label className="field-label">Stroke Width</label>
            <input className="field-input" type="number" min={0} value={el.config.strokeWidth ?? 0} onChange={(e) => onConfigChange({ strokeWidth: Number(e.target.value) })} />
          </div>
        </>
      )}

      {(el.kind === 'text' || el.kind === 'image') && (
        <>
          <div className="tpld-fields-label" style={{ marginTop: 14 }} title="Only meaningful when this element sits inside a 'Match Schedule' element's own row template — tags which field of the CURRENT row's match this element shows, resolved fresh per match instead of a fixed value. Harmless/inert everywhere else (e.g. previewed standalone in the Template Library).">Match Field</div>
          <div className="field-row">
            <label className="field-label">Shows</label>
            <select className="field-input" value={el.matchRole ?? ''} onChange={(e) => onSetMatchRole((e.target.value || undefined) as MatchScheduleRole | undefined)}>
              <option value="">— not a match field —</option>
              {el.kind === 'text' ? (
                <>
                  <option value="teamAName">Team A Name</option>
                  <option value="teamBName">Team B Name</option>
                  <option value="teamAShortName">Team A Short Name</option>
                  <option value="teamBShortName">Team B Short Name</option>
                  <option value="group">Group</option>
                  <option value="round">Round</option>
                  <option value="venue">Venue</option>
                  <option value="date">Date</option>
                  <option value="centerText">Time / Score (auto-switches)</option>
                </>
              ) : (
                <>
                  <option value="teamALogo">Team A Logo</option>
                  <option value="teamBLogo">Team B Logo</option>
                </>
              )}
            </select>
          </div>
          <div className="tpld-fields-label" style={{ marginTop: 14 }} title="Only meaningful when this element sits inside a 'Standings' element's own row template — tags which field of the CURRENT row's team this element shows, resolved fresh per row instead of a fixed value. Harmless/inert everywhere else.">Standings Field</div>
          <div className="field-row">
            <label className="field-label">Shows</label>
            <select className="field-input" value={el.standingsRole ?? ''} onChange={(e) => onSetStandingsRole((e.target.value || undefined) as StandingsRole | undefined)}>
              <option value="">— not a standings field —</option>
              {el.kind === 'text' ? (
                <>
                  <option value="rank">Rank</option>
                  <option value="teamName">Team Name</option>
                  <option value="shortName">Team Short Name</option>
                  <option value="played">Played</option>
                  <option value="won">Won</option>
                  <option value="drawn">Drawn</option>
                  <option value="lost">Lost</option>
                  <option value="pointsFor">Points For</option>
                  <option value="pointsAgainst">Points Against</option>
                  <option value="diff">Diff (+/-)</option>
                  <option value="pts">Pts</option>
                </>
              ) : (
                <option value="teamLogo">Team Logo</option>
              )}
            </select>
          </div>
          <div className="tpld-fields-label" style={{ marginTop: 14 }} title="Only meaningful when this element sits inside a 'Bracket' element's own row template — tags which field of the CURRENT box's match this element shows, resolved fresh per match instead of a fixed value. Harmless/inert everywhere else.">Bracket Field</div>
          <div className="field-row">
            <label className="field-label">Shows</label>
            <select className="field-input" value={el.bracketRole ?? ''} onChange={(e) => onSetBracketRole((e.target.value || undefined) as BracketMatchRole | undefined)}>
              <option value="">— not a bracket field —</option>
              {el.kind === 'text' ? (
                <>
                  <option value="stage">Stage</option>
                  <option value="teamAName">Team A Name</option>
                  <option value="teamBName">Team B Name</option>
                  <option value="teamAShortName">Team A Short Name</option>
                  <option value="teamBShortName">Team B Short Name</option>
                  <option value="winner">Winner (A/B)</option>
                  <option value="centerText">Time / Score (auto-switches)</option>
                </>
              ) : (
                <>
                  <option value="teamALogo">Team A Logo</option>
                  <option value="teamBLogo">Team B Logo</option>
                </>
              )}
            </select>
          </div>
        </>
      )}

      <div className="tpld-fields-label" style={{ marginTop: 14 }} title="How this element's own rendered result (its content plus any children) composites against whatever sits behind it — see TemplateElement's own doc comment on blendMode/clipToBounds.">Blend &amp; Clip</div>
      <div className="field-row">
        <label className="field-label">Blend Mode</label>
        <select className="field-input" value={el.config.blendMode ?? 'normal'} onChange={(e) => onConfigChange({ blendMode: e.target.value })}>
          <option value="normal">Normal</option>
          <option value="multiply">Multiply</option>
          <option value="screen">Screen</option>
          <option value="overlay">Overlay</option>
          <option value="darken">Darken</option>
          <option value="lighten">Lighten</option>
          <option value="color-dodge">Color Dodge</option>
          <option value="color-burn">Color Burn</option>
          <option value="hard-light">Hard Light</option>
          <option value="soft-light">Soft Light</option>
          <option value="difference">Difference</option>
          <option value="exclusion">Exclusion</option>
          <option value="hue">Hue</option>
          <option value="saturation">Saturation</option>
          <option value="color">Color</option>
          <option value="luminosity">Luminosity</option>
        </select>
      </div>
      <div className="field-row" title="Clips this element's own content AND children to its plain rectangular w/h — the simpler, box-only sibling of the shape-based Mask below.">
        <label className="field-label">Clip Content</label>
        <input type="checkbox" checked={!!el.config.clipToBounds} onChange={(e) => onConfigChange({ clipToBounds: e.target.checked })} />
      </div>

      <div className="tpld-fields-label" style={{ marginTop: 14 }}>Parent &amp; Mask</div>
      <div className="field-row">
        <label className="field-label">Parent</label>
        <select className="field-input" value={el.parentId ?? ''} onChange={(e) => onSetParent(e.target.value || undefined)}>
          <option value="">None (root)</option>
          {parentCandidates.map((p) => <option key={p.id} value={p.id}>{p.name || KIND_LABEL[p.kind]}</option>)}
        </select>
      </div>
      <div className="field-row" title="Clips to an arbitrary shape's own path — pick another 'Shape' element as the mask. For a plain rectangular clip, use Clip Content above instead.">
        <label className="field-label">Mask</label>
        <select className="field-input" value={el.maskId ?? ''} onChange={(e) => onSetMask(e.target.value || undefined)} disabled={maskCandidates.length === 0}>
          <option value="">None</option>
          {maskCandidates.map((m) => <option key={m.id} value={m.id}>{m.name || KIND_LABEL[m.kind]}</option>)}
        </select>
      </div>

      {el.kind !== 'sound' && (
        <>
          <div className="tpld-fields-label" style={{ marginTop: 14 }} title={hasOwnChildren
            ? "Gives THIS element real 3D perspective (its own Rotate X/Y below actually foreshorten instead of looking flat/orthographic), and shares that same 3D space with its own children — their rotationX/rotationY/z keyframes (set per-child, on each child itself) then compose relative to EACH OTHER, near/far correctly occluding, instead of each rotating in its own isolated, unrelated 3D space."
            : "Gives THIS element real 3D perspective, so its own Rotate X/Y below (see 3D Pose further down) actually foreshorten like a real tilted object instead of rendering flat/orthographic. Once on, drag the orbit handle that appears above this element (while selected) to pose it interactively instead of only typing degrees — scroll on that same handle to change Perspective, the same drag-to-orbit/scroll-to-zoom split Blender's own viewport gizmo uses."
          }>3D</div>
          <div className="field-row">
            <label className="field-label" title={hasOwnChildren ? "Also applies to this element's own child elements below it." : undefined}>Enable 3D</label>
            <input type="checkbox" checked={!!el.config.scene3D} onChange={(e) => onConfigChange({ scene3D: e.target.checked })} />
          </div>
          {el.config.scene3D && (
            <div className="field-row">
              <label className="field-label">Perspective</label>
              <input className="field-input" type="number" min={100} step={50} value={el.config.scene3DPerspective ?? 800} onChange={(e) => onConfigChange({ scene3DPerspective: Number(e.target.value) })} />
            </div>
          )}

          <div className="field-row" title="Blender-style Extrude, faked with pure CSS on THIS one element — no new layers. A staircase of drop-shadow steps trailing diagonally behind it reads as a solid extruded edge, following its actual shape (glyphs, an image's own transparency, an SVG path — not just its rectangle). A flat illusion, not real per-face geometry: rotating this element in 3D moves the whole painted effect as one flat card rather than the depth re-projecting independently — for that, use '+ 3D Box' instead.">
            <label className="field-label">Extrude</label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input className="field-input" type="number" min={0} step={2} style={{ width: 55 }} value={el.config.extrudeDepth ?? 0} onChange={(e) => onConfigChange({ extrudeDepth: Math.max(0, Number(e.target.value) || 0) })} title="Depth (px) — 0 turns it off" />
              <ColorPicker value={el.config.extrudeColor ?? '#333333'} onChange={(v) => onConfigChange({ extrudeColor: v })} title="Extrude color" />
            </div>
          </div>

          <div className="tpld-fields-label" style={{ marginTop: 14 }} title="Blender's own Object Properties panel, laid out the same way: Location, Rotation, Scale. Location X/Y and Rotation Z stay ordinary GSAP-animatable properties (this element's own x/y, and a rotate/keyframe track) — this panel's OWN fields (Location Z, Rotation X/Y, every Scale) are a FIXED pose, always in effect, unlike every other transform in this app, which only ever moves during an authored animation. Used by the '+ 3D Box' template's own 6 faces to hold their shape at rest; also usable by hand to build custom 3D arrangements. On an element with its own children (a 3D Box's container, say), this poses the WHOLE group at once — set it here on the PARENT to angle the whole assembly, rather than on each child individually. Don't also give an element using these fields a position/rotation/scale preset or keyframe track for the SAME property — whichever writes last on a given render/tick wins, so the two would fight.">Transform</div>
          <div className="field-row" title="Ordinary x/y — the same position dragging this element on canvas already sets; typing here just does it by number instead.">
            <label className="field-label">Location X</label>
            <input className="field-input" type="number" value={Math.round(el.x)} onChange={(e) => onPositionChange(Number(e.target.value) || 0, el.y)} />
          </div>
          <div className="field-row">
            <label className="field-label">Location Y</label>
            <input className="field-input" type="number" value={Math.round(el.y)} onChange={(e) => onPositionChange(el.x, Number(e.target.value) || 0)} />
          </div>
          <div className="field-row" title="Pushes the element forward (+) or back (-) along the shared 3D space's depth axis, in px — no ordinary 2D equivalent, unlike X/Y above.">
            <label className="field-label">Location Z</label>
            <input className="field-input" type="number" value={el.config.staticTranslateZ ?? 0} onChange={(e) => onConfigChange({ staticTranslateZ: Number(e.target.value) || 0 })} />
          </div>
          <div className="field-row" title="Also set by dragging the orbit ball above (once Enable 3D is on) — both edit the exact same value.">
            <label className="field-label">Rotation X</label>
            <input className="field-input" type="number" value={el.config.staticRotateX ?? 0} onChange={(e) => onConfigChange({ staticRotateX: Number(e.target.value) || 0 })} />
          </div>
          <div className="field-row" title="Also set by dragging the orbit ball above (once Enable 3D is on) — both edit the exact same value.">
            <label className="field-label">Rotation Y</label>
            <input className="field-input" type="number" value={el.config.staticRotateY ?? 0} onChange={(e) => onConfigChange({ staticRotateY: Number(e.target.value) || 0 })} />
          </div>
          <div className="field-row">
            <label className="field-label">Rotation Z</label>
            <input className="field-input" type="number" value={el.config.staticRotateZ ?? 0} onChange={(e) => onConfigChange({ staticRotateZ: Number(e.target.value) || 0 })} />
          </div>
          <div className="field-row">
            <label className="field-label">Scale X</label>
            <input className="field-input" type="number" step={0.05} value={el.config.staticScaleX ?? 1} onChange={(e) => onConfigChange({ staticScaleX: Number(e.target.value) || 1 })} />
          </div>
          <div className="field-row">
            <label className="field-label">Scale Y</label>
            <input className="field-input" type="number" step={0.05} value={el.config.staticScaleY ?? 1} onChange={(e) => onConfigChange({ staticScaleY: Number(e.target.value) || 1 })} />
          </div>
          <div className="field-row" title="Only visibly does anything to a group's own CHILDREN pushed out along Z (Location Z above) — a flat leaf element has no depth of its own to scale.">
            <label className="field-label">Scale Z</label>
            <input className="field-input" type="number" step={0.05} value={el.config.staticScaleZ ?? 1} onChange={(e) => onConfigChange({ staticScaleZ: Number(e.target.value) || 1 })} />
          </div>
        </>
      )}

      {/* Effects now live in ElementPropertiesPanel (below the Mode select,
         next to the main render) — that panel needs currentState/playhead/
         etc. for its per-parameter keyframe stopwatches, none of which this
         component receives; keeping Effects state-independent here would
         have meant two disconnected places to edit the same thing. */}
    </div>
  );
}
