import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useCanvasStore, formatTime } from '../stores/canvasStore';
import { useVmixStore } from '../stores/vmixStore';
import { useTournamentStore } from '../stores/tournamentStore';
import { useTeamDbStore } from '../stores/teamDbStore';
import { useMatchScheduleStore, type ScheduledMatch } from '../stores/matchScheduleStore';
import { extractKnockoutStage, SPORT_ICON } from './TournamentManager';
import { WIDGET_TYPE_LABELS } from '../types/canvas';
import type { CanvasWidget } from '../types/canvas';
import { WidgetIcon } from './widgets/WidgetIcon';
import { ChevronDown, ChevronUp, ChevronRight, X, Terminal, SquareStack, RotateCcw, ArrowUp, ArrowDown, Copy, Zap, Cast, Flag, Star, ArrowLeftRight, Timer, Hourglass, Users, Info, Infinity as InfinityIcon, RectangleVertical, RectangleHorizontal, PanelBottom, Smartphone, Maximize, Minimize, Square, Volume2, Mic, Radio as RadioIcon, Scan, Crop, Expand, AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import { INPUT_TYPE_LABELS } from '../types/vmix';
import type { VmixInput } from '../types/vmix';
import { LogoUrlPicker } from './LogoUrlPicker';
import { resolveImageUrl } from '../lib/imageUrl';
import { ActionListEditor } from './ActionListEditor';
import { MergeFieldComposer, type MergePart } from './MergeFieldComposer';
import { SCORE_MERGE_PARTS_A, SCORE_MERGE_PARTS_B, SCORE_MERGE_PARTS_INFO } from '../lib/templateBinding';
import type { ActionItem } from '../lib/buttonActions';
import { HotkeyRecorder } from './HotkeyRecorder';
import { collectHotkeyBindings } from '../lib/hotkeyBindings';
import { SPORT_DEFAULTS, type SportType, type RacketSportSettings } from '../types/tournament';
import { initRallyMatch, initTennisMatch, normalizePlayerEntry, type RacketPlayerEntry } from '../lib/racketScoring';

// Label for a player-list widget in a picker dropdown — shows the linked
// saved team's name (teamDbStore), falling back to a short widget id.
function plWidgetLabel(w: { id: string; config: Record<string, any> }, teamDbTeams: { id: string; name: string }[]): string {
  const t = teamDbTeams.find(t2 => t2.id === w.config.linkedTeamId);
  return t ? t.name : `Widget ${w.id.slice(0, 6)}`;
}

function msToFormatStr(ms: number, format: string): string {
  const totalSec = Math.floor((ms ?? 0) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (format === 'ss') return String(totalSec);
  if (format === 'mm:ss') return `${pad(m)}:${pad(s)}`;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function formatStrToMs(str: string, format: string): number {
  if (format === 'ss') return (parseInt(str) || 0) * 1000;
  const parts = str.split(':').map(v => parseInt(v) || 0);
  if (format === 'mm:ss') {
    const [m = 0, s = 0] = parts;
    return (m * 60 + s) * 1000;
  }
  const [h = 0, m = 0, s = 0] = parts;
  return (h * 3600 + m * 60 + s) * 1000;
}

const PRESET_COLORS = ['#e74c3c','#e67e22','#f1c40f','#2ecc71','#1abc9c','#3498db','#9b59b6','#34495e','#ecf0f1','#ffffff'];
const TRANS_KEYS = ['cut','fade','auto','t2','t3','t4','stinger1','stinger2','ftb'];
// Shared by the 'player-h2h' and 'player-stats' config cases below — `cap`
// is the config-field-name suffix (e.g. config.fieldTriesA), matching the
// Player type's own field name capitalized, so it can't drift from what the
// widgets themselves read.
const PLAYER_STAT_FIELD_DEFS = [
  { key: 'appearances', cap: 'Appearances', label: 'Appearances' },
  { key: 'tries', cap: 'Tries', label: 'Tries' },
  { key: 'conversions', cap: 'Conversions', label: 'Conversions' },
  { key: 'penalties', cap: 'Penalties', label: 'Penalties' },
  { key: 'dropGoals', cap: 'DropGoals', label: 'Drop Goals' },
  { key: 'yellowCards', cap: 'YellowCards', label: 'Yellow Cards' },
  { key: 'redCards', cap: 'RedCards', label: 'Red Cards' },
] as const;
const PLAYER_STAT_SAMPLES: Record<string, string> = {
  appearances: '12', tries: '3', conversions: '5', penalties: '2', dropGoals: '1', yellowCards: '1', redCards: '0',
};
// Shared by 'player-h2h' (×2, one per side) and 'player-stats' (×1) — a
// player's own name/jersey/position plus every stat field, as a mergeable
// parts catalog.
function playerMergeParts(sampleName: string, sampleJersey: string, samplePosition: string): MergePart[] {
  return [
    { key: 'name', label: 'Name', sample: sampleName },
    { key: 'jersey', label: 'Jersey', sample: sampleJersey },
    { key: 'position', label: 'Position', sample: samplePosition },
    ...PLAYER_STAT_FIELD_DEFS.map(f => ({ key: f.key, label: f.label, sample: PLAYER_STAT_SAMPLES[f.key] })),
  ];
}
// Also reused by TournamentManager.tsx's Results/Schedule score-event editor
// (see RUGBY_ACTION_FULL_LABEL there) so a manually-entered score event picks
// from the exact same type/points pairs the live scoreboard buttons use,
// instead of a separately-maintained list that could drift out of sync.
export const RUGBY_UNION_INCS = [
  { label: 'Try',  value: 5 },
  { label: 'Conv', value: 2 },
  { label: 'Pen',  value: 3 },
  { label: 'Drop', value: 3 },
  { label: 'PTry', value: 7 },
];
export const RUGBY_LEAGUE_INCS = [
  { label: 'Try',  value: 4 },
  { label: 'Conv', value: 2 },
  { label: 'Pen',  value: 2 },
  { label: 'Drop', value: 1 },
];

// `Mix` — vMix's own "which Mix bus" parameter (4K/Pro editions): Mix 1 is
// the main Program/Preview, Mix 2-16 are independent mini-mixers (their own
// Preview/Program/transition) that can themselves feed into another Mix as
// an input. Values match what's shown in the vMix UI (1-16), same
// convention bitfocus/companion-module-studiocoast-vmix's own `mixSelect`
// field uses — ActionListEditor.tsx's own Mix picker converts to vMix's
// real wire format (lowercase `mix`, 0-based) right before sending, see
// vmixApi.ts's own doc comment on that.
//
// Listed per vMix's own official docs, not Companion's (which turned out to
// be an incomplete/conservative reference) — Mix.html states: "The following
// shortcuts can be used with an optional Mix parameter ... Fade, Zoom, Wipe
// etc", and ShortcutFunctionReference.html's own intro groups Cut in with
// them: "Transitions such as Fade, Zoom, Cut etc can be used as Functions in
// shortcuts or the API". So Cut and every other transition effect (Fade,
// Merge, Zoom, Wipe, Slide, Fly, CrossZoom, FlyRotate, Cube, CubeZoom,
// VerticalWipe, VerticalSlide) genuinely target whichever Mix 1-16 is
// selected, not just the main mix — vmixApi.ts's `fn()` forwards `mix`
// straight through for all of them, no function-swapping needed. Only
// CutDirect (reference table lists Parameters: Input only, no Mix) and
// Transition1-4 (the four UI transition buttons — reference table lists
// Parameters: None) are genuinely Mix-1-only, since vMix's own docs don't
// offer a Mix parameter for either. The other explicitly Mix-aware
// functions are ActiveInput (cut)/PreviewInput (preview)/Stinger1-4/
// OverlayInput*/SetOutput2-4.
export const VMIX_FUNCTIONS: { group: string; fns: { fn: string; label: string; p: string[] }[] }[] = [
  { group: 'Transitions', fns: [
    { fn: 'Cut',                    label: 'Cut',                    p: ['Input', 'Mix'] },
    { fn: 'Fade',                   label: 'Fade',                   p: ['Input', 'Mix'] },
    { fn: 'Merge',                  label: 'Merge',                  p: ['Input', 'Mix'] },
    { fn: 'Zoom',                   label: 'Zoom',                   p: ['Input', 'Mix'] },
    { fn: 'Wipe',                   label: 'Wipe',                   p: ['Input', 'Mix'] },
    { fn: 'Slide',                  label: 'Slide',                  p: ['Input', 'Mix'] },
    { fn: 'Fly',                    label: 'Fly',                    p: ['Input', 'Mix'] },
    { fn: 'CrossZoom',              label: 'Cross Zoom',             p: ['Input', 'Mix'] },
    { fn: 'FlyRotate',              label: 'Fly Rotate',             p: ['Input', 'Mix'] },
    { fn: 'Cube',                   label: 'Cube',                   p: ['Input', 'Mix'] },
    { fn: 'CubeZoom',               label: 'Cube Zoom',              p: ['Input', 'Mix'] },
    { fn: 'VerticalWipe',           label: 'Vertical Wipe',          p: ['Input', 'Mix'] },
    { fn: 'VerticalSlide',          label: 'Vertical Slide',         p: ['Input', 'Mix'] },
    { fn: 'CutDirect',              label: 'Cut Direct (bypass Preview, Mix 1 only)', p: ['Input'] },
    { fn: 'QuickPlay',              label: 'Quick Play (cue + take)', p: ['Input'] },
    { fn: 'Transition1',            label: 'Auto (T1, Mix 1 only)',  p: [] },
    { fn: 'Transition2',            label: 'Transition 2 (Mix 1 only)', p: [] },
    { fn: 'Transition3',            label: 'Transition 3 (Mix 1 only)', p: [] },
    { fn: 'Transition4',            label: 'Transition 4 (Mix 1 only)', p: [] },
    { fn: 'Stinger1',               label: 'Stinger 1',              p: ['Input', 'Mix'] },
    { fn: 'Stinger2',               label: 'Stinger 2',              p: ['Input', 'Mix'] },
    { fn: 'Stinger3',               label: 'Stinger 3',              p: ['Input', 'Mix'] },
    { fn: 'Stinger4',               label: 'Stinger 4',              p: ['Input', 'Mix'] },
    { fn: 'SetStingerGTInput1',     label: 'Set Stinger GT Input 1', p: ['Input'] },
    { fn: 'SetStingerGTInput2',     label: 'Set Stinger GT Input 2', p: ['Input'] },
    { fn: 'SetStingerGTInput3',     label: 'Set Stinger GT Input 3', p: ['Input'] },
    { fn: 'SetStingerGTInput4',     label: 'Set Stinger GT Input 4', p: ['Input'] },
    { fn: 'FadeToBlack',            label: 'Fade To Black',          p: [] },
    { fn: 'SetFader',               label: 'Set T-Bar Position (0-255)', p: ['Value'] },
    { fn: 'SetTransitionEffect1',   label: 'Set T1 Effect',          p: ['Value'] },
    { fn: 'SetTransitionEffect2',   label: 'Set T2 Effect',          p: ['Value'] },
    { fn: 'SetTransitionEffect3',   label: 'Set T3 Effect',          p: ['Value'] },
    { fn: 'SetTransitionEffect4',   label: 'Set T4 Effect',          p: ['Value'] },
    { fn: 'SetTransitionDuration1', label: 'Set T1 Duration (ms)',   p: ['Value'] },
    { fn: 'SetTransitionDuration2', label: 'Set T2 Duration (ms)',   p: ['Value'] },
    { fn: 'SetTransitionDuration3', label: 'Set T3 Duration (ms)',   p: ['Value'] },
    { fn: 'SetTransitionDuration4', label: 'Set T4 Duration (ms)',   p: ['Value'] },
  ]},
  { group: 'Inputs', fns: [
    { fn: 'PreviewInput',           label: 'Preview Input (supports Mix)', p: ['Input', 'Mix'] },
    { fn: 'ActiveInput',            label: 'Active Input — cut to Program (supports Mix)', p: ['Input', 'Mix'] },
    { fn: 'PreviewInputNext',       label: 'Preview Next Input',     p: [] },
    { fn: 'PreviewInputPrevious',   label: 'Preview Previous Input', p: [] },
    { fn: 'AddInput',               label: 'Add Input (Type,Value)', p: ['Value'] },
    { fn: 'RemoveInput',            label: 'Remove Input',           p: ['Input'] },
    { fn: 'ResetInput',             label: 'Reset Input',            p: ['Input'] },
    { fn: 'CreateVirtualInput',     label: 'Create Virtual Input',   p: ['Input'] },
    { fn: 'SetInputName',           label: 'Set Input Name',         p: ['Input', 'Value'] },
    { fn: 'MoveInput',              label: 'Move Input (to index)',  p: ['Input', 'Value'] },
    { fn: 'SetAlpha',               label: 'Set Alpha',              p: ['Input', 'Value'] },
    { fn: 'SetInputAlpha',          label: 'Set Alpha (legacy name)', p: ['Input', 'Value'] },
    { fn: 'SetZoom',                label: 'Set Zoom',               p: ['Input', 'Value'] },
    { fn: 'SetPanX',                label: 'Set Pan X',              p: ['Input', 'Value'] },
    { fn: 'SetPanY',                label: 'Set Pan Y',              p: ['Input', 'Value'] },
    { fn: 'SetCrop',                label: 'Set Crop (x1,y1,x2,y2)', p: ['Input', 'Value'] },
    { fn: 'SetPosition',            label: 'Set Position (ms)',      p: ['Input', 'Value'] },
    { fn: 'SetRate',                label: 'Set Playback Rate (%)',  p: ['Input', 'Value'] },
    { fn: 'SetVolume',              label: 'Set Input Volume (0–100)', p: ['Input', 'Value'] },
    { fn: 'MirrorOn',               label: 'Mirror On',              p: ['Input'] },
    { fn: 'MirrorOff',              label: 'Mirror Off',             p: ['Input'] },
    { fn: 'DeinterlaceOn',          label: 'Deinterlace On',         p: ['Input'] },
    { fn: 'DeinterlaceOff',         label: 'Deinterlace Off',        p: ['Input'] },
    { fn: 'SharpenOn',              label: 'Sharpen On',             p: ['Input'] },
    { fn: 'SharpenOff',             label: 'Sharpen Off',            p: ['Input'] },
    { fn: 'ColourCorrectionReset',  label: 'Colour Correction Reset', p: ['Input'] },
    { fn: 'ColourCorrectionAuto',   label: 'Colour Correction Auto', p: ['Input'] },
    { fn: 'Effect1On',              label: 'Effect 1 On',            p: ['Input'] },
    { fn: 'Effect1Off',             label: 'Effect 1 Off',           p: ['Input'] },
    { fn: 'SetEffect1Strength',     label: 'Set Effect 1 Strength',  p: ['Input', 'Value'] },
    { fn: 'SelectIndex',            label: 'Select Index',           p: ['Input', 'Value'] },
    { fn: 'SelectCategory',         label: 'Select Category',        p: ['Value'] },
  ]},
  { group: 'Layers (overlay compositing)', fns: [
    { fn: 'LayerOn',                label: 'Layer On',               p: ['Input', 'Value'] },
    { fn: 'LayerOff',                label: 'Layer Off',              p: ['Input', 'Value'] },
    { fn: 'LayerOnOff',             label: 'Layer Toggle',           p: ['Input', 'Value'] },
    { fn: 'SetLayer',               label: 'Set Layer (index=Input)', p: ['Input', 'Value'] },
    { fn: 'MoveLayer',              label: 'Move Layer',             p: ['Input', 'Value'] },
    { fn: 'SetLayer1X',             label: 'Set Layer 1 X',          p: ['Input', 'Value'] },
    { fn: 'SetLayer1Y',             label: 'Set Layer 1 Y',          p: ['Input', 'Value'] },
    { fn: 'SetLayer1Width',         label: 'Set Layer 1 Width',      p: ['Input', 'Value'] },
    { fn: 'SetLayer1Height',        label: 'Set Layer 1 Height',     p: ['Input', 'Value'] },
    { fn: 'SetLayer1Zoom',          label: 'Set Layer 1 Zoom',       p: ['Input', 'Value'] },
    { fn: 'SetLayer1Crop',          label: 'Set Layer 1 Crop',       p: ['Input', 'Value'] },
    { fn: 'SetLayer1Rectangle',     label: 'Set Layer 1 Rectangle',  p: ['Input', 'Value'] },
    // Layer 2-10 follow the exact same SetLayer{N}X/Y/Width/Height/Zoom/
    // Crop/Rectangle/PanX/PanY naming — pick "Custom…" below and type the
    // exact function (e.g. SetLayer3Width) rather than this list carrying
    // ~70 near-identical rows for every layer index.
  ]},
  { group: 'Overlay', fns: [
    { fn: 'OverlayInput1',          label: 'Overlay 1 Toggle',       p: ['Input', 'Mix'] },
    { fn: 'OverlayInput2',          label: 'Overlay 2 Toggle',       p: ['Input', 'Mix'] },
    { fn: 'OverlayInput3',          label: 'Overlay 3 Toggle',       p: ['Input', 'Mix'] },
    { fn: 'OverlayInput4',          label: 'Overlay 4 Toggle',       p: ['Input', 'Mix'] },
    { fn: 'OverlayInput1In',        label: 'Overlay 1 In',           p: ['Input', 'Mix'] },
    { fn: 'OverlayInput2In',        label: 'Overlay 2 In',           p: ['Input', 'Mix'] },
    { fn: 'OverlayInput3In',        label: 'Overlay 3 In',           p: ['Input', 'Mix'] },
    { fn: 'OverlayInput4In',        label: 'Overlay 4 In',           p: ['Input', 'Mix'] },
    { fn: 'OverlayInput1Out',       label: 'Overlay 1 Out',          p: ['Mix'] },
    { fn: 'OverlayInput2Out',       label: 'Overlay 2 Out',          p: ['Mix'] },
    { fn: 'OverlayInput3Out',       label: 'Overlay 3 Out',          p: ['Mix'] },
    { fn: 'OverlayInput4Out',       label: 'Overlay 4 Out',          p: ['Mix'] },
    { fn: 'OverlayInput1Off',       label: 'Overlay 1 Off',          p: [] },
    { fn: 'OverlayInput2Off',       label: 'Overlay 2 Off',          p: [] },
    { fn: 'OverlayInput3Off',       label: 'Overlay 3 Off',          p: [] },
    { fn: 'OverlayInput4Off',       label: 'Overlay 4 Off',          p: [] },
    { fn: 'OverlayInput1Zoom',      label: 'Overlay 1 Zoom Toggle',  p: [] },
    { fn: 'OverlayInput2Zoom',      label: 'Overlay 2 Zoom Toggle',  p: [] },
    { fn: 'OverlayInput3Zoom',      label: 'Overlay 3 Zoom Toggle',  p: [] },
    { fn: 'OverlayInput4Zoom',      label: 'Overlay 4 Zoom Toggle',  p: [] },
    { fn: 'OverlayInputAllOff',     label: 'All Overlays Off',       p: [] },
    { fn: 'PreviewOverlayInput1',   label: 'Preview Overlay 1',      p: ['Input'] },
    { fn: 'PreviewOverlayInput2',   label: 'Preview Overlay 2',      p: ['Input'] },
    { fn: 'PreviewOverlayInput3',   label: 'Preview Overlay 3',      p: ['Input'] },
    { fn: 'PreviewOverlayInput4',   label: 'Preview Overlay 4',      p: ['Input'] },
  ]},
  { group: 'Title / GT', fns: [
    { fn: 'SetText',                label: 'Set Text',               p: ['Input', 'SelectedName', 'Value'] },
    { fn: 'SetTextCase',            label: 'Set Text Case',          p: ['Input', 'SelectedName', 'Value'] },
    { fn: 'SetTextColour',          label: 'Set Text Colour',        p: ['Input', 'SelectedName', 'Value'] },
    { fn: 'SetTextVisibleOn',       label: 'Set Text Visible On',    p: ['Input', 'SelectedName'] },
    { fn: 'SetTextVisibleOff',      label: 'Set Text Visible Off',   p: ['Input', 'SelectedName'] },
    { fn: 'SetImage',               label: 'Set Image',              p: ['Input', 'SelectedName', 'Value'] },
    { fn: 'SetImageVisibleOn',      label: 'Set Image Visible On',   p: ['Input', 'SelectedName'] },
    { fn: 'SetImageVisibleOff',     label: 'Set Image Visible Off',  p: ['Input', 'SelectedName'] },
    { fn: 'SetColor',               label: 'Set Color (ARGB)',       p: ['Input', 'SelectedName', 'Value'] },
    { fn: 'SetTickerSpeed',         label: 'Set Ticker Speed',       p: ['Input', 'SelectedName', 'Value'] },
    { fn: 'SetCountdown',           label: 'Set Countdown',          p: ['Input', 'SelectedName', 'Value'] },
    { fn: 'StartCountdown',         label: 'Start Countdown',        p: ['Input'] },
    { fn: 'StopCountdown',          label: 'Stop Countdown',         p: ['Input'] },
    { fn: 'PauseCountdown',         label: 'Pause Countdown',        p: ['Input'] },
    { fn: 'SuspendCountdown',       label: 'Suspend Countdown',      p: ['Input'] },
    { fn: 'ChangeCountdown',        label: 'Change Countdown',       p: ['Input', 'Value'] },
    { fn: 'AdjustCountdown',        label: 'Adjust Countdown (+/-s)', p: ['Input', 'Value'] },
    { fn: 'PauseRender',            label: 'Pause Render',           p: ['Input'] },
    { fn: 'ResumeRender',           label: 'Resume Render',          p: ['Input'] },
    { fn: 'SelectTitlePreset',      label: 'Select Title Preset',    p: ['Input', 'Value'] },
    { fn: 'NextTitlePreset',        label: 'Next Title Preset',      p: ['Input'] },
    { fn: 'PreviousTitlePreset',    label: 'Previous Title Preset',  p: ['Input'] },
    { fn: 'TitleBeginAnimation',    label: 'Title Begin Animation',  p: ['Input', 'Value'] },
    { fn: 'DataSourceSelectRow',    label: 'Data Source Select Row', p: ['Value'] },
    { fn: 'DataSourceNextRow',      label: 'Data Source Next Row',   p: ['Value'] },
    { fn: 'DataSourcePreviousRow',  label: 'Data Source Prev Row',   p: ['Value'] },
    { fn: 'DataSourcePlay',         label: 'Data Source Play',       p: ['Value'] },
    { fn: 'DataSourcePause',        label: 'Data Source Pause',      p: ['Value'] },
    { fn: 'DataSourcePlayPause',    label: 'Data Source Play/Pause', p: ['Value'] },
    { fn: 'DataSourceAutoNextOn',   label: 'Data Source Auto-Next On', p: ['Value'] },
    { fn: 'DataSourceAutoNextOff',  label: 'Data Source Auto-Next Off', p: ['Value'] },
    { fn: 'SetDynamicValue1',       label: 'Set Dynamic Value 1',    p: ['Value'] },
    { fn: 'SetDynamicValue2',       label: 'Set Dynamic Value 2',    p: ['Value'] },
    { fn: 'SetDynamicValue3',       label: 'Set Dynamic Value 3',    p: ['Value'] },
    { fn: 'SetDynamicValue4',       label: 'Set Dynamic Value 4',    p: ['Value'] },
    { fn: 'SetDynamicInput1',       label: 'Set Dynamic Input 1',    p: ['Value'] },
    { fn: 'SetDynamicInput2',       label: 'Set Dynamic Input 2',    p: ['Value'] },
    { fn: 'SetDynamicInput3',       label: 'Set Dynamic Input 3',    p: ['Value'] },
    { fn: 'SetDynamicInput4',       label: 'Set Dynamic Input 4',    p: ['Value'] },
  ]},
  { group: 'Playback', fns: [
    { fn: 'Play',                   label: 'Play',                   p: ['Input'] },
    { fn: 'Pause',                  label: 'Pause',                  p: ['Input'] },
    { fn: 'PlayPause',              label: 'Play / Pause',           p: ['Input'] },
    { fn: 'Restart',                label: 'Restart',                p: ['Input'] },
    { fn: 'LivePlayPause',          label: 'Live Play/Pause',        p: ['Input'] },
    { fn: 'Loop',                   label: 'Loop Toggle',            p: ['Input'] },
    { fn: 'LoopOn',                 label: 'Loop On',                p: ['Input'] },
    { fn: 'LoopOff',                label: 'Loop Off',               p: ['Input'] },
    { fn: 'AutoPlayOn',             label: 'Auto Play On',           p: ['Input'] },
    { fn: 'AutoPlayOff',            label: 'Auto Play Off',          p: ['Input'] },
    { fn: 'AutoPlayNextOn',         label: 'Auto Play Next On',      p: ['Input'] },
    { fn: 'AutoPlayNextOff',        label: 'Auto Play Next Off',     p: ['Input'] },
    { fn: 'AutoPlayFirstOn',        label: 'Auto Play First On',     p: ['Input'] },
    { fn: 'AutoPlayFirstOff',       label: 'Auto Play First Off',    p: ['Input'] },
    { fn: 'AutoPauseOn',            label: 'Auto Pause On',          p: ['Input'] },
    { fn: 'AutoPauseOff',           label: 'Auto Pause Off',         p: ['Input'] },
    { fn: 'AutoRestartOn',          label: 'Auto Restart On',        p: ['Input'] },
    { fn: 'AutoRestartOff',         label: 'Auto Restart Off',       p: ['Input'] },
    { fn: 'NextItem',               label: 'Next Item',              p: ['Input'] },
    { fn: 'PreviousItem',           label: 'Previous Item',          p: ['Input'] },
    { fn: 'NextPicture',            label: 'Next Picture',           p: ['Input'] },
    { fn: 'PreviousPicture',        label: 'Previous Picture',       p: ['Input'] },
    { fn: 'MarkIn',                 label: 'Mark In',                p: ['Input'] },
    { fn: 'MarkOut',                label: 'Mark Out',               p: ['Input'] },
    { fn: 'MarkReset',              label: 'Mark Reset',             p: ['Input'] },
    { fn: 'SetRateSlowMotion',      label: 'Set Slow Motion Rate',   p: ['Input', 'Value'] },
  ]},
  { group: 'List', fns: [
    { fn: 'ListAdd',                label: 'List Add',               p: ['Input', 'Value'] },
    { fn: 'ListRemove',             label: 'List Remove',            p: ['Input', 'Value'] },
    { fn: 'ListRemoveAll',          label: 'List Remove All',        p: ['Input'] },
    { fn: 'ListExport',             label: 'List Export',            p: ['Input', 'Value'] },
    { fn: 'ListPlayOut',            label: 'List Play Out',          p: ['Input'] },
    { fn: 'ListShowHide',           label: 'List Show/Hide',         p: ['Input'] },
    { fn: 'ListShuffle',            label: 'List Shuffle',           p: ['Input'] },
  ]},
  { group: 'Audio', fns: [
    { fn: 'AudioOn',                label: 'Audio On',               p: ['Input'] },
    { fn: 'AudioOff',               label: 'Audio Off',              p: ['Input'] },
    { fn: 'AudioAutoOn',            label: 'Audio Auto On',          p: ['Input'] },
    { fn: 'AudioAutoOff',           label: 'Audio Auto Off',         p: ['Input'] },
    { fn: 'SetVolume',              label: 'Set Volume (0–100)',     p: ['Input', 'Value'] },
    { fn: 'SetVolumeFade',          label: 'Fade Volume To',         p: ['Input', 'Value'] },
    { fn: 'SetBalance',             label: 'Set Balance (-1 to 1)',  p: ['Input', 'Value'] },
    { fn: 'SetGain',                label: 'Set Gain (dB)',          p: ['Input', 'Value'] },
    { fn: 'Solo',                   label: 'Solo Toggle',            p: ['Input'] },
    { fn: 'SoloOn',                 label: 'Solo On',                p: ['Input'] },
    { fn: 'SoloOff',                label: 'Solo Off',               p: ['Input'] },
    { fn: 'SoloAllOff',             label: 'Solo All Off',           p: [] },
    { fn: 'SetMasterVolume',        label: 'Set Master Volume',      p: ['Value'] },
    { fn: 'SetMasterVolumeFade',    label: 'Fade Master Volume To',  p: ['Value'] },
    { fn: 'MasterAudioOn',          label: 'Master Audio On',        p: [] },
    { fn: 'MasterAudioOff',         label: 'Master Audio Off',       p: [] },
    { fn: 'SetHeadphonesVolume',    label: 'Set Headphones Volume',  p: ['Value'] },
    { fn: 'AudioBusOn',             label: 'Audio Bus On (Value=bus letter)', p: ['Input', 'Value'] },
    { fn: 'AudioBusOff',            label: 'Audio Bus Off (Value=bus letter)', p: ['Input', 'Value'] },
    { fn: 'BusAAudioOn',            label: 'Bus A Audio On',         p: [] },
    { fn: 'BusAAudioOff',           label: 'Bus A Audio Off',        p: [] },
    { fn: 'SetBusAVolume',          label: 'Set Bus A Volume',       p: ['Value'] },
    { fn: 'BusBAudioOn',            label: 'Bus B Audio On',         p: [] },
    { fn: 'BusBAudioOff',           label: 'Bus B Audio Off',        p: [] },
    { fn: 'SetBusBVolume',          label: 'Set Bus B Volume',       p: ['Value'] },
    { fn: 'BusXAudioOn',            label: 'Bus On (Value=C-G)',     p: ['Value'] },
    { fn: 'BusXAudioOff',           label: 'Bus Off (Value=C-G)',    p: ['Value'] },
    { fn: 'BusXSolo',               label: 'Bus Solo Toggle (Value=A-G)', p: ['Value'] },
    { fn: 'BusXSendToMaster',       label: 'Bus Send To Master Toggle (Value=A-G)', p: ['Value'] },
    { fn: 'AudioChannelMatrixApplyPreset', label: 'Apply Channel Matrix Preset', p: ['Input', 'Value'] },
    { fn: 'AudioMixerShowHide',     label: 'Audio Mixer Toggle',     p: [] },
    { fn: 'AudioPluginShow',        label: 'Show Audio Plugin',      p: ['Input', 'Value'] },
    { fn: 'AudioPluginOnOff',       label: 'Audio Plugin Toggle',    p: ['Input', 'Value'] },
  ]},
  { group: 'Recording / Streaming', fns: [
    { fn: 'StartRecording',         label: 'Start Recording',        p: [] },
    { fn: 'StopRecording',          label: 'Stop Recording',         p: [] },
    { fn: 'StartStopRecording',     label: 'Toggle Recording',       p: [] },
    { fn: 'StartStreaming',         label: 'Start Streaming (Value=destination #, blank=all)', p: ['Value'] },
    { fn: 'StopStreaming',          label: 'Stop Streaming',         p: ['Value'] },
    { fn: 'StartStopStreaming',     label: 'Toggle Streaming',       p: ['Value'] },
    { fn: 'StreamingSetURL',        label: 'Set Streaming URL',      p: ['Value'] },
    { fn: 'StreamingSetKey',        label: 'Set Streaming Key',      p: ['Value'] },
    { fn: 'StreamingSetUsername',   label: 'Set Streaming Username', p: ['Value'] },
    { fn: 'StreamingSetPassword',   label: 'Set Streaming Password', p: ['Value'] },
    { fn: 'StartExternal',          label: 'Start External',         p: [] },
    { fn: 'StopExternal',           label: 'Stop External',          p: [] },
    { fn: 'StartStopExternal',      label: 'Toggle External',        p: [] },
    { fn: 'StartMultiCorder',       label: 'Start MultiCorder',      p: [] },
    { fn: 'StopMultiCorder',        label: 'Stop MultiCorder',       p: [] },
    { fn: 'StartStopMultiCorder',   label: 'Toggle MultiCorder',     p: [] },
    { fn: 'StartSRTOutput',         label: 'Start SRT Output',       p: ['Value'] },
    { fn: 'StopSRTOutput',          label: 'Stop SRT Output',        p: ['Value'] },
    { fn: 'StartStopSRTOutput',     label: 'Toggle SRT Output',      p: ['Value'] },
    { fn: 'WriteDurationToRecordingLog', label: 'Write Duration To Recording Log', p: ['Value'] },
    { fn: 'SetOutput2',             label: 'Set Output 2',           p: ['Value', 'Input', 'Mix'] },
    { fn: 'SetOutput3',             label: 'Set Output 3',           p: ['Value', 'Input', 'Mix'] },
    { fn: 'SetOutput4',             label: 'Set Output 4',           p: ['Value', 'Input', 'Mix'] },
    { fn: 'SetOutputExternal2',     label: 'Set External 2 Output',  p: ['Value', 'Input', 'Mix'] },
    { fn: 'SetOutputFullscreen',    label: 'Set Fullscreen Output',  p: ['Value', 'Input', 'Mix'] },
    { fn: 'SetOutputFullscreen2',   label: 'Set Fullscreen 2 Output', p: ['Value', 'Input', 'Mix'] },
    { fn: 'FullscreenOn',           label: 'Fullscreen On',          p: [] },
    { fn: 'FullscreenOff',          label: 'Fullscreen Off',         p: [] },
    { fn: 'Fullscreen',             label: 'Fullscreen Toggle',      p: [] },
    { fn: 'Snapshot',               label: 'Snapshot',               p: [] },
    { fn: 'SnapshotInput',          label: 'Snapshot Input',         p: ['Input'] },
  ]},
  { group: 'Browser', fns: [
    { fn: 'BrowserNavigate',        label: 'Browser Navigate',       p: ['Input', 'Value'] },
    { fn: 'BrowserReload',          label: 'Browser Reload',         p: ['Input'] },
    { fn: 'BrowserBack',            label: 'Browser Back',           p: ['Input'] },
    { fn: 'BrowserForward',         label: 'Browser Forward',        p: ['Input'] },
    { fn: 'BrowserKeyboardEnabled', label: 'Browser Keyboard Enabled', p: ['Input'] },
    { fn: 'BrowserKeyboardDisabled', label: 'Browser Keyboard Disabled', p: ['Input'] },
    { fn: 'BrowserMouseEnabled',    label: 'Browser Mouse Enabled',  p: ['Input'] },
    { fn: 'BrowserMouseDisabled',   label: 'Browser Mouse Disabled', p: ['Input'] },
  ]},
  { group: 'PTZ', fns: [
    { fn: 'PTZMoveUp',              label: 'PTZ Move Up',            p: ['Input', 'Value'] },
    { fn: 'PTZMoveDown',            label: 'PTZ Move Down',          p: ['Input', 'Value'] },
    { fn: 'PTZMoveLeft',            label: 'PTZ Move Left',          p: ['Input', 'Value'] },
    { fn: 'PTZMoveRight',           label: 'PTZ Move Right',         p: ['Input', 'Value'] },
    { fn: 'PTZMoveUpLeft',          label: 'PTZ Move Up-Left',       p: ['Input', 'Value'] },
    { fn: 'PTZMoveUpRight',         label: 'PTZ Move Up-Right',      p: ['Input', 'Value'] },
    { fn: 'PTZMoveDownLeft',        label: 'PTZ Move Down-Left',     p: ['Input', 'Value'] },
    { fn: 'PTZMoveDownRight',       label: 'PTZ Move Down-Right',    p: ['Input', 'Value'] },
    { fn: 'PTZMoveStop',            label: 'PTZ Move Stop',          p: ['Input'] },
    { fn: 'PTZZoomIn',              label: 'PTZ Zoom In',            p: ['Input', 'Value'] },
    { fn: 'PTZZoomOut',             label: 'PTZ Zoom Out',           p: ['Input', 'Value'] },
    { fn: 'PTZZoomStop',            label: 'PTZ Zoom Stop',          p: ['Input'] },
    { fn: 'PTZFocusFar',            label: 'PTZ Focus Far',          p: ['Input', 'Value'] },
    { fn: 'PTZFocusNear',           label: 'PTZ Focus Near',         p: ['Input', 'Value'] },
    { fn: 'PTZFocusStop',           label: 'PTZ Focus Stop',         p: ['Input'] },
    { fn: 'PTZFocusAuto',           label: 'PTZ Focus Auto',         p: ['Input'] },
    { fn: 'PTZFocusManual',         label: 'PTZ Focus Manual',       p: ['Input'] },
    { fn: 'PTZHome',                label: 'PTZ Home',               p: ['Input'] },
    { fn: 'PTZMoveToVirtualInputPosition', label: 'PTZ Move To Virtual Position', p: ['Input'] },
    { fn: 'PTZMoveToVirtualInputPositionByIndex', label: 'PTZ Move To Virtual Position By Index', p: ['Input', 'Value'] },
    { fn: 'PTZCreateVirtualInput',  label: 'PTZ Create Virtual',     p: ['Input'] },
    { fn: 'PTZUpdateVirtualInput',  label: 'PTZ Update Virtual',     p: ['Input'] },
  ]},
  { group: 'Replay', fns: [
    { fn: 'ReplayStartRecording',   label: 'Replay Start Recording', p: [] },
    { fn: 'ReplayStopRecording',    label: 'Replay Stop Recording',  p: [] },
    { fn: 'ReplayStartStopRecording', label: 'Replay Toggle Recording', p: [] },
    { fn: 'ReplayMarkIn',           label: 'Replay Mark In',         p: [] },
    { fn: 'ReplayMarkOut',          label: 'Replay Mark Out',        p: [] },
    { fn: 'ReplayMarkCancel',       label: 'Replay Mark Cancel',     p: [] },
    { fn: 'ReplayMarkInLive',       label: 'Replay Mark In (Live)',  p: [] },
    { fn: 'ReplayMarkInRecorded',   label: 'Replay Mark In (Recorded)', p: [] },
    { fn: 'ReplayLive',             label: 'Replay Live',            p: [] },
    { fn: 'ReplayLiveToggle',       label: 'Replay Live Toggle',     p: [] },
    { fn: 'ReplayRecorded',         label: 'Replay Recorded',        p: [] },
    { fn: 'ReplayPlayPause',        label: 'Replay Play/Pause',      p: ['Channel'] },
    { fn: 'ReplayPlay',             label: 'Replay Play',            p: ['Channel'] },
    { fn: 'ReplayPause',            label: 'Replay Pause',           p: ['Channel'] },
    { fn: 'ReplayPlayForward',      label: 'Replay Play Forward',    p: ['Channel'] },
    { fn: 'ReplayPlayBackward',     label: 'Replay Play Backward',   p: ['Channel'] },
    { fn: 'ReplayJumpToNow',        label: 'Replay Jump To Now',     p: ['Channel'] },
    { fn: 'ReplayFastForward',      label: 'Replay Fast Forward',    p: ['Value', 'Channel'] },
    { fn: 'ReplayFastBackward',     label: 'Replay Fast Backward',   p: ['Value', 'Channel'] },
    { fn: 'ReplaySetSpeed',         label: 'Replay Set Speed',       p: ['Value', 'Channel'] },
    { fn: 'ReplaySetDirectionForward', label: 'Replay Set Direction Forward', p: ['Channel'] },
    { fn: 'ReplaySetDirectionBackward', label: 'Replay Set Direction Backward', p: ['Channel'] },
    { fn: 'ReplayPlayEvent',        label: 'Replay Play Event (by index)', p: ['Value', 'Channel'] },
    { fn: 'ReplayPlayLastEvent',    label: 'Replay Play Last Event', p: ['Channel'] },
    { fn: 'ReplayPlaySelectedEvent', label: 'Replay Play Selected Event', p: ['Channel'] },
    { fn: 'ReplayPlayAllEvents',    label: 'Replay Play All Events', p: ['Channel'] },
    { fn: 'ReplayPlayNext',         label: 'Replay Play Next',       p: ['Channel'] },
    { fn: 'ReplayPlayPrevious',     label: 'Replay Play Previous',   p: ['Channel'] },
    { fn: 'ReplayStopEvents',       label: 'Replay Stop Events',     p: ['Channel'] },
    { fn: 'ReplaySelectNextEvent',  label: 'Replay Select Next Event', p: ['Channel'] },
    { fn: 'ReplaySelectPreviousEvent', label: 'Replay Select Previous Event', p: ['Channel'] },
    { fn: 'ReplaySelectFirstEvent', label: 'Replay Select First Event', p: ['Channel'] },
    { fn: 'ReplaySelectLastEvent',  label: 'Replay Select Last Event', p: ['Channel'] },
    { fn: 'ReplaySelectAllEvents',  label: 'Replay Select All Events', p: [] },
    { fn: 'ReplayDeleteLastEvent',  label: 'Replay Delete Last Event', p: ['Channel'] },
    { fn: 'ReplayDeleteSelectedEvent', label: 'Replay Delete Selected Event', p: ['Channel'] },
    { fn: 'ReplayDuplicateLastEvent', label: 'Replay Duplicate Last Event', p: ['Channel'] },
    { fn: 'ReplayCamera1',          label: 'Replay Camera 1',        p: [] },
    { fn: 'ReplayCamera2',          label: 'Replay Camera 2',        p: [] },
    { fn: 'ReplayCamera3',          label: 'Replay Camera 3',        p: [] },
    { fn: 'ReplayCamera4',          label: 'Replay Camera 4',        p: [] },
    { fn: 'ReplayACamera1',         label: 'Replay A: Camera 1',     p: [] },
    { fn: 'ReplayACamera2',         label: 'Replay A: Camera 2',     p: [] },
    { fn: 'ReplayACamera3',         label: 'Replay A: Camera 3',     p: [] },
    { fn: 'ReplayACamera4',         label: 'Replay A: Camera 4',     p: [] },
    { fn: 'ReplayBCamera1',         label: 'Replay B: Camera 1',     p: [] },
    { fn: 'ReplayBCamera2',         label: 'Replay B: Camera 2',     p: [] },
    { fn: 'ReplayBCamera3',         label: 'Replay B: Camera 3',     p: [] },
    { fn: 'ReplayBCamera4',         label: 'Replay B: Camera 4',     p: [] },
    { fn: 'ReplaySelectChannelA',   label: 'Replay Select Channel A', p: [] },
    { fn: 'ReplaySelectChannelB',   label: 'Replay Select Channel B', p: [] },
    { fn: 'ReplaySelectChannelAB',  label: 'Replay Select Channel A+B', p: [] },
    { fn: 'ReplayLastEventSingleCameraOn', label: 'Replay Last Event Single Camera On (Value=cam)', p: ['Value'] },
    { fn: 'ReplaySetAudioSource',   label: 'Replay Set Audio Source', p: ['Value'] },
    { fn: 'ReplayShowHide',         label: 'Replay Panel Show/Hide', p: [] },
  ]},
  { group: 'Script / System', fns: [
    { fn: 'ScriptStart',            label: 'Script Start',           p: ['Value'] },
    { fn: 'ScriptStartDynamic',     label: 'Script Start Dynamic',   p: ['Value'] },
    { fn: 'ScriptStop',             label: 'Script Stop',            p: ['Value'] },
    { fn: 'ScriptStopAll',          label: 'Script Stop All',        p: [] },
    { fn: 'ScriptStopDynamic',      label: 'Script Stop Dynamic',    p: [] },
    { fn: 'KeyPress',               label: 'Key Press',              p: ['Value'] },
    { fn: 'SendKeys',               label: 'Send Keys',              p: ['Value'] },
    { fn: 'Undo',                   label: 'Undo',                   p: [] },
    { fn: 'SavePreset',             label: 'Save Preset',            p: ['Value'] },
    { fn: 'OpenPreset',             label: 'Open Preset',            p: ['Value'] },
    { fn: 'LastPreset',             label: 'Last Preset',            p: [] },
    { fn: 'ActivatorRefresh',       label: 'Activator Refresh',      p: [] },
    { fn: 'CallManagerShowHide',    label: 'Call Manager Show/Hide', p: [] },
  ]},
  { group: 'MultiView', fns: [
    { fn: 'MultiViewOverlay',       label: 'MultiView Overlay Toggle', p: ['Input', 'Value'] },
    { fn: 'MultiViewOverlayOn',     label: 'MultiView Overlay On',     p: ['Input', 'Value'] },
    { fn: 'MultiViewOverlayOff',    label: 'MultiView Overlay Off',    p: ['Input', 'Value'] },
    { fn: 'SetMultiViewOverlay',    label: 'Set MultiView Overlay',    p: ['Input', 'Value'] },
    { fn: 'MoveMultiViewOverlay',   label: 'Move MultiView Overlay',   p: ['Input', 'Value'] },
  ]},
  { group: 'NDI', fns: [
    { fn: 'NDICommand',             label: 'NDI Command',            p: ['Input', 'Value'] },
    { fn: 'NDISelectSourceByName',  label: 'NDI Select Source By Name', p: ['Input', 'Value'] },
    { fn: 'NDISelectSourceByIndex', label: 'NDI Select Source By Index', p: ['Input', 'Value'] },
    { fn: 'NDIStartRecording',      label: 'NDI Start Recording',    p: ['Input'] },
    { fn: 'NDIStopRecording',       label: 'NDI Stop Recording',     p: ['Input'] },
  ]},
  { group: 'PlayList', fns: [
    { fn: 'SelectPlayList',         label: 'Select PlayList',        p: ['Value'] },
    { fn: 'StartPlayList',          label: 'Start PlayList',         p: [] },
    { fn: 'StopPlayList',           label: 'Stop PlayList',          p: [] },
    { fn: 'NextPlayListEntry',      label: 'Next PlayList Entry',    p: [] },
    { fn: 'PreviousPlayListEntry',  label: 'Previous PlayList Entry', p: [] },
  ]},
  { group: 'Custom', fns: [
    { fn: '__custom__',             label: 'Custom…',                p: [] },
  ]},
];

export const VMIX_ALL_FNS = VMIX_FUNCTIONS.flatMap(g => g.fns);

const SCORE_STYLES = [
  { value: 'basic',         label: 'Basic',              increments: [1,2,5,10] },
  { value: 'basketball',    label: 'Basketball',          increments: [1,2,3] },
  { value: 'football',      label: 'American Football',   increments: [1,2,3,6,7] },
  { value: 'soccer',        label: 'Soccer',              increments: [1] },
  { value: 'rugby-union',   label: 'Rugby Union',         increments: RUGBY_UNION_INCS },
  { value: 'rugby-league',  label: 'Rugby League',        increments: RUGBY_LEAGUE_INCS },
];

// Match Schedule's vMix "merge into one field" composer (see the
// 'match-schedule' case's FixtureVmixTarget.mergedParts) — the same six
// pieces of fixture data already available as individual prefix fields,
// just concatenable into one string instead, in whatever order the
// operator drags them (see MergeFieldComposer.tsx).
export type FixturePart = 'teamA' | 'teamB' | 'date' | 'time' | 'round' | 'venue';
const FIXTURE_MERGE_PARTS: MergePart[] = [
  { key: 'teamA', label: 'Team A', sample: 'Chelsea' },
  { key: 'teamB', label: 'Team B', sample: 'Arsenal' },
  { key: 'fullTeamA', label: 'Full Name A', sample: 'Chelsea FC' },
  { key: 'fullTeamB', label: 'Full Name B', sample: 'Arsenal FC' },
  { key: 'date',  label: 'Date',   sample: '2026-08-20' },
  { key: 'time',  label: 'Time',   sample: '19:00' },
  { key: 'round', label: 'Round',  sample: 'Round 3' },
  { key: 'venue', label: 'Venue',  sample: 'Wembley' },
  { key: 'group', label: 'Group/Stage', sample: 'Group A' },
  { key: 'matchId', label: 'Match ID', sample: 'MB1' },
];

// Scoreboard's own vMix merge composers (see the 'scoreboard' case) — one
// per team (its own name/short-name/custom-text/score) plus one for the
// shared match info that isn't per-team. Now defined in lib/templateBinding.ts
// (shared with the CG template designer's binding registry) and re-imported
// here under their original names.

// Group Standings widget's per-row vMix merge composer (see the
// 'group-standings' case) — one row per team in the auto-detected group.
const GROUP_STANDINGS_MERGE_PARTS: MergePart[] = [
  { key: 'rank',      label: 'Rank',        sample: '1' },
  { key: 'team',      label: 'Team',        sample: 'Chelsea' },
  { key: 'shortTeam', label: 'Short Name',  sample: 'CHE' },
  { key: 'played', label: 'Played',         sample: '3' },
  { key: 'won',    label: 'Won',            sample: '2' },
  { key: 'drawn',  label: 'Drawn',          sample: '0' },
  { key: 'lost',   label: 'Lost',           sample: '1' },
  { key: 'pf',     label: 'Points For',     sample: '45' },
  { key: 'pa',     label: 'Points Against', sample: '30' },
  { key: 'diff',   label: 'Diff',           sample: '+15' },
  { key: 'pts',    label: 'Points',         sample: '6' },
];
const BRACKET_MERGE_PARTS: MergePart[] = [
  { key: 'stage',     label: 'Stage/Round', sample: 'Semifinal' },
  { key: 'teamA',     label: 'Team A',      sample: 'Chelsea' },
  { key: 'teamB',     label: 'Team B',      sample: 'Arsenal' },
  { key: 'fullTeamA', label: 'Full Name A', sample: 'Chelsea FC' },
  { key: 'fullTeamB', label: 'Full Name B', sample: 'Arsenal FC' },
  { key: 'scoreA',    label: 'Score A',     sample: '2' },
  { key: 'scoreB',    label: 'Score B',     sample: '1' },
  { key: 'winner',    label: 'Winner (A/B)', sample: 'A' },
];

export function InputPickerDropdown({ currentKey, currentTitle, allInputs, onSelect, filter }: {
  currentKey: string;
  currentTitle: string | undefined;
  allInputs: VmixInput[];
  onSelect: (key: string, title: string) => void;
  filter?: (i: VmixInput) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const inTrigger = triggerRef.current?.contains(e.target as Node);
      const inDropdown = dropdownRef.current?.contains(e.target as Node);
      if (!inTrigger && !inDropdown) { setOpen(false); setSearch(''); }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = () => {
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 3, left: r.left, width: r.width });
    }
    setOpen(o => !o);
  };

  const opts = filter ? allInputs.filter(filter) : allInputs;
  const filtered = search
    ? opts.filter(i =>
        i.title.toLowerCase().includes(search.toLowerCase()) ||
        String(i.number).includes(search)
      )
    : opts;
  const selected = allInputs.find(i => i.key === currentKey);
  const displayTitle = currentTitle || selected?.title || '';

  return (
    <div className="cfg-inp-picker" ref={triggerRef}>
      <div className={`cfg-inp-picker-display ${open ? 'cfg-inp-picker-display--open' : ''}`}
        onClick={toggle}>
        {currentKey ? (
          <>
            {selected && <span className="cfg-inp-picker-num">{selected.number}</span>}
            <span className="cfg-inp-picker-display-title">{displayTitle || currentKey}</span>
            {selected && <span className={`cfg-inp-picker-tag input-type-tag input-type-tag--${selected.type?.toLowerCase()}`}>{INPUT_TYPE_LABELS[selected.type] ?? selected.type}</span>}
          </>
        ) : (
          <span className="cfg-inp-picker-placeholder">— select input —</span>
        )}
        <span className="cfg-inp-picker-chevron">{open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}</span>
        {currentKey && (
          <span className="cfg-inp-picker-clear" onClick={e => { e.stopPropagation(); onSelect('', ''); setOpen(false); }}>×</span>
        )}
      </div>
      {open && pos && createPortal(
        <div className="cfg-inp-picker-dropdown" ref={dropdownRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}>
          <input className="cfg-inp-picker-search" placeholder="Search…" autoFocus
            value={search} onChange={e => setSearch(e.target.value)}
            onClick={e => e.stopPropagation()} />
          <ul className="cfg-inp-picker-list">
            {filtered.length === 0
              ? <li className="cfg-inp-picker-empty">No inputs</li>
              : filtered.map(inp => (
                <li key={inp.key}
                  className={`cfg-inp-picker-item${inp.key === currentKey ? ' cfg-inp-picker-item--selected' : ''}`}
                  onClick={() => { onSelect(inp.key, inp.title); setOpen(false); setSearch(''); }}>
                  <span className="cfg-inp-picker-num">{inp.number}</span>
                  <span className="cfg-inp-picker-item-title">{inp.title || `Input ${inp.number}`}</span>
                  <span className={`cfg-inp-picker-tag input-type-tag input-type-tag--${inp.type?.toLowerCase()}`}>{INPUT_TYPE_LABELS[inp.type] ?? inp.type}</span>
                </li>
              ))
            }
          </ul>
        </div>,
        document.body
      )}
    </div>
  );
}

export function FieldPickerDropdown({ inputKey, value, onChange, placeholder = 'Title.Text', fieldFilter, allInputs }: {
  inputKey: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  fieldFilter?: (name: string) => boolean;
  allInputs: VmixInput[];
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const inp = allInputs.find(i => i.key === inputKey);
  const allFields = inp?.textFields ?? [];
  const fields = fieldFilter ? allFields.filter(f => fieldFilter(f.name)) : allFields;
  const filtered = search ? fields.filter(f => f.name.toLowerCase().includes(search.toLowerCase())) : fields;
  const currentVal = value ? allFields.find(f => f.name === value)?.value : undefined;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const inTrigger = triggerRef.current?.contains(e.target as Node);
      const inDropdown = dropdownRef.current?.contains(e.target as Node);
      if (!inTrigger && !inDropdown) {
        if (search && search !== value) onChange(search);
        setOpen(false); setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, search, value, onChange]);

  const toggle = () => {
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 3, left: r.left, width: r.width });
    }
    setSearch(value);
    setOpen(o => !o);
  };

  return (
    <div className="cfg-field-picker" ref={triggerRef}>
      <div className={`cfg-inp-picker-display ${open ? 'cfg-inp-picker-display--open' : ''}`}
        onClick={toggle}>
        {value
          ? (
            <>
              {currentVal !== undefined && currentVal !== '' && (
                <span className="cfg-inp-picker-value-ref" title="Current value in vMix — shown for reference only">{currentVal}</span>
              )}
              <span className="cfg-inp-picker-display-title">{value}</span>
            </>
          )
          : <span className="cfg-inp-picker-placeholder">{placeholder}</span>
        }
        <span className="cfg-inp-picker-chevron">{open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}</span>
        {value && <span className="cfg-inp-picker-clear" onClick={e => { e.stopPropagation(); onChange(''); setOpen(false); }}>×</span>}
      </div>
      {open && pos && createPortal(
        <div className="cfg-inp-picker-dropdown" ref={dropdownRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}>
          <input className="cfg-inp-picker-search" placeholder="Type or search field…" autoFocus
            value={search} onChange={e => setSearch(e.target.value)}
            onClick={e => e.stopPropagation()}
            onKeyDown={e => {
              if (e.key === 'Enter') { if (search) onChange(search); setOpen(false); setSearch(''); }
              if (e.key === 'Escape') { setOpen(false); setSearch(''); }
            }} />
          <ul className="cfg-inp-picker-list">
            {filtered.length === 0 && !search && <li className="cfg-inp-picker-empty">No fields available</li>}
            {filtered.length === 0 && search && (
              <li className="cfg-inp-picker-item" onClick={() => { onChange(search); setOpen(false); setSearch(''); }}>
                <span className="cfg-inp-picker-display-title" style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>Use "{search}"</span>
              </li>
            )}
            {filtered.map(f => (
              <li key={f.name}
                className={`cfg-inp-picker-item${f.name === value ? ' cfg-inp-picker-item--selected' : ''}`}
                onClick={() => { onChange(f.name); setOpen(false); setSearch(''); }}>
                {f.value !== '' && <span className="cfg-inp-picker-field-val" title="Current value in vMix — shown for reference only">{f.value}</span>}
                <span className="cfg-inp-picker-item-title">{f.name}</span>
              </li>
            ))}
          </ul>
        </div>,
        document.body
      )}
    </div>
  );
}

interface Props {
  widget: CanvasWidget;
  onClose: () => void;
  pagesOverride?: import('../types/canvas').CanvasPage[];
  /** 'cg-template' widgets edit via a dedicated full-screen designer (see
   *  CgTemplateDesigner.tsx) instead of a field list — this callback is how
   *  that case (below) asks the mounting component (Canvas.tsx) to open it. */
  onOpenTemplateDesigner?: (widgetId: string) => void;
  actionsOverride?: {
    updateWidgetConfig: (id: string, patch: Record<string, any>) => void;
    updateWidget: (id: string, patch: Partial<CanvasWidget>) => void;
    deleteWidget: (id: string) => void;
    duplicateWidget: (id: string) => void;
    selectWidget: (id: string | null) => void;
  };
}

export function CollapsibleSection({ label, children, defaultOpen = true }: { label: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <div className="config-section-label config-section-label--toggle" onClick={() => setOpen(o => !o)}>
        <span>{label}</span>
        <span className="config-section-chevron">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </div>
      {open && <>{children}</>}
    </>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field-row">
      <label className="field-label">{label}</label>
      {children}
    </div>
  );
}

/** Drop-in replacement for every small, fixed-option `<select>` across this
 *  whole panel (any widget type) — rendered as the same glowing "Match
 *  Type" card grid Tournament Manager's own sport picker uses
 *  (`.tm-ms-sport-grid`/`.tm-ms-sport-card` in src/index.css), reused here
 *  as-is rather than a second visual language. `icon`/`sub` are both
 *  optional per option — a plain binary choice (Auto/Manual, A/B) still
 *  gets the same card box/glow treatment, just text-only; richer choices
 *  (a layout style, a fit mode) add an icon and/or a one-line description
 *  on top. Was previously two separate components (a plainer "PillSelect"
 *  for simple toggles, this one for richer choices) — collapsed into just
 *  this one so EVERY picker in the panel reads as the same design, not two
 *  different weights of control side by side. */
export function CardSelect<T extends string | number | boolean>({ options, value, onChange, columns, className, title }: {
  options: { value: T; label: string; sub?: string; icon?: typeof Info }[];
  value: T;
  onChange: (v: T) => void;
  /** Grid columns — default 2 (matches Tournament Manager's own Match
   *  Duration pill grid); pass however many actually fit this panel's own
   *  option count/width without wrapping awkwardly. */
  columns?: number;
  /** Extra class(es) on the grid container — e.g. `tm-ms-sport-grid--narrow`
   *  to shrink the cards for a tight space (a widget's own compact gear
   *  popover, not the full-width settings panel). */
  className?: string;
  /** Tooltip for the whole control, same spot a checkbox's own `title` used to sit. */
  title?: string;
}) {
  return (
    <div className={`tm-ms-duration-grid${className ? ` ${className}` : ''}`} title={title} style={columns ? { gridTemplateColumns: `repeat(${columns}, 1fr)` } : undefined}>
      {options.map(opt => {
        const Icon = opt.icon;
        const active = value === opt.value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            className={`tm-ms-sport-card${active ? ' tm-ms-sport-card--active' : ''}`}
            onClick={() => onChange(opt.value)}
          >
            {Icon && <Icon size={20} strokeWidth={1.75} />}
            <span className="tm-ms-sport-card-name">{opt.label}</span>
            {opt.sub && <span className="tm-ms-sport-card-sub">{opt.sub}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Drop-in replacement for every plain `<input type="checkbox">` "tick to
 *  enable" toggle across this panel — a two-button CardSelect (On/Off) so
 *  BOTH states are an explicit, clickable button (no bare unticked box that
 *  shows nothing when a setting is off). `desc`/`title` cover the two shapes
 *  a checkbox used to take here: a trailing description line after the box,
 *  or a tooltip explaining a non-obvious rule. */
export function ToggleCard({ checked, onChange, desc, title, onLabel = 'On', offLabel = 'Off' }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  desc?: string;
  title?: string;
  onLabel?: string;
  offLabel?: string;
}) {
  return (
    <div title={title}>
      <CardSelect value={checked} onChange={onChange} columns={2}
        options={[{ value: true, label: onLabel }, { value: false, label: offLabel }]} />
      {desc && <p className="app-settings-hint" style={{ margin: '4px 0 0' }}>{desc}</p>}
    </div>
  );
}

/** A live, read-only "Details" summary — same box Tournament Manager's own
 *  Match Settings panel and this file's own 'racket-scoreboard' case
 *  already use (`.tm-ms-details`/`.tm-ms-details-row`), reused as-is. Put
 *  this at the TOP of a widget's settings, above its own CollapsibleSections,
 *  so the 2-4 facts that actually matter at a glance don't require opening
 *  anything — same "see the effect of what you just picked immediately"
 *  reasoning the racket-scoreboard panel's own Details box already has. */
function SettingsSummary({ rows }: { rows: { icon?: typeof Info; label: string; value: string }[] }) {
  return (
    <div className="tm-ms-details" style={{ marginBottom: 10 }}>
      <div className="tm-ms-details-label"><Info size={13} strokeWidth={2} /> Details</div>
      {rows.map((row, i) => {
        const Icon = row.icon;
        return (
          <div key={i} className="tm-ms-details-row">
            {Icon && <Icon size={13} strokeWidth={2} />}
            <span className="tm-ms-details-key">{row.label}:</span>
            <span className="tm-ms-details-val">{row.value}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Wraps a CUSTOM/freeform control (a color swatch, a slider, a number
 *  field — anything that isn't picking from a small fixed set of named
 *  options, so CardSelect doesn't fit) in the same dark box the Details
 *  summary/card grid already use (`.tm-ms-details`), so a "customize this"
 *  control sitting right next to a card grid reads as part of the same
 *  design instead of a bare input floating against the panel's own
 *  background. `label` is optional — omit it when the control already
 *  carries its own via the surrounding <Field>. */
export function CustomBox({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="tm-ms-details tm-ms-custom-box">
      {label && <div className="tm-ms-details-label">{label}</div>}
      {children}
    </div>
  );
}

const _panelPos = { x: -1, y: 56, w: 300, h: 480 };

export function WidgetConfigPanel({ widget, onClose, pagesOverride, actionsOverride, onOpenTemplateDesigner }: Props) {
  const store = useCanvasStore();
  const updateWidgetConfig = actionsOverride?.updateWidgetConfig ?? store.updateWidgetConfig;
  const updateWidget = actionsOverride?.updateWidget ?? store.updateWidget;
  const duplicateWidget = actionsOverride?.duplicateWidget ?? store.duplicateWidget;
  const deleteWidget = actionsOverride?.deleteWidget ?? store.deleteWidget;
  const selectWidget = actionsOverride?.selectWidget ?? store.selectWidget;
  const pages = pagesOverride ? [...store.pages, ...pagesOverride] : store.pages;
  const { vmixState, globalVariables, getClient } = useVmixStore();
  const { tournaments } = useTournamentStore();
  const { matches: allMatches } = useMatchScheduleStore();
  // A canvas is normally dedicated to one tournament — widgets fall back to
  // that instead of each needing its own "which tournament" picker (though
  // the picker below still lets a widget override it when it truly differs).
  const widgetPage = pages.find(p => p.widgets.some(w => w.id === widget.id));
  const pageTournamentId = widgetPage?.tournamentId;
  const pageTournament = tournaments.find(t => t.id === pageTournamentId);
  const { teams: teamDbTeams } = useTeamDbStore();
  const cfg = widget.config;
  const up = (patch: Record<string, any>) => updateWidgetConfig(widget.id, patch);
  const [panelExpandedId, setPanelExpandedId] = useState<string | null>(null);
  const [idError, setIdError] = useState<string | null>(null);
  useEffect(() => setIdError(null), [widget.id]);
  const commitIdChange = (value: string) => {
    if (value === widget.id) return;
    const result = store.renameWidgetId(widget.id, value);
    setIdError(result.ok ? null : (result.error ?? 'Could not rename'));
  };
  const [durationText, setDurationText] = useState(() =>
    msToFormatStr(cfg.durationMs ?? 0, cfg.format ?? 'mm:ss')
  );
  useEffect(() => {
    setDurationText(msToFormatStr(cfg.durationMs ?? 0, cfg.format ?? 'mm:ss'));
  }, [cfg.durationMs, cfg.format]);

  const [breakText, setBreakText] = useState(() =>
    msToFormatStr(cfg.breakDurationMs ?? 0, cfg.format ?? 'mm:ss')
  );
  useEffect(() => {
    setBreakText(msToFormatStr(cfg.breakDurationMs ?? 0, cfg.format ?? 'mm:ss'));
  }, [cfg.breakDurationMs, cfg.format]);

  const [finalPlayDurationText, setFinalPlayDurationText] = useState(() =>
    msToFormatStr(cfg.finalPlayDurationMs ?? 0, cfg.format ?? 'mm:ss')
  );
  useEffect(() => {
    setFinalPlayDurationText(msToFormatStr(cfg.finalPlayDurationMs ?? 0, cfg.format ?? 'mm:ss'));
  }, [cfg.finalPlayDurationMs, cfg.format]);
  const allInputs = vmixState?.inputs ?? [];
  const allHotkeyBindings = collectHotkeyBindings(pages);

  const [vtCollapsed, setVTCollapsed] = useState<Record<string, boolean>>({});
  const [tfCollapsed, setTFCollapsed] = useState<Record<number, boolean>>({});
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [configTab, setConfigTab] = useState<'general' | 'vmix'>('general');
  useEffect(() => setConfigTab('general'), [widget.id]);
  const [pos, setPos] = useState<{ x: number; y: number; w: number; h: number }>(() => {
    if (_panelPos.x < 0) _panelPos.x = Math.max(0, window.innerWidth - _panelPos.w - 16);
    return { ..._panelPos };
  });
  const updatePos = (patch: Partial<typeof pos>) => {
    const next = { ...pos, ...patch };
    Object.assign(_panelPos, next);
    setPos(next);
  };
  const panelDragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const panelResizeXRef = useRef<{ sx: number; ow: number } | null>(null);
  const panelResizeBRRef = useRef<{ sx: number; sy: number; ow: number; oh: number } | null>(null);
  const onPanelDragDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    panelDragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onPanelDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!panelDragRef.current) return;
    const x = Math.max(0, Math.min(window.innerWidth - 80, panelDragRef.current.ox + e.clientX - panelDragRef.current.sx));
    const y = Math.max(0, Math.min(window.innerHeight - 40, panelDragRef.current.oy + e.clientY - panelDragRef.current.sy));
    updatePos({ x, y });
  };
  const onPanelDragUp = () => { panelDragRef.current = null; };
  const onResizeXDown = (e: React.PointerEvent<HTMLDivElement>) => {
    panelResizeXRef.current = { sx: e.clientX, ow: pos.w };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.stopPropagation(); e.preventDefault();
  };
  const onResizeXMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!panelResizeXRef.current) return;
    updatePos({ w: Math.max(240, Math.min(window.innerWidth - 40, panelResizeXRef.current.ow + e.clientX - panelResizeXRef.current.sx)) });
  };
  const onResizeXUp = () => { panelResizeXRef.current = null; };
  const onResizeBRDown = (e: React.PointerEvent<HTMLDivElement>) => {
    panelResizeBRRef.current = { sx: e.clientX, sy: e.clientY, ow: pos.w, oh: pos.h };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.stopPropagation(); e.preventDefault();
  };
  const onResizeBRMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!panelResizeBRRef.current) return;
    const w = Math.max(240, Math.min(window.innerWidth - 40, panelResizeBRRef.current.ow + e.clientX - panelResizeBRRef.current.sx));
    const h = Math.max(120, Math.min(window.innerHeight - 40, panelResizeBRRef.current.oh + e.clientY - panelResizeBRRef.current.sy));
    updatePos({ w, h });
  };
  const onResizeBRUp = () => { panelResizeBRRef.current = null; };
  const [adjNewLabel, setAdjNewLabel] = useState('');
  const [adjNewSeconds, setAdjNewSeconds] = useState('10');
  const [vilCollapsed, setVilCollapsed] = useState<Record<string, boolean>>({});

  const renderInputPicker = (
    label: string,
    currentKey: string,
    currentTitle: string | undefined,
    onSelect: (key: string, title: string) => void,
    filter?: (i: VmixInput) => boolean,
    inputs?: typeof allInputs,
  ) => (
    <Field label={label}>
      <InputPickerDropdown
        currentKey={currentKey}
        currentTitle={currentTitle}
        allInputs={inputs ?? allInputs}
        onSelect={onSelect}
        filter={filter}
      />
    </Field>
  );

  const renderFieldPicker = (inputKey: string, value: string, onChange: (v: string) => void, placeholder = 'Title.Text', fieldFilter?: (name: string) => boolean, inputs?: typeof allInputs) => (
    <FieldPickerDropdown inputKey={inputKey} value={value} onChange={onChange} placeholder={placeholder} fieldFilter={fieldFilter} allInputs={inputs ?? allInputs} />
  );

  /** Every `case` below returns `renderTabbed(generalJsx, vmixJsx)` instead of
   *  JSX directly — `vmixJsx` is everything that reads/writes a vMix input
   *  (input/field pickers, Auto-send, overlay channel, trigger functions);
   *  everything else (data source links, layout, appearance) is `generalJsx`.
   *  Lets "vMix Input" live as its own page instead of interleaved with the
   *  rest of a widget's settings. Widget types with nothing to send to vMix
   *  just omit the second argument and get a plain explanatory line instead. */
  const renderTabbed = (general: React.ReactNode, vmix?: React.ReactNode) =>
    configTab === 'vmix'
      ? (vmix || <p className="app-settings-hint" style={{ margin: '4px 2px' }}>This widget doesn't send anything to vMix.</p>)
      : general;

  const renderConfig = () => {
    switch (widget.type) {

      case 'button': {
        type SideButton = { id: string; label: string; color?: string; textColor?: string; fontSize?: number; mode?: string; actions: ActionItem[]; releaseActions?: ActionItem[]; hotkey?: string };
        type ButtonState = { id: string; name: string; color?: string; textColor?: string; actions: ActionItem[] };
        const timerWidgets = pages.flatMap(p => p.widgets.filter(w => w.type === 'timer'));
        const scoreboardWidgets = pages.flatMap(p => p.widgets.filter(w => w.type === 'scoreboard'));
        const cgTemplateWidgets = [...pages, ...store.libraryPages].flatMap(p => p.widgets.filter(w => w.type === 'cg-template'));

        // Migrate legacy single-function format
        const pressActions: ActionItem[] = cfg.actions ?? (cfg.function ? [{ fn: cfg.function, params: cfg.params ?? {} }] : [{ fn: 'Cut', params: {} }]);
        const releaseActions: ActionItem[] = cfg.releaseActions ?? (cfg.releaseFunction ? [{ fn: cfg.releaseFunction, params: cfg.releaseParams ?? {} }] : []);

        const savePress = (next: ActionItem[]) => up({ actions: next });
        const saveRelease = (next: ActionItem[]) => up({ releaseActions: next });

        return (
          <>
            <Field label="Label">
              <input className="field-input" value={cfg.label ?? ''} onChange={e => up({ label: e.target.value })} />
            </Field>
            <Field label="Mode">
              <CardSelect value={cfg.mode ?? 'momentary'} onChange={v => up({ mode: v })}
                options={[
                  { value: 'momentary', label: 'Momentary' },
                  { value: 'toggle', label: 'Toggle' },
                  { value: 'multiState', label: 'Multi-State', sub: 'Cycle 3+ named states' },
                ]} />
            </Field>
            <Field label="Hotkey">
              <HotkeyRecorder value={cfg.hotkey ?? ''} onChange={v => up({ hotkey: v })} allBindings={allHotkeyBindings} />
            </Field>

            {cfg.mode === 'toggle' && pressActions.some(a => a.fn === 'Cg.In') && !releaseActions.length && (
              <p className="app-settings-hint" style={{ margin: '0 0 6px' }}>
                Toggle + a CG "Play In" press action needs no Release Action — pressing again automatically plays it Out (stops the same Channel/Layer).
              </p>
            )}

            {cfg.mode === 'multiState' ? (
              <>
                <p className="app-settings-hint" style={{ margin: '0 0 8px' }}>
                  Each press advances to the NEXT state below (wrapping back to the first after the last) and fires that state's own actions — e.g. a team card cycling Active → Inactive → Hidden on vMix, or any other 3+-way cycle a plain on/off Toggle can't express. The button itself relabels/recolors to whichever state is current.
                </p>
                <CollapsibleSection label="States">
                  {(() => {
                    const states: ButtonState[] = cfg.states?.length ? cfg.states : [];
                    const updateState = (i: number, patch: Partial<ButtonState>) =>
                      up({ states: states.map((s, j) => j === i ? { ...s, ...patch } : s) });
                    return (
                      <>
                        {states.map((s, i) => {
                          const isCollapsed = vilCollapsed[`st-${s.id}`] ?? false;
                          return (
                            <div key={s.id} className="vil-cfg-block">
                              <div className="vil-cfg-header">
                                <button className="btn btn--ghost btn--small tf-collapse-btn"
                                  onClick={() => setVilCollapsed(p => ({ ...p, [`st-${s.id}`]: !p[`st-${s.id}`] }))}>
                                  {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                </button>
                                <span className="vil-cfg-label">{s.name || `State ${i + 1}`}</span>
                                <button className="btn btn--ghost btn--small" disabled={i === 0} title="Move earlier"
                                  onClick={() => { const next = [...states]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; up({ states: next }); }}>↑</button>
                                <button className="btn btn--ghost btn--small" disabled={i === states.length - 1} title="Move later"
                                  onClick={() => { const next = [...states]; [next[i + 1], next[i]] = [next[i], next[i + 1]]; up({ states: next }); }}>↓</button>
                                <button className="btn btn--ghost btn--small" disabled={states.length <= 1} title="Remove"
                                  onClick={() => up({ states: states.filter((_, j) => j !== i) })}>×</button>
                              </div>
                              {!isCollapsed && (
                                <>
                                  <Field label="Name">
                                    <input className="field-input" value={s.name} placeholder={`State ${i + 1}`} onChange={e => updateState(i, { name: e.target.value })} />
                                  </Field>
                                  <Field label="Color">
                                    <div className="color-picker">
                                      {PRESET_COLORS.map(c => (
                                        <button key={c} className={`color-swatch ${s.color === c ? 'color-swatch--selected' : ''}`}
                                          style={{ background: c }} onClick={() => updateState(i, { color: c })} />
                                      ))}
                                      <input type="color" className="color-custom" value={s.color ?? '#3498db'} onChange={e => updateState(i, { color: e.target.value })} />
                                    </div>
                                  </Field>
                                  <CollapsibleSection label="Actions">
                                    <ActionListEditor actions={s.actions ?? []} onChange={(next) => updateState(i, { actions: next })} sectionKey={`st-${i}`}
                                      pages={pages} timerWidgets={timerWidgets} scoreboardWidgets={scoreboardWidgets}
                                      globalVariables={globalVariables} allInputs={allInputs} cgTemplateWidgets={cgTemplateWidgets} />
                                  </CollapsibleSection>
                                </>
                              )}
                            </div>
                          );
                        })}
                        <button className="action-add-btn"
                          onClick={() => up({ states: [...states, { id: crypto.randomUUID(), name: `State ${states.length + 1}`, color: '#3498db', actions: [] }] })}>
                          + Add State
                        </button>
                        {states.length < 2 && (
                          <p className="app-settings-hint" style={{ margin: '6px 0 0' }}>
                            Add at least two states for a press to actually cycle anything.
                          </p>
                        )}
                      </>
                    );
                  })()}
                </CollapsibleSection>
              </>
            ) : (
              <>
                <CollapsibleSection label="Press Actions">
                  <ActionListEditor actions={pressActions} onChange={savePress} sectionKey="press"
                    pages={pages} timerWidgets={timerWidgets} scoreboardWidgets={scoreboardWidgets}
                    globalVariables={globalVariables} allInputs={allInputs} cgTemplateWidgets={cgTemplateWidgets} />
                </CollapsibleSection>

                <CollapsibleSection label="Release Actions">
                  <ActionListEditor actions={releaseActions} onChange={saveRelease} sectionKey="release"
                    pages={pages} timerWidgets={timerWidgets} scoreboardWidgets={scoreboardWidgets}
                    globalVariables={globalVariables} allInputs={allInputs} cgTemplateWidgets={cgTemplateWidgets} />
                </CollapsibleSection>
              </>
            )}

            <CollapsibleSection label="Side Buttons">
              {(() => {
                const sideButtons: SideButton[] = cfg.sideButtons ?? [];
                const updateSb = (i: number, patch: Partial<SideButton>) =>
                  up({ sideButtons: sideButtons.map((sb, j) => j === i ? { ...sb, ...patch } : sb) });
                return (
                  <>
                    {sideButtons.map((sb, i) => {
                      const isCollapsed = vilCollapsed[`sb-${sb.id}`] ?? false;
                      return (
                        <div key={sb.id} className="vil-cfg-block">
                          <div className="vil-cfg-header">
                            <button className="btn btn--ghost btn--small tf-collapse-btn"
                              onClick={() => setVilCollapsed(p => ({ ...p, [`sb-${sb.id}`]: !p[`sb-${sb.id}`] }))}>
                              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                            </button>
                            <span className="vil-cfg-label">{sb.label || `Button ${i + 1}`}</span>
                            <button className="btn btn--ghost btn--small"
                              onClick={() => up({ sideButtons: sideButtons.filter((_, j) => j !== i) })}>×</button>
                          </div>
                          {!isCollapsed && (
                            <>
                              <Field label="Label">
                                <input className="field-input" value={sb.label} onChange={e => updateSb(i, { label: e.target.value })} />
                              </Field>
                              <Field label="Mode">
                                <CardSelect value={sb.mode ?? 'momentary'} onChange={v => updateSb(i, { mode: v })} options={[{ value: 'momentary', label: 'Momentary' }, { value: 'toggle', label: 'Toggle' }]} />
                              </Field>
                              <Field label="Hotkey">
                                <HotkeyRecorder value={sb.hotkey ?? ''} onChange={v => updateSb(i, { hotkey: v })} allBindings={allHotkeyBindings} />
                              </Field>
                              <Field label="Color">
                                <div className="color-picker">
                                  {PRESET_COLORS.map(c => (
                                    <button key={c} className={`color-swatch ${sb.color === c ? 'color-swatch--selected' : ''}`}
                                      style={{ background: c }} onClick={() => updateSb(i, { color: c })} />
                                  ))}
                                  <input type="color" className="color-custom" value={sb.color ?? '#555555'} onChange={e => updateSb(i, { color: e.target.value })} />
                                </div>
                              </Field>
                              <Field label="Font Size">
                                <input className="field-input" type="number" min={8} max={32} value={sb.fontSize ?? 11} onChange={e => updateSb(i, { fontSize: Number(e.target.value) })} />
                              </Field>
                              <CollapsibleSection label="Press Actions">
                                <ActionListEditor actions={sb.actions ?? []} onChange={(next) => updateSb(i, { actions: next })} sectionKey={`sb-${i}-press`}
                                  pages={pages} timerWidgets={timerWidgets} scoreboardWidgets={scoreboardWidgets}
                                  globalVariables={globalVariables} allInputs={allInputs} cgTemplateWidgets={cgTemplateWidgets} />
                              </CollapsibleSection>
                              <CollapsibleSection label="Release Actions">
                                <ActionListEditor actions={sb.releaseActions ?? []} onChange={(next) => updateSb(i, { releaseActions: next })} sectionKey={`sb-${i}-release`}
                                  pages={pages} timerWidgets={timerWidgets} scoreboardWidgets={scoreboardWidgets}
                                  globalVariables={globalVariables} allInputs={allInputs} cgTemplateWidgets={cgTemplateWidgets} />
                              </CollapsibleSection>
                            </>
                          )}
                        </div>
                      );
                    })}
                    <button className="action-add-btn"
                      onClick={() => up({ sideButtons: [...sideButtons, { id: crypto.randomUUID(), label: 'Button', color: '#555555', mode: 'momentary', actions: [] }] })}>
                      + Add Side Button
                    </button>
                  </>
                );
              })()}
            </CollapsibleSection>

            <CollapsibleSection label="Appearance">
              <Field label="Color">
                <div className="color-picker">
                  {PRESET_COLORS.map(c => (
                    <button key={c} className={`color-swatch ${cfg.color === c ? 'color-swatch--selected' : ''}`} style={{ background: c }} onClick={() => up({ color: c })} />
                  ))}
                  <input type="color" className="color-custom" value={cfg.color ?? '#3498db'} onChange={e => up({ color: e.target.value })} />
                </div>
              </Field>
              <Field label="Text Color">
                <div className="color-picker">
                  {['#ffffff','#000000','#f1c40f','#e74c3c'].map(c => (
                    <button key={c} className={`color-swatch ${cfg.textColor === c ? 'color-swatch--selected' : ''}`} style={{ background: c }} onClick={() => up({ textColor: c })} />
                  ))}
                </div>
              </Field>
              <Field label="Font Size">
                <input className="field-input" type="number" min={8} max={48} value={cfg.fontSize ?? 14} onChange={e => up({ fontSize: Number(e.target.value) })} />
              </Field>
              <Field label="Tally Input (optional)">
                <InputPickerDropdown
                  currentKey={cfg.tallyInputKey ?? ''}
                  currentTitle={allInputs.find(i => i.key === cfg.tallyInputKey)?.title}
                  allInputs={allInputs}
                  onSelect={(key) => up({ tallyInputKey: key || undefined })}
                />
              </Field>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '2px 0 0' }}>
                Auto-detected from press actions if not set. Shows PGM / OVL / PRV state.
              </p>
            </CollapsibleSection>
          </>
        );
      }

      case 'title-field': {
        // Normalise legacy single-input format
        type TFEntry = string | { name: string; type: 'source' };
        type TFGroup = { inputKey: string; inputTitle?: string; name?: string; fields: TFEntry[] };
        const tfFName = (f: TFEntry) => typeof f === 'string' ? f : f.name;
        const tfFType = (f: TFEntry): 'text' | 'source' => typeof f === 'string' ? 'text' : (f.type ?? 'text');
        const groups: TFGroup[] = cfg.inputs ?? (
          cfg.inputKey
            ? [{ inputKey: cfg.inputKey, inputTitle: cfg.inputTitle, fields: cfg.fields ?? [cfg.fieldName ?? 'Title.Text'] }]
            : [{ inputKey: '', fields: ['Title.Text'] }]
        );

        const setGroups = (next: TFGroup[]) => up({ inputs: next, inputKey: undefined, fields: undefined, fieldName: undefined });
        const updateGroup = (gi: number, patch: Partial<TFGroup>) => {
          const next = groups.map((g, i) => i === gi ? { ...g, ...patch } : g);
          setGroups(next);
        };

        const general = (
          <Field label="Display Label">
            <input className="field-input" value={cfg.label ?? ''} onChange={e => up({ label: e.target.value })} />
          </Field>
        );

        const vmix = (
          <>
            <div className="tf-autosend-row">
              <ToggleCard checked={cfg.autoSend ?? false} onChange={v => up({ autoSend: v })} desc="Auto-send while typing" />
              {cfg.autoSend && (
                <div className="tf-autosend-delay">
                  <span className="field-label">Delay (ms)</span>
                  <input
                    className="field-input"
                    type="number"
                    min={0}
                    max={2000}
                    step={100}
                    value={cfg.autoSendDelayMs ?? 400}
                    onChange={e => up({ autoSendDelayMs: Number(e.target.value) })}
                    style={{ width: 90 }}
                  />
                </div>
              )}
            </div>

            {groups.map((grp, gi) => {
              const isCollapsed = tfCollapsed[gi] ?? false;
              return (
                <div key={gi} className="tf-group-block">
                  <div className="tf-group-header">
                    <button
                      className="btn btn--ghost btn--small tf-collapse-btn"
                      onClick={() => setTFCollapsed(prev => ({ ...prev, [gi]: !prev[gi] }))}
                      title={isCollapsed ? 'Expand' : 'Collapse'}>
                      {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    </button>
                    <input
                      className="tf-group-name-input"
                      value={grp.name ?? ''}
                      placeholder={`Title Field Input ${gi + 1}`}
                      onChange={e => updateGroup(gi, { name: e.target.value })}
                    />
                    {groups.length > 1 && (
                      <button className="btn btn--ghost btn--small tf-field-del"
                        onClick={() => setGroups(groups.filter((_, i) => i !== gi))}>×</button>
                    )}
                  </div>

                  {!isCollapsed && (<>
                    {renderInputPicker(
                      'vMix Input',
                      grp.inputKey,
                      grp.inputTitle,
                      (key, title) => {
                        const inp = allInputs.find(i => i.key === key);
                        updateGroup(gi, {
                          inputKey: key,
                          inputTitle: title,
                          fields: inp?.textFields?.length ? inp.textFields.map((f: { name: string }) => f.name) : grp.fields,
                        });
                      },
                      undefined,
                      allInputs,
                    )}

                    {/* Field list */}
                    <div className="tf-fields-editor">
                      {grp.fields.map((f, fi) => (
                        <div key={fi} className="tf-field-row">
                          <FieldPickerDropdown
                            inputKey={grp.inputKey}
                            value={tfFName(f)}
                            onChange={v => {
                              const next = [...grp.fields];
                              next[fi] = tfFType(f) === 'source' ? { name: v, type: 'source' } : v;
                              updateGroup(gi, { fields: next });
                            }}
                            placeholder="FieldName.Text"
                            allInputs={allInputs}
                          />
                          <button
                            className={`btn btn--small${tfFType(f) === 'source' ? '' : ' btn--ghost'}`}
                            title={tfFType(f) === 'source' ? 'Source (image) field — click to switch to Text' : 'Text field — click to switch to Source'}
                            style={{ minWidth: 22, padding: '0 4px', fontSize: 10 }}
                            onClick={() => {
                              const next = [...grp.fields];
                              const name = tfFName(f);
                              next[fi] = tfFType(f) === 'text' ? { name, type: 'source' } : name;
                              updateGroup(gi, { fields: next });
                            }}>
                            {tfFType(f) === 'source' ? 'S' : 'T'}
                          </button>
                          <button className="btn btn--ghost btn--small tf-field-del"
                            onClick={() => updateGroup(gi, { fields: grp.fields.filter((_, i) => i !== fi) })}
                            disabled={grp.fields.length === 1}>×</button>
                        </div>
                      ))}
                      <button className="btn btn--ghost btn--small" style={{ alignSelf: 'flex-start', marginTop: 2 }}
                        onClick={() => updateGroup(gi, { fields: [...grp.fields, ''] })}>
                        + Add Field
                      </button>
                    </div>
                  </>)}
                </div>
              );
            })}

            <button className="btn btn--ghost btn--small"
              onClick={() => setGroups([...groups, { inputKey: '', fields: ['Title.Text'] }])}>
              + Add vMix Input
            </button>
          </>
        );

        return renderTabbed(general, vmix);
      }

      // RacketScoreboardWidget.tsx (badminton/table tennis/tennis/sepaktakraw)
      // — same section shape as 'scoreboard' just below (Tournament DB, Teams,
      // Match Info, Appearance) so it's just as configurable from this same
      // panel, plus its own "Scoring Rules" section in place of football's
      // "Sport Style"/increments (a rally-point/tennis engine has nothing
      // resembling a scoring INCREMENT to configure — see lib/racketScoring.ts).
      // Team Name/Color/Logo are ALSO editable right on the widget itself
      // (inline color swatch + name input + TeamPicker) — same "quick edit
      // inline, deeper settings here" split 'scoreboard' already has, not a
      // conflicting second source of truth.
      case 'racket-scoreboard': {
        const sport: SportType = cfg.sport ?? 'badminton';
        const scoringMode: 'rally' | 'tennis' = cfg.scoringMode ?? 'rally';
        const isTennis = scoringMode === 'tennis';
        const applySport = (next: SportType) => {
          const rs: RacketSportSettings = SPORT_DEFAULTS[next].racketScoring
            ?? { mode: 'rally', pointsToWin: 21, winBy2: true, gamesToWin: 2, tiebreakAtGames: 6, noAd: false, serviceMode: 'auto', serviceRule: 'rally-winner', serviceAlternateEvery: 2 };
          up({
            sport: next, scoringMode: rs.mode,
            pointsToWin: rs.pointsToWin, winBy2: rs.winBy2, pointCap: rs.pointCap, deuceTarget: rs.deuceTarget, gamesToWin: rs.gamesToWin,
            tiebreakAtGames: rs.tiebreakAtGames, noAd: rs.noAd,
            serviceMode: rs.serviceMode, serviceRule: rs.serviceRule, serviceAlternateEvery: rs.serviceAlternateEvery,
            rallyState: initRallyMatch(), tennisState: initTennisMatch(), pointHistory: [], pointLog: [],
          });
        };
        const general = (
        <>
          <CollapsibleSection label="Tournament Database">
            <Field label="Link Tournament">
              <CustomBox>
                <select className="field-input" value={cfg.linkedTournamentId ?? ''} onChange={e => up({ linkedTournamentId: e.target.value })}>
                  <option value="">{pageTournament ? `— Auto: ${pageTournament.name} (this canvas) —` : '— none (set automatically from Load Match) —'}</option>
                  {tournaments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </CustomBox>
            </Field>
            <p className="app-settings-hint" style={{ margin: '4px 0 0' }}>
              Tags "Save" with this tournament so it shows up in its Results tab, and pre-fills Scoring Rules below from this tournament's own defaults when you pick a Sport — only pick one here to override this canvas's own bound tournament.
            </p>
          </CollapsibleSection>

          <CollapsibleSection label="Teams">
            <p className="app-settings-hint" style={{ margin: '0 0 6px' }}>
              Use the team picker on the scoreboard itself to pull from the Team DB (a doubles pair, a sepaktakraw regu, a whole club/country squad, or a single player — any SavedTeam works), or edit directly here.
            </p>
              <Field label="Team A Name">
                <input className="field-input" value={cfg.teamAName ?? 'Team A'} onChange={e => up({ teamAName: e.target.value })} />
              </Field>
              <Field label="Team A Color">
                <input type="color" className="color-custom" value={cfg.teamAColor ?? '#e74c3c'} onChange={e => up({ teamAColor: e.target.value })} />
              </Field>
              <Field label="Team A Logo">
                <LogoUrlPicker value={cfg.teamALogo ?? ''} onChange={url => up({ teamALogo: url })} placeholder="Team A logo URL" />
              </Field>
              <Field label="Starters A">
                <input
                  className="field-input"
                  value={(cfg.startersA ?? []).map(normalizePlayerEntry).map((s: RacketPlayerEntry) => s.name).join(' / ')}
                  placeholder="e.g. Kevin Sanjaya / Marcus Gideon"
                  title="Names only — jersey number/position are per-slot fields on the scoreboard itself"
                  onChange={e => {
                    const existing = (cfg.startersA ?? []).map(normalizePlayerEntry);
                    up({ startersA: e.target.value.split('/').map((name: string) => name.trim()).map((name: string, i: number) => ({ ...existing[i], name })) });
                  }}
                />
              </Field>
              <Field label="Subs A">
                <input className="field-input" value={(cfg.subsA ?? []).join(', ')} placeholder="e.g. Fajar Alfian" onChange={e => up({ subsA: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) })} />
              </Field>
              <Field label="Team B Name">
                <input className="field-input" value={cfg.teamBName ?? 'Team B'} onChange={e => up({ teamBName: e.target.value })} />
              </Field>
              <Field label="Team B Color">
                <input type="color" className="color-custom" value={cfg.teamBColor ?? '#3498db'} onChange={e => up({ teamBColor: e.target.value })} />
              </Field>
              <Field label="Team B Logo">
                <LogoUrlPicker value={cfg.teamBLogo ?? ''} onChange={url => up({ teamBLogo: url })} placeholder="Team B logo URL" />
              </Field>
              <Field label="Starters B">
                <input
                  className="field-input"
                  value={(cfg.startersB ?? []).map(normalizePlayerEntry).map((s: RacketPlayerEntry) => s.name).join(' / ')}
                  placeholder="e.g. Mohammad Ahsan / Hendra Setiawan"
                  title="Names only — jersey number/position are per-slot fields on the scoreboard itself"
                  onChange={e => {
                    const existing = (cfg.startersB ?? []).map(normalizePlayerEntry);
                    up({ startersB: e.target.value.split('/').map((name: string) => name.trim()).map((name: string, i: number) => ({ ...existing[i], name })) });
                  }}
                />
              </Field>
              <Field label="Subs B">
                <input className="field-input" value={(cfg.subsB ?? []).join(', ')} placeholder="e.g. Muhammad Rian Ardianto" onChange={e => up({ subsB: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) })} />
              </Field>
              <Field label="Players per Team">
                <input className="field-input" type="number" min={1} max={6} value={cfg.playerCount ?? 1} onChange={e => up({ playerCount: Math.max(1, Math.min(6, Number(e.target.value) || 1)) })} />
              </Field>
              <p className="app-settings-hint" style={{ margin: '4px 0 0' }}>
                Starters are who's actually on court this match — often different from the Team name above (e.g. Team = "Indonesia", Starters = the doubles pair). Use the roster picker on the scoreboard itself to add from a linked team's own players (jersey number/position included), or type names freely here (separate with "/") — jersey number and position are per-slot fields on the scoreboard itself, not editable from this text field.
              </p>
          </CollapsibleSection>

          <CollapsibleSection label="Match Info">
            <Field label="Competition">
              <input className="field-input" value={cfg.competition ?? ''} placeholder="e.g. Open Championship" onChange={e => up({ competition: e.target.value })} />
            </Field>
            <Field label="Round / Subtitle">
              <input className="field-input" value={cfg.subtitle ?? ''} placeholder="e.g. Final" onChange={e => up({ subtitle: e.target.value })} />
            </Field>
            <Field label="Category">
              <input className="field-input" value={cfg.category ?? ''} placeholder="e.g. Men, Women, Mixed Doubles" onChange={e => up({ category: e.target.value })} />
            </Field>
            <Field label="Group">
              <input className="field-input" value={cfg.group ?? ''} placeholder="e.g. Group A" onChange={e => up({ group: e.target.value })} />
            </Field>
            <Field label="Tier">
              <input className="field-input" value={cfg.tier ?? ''} placeholder="e.g. Cup, Plate" onChange={e => up({ tier: e.target.value })} />
            </Field>
          </CollapsibleSection>

          <CollapsibleSection label="Scoring Rules">
            {/* Card grid + Details/Duration — same "Match Settings" design
               as Tournament Manager's own sport/format picker (see
               TournamentManager.tsx's SettingsBar), reused here since this
               widget's own Sport/Scoring Rules picker is the same kind of
               control, just scoped to the 4 racket/net sports this widget
               actually supports (SPORT_ICON itself covers every sport —
               imported from TournamentManager.tsx rather than redefined). */}
            <div className="tm-ms-sport-grid" style={{ marginBottom: 10 }}>
              {(['badminton', 'table_tennis', 'tennis', 'sepaktakraw'] as SportType[]).map(sp => {
                const Icon = SPORT_ICON[sp];
                const active = sport === sp;
                const spRs = SPORT_DEFAULTS[sp].racketScoring!;
                const headline = spRs.mode === 'tennis' ? `${spRs.tiebreakAtGames} games` : `${spRs.pointsToWin} pts`;
                return (
                  <button
                    key={sp}
                    type="button"
                    className={`tm-ms-sport-card${active ? ' tm-ms-sport-card--active' : ''}`}
                    onClick={() => applySport(sp)}
                  >
                    <Icon size={20} strokeWidth={1.75} />
                    <span className="tm-ms-sport-card-name">{sp === 'table_tennis' ? 'Table Tennis' : sp[0].toUpperCase() + sp.slice(1)}</span>
                    <span className="tm-ms-sport-card-sub">{headline}</span>
                  </button>
                );
              })}
            </div>

            <div className="tm-ms-details" style={{ marginBottom: 10 }}>
              <div className="tm-ms-details-label"><Info size={13} strokeWidth={2} /> Details</div>
              <div className="tm-ms-details-row">
                <Flag size={13} strokeWidth={2} />
                <span className="tm-ms-details-key">{isTennis ? 'Games per set' : 'Points per set'}:</span>
                <span className="tm-ms-details-val">{isTennis ? (cfg.tiebreakAtGames ?? 6) : (cfg.pointsToWin ?? 21)}</span>
              </div>
              {!isTennis && (
                <div className="tm-ms-details-row">
                  <Star size={13} strokeWidth={2} />
                  <span className="tm-ms-details-key">Tie-break:</span>
                  <span className="tm-ms-details-val">
                    {cfg.deuceTarget != null ? `First to ${cfg.deuceTarget}` : cfg.pointCap != null ? `Cap at ${cfg.pointCap}` : (cfg.winBy2 ?? true) ? 'Win by 2' : 'None'}
                  </span>
                </div>
              )}
              <div className="tm-ms-details-row">
                <ArrowLeftRight size={13} strokeWidth={2} />
                <span className="tm-ms-details-key">Serve:</span>
                <span className="tm-ms-details-val">{(cfg.serviceRule ?? 'rally-winner') === 'alternate' ? `Rotates every ${cfg.serviceAlternateEvery ?? 2}` : 'Winner serves next'}</span>
              </div>
            </div>

            <Field label="Match Duration">
              <div className="tm-ms-duration-grid">
                {([
                  { key: 1, label: '1 Set' },
                  { key: 2, label: 'Best of 3' },
                  { key: 3, label: 'Best of 5' },
                  { key: 999, label: 'Endless' },
                ] as const).map((opt, i) => {
                  const active = (cfg.gamesToWin ?? 2) === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      className={`tm-ms-duration-pill${active ? ' tm-ms-duration-pill--active' : ''}`}
                      onClick={() => up({ gamesToWin: opt.key })}
                    >
                      <span className="tm-ms-duration-badge">{opt.key === 999 ? <InfinityIcon size={11} strokeWidth={2.5} /> : i + 1}</span>
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <p className="app-settings-hint" style={{ margin: '4px 0 0' }}>
                "Endless" is modeled as an effectively-unreachable 999 {isTennis ? 'sets' : 'games'} to win — the match simply never gets confirmed as decided, so sets/games keep being played and recorded as long as you keep scoring.
              </p>
            </Field>

            <CollapsibleSection label="Advanced Match Rules" defaultOpen={false}>
            {sport === 'sepaktakraw' && (
              <>
                <Field label="Team Event (multiple regu)">
                  <ToggleCard checked={!!cfg.teamEventOn} onChange={v => up({ teamEventOn: v })} title="A squad fields several regu (Regu 1, Regu 2, Regu 3…) across a team tie — the tie is decided by how many individual regu-matches each squad wins, not by points" />
                </Field>
                {cfg.teamEventOn && (
                  <Field label="Regu Wins Needed">
                    <input
                      className="field-input" type="number" min={1}
                      value={cfg.regusToWin ?? 2}
                      title="e.g. 2 for a best-of-3 regu tie, 3 for a best-of-5"
                      onChange={e => up({ regusToWin: Math.max(1, Number(e.target.value) || 2) })}
                    />
                  </Field>
                )}
              </>
            )}
            {!isTennis ? (
              <>
                <Field label="Points to Win">
                  <input className="field-input" type="number" min={1} value={cfg.pointsToWin ?? 21} onChange={e => up({ pointsToWin: Math.max(1, Number(e.target.value) || 21) })} />
                </Field>
                <Field label="Deadlock Rule (sepaktakraw-style)">
                  <ToggleCard checked={cfg.deuceTarget != null} onChange={v => up(v
                      ? { deuceTarget: (cfg.pointsToWin ?? 21) + 2, winBy2: false, pointCap: undefined }
                      : { deuceTarget: undefined })} title="Race straight to Points to Win with no lead needed, but an exact deadlock at one point short raises the target to a fixed number instead (first to reach it wins outright)" />
                </Field>
                {cfg.deuceTarget != null ? (
                  <Field label="Deadlock Target (first to reach wins)">
                    <input className="field-input" type="number" min={(cfg.pointsToWin ?? 21) + 1} value={cfg.deuceTarget} onChange={e => up({ deuceTarget: Math.max(1, Number(e.target.value) || (cfg.pointsToWin ?? 21) + 2) })} />
                  </Field>
                ) : (
                  <>
                    <Field label="Win by 2">
                      <ToggleCard checked={cfg.winBy2 ?? true} onChange={v => up({ winBy2: v })} />
                    </Field>
                    <Field label="Point Cap">
                      <input className="field-input" type="number" min={1} placeholder="none" value={cfg.pointCap ?? ''} onChange={e => up({ pointCap: e.target.value === '' ? undefined : Math.max(1, Number(e.target.value) || 1) })} />
                    </Field>
                  </>
                )}
              </>
            ) : (
              <>
                <Field label="Tiebreak at (games each)">
                  <input className="field-input" type="number" min={1} value={cfg.tiebreakAtGames ?? 6} onChange={e => up({ tiebreakAtGames: Math.max(1, Number(e.target.value) || 6) })} />
                </Field>
                <Field label="No-Ad Scoring">
                  <ToggleCard checked={!!cfg.noAd} onChange={v => up({ noAd: v })} />
                </Field>
              </>
            )}
            <Field label={`Play All ${isTennis ? 'Sets' : 'Games'}`}>
              <ToggleCard checked={!!cfg.playAllGames} onChange={v => up({ playAllGames: v, totalGames: v ? (cfg.totalGames ?? (cfg.gamesToWin ?? 2) * 2 - 1) : cfg.totalGames })} title={`Play out every ${isTennis ? 'set' : 'game'} up to Total ${isTennis ? 'Sets' : 'Games'} below, even once the match is already decided — e.g. 3 games with 2 needed to win still plays the 3rd game after a 2-0 lead, instead of stopping there`} />
            </Field>
            {cfg.playAllGames && (
              <Field label={`Total ${isTennis ? 'Sets' : 'Games'} to Play`}>
                <input
                  className="field-input" type="number" min={cfg.gamesToWin ?? 2}
                  value={cfg.totalGames ?? (cfg.gamesToWin ?? 2) * 2 - 1}
                  onChange={e => up({ totalGames: Math.max(cfg.gamesToWin ?? 2, Number(e.target.value) || (cfg.gamesToWin ?? 2) * 2 - 1) })}
                />
              </Field>
            )}
            <p className="app-settings-hint" style={{ margin: '4px 0 0' }}>
              Every number here is freely customizable regardless of Sport above — picking a Sport just pre-fills its own usual numbers as a starting point.
            </p>
            </CollapsibleSection>
          </CollapsibleSection>

          <CollapsibleSection label="Serving">
            <Field label="Mode">
              <CardSelect
                value={cfg.serviceMode ?? 'auto'}
                onChange={v => up({ serviceMode: v })}
                options={[{ value: 'auto', label: 'Auto' }, { value: 'manual', label: 'Manual' }]}
              />
            </Field>
            {(cfg.serviceMode ?? 'auto') === 'manual' ? (
              <p className="app-settings-hint" style={{ margin: '4px 0 0' }}>
                Nothing updates who's serving automatically — click the server dot next to either side, right on the scoreboard itself, to set it.
              </p>
            ) : !isTennis ? (
              <>
                <Field label="Rule">
                  <CardSelect
                    value={cfg.serviceRule ?? 'rally-winner'}
                    onChange={v => up({ serviceRule: v })}
                    options={[{ value: 'rally-winner', label: 'Winner serves' }, { value: 'alternate', label: 'Rotate after N points' }]}
                  />
                </Field>
                {(cfg.serviceRule ?? 'rally-winner') === 'alternate' && (
                  <Field label="Attempts per turn">
                    <CardSelect
                      value={cfg.serviceAlternateEvery ?? 2}
                      onChange={v => up({ serviceAlternateEvery: v })}
                      options={[{ value: 1, label: 'One (every serve)' }, { value: 2, label: 'Two (table tennis rule)' }]}
                    />
                  </Field>
                )}
                <p className="app-settings-hint" style={{ margin: '4px 0 0' }}>
                  "Winner serves" is the real badminton/sepaktakraw rule — the server keeps serving until they lose a rally or fault. "Rotate after N points" is table tennis's actual rule — narrows to every 1 point automatically once both sides reach deuce, whatever's picked here.
                </p>
              </>
            ) : (
              <p className="app-settings-hint" style={{ margin: '4px 0 0' }}>
                Tennis's own serve order (strict alternation by game/tiebreak point) always applies in Auto — this toggle is only for switching to Manual if you ever need to correct it by hand.
              </p>
            )}
          </CollapsibleSection>

          <CollapsibleSection label="Appearance" defaultOpen={false}>
            <Field label="Layout">
              <CardSelect
                value={cfg.layoutStyle ?? 'vertical'}
                onChange={v => up({ layoutStyle: v })}
                options={[
                  { value: 'vertical', label: 'Vertical', sub: 'Team cards', icon: RectangleVertical },
                  { value: 'horizontal', label: 'Horizontal', sub: 'Scorebug', icon: RectangleHorizontal },
                  { value: 'lowerthird', label: 'Lower Third', sub: 'Slim bar', icon: PanelBottom },
                  { value: 'liveCard', label: 'Live Card', sub: 'Mobile style', icon: Smartphone },
                ]}
              />
            </Field>
            <CustomBox label="Score Button Size">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="range" min={0.5} max={2} step={0.05} className="field-range"
                  value={cfg.scoreButtonScale ?? 1} onChange={e => up({ scoreButtonScale: Number(e.target.value) })} />
                <span style={{ minWidth: 36, textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)' }}>{Math.round((cfg.scoreButtonScale ?? 1) * 100)}%</span>
              </div>
            </CustomBox>
            <CustomBox label="Start Button Size">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="range" min={0.5} max={2.5} step={0.05} className="field-range"
                  value={cfg.startButtonScale ?? 1} onChange={e => up({ startButtonScale: Number(e.target.value) })} />
                <span style={{ minWidth: 36, textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)' }}>{Math.round((cfg.startButtonScale ?? 1) * 100)}%</span>
              </div>
              <p className="app-settings-hint" style={{ margin: '4px 0 0' }}>
                It already pulses to stay noticeable — this makes it bigger too.
              </p>
            </CustomBox>
            <Field label="Start Button Style">
              <CardSelect
                value={cfg.startButtonStyle ?? 'solid'}
                onChange={v => up({ startButtonStyle: v })}
                options={[{ value: 'solid', label: 'Solid' }, { value: 'outline', label: 'Outline' }, { value: 'ghost', label: 'Ghost' }]}
              />
            </Field>
            <CustomBox label="Start Button Color">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="color" className="color-custom" value={cfg.startButtonColor || '#3b82f6'} onChange={e => up({ startButtonColor: e.target.value })} />
                {cfg.startButtonColor && (
                  <button className="field-input" style={{ padding: '2px 8px', cursor: 'pointer' }} onClick={() => up({ startButtonColor: undefined })}>
                    Reset to theme
                  </button>
                )}
              </div>
              <p className="app-settings-hint" style={{ margin: '4px 0 0' }}>
                Also colors the pulse ring.
              </p>
            </CustomBox>
            {(cfg.layoutStyle ?? 'vertical') !== 'vertical' && (
              <Field label="Score Button Position">
                <CardSelect
                  value={cfg.scoreButtonPosition ?? 'sides'}
                  onChange={v => up({ scoreButtonPosition: v })}
                  options={[{ value: 'sides', label: 'Sides' }, { value: 'grouped', label: 'Grouped' }]}
                />
                <p className="app-settings-hint" style={{ margin: '4px 0 0' }}>
                  Sides — each side's own +1/-1 sits right on its own row/name. Grouped — both sides' +1/-1 sit together in one shared strip instead.
                </p>
              </Field>
            )}
            <Field label="Score size (px)">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="range" min={16} max={100} step={2} className="field-range"
                  value={cfg.scoreFontSize ?? 36} onChange={e => up({ scoreFontSize: Number(e.target.value) })} />
                <span style={{ minWidth: 32, textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)' }}>{cfg.scoreFontSize ?? 36}px</span>
              </div>
            </Field>
            <Field label="Name size (px)">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="range" min={8} max={48} step={1} className="field-range"
                  value={cfg.nameFontSize ?? 16} onChange={e => up({ nameFontSize: Number(e.target.value) })} />
                <span style={{ minWidth: 32, textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)' }}>{cfg.nameFontSize ?? 16}px</span>
              </div>
            </Field>
            <Field label="Logo size (px)">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="range" min={24} max={100} step={2} className="field-range"
                  value={cfg.logoSize ?? 54} onChange={e => up({ logoSize: Number(e.target.value) })} />
                <span style={{ minWidth: 32, textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)' }}>{cfg.logoSize ?? 54}px</span>
              </div>
              <p className="app-settings-hint" style={{ margin: '4px 0 0' }}>
                Applies across all three layouts — Horizontal/Lower Third's own flag shape scales proportionally to this same value.
              </p>
            </Field>
            <Field label="Require Start to Score">
              <ToggleCard checked={!!cfg.requireStartToScore} onChange={v => up({ requireStartToScore: v })} title="While on, +1/-1 and changing serve are all locked out until the operator presses Start Game for the current game — re-applies fresh every game. Entirely optional, off by default." />
            </Field>
            {/* Show/hide — every one of these stays fully available (the
               underlying data is never deleted, just not painted) and
               defaults to ON, so an existing widget saved before these
               fields existed looks exactly as it always has. Applies across
               every layoutStyle alike — see RacketScoreboardWidget.tsx's own
               return statement, where each of these is rendered once,
               shared by all four layouts, not per-layout. */}
            <Field label="Show Game Timer">
              <ToggleCard checked={cfg.showTimer ?? true} onChange={v => up({ showTimer: v })} />
            </Field>
            <Field label="Show Game/Set/Match Point Badge">
              <ToggleCard checked={cfg.showMatchPointBadge ?? true} onChange={v => up({ showMatchPointBadge: v })} />
            </Field>
            <Field label="Show Completed Sets">
              <ToggleCard checked={cfg.showCompletedGames ?? true} onChange={v => up({ showCompletedGames: v })} />
            </Field>
            <Field label="Show Players Section">
              <ToggleCard checked={cfg.showPlayers ?? true} onChange={v => up({ showPlayers: v })} />
            </Field>
            <Field label="Show Match Report / Set History">
              <ToggleCard checked={cfg.showMatchReport ?? true} onChange={v => up({ showMatchReport: v })} />
            </Field>
          </CollapsibleSection>
        </>
        );

        const vmix = (
          <CollapsibleSection label="vMix Output" defaultOpen={false}>
            <Field label="Input">
              <input className="field-input" value={cfg.vmixInputKey ?? ''} placeholder="Input name/number" onChange={e => up({ vmixInputKey: e.target.value })} />
            </Field>
            <Field label="Score A Field">
              <input className="field-input" value={cfg.fieldScoreA ?? ''} placeholder="ScoreA.Text" onChange={e => up({ fieldScoreA: e.target.value })} />
            </Field>
            <Field label="Score B Field">
              <input className="field-input" value={cfg.fieldScoreB ?? ''} placeholder="ScoreB.Text" onChange={e => up({ fieldScoreB: e.target.value })} />
            </Field>
            <Field label="Team A Field">
              <input className="field-input" value={cfg.fieldTeamA ?? ''} placeholder="TeamA.Text" onChange={e => up({ fieldTeamA: e.target.value })} />
            </Field>
            <Field label="Team B Field">
              <input className="field-input" value={cfg.fieldTeamB ?? ''} placeholder="TeamB.Text" onChange={e => up({ fieldTeamB: e.target.value })} />
            </Field>
          </CollapsibleSection>
        );

        return renderTabbed(general, vmix);
      }

      case 'scoreboard': {
        const allScoreboardWidgets = pages.flatMap(p => p.widgets).filter(w => w.type === 'scoreboard' && w.id !== widget.id);
        const general = (
        <>
          <CollapsibleSection label="Link to Scoreboard">
            <Field label="Source Scoreboard">
              <CustomBox>
                <select className="field-input" value={cfg.linkedScoreboardSourceId ?? ''} onChange={e => up({ linkedScoreboardSourceId: e.target.value })}>
                  <option value="">— standalone (own scoreboard) —</option>
                  {allScoreboardWidgets.map(w => (
                    <option key={w.id} value={w.id}>{w.label || w.config?.teamAName + ' vs ' + w.config?.teamBName || w.id}</option>
                  ))}
                </select>
              </CustomBox>
            </Field>
            {cfg.linkedScoreboardSourceId && (
              <p className="timer-db-hint">This widget mirrors the selected scoreboard. Controls are hidden — score from the source widget.</p>
            )}
          </CollapsibleSection>

          <CollapsibleSection label="Hotkeys">
            <p className="app-settings-hint" style={{ margin: '0 0 6px' }}>
              Bind a physical key to any action here (score, timer, reset…) — pick "{cfg.teamAName ?? 'Team A'} vs {cfg.teamBName ?? 'Team B'}" as the target Scoreboard Widget to affect this widget. Hotkeys fire even while the app is minimized or unfocused.
            </p>
            {(() => {
              const hotkeyActions: { id: string; label?: string; hotkey: string; actions: ActionItem[] }[] = cfg.hotkeyActions ?? [];
              const updateHk = (i: number, patch: Partial<{ label: string; hotkey: string; actions: ActionItem[] }>) =>
                up({ hotkeyActions: hotkeyActions.map((h, j) => j === i ? { ...h, ...patch } : h) });
              return (
                <>
                  {hotkeyActions.map((h, i) => (
                    <div key={h.id} className="vil-cfg-block">
                      <div className="vil-cfg-header">
                        <span className="vil-cfg-label">{h.label || `Hotkey ${i + 1}`}</span>
                        <button className="btn btn--ghost btn--small"
                          onClick={() => up({ hotkeyActions: hotkeyActions.filter((_, j) => j !== i) })}>×</button>
                      </div>
                      <Field label="Label">
                        <input className="field-input" value={h.label ?? ''} placeholder="e.g. Team A +1" onChange={e => updateHk(i, { label: e.target.value })} />
                      </Field>
                      <Field label="Hotkey">
                        <HotkeyRecorder value={h.hotkey} onChange={v => updateHk(i, { hotkey: v })} allBindings={allHotkeyBindings} />
                      </Field>
                      <CollapsibleSection label="Actions">
                        <ActionListEditor actions={h.actions} onChange={(next) => updateHk(i, { actions: next })} sectionKey={`hk-${i}`}
                          pages={pages} timerWidgets={pages.flatMap(p => p.widgets.filter(w => w.type === 'timer'))}
                          scoreboardWidgets={pages.flatMap(p => p.widgets.filter(w => w.type === 'scoreboard'))}
                          globalVariables={globalVariables} allInputs={allInputs}
                          cgTemplateWidgets={[...pages, ...store.libraryPages].flatMap(p => p.widgets.filter(w => w.type === 'cg-template'))} />
                      </CollapsibleSection>
                    </div>
                  ))}
                  <button className="action-add-btn"
                    onClick={() => up({ hotkeyActions: [...hotkeyActions, { id: crypto.randomUUID(), label: '', hotkey: '', actions: [] }] })}>
                    + Add Hotkey
                  </button>
                </>
              );
            })()}
          </CollapsibleSection>

          <CollapsibleSection label="Tournament Database">
            <Field label="Link Tournament">
              <CustomBox>
                <select className="field-input" value={cfg.linkedTournamentId ?? ''} onChange={e => up({ linkedTournamentId: e.target.value })}>
                  <option value="">{pageTournament ? `— Auto: ${pageTournament.name} (this canvas) —` : '— none (set automatically from Load Match) —'}</option>
                  {tournaments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </CustomBox>
            </Field>
            <p className="app-settings-hint" style={{ margin: '4px 0 0' }}>
              Tags "Save Result" with this tournament so it shows up in its Results tab. Loading a fixture from the Schedule tab sets this automatically, and it otherwise falls back to this canvas's bound tournament (see the Canvas picker in the status bar) — only pick one here to override that.
            </p>
          </CollapsibleSection>

          <CollapsibleSection label="Teams">
            <p className="app-settings-hint" style={{ margin: '0 0 6px' }}>
              Use the team picker on the scoreboard itself to pull from the Team DB, or edit directly here.
            </p>
              <Field label="Team A Name">
                <input className="field-input" value={cfg.teamAName ?? 'Team A'} onChange={e => up({ teamAName: e.target.value })} />
              </Field>
              <Field label="Team A Color">
                <input type="color" className="color-custom" value={cfg.teamAColor ?? '#e74c3c'} onChange={e => up({ teamAColor: e.target.value })} />
              </Field>
              <Field label="Team A Logo">
                <LogoUrlPicker value={cfg.teamALogo ?? ''} onChange={url => up({ teamALogo: url })} placeholder="Team A logo URL" />
              </Field>
              <Field label="Team B Name">
                <input className="field-input" value={cfg.teamBName ?? 'Team B'} onChange={e => up({ teamBName: e.target.value })} />
              </Field>
              <Field label="Team B Color">
                <input type="color" className="color-custom" value={cfg.teamBColor ?? '#3498db'} onChange={e => up({ teamBColor: e.target.value })} />
              </Field>
              <Field label="Team B Logo">
                <LogoUrlPicker value={cfg.teamBLogo ?? ''} onChange={url => up({ teamBLogo: url })} placeholder="Team B logo URL" />
              </Field>
          </CollapsibleSection>

          <CollapsibleSection label="Match Info">
            <Field label="Competition">
              <input className="field-input" value={cfg.competition ?? ''} placeholder="e.g. Premier League" onChange={e => up({ competition: e.target.value })} />
            </Field>
            <Field label="Category">
              <input className="field-input" value={cfg.category ?? ''} placeholder="e.g. Men, Women, U21" onChange={e => up({ category: e.target.value })} />
            </Field>
            <Field label="Group">
              <input className="field-input" value={cfg.group ?? ''} placeholder="e.g. Group A" onChange={e => up({ group: e.target.value })} />
            </Field>
            <Field label="Scheduled Time">
              <input type="time" className="field-input" value={cfg.scheduledTime ?? ''} onChange={e => up({ scheduledTime: e.target.value })} />
            </Field>
          </CollapsibleSection>

          <CollapsibleSection label="Head to Head">
            <Field label="Show Head to Head">
              <ToggleCard checked={cfg.showHeadToHead ?? false} onChange={v => up({ showHeadToHead: v })} />
            </Field>
            {cfg.showHeadToHead && (
              <>
                <Field label="Show Record">
                  <ToggleCard checked={cfg.h2hShowRecord ?? true} onChange={v => up({ h2hShowRecord: v })} />
                </Field>
                <Field label="Show Last Meetings">
                  <ToggleCard checked={cfg.h2hShowLastMeetings ?? true} onChange={v => up({ h2hShowLastMeetings: v })} />
                </Field>
                {cfg.h2hShowLastMeetings !== false && (
                  <Field label="Max meetings shown">
                    <input type="number" className="field-input" min={1} max={20} value={cfg.h2hMaxMeetings ?? 5}
                      onChange={e => up({ h2hMaxMeetings: Math.max(1, parseInt(e.target.value) || 5) })} />
                  </Field>
                )}
                <Field label="Show Score Breakdown">
                  <ToggleCard checked={cfg.h2hShowBreakdown ?? true} onChange={v => up({ h2hShowBreakdown: v })} />
                </Field>
                <Field label="Show Team Stats (this tournament)">
                  <ToggleCard checked={cfg.h2hShowTeamStats ?? true} onChange={v => up({ h2hShowTeamStats: v })} />
                </Field>
                <Field label="Show Previous & Upcoming">
                  <ToggleCard checked={cfg.h2hShowForm ?? true} onChange={v => up({ h2hShowForm: v })} />
                </Field>
              </>
            )}
          </CollapsibleSection>

          <CollapsibleSection label="Penalty Shootout / Place-Kick Competition">
            <Field label="Enable Shootout">
              <ToggleCard checked={cfg.enableShootout ?? false} onChange={v => up({ enableShootout: v })} />
            </Field>
            {cfg.enableShootout && (
              <Field label="Kicks per round">
                <input type="number" className="field-input" min={1} max={20} value={cfg.shootoutKicksPerRound ?? 5}
                  onChange={e => up({ shootoutKicksPerRound: Math.max(1, parseInt(e.target.value) || 5) })} />
              </Field>
            )}
          </CollapsibleSection>

          <CollapsibleSection label="Sport Style">
          <Field label="Style">
            <CustomBox>
              <select className="field-input" value={cfg.style ?? 'basic'} onChange={e => {
                const found = SCORE_STYLES.find(s => s.value === e.target.value);
                up({ style: e.target.value, increments: found?.increments ?? [1] });
              }}>
                {SCORE_STYLES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </CustomBox>
          </Field>
          {/* ── Increment editor ── */}
          {(() => {
            type Inc = { label: string; value: number; actions?: ActionItem[]; manualTrigger?: boolean; manualTriggerConfirm?: boolean };
            const incs: Inc[] = (cfg.increments ?? [1]).map((i: any) =>
              typeof i === 'number'
                ? { label: '', value: i }
                : { label: i.label ?? '', value: i.value, actions: i.actions, manualTrigger: i.manualTrigger, manualTriggerConfirm: i.manualTriggerConfirm }
            );
            const setIncs = (next: Inc[]) => up({ increments: next });
            const updateInc = (idx: number, patch: Partial<Inc>) =>
              setIncs(incs.map((inc, i) => i === idx ? { ...inc, ...patch } : inc));
            const incTimerWidgets = pages.flatMap(p => p.widgets.filter(w => w.type === 'timer'));
            const incScoreboardWidgets = pages.flatMap(p => p.widgets.filter(w => w.type === 'scoreboard'));
            const incCgTemplateWidgets = [...pages, ...store.libraryPages].flatMap(p => p.widgets.filter(w => w.type === 'cg-template'));
            return (
              <div className="sb-incs">
                <div className="sb-incs-hdr">
                  <span className="sb-incs-col-lbl">Label</span>
                  <span className="sb-incs-col-val">Pts</span>
                </div>
                {incs.map((inc, idx) => {
                  const trigKey = `inc-trigger-${widget.id}-${idx}`;
                  const trigOpen = vilCollapsed[trigKey] ?? false;
                  const hasActions = (inc.actions?.length ?? 0) > 0;
                  return (
                    <div key={idx} className="sb-inc-block">
                      <div className="sb-inc-row">
                        <input
                          className="field-input sb-inc-label"
                          value={inc.label}
                          placeholder={`+${inc.value}`}
                          onChange={e => updateInc(idx, { label: e.target.value })}
                        />
                        <input
                          className="field-input sb-inc-value"
                          type="number"
                          value={inc.value}
                          onChange={e => updateInc(idx, { value: Number(e.target.value) })}
                        />
                        <button
                          className={`btn btn--ghost btn--small sb-inc-trigger-btn${hasActions ? ' sb-inc-trigger-btn--active' : ''}`}
                          title="Trigger actions when scored (optional, same as a Button widget)"
                          onClick={() => setVilCollapsed(p => ({ ...p, [trigKey]: !trigOpen }))}
                        ><Zap size={12} strokeWidth={2} /></button>
                        <button className="btn btn--ghost btn--small sb-inc-del" onClick={() => setIncs(incs.filter((_, i) => i !== idx))}>×</button>
                      </div>
                      {trigOpen && (
                        <div className="sb-inc-trigger-panel">
                          <p className="timer-db-hint" style={{ margin: '0 0 4px' }}>
                            Runs whenever "{inc.label || `+${inc.value}`}" is actually scored (after any player picker resolves) — optional, leave empty for no change in behavior.
                          </p>
                          <ActionListEditor
                            actions={inc.actions ?? []}
                            onChange={next => updateInc(idx, { actions: next })}
                            sectionKey={trigKey}
                            pages={pages}
                            timerWidgets={incTimerWidgets}
                            scoreboardWidgets={incScoreboardWidgets}
                            globalVariables={globalVariables}
                            allInputs={allInputs}
                            cgTemplateWidgets={incCgTemplateWidgets}
                          />
                          <Field label="Manual trigger button">
                            <ToggleCard checked={inc.manualTrigger ?? false} onChange={v => updateInc(idx, { manualTrigger: v })} />
                          </Field>
                          {inc.manualTrigger && (
                            <Field label="Confirm before firing">
                              <ToggleCard checked={inc.manualTriggerConfirm ?? true} onChange={v => updateInc(idx, { manualTriggerConfirm: v })} />
                            </Field>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                <button className="btn btn--ghost btn--small" style={{ marginTop: 2 }} onClick={() => setIncs([...incs, { label: '', value: 1 }])}>+ Add</button>
              </div>
            );
          })()}
          <Field label="Score size (px)">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="range" min={24} max={120} step={2} className="field-range"
                value={cfg.scoreFontSize ?? 36} onChange={e => up({ scoreFontSize: Number(e.target.value) })} />
              <span style={{ minWidth: 32, textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)' }}>{cfg.scoreFontSize ?? 36}px</span>
            </div>
          </Field>
          <Field label="Full name size (px)">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="range" min={8} max={48} step={1} className="field-range"
                value={cfg.nameFontSize ?? 16} onChange={e => up({ nameFontSize: Number(e.target.value) })} />
              <span style={{ minWidth: 32, textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)' }}>{cfg.nameFontSize ?? 16}px</span>
            </div>
          </Field>
          <Field label="Short name size (px)">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="range" min={8} max={48} step={1} className="field-range"
                value={cfg.shortNameFontSize ?? 14} onChange={e => up({ shortNameFontSize: Number(e.target.value) })} />
              <span style={{ minWidth: 32, textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)' }}>{cfg.shortNameFontSize ?? 14}px</span>
            </div>
          </Field>
          <Field label="Button size">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="range" min={0.5} max={2.5} step={0.05} className="field-range"
                value={cfg.buttonSize ?? 1} onChange={e => up({ buttonSize: Number(e.target.value) })} />
              <span style={{ minWidth: 36, textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)' }}>{Math.round((cfg.buttonSize ?? 1) * 100)}%</span>
            </div>
          </Field>
          </CollapsibleSection>
        </>
        );

        const vmix = (
          <>
          {/* ── Multiple vMix Title Inputs ── */}
          {(() => {
            type SbInput = {
              id: string; inputKey: string; inputTitle?: string; fieldScoreA: string; fieldScoreB: string; fieldTeamA: string; fieldTeamB: string; fieldShortA: string; fieldShortB: string; fieldTextA: string; fieldTextB: string; fieldLogoA: string; fieldLogoB: string; fieldCompetition: string; fieldCategory: string; fieldGroup: string; fieldRound: string; fieldScheduledTime: string; fieldMatchId?: string;
              mergedAPrefix?: string; mergedAParts?: string[]; mergedASeparator?: string;
              mergedBPrefix?: string; mergedBParts?: string[]; mergedBSeparator?: string;
              mergedInfoPrefix?: string; mergedInfoParts?: string[]; mergedInfoSeparator?: string;
            };
            // Migrate legacy single-input config on first open
            const sbInputs: SbInput[] = cfg.vmixInputs?.length
              ? cfg.vmixInputs
              : cfg.vmixInputKey
                ? [{ id: 'legacy', inputKey: cfg.vmixInputKey, inputTitle: cfg.vmixInputTitle, fieldScoreA: cfg.fieldScoreA ?? 'ScoreA.Text', fieldScoreB: cfg.fieldScoreB ?? 'ScoreB.Text', fieldTeamA: cfg.fieldTeamA ?? 'TeamA.Text', fieldTeamB: cfg.fieldTeamB ?? 'TeamB.Text', fieldShortA: cfg.fieldShortA ?? '', fieldShortB: cfg.fieldShortB ?? '', fieldTextA: cfg.fieldTextA ?? '', fieldTextB: cfg.fieldTextB ?? '', fieldLogoA: cfg.fieldLogoA ?? '', fieldLogoB: cfg.fieldLogoB ?? '', fieldCompetition: cfg.fieldCompetition ?? '', fieldCategory: cfg.fieldCategory ?? '', fieldGroup: cfg.fieldGroup ?? '', fieldRound: cfg.fieldRound ?? '', fieldScheduledTime: cfg.fieldScheduledTime ?? '' }]
                : [];
            const setSbInputs = (next: SbInput[]) => up({ vmixInputs: next });
            const updateSb = (idx: number, patch: Partial<SbInput>) =>
              setSbInputs(sbInputs.map((s, i) => i === idx ? { ...s, ...patch } : s));
            const addSbInput = () => setSbInputs([...sbInputs, { id: crypto.randomUUID(), inputKey: '', fieldScoreA: 'ScoreA.Text', fieldScoreB: 'ScoreB.Text', fieldTeamA: 'TeamA.Text', fieldTeamB: 'TeamB.Text', fieldShortA: '', fieldShortB: '', fieldTextA: '', fieldTextB: '', fieldLogoA: '', fieldLogoB: '', fieldCompetition: '', fieldCategory: '', fieldGroup: '', fieldRound: '', fieldScheduledTime: '' }]);

            // One independent list per field group — each target picks its
            // own vMix input via the normal picker (not a checkbox) and its
            // own field name(s), since different templates never share
            // field naming. Kept as separate lists per group (rather than
            // one combined list with every field) so, e.g., a pure logo bug
            // and a pure scorebug don't clutter each other's setup.
            const renderExtraTargetGroup = (configKey: string, label: string, description: string, renderFields: (t: any, update: (patch: any) => void) => React.ReactNode) => {
              const targets: any[] = cfg[configKey] ?? [];
              const setTargets = (next: any[]) => up({ [configKey]: next });
              const updateTarget = (idx: number, patch: any) => setTargets(targets.map((t: any, i: number) => i === idx ? { ...t, ...patch } : t));
              const addTarget = () => setTargets([...targets, { id: crypto.randomUUID(), inputKey: '' }]);
              return (
                <CollapsibleSection label={label}>
                  <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '0 0 6px', lineHeight: 1.4 }}>{description}</p>
                  {targets.map((t: any, idx: number) => {
                    const targetKey = `${configKey}_${t.id}`;
                    const isCollapsed = vilCollapsed[targetKey] ?? false;
                    return (
                      <div key={t.id} className="vil-cfg-block">
                        <div className="vil-cfg-header">
                          <button className="btn btn--ghost btn--small tf-collapse-btn"
                            onClick={() => setVilCollapsed(p => ({ ...p, [targetKey]: !p[targetKey] }))}
                            title={isCollapsed ? 'Expand' : 'Collapse'}>
                            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                          </button>
                          <span className="vil-cfg-label">{t.inputTitle || t.inputKey || `Target ${idx + 1}`}</span>
                          <button className="btn btn--ghost btn--small" onClick={() => setTargets(targets.filter((_: any, i: number) => i !== idx))}>×</button>
                        </div>
                        {!isCollapsed && (
                          <>
                            {renderInputPicker('vMix Input', t.inputKey, t.inputTitle,
                              (key, title) => updateTarget(idx, { inputKey: key, inputTitle: title }),
                              undefined, allInputs,
                            )}
                            {t.inputKey && renderFields(t, (patch: any) => updateTarget(idx, patch))}
                          </>
                        )}
                      </div>
                    );
                  })}
                  <button className="btn btn--ghost btn--small" onClick={addTarget}>+ Add Input</button>
                </CollapsibleSection>
              );
            };
            return (
              <>
                {renderExtraTargetGroup('extraLogoTargets', 'Extra Logo Targets',
                  'Push the team logos to other vMix inputs (a scorebug, corner bug, etc.).',
                  (t, update) => (
                    <>
                      <Field label="Logo A Field">{renderFieldPicker(t.inputKey, t.fieldLogoA ?? '', v => update({ fieldLogoA: v }), 'LogoA.Source', n => n.toLowerCase().endsWith('.source'), allInputs)}</Field>
                      <Field label="Logo B Field">{renderFieldPicker(t.inputKey, t.fieldLogoB ?? '', v => update({ fieldLogoB: v }), 'LogoB.Source', n => n.toLowerCase().endsWith('.source'), allInputs)}</Field>
                    </>
                  ))}
                {renderExtraTargetGroup('extraScoreTargets', 'Extra Score Targets',
                  'Push the live score to other vMix inputs.',
                  (t, update) => (
                    <>
                      <Field label="Score A Field">{renderFieldPicker(t.inputKey, t.fieldScoreA ?? '', v => update({ fieldScoreA: v }), 'Title.Text', undefined, allInputs)}</Field>
                      <Field label="Score B Field">{renderFieldPicker(t.inputKey, t.fieldScoreB ?? '', v => update({ fieldScoreB: v }), 'Title.Text', undefined, allInputs)}</Field>
                    </>
                  ))}
                {renderExtraTargetGroup('extraTeamTargets', 'Extra Team Name Targets',
                  'Push team/short names to other vMix inputs.',
                  (t, update) => (
                    <>
                      <Field label="Team A Field">{renderFieldPicker(t.inputKey, t.fieldTeamA ?? '', v => update({ fieldTeamA: v }), 'Title.Text', undefined, allInputs)}</Field>
                      <Field label="Team B Field">{renderFieldPicker(t.inputKey, t.fieldTeamB ?? '', v => update({ fieldTeamB: v }), 'Title.Text', undefined, allInputs)}</Field>
                      <Field label="Short Name A Field">{renderFieldPicker(t.inputKey, t.fieldShortA ?? '', v => update({ fieldShortA: v }), 'Title.Text', undefined, allInputs)}</Field>
                      <Field label="Short Name B Field">{renderFieldPicker(t.inputKey, t.fieldShortB ?? '', v => update({ fieldShortB: v }), 'Title.Text', undefined, allInputs)}</Field>
                    </>
                  ))}
                {renderExtraTargetGroup('extraTextTargets', 'Extra Text Targets',
                  'Push the custom Text A/B fields to other vMix inputs.',
                  (t, update) => (
                    <>
                      <Field label="Text A Field">{renderFieldPicker(t.inputKey, t.fieldTextA ?? '', v => update({ fieldTextA: v }), 'Title.Text', undefined, allInputs)}</Field>
                      <Field label="Text B Field">{renderFieldPicker(t.inputKey, t.fieldTextB ?? '', v => update({ fieldTextB: v }), 'Title.Text', undefined, allInputs)}</Field>
                    </>
                  ))}
                {renderExtraTargetGroup('extraMatchDetailsTargets', 'Extra Match Details Targets',
                  'Push competition/category/group/round/scheduled time/match ID to other vMix inputs.',
                  (t, update) => (
                    <>
                      <Field label="Competition Field">{renderFieldPicker(t.inputKey, t.fieldCompetition ?? '', v => update({ fieldCompetition: v }), 'Title.Text', undefined, allInputs)}</Field>
                      <Field label="Category Field">{renderFieldPicker(t.inputKey, t.fieldCategory ?? '', v => update({ fieldCategory: v }), 'Title.Text', undefined, allInputs)}</Field>
                      <Field label="Group Field">{renderFieldPicker(t.inputKey, t.fieldGroup ?? '', v => update({ fieldGroup: v }), 'Title.Text', undefined, allInputs)}</Field>
                      <Field label="Round Field">{renderFieldPicker(t.inputKey, t.fieldRound ?? '', v => update({ fieldRound: v }), 'Title.Text', undefined, allInputs)}</Field>
                      <Field label="Scheduled Time Field">{renderFieldPicker(t.inputKey, t.fieldScheduledTime ?? '', v => update({ fieldScheduledTime: v }), 'Title.Text', undefined, allInputs)}</Field>
                      <Field label="Match ID Field">{renderFieldPicker(t.inputKey, t.fieldMatchId ?? '', v => update({ fieldMatchId: v }), 'Title.Text', undefined, allInputs)}</Field>
                    </>
                  ))}
                {sbInputs.map((inp, idx) => {
                  const isVilCollapsed = vilCollapsed[inp.id] ?? false;
                  return (
                    <div key={inp.id} className="vil-cfg-block">
                      <div className="vil-cfg-header">
                        <button className="btn btn--ghost btn--small tf-collapse-btn"
                          onClick={() => setVilCollapsed(p => ({ ...p, [inp.id]: !p[inp.id] }))}
                          title={isVilCollapsed ? 'Expand' : 'Collapse'}>
                          {isVilCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                        </button>
                        <span className="vil-cfg-label">vMix Title Input {idx + 1}</span>
                        {sbInputs.length > 1 && (
                          <button className="btn btn--ghost btn--small"
                            onClick={() => setSbInputs(sbInputs.filter((_, i) => i !== idx))}>×</button>
                        )}
                      </div>
                      {!isVilCollapsed && (<>
                        {renderInputPicker('vMix Title Input', inp.inputKey, inp.inputTitle,
                          (key, title) => updateSb(idx, { inputKey: key, inputTitle: title }),
                          undefined, allInputs,
                        )}
                        {inp.inputKey && (
                          <>
                            <Field label="Score A Field">{renderFieldPicker(inp.inputKey, inp.fieldScoreA, v => updateSb(idx, { fieldScoreA: v }), 'Title.Text', undefined, allInputs)}</Field>
                            <Field label="Score B Field">{renderFieldPicker(inp.inputKey, inp.fieldScoreB, v => updateSb(idx, { fieldScoreB: v }), 'Title.Text', undefined, allInputs)}</Field>
                            <Field label="Team A Field">{renderFieldPicker(inp.inputKey, inp.fieldTeamA, v => updateSb(idx, { fieldTeamA: v }), 'Title.Text', undefined, allInputs)}</Field>
                            <Field label="Team B Field">{renderFieldPicker(inp.inputKey, inp.fieldTeamB, v => updateSb(idx, { fieldTeamB: v }), 'Title.Text', undefined, allInputs)}</Field>
                            <Field label="Short Name A Field">{renderFieldPicker(inp.inputKey, inp.fieldShortA ?? '', v => updateSb(idx, { fieldShortA: v }), 'Title.Text', undefined, allInputs)}</Field>
                            <Field label="Short Name B Field">{renderFieldPicker(inp.inputKey, inp.fieldShortB ?? '', v => updateSb(idx, { fieldShortB: v }), 'Title.Text', undefined, allInputs)}</Field>
                            <Field label="Competition Field">{renderFieldPicker(inp.inputKey, inp.fieldCompetition ?? '', v => updateSb(idx, { fieldCompetition: v }), 'Title.Text', undefined, allInputs)}</Field>
                            <Field label="Category Field">{renderFieldPicker(inp.inputKey, inp.fieldCategory ?? '', v => updateSb(idx, { fieldCategory: v }), 'Title.Text', undefined, allInputs)}</Field>
                            <Field label="Group Field">{renderFieldPicker(inp.inputKey, inp.fieldGroup ?? '', v => updateSb(idx, { fieldGroup: v }), 'Title.Text', undefined, allInputs)}</Field>
                            <Field label="Round Field (Tier + Round, e.g. &quot;Semifinal 1 Cup&quot;)">{renderFieldPicker(inp.inputKey, inp.fieldRound ?? '', v => updateSb(idx, { fieldRound: v }), 'Title.Text', undefined, allInputs)}</Field>
                            <Field label="Scheduled Time Field">{renderFieldPicker(inp.inputKey, inp.fieldScheduledTime ?? '', v => updateSb(idx, { fieldScheduledTime: v }), 'Title.Text', undefined, allInputs)}</Field>
                            <Field label="Match ID Field">{renderFieldPicker(inp.inputKey, inp.fieldMatchId ?? '', v => updateSb(idx, { fieldMatchId: v }), 'Title.Text', undefined, allInputs)}</Field>
                            <Field label="Logo A Field">{renderFieldPicker(inp.inputKey, inp.fieldLogoA ?? '', v => {
                              updateSb(idx, { fieldLogoA: v });
                              if (v && cfg.teamALogo) {
                                const { getClient } = useVmixStore.getState();
                                const c = getClient();
                                if (c && inp.inputKey) c.setImageField(inp.inputKey, v, cfg.teamALogo);
                              }
                            }, 'LogoA.Source', n => n.toLowerCase().endsWith('.source'), allInputs)}</Field>
                            {inp.fieldLogoA && (
                              <Field label="Logo A (auto)">
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  {cfg.teamALogo ? (
                                    <>
                                      <img src={resolveImageUrl(cfg.teamALogo)} alt="" style={{ width: 28, height: 21, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 3, background: '#111', flexShrink: 0 }} />
                                      <span style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{cfg.teamALogo}</span>
                                    </>
                                  ) : (
                                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>No logo — set in Scoreboard or Tournament</span>
                                  )}
                                </div>
                              </Field>
                            )}
                            <Field label="Logo B Field">{renderFieldPicker(inp.inputKey, inp.fieldLogoB ?? '', v => {
                              updateSb(idx, { fieldLogoB: v });
                              if (v && cfg.teamBLogo) {
                                const { getClient } = useVmixStore.getState();
                                const c = getClient();
                                if (c && inp.inputKey) c.setImageField(inp.inputKey, v, cfg.teamBLogo);
                              }
                            }, 'LogoB.Source', n => n.toLowerCase().endsWith('.source'), allInputs)}</Field>
                            {inp.fieldLogoB && (
                              <Field label="Logo B (auto)">
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  {cfg.teamBLogo ? (
                                    <>
                                      <img src={resolveImageUrl(cfg.teamBLogo)} alt="" style={{ width: 28, height: 21, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 3, background: '#111', flexShrink: 0 }} />
                                      <span style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{cfg.teamBLogo}</span>
                                    </>
                                  ) : (
                                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>No logo — set in Scoreboard or Tournament</span>
                                  )}
                                </div>
                              </Field>
                            )}

                            <MergeFieldComposer
                              parts={SCORE_MERGE_PARTS_A}
                              mergedParts={inp.mergedAParts ?? []}
                              mergedPrefix={inp.mergedAPrefix ?? ''}
                              mergedSeparator={inp.mergedASeparator ?? ' '}
                              onChange={patch => updateSb(idx, {
                                ...(patch.mergedParts !== undefined ? { mergedAParts: patch.mergedParts } : {}),
                                ...(patch.mergedPrefix !== undefined ? { mergedAPrefix: patch.mergedPrefix } : {}),
                                ...(patch.mergedSeparator !== undefined ? { mergedASeparator: patch.mergedSeparator } : {}),
                              })}
                              inputKey={inp.inputKey}
                              allInputs={allInputs}
                              dragKey={`sb_${inp.id}_a`}
                              fieldLabel="Team A merged field"
                            />
                            <MergeFieldComposer
                              parts={SCORE_MERGE_PARTS_B}
                              mergedParts={inp.mergedBParts ?? []}
                              mergedPrefix={inp.mergedBPrefix ?? ''}
                              mergedSeparator={inp.mergedBSeparator ?? ' '}
                              onChange={patch => updateSb(idx, {
                                ...(patch.mergedParts !== undefined ? { mergedBParts: patch.mergedParts } : {}),
                                ...(patch.mergedPrefix !== undefined ? { mergedBPrefix: patch.mergedPrefix } : {}),
                                ...(patch.mergedSeparator !== undefined ? { mergedBSeparator: patch.mergedSeparator } : {}),
                              })}
                              inputKey={inp.inputKey}
                              allInputs={allInputs}
                              dragKey={`sb_${inp.id}_b`}
                              fieldLabel="Team B merged field"
                            />
                            <MergeFieldComposer
                              parts={SCORE_MERGE_PARTS_INFO}
                              mergedParts={inp.mergedInfoParts ?? []}
                              mergedPrefix={inp.mergedInfoPrefix ?? ''}
                              mergedSeparator={inp.mergedInfoSeparator ?? ' '}
                              onChange={patch => updateSb(idx, {
                                ...(patch.mergedParts !== undefined ? { mergedInfoParts: patch.mergedParts } : {}),
                                ...(patch.mergedPrefix !== undefined ? { mergedInfoPrefix: patch.mergedPrefix } : {}),
                                ...(patch.mergedSeparator !== undefined ? { mergedInfoSeparator: patch.mergedSeparator } : {}),
                              })}
                              inputKey={inp.inputKey}
                              allInputs={allInputs}
                              dragKey={`sb_${inp.id}_info`}
                              fieldLabel="Match info merged field"
                            />
                          </>
                        )}
                      </>)}
                    </div>
                  );
                })}
                <button className="btn btn--ghost btn--small" onClick={addSbInput}>+ Add vMix Input</button>
              </>
            );
          })()}
          </>
        );

        const generalAfter = (
          <>
          <CollapsibleSection label="Score Log">
            <Field label="Linked Score Log Widget">
              <CustomBox>
                <select className="field-input" value={cfg.linkedScoreLogWidgetId ?? ''} onChange={e => up({ linkedScoreLogWidgetId: e.target.value })}>
                  <option value="">— none —</option>
                  {pages.flatMap(p => p.widgets.filter(w => w.type === 'score-log')).map(w => (
                    <option key={w.id} value={w.id}>Score Log</option>
                  ))}
                </select>
              </CustomBox>
            </Field>
            <Field label="Linked Timer (for timestamps)">
              <CustomBox>
                <select className="field-input" value={cfg.linkedTimerWidgetId ?? ''} onChange={e => up({ linkedTimerWidgetId: e.target.value })}>
                  <option value="">— wall clock —</option>
                  {pages.flatMap(p => p.widgets.filter(w => w.type === 'timer')).map(w => (
                    <option key={w.id} value={w.id}>{w.config.name || 'Timer'}</option>
                  ))}
                </select>
              </CustomBox>
            </Field>
          </CollapsibleSection>

          <CollapsibleSection label="Player Picker">
            <Field label="Team A Player List">
              <CustomBox>
                <select className="field-input" value={cfg.linkedPlayerListA ?? ''} onChange={e => up({ linkedPlayerListA: e.target.value })}>
                  <option value="">— none —</option>
                  {pages.flatMap(p => p.widgets.filter(w => w.type === 'player-list')).map(w => (
                    <option key={w.id} value={w.id}>{plWidgetLabel(w, teamDbTeams)}</option>
                  ))}
                </select>
              </CustomBox>
            </Field>
            <Field label="Team B Player List">
              <CustomBox>
                <select className="field-input" value={cfg.linkedPlayerListB ?? ''} onChange={e => up({ linkedPlayerListB: e.target.value })}>
                  <option value="">— none —</option>
                  {pages.flatMap(p => p.widgets.filter(w => w.type === 'player-list')).map(w => (
                    <option key={w.id} value={w.id}>{plWidgetLabel(w, teamDbTeams)}</option>
                  ))}
                </select>
              </CustomBox>
            </Field>
          </CollapsibleSection>
          </>
        );

        return renderTabbed(<>{general}{generalAfter}</>, vmix);
      }

      case 'score-lower-third': {
        const scoreboards = pages.flatMap(p => p.widgets.filter(w => w.type === 'scoreboard'));
        type SltInput = {
          id: string; actionLabel: string; vmixInputKey: string; vmixInputTitle?: string; fieldTeam: string; fieldScorer: string; fieldJersey: string; fieldAction: string;
          fieldTeamLogo?: string;
          mergedPrefix?: string; mergedParts?: string[]; mergedSeparator?: string;
        };
        const sltInputs: SltInput[] = cfg.vmixInputs?.length
          ? cfg.vmixInputs
          : [{ id: 'default', actionLabel: '', vmixInputKey: '', fieldTeam: 'Team.Text', fieldScorer: 'Scorer.Text', fieldJersey: 'Jersey.Text', fieldAction: 'Action.Text' }];
        const setSltInputs = (next: SltInput[]) => up({ vmixInputs: next });
        const updateSlt = (idx: number, patch: Partial<SltInput>) =>
          setSltInputs(sltInputs.map((s, i) => i === idx ? { ...s, ...patch } : s));

        const sb = scoreboards.find(w => w.id === cfg.linkedScoreboardId);
        const nameA = sb?.config.teamAName ?? 'Team A';
        const nameB = sb?.config.teamBName ?? 'Team B';

        const general = (
          <>
            <CollapsibleSection label="Data Source">
              <Field label="Linked Scoreboard">
                <CustomBox>
                  <select className="field-input" value={cfg.linkedScoreboardId ?? ''} onChange={e => up({ linkedScoreboardId: e.target.value })}>
                    <option value="">— select scoreboard —</option>
                    {scoreboards.map(w => (
                      <option key={w.id} value={w.id}>{w.config.teamAName ?? 'Team A'} vs {w.config.teamBName ?? 'Team B'}</option>
                    ))}
                  </select>
                </CustomBox>
              </Field>
              <Field label="Team Filter">
                <CustomBox>
                  <select className="field-input" value={cfg.teamFilter ?? 'all'} onChange={e => up({ teamFilter: e.target.value })}>
                    <option value="all">Both teams (last scorer)</option>
                    <option value="A">{nameA} only</option>
                    <option value="B">{nameB} only</option>
                  </select>
                </CustomBox>
              </Field>
            </CollapsibleSection>
          </>
        );

        const vmix = (
          <>
            <Field label="Auto-send on new goal">
              <ToggleCard checked={cfg.autoSend ?? false} onChange={v => up({ autoSend: v })} desc="Send automatically when score changes" />
            </Field>

            <CollapsibleSection label="vMix Title Inputs">
              <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '0 0 6px', lineHeight: 1.4 }}>
                Add one input per score type. Leave "Score Action" blank to use as default fallback.
              </p>
              {sltInputs.map((inp, idx) => {
                const isVilCollapsed = vilCollapsed[inp.id] ?? false;
                return (
                  <div key={inp.id} className="vil-cfg-block">
                    <div className="vil-cfg-header">
                      <button className="btn btn--ghost btn--small tf-collapse-btn"
                        onClick={() => setVilCollapsed(p => ({ ...p, [inp.id]: !p[inp.id] }))}
                        title={isVilCollapsed ? 'Expand' : 'Collapse'}>
                        {isVilCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                      </button>
                      <span className="vil-cfg-label">
                        {inp.actionLabel ? `"${inp.actionLabel}"` : 'Default (fallback)'}
                      </span>
                      {sltInputs.length > 1 && (
                        <button className="btn btn--ghost btn--small"
                          onClick={() => setSltInputs(sltInputs.filter((_, i) => i !== idx))}>×</button>
                      )}
                    </div>
                    {!isVilCollapsed && (<>
                      <Field label="Score Action">
                        <input className="field-input" value={inp.actionLabel} placeholder="e.g. Try, Goal (blank = default)"
                          onChange={e => updateSlt(idx, { actionLabel: e.target.value })} />
                      </Field>
                      {renderInputPicker(
                        'vMix Title Input',
                        inp.vmixInputKey,
                        inp.vmixInputTitle,
                        (key, title) => updateSlt(idx, { vmixInputKey: key, vmixInputTitle: title }),
                        (i: any) => i.type === 'GT',
                        allInputs,
                      )}
                      {inp.vmixInputKey && (
                        <>
                          <Field label="Team Name Field">{renderFieldPicker(inp.vmixInputKey, inp.fieldTeam, v => updateSlt(idx, { fieldTeam: v }), 'Title.Text', undefined, allInputs)}</Field>
                          <Field label="Scorer Name Field">{renderFieldPicker(inp.vmixInputKey, inp.fieldScorer, v => updateSlt(idx, { fieldScorer: v }), 'Title.Text', undefined, allInputs)}</Field>
                          <Field label="Jersey No. Field">{renderFieldPicker(inp.vmixInputKey, inp.fieldJersey, v => updateSlt(idx, { fieldJersey: v }), 'Title.Text', undefined, allInputs)}</Field>
                          <Field label="Score Action Field">
                            {renderFieldPicker(inp.vmixInputKey, inp.fieldAction, v => updateSlt(idx, { fieldAction: v }), 'Title.Text', undefined, allInputs)}
                          </Field>
                          <Field label="Team Logo Field">
                            {renderFieldPicker(inp.vmixInputKey, inp.fieldTeamLogo ?? '', v => updateSlt(idx, { fieldTeamLogo: v }), 'Team.Source', n => n.toLowerCase().endsWith('.source'), allInputs)}
                          </Field>
                          <MergeFieldComposer
                            parts={[
                              { key: 'team', label: 'Team', sample: 'Chelsea' },
                              { key: 'scorer', label: 'Scorer', sample: 'John Smith' },
                              { key: 'jersey', label: 'Jersey', sample: '9' },
                              { key: 'action', label: 'Action', sample: 'Try' },
                            ]}
                            mergedParts={inp.mergedParts ?? []}
                            mergedPrefix={inp.mergedPrefix ?? ''}
                            mergedSeparator={inp.mergedSeparator ?? ' '}
                            onChange={patch => updateSlt(idx, patch as Partial<SltInput>)}
                            inputKey={inp.vmixInputKey}
                            allInputs={allInputs}
                            dragKey={`${widget.id}_slt_${inp.id}`}
                          />
                        </>
                      )}
                    </>)}
                  </div>
                );
              })}
              <button className="btn btn--ghost btn--small" onClick={() =>
                setSltInputs([...sltInputs, { id: crypto.randomUUID(), actionLabel: '', vmixInputKey: '', fieldTeam: 'Team.Text', fieldScorer: 'Scorer.Text', fieldJersey: 'Jersey.Text', fieldAction: 'Action.Text' }])
              }>+ Add Score Type</button>
            </CollapsibleSection>

            <CollapsibleSection label="Overlay">
              <Field label="Overlay Channel">
                <CardSelect
                  value={cfg.overlayChannel ?? 1}
                  onChange={v => up({ overlayChannel: v })}
                  columns={4}
                  options={[1, 2, 3, 4].map(n => ({ value: n, label: `Overlay ${n}` }))}
                />
              </Field>
            </CollapsibleSection>
          </>
        );

        return renderTabbed(general, vmix);
      }

      case 'player-lower-third': {
        const playerListWidgets = pages.flatMap(p => p.widgets.filter(w => w.type === 'player-list'));
        const general = (
          <>
            <CollapsibleSection label="Data Source">
              <Field label="Linked Player List">
                <CustomBox>
                  <select className="field-input" value={cfg.linkedPlayerListId ?? ''} onChange={e => up({ linkedPlayerListId: e.target.value })}>
                    <option value="">— select player list —</option>
                    {playerListWidgets.map(w => (
                      <option key={w.id} value={w.id}>{plWidgetLabel(w, teamDbTeams)}</option>
                    ))}
                  </select>
                </CustomBox>
              </Field>
              <Field label="Linked Scoreboard (for score summary)">
                <CustomBox>
                  <select className="field-input" value={cfg.linkedScoreboardId ?? ''} onChange={e => up({ linkedScoreboardId: e.target.value })}>
                    <option value="">— none —</option>
                    {pages.flatMap(p => p.widgets.filter(w => w.type === 'scoreboard')).map(w => (
                      <option key={w.id} value={w.id}>{w.config.teamAName ?? 'Team A'} vs {w.config.teamBName ?? 'Team B'}</option>
                    ))}
                  </select>
                </CustomBox>
              </Field>
            </CollapsibleSection>
          </>
        );

        const vmix = (
          <>
            <Field label="Auto-send on highlight">
              <ToggleCard checked={cfg.autoSend ?? true} onChange={v => up({ autoSend: v })} desc="Send automatically when player is highlighted" />
            </Field>

            <CollapsibleSection label="vMix Title Input">
              {renderInputPicker('vMix Input', cfg.vmixInputKey ?? '', cfg.vmixInputTitle,
                (key, title) => up({ vmixInputKey: key, vmixInputTitle: title }),
                (i: any) => i.type === 'GT',
                allInputs,
              )}
              {cfg.vmixInputKey && (
                <>
                  <Field label="Name field">{renderFieldPicker(cfg.vmixInputKey, cfg.fieldName ?? 'Name.Text', v => up({ fieldName: v }), 'Title.Text', undefined, allInputs)}</Field>
                  <Field label="Jersey No. field">{renderFieldPicker(cfg.vmixInputKey, cfg.fieldJersey ?? 'Jersey.Text', v => up({ fieldJersey: v }), 'Title.Text', undefined, allInputs)}</Field>
                  <Field label="Position field">{renderFieldPicker(cfg.vmixInputKey, cfg.fieldPosition ?? 'Position.Text', v => up({ fieldPosition: v }), 'Title.Text', undefined, allInputs)}</Field>
                  <Field label="Team name field">{renderFieldPicker(cfg.vmixInputKey, cfg.fieldTeam ?? 'Team.Text', v => up({ fieldTeam: v }), 'Title.Text', undefined, allInputs)}</Field>
                  <Field label="Score summary field">{renderFieldPicker(cfg.vmixInputKey, cfg.fieldScoreSummary ?? '', v => up({ fieldScoreSummary: v }), 'Title.Text', undefined, allInputs)}</Field>
                  <Field label="Team Logo field">{renderFieldPicker(cfg.vmixInputKey, cfg.fieldTeamLogo ?? '', v => up({ fieldTeamLogo: v }), 'Team.Source', n => n.toLowerCase().endsWith('.source'), allInputs)}</Field>
                  <MergeFieldComposer
                    parts={[
                      { key: 'name', label: 'Name', sample: 'John Smith' },
                      { key: 'jersey', label: 'Jersey', sample: '9' },
                      { key: 'position', label: 'Position', sample: 'Scrum Half' },
                      { key: 'team', label: 'Team', sample: 'Chelsea' },
                      { key: 'scoreSummary', label: 'Score Summary', sample: '2 Tries' },
                    ]}
                    mergedParts={cfg.mergedParts ?? []}
                    mergedPrefix={cfg.mergedPrefix ?? ''}
                    mergedSeparator={cfg.mergedSeparator ?? ' '}
                    onChange={patch => up(patch)}
                    inputKey={cfg.vmixInputKey}
                    allInputs={allInputs}
                    dragKey={`${widget.id}_plt`}
                  />
                </>
              )}
            </CollapsibleSection>

            <CollapsibleSection label="Overlay">
              <Field label="Overlay Channel">
                <CardSelect
                  value={cfg.overlayChannel ?? 1}
                  onChange={v => up({ overlayChannel: v })}
                  columns={4}
                  options={[1, 2, 3, 4].map(n => ({ value: n, label: `Overlay ${n}` }))}
                />
              </Field>
            </CollapsibleSection>
          </>
        );

        return renderTabbed(general, vmix);
      }

      case 'sin-bin-lower-third': {
        const playerListWidgets = pages.flatMap(p => p.widgets.filter(w => w.type === 'player-list'));
        const plLabel = (w: any) => plWidgetLabel(w, teamDbTeams);
        const general = (
          <>
            <CollapsibleSection label="Team">
              <p className="app-settings-hint" style={{ margin: '0 0 6px' }}>
                Link one player list (one team). Add a second widget for the other team.
              </p>
              <Field label="Player List">
                <CustomBox>
                  <select className="field-input" value={cfg.linkedPlayerListId ?? ''} onChange={e => up({ linkedPlayerListId: e.target.value })}>
                    <option value="">— select player list —</option>
                    {playerListWidgets.map(w => <option key={w.id} value={w.id}>{plLabel(w)}</option>)}
                  </select>
                </CustomBox>
              </Field>
            </CollapsibleSection>
          </>
        );

        const vmix = (
          <>
            <Field label="Auto-send on change">
              <ToggleCard checked={cfg.autoSend ?? false} onChange={v => up({ autoSend: v })} desc="Send automatically when player changes" />
            </Field>

            <CollapsibleSection label="vMix Title Input">
              {renderInputPicker('vMix Input', cfg.vmixInputKey ?? '', cfg.vmixInputTitle,
                (key, title) => up({ vmixInputKey: key, vmixInputTitle: title }),
                (i: any) => i.type === 'GT',
                allInputs,
              )}
              {cfg.vmixInputKey && (
                <>
                  <Field label="Jersey No. field">{renderFieldPicker(cfg.vmixInputKey, cfg.fieldJersey ?? 'Jersey.Text', v => up({ fieldJersey: v }), 'Title.Text', undefined, allInputs)}</Field>
                  <Field label="Name field">{renderFieldPicker(cfg.vmixInputKey, cfg.fieldName ?? 'Name.Text', v => up({ fieldName: v }), 'Title.Text', undefined, allInputs)}</Field>
                  <Field label="Timer field">{renderFieldPicker(cfg.vmixInputKey, cfg.fieldTimer ?? 'Timer.Text', v => up({ fieldTimer: v }), 'Title.Text', undefined, allInputs)}</Field>
                  <Field label="Team name field">{renderFieldPicker(cfg.vmixInputKey, cfg.fieldTeam ?? 'Team.Text', v => up({ fieldTeam: v }), 'Title.Text', undefined, allInputs)}</Field>
                  <Field label="Team Logo field">{renderFieldPicker(cfg.vmixInputKey, cfg.fieldTeamLogo ?? '', v => up({ fieldTeamLogo: v }), 'Team.Source', n => n.toLowerCase().endsWith('.source'), allInputs)}</Field>
                  <MergeFieldComposer
                    parts={[
                      { key: 'jersey', label: 'Jersey', sample: '9' },
                      { key: 'name', label: 'Name', sample: 'John Smith' },
                      { key: 'timer', label: 'Timer', sample: '08:32' },
                      { key: 'team', label: 'Team', sample: 'Chelsea' },
                    ]}
                    mergedParts={cfg.mergedParts ?? []}
                    mergedPrefix={cfg.mergedPrefix ?? ''}
                    mergedSeparator={cfg.mergedSeparator ?? ' '}
                    onChange={patch => up(patch)}
                    inputKey={cfg.vmixInputKey}
                    allInputs={allInputs}
                    dragKey={`${widget.id}_sinbin`}
                  />
                </>
              )}
            </CollapsibleSection>

            <CollapsibleSection label="Overlay">
              <Field label="Overlay Channel">
                <CardSelect
                  value={cfg.overlayChannel ?? 1}
                  onChange={v => up({ overlayChannel: v })}
                  columns={4}
                  options={[1, 2, 3, 4].map(n => ({ value: n, label: `Overlay ${n}` }))}
                />
              </Field>
            </CollapsibleSection>
          </>
        );

        return renderTabbed(general, vmix);
      }

      case 'timer': {
        const allTimerWidgets = pages.flatMap(p => p.widgets).filter(w => w.type === 'timer' && w.id !== widget.id);
        const linkedTimerTournament = tournaments.find(t => t.id === (cfg.linkedTournamentId || pageTournamentId));
        const timerTournSettings = linkedTimerTournament
          ? (linkedTimerTournament.settings ?? { periods: 2, periodDurationMs: 2700000, halfTimeDurationMs: 900000, maxOnField: 11 })
          : null;
        const fmtMs = (ms: number) => {
          const m = Math.floor(ms / 60000);
          const s = Math.floor((ms % 60000) / 1000);
          return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        };
        return (
        <>
          <CollapsibleSection label="Link to Timer">
            <Field label="Source Timer">
              <CustomBox>
                <select className="field-input" value={cfg.linkedTimerSourceId ?? ''} onChange={e => up({ linkedTimerSourceId: e.target.value })}>
                  <option value="">— standalone (own timer) —</option>
                  {allTimerWidgets.map(w => (
                    <option key={w.id} value={w.id}>{w.label || w.config?.name || w.id}</option>
                  ))}
                </select>
              </CustomBox>
            </Field>
            {cfg.linkedTimerSourceId && (
              <p className="timer-db-hint">This widget mirrors the selected timer. Controls are hidden — manage from the source timer.</p>
            )}
          </CollapsibleSection>
          <CollapsibleSection label="Tournament Database">
            <Field label="Link Tournament">
              <CustomBox>
                <select className="field-input" value={cfg.linkedTournamentId ?? ''} onChange={e => up({ linkedTournamentId: e.target.value })}>
                  <option value="">{pageTournament ? `— Auto: ${pageTournament.name} (this canvas) —` : '— none (manual) —'}</option>
                  {tournaments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </CustomBox>
            </Field>
            {timerTournSettings && (
              <div className="timer-db-settings">
                <div className="timer-db-row">
                  <span>Periods</span><strong>{timerTournSettings.periods}</strong>
                </div>
                <div className="timer-db-row">
                  <span>Period duration</span><strong>{fmtMs(timerTournSettings.periodDurationMs)}</strong>
                </div>
                <div className="timer-db-row">
                  <span>Half-time / Break</span><strong>{fmtMs(timerTournSettings.halfTimeDurationMs)}</strong>
                </div>
                <p className="timer-db-hint">Settings auto-apply when timer is not running. Edit in DB.</p>
              </div>
            )}
          </CollapsibleSection>
          <CollapsibleSection label="Timer">
          <SettingsSummary rows={[
            { icon: cfg.mode === 'countup' ? ArrowUp : ArrowDown, label: 'Mode', value: cfg.mode === 'countup' ? 'Count Up' : 'Countdown' },
            { icon: Timer, label: 'Format', value: cfg.format ?? 'mm:ss' },
            { icon: Hourglass, label: 'Periods', value: (cfg.periods ?? 1) <= 1 ? 'None' : `${cfg.periods} (${cfg.periodMode === 'continue' ? 'continues' : 'resets'} after break)` },
          ]} />
          <Field label="Mode">
            <CardSelect
              value={cfg.mode ?? 'countdown'}
              onChange={mode => up({ mode, currentMs: mode === 'countdown' ? cfg.durationMs : 0 })}
              options={[{ value: 'countdown', label: 'Countdown' }, { value: 'countup', label: 'Count Up' }]}
            />
          </Field>
          <Field label="Display Format">
            <CardSelect
              value={cfg.format ?? 'mm:ss'}
              onChange={v => up({ format: v })}
              options={[
                { value: 'hh:mm:ss', label: 'hh:mm:ss' },
                { value: 'h:mm:ss', label: 'h:mm:ss' },
                { value: 'mm:ss', label: 'mm:ss' },
                { value: 'ss', label: 'seconds only' },
              ]}
            />
          </Field>

          <CollapsibleSection label="Advanced Format Rules" defaultOpen={false}>
          <Field label="Time format options">
            <ToggleCard checked={cfg.showMs ?? false} onChange={v => up({ showMs: v })} desc="Show milliseconds (adds a :FF hundredths segment)" />
            <ToggleCard checked={cfg.noLeadingZero ?? false} onChange={v => up({ noLeadingZero: v })} desc={"Remove leading zero (e.g. \"07:00\" → \"7:00\")"} />
            <ToggleCard checked={cfg.subMinuteMs ?? false} onChange={v => up({ subMinuteMs: v })} desc={"Below 1 minute, show seconds:milliseconds (e.g. \"58:58\")"} />
            <p className="app-settings-hint" style={{ margin: '6px 0 0' }}>
              Preview: {formatTime(425580, cfg.format ?? 'mm:ss', cfg)} · under 1 min: {formatTime(58580, cfg.format ?? 'mm:ss', cfg)}
            </p>
          </Field>
          <Field label="vMix text format">
            <ToggleCard checked={cfg.vmixFollowsFormat ?? true} onChange={v => up({ vmixFollowsFormat: v })} desc="Match the on-screen display format above" />
            <p className="app-settings-hint" style={{ margin: '4px 0 0' }}>
              {cfg.vmixFollowsFormat === false
                ? 'Off — the vMix text field uses its own format below, independent of what the widget shows on screen.'
                : 'On (default) — the vMix text field always shows exactly what the widget itself displays.'}
            </p>
            {cfg.vmixFollowsFormat === false && (
              <div style={{ marginTop: 8, paddingLeft: 8, borderLeft: '2px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="tf-autosend-label">Format:</span>
                  <CardSelect
                    value={cfg.vmixFormat ?? 'mm:ss'}
                    onChange={v => up({ vmixFormat: v })}
                    options={[
                      { value: 'hh:mm:ss', label: 'hh:mm:ss' },
                      { value: 'h:mm:ss', label: 'h:mm:ss' },
                      { value: 'mm:ss', label: 'mm:ss' },
                      { value: 'ss', label: 'seconds only' },
                    ]}
                  />
                </div>
                <ToggleCard checked={cfg.vmixShowMs ?? false} onChange={v => up({ vmixShowMs: v })} desc="Show milliseconds" />
                <ToggleCard checked={cfg.vmixNoLeadingZero ?? false} onChange={v => up({ vmixNoLeadingZero: v })} desc="Remove leading zero" />
                <ToggleCard checked={cfg.vmixSubMinuteMs ?? false} onChange={v => up({ vmixSubMinuteMs: v })} desc="Below 1 minute, show seconds:milliseconds" />
                <p className="app-settings-hint" style={{ margin: 0 }}>
                  vMix preview: {formatTime(425580, cfg.vmixFormat ?? 'mm:ss', { showMs: cfg.vmixShowMs, noLeadingZero: cfg.vmixNoLeadingZero, subMinuteMs: cfg.vmixSubMinuteMs })}
                </p>
              </div>
            )}
          </Field>
          </CollapsibleSection>

          <Field label="Timer font size (px)">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="range" min={12} max={120} step={2} className="field-range"
                value={cfg.timerFontSize ?? 28} onChange={e => up({ timerFontSize: Number(e.target.value) })} />
              <span style={{ minWidth: 32, textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)' }}>{cfg.timerFontSize ?? 28}px</span>
            </div>
          </Field>
          <Field label="Button size (px)">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="range" min={10} max={32} step={1} className="field-range"
                value={cfg.btnFontSize ?? 13} onChange={e => up({ btnFontSize: Number(e.target.value) })} />
              <span style={{ minWidth: 32, textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)' }}>{cfg.btnFontSize ?? 13}px</span>
            </div>
          </Field>
          <Field label={`Duration (${cfg.format ?? 'mm:ss'})`}>
            <input
              className="field-input"
              value={durationText}
              placeholder={cfg.format === 'ss' ? '300' : cfg.format === 'mm:ss' ? '05:00' : '00:05:00'}
              onChange={e => setDurationText(e.target.value)}
              onBlur={() => {
                const ms = formatStrToMs(durationText, cfg.format ?? 'mm:ss');
                up({ durationMs: ms, currentMs: cfg.mode === 'countdown' ? ms : cfg.currentMs });
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const ms = formatStrToMs(durationText, cfg.format ?? 'mm:ss');
                  up({ durationMs: ms, currentMs: cfg.mode === 'countdown' ? ms : cfg.currentMs });
                  (e.target as HTMLInputElement).blur();
                }
              }}
            />
          </Field>
          <Field label="Periods">
            <CardSelect
              value={cfg.periods ?? 1}
              onChange={periods => up({ periods, currentPeriod: 1, periodStartMs: 0, inBreak: false, breakCurrentMs: 0 })}
              options={[
                { value: 1, label: 'None', sub: 'One running clock' },
                { value: 2, label: '2 Halves', sub: 'Football/rugby style' },
                { value: 3, label: '3 Periods', sub: 'Ice hockey style' },
                { value: 4, label: '4 Quarters', sub: 'Basketball style' },
              ]}
            />
          </Field>
          {(cfg.periods ?? 1) > 1 && (
            <Field label="After Break">
              <CardSelect
                value={cfg.periodMode ?? 'reset'}
                onChange={v => up({ periodMode: v })}
                options={[{ value: 'reset', label: 'Reset each period' }, { value: 'continue', label: 'Continue from last' }]}
              />
            </Field>
          )}
          {(cfg.periods ?? 1) > 1 && (
            <Field label="Current Period">
              <CardSelect
                value={Math.min(cfg.currentPeriod ?? 1, cfg.periods ?? 1)}
                onChange={v => store.jumpToPeriod(widget.id, v)}
                columns={cfg.periods ?? 1}
                options={Array.from({ length: cfg.periods ?? 1 }, (_, i) => i + 1).map(p => ({ value: p, label: `Period ${p}` }))}
              />
            </Field>
          )}
          <Field label="Overrun (manual end)">
            <ToggleCard checked={cfg.overrun ?? false} onChange={v => up({ overrun: v })} desc="Keep running after time — end manually" />
          </Field>
          {cfg.overrun && (
            <>
              <Field label="Change title color on overrun">
                <ToggleCard checked={cfg.overrunColorEnabled ?? false} onChange={v => up({ overrunColorEnabled: v })} desc="Send a vMix function on overrun" />
              </Field>
              {cfg.overrunColorEnabled && (() => {
                const ocFn = cfg.overrunColorFn ?? 'SetColor';
                const isCustomOc = ocFn !== '' && !VMIX_ALL_FNS.find(f => f.fn === ocFn);
                const selectValOc = isCustomOc ? '__custom__' : ocFn;
                return (
                  <>
                    <Field label="Function">
                      <CustomBox>
                        <select className="field-input" value={selectValOc} onChange={e => {
                          if (e.target.value === '__custom__') up({ overrunColorFn: '' });
                          else up({ overrunColorFn: e.target.value });
                        }}>
                          <option value="">— select function —</option>
                          {VMIX_FUNCTIONS.map(g => (
                            <optgroup key={g.group} label={g.group}>
                              {g.fns.map(f => <option key={f.fn} value={f.fn}>{f.label}</option>)}
                            </optgroup>
                          ))}
                        </select>
                      </CustomBox>
                    </Field>
                    {isCustomOc && (
                      <Field label="Custom Function">
                        <input className="field-input" value={ocFn}
                          onChange={e => up({ overrunColorFn: e.target.value })}
                          placeholder="e.g. SetColor" />
                      </Field>
                    )}
                    <Field label="Selected Name">
                      {renderFieldPicker(cfg.vmixInputs?.[0]?.inputKey ?? cfg.vmixInputKey ?? '', cfg.overrunColorField ?? '', v => up({ overrunColorField: v }), 'e.g. Color1')}
                    </Field>
                    <span className="field-hint" style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginTop: -4, marginBottom: 4 }}>
                      For SetColor, this must match the named Colour property in the vMix title — not a plain text field name.
                    </span>
                    <Field label="Overrun Color">
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input type="color" className="color-custom" value={cfg.overrunColor ?? '#ff0000'} onChange={e => up({ overrunColor: e.target.value })} />
                        <span className="field-label" style={{ fontSize: 10 }}>{(cfg.overrunColor ?? '#ff0000').toUpperCase()}</span>
                      </div>
                    </Field>
                    <Field label="Normal Color (restored)">
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input type="color" className="color-custom" value={cfg.normalColor ?? '#ffffff'} onChange={e => up({ normalColor: e.target.value })} />
                        <span className="field-label" style={{ fontSize: 10 }}>{(cfg.normalColor ?? '#ffffff').toUpperCase()}</span>
                      </div>
                    </Field>
                  </>
                );
              })()}
            </>
          )}
          <Field label="Quick Adjust Buttons">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
              {((cfg.adjustButtons ?? []) as { id: string; label: string; deltaMs: number }[]).map((btn, i) => (
                <div key={btn.id} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <input
                    className="field-input"
                    style={{ flex: 1, minWidth: 0 }}
                    value={btn.label}
                    placeholder="Label"
                    onChange={e => {
                      const buttons = [...(cfg.adjustButtons ?? [])];
                      buttons[i] = { ...btn, label: e.target.value };
                      up({ adjustButtons: buttons });
                    }}
                  />
                  <input
                    type="number"
                    className="field-input"
                    style={{ width: 72 }}
                    value={btn.deltaMs / 1000}
                    title="Seconds (negative = subtract)"
                    onChange={e => {
                      const buttons = [...(cfg.adjustButtons ?? [])];
                      buttons[i] = { ...btn, deltaMs: (parseFloat(e.target.value) || 0) * 1000 };
                      up({ adjustButtons: buttons });
                    }}
                  />
                  <span style={{ fontSize: 10, color: 'var(--text-secondary)', minWidth: 16 }}>s</span>
                  <button
                    className="wcp-btn-icon"
                    title="Remove button"
                    onClick={() => {
                      const buttons = (cfg.adjustButtons ?? []).filter((_: unknown, j: number) => j !== i);
                      up({ adjustButtons: buttons });
                    }}
                  ><X size={14} /></button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 2 }}>
                <input
                  className="field-input"
                  style={{ flex: 1, minWidth: 0 }}
                  value={adjNewLabel}
                  placeholder="Label (e.g. +30s)"
                  onChange={e => setAdjNewLabel(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const secs = parseFloat(adjNewSeconds) || 0;
                      if (secs === 0) return;
                      const newBtn = { id: Math.random().toString(36).slice(2), label: adjNewLabel || `${secs > 0 ? '+' : ''}${secs}s`, deltaMs: secs * 1000 };
                      up({ adjustButtons: [...(cfg.adjustButtons ?? []), newBtn] });
                      setAdjNewLabel(''); setAdjNewSeconds('10');
                    }
                  }}
                />
                <input
                  type="number"
                  className="field-input"
                  style={{ width: 72 }}
                  value={adjNewSeconds}
                  title="Seconds (negative = subtract)"
                  onChange={e => setAdjNewSeconds(e.target.value)}
                />
                <span style={{ fontSize: 10, color: 'var(--text-secondary)', minWidth: 16 }}>s</span>
                <button
                  className="wcp-btn-icon wcp-btn-icon--add"
                  title="Add button"
                  onClick={() => {
                    const secs = parseFloat(adjNewSeconds) || 0;
                    if (secs === 0) return;
                    const newBtn = { id: Math.random().toString(36).slice(2), label: adjNewLabel || `${secs > 0 ? '+' : ''}${secs}s`, deltaMs: secs * 1000 };
                    up({ adjustButtons: [...(cfg.adjustButtons ?? []), newBtn] });
                    setAdjNewLabel(''); setAdjNewSeconds('10');
                  }}
                >+</button>
              </div>
              <p style={{ fontSize: 10, color: 'var(--text-secondary)', margin: '2px 0 0' }}>
                Positive = add time, negative = subtract. Buttons work while timer is running.
              </p>
            </div>
          </Field>
          </CollapsibleSection>
            <CollapsibleSection label="Final Play">
            <Field label="Enable Final Play">
              <ToggleCard checked={cfg.finalPlayEnabled ?? false} onChange={v => up({ finalPlayEnabled: v })} desc="Auto-start when period ends (overrun off)" />
            </Field>
            {cfg.finalPlayEnabled && (<>
              <Field label="vMix Input">
                {renderInputPicker('fp_vmix', cfg.finalPlayVmixInputKey ?? '', cfg.finalPlayVmixInputTitle ?? '',
                  (key, title) => up({ finalPlayVmixInputKey: key, finalPlayVmixInputTitle: title }))}
              </Field>
              <Field label="Field Name">
                {renderFieldPicker(cfg.finalPlayVmixInputKey ?? '', cfg.finalPlayFieldName ?? '', v => up({ finalPlayFieldName: v }), 'Title.Text')}
              </Field>
              <Field label={`Duration (${cfg.format ?? 'mm:ss'}, 0 = unlimited)`}>
                <input className="field-input" value={finalPlayDurationText}
                  placeholder={cfg.format === 'ss' ? '0' : cfg.format === 'mm:ss' ? '00:00' : '00:00:00'}
                  onChange={e => setFinalPlayDurationText(e.target.value)}
                  onBlur={() => up({ finalPlayDurationMs: formatStrToMs(finalPlayDurationText, cfg.format ?? 'mm:ss') })}
                  onKeyDown={e => { if (e.key === 'Enter') { up({ finalPlayDurationMs: formatStrToMs(finalPlayDurationText, cfg.format ?? 'mm:ss') }); (e.target as HTMLInputElement).blur(); } }} />
              </Field>
              <Field label="End Trigger">
                <ToggleCard checked={cfg.finalPlayEndTriggerEnabled ?? false} onChange={v => up({ finalPlayEndTriggerEnabled: v })} desc="Fire vMix function when Final Play ends" />
              </Field>
              {cfg.finalPlayEndTriggerEnabled && (() => {
                const fpFn = cfg.finalPlayEndTriggerFn ?? '';
                const isCustom = fpFn !== '' && !VMIX_ALL_FNS.find(f => f.fn === fpFn);
                const fpDef = VMIX_ALL_FNS.find(f => f.fn === fpFn);
                const selectVal = isCustom ? '__custom__' : (fpFn || '');
                const needsInput = isCustom || (fpDef?.p ?? []).includes('Input');
                const needsSelectedName = isCustom || (fpDef?.p ?? []).includes('SelectedName');
                const needsValue = isCustom || (fpDef?.p ?? []).includes('Value');
                return (
                  <>
                    <Field label="Function">
                      <CustomBox>
                        <select className="field-input" value={selectVal} onChange={e => {
                          if (e.target.value === '__custom__') up({ finalPlayEndTriggerFn: '' });
                          else up({ finalPlayEndTriggerFn: e.target.value });
                        }}>
                          <option value="">— select function —</option>
                          {VMIX_FUNCTIONS.map(g => (
                            <optgroup key={g.group} label={g.group}>
                              {g.fns.map(f => <option key={f.fn} value={f.fn}>{f.label}</option>)}
                            </optgroup>
                          ))}
                        </select>
                      </CustomBox>
                    </Field>
                    {isCustom && (
                      <Field label="Custom Function">
                        <input className="field-input" value={fpFn}
                          onChange={e => up({ finalPlayEndTriggerFn: e.target.value })}
                          placeholder="e.g. OverlayInput1In" />
                      </Field>
                    )}
                    {needsInput && (
                      <Field label="Input">
                        {renderInputPicker('fpe_input', cfg.finalPlayEndTriggerInput ?? '', cfg.finalPlayEndTriggerInputTitle ?? '',
                          (key, title) => up({ finalPlayEndTriggerInput: key, finalPlayEndTriggerInputTitle: title }))}
                      </Field>
                    )}
                    {needsSelectedName && (
                      <Field label="Selected Name">
                        <input className="field-input" value={cfg.finalPlayEndTriggerSelectedName ?? ''}
                          onChange={e => up({ finalPlayEndTriggerSelectedName: e.target.value })}
                          placeholder="e.g. Headline.Text" />
                      </Field>
                    )}
                    {needsValue && (
                      <Field label="Value">
                        <input className="field-input" value={cfg.finalPlayEndTriggerValue ?? ''}
                          onChange={e => up({ finalPlayEndTriggerValue: e.target.value })}
                          placeholder="value" />
                      </Field>
                    )}
                  </>
                );
              })()}
            </>)}
          </CollapsibleSection>
            <CollapsibleSection label="Period End Trigger">
            <Field label="Enable">
              <ToggleCard checked={cfg.periodEndTriggerEnabled ?? false} onChange={v => up({ periodEndTriggerEnabled: v })} desc="Fire vMix function after each period ends" />
            </Field>
            {cfg.periodEndTriggerEnabled && (() => {
              const petFn = cfg.periodEndTriggerFn ?? '';
              const isCustomPet = petFn !== '' && !VMIX_ALL_FNS.find(f => f.fn === petFn);
              const petDef = VMIX_ALL_FNS.find(f => f.fn === petFn);
              const selectVal = isCustomPet ? '__custom__' : (petFn || '');
              const needsInput = isCustomPet || (petDef?.p ?? []).includes('Input');
              const needsSelectedName = isCustomPet || (petDef?.p ?? []).includes('SelectedName');
              const needsValue = isCustomPet || (petDef?.p ?? []).includes('Value');
              return (
                <>
                  <Field label="Function">
                    <CustomBox>
                      <select className="field-input" value={selectVal} onChange={e => {
                        if (e.target.value === '__custom__') up({ periodEndTriggerFn: '' });
                        else up({ periodEndTriggerFn: e.target.value });
                      }}>
                        <option value="">— select function —</option>
                        {VMIX_FUNCTIONS.map(g => (
                          <optgroup key={g.group} label={g.group}>
                            {g.fns.map(f => <option key={f.fn} value={f.fn}>{f.label}</option>)}
                          </optgroup>
                        ))}
                      </select>
                    </CustomBox>
                  </Field>
                  {isCustomPet && (
                    <Field label="Custom Function">
                      <input className="field-input" value={petFn}
                        onChange={e => up({ periodEndTriggerFn: e.target.value })}
                        placeholder="e.g. SetFader" />
                    </Field>
                  )}
                  {needsInput && (
                    <Field label="Input">
                      {renderInputPicker('pet_input', cfg.periodEndTriggerInput ?? '', cfg.periodEndTriggerInputTitle ?? '',
                        (key, title) => up({ periodEndTriggerInput: key, periodEndTriggerInputTitle: title }))}
                    </Field>
                  )}
                  {needsSelectedName && (
                    <Field label="Selected Name">
                      <input className="field-input" value={cfg.periodEndTriggerSelectedName ?? ''}
                        onChange={e => up({ periodEndTriggerSelectedName: e.target.value })}
                        placeholder="e.g. Headline.Text" />
                    </Field>
                  )}
                  {needsValue && (
                    <Field label="Value">
                      <input className="field-input" value={cfg.periodEndTriggerValue ?? ''}
                        onChange={e => up({ periodEndTriggerValue: e.target.value })}
                        placeholder="value" />
                    </Field>
                  )}
                </>
              );
            })()}
          {(cfg.periods ?? 1) > 1 && (
            <Field label={`Break Duration (${cfg.format ?? 'mm:ss'})`}>
              <input
                className="field-input"
                value={breakText}
                placeholder={cfg.format === 'ss' ? '0' : cfg.format === 'mm:ss' ? '00:00' : '00:00:00'}
                onChange={e => setBreakText(e.target.value)}
                onBlur={() => {
                  const ms = formatStrToMs(breakText, cfg.format ?? 'mm:ss');
                  up({ breakDurationMs: ms });
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const ms = formatStrToMs(breakText, cfg.format ?? 'mm:ss');
                    up({ breakDurationMs: ms });
                    (e.target as HTMLInputElement).blur();
                  }
                }}
              />
            </Field>
          )}
          {(cfg.periods ?? 1) > 1 && (cfg.breakDurationMs ?? 0) > 0 && (
            <Field label="Break Direction">
              <CardSelect value={cfg.breakCountMode ?? 'down'} onChange={v => up({ breakCountMode: v })}
                options={[{ value: 'down', label: 'Count Down' }, { value: 'up', label: 'Count Up' }]} />
            </Field>
          )}
          {(cfg.periods ?? 1) > 1 && (
            <Field label="Auto-advance">
              <ToggleCard checked={cfg.autoAdvance ?? false} onChange={v => up({ autoAdvance: v })} desc="Flow straight through period → break → next period automatically" />
              <p className="app-settings-hint" style={{ margin: '4px 0 0' }}>
                {cfg.autoAdvance
                  ? 'Auto: no manual step needed between periods and breaks.'
                  : 'Manual (default): period end and break end both pause the timer — press Play/Resume to start each next step.'}
              </p>
            </Field>
          )}
          {(cfg.periods ?? 1) > 1 && !cfg.autoAdvance && (cfg.breakDurationMs ?? 0) > 0 && (
            <Field label="Auto-start break">
              <ToggleCard checked={cfg.autoStartBreak ?? false} onChange={v => up({ autoStartBreak: v })} desc={"Start the half-time/break timer immediately once \"End Period\" is confirmed"} />
              <p className="app-settings-hint" style={{ margin: '4px 0 0' }}>
                Still asks for confirmation to end the period — just skips the extra Play press to start the break countdown afterward.
              </p>
            </Field>
          )}
          </CollapsibleSection>
          {/* ── Extra Time ── */}
          <CollapsibleSection label="Extra Time">
          <Field label="ET Halves">
            <CardSelect value={cfg.extraTimePeriods ?? 0} onChange={v => up({ extraTimePeriods: v })} columns={3}
              options={[{ value: 0, label: 'None' }, { value: 1, label: '1 Half' }, { value: 2, label: '2 Halves' }]} />
          </Field>
          {(cfg.extraTimePeriods ?? 0) > 0 && (() => {
            const etFmt = cfg.format ?? 'mm:ss';
            return (
              <>
                <Field label={`ET Duration (${etFmt})`}>
                  <CustomBox>
                    <input
                      className="field-input"
                      defaultValue={msToFormatStr(cfg.etDurationMs ?? 300000, etFmt)}
                      key={cfg.etDurationMs + etFmt}
                      placeholder={etFmt === 'mm:ss' ? '05:00' : '00:05:00'}
                      onBlur={e => up({ etDurationMs: formatStrToMs(e.target.value, etFmt) })}
                      onKeyDown={e => { if (e.key === 'Enter') { up({ etDurationMs: formatStrToMs((e.target as HTMLInputElement).value, etFmt) }); (e.target as HTMLInputElement).blur(); } }}
                    />
                  </CustomBox>
                </Field>
                {(cfg.extraTimePeriods ?? 0) === 2 && (
                  <Field label={`ET Break (${etFmt})`}>
                    <CustomBox>
                      <input
                        className="field-input"
                        defaultValue={msToFormatStr(cfg.etBreakDurationMs ?? 0, etFmt)}
                        key={cfg.etBreakDurationMs + etFmt}
                        placeholder={etFmt === 'mm:ss' ? '00:00' : '00:00:00'}
                        onBlur={e => up({ etBreakDurationMs: formatStrToMs(e.target.value, etFmt) })}
                        onKeyDown={e => { if (e.key === 'Enter') { up({ etBreakDurationMs: formatStrToMs((e.target as HTMLInputElement).value, etFmt) }); (e.target as HTMLInputElement).blur(); } }}
                      />
                    </CustomBox>
                  </Field>
                )}
              </>
            );
          })()}
          </CollapsibleSection>
          {/* ── After Extra Time ── */}
          <CollapsibleSection label="After Extra Time">
          <Field label="Mode">
            <CardSelect value={cfg.afterEtMode ?? 'none'} onChange={v => up({ afterEtMode: v })} columns={3}
              options={[{ value: 'none', label: 'None' }, { value: 'suddenDeath', label: 'Sudden Death' }, { value: 'goldenPoint', label: 'Golden Point' }]} />
          </Field>
          {(cfg.afterEtMode ?? 'none') !== 'none' && (() => {
            const etFmt = cfg.format ?? 'mm:ss';
            return (
              <Field label={`Max Duration (${etFmt}, 0=unlimited)`}>
                <CustomBox>
                  <input
                    className="field-input"
                    defaultValue={msToFormatStr(cfg.afterEtDurationMs ?? 0, etFmt)}
                    key={cfg.afterEtDurationMs + etFmt}
                    placeholder={etFmt === 'mm:ss' ? '00:00' : '00:00:00'}
                    onBlur={e => up({ afterEtDurationMs: formatStrToMs(e.target.value, etFmt) })}
                    onKeyDown={e => { if (e.key === 'Enter') { up({ afterEtDurationMs: formatStrToMs((e.target as HTMLInputElement).value, etFmt) }); (e.target as HTMLInputElement).blur(); } }}
                  />
                </CustomBox>
              </Field>
            );
          })()}
          <Field label="High Precision (100ms)">
            <ToggleCard checked={cfg.highPrecision ?? false} onChange={v => up({ highPrecision: v })} />
          </Field>
          </CollapsibleSection>
          {/* ── Period Labels & Images ── */}
          {(() => {
            const timerPeriods = cfg.periods ?? 1;
            const hasBreak = (cfg.breakDurationMs ?? 0) > 0 && timerPeriods > 1;
            const etPeriods = cfg.extraTimePeriods ?? 0;
            const afterEtMode = cfg.afterEtMode ?? 'none';
            const hasEtBreak = etPeriods === 2 && (cfg.etBreakDurationMs ?? 0) > 0;
            const overrides: Record<string, { customText?: string; customText2?: string; imagePath?: string }> = cfg.periodOverrides ?? {};
            const patchOverride = (key: string, patch: { customText?: string; customText2?: string; imagePath?: string }) =>
              up({ periodOverrides: { ...overrides, [key]: { ...(overrides[key] ?? {}), ...patch } } });

            const states: { key: string; label: string }[] = [];
            for (let p = 1; p <= timerPeriods; p++) {
              const lbl = timerPeriods === 2 ? (p === 1 ? '1st Half' : '2nd Half')
                : timerPeriods === 4 ? `Q${p}`
                : `Period ${p}`;
              states.push({ key: `p${p}`, label: lbl });
              if (hasBreak && p < timerPeriods)
                states.push({ key: 'break', label: timerPeriods === 2 ? 'Half Time' : 'Break' });
            }
            states.push({ key: 'done', label: timerPeriods === 2 ? 'Full Time' : 'Done' });
            if (etPeriods > 0) {
              for (let ep = 1; ep <= etPeriods; ep++) {
                const etLbl = etPeriods === 2 ? (ep === 1 ? 'ET 1st Half' : 'ET 2nd Half') : 'Extra Time';
                states.push({ key: `et${ep}`, label: etLbl });
                if (hasEtBreak && ep < etPeriods)
                  states.push({ key: 'etBreak', label: 'ET Half Time' });
              }
            }
            if (afterEtMode === 'suddenDeath') states.push({ key: 'sd', label: 'Sudden Death' });
            else if (afterEtMode === 'goldenPoint') states.push({ key: 'gp', label: 'Golden Point' });

            return (
              <>
                <CollapsibleSection label="Period Labels">
                <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '0 0 6px', lineHeight: 1.4 }}>
                  The auto-generated label always goes to its own Default Label field. Custom text and Custom text 2
                  are both optional, independent labels (their own vMix fields) — only sent when you actually type
                  something into them. Image is sent to the separate Period Image field. Any of the three can be
                  filled in at once.
                </p>
                <div className="timer-period-overrides">
                  {states.map(s => (
                    <div key={s.key + s.label} className="timer-period-override-row">
                      <span className="timer-period-override-state">{s.label}</span>
                      <input
                        className="field-input timer-period-override-text"
                        value={overrides[s.key]?.customText ?? ''}
                        placeholder="Custom text…"
                        onChange={e => patchOverride(s.key, { customText: e.target.value })}
                      />
                      <input
                        className="field-input timer-period-override-text"
                        value={overrides[s.key]?.customText2 ?? ''}
                        placeholder="Custom text 2…"
                        onChange={e => patchOverride(s.key, { customText2: e.target.value })}
                      />
                      <LogoUrlPicker
                        value={overrides[s.key]?.imagePath ?? ''}
                        onChange={url => patchOverride(s.key, { imagePath: url })}
                        placeholder="Period image"
                      />
                    </div>
                  ))}
                </div>
                </CollapsibleSection>
              </>
            );
          })()}
          {/* ── Multiple vMix Timer Inputs ── */}
          {(() => {
            type TiInput = { id: string; inputKey: string; inputTitle?: string; fieldName: string; fieldTimerName?: string; fieldDefaultLabel?: string; fieldPeriodLabel?: string; fieldPeriodLabel2?: string; fieldPeriodImage?: string };
            const tiInputs: TiInput[] = cfg.vmixInputs?.length
              ? cfg.vmixInputs
              : cfg.vmixInputKey
                ? [{ id: 'legacy', inputKey: cfg.vmixInputKey, inputTitle: cfg.vmixInputTitle, fieldName: cfg.fieldName ?? 'Timer.Text' }]
                : [];
            const setTiInputs = (next: TiInput[]) => up({ vmixInputs: next });
            const updateTi = (idx: number, patch: Partial<TiInput>) => setTiInputs(tiInputs.map((t, i) => i === idx ? { ...t, ...patch } : t));
            return (
              <>
                {tiInputs.map((inp, idx) => {
                  const isVilCollapsed = vilCollapsed[inp.id] ?? false;
                  return (
                    <div key={inp.id} className="vil-cfg-block">
                      <div className="vil-cfg-header">
                        <button className="btn btn--ghost btn--small tf-collapse-btn"
                          onClick={() => setVilCollapsed(p => ({ ...p, [inp.id]: !p[inp.id] }))}
                          title={isVilCollapsed ? 'Expand' : 'Collapse'}>
                          {isVilCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                        </button>
                        <span className="vil-cfg-label">vMix Title Input {idx + 1}</span>
                        {tiInputs.length > 1 && <button className="btn btn--ghost btn--small" onClick={() => setTiInputs(tiInputs.filter((_, i) => i !== idx))}>×</button>}
                      </div>
                      {!isVilCollapsed && (<>
                        {renderInputPicker('vMix Title Input', inp.inputKey, inp.inputTitle,
                          (key, title) => updateTi(idx, { inputKey: key, inputTitle: title }),
                          i => i.type === 'GT',
                          allInputs,
                        )}
                        {inp.inputKey && (
                          <>
                            <Field label="Timer Value Field">{renderFieldPicker(inp.inputKey, inp.fieldName, v => updateTi(idx, { fieldName: v }), 'Title.Text', undefined, allInputs)}</Field>
                            <Field label="Timer Name Field">{renderFieldPicker(inp.inputKey, inp.fieldTimerName ?? '', v => updateTi(idx, { fieldTimerName: v }), 'Title.Text', undefined, allInputs)}</Field>
                            <Field label="Default Label Field">{renderFieldPicker(inp.inputKey, inp.fieldDefaultLabel ?? '', v => updateTi(idx, { fieldDefaultLabel: v }), 'Title.Text', undefined, allInputs)}</Field>
                            <Field label="Period Label Field">{renderFieldPicker(inp.inputKey, inp.fieldPeriodLabel ?? '', v => updateTi(idx, { fieldPeriodLabel: v }), 'Title.Text', undefined, allInputs)}</Field>
                            <Field label="Period Label 2 Field">{renderFieldPicker(inp.inputKey, inp.fieldPeriodLabel2 ?? '', v => updateTi(idx, { fieldPeriodLabel2: v }), 'Title.Text', undefined, allInputs)}</Field>
                            <Field label="Period Image Field">{renderFieldPicker(inp.inputKey, inp.fieldPeriodImage ?? '', v => updateTi(idx, { fieldPeriodImage: v }), 'PeriodImg.Source', undefined, allInputs)}</Field>
                          </>
                        )}
                      </>)}
                    </div>
                  );
                })}
                <button className="btn btn--ghost btn--small" onClick={() => setTiInputs([...tiInputs, { id: crypto.randomUUID(), inputKey: '', fieldName: 'Timer.Text' }])}>+ Add vMix Input</button>
              </>
            );
          })()}
          {(cfg.periods ?? 1) > 1 && (cfg.breakDurationMs ?? 0) > 0 && (
            <CollapsibleSection label="Break / Half Time Output">
              {renderInputPicker(
                'Break vMix Input',
                cfg.breakVmixInputKey ?? '',
                cfg.breakVmixInputTitle,
                (key, title) => up({ breakVmixInputKey: key, breakVmixInputTitle: title }),
                i => i.type === 'GT',
              )}
              {cfg.breakVmixInputKey && (
                <Field label="Break Field Name">{renderFieldPicker(cfg.breakVmixInputKey, cfg.breakFieldName ?? '', v => up({ breakFieldName: v }), 'Title.Text')}</Field>
              )}
            </CollapsibleSection>
          )}
          <CollapsibleSection label="Mini Timer Output">
            {renderInputPicker(
              'Mini Timer vMix Input',
              cfg.miniVmixInputKey ?? '',
              cfg.miniVmixInputTitle,
              (key, title) => up({ miniVmixInputKey: key, miniVmixInputTitle: title }),
              i => i.type === 'GT',
            )}
            {cfg.miniVmixInputKey && (
              <Field label="Mini Timer Field Name">{renderFieldPicker(cfg.miniVmixInputKey, cfg.miniFieldName ?? '', v => up({ miniFieldName: v }), 'Title.Text')}</Field>
            )}
          </CollapsibleSection>
        </>
        );
      }

      case 'file-path': return renderTabbed(
        <>
          <Field label="Label">
            <input className="field-input" value={cfg.label ?? ''} onChange={e => up({ label: e.target.value })} />
          </Field>
          <Field label="File Filter">
            <CardSelect
              value={cfg.accept ?? 'image/*'}
              onChange={v => up({ accept: v })}
              options={[
                { value: 'image/*', label: 'Images (any)' },
                { value: 'image/jpeg,image/jpg', label: 'JPEG only' },
                { value: 'image/png', label: 'PNG only' },
                { value: 'image/gif', label: 'GIF only' },
                { value: 'image/webp', label: 'WebP only' },
              ]}
            />
          </Field>
        </>,
        <>
          {renderInputPicker(
            'vMix Title Input',
            cfg.inputKey ?? '',
            cfg.inputTitle,
            (key, title) => up({ inputKey: key, inputTitle: title }),
            i => i.type === 'GT',
            allInputs,
          )}
          <Field label="Field Name">{renderFieldPicker(cfg.inputKey ?? '', cfg.fieldName ?? '', v => up({ fieldName: v }), 'Title.Text', undefined, allInputs)}</Field>
          <Field label="Auto-send on browse">
            <ToggleCard checked={cfg.autoSend ?? false} onChange={v => up({ autoSend: v })} desc="Send path immediately after selecting file" />
          </Field>
        </>
      );

      case 'tbar': return renderTabbed(
        <>
          <Field label="Label">
            <input className="field-input" value={cfg.label ?? 'T-Bar'} onChange={e => up({ label: e.target.value })} />
          </Field>
        </>
      );

      case 'volume': return renderTabbed(
        <>
          <Field label="Target">
            <CardSelect
              value={cfg.target ?? 'master'}
              onChange={v => up({ target: v })}
              columns={3}
              options={[
                { value: 'master', label: 'Master', icon: Volume2 },
                { value: 'input', label: 'Input', icon: Mic },
                { value: 'bus', label: 'Audio Bus', icon: RadioIcon },
              ]}
            />
          </Field>
          {cfg.target === 'bus' && (
            <Field label="Bus">
              <CardSelect
                value={cfg.busName ?? 'M'}
                onChange={v => up({ busName: v, label: `Bus ${v}` })}
                columns={4}
                options={['M', 'A', 'B', 'C', 'D', 'E', 'F', 'G'].map(b => ({ value: b, label: b }))}
              />
            </Field>
          )}
          <Field label="Label">
            <input className="field-input" value={cfg.label ?? ''} onChange={e => up({ label: e.target.value })} />
          </Field>
          <Field label="Show Mute Button">
            <ToggleCard checked={cfg.showMute !== false} onChange={v => up({ showMute: v })} />
          </Field>
        </>,
        cfg.target === 'input' ? renderInputPicker(
          'Input',
          cfg.inputKey ?? '',
          cfg.inputTitle,
          (key, title) => up({ inputKey: key, inputTitle: title, label: title || 'Volume' }),
        ) : undefined
      );

      case 'overlay': return (
        <>
          <Field label="Overlay Channel">
            <CardSelect
              value={cfg.channel ?? 1}
              onChange={v => up({ channel: v })}
              columns={4}
              options={[1, 2, 3, 4].map(n => ({ value: n, label: `Overlay ${n}` }))}
            />
          </Field>
        </>
      );

      case 'label': return renderTabbed(
        <>
          <Field label="Text">
            <input className="field-input" value={cfg.text ?? ''} onChange={e => up({ text: e.target.value })} />
          </Field>
          <Field label="Font Size">
            <input className="field-input" type="number" min={8} max={72} value={cfg.fontSize ?? 14} onChange={e => up({ fontSize: Number(e.target.value) })} />
          </Field>
          <Field label="Text Color">
            <input type="color" className="color-custom" value={cfg.color ?? '#ffffff'} onChange={e => up({ color: e.target.value })} />
          </Field>
          <Field label="Background">
            <input type="color" className="color-custom" value={cfg.bgColor === 'transparent' ? '#1a1a2e' : cfg.bgColor ?? '#1a1a2e'} onChange={e => up({ bgColor: e.target.value })} />
          </Field>
          <Field label="Bold">
            <ToggleCard checked={cfg.bold ?? false} onChange={v => up({ bold: v })} />
          </Field>
          <Field label="Align">
            <CardSelect
              value={cfg.align ?? 'center'}
              onChange={v => up({ align: v })}
              options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }]}
            />
          </Field>
        </>
      );

      case 'image-display': return renderTabbed(
        <>
          <Field label="Image">
            <LogoUrlPicker
              value={cfg.imageUrl ?? ''}
              onChange={url => up({ imageUrl: url })}
              placeholder="Pick from library…"
            />
          </Field>
          <Field label="Fit">
            <CardSelect
              value={cfg.objectFit ?? 'contain'}
              onChange={v => up({ objectFit: v })}
              options={[
                { value: 'contain', label: 'Contain', sub: 'Fits, no crop', icon: Scan },
                { value: 'cover', label: 'Cover', sub: 'Fills, crops', icon: Crop },
                { value: 'fill', label: 'Stretch', sub: 'Fills, distorts', icon: Expand },
                { value: 'none', label: 'Original', sub: 'No scaling', icon: Square },
              ]}
            />
          </Field>
          <Field label="Background">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="color" className="color-custom"
                value={cfg.bgColor && cfg.bgColor !== 'transparent' ? cfg.bgColor : '#000000'}
                onChange={e => up({ bgColor: e.target.value })} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                <ToggleCard checked={!cfg.bgColor || cfg.bgColor === 'transparent'} onChange={v => up({ bgColor: v ? 'transparent' : '#000000' })} />
                Transparent
              </label>
            </div>
          </Field>
          <Field label="Caption">
            <input className="field-input" value={cfg.caption ?? ''} placeholder="Optional label"
              onChange={e => up({ caption: e.target.value })} />
          </Field>
        </>
      );

      case 'cg-template': return renderTabbed(
        <>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
            {(cfg.elements ?? []).length} element{(cfg.elements ?? []).length === 1 ? '' : 's'}. Text, image, and
            rectangle elements are positioned and styled in the dedicated designer, including binding any element to
            live data from another widget in this project.
          </div>
          <button className="cgo-copy-btn" onClick={() => onOpenTemplateDesigner?.(widget.id)}>
            Open Designer
          </button>
        </>
      );

      case 'recent-matches': {
        type ResultVmixTarget = {
          id: string; mode?: 'standalone' | 'linked';
          inputKey?: string; inputTitle?: string;
          teamAPrefix?: string; teamBPrefix?: string;
          shortTeamAPrefix?: string; shortTeamBPrefix?: string;
          datePrefix?: string; timePrefix?: string; roundPrefix?: string;
          linkedWidgetId?: string; linkedListKey?: 'scheduleVmixInputs' | 'nextVmixInputs';
          scoreAPrefix?: string; scoreBPrefix?: string;
          statusFieldPrefix?: string; statusFieldType?: 'text' | 'image'; statusText?: string; statusImage?: string;
          mergedPrefix?: string; mergedParts?: string[]; mergedSeparator?: string;
          autoSync?: boolean;
        };
        const resultTargets: ResultVmixTarget[] = cfg.resultVmixInputs ?? [];
        const setResultTargets = (next: ResultVmixTarget[]) => up({ resultVmixInputs: next });
        const updateResultTarget = (idx: number, patch: Partial<ResultVmixTarget>) =>
          setResultTargets(resultTargets.map((t, i) => i === idx ? { ...t, ...patch } : t));
        const scheduleWidgets = pages.flatMap(p => p.widgets.filter(w => w.type === 'match-schedule'));
        const resultPrefixField = (target: ResultVmixTarget, idx: number, key: keyof ResultVmixTarget, fieldLabel: string, placeholder: string, effectiveInputKey: string) => (
          <Field label={fieldLabel}>
            {renderFieldPicker(
              effectiveInputKey,
              target[key] ? `${target[key]}1.Text` : '',
              v => updateResultTarget(idx, { [key]: v.replace(/\.Text$/i, '').replace(/\d+$/, '') } as Partial<ResultVmixTarget>),
              placeholder,
            )}
          </Field>
        );

        const general = (
          <>
            <SettingsSummary rows={[
              { icon: Hourglass, label: 'Max shown', value: String(cfg.maxResults ?? 8) },
              { icon: Flag, label: 'Team name', value: (cfg.nameDisplay ?? 'short') === 'full' ? 'Full name' : 'Short name' },
              { icon: Square, label: 'Size', value: cfg.compactSize ? 'Compact' : 'Bigger' },
            ]} />
            <Field label="Title">
              <input className="field-input" value={cfg.title ?? ''} placeholder="Latest Results"
                onChange={e => up({ title: e.target.value })} />
            </Field>
            <Field label="Max results shown">
              <input type="number" className="field-input" min={1} max={50} value={cfg.maxResults ?? 8}
                onChange={e => up({ maxResults: Math.max(1, parseInt(e.target.value) || 8) })} />
            </Field>
            <Field label="Group by competition">
              <ToggleCard checked={cfg.groupByCompetition ?? true} onChange={v => up({ groupByCompetition: v })} />
            </Field>
            <Field label="Show date">
              <ToggleCard checked={cfg.showDate ?? true} onChange={v => up({ showDate: v })} />
            </Field>
            <Field label="Team name">
              <CardSelect
                value={cfg.nameDisplay ?? 'short'}
                onChange={v => up({ nameDisplay: v })}
                options={[{ value: 'short', label: 'Short name' }, { value: 'full', label: 'Full name' }]}
              />
            </Field>
            <Field label="Widget size">
              <CardSelect
                value={cfg.compactSize ? 'compact' : 'normal'}
                onChange={v => up({ compactSize: v === 'compact' })}
                options={[{ value: 'normal', label: 'Bigger' }, { value: 'compact', label: 'Compact' }]}
              />
            </Field>
            <Field label="Tournament">
              <CustomBox>
                <select className="field-input" value={cfg.filterTournamentId ?? ''} onChange={e => up({ filterTournamentId: e.target.value })}>
                  <option value="">{pageTournament ? `— Auto: ${pageTournament.name} (this canvas) —` : '— all tournaments —'}</option>
                  {tournaments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </CustomBox>
            </Field>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 2px' }}>
              Results are added from a scoreboard widget's "Save Result" button.
            </div>
          </>
        );

        const vmix = (
          <CollapsibleSection label="vMix Output">
            <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '0 0 6px', lineHeight: 1.4 }}>
                Same one-input/several-numbered-slots push Match Schedule uses, plus Score A/B and a "finished" status field
                (text like "FT", or an image badge — whichever the field you pick is). "Reuse a Schedule widget" points this at
                that widget's own vMix input and team/date/time/round field mapping, so the same graphic slot just gets
                overwritten with the final result — no need to duplicate that mapping by hand. "Own vMix input" is fully standalone.
              </p>
              {resultTargets.map((t, idx) => {
                const collapseKey = `result_vmix_${t.id}`;
                const isCollapsed = vilCollapsed[collapseKey] ?? false;
                const mode = t.mode ?? 'standalone';
                const linkedWidget = scheduleWidgets.find(w => w.id === t.linkedWidgetId);
                const effectiveInputKey = mode === 'linked'
                  ? ((linkedWidget?.config?.[t.linkedListKey ?? 'scheduleVmixInputs'] ?? [])[0]?.inputKey ?? '')
                  : (t.inputKey ?? '');
                return (
                  <div key={t.id} className="vil-cfg-block">
                    <div className="vil-cfg-header">
                      <button className="btn btn--ghost btn--small tf-collapse-btn"
                        onClick={() => setVilCollapsed(p => ({ ...p, [collapseKey]: !p[collapseKey] }))}
                        title={isCollapsed ? 'Expand' : 'Collapse'}>
                        {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                      </button>
                      <span className="vil-cfg-label">vMix Target {idx + 1}</span>
                      {resultTargets.length > 1 && <button className="btn btn--ghost btn--small" onClick={() => setResultTargets(resultTargets.filter((_, i) => i !== idx))}>×</button>}
                    </div>
                    {!isCollapsed && (
                      <>
                        <Field label="Source">
                          <CardSelect
                            value={mode}
                            onChange={v => updateResultTarget(idx, { mode: v })}
                            options={[{ value: 'standalone' as const, label: 'Own vMix input' }, { value: 'linked' as const, label: 'Linked Schedule' }]}
                          />
                        </Field>

                        {mode === 'linked' ? (
                          <>
                            <Field label="Match Schedule widget">
                              <CustomBox>
                                <select className="field-input" value={t.linkedWidgetId ?? ''} onChange={e => updateResultTarget(idx, { linkedWidgetId: e.target.value })}>
                                  <option value="">— select —</option>
                                  {scheduleWidgets.map(w => <option key={w.id} value={w.id}>{w.label || w.config?.title || 'Match Schedule'}</option>)}
                                </select>
                              </CustomBox>
                            </Field>
                            {t.linkedWidgetId && (
                              <Field label="Its target list">
                                <CardSelect
                                  value={t.linkedListKey ?? 'scheduleVmixInputs'}
                                  onChange={v => updateResultTarget(idx, { linkedListKey: v })}
                                  options={[{ value: 'scheduleVmixInputs' as const, label: 'Full Schedule' }, { value: 'nextVmixInputs' as const, label: 'Next Fixture(s)' }]}
                                />
                              </Field>
                            )}
                            {linkedWidget && (
                              <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '0 0 4px' }}>
                                {(linkedWidget.config?.[t.linkedListKey ?? 'scheduleVmixInputs'] ?? [])[0]?.inputKey
                                  ? 'Using that target\'s vMix input and Team A/B, Date, Time, Round field prefixes.'
                                  : 'That widget/list has no vMix input configured yet — set one there first.'}
                              </p>
                            )}
                          </>
                        ) : (
                          renderInputPicker('vMix Input', t.inputKey ?? '', t.inputTitle,
                            (key, title) => updateResultTarget(idx, { inputKey: key, inputTitle: title }),
                          )
                        )}

                        {(mode === 'linked' ? !!t.linkedWidgetId : !!t.inputKey) && (
                          <>
                            {mode === 'standalone' && (
                              <>
                                {resultPrefixField(t, idx, 'teamAPrefix', 'Team A prefix', 'Pick TeamA1.Text → auto-prefix', effectiveInputKey)}
                                {resultPrefixField(t, idx, 'teamBPrefix', 'Team B prefix', 'Pick TeamB1.Text → auto-prefix', effectiveInputKey)}
                                {resultPrefixField(t, idx, 'shortTeamAPrefix', 'Short Name A prefix', 'Pick ShortA1.Text → auto-prefix', effectiveInputKey)}
                                {resultPrefixField(t, idx, 'shortTeamBPrefix', 'Short Name B prefix', 'Pick ShortB1.Text → auto-prefix', effectiveInputKey)}
                                {resultPrefixField(t, idx, 'datePrefix', 'Date prefix', 'Pick Date1.Text → auto-prefix', effectiveInputKey)}
                                {resultPrefixField(t, idx, 'timePrefix', 'Time prefix', 'Pick Time1.Text → auto-prefix', effectiveInputKey)}
                                {resultPrefixField(t, idx, 'roundPrefix', 'Round prefix', 'Pick Round1.Text → auto-prefix', effectiveInputKey)}
                              </>
                            )}
                            {resultPrefixField(t, idx, 'scoreAPrefix', 'Score A prefix', 'Pick ScoreA1.Text → auto-prefix', effectiveInputKey)}
                            {resultPrefixField(t, idx, 'scoreBPrefix', 'Score B prefix', 'Pick ScoreB1.Text → auto-prefix', effectiveInputKey)}

                            <Field label="Status field type">
                              <CardSelect
                                value={t.statusFieldType ?? 'text'}
                                onChange={v => updateResultTarget(idx, { statusFieldType: v })}
                                options={[{ value: 'text' as const, label: 'Text (e.g. "FT")' }, { value: 'image' as const, label: 'Image badge' }]}
                              />
                            </Field>
                            {resultPrefixField(t, idx, 'statusFieldPrefix', 'Status field prefix', 'Pick Status1.Text/.Source → auto-prefix', effectiveInputKey)}
                            {t.statusFieldType === 'image' ? (
                              <Field label="Status image">
                                <LogoUrlPicker value={t.statusImage ?? ''} onChange={url => updateResultTarget(idx, { statusImage: url })} placeholder="Finished badge image URL" />
                              </Field>
                            ) : (
                              <Field label="Status text">
                                <input className="field-input" value={t.statusText ?? 'FT'} placeholder="FT"
                                  onChange={e => updateResultTarget(idx, { statusText: e.target.value })} />
                              </Field>
                            )}

                            <MergeFieldComposer
                              parts={[
                                { key: 'teamA', label: 'Team A', sample: 'Chelsea' },
                                { key: 'teamB', label: 'Team B', sample: 'Arsenal' },
                                { key: 'shortTeamA', label: 'Short Name A', sample: 'CHE' },
                                { key: 'shortTeamB', label: 'Short Name B', sample: 'ARS' },
                                { key: 'scoreA', label: 'Score A', sample: '3' },
                                { key: 'scoreB', label: 'Score B', sample: '1' },
                                { key: 'date', label: 'Date', sample: '2026-08-20' },
                                { key: 'time', label: 'Time', sample: '19:00' },
                                { key: 'round', label: 'Round', sample: 'Round 3' },
                                { key: 'competition', label: 'Competition', sample: 'Premier League' },
                              ]}
                              mergedParts={t.mergedParts ?? []}
                              mergedPrefix={t.mergedPrefix ?? ''}
                              mergedSeparator={t.mergedSeparator ?? ' '}
                              onChange={patch => updateResultTarget(idx, patch as Partial<ResultVmixTarget>)}
                              inputKey={effectiveInputKey}
                              allInputs={allInputs}
                              dragKey={`${widget.id}_result_${t.id}`}
                              indexed
                            />

                            <Field label="Auto-sync on change">
                              <ToggleCard checked={t.autoSync ?? false} onChange={v => updateResultTarget(idx, { autoSync: v })} />
                            </Field>
                          </>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            <button className="btn btn--ghost btn--small" onClick={() => setResultTargets([...resultTargets, { id: crypto.randomUUID(), mode: 'standalone', inputKey: '' }])}>+ Add vMix Target</button>
          </CollapsibleSection>
        );

        return renderTabbed(general, vmix);
      }

      case 'match-schedule': {
        const filterTournament = tournaments.find(t => t.id === (cfg.filterTournamentId || pageTournamentId));
        const filterVenues: string[] = filterTournament?.venues ?? [];
        const filterCategories: string[] = filterTournament?.categories ?? [];
        const filterGroups: string[] = (filterTournament?.groups ?? []).map((g: any) => typeof g === 'string' ? g : g.name);

        // Two independent vMix sync targets — "Full Schedule" pushes every
        // currently-filtered fixture, "Next Fixture(s)" pushes just the next
        // N not-yet-sent ones (N configurable, see the count field below).
        // Each target gets its own set of optional field prefixes (blank =
        // don't push that field), same auto-prefix-from-picked-field trick
        // as the Player List widget's vMix Name Sync section.
        type FixtureVmixTarget = {
          id: string; inputKey: string; inputTitle?: string;
          teamAPrefix?: string; teamBPrefix?: string;
          fullTeamAPrefix?: string; fullTeamBPrefix?: string;
          datePrefix?: string;
          timePrefix?: string; roundPrefix?: string; venuePrefix?: string;
          groupPrefix?: string;
          matchIdPrefix?: string;
          logoAPrefix?: string; logoBPrefix?: string;
          autoSync?: boolean;
          /** Combines any of the fields above into ONE string on a single
           *  field instead of separate ones — order is whatever the operator
           *  dragged mergedParts into. Logos aren't mergeable text. */
          mergedPrefix?: string;
          mergedParts?: FixturePart[];
          mergedSeparator?: string;
        };
        const renderFixtureVmixSection = (configKey: 'scheduleVmixInputs' | 'nextVmixInputs', label: string, extra?: React.ReactNode) => {
          const targets: FixtureVmixTarget[] = cfg[configKey] ?? [];
          const setTargets = (next: FixtureVmixTarget[]) => up({ [configKey]: next });
          const updateTarget = (idx: number, patch: Partial<FixtureVmixTarget>) => setTargets(targets.map((t, i) => i === idx ? { ...t, ...patch } : t));
          const prefixField = (target: FixtureVmixTarget, idx: number, key: keyof FixtureVmixTarget, fieldLabel: string, placeholder: string, suffix: 'Text' | 'Source' = 'Text') => (
            <Field label={fieldLabel}>
              {renderFieldPicker(
                target.inputKey,
                target[key] ? `${target[key]}1.${suffix}` : '',
                v => updateTarget(idx, { [key]: v.replace(new RegExp(`\\.${suffix}$`, 'i'), '').replace(/\d+$/, '') } as Partial<FixtureVmixTarget>),
                placeholder,
                suffix === 'Source' ? (n: string) => n.toLowerCase().endsWith('.source') : undefined,
              )}
            </Field>
          );
          return (
            <CollapsibleSection label={label}>
              {extra}
              {targets.map((t, idx) => {
                const collapseKey = `${configKey}_${t.id}`;
                const isCollapsed = vilCollapsed[collapseKey] ?? false;
                return (
                  <div key={t.id} className="vil-cfg-block">
                    <div className="vil-cfg-header">
                      <button className="btn btn--ghost btn--small tf-collapse-btn"
                        onClick={() => setVilCollapsed(p => ({ ...p, [collapseKey]: !p[collapseKey] }))}
                        title={isCollapsed ? 'Expand' : 'Collapse'}>
                        {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                      </button>
                      <span className="vil-cfg-label">vMix Input {idx + 1}</span>
                      {targets.length > 1 && <button className="btn btn--ghost btn--small" onClick={() => setTargets(targets.filter((_, i) => i !== idx))}>×</button>}
                    </div>
                    {!isCollapsed && renderInputPicker('vMix Input', t.inputKey, t.inputTitle,
                      (key, title) => updateTarget(idx, { inputKey: key, inputTitle: title }),
                    )}
                    {t.inputKey && (
                      <>
                        {prefixField(t, idx, 'teamAPrefix', 'Team A prefix', 'Pick TeamA1.Text → auto-prefix')}
                        {prefixField(t, idx, 'teamBPrefix', 'Team B prefix', 'Pick TeamB1.Text → auto-prefix')}
                        {prefixField(t, idx, 'fullTeamAPrefix', 'Full Name A prefix', 'Pick FullA1.Text → auto-prefix')}
                        {prefixField(t, idx, 'fullTeamBPrefix', 'Full Name B prefix', 'Pick FullB1.Text → auto-prefix')}
                        {prefixField(t, idx, 'datePrefix', 'Date prefix', 'Pick Date1.Text → auto-prefix')}
                        {prefixField(t, idx, 'timePrefix', 'Time prefix', 'Pick Time1.Text → auto-prefix')}
                        {prefixField(t, idx, 'roundPrefix', 'Round prefix', 'Pick Round1.Text → auto-prefix')}
                        {prefixField(t, idx, 'venuePrefix', 'Venue prefix', 'Pick Venue1.Text → auto-prefix')}
                        {prefixField(t, idx, 'groupPrefix', 'Group/Stage prefix', 'Pick Group1.Text → auto-prefix')}
                        {prefixField(t, idx, 'matchIdPrefix', 'Match ID prefix', 'Pick MatchId1.Text → auto-prefix')}
                        {prefixField(t, idx, 'logoAPrefix', 'Logo A prefix', 'Pick LogoA1.Source → auto-prefix', 'Source')}
                        {prefixField(t, idx, 'logoBPrefix', 'Logo B prefix', 'Pick LogoB1.Source → auto-prefix', 'Source')}

                        <MergeFieldComposer
                          parts={FIXTURE_MERGE_PARTS}
                          mergedParts={t.mergedParts ?? []}
                          mergedPrefix={t.mergedPrefix ?? ''}
                          mergedSeparator={t.mergedSeparator ?? ' '}
                          onChange={patch => updateTarget(idx, patch as Partial<FixtureVmixTarget>)}
                          inputKey={t.inputKey}
                          allInputs={allInputs}
                          dragKey={`${configKey}_${t.id}`}
                          fieldLabel="Merged field prefix"
                          indexed
                        />

                        <Field label="Auto-sync on change">
                          <ToggleCard checked={t.autoSync ?? false} onChange={v => updateTarget(idx, { autoSync: v })} />
                        </Field>
                      </>
                    )}
                  </div>
                );
              })}
              <button className="btn btn--ghost btn--small" onClick={() => setTargets([...targets, { id: crypto.randomUUID(), inputKey: '' }])}>+ Add vMix Input</button>
            </CollapsibleSection>
          );
        };

        const general = (
        <>
          <Field label="Title">
            <input className="field-input" value={cfg.title ?? ''} placeholder="Upcoming Matches"
              onChange={e => up({ title: e.target.value })} />
          </Field>
          <Field label="Send To Scoreboard">
            <CustomBox>
              <select className="field-input" value={cfg.linkedScoreboardId ?? ''} onChange={e => up({ linkedScoreboardId: e.target.value })}>
                <option value="">— none —</option>
                {pages.flatMap(p => p.widgets.filter(w => w.type === 'scoreboard')).map(w => (
                  <option key={w.id} value={w.id}>{w.config.name || `Scoreboard (${w.config.teamAName || 'A'} vs ${w.config.teamBName || 'B'})`}</option>
                ))}
              </select>
            </CustomBox>
          </Field>
          <Field label="Tournament">
            <CustomBox>
              <select className="field-input" value={cfg.filterTournamentId ?? ''}
                onChange={e => up({ filterTournamentId: e.target.value, filterVenue: '', filterCategory: '', filterGroup: '' })}>
                <option value="">{pageTournament ? `— Auto: ${pageTournament.name} (this canvas) —` : '— Follow title bar picker —'}</option>
                {tournaments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </CustomBox>
          </Field>
          {filterTournament && (
            <>
              <Field label="Venue">
                <CustomBox>
                  <select className="field-input" value={cfg.filterVenue ?? ''} onChange={e => up({ filterVenue: e.target.value })} disabled={filterVenues.length === 0}>
                    <option value="">All Venues</option>
                    {filterVenues.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </CustomBox>
              </Field>
              <Field label="Category">
                <CustomBox>
                  <select className="field-input" value={cfg.filterCategory ?? ''} onChange={e => up({ filterCategory: e.target.value })} disabled={filterCategories.length === 0}>
                    <option value="">All Categories</option>
                    {filterCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </CustomBox>
              </Field>
              <Field label="Group">
                <CustomBox>
                  <select className="field-input" value={cfg.filterGroup ?? ''} onChange={e => up({ filterGroup: e.target.value })} disabled={filterGroups.length === 0}>
                    <option value="">All Groups</option>
                    {filterGroups.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </CustomBox>
              </Field>
            </>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 2px' }}>
            Manage fixtures in DB → Schedule. Sent matches grey out here automatically.
            {!filterTournament && ' Leave Tournament blank to follow the title bar’s tournament/venue picker instead.'}
          </div>
        </>
        );

        const vmix = (
        <>
          {renderFixtureVmixSection('scheduleVmixInputs', 'vMix Full Schedule Sync',
            <>
              <Field label="Fixtures per page (0 = no limit)">
                <input type="number" min={0} max={50} className="field-input" style={{ width: 60 }}
                  value={cfg.scheduleFixturesPerPage ?? 0}
                  onChange={e => up({ scheduleFixturesPerPage: Math.max(0, parseInt(e.target.value) || 0) })} />
              </Field>
              {(cfg.scheduleFixturesPerPage ?? 0) > 0 && (
                <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '0 0 6px', lineHeight: 1.4 }}>
                  With more than one vMix Input below, fixtures split across them in order — Input 1 gets rows 1-{cfg.scheduleFixturesPerPage},
                  Input 2 gets the next {cfg.scheduleFixturesPerPage}, and so on, each restarting at row 1 as its own "page."
                </p>
              )}
            </>
          )}
          {renderFixtureVmixSection('nextVmixInputs', 'vMix Next Fixture(s) Sync',
            <Field label="How many fixtures">
              <input type="number" min={1} max={20} className="field-input" style={{ width: 60 }}
                value={cfg.nextFixtureCount ?? 1}
                onChange={e => up({ nextFixtureCount: Math.max(1, parseInt(e.target.value) || 1) })} />
            </Field>
          )}
        </>
        );

        return renderTabbed(general, vmix);
      }

      case 'rundown': {
        return renderTabbed(
        <>
          <Field label="Title">
            <input className="field-input" value={cfg.title ?? ''} placeholder="Rundown"
              onChange={e => up({ title: e.target.value })} />
          </Field>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 2px' }}>
            Manage segments in DB → Rundown. A Rundown spans the whole event
            day, not just this canvas's tournament — every Rundown widget
            shows the same shared list.
          </div>
        </>
      );
      }

      case 'standings': {
        const filterTournament = tournaments.find(t => t.id === (cfg.filterTournamentId || pageTournamentId));
        const filterCategories: string[] = filterTournament?.categories ?? [];
        return renderTabbed(
        <>
          <Field label="Title">
            <input className="field-input" value={cfg.title ?? ''} placeholder="Standings"
              onChange={e => up({ title: e.target.value })} />
          </Field>
          <Field label="Tournament">
            <CustomBox>
              <select className="field-input" value={cfg.filterTournamentId ?? ''}
                onChange={e => up({ filterTournamentId: e.target.value, filterCategory: '' })}>
                <option value="">{pageTournament ? `— Auto: ${pageTournament.name} (this canvas) —` : '— pick tournament —'}</option>
                {tournaments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </CustomBox>
          </Field>
          {filterCategories.length > 0 && (
            <Field label="Category">
              <CustomBox>
                <select className="field-input" value={cfg.filterCategory ?? ''} onChange={e => up({ filterCategory: e.target.value })}>
                  <option value="">All Categories</option>
                  {filterCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </CustomBox>
            </Field>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 2px' }}>
            Read-only — manage groups/teams in DB → Standings.
          </div>
        </>
      );
      }

      case 'bracket': {
        const filterTournamentId = cfg.filterTournamentId || pageTournamentId;
        const filterTournament = tournaments.find(t => t.id === filterTournamentId);
        const filterCategories: string[] = filterTournament?.categories ?? [];
        const bracketPrefixField = (key: string, fieldLabel: string, placeholder: string, suffix: 'Text' | 'Source' = 'Text') => (
          <Field label={fieldLabel}>
            {renderFieldPicker(
              cfg.vmixInputKey ?? '',
              cfg[key] ? `${cfg[key]}1.${suffix}` : '',
              v => up({ [key]: v.replace(new RegExp(`\\.${suffix}$`, 'i'), '').replace(/\d+$/, '') }),
              placeholder,
              suffix === 'Source' ? (n: string) => n.toLowerCase().endsWith('.source') : undefined,
              allInputs,
            )}
          </Field>
        );
        // Tier ("Cup"/"Plate"/"Bowl"/"Shield"…) has no static list on
        // Tournament the way categories do — derived live from whichever
        // knockout fixtures actually exist for this tournament+category,
        // same as BracketPanel/BracketWidget do to decide what to show.
        const effCat = (m: ScheduledMatch): string | undefined =>
          m.category ?? (m.round?.includes(' · ') ? m.round.split(' · ')[0] : undefined);
        // A shared Quarterfinal's combined label ("Cup/Plate") is excluded
        // here — not a selectable tier itself, its matches just get picked
        // up whenever either paired tier is selected (see BracketWidget).
        const filterTiers: string[] = Array.from(new Set(
          allMatches
            .filter(m => m.tournamentId === filterTournamentId
              && (filterCategories.length === 0 || effCat(m) === (cfg.filterCategory ?? ''))
              && !!extractKnockoutStage(m))
            .map(m => m.tier)
            .filter((t): t is string => !!t && !t.includes('/'))
        ));
        const general = (
        <>
          <Field label="Tournament">
            <CustomBox>
              <select className="field-input" value={cfg.filterTournamentId ?? ''}
                onChange={e => up({ filterTournamentId: e.target.value, filterCategory: '', filterTier: '' })}>
                <option value="">{pageTournament ? `— Auto: ${pageTournament.name} (this canvas) —` : '— pick tournament —'}</option>
                {tournaments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </CustomBox>
          </Field>
          {filterCategories.length > 0 && (
            <Field label="Category">
              <CustomBox>
                <select className="field-input" value={cfg.filterCategory ?? ''} onChange={e => up({ filterCategory: e.target.value, filterTier: '' })}>
                  <option value="">— pick category —</option>
                  {filterCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </CustomBox>
            </Field>
          )}
          {filterTiers.length > 0 && (
            <Field label="Tier">
              <CustomBox>
                <select className="field-input" value={cfg.filterTier ?? ''} onChange={e => up({ filterTier: e.target.value })}>
                  <option value="">— pick tier —</option>
                  {filterTiers.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </CustomBox>
            </Field>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 2px' }}>
            Read-only display — edit bracket arrangement in DB → Bracket. A category must be picked once the tournament has any; same for tier on a Cup/Plate/Bowl/Shield tournament.
          </div>
        </>
        );

        const vmix = (
          <CollapsibleSection label="vMix Output">
            <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '0 0 6px' }}>
              One input, one row per match (Stage1.Text, Stage2.Text, ...) in bracket order — earliest round first, 3rd Place Playoff (if any) last. Sent whenever a result changes.
            </p>
            <Field label="vMix Input">
              {renderInputPicker('bracket_input', cfg.vmixInputKey ?? '', cfg.vmixInputTitle,
                (key, title) => up({ vmixInputKey: key, vmixInputTitle: title }), undefined, allInputs)}
            </Field>
            {cfg.vmixInputKey && (
              <>
                <Field label="Auto-sync on change">
                  <ToggleCard checked={cfg.vmixAutoSync === true} onChange={v => up({ vmixAutoSync: v })} />
                </Field>
                {bracketPrefixField('stagePrefix', 'Stage/Round prefix', 'Pick Stage1.Text → auto-prefix')}
                {bracketPrefixField('teamAPrefix', 'Team A prefix', 'Pick TeamA1.Text → auto-prefix')}
                {bracketPrefixField('teamBPrefix', 'Team B prefix', 'Pick TeamB1.Text → auto-prefix')}
                {bracketPrefixField('fullTeamAPrefix', 'Full Name A prefix', 'Pick FullA1.Text → auto-prefix')}
                {bracketPrefixField('fullTeamBPrefix', 'Full Name B prefix', 'Pick FullB1.Text → auto-prefix')}
                {bracketPrefixField('scoreAPrefix', 'Score A prefix', 'Pick ScoreA1.Text → auto-prefix')}
                {bracketPrefixField('scoreBPrefix', 'Score B prefix', 'Pick ScoreB1.Text → auto-prefix')}
                {bracketPrefixField('winnerPrefix', 'Winner (A/B) prefix', 'Pick Winner1.Text → auto-prefix')}
                {bracketPrefixField('logoAPrefix', 'Logo A prefix', 'Pick LogoA1.Source → auto-prefix', 'Source')}
                {bracketPrefixField('logoBPrefix', 'Logo B prefix', 'Pick LogoB1.Source → auto-prefix', 'Source')}
                <MergeFieldComposer
                  parts={BRACKET_MERGE_PARTS}
                  mergedParts={cfg.mergedParts ?? []}
                  mergedPrefix={cfg.mergedPrefix ?? ''}
                  mergedSeparator={cfg.mergedSeparator ?? ' '}
                  onChange={patch => up(patch)}
                  inputKey={cfg.vmixInputKey}
                  allInputs={allInputs}
                  dragKey={`${widget.id}_bracket`}
                  fieldLabel="Merged field prefix"
                  indexed
                />
              </>
            )}
          </CollapsibleSection>
        );

        return renderTabbed(general, vmix);
      }

      case 'team-form': {
        const linkedSb = cfg.linkedScoreboardId
          ? pages.flatMap(p => p.widgets).find(w => w.id === cfg.linkedScoreboardId)
          : null;
        const teamAName = linkedSb?.config.teamAName ?? 'Team A';
        const teamBName = linkedSb?.config.teamBName ?? 'Team B';
        const general = (
          <>
            <Field label="Linked Scoreboard">
              <CustomBox>
                <select className="field-input" value={cfg.linkedScoreboardId ?? ''} onChange={e => up({ linkedScoreboardId: e.target.value })}>
                  <option value="">— select scoreboard —</option>
                  {pages.flatMap(p => p.widgets.filter(w => w.type === 'scoreboard')).map(w => (
                    <option key={w.id} value={w.id}>{w.config.teamAName ?? 'Team A'} vs {w.config.teamBName ?? 'Team B'}</option>
                  ))}
                </select>
              </CustomBox>
            </Field>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 2px' }}>
              Shows each team's recent results and upcoming fixtures, round by round — same data as the Scoreboard widget's own Head-to-Head panel.
            </div>
            <CollapsibleSection label="Win / Loss / Draw Style">
              <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '0 0 6px' }}>
                Shared by both teams' Form Indicator fields below — text, a color (vMix SetColor), and/or an image per outcome. Leave any of the three blank to skip that mechanism entirely.
              </p>
              {([['formWinText', 'formWinColor', 'formWinImage', 'Win', 'W', '#2ecc71'],
                 ['formLossText', 'formLossColor', 'formLossImage', 'Loss', 'L', '#e74c3c'],
                 ['formDrawText', 'formDrawColor', 'formDrawImage', 'Draw', 'D', '#95a5a6']] as const)
                .map(([textKey, colorKey, imageKey, label, defaultText, defaultColor]) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', width: 34, flexShrink: 0 }}>{label}</span>
                  <input className="field-input" style={{ width: 44 }} maxLength={8} placeholder={defaultText}
                    value={cfg[textKey] ?? ''} onChange={e => up({ [textKey]: e.target.value })} />
                  <input type="color" style={{ width: 28, height: 24, flexShrink: 0, padding: 0, border: 'none' }}
                    value={cfg[colorKey] ?? defaultColor} onChange={e => up({ [colorKey]: e.target.value })} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <LogoUrlPicker value={cfg[imageKey] ?? ''} onChange={url => up({ [imageKey]: url })} placeholder={`${label} image URL (optional)`} />
                  </div>
                </div>
              ))}
            </CollapsibleSection>
          </>
        );

        const vmix = (
          <>
            <CollapsibleSection label={`vMix Output — ${teamAName}`}>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '0 0 6px' }}>
                Each field gets every row for that section joined with " | ", sent whenever the data changes.
              </p>
              <Field label="Results Input">
                {renderInputPicker('tf_ra_input', cfg.vmixResultsAInputKey ?? '', cfg.vmixResultsAInputTitle,
                  (key, title) => up({ vmixResultsAInputKey: key, vmixResultsAInputTitle: title }), undefined, allInputs)}
              </Field>
              {cfg.vmixResultsAInputKey && (
                <>
                  <Field label="Results Field">
                    {renderFieldPicker(cfg.vmixResultsAInputKey, cfg.vmixResultsAField ?? '', v => up({ vmixResultsAField: v }), 'Title.Text', undefined, allInputs)}
                  </Field>
                  <Field label="Form Text prefix">
                    {renderFieldPicker(cfg.vmixResultsAInputKey, cfg.formTextPrefixA ? `${cfg.formTextPrefixA}1.Text` : '',
                      v => up({ formTextPrefixA: v.replace(/\.Text$/i, '').replace(/\d+$/, '') }), 'Pick FormA1.Text → auto-prefix', undefined, allInputs)}
                  </Field>
                  <Field label="Form Color layer prefix">
                    {renderFieldPicker(cfg.vmixResultsAInputKey, cfg.formColorPrefixA ? `${cfg.formColorPrefixA}1` : '',
                      v => up({ formColorPrefixA: v.replace(/\d+$/, '') }), 'Pick a shape/box layer → auto-prefix', undefined, allInputs)}
                  </Field>
                  <Field label="Form Image prefix">
                    {renderFieldPicker(cfg.vmixResultsAInputKey, cfg.formImagePrefixA ? `${cfg.formImagePrefixA}1.Source` : '',
                      v => up({ formImagePrefixA: v.replace(/\.Source$/i, '').replace(/\d+$/, '') }), 'Pick FormImgA1.Source → auto-prefix',
                      (n: string) => n.toLowerCase().endsWith('.source'), allInputs)}
                  </Field>
                </>
              )}
              <Field label="Upcoming Input">
                {renderInputPicker('tf_ua_input', cfg.vmixUpcomingAInputKey ?? '', cfg.vmixUpcomingAInputTitle,
                  (key, title) => up({ vmixUpcomingAInputKey: key, vmixUpcomingAInputTitle: title }), undefined, allInputs)}
              </Field>
              {cfg.vmixUpcomingAInputKey && (
                <Field label="Upcoming Field">
                  {renderFieldPicker(cfg.vmixUpcomingAInputKey, cfg.vmixUpcomingAField ?? '', v => up({ vmixUpcomingAField: v }), 'Title.Text', undefined, allInputs)}
                </Field>
              )}
            </CollapsibleSection>
            <CollapsibleSection label={`vMix Output — ${teamBName}`}>
              <Field label="Results Input">
                {renderInputPicker('tf_rb_input', cfg.vmixResultsBInputKey ?? '', cfg.vmixResultsBInputTitle,
                  (key, title) => up({ vmixResultsBInputKey: key, vmixResultsBInputTitle: title }), undefined, allInputs)}
              </Field>
              {cfg.vmixResultsBInputKey && (
                <>
                  <Field label="Results Field">
                    {renderFieldPicker(cfg.vmixResultsBInputKey, cfg.vmixResultsBField ?? '', v => up({ vmixResultsBField: v }), 'Title.Text', undefined, allInputs)}
                  </Field>
                  <Field label="Form Text prefix">
                    {renderFieldPicker(cfg.vmixResultsBInputKey, cfg.formTextPrefixB ? `${cfg.formTextPrefixB}1.Text` : '',
                      v => up({ formTextPrefixB: v.replace(/\.Text$/i, '').replace(/\d+$/, '') }), 'Pick FormB1.Text → auto-prefix', undefined, allInputs)}
                  </Field>
                  <Field label="Form Color layer prefix">
                    {renderFieldPicker(cfg.vmixResultsBInputKey, cfg.formColorPrefixB ? `${cfg.formColorPrefixB}1` : '',
                      v => up({ formColorPrefixB: v.replace(/\d+$/, '') }), 'Pick a shape/box layer → auto-prefix', undefined, allInputs)}
                  </Field>
                  <Field label="Form Image prefix">
                    {renderFieldPicker(cfg.vmixResultsBInputKey, cfg.formImagePrefixB ? `${cfg.formImagePrefixB}1.Source` : '',
                      v => up({ formImagePrefixB: v.replace(/\.Source$/i, '').replace(/\d+$/, '') }), 'Pick FormImgB1.Source → auto-prefix',
                      (n: string) => n.toLowerCase().endsWith('.source'), allInputs)}
                  </Field>
                </>
              )}
              <Field label="Upcoming Input">
                {renderInputPicker('tf_ub_input', cfg.vmixUpcomingBInputKey ?? '', cfg.vmixUpcomingBInputTitle,
                  (key, title) => up({ vmixUpcomingBInputKey: key, vmixUpcomingBInputTitle: title }), undefined, allInputs)}
              </Field>
              {cfg.vmixUpcomingBInputKey && (
                <Field label="Upcoming Field">
                  {renderFieldPicker(cfg.vmixUpcomingBInputKey, cfg.vmixUpcomingBField ?? '', v => up({ vmixUpcomingBField: v }), 'Title.Text', undefined, allInputs)}
                </Field>
              )}
            </CollapsibleSection>
          </>
        );

        return renderTabbed(general, vmix);
      }

      case 'player-h2h': {
        const linkedSb = cfg.linkedScoreboardId
          ? pages.flatMap(p => p.widgets).find(w => w.id === cfg.linkedScoreboardId)
          : null;
        const sbCfg = linkedSb?.config ?? {};
        const teamAName = sbCfg.teamAName ?? 'Team A';
        const teamBName = sbCfg.teamBName ?? 'Team B';
        const general = (
          <>
            <Field label="Linked Scoreboard">
              <CustomBox>
                <select className="field-input" value={cfg.linkedScoreboardId ?? ''}
                  onChange={e => up({ linkedScoreboardId: e.target.value, playerAId: '', playerBId: '' })}>
                  <option value="">— select scoreboard —</option>
                  {pages.flatMap(p => p.widgets.filter(w => w.type === 'scoreboard')).map(w => (
                    <option key={w.id} value={w.id}>{w.config.teamAName ?? 'Team A'} vs {w.config.teamBName ?? 'Team B'}</option>
                  ))}
                </select>
              </CustomBox>
            </Field>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 2px' }}>
              Which two players are compared is picked on the widget itself, not here — that's a frequent live choice, not a one-time setup step.
            </div>
          </>
        );

        const vmix = (
          <>
            <CollapsibleSection label="vMix Output">
              <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '0 0 6px' }}>
                One input, one field per data point per player — sent whenever either player's data changes.
              </p>
              <Field label="vMix Input">
                {renderInputPicker('ph2h_input', cfg.vmixInputKey ?? '', cfg.vmixInputTitle,
                  (key, title) => up({ vmixInputKey: key, vmixInputTitle: title }), undefined, allInputs)}
              </Field>
              {cfg.vmixInputKey && (
                <>
                  <div className="wgt-cfg-subheading">{teamAName}</div>
                  <Field label="Name Field">{renderFieldPicker(cfg.vmixInputKey, cfg.fieldNameA ?? '', v => up({ fieldNameA: v }), 'Title.Text', undefined, allInputs)}</Field>
                  <Field label="Jersey Field">{renderFieldPicker(cfg.vmixInputKey, cfg.fieldJerseyA ?? '', v => up({ fieldJerseyA: v }), 'Title.Text', undefined, allInputs)}</Field>
                  <Field label="Position Field">{renderFieldPicker(cfg.vmixInputKey, cfg.fieldPositionA ?? '', v => up({ fieldPositionA: v }), 'Title.Text', undefined, allInputs)}</Field>
                  <Field label="Team Logo Field">{renderFieldPicker(cfg.vmixInputKey, cfg.fieldTeamLogoA ?? '', v => up({ fieldTeamLogoA: v }), 'TeamA.Source', n => n.toLowerCase().endsWith('.source'), allInputs)}</Field>
                  {PLAYER_STAT_FIELD_DEFS.map(f => (
                    <Field key={f.key} label={`${f.label} Field`}>
                      {renderFieldPicker(cfg.vmixInputKey, cfg[`field${f.cap}A`] ?? '', v => up({ [`field${f.cap}A`]: v }), 'Title.Text', undefined, allInputs)}
                    </Field>
                  ))}
                  <MergeFieldComposer
                    parts={playerMergeParts('John Smith', '9', 'Scrum Half')}
                    mergedParts={cfg.mergedAParts ?? []}
                    mergedPrefix={cfg.mergedAPrefix ?? ''}
                    mergedSeparator={cfg.mergedASeparator ?? ' '}
                    onChange={patch => up({
                      ...(patch.mergedParts !== undefined ? { mergedAParts: patch.mergedParts } : {}),
                      ...(patch.mergedPrefix !== undefined ? { mergedAPrefix: patch.mergedPrefix } : {}),
                      ...(patch.mergedSeparator !== undefined ? { mergedASeparator: patch.mergedSeparator } : {}),
                    })}
                    inputKey={cfg.vmixInputKey}
                    allInputs={allInputs}
                    dragKey={`${widget.id}_h2h_a`}
                    fieldLabel={`${teamAName} merged field`}
                  />
                  <div className="wgt-cfg-subheading">{teamBName}</div>
                  <Field label="Name Field">{renderFieldPicker(cfg.vmixInputKey, cfg.fieldNameB ?? '', v => up({ fieldNameB: v }), 'Title.Text', undefined, allInputs)}</Field>
                  <Field label="Jersey Field">{renderFieldPicker(cfg.vmixInputKey, cfg.fieldJerseyB ?? '', v => up({ fieldJerseyB: v }), 'Title.Text', undefined, allInputs)}</Field>
                  <Field label="Position Field">{renderFieldPicker(cfg.vmixInputKey, cfg.fieldPositionB ?? '', v => up({ fieldPositionB: v }), 'Title.Text', undefined, allInputs)}</Field>
                  <Field label="Team Logo Field">{renderFieldPicker(cfg.vmixInputKey, cfg.fieldTeamLogoB ?? '', v => up({ fieldTeamLogoB: v }), 'TeamB.Source', n => n.toLowerCase().endsWith('.source'), allInputs)}</Field>
                  {PLAYER_STAT_FIELD_DEFS.map(f => (
                    <Field key={f.key} label={`${f.label} Field`}>
                      {renderFieldPicker(cfg.vmixInputKey, cfg[`field${f.cap}B`] ?? '', v => up({ [`field${f.cap}B`]: v }), 'Title.Text', undefined, allInputs)}
                    </Field>
                  ))}
                  <MergeFieldComposer
                    parts={playerMergeParts('Mike Jones', '10', 'Fly Half')}
                    mergedParts={cfg.mergedBParts ?? []}
                    mergedPrefix={cfg.mergedBPrefix ?? ''}
                    mergedSeparator={cfg.mergedBSeparator ?? ' '}
                    onChange={patch => up({
                      ...(patch.mergedParts !== undefined ? { mergedBParts: patch.mergedParts } : {}),
                      ...(patch.mergedPrefix !== undefined ? { mergedBPrefix: patch.mergedPrefix } : {}),
                      ...(patch.mergedSeparator !== undefined ? { mergedBSeparator: patch.mergedSeparator } : {}),
                    })}
                    inputKey={cfg.vmixInputKey}
                    allInputs={allInputs}
                    dragKey={`${widget.id}_h2h_b`}
                    fieldLabel={`${teamBName} merged field`}
                  />
                </>
              )}
            </CollapsibleSection>
            <CollapsibleSection label="Overlay">
              <Field label="Overlay Channel">
                <CardSelect
                  value={cfg.overlayChannel ?? 1}
                  onChange={v => up({ overlayChannel: v })}
                  columns={4}
                  options={[1, 2, 3, 4].map(n => ({ value: n, label: `Overlay ${n}` }))}
                />
              </Field>
            </CollapsibleSection>
          </>
        );

        return renderTabbed(general, vmix);
      }

      case 'player-stats': {
        const general = (
          <>
            <Field label="Linked Scoreboard">
              <CustomBox>
                <select className="field-input" value={cfg.linkedScoreboardId ?? ''}
                  onChange={e => up({ linkedScoreboardId: e.target.value, playerId: '' })}>
                  <option value="">— select scoreboard —</option>
                  {pages.flatMap(p => p.widgets.filter(w => w.type === 'scoreboard')).map(w => (
                    <option key={w.id} value={w.id}>{w.config.teamAName ?? 'Team A'} vs {w.config.teamBName ?? 'Team B'}</option>
                  ))}
                </select>
              </CustomBox>
            </Field>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 2px' }}>
              Team (Home/Away) and Player are picked on the widget itself, not here — that's a frequent live choice, not a one-time setup step.
            </div>
          </>
        );

        const vmix = (
          <>
            <CollapsibleSection label="vMix Output">
              <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '0 0 6px' }}>
                One input, one field per data point — sent whenever the player's data changes.
              </p>
              <Field label="vMix Input">
                {renderInputPicker('pstat_input', cfg.vmixInputKey ?? '', cfg.vmixInputTitle,
                  (key, title) => up({ vmixInputKey: key, vmixInputTitle: title }), undefined, allInputs)}
              </Field>
              {cfg.vmixInputKey && (
                <>
                  <Field label="Auto-sync on change">
                    <ToggleCard checked={cfg.vmixAutoSync === true} onChange={v => up({ vmixAutoSync: v })} />
                  </Field>
                  <Field label="Name Field">{renderFieldPicker(cfg.vmixInputKey, cfg.fieldName ?? '', v => up({ fieldName: v }), 'Title.Text', undefined, allInputs)}</Field>
                  <Field label="Jersey Field">{renderFieldPicker(cfg.vmixInputKey, cfg.fieldJersey ?? '', v => up({ fieldJersey: v }), 'Title.Text', undefined, allInputs)}</Field>
                  <Field label="Position Field">{renderFieldPicker(cfg.vmixInputKey, cfg.fieldPosition ?? '', v => up({ fieldPosition: v }), 'Title.Text', undefined, allInputs)}</Field>
                  <Field label="Team Field">{renderFieldPicker(cfg.vmixInputKey, cfg.fieldTeam ?? '', v => up({ fieldTeam: v }), 'Title.Text', undefined, allInputs)}</Field>
                  <Field label="Team Logo Field">
                    {renderFieldPicker(cfg.vmixInputKey, cfg.fieldTeamLogo ?? '', v => up({ fieldTeamLogo: v }), 'TeamLogo.Source', n => n.toLowerCase().endsWith('.source'), allInputs)}
                  </Field>
                  {PLAYER_STAT_FIELD_DEFS.map(f => (
                    <Field key={f.key} label={`${f.label} Field`}>
                      {renderFieldPicker(cfg.vmixInputKey, cfg[`field${f.cap}`] ?? '', v => up({ [`field${f.cap}`]: v }), 'Title.Text', undefined, allInputs)}
                    </Field>
                  ))}
                  <MergeFieldComposer
                    parts={[...playerMergeParts('John Smith', '9', 'Scrum Half'), { key: 'team', label: 'Team', sample: 'Chelsea' }]}
                    mergedParts={cfg.mergedParts ?? []}
                    mergedPrefix={cfg.mergedPrefix ?? ''}
                    mergedSeparator={cfg.mergedSeparator ?? ' '}
                    onChange={patch => up(patch)}
                    inputKey={cfg.vmixInputKey}
                    allInputs={allInputs}
                    dragKey={`${widget.id}_pstat`}
                  />
                </>
              )}
            </CollapsibleSection>
            <CollapsibleSection label="Overlay">
              <Field label="Overlay Channel">
                <CardSelect
                  value={cfg.overlayChannel ?? 1}
                  onChange={v => up({ overlayChannel: v })}
                  columns={4}
                  options={[1, 2, 3, 4].map(n => ({ value: n, label: `Overlay ${n}` }))}
                />
              </Field>
            </CollapsibleSection>
          </>
        );

        return renderTabbed(general, vmix);
      }

      case 'player-highlight': {
        const general = (
          <>
            <Field label="Linked Scoreboard">
              <CustomBox>
                <select className="field-input" value={cfg.linkedScoreboardId ?? ''}
                  onChange={e => up({ linkedScoreboardId: e.target.value, playerId: '' })}>
                  <option value="">— select scoreboard —</option>
                  {pages.flatMap(p => p.widgets.filter(w => w.type === 'scoreboard')).map(w => (
                    <option key={w.id} value={w.id}>{w.config.teamAName ?? 'Team A'} vs {w.config.teamBName ?? 'Team B'}</option>
                  ))}
                </select>
              </CustomBox>
            </Field>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 2px' }}>
              Title (MVP, Best Player, etc.), Team (Home/Away) and Player are all picked on the widget itself, not here — frequent live choices, not one-time setup steps.
            </div>
          </>
        );

        const vmix = (
          <>
            <CollapsibleSection label="vMix Output">
              <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '0 0 6px' }}>
                One input, one field per data point — sent whenever the highlighted player or title changes.
              </p>
              <Field label="vMix Input">
                {renderInputPicker('phl_input', cfg.vmixInputKey ?? '', cfg.vmixInputTitle,
                  (key, title) => up({ vmixInputKey: key, vmixInputTitle: title }), undefined, allInputs)}
              </Field>
              {cfg.vmixInputKey && (
                <>
                  <Field label="Auto-sync on change">
                    <ToggleCard checked={cfg.vmixAutoSync === true} onChange={v => up({ vmixAutoSync: v })} />
                  </Field>
                  <Field label="Title Field">{renderFieldPicker(cfg.vmixInputKey, cfg.fieldTitle ?? '', v => up({ fieldTitle: v }), 'Title.Text', undefined, allInputs)}</Field>
                  <Field label="Name Field">{renderFieldPicker(cfg.vmixInputKey, cfg.fieldName ?? '', v => up({ fieldName: v }), 'Title.Text', undefined, allInputs)}</Field>
                  <Field label="Jersey Field">{renderFieldPicker(cfg.vmixInputKey, cfg.fieldJersey ?? '', v => up({ fieldJersey: v }), 'Title.Text', undefined, allInputs)}</Field>
                  <Field label="Position Field">{renderFieldPicker(cfg.vmixInputKey, cfg.fieldPosition ?? '', v => up({ fieldPosition: v }), 'Title.Text', undefined, allInputs)}</Field>
                  <Field label="Team Field">{renderFieldPicker(cfg.vmixInputKey, cfg.fieldTeam ?? '', v => up({ fieldTeam: v }), 'Title.Text', undefined, allInputs)}</Field>
                  <Field label="Team Logo Field">
                    {renderFieldPicker(cfg.vmixInputKey, cfg.fieldTeamLogo ?? '', v => up({ fieldTeamLogo: v }), 'TeamLogo.Source', n => n.toLowerCase().endsWith('.source'), allInputs)}
                  </Field>
                  {PLAYER_STAT_FIELD_DEFS.map(f => (
                    <Field key={f.key} label={`${f.label} Field`}>
                      {renderFieldPicker(cfg.vmixInputKey, cfg[`field${f.cap}`] ?? '', v => up({ [`field${f.cap}`]: v }), 'Title.Text', undefined, allInputs)}
                    </Field>
                  ))}
                  <MergeFieldComposer
                    parts={[
                      { key: 'title', label: 'Title', sample: cfg.highlightTitle || 'MVP' },
                      ...playerMergeParts('John Smith', '9', 'Scrum Half'),
                      { key: 'team', label: 'Team', sample: 'Chelsea' },
                    ]}
                    mergedParts={cfg.mergedParts ?? []}
                    mergedPrefix={cfg.mergedPrefix ?? ''}
                    mergedSeparator={cfg.mergedSeparator ?? ' '}
                    onChange={patch => up(patch)}
                    inputKey={cfg.vmixInputKey}
                    allInputs={allInputs}
                    dragKey={`${widget.id}_phl`}
                  />
                </>
              )}
            </CollapsibleSection>
          </>
        );

        return renderTabbed(general, vmix);
      }

      case 'group-standings': {
        const prefixField = (key: string, fieldLabel: string, placeholder: string, suffix: 'Text' | 'Source' = 'Text') => (
          <Field label={fieldLabel}>
            {renderFieldPicker(
              cfg.vmixInputKey ?? '',
              cfg[key] ? `${cfg[key]}1.${suffix}` : '',
              v => up({ [key]: v.replace(new RegExp(`\\.${suffix}$`, 'i'), '').replace(/\d+$/, '') }),
              placeholder,
              suffix === 'Source' ? (n: string) => n.toLowerCase().endsWith('.source') : undefined,
              allInputs,
            )}
          </Field>
        );
        const general = (
          <>
            <Field label="Linked Scoreboard">
              <CustomBox>
                <select className="field-input" value={cfg.linkedScoreboardId ?? ''}
                  onChange={e => up({ linkedScoreboardId: e.target.value })}>
                  <option value="">— select scoreboard —</option>
                  {pages.flatMap(p => p.widgets.filter(w => w.type === 'scoreboard')).map(w => (
                    <option key={w.id} value={w.id}>{w.config.teamAName ?? 'Team A'} vs {w.config.teamBName ?? 'Team B'}</option>
                  ))}
                </select>
              </CustomBox>
            </Field>
            <Field label="Title">
              <input className="field-input" value={cfg.title ?? ''} placeholder="Standings"
                onChange={e => up({ title: e.target.value })} />
            </Field>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 2px' }}>
              Which group shows here follows the linked scoreboard's current teams automatically — no separate group picker needed.
            </div>
          </>
        );

        const vmix = (
          <>
            <CollapsibleSection label="vMix Output">
              <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '0 0 6px' }}>
                One input, one row per team (Rank1.Text, Rank2.Text, ...) — sent whenever the group's standings change.
              </p>
              <Field label="vMix Input">
                {renderInputPicker('gs_input', cfg.vmixInputKey ?? '', cfg.vmixInputTitle,
                  (key, title) => up({ vmixInputKey: key, vmixInputTitle: title }), undefined, allInputs)}
              </Field>
              {cfg.vmixInputKey && (
                <>
                  <Field label="Auto-sync on change">
                    <ToggleCard checked={cfg.vmixAutoSync === true} onChange={v => up({ vmixAutoSync: v })} />
                  </Field>
                  <Field label="Group/Pool Name field">
                    {renderFieldPicker(cfg.vmixInputKey ?? '', cfg.groupField ?? '', v => up({ groupField: v }), 'Group.Text')}
                  </Field>
                  <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '-4px 0 4px' }}>
                    One value for the whole table (e.g. "Pool A") — not indexed per row like the fields below.
                  </p>
                  {prefixField('rankPrefix', 'Rank prefix', 'Pick Rank1.Text → auto-prefix')}
                  {prefixField('teamPrefix', 'Team prefix', 'Pick Team1.Text → auto-prefix')}
                  {prefixField('shortTeamPrefix', 'Short Name prefix', 'Pick Short1.Text → auto-prefix')}
                  {prefixField('playedPrefix', 'Played prefix', 'Pick Played1.Text → auto-prefix')}
                  {prefixField('wonPrefix', 'Won prefix', 'Pick Won1.Text → auto-prefix')}
                  {prefixField('drawnPrefix', 'Drawn prefix', 'Pick Drawn1.Text → auto-prefix')}
                  {prefixField('lostPrefix', 'Lost prefix', 'Pick Lost1.Text → auto-prefix')}
                  {prefixField('pfPrefix', 'Points For prefix', 'Pick PF1.Text → auto-prefix')}
                  {prefixField('paPrefix', 'Points Against prefix', 'Pick PA1.Text → auto-prefix')}
                  {prefixField('diffPrefix', 'Diff prefix', 'Pick Diff1.Text → auto-prefix')}
                  {prefixField('ptsPrefix', 'Points prefix', 'Pick Pts1.Text → auto-prefix')}
                  {prefixField('logoPrefix', 'Logo prefix', 'Pick Logo1.Source → auto-prefix', 'Source')}
                  <MergeFieldComposer
                    parts={GROUP_STANDINGS_MERGE_PARTS}
                    mergedParts={cfg.mergedParts ?? []}
                    mergedPrefix={cfg.mergedPrefix ?? ''}
                    mergedSeparator={cfg.mergedSeparator ?? ' '}
                    onChange={patch => up(patch)}
                    inputKey={cfg.vmixInputKey}
                    allInputs={allInputs}
                    dragKey={`${widget.id}_gs`}
                    fieldLabel="Merged field prefix"
                    indexed
                  />
                </>
              )}
            </CollapsibleSection>
          </>
        );

        return renderTabbed(general, vmix);
      }

      case 'input-tally': return renderTabbed(
        <>
          <Field label="Show Title">
            <ToggleCard checked={cfg.showTitle !== false} onChange={v => up({ showTitle: v })} />
          </Field>
          <Field label="Show Type">
            <ToggleCard checked={cfg.showType !== false} onChange={v => up({ showType: v })} />
          </Field>
        </>,
        renderInputPicker(
          'Input',
          cfg.inputKey ?? '',
          cfg.inputTitle,
          (key, title) => up({ inputKey: key, inputTitle: title }),
          undefined,
          allInputs,
        )
      );

      case 'transitions': return renderTabbed(
        <>
          <Field label="Buttons">
            <div className="tm-ms-duration-grid" style={{ gridTemplateColumns: `repeat(${TRANS_KEYS.length + 1}, 1fr)` }}>
              {TRANS_KEYS.map(key => {
                const current: string[] = cfg.buttons ?? ['cut', 'fade', 'auto'];
                const active = current.includes(key);
                return (
                  <button key={key} type="button"
                    className={`tm-ms-sport-card${active ? ' tm-ms-sport-card--active' : ''}`}
                    onClick={() => up({ buttons: active ? current.filter(k => k !== key) : [...current, key] })}>
                    <span className="tm-ms-sport-card-name">{key.toUpperCase()}</span>
                  </button>
                );
              })}
              <button type="button"
                className={`tm-ms-sport-card${(cfg.buttons ?? ['cut', 'fade', 'auto']).length === 0 ? ' tm-ms-sport-card--active' : ''}`}
                onClick={() => up({ buttons: [] })}>
                <span className="tm-ms-sport-card-name">None</span>
              </button>
            </div>
          </Field>
        </>
      );

      case 'score-log': {
        const linkedSb = cfg.linkedScoreboardId
          ? pages.flatMap(p => p.widgets).find(w => w.id === cfg.linkedScoreboardId)
          : null;
        const teamAName = linkedSb?.config.teamAName ?? 'Team A';
        const teamBName = linkedSb?.config.teamBName ?? 'Team B';
        const teamAColor = linkedSb?.config.teamAColor ?? '#e74c3c';
        const teamBColor = linkedSb?.config.teamBColor ?? '#3498db';
        const general = (
          <>
            <Field label="Linked Scoreboard">
              <CustomBox>
                <select className="field-input" value={cfg.linkedScoreboardId ?? ''} onChange={e => up({ linkedScoreboardId: e.target.value })}>
                  <option value="">— select scoreboard —</option>
                  {pages.flatMap(p => p.widgets.filter(w => w.type === 'scoreboard')).map(w => (
                    <option key={w.id} value={w.id}>{w.config.teamAName ?? 'Team A'} vs {w.config.teamBName ?? 'Team B'}</option>
                  ))}
                </select>
              </CustomBox>
            </Field>
            <Field label="Show team">
              <div className="team-side-picker">
                {(['A', 'all', 'B'] as const).map(t => (
                  <button
                    key={t}
                    className={`team-side-btn ${(cfg.teamFilter ?? 'all') === t ? 'team-side-btn--active' : ''}`}
                    style={t !== 'all' ? { '--tc': t === 'A' ? teamAColor : teamBColor } as React.CSSProperties : undefined}
                    onClick={() => up({ teamFilter: t })}
                  >
                    {t === 'A' && <span className="team-side-dot" style={{ background: teamAColor }} />}
                    {t === 'B' && <span className="team-side-dot" style={{ background: teamBColor }} />}
                    {t === 'A' ? teamAName : t === 'B' ? teamBName : 'All'}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Player Highlight Widget">
              <CustomBox>
                <select className="field-input" value={cfg.linkedPlayerHighlightId ?? ''} onChange={e => up({ linkedPlayerHighlightId: e.target.value })}>
                  <option value="">— none —</option>
                  {pages.flatMap(p => p.widgets).filter(w => w.type === 'player-lower-third').map(w => (
                    <option key={w.id} value={w.id}>Player Highlight {w.id.slice(0, 6)}</option>
                  ))}
                </select>
              </CustomBox>
            </Field>
          </>
        );

        const vmix = (
          <>
            <CollapsibleSection label="vMix Summary Output">
              <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '0 0 6px' }}>
                Sends a per-player score summary (jersey · name: count×action pts) to a vMix text field whenever the log changes.
              </p>
              <Field label="vMix Input">
                {renderInputPicker('sl_sum_input', cfg.vmixSummaryInputKey ?? '', cfg.vmixSummaryInputTitle,
                  (key, title) => up({ vmixSummaryInputKey: key, vmixSummaryInputTitle: title }),
                  undefined,
                  allInputs)}
              </Field>
              {cfg.vmixSummaryInputKey && (
                <Field label="Text Field">
                  {renderFieldPicker(cfg.vmixSummaryInputKey, cfg.vmixSummaryField ?? '', v => up({ vmixSummaryField: v }), 'Title.Text', undefined, allInputs)}
                </Field>
              )}
            </CollapsibleSection>
          </>
        );

        return renderTabbed(general, vmix);
      }

      case 'timeline': return renderTabbed(
        <>
          <Field label="Title">
            <input className="field-input" value={cfg.title ?? 'Match Timeline'} onChange={e => up({ title: e.target.value })} />
          </Field>
          <Field label="Linked Timer">
            <CustomBox>
              <select className="field-input" value={cfg.linkedTimerWidgetId ?? ''} onChange={e => up({ linkedTimerWidgetId: e.target.value })}>
                <option value="">— wall clock —</option>
                {pages.flatMap(p => p.widgets.filter(w => w.type === 'timer')).map(w => (
                  <option key={w.id} value={w.id}>{w.config.name || 'Timer'}</option>
                ))}
              </select>
            </CustomBox>
          </Field>
          <Field label="Linked Scoreboard">
            <CustomBox>
              <select className="field-input" value={cfg.linkedScoreboardId ?? ''} onChange={e => up({ linkedScoreboardId: e.target.value })}>
                <option value="">— none —</option>
                {pages.flatMap(p => p.widgets.filter(w => w.type === 'scoreboard')).map(w => (
                  <option key={w.id} value={w.id}>{w.config.teamAName ?? 'Team A'} vs {w.config.teamBName ?? 'Team B'}</option>
                ))}
              </select>
            </CustomBox>
          </Field>

          <CollapsibleSection label="Appearance">
            <Field label="Show team header">
              <label className="toggle-row">
                <ToggleCard checked={cfg.showTeamHeader ?? true} onChange={v => up({ showTeamHeader: v })} />
                <span>Show team names bar</span>
              </label>
            </Field>
            <Field label="Background">
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="color" value={cfg.bgColor || '#1a1a2e'} onChange={e => up({ bgColor: e.target.value })} style={{ width: 32, height: 28, border: 'none', cursor: 'pointer', background: 'none' }} />
                <button className="btn btn--small" onClick={() => up({ bgColor: '' })}>Clear</button>
              </div>
            </Field>
          </CollapsibleSection>

          <CollapsibleSection label="Font Sizes (px)">
            <Field label="Event label">
              <input type="number" className="field-input" min={6} max={32} value={cfg.fontSizeEvent ?? 11} onChange={e => up({ fontSizeEvent: +e.target.value })} />
            </Field>
            <Field label="Time bubble">
              <input type="number" className="field-input" min={6} max={32} value={cfg.fontSizeTime ?? 10} onChange={e => up({ fontSizeTime: +e.target.value })} />
            </Field>
            <Field label="Team names">
              <input type="number" className="field-input" min={6} max={32} value={cfg.fontSizeTeam ?? 11} onChange={e => up({ fontSizeTeam: +e.target.value })} />
            </Field>
            <Field label="Player name">
              <input type="number" className="field-input" min={6} max={32} value={cfg.fontSizePlayer ?? 10} onChange={e => up({ fontSizePlayer: +e.target.value })} />
            </Field>
          </CollapsibleSection>

          <CollapsibleSection label="Layout">
            <Field label="Row height (px)">
              <input type="number" className="field-input" min={20} max={120} value={cfg.rowMinHeight ?? 48} onChange={e => up({ rowMinHeight: +e.target.value })} />
            </Field>
            <Field label="Spine width (px)">
              <input type="number" className="field-input" min={0} max={8} value={cfg.spineWidth ?? 1} onChange={e => up({ spineWidth: +e.target.value })} />
            </Field>
            <Field label="Spine color">
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="color" value={cfg.spineColor || '#2a2a3e'} onChange={e => up({ spineColor: e.target.value })} style={{ width: 32, height: 28, border: 'none', cursor: 'pointer', background: 'none' }} />
                <button className="btn btn--small" onClick={() => up({ spineColor: '' })}>Default</button>
              </div>
            </Field>
          </CollapsibleSection>

          <CollapsibleSection label="Time Bubble">
            <Field label="Height (px)">
              <input type="number" className="field-input" min={16} max={64} value={cfg.bubbleHeight ?? 24} onChange={e => up({ bubbleHeight: +e.target.value })} />
            </Field>
            <Field label="Background">
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="color" value={cfg.bubbleBg || '#3498db'} onChange={e => up({ bubbleBg: e.target.value })} style={{ width: 32, height: 28, border: 'none', cursor: 'pointer', background: 'none' }} />
                <button className="btn btn--small" onClick={() => up({ bubbleBg: '' })}>Default</button>
              </div>
            </Field>
            <Field label="Text color">
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="color" value={cfg.bubbleTextColor || '#ffffff'} onChange={e => up({ bubbleTextColor: e.target.value })} style={{ width: 32, height: 28, border: 'none', cursor: 'pointer', background: 'none' }} />
                <button className="btn btn--small" onClick={() => up({ bubbleTextColor: '' })}>Default</button>
              </div>
            </Field>
          </CollapsibleSection>

          <CollapsibleSection label="Data">
            <Field label="Clear events">
              <button className="btn btn--danger btn--small" onClick={() => { if (confirm('Clear all manual events?')) up({ events: [] }); }}>
                Clear manual events
              </button>
            </Field>
          </CollapsibleSection>
        </>
      );

      case 'player-list':
      case 'player-list-next': {
        const isNextMatch = widget.type === 'player-list-next';
        const timerWidgets = pages.flatMap(p => p.widgets.filter(w => w.type === 'timer'));
        const timelineWidgets = pages.flatMap(p => p.widgets.filter(w => w.type === 'timeline'));
        const scoreboardWidgets = pages.flatMap(p => p.widgets.filter(w => w.type === 'scoreboard'));
        const effLinkedTournamentId = cfg.linkedTournamentId || pageTournamentId;
        const scopedTeams = effLinkedTournamentId
          ? teamDbTeams.filter(t => t.tournamentId === effLinkedTournamentId)
          : teamDbTeams;
        const nextMatchTournament = tournaments.find(t => t.id === effLinkedTournamentId);
        const nextMatchVenues: string[] = nextMatchTournament?.venues ?? [];
        const nextMatchCategories: string[] = nextMatchTournament?.categories ?? [];
        const dualLayout = isNextMatch || (!!cfg.linkedScoreboardId && cfg.layout === 'side-by-side');

        // Renders the per-side sections (vMix Team Title / Name Sync / Staff
        // Names / Session Data) reading & writing every field through keyPrefix
        // — '' for a single-team widget (byte-identical field names to before
        // this widget supported more than one team), 'a_'/'b_' for side-by-side
        // or Next Match so each side's squad/vMix targets stay independent.
        const renderPlayerPanelConfig = (keyPrefix: string, heading?: string) => {
          const pk = (f: string) => keyPrefix + f;
          const pup = (patch: Record<string, any>) => {
            const prefixed: Record<string, any> = {};
            for (const key of Object.keys(patch)) prefixed[pk(key)] = patch[key];
            up(prefixed);
          };
          const hasPlaytime = Object.keys(cfg[pk('accumulated')] ?? {}).length > 0 || (cfg[pk('onField')] ?? []).length > 0;
          const body = (
            <>
              <CollapsibleSection label="vMix Team Title">
                {renderInputPicker('vMix Input', cfg[pk('vmixTeamInputKey')] ?? '', cfg[pk('vmixTeamInputTitle')],
                  (key, title) => pup({ vmixTeamInputKey: key, vmixTeamInputTitle: title }),
                )}
                {cfg[pk('vmixTeamInputKey')] && (
                  <>
                    <Field label="Team name field">
                      {renderFieldPicker(cfg[pk('vmixTeamInputKey')] ?? '', cfg[pk('vmixTeamFieldName')] ?? 'TeamName.Text', v => pup({ vmixTeamFieldName: v }), 'Title.Text')}
                    </Field>
                    <Field label="Short name field">
                      {renderFieldPicker(cfg[pk('vmixTeamInputKey')] ?? '', cfg[pk('vmixTeamFieldShort')] ?? '', v => pup({ vmixTeamFieldShort: v }), 'Title.Text')}
                    </Field>
                    <MergeFieldComposer
                      parts={[
                        { key: 'name', label: 'Team Name', sample: 'Chelsea' },
                        { key: 'short', label: 'Short Name', sample: 'CHE' },
                      ]}
                      mergedParts={cfg[pk('vmixTeamMergedParts')] ?? []}
                      mergedPrefix={cfg[pk('vmixTeamMergedPrefix')] ?? ''}
                      mergedSeparator={cfg[pk('vmixTeamMergedSeparator')] ?? ' '}
                      onChange={patch => pup({
                        ...(patch.mergedParts !== undefined ? { vmixTeamMergedParts: patch.mergedParts } : {}),
                        ...(patch.mergedPrefix !== undefined ? { vmixTeamMergedPrefix: patch.mergedPrefix } : {}),
                        ...(patch.mergedSeparator !== undefined ? { vmixTeamMergedSeparator: patch.mergedSeparator } : {}),
                      })}
                      inputKey={cfg[pk('vmixTeamInputKey')] ?? ''}
                      allInputs={allInputs}
                      dragKey={`${widget.id}_${keyPrefix}_teamtitle`}
                    />
                    <Field label="Auto-sync on change">
                      <ToggleCard checked={cfg[pk('vmixTeamAutoSync')] ?? false} onChange={v => pup({ vmixTeamAutoSync: v })} />
                    </Field>
                  </>
                )}
              </CollapsibleSection>
              <CollapsibleSection label="vMix Name Sync">
              {(() => {
                type PlInput = { id: string; inputKey: string; inputTitle?: string; vmixNamePrefix: string; vmixJerseyPrefix: string; vmixAutoSync: boolean };
                const plInputs: PlInput[] = cfg[pk('vmixInputs')]?.length
                  ? cfg[pk('vmixInputs')]
                  : cfg[pk('vmixInputKey')]
                    ? [{ id: 'legacy', inputKey: cfg[pk('vmixInputKey')], vmixNamePrefix: cfg[pk('vmixNamePrefix')] ?? 'Name', vmixJerseyPrefix: cfg[pk('vmixJerseyPrefix')] ?? '', vmixAutoSync: cfg[pk('vmixAutoSync')] ?? false }]
                    : [];
                const setPlInputs = (next: PlInput[]) => pup({ vmixInputs: next });
                const updatePl = (idx: number, patch: Partial<PlInput>) => setPlInputs(plInputs.map((p, i) => i === idx ? { ...p, ...patch } : p));
                return (
                  <>
                    {plInputs.map((inp, idx) => {
                      const vilKey = pk(inp.id);
                      const isVilCollapsed = vilCollapsed[vilKey] ?? false;
                      return (
                      <div key={inp.id} className="vil-cfg-block">
                        <div className="vil-cfg-header">
                          <button className="btn btn--ghost btn--small tf-collapse-btn"
                            onClick={() => setVilCollapsed(p => ({ ...p, [vilKey]: !p[vilKey] }))}
                            title={isVilCollapsed ? 'Expand' : 'Collapse'}>
                            {isVilCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                          </button>
                          <span className="vil-cfg-label">vMix Input {idx + 1}</span>
                          {plInputs.length > 1 && <button className="btn btn--ghost btn--small" onClick={() => setPlInputs(plInputs.filter((_, i) => i !== idx))}>×</button>}
                        </div>
                        {!isVilCollapsed && (<>
                          {renderInputPicker('vMix Input', inp.inputKey, inp.inputTitle,
                            (key, title) => updatePl(idx, { inputKey: key, inputTitle: title }),
                            undefined, allInputs,
                          )}
                        </>)}
                        {inp.inputKey && (
                          <>
                            <Field label="Name prefix">
                              {renderFieldPicker(
                                inp.inputKey,
                                inp.vmixNamePrefix ? `${inp.vmixNamePrefix}1.Text` : '',
                                (v) => updatePl(idx, { vmixNamePrefix: v.replace(/\.Text$/i, '').replace(/\d+$/, '') }),
                                'Pick Name1.Text → auto-prefix',
                                undefined, allInputs,
                              )}
                            </Field>
                            <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '-4px 0 4px' }}>
                              Follows App Settings → Simple Names automatically when that's turned on.
                            </p>
                            <Field label="Jersey No prefix">
                              {renderFieldPicker(
                                inp.inputKey,
                                inp.vmixJerseyPrefix ? `${inp.vmixJerseyPrefix}1.Text` : '',
                                (v) => updatePl(idx, { vmixJerseyPrefix: v.replace(/\.Text$/i, '').replace(/\d+$/, '') }),
                                'Pick Jersey1.Text → auto-prefix',
                                undefined, allInputs,
                              )}
                            </Field>
                            <Field label="Auto-sync on edit">
                              <ToggleCard checked={inp.vmixAutoSync} onChange={v => updatePl(idx, { vmixAutoSync: v })} />
                            </Field>
                          </>
                        )}
                      </div>
                      );
                    })}
                    <button className="btn btn--ghost btn--small" onClick={() => setPlInputs([...plInputs, { id: crypto.randomUUID(), inputKey: '', vmixNamePrefix: 'Name', vmixJerseyPrefix: '', vmixAutoSync: false }])}>+ Add vMix Input</button>
                  </>
                );
              })()}
              </CollapsibleSection>
              <CollapsibleSection label="vMix Staff Names">
                <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '0 0 6px' }}>
                  Sends Manager (MNG) and Head Coach (HC) names to vMix text fields.
                </p>
                <Field label="vMix Input">
                  {renderInputPicker('vmix_staff_input', cfg[pk('vmixStaffInputKey')] ?? '', cfg[pk('vmixStaffInputTitle')],
                    (key, title) => pup({ vmixStaffInputKey: key, vmixStaffInputTitle: title }))}
                </Field>
                {cfg[pk('vmixStaffInputKey')] && (
                  <>
                    <Field label="Manager field">
                      {renderFieldPicker(cfg[pk('vmixStaffInputKey')], cfg[pk('vmixManagerField')] ?? '', v => pup({ vmixManagerField: v }), 'Title.Text')}
                    </Field>
                    <Field label="Head Coach field">
                      {renderFieldPicker(cfg[pk('vmixStaffInputKey')], cfg[pk('vmixHCField')] ?? '', v => pup({ vmixHCField: v }), 'Title.Text')}
                    </Field>
                    <MergeFieldComposer
                      parts={[
                        { key: 'manager', label: 'Manager', sample: 'Alex Ferguson' },
                        { key: 'headCoach', label: 'Head Coach', sample: 'Sam Carter' },
                      ]}
                      mergedParts={cfg[pk('vmixStaffMergedParts')] ?? []}
                      mergedPrefix={cfg[pk('vmixStaffMergedPrefix')] ?? ''}
                      mergedSeparator={cfg[pk('vmixStaffMergedSeparator')] ?? ' '}
                      onChange={patch => pup({
                        ...(patch.mergedParts !== undefined ? { vmixStaffMergedParts: patch.mergedParts } : {}),
                        ...(patch.mergedPrefix !== undefined ? { vmixStaffMergedPrefix: patch.mergedPrefix } : {}),
                        ...(patch.mergedSeparator !== undefined ? { vmixStaffMergedSeparator: patch.mergedSeparator } : {}),
                      })}
                      inputKey={cfg[pk('vmixStaffInputKey')] ?? ''}
                      allInputs={allInputs}
                      dragKey={`${widget.id}_${keyPrefix}_staff`}
                    />
                    <Field label="Auto-sync on edit">
                      <ToggleCard checked={cfg[pk('vmixStaffAutoSync')] ?? false} onChange={v => pup({ vmixStaffAutoSync: v })} />
                    </Field>
                  </>
                )}
              </CollapsibleSection>
              {hasPlaytime && (
                <CollapsibleSection label="Session Data">
                  <Field label="Reset playtime">
                    <button className="btn btn--danger btn--small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                      onClick={() => { if (confirm('Reset all playtime data?')) pup({ onField: [], entries: {}, accumulated: {} }); }}>
                      <RotateCcw size={12} strokeWidth={2} /> Clear session
                    </button>
                  </Field>
                </CollapsibleSection>
              )}
            </>
          );
          return heading ? <CollapsibleSection label={heading}>{body}</CollapsibleSection> : body;
        };

        return (
          <>
            <SettingsSummary rows={[
              { icon: Users, label: 'Layout', value: dualLayout ? 'Both teams' : 'One side' },
              { icon: Square, label: 'Size', value: (cfg.viewSize ?? 'normal')[0].toUpperCase() + (cfg.viewSize ?? 'normal').slice(1) },
              { icon: Star, label: 'Stats', value: cfg.showStats ? 'Shown' : 'Hidden' },
            ]} />
            <Field label="Tournament">
              <CustomBox>
                <select className="field-input" value={cfg.linkedTournamentId ?? ''} onChange={e => up({ linkedTournamentId: e.target.value })}>
                  <option value="">{pageTournament ? `— Auto: ${pageTournament.name} (this canvas) —` : '— select tournament (for periods/settings) —'}</option>
                  {tournaments.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </CustomBox>
            </Field>

            {isNextMatch ? (
              <>
                <Field label="Venue">
                  <CustomBox>
                    <select className="field-input" value={cfg.filterVenue ?? ''} onChange={e => up({ filterVenue: e.target.value })} disabled={nextMatchVenues.length === 0}>
                      <option value="">All Venues</option>
                      {nextMatchVenues.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </CustomBox>
                </Field>
                <Field label="Category">
                  <CustomBox>
                    <select className="field-input" value={cfg.filterCategory ?? ''} onChange={e => up({ filterCategory: e.target.value })} disabled={nextMatchCategories.length === 0}>
                      <option value="">All Categories</option>
                      {nextMatchCategories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </CustomBox>
                </Field>
              </>
            ) : (
              <>
                <Field label="Link Scoreboard">
                  <CustomBox>
                    <select className="field-input" value={cfg.linkedScoreboardId ?? ''} onChange={e => up({ linkedScoreboardId: e.target.value })}>
                      <option value="">— none (pick team directly) —</option>
                      {scoreboardWidgets.map(w => (
                        <option key={w.id} value={w.id}>{w.config.name || `Scoreboard (${w.config.teamAName || 'A'} vs ${w.config.teamBName || 'B'})`}</option>
                      ))}
                    </select>
                  </CustomBox>
                </Field>
                {cfg.linkedScoreboardId ? (
                  <>
                    <Field label="Layout">
                      <CardSelect
                        value={cfg.layout ?? 'single'}
                        onChange={v => up({ layout: v })}
                        options={[{ value: 'single', label: 'Follow one side' }, { value: 'side-by-side', label: 'Both sides' }]}
                      />
                    </Field>
                    {(cfg.layout ?? 'single') !== 'side-by-side' && (
                      <Field label="Team Side">
                        <CardSelect
                          value={cfg.teamSide ?? 'A'}
                          onChange={v => up({ teamSide: v })}
                          options={[{ value: 'A', label: 'Team A' }, { value: 'B', label: 'Team B' }]}
                        />
                      </Field>
                    )}
                  </>
                ) : (
                  <Field label="Team">
                    <CustomBox>
                      <select className="field-input" value={cfg.linkedTeamId ?? ''} onChange={e => up({ linkedTeamId: e.target.value })}>
                        <option value="">— select team —</option>
                        {scopedTeams.map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </CustomBox>
                  </Field>
                )}
              </>
            )}

            <Field label="Player Highlight Widget">
              <CustomBox>
                <select className="field-input" value={cfg.linkedPlayerHighlightId ?? ''} onChange={e => up({ linkedPlayerHighlightId: e.target.value })}>
                  <option value="">— none —</option>
                  {pages.flatMap(p => p.widgets).filter(w => w.type === 'player-lower-third').map(w => (
                    <option key={w.id} value={w.id}>Player Highlight {w.id.slice(0, 6)}</option>
                  ))}
                </select>
              </CustomBox>
            </Field>
            <Field label="Linked Timer">
              <CustomBox>
                <select className="field-input" value={cfg.linkedTimerWidgetId ?? ''} onChange={e => up({ linkedTimerWidgetId: e.target.value })}>
                  <option value="">— none —</option>
                  {timerWidgets.map(w => <option key={w.id} value={w.id}>{w.config.name || 'Timer'}</option>)}
                </select>
              </CustomBox>
            </Field>
            <Field label="Linked Timeline (for auto-log)">
              <CustomBox>
                <select className="field-input" value={cfg.linkedTimelineId ?? ''} onChange={e => up({ linkedTimelineId: e.target.value })}>
                  <option value="">— none —</option>
                  {timelineWidgets.map(w => <option key={w.id} value={w.id}>{w.config.title || 'Timeline'}</option>)}
                </select>
              </CustomBox>
            </Field>

            {dualLayout ? (
              <>
                {renderPlayerPanelConfig('a_', 'Team A')}
                {renderPlayerPanelConfig('b_', 'Team B')}
              </>
            ) : renderPlayerPanelConfig('')}

            <CollapsibleSection label="Display">
            <Field label="Show time played">
              <ToggleCard checked={cfg.showTime !== false} onChange={v => up({ showTime: v })} />
            </Field>
            <Field label="Show sin bin timer">
              <ToggleCard checked={cfg.showSinBinTimer !== false} onChange={v => up({ showSinBinTimer: v })} />
            </Field>
            <Field label="Show position">
              <ToggleCard checked={cfg.showPosition !== false} onChange={v => up({ showPosition: v })} />
            </Field>
            <Field label="Show card buttons">
              <ToggleCard checked={cfg.showCards !== false} onChange={v => up({ showCards: v })} />
            </Field>
            <Field label="Show player stats (T/C/P/DG/YC/RC/APP)">
              <ToggleCard checked={cfg.showStats === true} onChange={v => up({ showStats: v })} />
            </Field>
            <Field label="Widget size">
              <CardSelect
                value={cfg.viewSize ?? 'normal'}
                onChange={v => up({ viewSize: v })}
                columns={3}
                options={[
                  { value: 'compact', label: 'Compact', icon: Minimize },
                  { value: 'normal', label: 'Normal', icon: Square },
                  { value: 'large', label: 'Large', icon: Maximize },
                ]}
              />
            </Field>
            <Field label="Sin bin duration (min)">
              <input
                className="field-input"
                type="number"
                min={1} max={30} step={1}
                value={Math.round((cfg.sinBinDuration ?? 600000) / 60000)}
                onChange={e => up({ sinBinDuration: Number(e.target.value) * 60000 })}
              />
            </Field>
            </CollapsibleSection>
          </>
        );
      }

      case 'substitution': {
        const allPlayerListWidgets = pages.flatMap(p => p.widgets.filter(w => w.type === 'player-list'));
        const scoreboardWidgetsForSub = pages.flatMap(p => p.widgets.filter(w => w.type === 'scoreboard'));
        const timerWidgets2 = pages.flatMap(p => p.widgets.filter(w => w.type === 'timer'));
        const timelineWidgets2 = pages.flatMap(p => p.widgets.filter(w => w.type === 'timeline'));
        const plLabel2 = (w: { id: string; config: Record<string, any> }) => plWidgetLabel(w, teamDbTeams);
        // Each Quick Sub widget is single-team — add a second widget with
        // the other Team Side for the rest. Same Scoreboard-first pairing
        // Rugby Lineup uses: linking a Scoreboard resolves the team AND its
        // Player List automatically; Player List below only matters as a
        // manual override (or the sole way in, for a standalone widget with
        // no Scoreboard on the page).
        const general = (
          <>
            <Field label="Link Scoreboard">
              <CustomBox>
                <select className="field-input" value={cfg.linkedScoreboardId ?? ''} onChange={e => up({ linkedScoreboardId: e.target.value })}>
                  <option value="">— none (pick Player List directly below) —</option>
                  {scoreboardWidgetsForSub.map(w => (
                    <option key={w.id} value={w.id}>{w.config.name || `Scoreboard (${w.config.teamAName || 'A'} vs ${w.config.teamBName || 'B'})`}</option>
                  ))}
                </select>
              </CustomBox>
            </Field>
            <Field label="Team Side">
              <CardSelect
                value={cfg.teamSide ?? 'A'}
                onChange={v => up({ teamSide: v })}
                options={[
                  { value: 'A', label: cfg.linkedScoreboardId ? (scoreboardWidgetsForSub.find(w => w.id === cfg.linkedScoreboardId)?.config.teamAName || 'Team A') : 'Team A' },
                  { value: 'B', label: cfg.linkedScoreboardId ? (scoreboardWidgetsForSub.find(w => w.id === cfg.linkedScoreboardId)?.config.teamBName || 'Team B') : 'Team B' },
                ]}
              />
            </Field>
            <span className="field-hint" style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginTop: -4, marginBottom: 4 }}>
              {cfg.linkedScoreboardId
                ? 'Team and this side\'s Player List follow the scoreboard automatically. Player List below only matters as a manual override.'
                : 'No scoreboard linked — pick a Player List directly below.'}
            </span>
            <Field label="Player List">
              <CustomBox>
                <select className="field-input" value={cfg.linkedPlayerListId ?? ''} onChange={e => up({ linkedPlayerListId: e.target.value })}>
                  <option value="">— auto (follow scoreboard / page) —</option>
                  {allPlayerListWidgets.map(w => <option key={w.id} value={w.id}>{plLabel2(w)}</option>)}
                </select>
              </CustomBox>
            </Field>
            <Field label="Linked Timer">
              <CustomBox>
                <select className="field-input" value={cfg.linkedTimerWidgetId ?? ''} onChange={e => up({ linkedTimerWidgetId: e.target.value })}>
                  <option value="">— none —</option>
                  {timerWidgets2.map(w => <option key={w.id} value={w.id}>{w.config.name || 'Timer'}</option>)}
                </select>
              </CustomBox>
            </Field>
            <Field label="Linked Timeline">
              <CustomBox>
                <select className="field-input" value={cfg.linkedTimelineId ?? ''} onChange={e => up({ linkedTimelineId: e.target.value })}>
                  <option value="">— none —</option>
                  {timelineWidgets2.map(w => <option key={w.id} value={w.id}>{w.config.title || 'Timeline'}</option>)}
                </select>
              </CustomBox>
            </Field>
          </>
        );

        const vmix = (
          <>
            <CollapsibleSection label="vMix Sub Overlay">
              <Field label="Overlay Channel">
                <CardSelect
                  value={cfg.overlayChannel ?? 1}
                  onChange={v => up({ overlayChannel: v })}
                  columns={4}
                  options={[1, 2, 3, 4].map(n => ({ value: n, label: `Overlay ${n}` }))}
                />
              </Field>
            {(() => {
              type SubInput = { id: string; inputKey: string; inputTitle?: string; vmixFieldOut: string; vmixFieldIn: string; vmixFieldJerseyOut?: string; vmixFieldJerseyIn?: string; vmixFieldLogo?: string; mergedPrefix?: string; mergedParts?: string[]; mergedSeparator?: string };
              const subInputs: SubInput[] = cfg.vmixInputs?.length
                ? cfg.vmixInputs
                : cfg.vmixInputKey
                  ? [{ id: 'legacy', inputKey: cfg.vmixInputKey, vmixFieldOut: cfg.vmixFieldOut ?? 'PlayerOff.Text', vmixFieldIn: cfg.vmixFieldIn ?? 'PlayerOn.Text' }]
                  : [];
              const setSubInputs = (next: SubInput[]) => up({ vmixInputs: next });
              const updateSub = (idx: number, patch: Partial<SubInput>) => setSubInputs(subInputs.map((s, i) => i === idx ? { ...s, ...patch } : s));
              return (
                <>
                  {subInputs.map((inp, idx) => {
                    const isVilCollapsed = vilCollapsed[inp.id] ?? false;
                    return (
                    <div key={inp.id} className="vil-cfg-block">
                      <div className="vil-cfg-header">
                        <button className="btn btn--ghost btn--small tf-collapse-btn"
                          onClick={() => setVilCollapsed(p => ({ ...p, [inp.id]: !p[inp.id] }))}
                          title={isVilCollapsed ? 'Expand' : 'Collapse'}>
                          {isVilCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                        </button>
                        <span className="vil-cfg-label">vMix Input {idx + 1}</span>
                        {subInputs.length > 1 && <button className="btn btn--ghost btn--small" onClick={() => setSubInputs(subInputs.filter((_, i) => i !== idx))}>×</button>}
                      </div>
                      {!isVilCollapsed && (<>
                      {renderInputPicker('vMix Input', inp.inputKey, inp.inputTitle,
                        (key, title) => updateSub(idx, { inputKey: key, inputTitle: title }),
                        undefined, allInputs,
                      )}
                      {inp.inputKey && (
                        <>
                          <Field label="Player Off field">
                            {renderFieldPicker(inp.inputKey, inp.vmixFieldOut, v => updateSub(idx, { vmixFieldOut: v }), 'Title.Text', undefined, allInputs)}
                          </Field>
                          <Field label="Player Off jersey field">
                            {renderFieldPicker(inp.inputKey, inp.vmixFieldJerseyOut ?? '', v => updateSub(idx, { vmixFieldJerseyOut: v }), 'JerseyOff.Text', undefined, allInputs)}
                          </Field>
                          <Field label="Player On field">
                            {renderFieldPicker(inp.inputKey, inp.vmixFieldIn, v => updateSub(idx, { vmixFieldIn: v }), 'Title.Text', undefined, allInputs)}
                          </Field>
                          <Field label="Player On jersey field">
                            {renderFieldPicker(inp.inputKey, inp.vmixFieldJerseyIn ?? '', v => updateSub(idx, { vmixFieldJerseyIn: v }), 'JerseyOn.Text', undefined, allInputs)}
                          </Field>
                          <Field label="Team Logo field">
                            {renderFieldPicker(inp.inputKey, inp.vmixFieldLogo ?? '', v => updateSub(idx, { vmixFieldLogo: v }), 'Team.Source', n => n.toLowerCase().endsWith('.source'), allInputs)}
                          </Field>
                          <MergeFieldComposer
                            parts={[
                              { key: 'out', label: 'Player Off', sample: 'John Smith' },
                              { key: 'in', label: 'Player On', sample: 'Mike Jones' },
                              { key: 'jerseyOut', label: 'Jersey Off', sample: '7' },
                              { key: 'jerseyIn', label: 'Jersey On', sample: '14' },
                            ]}
                            mergedParts={inp.mergedParts ?? []}
                            mergedPrefix={inp.mergedPrefix ?? ''}
                            mergedSeparator={inp.mergedSeparator ?? ' '}
                            onChange={patch => updateSub(idx, patch as Partial<SubInput>)}
                            inputKey={inp.inputKey}
                            allInputs={allInputs}
                            dragKey={`${widget.id}_sub_${inp.id}`}
                          />
                        </>
                      )}
                      </>)}
                    </div>
                    );
                  })}
                  <button className="btn btn--ghost btn--small" onClick={() => setSubInputs([...subInputs, { id: crypto.randomUUID(), inputKey: '', vmixFieldOut: 'PlayerOff.Text', vmixFieldIn: 'PlayerOn.Text' }])}>+ Add vMix Input</button>
                </>
              );
            })()}
            </CollapsibleSection>
          </>
        );

        return renderTabbed(general, vmix);
      }

      case 'card-display': {
        const playerListWidgets = pages.flatMap(p => p.widgets.filter(w => w.type === 'player-list'));
        const plLabel = (w: { id: string; config: Record<string, any> }) => plWidgetLabel(w, teamDbTeams);
        const general = (
          <>
            <Field label="Team A — Player List">
              <CustomBox>
                <select className="field-input" value={cfg.linkedPlayerListA ?? ''} onChange={e => up({ linkedPlayerListA: e.target.value })}>
                  <option value="">— select —</option>
                  {playerListWidgets.map(w => <option key={w.id} value={w.id}>{plLabel(w)}</option>)}
                </select>
              </CustomBox>
            </Field>
            <Field label="Team B — Player List">
              <CustomBox>
                <select className="field-input" value={cfg.linkedPlayerListB ?? ''} onChange={e => up({ linkedPlayerListB: e.target.value })}>
                  <option value="">— select —</option>
                  {playerListWidgets.map(w => <option key={w.id} value={w.id}>{plLabel(w)}</option>)}
                </select>
              </CustomBox>
            </Field>
            <Field label="Show player names">
              <ToggleCard checked={cfg.showNames !== false} onChange={v => up({ showNames: v })} />
            </Field>
          </>
        );

        const vmix = (
          <>
            <CollapsibleSection label="vMix Title Sync">
            {(() => {
              type CdInput = {
                id: string; inputKey: string; inputTitle?: string; vmixFieldSinBinA: string; vmixFieldSinBinB: string; vmixFieldRedA: string; vmixFieldRedB: string;
                vmixFieldLogoA?: string; vmixFieldLogoB?: string;
                mergedPrefix?: string; mergedParts?: string[]; mergedSeparator?: string;
              };
              const cdInputs: CdInput[] = cfg.vmixInputs?.length
                ? cfg.vmixInputs
                : cfg.vmixInputKey
                  ? [{ id: 'legacy', inputKey: cfg.vmixInputKey, vmixFieldSinBinA: cfg.vmixFieldSinBinA ?? '', vmixFieldSinBinB: cfg.vmixFieldSinBinB ?? '', vmixFieldRedA: cfg.vmixFieldRedA ?? '', vmixFieldRedB: cfg.vmixFieldRedB ?? '', vmixFieldLogoA: cfg.vmixFieldLogoA ?? '', vmixFieldLogoB: cfg.vmixFieldLogoB ?? '' }]
                  : [];
              const setCdInputs = (next: CdInput[]) => up({ vmixInputs: next });
              const updateCd = (idx: number, patch: Partial<CdInput>) => setCdInputs(cdInputs.map((c, i) => i === idx ? { ...c, ...patch } : c));
              return (
                <>
                  <Field label="Auto-sync">
                    <ToggleCard checked={cfg.vmixAutoSync ?? false} onChange={v => up({ vmixAutoSync: v })} />
                  </Field>
                  {cdInputs.map((inp, idx) => {
                    const isVilCollapsed = vilCollapsed[inp.id] ?? false;
                    return (
                    <div key={inp.id} className="vil-cfg-block">
                      <div className="vil-cfg-header">
                        <button className="btn btn--ghost btn--small tf-collapse-btn"
                          onClick={() => setVilCollapsed(p => ({ ...p, [inp.id]: !p[inp.id] }))}
                          title={isVilCollapsed ? 'Expand' : 'Collapse'}>
                          {isVilCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                        </button>
                        <span className="vil-cfg-label">vMix Input {idx + 1}</span>
                        {cdInputs.length > 1 && <button className="btn btn--ghost btn--small" onClick={() => setCdInputs(cdInputs.filter((_, i) => i !== idx))}>×</button>}
                      </div>
                      {!isVilCollapsed && (<>
                      {renderInputPicker('vMix Input', inp.inputKey, inp.inputTitle,
                        (key, title) => updateCd(idx, { inputKey: key, inputTitle: title }),
                        undefined, allInputs,
                      )}
                      {inp.inputKey && (
                        <>
                          <div className="config-section-label" style={{ fontSize: 10, opacity: 0.5, marginTop: 4 }}>Sin bin fields</div>
                          <Field label="Team A sin bin">{renderFieldPicker(inp.inputKey, inp.vmixFieldSinBinA, v => updateCd(idx, { vmixFieldSinBinA: v }), 'Title.Text', undefined, allInputs)}</Field>
                          <Field label="Team B sin bin">{renderFieldPicker(inp.inputKey, inp.vmixFieldSinBinB, v => updateCd(idx, { vmixFieldSinBinB: v }), 'Title.Text', undefined, allInputs)}</Field>
                          <div className="config-section-label" style={{ fontSize: 10, opacity: 0.5, marginTop: 4 }}>Red card fields</div>
                          <Field label="Team A red card">{renderFieldPicker(inp.inputKey, inp.vmixFieldRedA, v => updateCd(idx, { vmixFieldRedA: v }), 'Title.Text', undefined, allInputs)}</Field>
                          <Field label="Team B red card">{renderFieldPicker(inp.inputKey, inp.vmixFieldRedB, v => updateCd(idx, { vmixFieldRedB: v }), 'Title.Text', undefined, allInputs)}</Field>
                          <div className="config-section-label" style={{ fontSize: 10, opacity: 0.5, marginTop: 4 }}>Team logos</div>
                          <Field label="Team A logo">{renderFieldPicker(inp.inputKey, inp.vmixFieldLogoA ?? '', v => updateCd(idx, { vmixFieldLogoA: v }), 'TeamA.Source', n => n.toLowerCase().endsWith('.source'), allInputs)}</Field>
                          <Field label="Team B logo">{renderFieldPicker(inp.inputKey, inp.vmixFieldLogoB ?? '', v => updateCd(idx, { vmixFieldLogoB: v }), 'TeamB.Source', n => n.toLowerCase().endsWith('.source'), allInputs)}</Field>
                          <MergeFieldComposer
                            parts={[
                              { key: 'sinbinA', label: 'Sin Bin A', sample: 'John Smith' },
                              { key: 'sinbinB', label: 'Sin Bin B', sample: 'Mike Jones' },
                              { key: 'redA', label: 'Red Card A', sample: 'Dave Lee' },
                              { key: 'redB', label: 'Red Card B', sample: '' },
                            ]}
                            mergedParts={inp.mergedParts ?? []}
                            mergedPrefix={inp.mergedPrefix ?? ''}
                            mergedSeparator={inp.mergedSeparator ?? ' '}
                            onChange={patch => updateCd(idx, patch as Partial<CdInput>)}
                            inputKey={inp.inputKey}
                            allInputs={allInputs}
                            dragKey={`${widget.id}_carddisp_${inp.id}`}
                          />
                        </>
                      )}
                      </>)}
                    </div>
                    );
                  })}
                  <button className="btn btn--ghost btn--small" onClick={() => setCdInputs([...cdInputs, { id: crypto.randomUUID(), inputKey: '', vmixFieldSinBinA: '', vmixFieldSinBinB: '', vmixFieldRedA: '', vmixFieldRedB: '' }])}>+ Add vMix Input</button>
                </>
              );
            })()}
            </CollapsibleSection>
          </>
        );

        return renderTabbed(general, vmix);
      }

      case 'card-lower-third': {
        const playerListWidgets = pages.flatMap(p => p.widgets.filter(w => w.type === 'player-list'));
        const plLabel = (w: any) => plWidgetLabel(w, teamDbTeams);
        const general = (
          <>
            <CollapsibleSection label="Teams">
              <Field label="Team A — Player List">
                <CustomBox>
                  <select className="field-input" value={cfg.linkedPlayerListA ?? ''} onChange={e => up({ linkedPlayerListA: e.target.value })}>
                    <option value="">— select player list —</option>
                    {playerListWidgets.map(w => <option key={w.id} value={w.id}>{plLabel(w)}</option>)}
                  </select>
                </CustomBox>
              </Field>
              <Field label="Team B — Player List">
                <CustomBox>
                  <select className="field-input" value={cfg.linkedPlayerListB ?? ''} onChange={e => up({ linkedPlayerListB: e.target.value })}>
                    <option value="">— select player list —</option>
                    {playerListWidgets.map(w => <option key={w.id} value={w.id}>{plLabel(w)}</option>)}
                  </select>
                </CustomBox>
              </Field>
            </CollapsibleSection>
          </>
        );

        const vmix = (
          <>
            <Field label="Auto-send on change">
              <ToggleCard checked={cfg.autoSend ?? false} onChange={v => up({ autoSend: v })} desc="Send automatically when player changes" />
            </Field>

            <CollapsibleSection label="Yellow Card — vMix Input">
              {renderInputPicker('vMix Input', cfg.vmixInputKeyYellow ?? '', cfg.vmixInputTitleYellow,
                (key, title) => up({ vmixInputKeyYellow: key, vmixInputTitleYellow: title }),
                (i: any) => i.type === 'GT',
                allInputs,
              )}
            </CollapsibleSection>
            <CollapsibleSection label="Orange Card — vMix Input">
              {renderInputPicker('vMix Input', cfg.vmixInputKeyOrange ?? '', cfg.vmixInputTitleOrange,
                (key, title) => up({ vmixInputKeyOrange: key, vmixInputTitleOrange: title }),
                (i: any) => i.type === 'GT',
                allInputs,
              )}
            </CollapsibleSection>
            <CollapsibleSection label="Red Card — vMix Input">
              {renderInputPicker('vMix Input', cfg.vmixInputKeyRed ?? '', cfg.vmixInputTitleRed,
                (key, title) => up({ vmixInputKeyRed: key, vmixInputTitleRed: title }),
                (i: any) => i.type === 'GT',
                allInputs,
              )}
            </CollapsibleSection>
            {(cfg.vmixInputKeyYellow || cfg.vmixInputKeyOrange || cfg.vmixInputKeyRed) && (
              <CollapsibleSection label="Field Mapping">
                <Field label="Jersey No. field">{renderFieldPicker(cfg.vmixInputKeyYellow ?? cfg.vmixInputKeyOrange ?? cfg.vmixInputKeyRed, cfg.fieldJersey ?? 'Jersey.Text', v => up({ fieldJersey: v }), 'Title.Text', undefined, allInputs)}</Field>
                <Field label="Name field">{renderFieldPicker(cfg.vmixInputKeyYellow ?? cfg.vmixInputKeyOrange ?? cfg.vmixInputKeyRed, cfg.fieldName ?? 'Name.Text', v => up({ fieldName: v }), 'Title.Text', undefined, allInputs)}</Field>
                <Field label="Team name field">{renderFieldPicker(cfg.vmixInputKeyYellow ?? cfg.vmixInputKeyOrange ?? cfg.vmixInputKeyRed, cfg.fieldTeam ?? 'Team.Text', v => up({ fieldTeam: v }), 'Title.Text', undefined, allInputs)}</Field>
                <Field label="Card type field">{renderFieldPicker(cfg.vmixInputKeyYellow ?? cfg.vmixInputKeyOrange ?? cfg.vmixInputKeyRed, cfg.fieldCardType ?? 'Card.Text', v => up({ fieldCardType: v }), 'Title.Text', undefined, allInputs)}</Field>
                <Field label="Team Logo field">{renderFieldPicker(cfg.vmixInputKeyYellow ?? cfg.vmixInputKeyOrange ?? cfg.vmixInputKeyRed, cfg.fieldTeamLogo ?? '', v => up({ fieldTeamLogo: v }), 'Team.Source', n => n.toLowerCase().endsWith('.source'), allInputs)}</Field>
                <MergeFieldComposer
                  parts={[
                    { key: 'jersey', label: 'Jersey', sample: '9' },
                    { key: 'name', label: 'Name', sample: 'John Smith' },
                    { key: 'team', label: 'Team', sample: 'Chelsea' },
                    { key: 'cardType', label: 'Card Type', sample: 'Yellow Card' },
                  ]}
                  mergedParts={cfg.mergedParts ?? []}
                  mergedPrefix={cfg.mergedPrefix ?? ''}
                  mergedSeparator={cfg.mergedSeparator ?? ' '}
                  onChange={patch => up(patch)}
                  inputKey={cfg.vmixInputKeyYellow ?? cfg.vmixInputKeyOrange ?? cfg.vmixInputKeyRed ?? ''}
                  allInputs={allInputs}
                  dragKey={`${widget.id}_cardlt`}
                />
              </CollapsibleSection>
            )}

            <CollapsibleSection label="Overlay">
              <Field label="Overlay Channel">
                <CardSelect
                  value={cfg.overlayChannel ?? 1}
                  onChange={v => up({ overlayChannel: v })}
                  columns={4}
                  options={[1, 2, 3, 4].map(n => ({ value: n, label: `Overlay ${n}` }))}
                />
              </Field>
            </CollapsibleSection>
          </>
        );

        return renderTabbed(general, vmix);
      }

      case 'placement-lower-third': {
        type PlacementSlot = {
          id: string; rank: number; label: string; manualTeamName?: string; vmixInputKey: string; fieldLabel: string; fieldTeam: string; fieldLogo?: string;
          mergedPrefix?: string; mergedParts?: string[]; mergedSeparator?: string;
        };
        const plSlots: PlacementSlot[] = cfg.slots?.length
          ? cfg.slots
          : [{ id: 'p1', rank: 1, label: 'Champion', manualTeamName: '', vmixInputKey: '', fieldLabel: 'Label.Text', fieldTeam: 'Team.Text' }];
        const setPlSlots = (next: PlacementSlot[]) => up({ slots: next });
        const updatePlSlot = (idx: number, patch: Partial<PlacementSlot>) =>
          setPlSlots(plSlots.map((s, i) => i === idx ? { ...s, ...patch } : s));

        const filterTournament = tournaments.find(t => t.id === (cfg.filterTournamentId || pageTournamentId));
        const filterCategories: string[] = filterTournament?.categories ?? [];

        return (
          <>
            <CollapsibleSection label="Tournament">
              <Field label="Tournament">
                <CustomBox>
                  <select className="field-input" value={cfg.filterTournamentId ?? ''}
                    onChange={e => up({ filterTournamentId: e.target.value, filterCategory: '' })}>
                    <option value="">{pageTournament ? `— Auto: ${pageTournament.name} (this canvas) —` : '— pick tournament —'}</option>
                    {tournaments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </CustomBox>
              </Field>
              {filterCategories.length > 0 && (
                <Field label="Category">
                  <CustomBox>
                    <select className="field-input" value={cfg.filterCategory ?? ''} onChange={e => up({ filterCategory: e.target.value })}>
                      <option value="">All Categories</option>
                      {filterCategories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </CustomBox>
                </Field>
              )}
              <Field label="Auto-send once decided">
                <ToggleCard checked={cfg.autoSend ?? false} onChange={v => up({ autoSend: v })} desc="Send automatically once a placement is decided" />
              </Field>
            </CollapsibleSection>

            <CollapsibleSection label="Placements">
              <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '0 0 6px', lineHeight: 1.4 }}>
                Rank decides which fixture the team auto-fills from (1st/2nd
                from the Cup Final, 3rd/4th from the Cup's 3rd Place
                Playoff, 5th+ from a ranked-placement bracket, or overall
                standings if there's no bracket). Label is shown as-is —
                name it however this event calls it (Gold, Champion,
                Winner…). A Manual Team Override always wins over auto-fill.
              </p>
              {plSlots.map((slot, idx) => {
                const isCollapsed = vilCollapsed[slot.id] ?? false;
                return (
                  <div key={slot.id} className="vil-cfg-block">
                    <div className="vil-cfg-header">
                      <button className="btn btn--ghost btn--small tf-collapse-btn"
                        onClick={() => setVilCollapsed(p => ({ ...p, [slot.id]: !p[slot.id] }))}
                        title={isCollapsed ? 'Expand' : 'Collapse'}>
                        {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                      </button>
                      <span className="vil-cfg-label">{slot.rank ? `${slot.rank}. ` : ''}{slot.label || 'Placement'}</span>
                      {plSlots.length > 1 && (
                        <button className="btn btn--ghost btn--small"
                          onClick={() => setPlSlots(plSlots.filter((_, i) => i !== idx))}>×</button>
                      )}
                    </div>
                    {!isCollapsed && (<>
                      <Field label="Rank">
                        <input className="field-input" type="number" min={1} value={slot.rank}
                          onChange={e => updatePlSlot(idx, { rank: Math.max(1, parseInt(e.target.value, 10) || 1) })} />
                      </Field>
                      <Field label="Label">
                        <input className="field-input" value={slot.label} placeholder="e.g. Gold, Champion, Winner"
                          onChange={e => updatePlSlot(idx, { label: e.target.value })} />
                      </Field>
                      <Field label="Manual Team Override">
                        <input className="field-input" value={slot.manualTeamName ?? ''} placeholder="Leave blank to auto-fill"
                          onChange={e => updatePlSlot(idx, { manualTeamName: e.target.value })} />
                      </Field>
                      {renderInputPicker(
                        'vMix Title Input',
                        slot.vmixInputKey,
                        undefined,
                        (key) => updatePlSlot(idx, { vmixInputKey: key }),
                        (i: any) => i.type === 'GT',
                        allInputs,
                      )}
                      {slot.vmixInputKey && (
                        <>
                          <Field label="Label Field">{renderFieldPicker(slot.vmixInputKey, slot.fieldLabel, v => updatePlSlot(idx, { fieldLabel: v }), 'Title.Text', undefined, allInputs)}</Field>
                          <Field label="Team Field">{renderFieldPicker(slot.vmixInputKey, slot.fieldTeam, v => updatePlSlot(idx, { fieldTeam: v }), 'Title.Text', undefined, allInputs)}</Field>
                          <Field label="Team Logo Field">{renderFieldPicker(slot.vmixInputKey, slot.fieldLogo ?? '', v => updatePlSlot(idx, { fieldLogo: v }), 'Team.Source', n => n.toLowerCase().endsWith('.source'), allInputs)}</Field>
                          <MergeFieldComposer
                            parts={[
                              { key: 'label', label: 'Label', sample: slot.label || 'Champion' },
                              { key: 'team', label: 'Team', sample: 'Chelsea' },
                            ]}
                            mergedParts={slot.mergedParts ?? []}
                            mergedPrefix={slot.mergedPrefix ?? ''}
                            mergedSeparator={slot.mergedSeparator ?? ' '}
                            onChange={patch => updatePlSlot(idx, patch as Partial<PlacementSlot>)}
                            inputKey={slot.vmixInputKey}
                            allInputs={allInputs}
                            dragKey={`${widget.id}_placement_${slot.id}`}
                          />
                        </>
                      )}
                    </>)}
                  </div>
                );
              })}
              <button className="btn btn--ghost btn--small" onClick={() => {
                const nextRank = Math.max(0, ...plSlots.map(s => s.rank)) + 1;
                setPlSlots([...plSlots, { id: crypto.randomUUID(), rank: nextRank, label: '', manualTeamName: '', vmixInputKey: '', fieldLabel: 'Label.Text', fieldTeam: 'Team.Text' }]);
              }}>+ Add Placement</button>
            </CollapsibleSection>

            <CollapsibleSection label="Overlay">
              <Field label="Overlay Channel">
                <CardSelect
                  value={cfg.overlayChannel ?? 1}
                  onChange={v => up({ overlayChannel: v })}
                  columns={4}
                  options={[1, 2, 3, 4].map(n => ({ value: n, label: `Overlay ${n}` }))}
                />
              </Field>
            </CollapsibleSection>
          </>
        );
      }

      case 'panel': {
        const panelItems: Array<Record<string, any>> = cfg.items ?? [];
        const upItems = (items: Array<Record<string, any>>) => up({ items });
        const addItem = (type: 'command' | 'input' | 'text') => {
          const id = crypto.randomUUID();
          upItems([...panelItems, { id, type }]);
          setPanelExpandedId(id);
        };
        const delItem = (id: string) => {
          upItems(panelItems.filter(i => i.id !== id));
          if (panelExpandedId === id) setPanelExpandedId(null);
        };
        const patchItem = (id: string, patch: Record<string, any>) =>
          upItems(panelItems.map(i => i.id === id ? { ...i, ...patch } : i));
        const moveItem = (id: string, dir: -1 | 1) => {
          const idx = panelItems.findIndex(i => i.id === id);
          if (idx < 0) return;
          const next = [...panelItems];
          const swap = idx + dir;
          if (swap < 0 || swap >= next.length) return;
          [next[idx], next[swap]] = [next[swap], next[idx]];
          upItems(next);
        };
        const TYPE_ICONS: Record<string, React.ReactNode> = { command: <Terminal size={12} />, input: <SquareStack size={12} />, text: 'T' };
        const TYPE_LABELS: Record<string, string> = { command: 'Command', input: 'Input', text: 'Text Field' };
        return (
          <>
            <CollapsibleSection label="Items">
            {panelItems.length === 0 && (
              <p className="config-no-settings" style={{ marginBottom: 6 }}>No items yet — add below</p>
            )}
            {panelItems.map((item, idx) => {
              const expanded = panelExpandedId === item.id;
              const preview = item.label || item.fn || item.fieldName || item.inputKey || '—';
              return (
                <div key={item.id} className="wgt-panel-cfg-item">
                  <div className="wgt-panel-cfg-row" onClick={() => setPanelExpandedId(expanded ? null : item.id)}>
                    <span className="wgt-panel-cfg-type">{TYPE_ICONS[item.type]}</span>
                    <span className="wgt-panel-cfg-preview">{TYPE_LABELS[item.type]}: {preview}</span>
                    <div className="wgt-panel-cfg-actions" onClick={e => e.stopPropagation()}>
                      <button className="wgt-panel-cfg-move" disabled={idx === 0} onClick={() => moveItem(item.id, -1)}><ArrowUp size={11} strokeWidth={2} /></button>
                      <button className="wgt-panel-cfg-move" disabled={idx === panelItems.length - 1} onClick={() => moveItem(item.id, 1)}><ArrowDown size={11} strokeWidth={2} /></button>
                      <button className="wgt-panel-cfg-del" onClick={() => delItem(item.id)}>×</button>
                    </div>
                  </div>

                  {expanded && (
                    <div className="wgt-panel-cfg-edit">
                      <Field label="Label">
                        <input className="field-input" value={item.label ?? ''} placeholder="Display label" onChange={e => patchItem(item.id, { label: e.target.value })} />
                      </Field>

                      {item.type === 'command' && (
                        <>
                          <Field label="vMix Function">
                            <input className="field-input" value={item.fn ?? ''} placeholder="e.g. Cut, Fade, StartRecording" onChange={e => patchItem(item.id, { fn: e.target.value })} />
                          </Field>
                          <Field label="Value (optional)">
                            <input className="field-input" value={item.fnValue ?? ''} placeholder="Value param" onChange={e => patchItem(item.id, { fnValue: e.target.value })} />
                          </Field>
                          <Field label="Color">
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              {PRESET_COLORS.map(c => (
                                <button key={c} onClick={() => patchItem(item.id, { color: c })}
                                  style={{ width: 18, height: 18, borderRadius: 3, background: c, border: item.color === c ? '2px solid #fff' : '1px solid #0004', cursor: 'pointer' }} />
                              ))}
                            </div>
                          </Field>
                        </>
                      )}

                      {item.type === 'input' && (
                        <Field label="vMix Input">
                          <CustomBox>
                            <select className="field-input" value={item.inputKey ?? ''} onChange={e => patchItem(item.id, { inputKey: e.target.value })}>
                              <option value="">— select input —</option>
                              {allInputs.map(i => <option key={i.key} value={i.key}>{i.number}. {i.title}</option>)}
                            </select>
                          </CustomBox>
                        </Field>
                      )}

                      {item.type === 'text' && (
                        <>
                          <Field label="vMix Title Input">
                            <CustomBox>
                              <select className="field-input" value={item.textInputKey ?? ''} onChange={e => patchItem(item.id, { textInputKey: e.target.value })}>
                                <option value="">— select input —</option>
                                {allInputs.filter(i => i.type === 'GT').map(i => <option key={i.key} value={i.key}>{i.number}. {i.title}</option>)}
                              </select>
                            </CustomBox>
                          </Field>
                          <Field label="Field Name">{renderFieldPicker(item.textInputKey ?? '', item.fieldName ?? '', v => patchItem(item.id, { fieldName: v }), 'Title.Text')}</Field>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            <div className="wgt-panel-cfg-add">
              <button className="wgt-panel-cfg-add-btn" onClick={() => addItem('command')}>+ Command</button>
              <button className="wgt-panel-cfg-add-btn" onClick={() => addItem('input')}>+ Input</button>
              <button className="wgt-panel-cfg-add-btn" onClick={() => addItem('text')}>+ Text Field</button>
            </div>
            </CollapsibleSection>
          </>
        );
      }

      case 'vmix-titles': {
        type VTEntry = string | { name: string; type: 'source' };
        type VTInput = { id: string; inputKey: string; label?: string; name?: string; fields: VTEntry[] };
        const vtFName = (f: VTEntry) => typeof f === 'string' ? f : f.name;
        const vtFType = (f: VTEntry): 'text' | 'source' => typeof f === 'string' ? 'text' : (f.type ?? 'text');
        const vtInputs: VTInput[] = cfg.inputs ?? [];
        const setVTInputs = (next: VTInput[]) => up({ inputs: next });
        const updateVT = (idx: number, patch: Partial<VTInput>) =>
          setVTInputs(vtInputs.map((g, i) => i === idx ? { ...g, ...patch } : g));

        return renderTabbed(
          <p className="app-settings-hint" style={{ margin: '4px 2px' }}>
            This widget is a direct vMix text/image sync — see the vMix Input page for everything it does.
          </p>,
          <>
            <CollapsibleSection label="vMix Titles">
            <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
                <ToggleCard checked={cfg.showThumbs ?? true} onChange={v => up({ showThumbs: v })} />
                Show thumbnails
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
                <ToggleCard checked={cfg.autoSend ?? false} onChange={v => up({ autoSend: v })} />
                Auto-send
              </label>
            </div>

            {vtInputs.map((grp, gi) => {
              const isCollapsed = vtCollapsed[grp.id] ?? false;
              return (
                <div key={grp.id} className="tf-group-block">
                  <div className="tf-group-header">
                    <button
                      className="btn btn--ghost btn--small tf-collapse-btn"
                      onClick={() => setVTCollapsed(prev => ({ ...prev, [grp.id]: !prev[grp.id] }))}
                      title={isCollapsed ? 'Expand' : 'Collapse'}>
                      {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    </button>
                    <input
                      className="tf-group-name-input"
                      value={grp.name ?? ''}
                      placeholder={`vMix Title Input ${gi + 1}`}
                      onChange={e => updateVT(gi, { name: e.target.value })}
                    />
                    <button className="btn btn--ghost btn--small tf-field-del"
                      onClick={() => setVTInputs(vtInputs.filter((_, i) => i !== gi))}>×</button>
                  </div>

                  {!isCollapsed && (<>
                    {renderInputPicker('vMix Input', grp.inputKey, grp.label,
                      (key, title) => {
                        const inp = allInputs.find(i => i.key === key);
                        updateVT(gi, {
                          inputKey: key,
                          label: title,
                          fields: inp?.textFields?.length
                            ? inp.textFields.map((f: { name: string }) => f.name)
                            : grp.fields.length ? grp.fields : ['Title.Text'],
                        });
                      },
                      undefined,
                      allInputs,
                    )}

                    <Field label="Display Label (optional)">
                      <input className="field-input" value={grp.label ?? ''}
                        placeholder="Defaults to vMix input name"
                        onChange={e => updateVT(gi, { label: e.target.value })} />
                    </Field>

                    <div className="tf-fields-editor">
                      {grp.fields.map((f, fi) => (
                        <div key={fi} className="tf-field-row">
                          <FieldPickerDropdown
                            inputKey={grp.inputKey}
                            value={vtFName(f)}
                            onChange={v => {
                              const next = [...grp.fields];
                              next[fi] = vtFType(f) === 'source' ? { name: v, type: 'source' } : v;
                              updateVT(gi, { fields: next });
                            }}
                            placeholder="FieldName.Text"
                            allInputs={allInputs}
                          />
                          <button
                            className={`btn btn--small${vtFType(f) === 'source' ? '' : ' btn--ghost'}`}
                            title={vtFType(f) === 'source' ? 'Source (image) field — click to switch to Text' : 'Text field — click to switch to Source'}
                            style={{ minWidth: 22, padding: '0 4px', fontSize: 10 }}
                            onClick={() => {
                              const next = [...grp.fields];
                              const name = vtFName(f);
                              next[fi] = vtFType(f) === 'text' ? { name, type: 'source' } : name;
                              updateVT(gi, { fields: next });
                            }}>
                            {vtFType(f) === 'source' ? 'S' : 'T'}
                          </button>
                          <button className="btn btn--ghost btn--small tf-field-del"
                            onClick={() => updateVT(gi, { fields: grp.fields.filter((_, i) => i !== fi) })}
                            disabled={grp.fields.length === 1}>×</button>
                        </div>
                      ))}
                      <button className="btn btn--ghost btn--small" style={{ alignSelf: 'flex-start', marginTop: 2 }}
                        onClick={() => updateVT(gi, { fields: [...grp.fields, ''] })}>
                        + Add Field
                      </button>
                    </div>
                  </>)}
                </div>
              );
            })}

            <button className="btn btn--ghost btn--small"
              onClick={() => setVTInputs([...vtInputs, { id: crypto.randomUUID(), inputKey: '', fields: ['Title.Text'] }])}>
              + Add Input
            </button>
            </CollapsibleSection>
          </>
        );
      }

      case 'rugby-lineup':
      case 'rugby-lineup-next': {
        const isNextMatchLineup = widget.type === 'rugby-lineup-next';
        const allPlayerListWidgets = pages.flatMap(p => p.widgets.filter(w => w.type === (isNextMatchLineup ? 'player-list-next' : 'player-list')));
        const scoreboardWidgets = pages.flatMap(p => p.widgets.filter(w => w.type === 'scoreboard'));
        const effLinkedTournamentId3 = cfg.linkedTournamentId || pageTournamentId;
        const scopedTeams3 = effLinkedTournamentId3
          ? teamDbTeams.filter(t => t.tournamentId === effLinkedTournamentId3)
          : teamDbTeams;
        const linkedTeam = teamDbTeams.find(t => t.id === cfg.linkedTeamId);
        const nextLineupTournament = tournaments.find(t => t.id === effLinkedTournamentId3);
        const nextLineupVenues: string[] = nextLineupTournament?.venues ?? [];
        const nextLineupCategories: string[] = nextLineupTournament?.categories ?? [];
        const loadFromTournament = () => {
          if (!linkedTeam) return;
          const currentPlayers: any[] = cfg.players ?? [];
          const updated = currentPlayers.map((p: any, i: number) => {
            const match = linkedTeam.players[i];
            return match ? { ...p, name: match.name, jerseyNo: match.jerseyNo || undefined } : p;
          });
          up({ teamName: linkedTeam.name, players: updated });
        };
        return renderTabbed(
          <>
            {isNextMatchLineup ? (
              <>
                <Field label="Tournament">
                  <CustomBox>
                    <select className="field-input" value={cfg.linkedTournamentId ?? ''}
                      onChange={e => up({ linkedTournamentId: e.target.value })}>
                      <option value="">{pageTournament ? `— Auto: ${pageTournament.name} (this canvas) —` : '— select tournament —'}</option>
                      {tournaments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </CustomBox>
                </Field>
                <Field label="Venue">
                  <CustomBox>
                    <select className="field-input" value={cfg.filterVenue ?? ''} onChange={e => up({ filterVenue: e.target.value })} disabled={nextLineupVenues.length === 0}>
                      <option value="">All Venues</option>
                      {nextLineupVenues.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </CustomBox>
                </Field>
                <Field label="Category">
                  <CustomBox>
                    <select className="field-input" value={cfg.filterCategory ?? ''} onChange={e => up({ filterCategory: e.target.value })} disabled={nextLineupCategories.length === 0}>
                      <option value="">All Categories</option>
                      {nextLineupCategories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </CustomBox>
                </Field>
                <Field label="Team Side">
                  <CardSelect value={cfg.teamSide ?? 'A'} onChange={v => up({ teamSide: v })} options={[{ value: 'A', label: 'Team A' }, { value: 'B', label: 'Team B' }]} />
                </Field>
                <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '-4px 0 4px' }}>
                  Team and this side's Player List — Next Match both follow the soonest not-yet-sent fixture automatically (scoped by Tournament/Venue/Category above). Drop a second copy of this widget with Team Side set to B for the other side.
                </p>
              </>
            ) : (
              <>
                <Field label="Link Scoreboard">
                  <CustomBox>
                    <select className="field-input" value={cfg.linkedScoreboardId ?? ''} onChange={e => up({ linkedScoreboardId: e.target.value })}>
                      <option value="">— none (pick team/list directly below) —</option>
                      {scoreboardWidgets.map(w => (
                        <option key={w.id} value={w.id}>{w.config.name || `Scoreboard (${w.config.teamAName || 'A'} vs ${w.config.teamBName || 'B'})`}</option>
                      ))}
                    </select>
                  </CustomBox>
                </Field>
                {cfg.linkedScoreboardId && (
                  <Field label="Team Side">
                    <CardSelect value={cfg.teamSide ?? 'A'} onChange={v => up({ teamSide: v })} options={[{ value: 'A', label: 'Team A' }, { value: 'B', label: 'Team B' }]} />
                  </Field>
                )}
                <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '-4px 0 4px' }}>
                  {cfg.linkedScoreboardId
                    ? 'Team, colors, and this side\'s Player List all follow the scoreboard automatically. The fields below only matter as manual overrides.'
                    : 'No scoreboard linked — pick a Player List and/or Team directly below.'}
                </p>
              </>
            )}
            <Field label="Player List">
              <CustomBox>
                <select
                  className="field-input"
                  value={cfg.linkedPlayerListId ?? ''}
                  onChange={e => {
                    const plw = allPlayerListWidgets.find(w => w.id === e.target.value);
                    up({
                      linkedPlayerListId: e.target.value || undefined,
                      linkedTournamentId: plw?.config.linkedTournamentId ?? cfg.linkedTournamentId,
                      ...(isNextMatchLineup ? {} : { linkedTeamId: plw?.config.linkedTeamId ?? cfg.linkedTeamId }),
                    });
                  }}
                >
                  <option value="">— auto (follow {isNextMatchLineup ? 'Next Match filters' : 'scoreboard'} / page) —</option>
                  {allPlayerListWidgets.map(w => (
                    <option key={w.id} value={w.id}>{plWidgetLabel(w, teamDbTeams)}</option>
                  ))}
                </select>
              </CustomBox>
            </Field>
            {!isNextMatchLineup && (
              <>
                <Field label="Tournament">
                  <CustomBox>
                    <select className="field-input" value={cfg.linkedTournamentId ?? ''}
                      onChange={e => up({ linkedTournamentId: e.target.value })}>
                      <option value="">{pageTournament ? `— Auto: ${pageTournament.name} (this canvas) —` : '— select tournament —'}</option>
                      {tournaments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </CustomBox>
                </Field>
                <Field label="Team">
                  <CustomBox>
                    <select className="field-input" value={cfg.linkedTeamId ?? ''}
                      onChange={e => {
                        const t = teamDbTeams.find(t2 => t2.id === e.target.value);
                        up({ linkedTeamId: e.target.value, ...(t ? { teamName: t.name } : {}) });
                      }}>
                      <option value="">— auto (follow scoreboard / Player List) —</option>
                      {scopedTeams3.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </CustomBox>
                </Field>
                {linkedTeam && !cfg.linkedPlayerListId && (
                  <Field label="Players">
                    <button className="btn btn--secondary btn--small" onClick={loadFromTournament}>
                      Load names from {linkedTeam.name}
                    </button>
                  </Field>
                )}
              </>
            )}
            <Field label="Simple Positions">
              <ToggleCard checked={cfg.simplePositions ?? false} onChange={v => up({ simplePositions: v })} />
            </Field>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '-4px 0 4px' }}>
              Shows just "Forward" / "Back" under each player instead of the specific position (Prop, Fly Half, etc).
            </p>
            <Field label="Truncate Long Names">
              <ToggleCard checked={cfg.truncateNames ?? false} onChange={v => up({ truncateNames: v })} />
            </Field>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '-4px 0 4px' }}>
              {cfg.truncateNames
                ? 'On: every name pill stays the same size — a long name is cut off with "…" instead.'
                : 'Off: long names shrink to fit instead of being cut off. Turn on for a simpler, more uniform pitch.'}
            </p>
          </>
        );
      }

      default: return <p className="config-no-settings">No settings for this widget type.</p>;
    }
  };

  return (
    <div
      className={`config-panel${panelCollapsed ? ' config-panel--collapsed' : ''}`}
      style={{ left: pos.x, top: pos.y, width: pos.w, height: panelCollapsed ? undefined : pos.h } as React.CSSProperties}
    >
      <div
        className="config-panel-header"
        onPointerDown={onPanelDragDown}
        onPointerMove={onPanelDragMove}
        onPointerUp={onPanelDragUp}
      >
        <span className="config-panel-header-icon"><WidgetIcon type={widget.type} size={16} strokeWidth={1.75} /></span>
        <input
          key={widget.id}
          className="config-panel-title-input"
          defaultValue={widget.label ?? ''}
          placeholder={WIDGET_TYPE_LABELS[widget.type]}
          onBlur={e => updateWidget(widget.id, { label: e.target.value.trim() || undefined })}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', alignItems: 'center' }}>
          <button className="btn btn--ghost btn--small" title={panelCollapsed ? 'Expand' : 'Collapse'}
            onClick={() => setPanelCollapsed(c => !c)}>
            {panelCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
          <button className="btn btn--ghost btn--small" title="Duplicate"
            onClick={() => { duplicateWidget(widget.id); onClose(); }}>⧉</button>
          <button className="btn btn--danger btn--small" title="Delete"
            onClick={() => { deleteWidget(widget.id); selectWidget(null); onClose(); }}>⌫</button>
          <button className="config-panel-close" onClick={onClose}>×</button>
        </div>
      </div>
      {!panelCollapsed && (
        <div className="config-panel-body">
          <div className="config-panel-tabs">
            <button type="button" className={`config-panel-tab${configTab === 'general' ? ' config-panel-tab--active' : ''}`}
              onClick={() => setConfigTab('general')}>General</button>
            <button type="button" className={`config-panel-tab${configTab === 'vmix' ? ' config-panel-tab--active' : ''}`}
              onClick={() => setConfigTab('vmix')}><Cast size={12} strokeWidth={2} /> vMix Input</button>
          </div>
          {configTab === 'general' && <Field label="Widget ID">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                key={widget.id}
                className="field-input"
                style={{ fontFamily: 'monospace', fontSize: 11 }}
                defaultValue={widget.id}
                spellCheck={false}
                onBlur={e => commitIdChange(e.target.value.trim())}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              />
              <button
                type="button"
                className="btn btn--ghost btn--small"
                title="Copy widget ID"
                onClick={() => navigator.clipboard.writeText(widget.id).catch(() => {})}
              ><Copy size={13} /></button>
            </div>
            <p className="app-settings-hint" style={{ margin: '4px 0 0' }}>
              {idError
                ? <span style={{ color: 'var(--red)' }}>{idError}</span>
                : "Used to link this widget from others (linked scoreboard/timer, buttons, Companion). Renaming it updates every other widget that already points here — safe to change any time."}
            </p>
          </Field>}
          {renderConfig()}
          {configTab === 'general' && <CollapsibleSection label="Widget Appearance" defaultOpen={false}>
            <Field label="Theme">
              <CardSelect
                value={cfg.widgetTheme ?? 'inherit'}
                onChange={v => up({ widgetTheme: v === 'inherit' ? undefined : v })}
                options={[{ value: 'inherit', label: 'Inherit app theme' }, { value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]}
              />
            </Field>
            <Field label="Accent Color">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="color"
                  value={cfg.widgetAccent ?? '#4a90d9'}
                  onChange={e => up({ widgetAccent: e.target.value })}
                  style={{ width: 36, height: 28, padding: 2, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-2)', cursor: 'pointer', flexShrink: 0 }}
                />
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                  {cfg.widgetAccent ?? 'default'}
                </span>
                {cfg.widgetAccent && (
                  <button
                    className="btn btn--ghost btn--small"
                    style={{ marginLeft: 'auto', fontSize: 10 }}
                    onClick={() => up({ widgetAccent: undefined })}
                  >Reset</button>
                )}
              </div>
            </Field>
          </CollapsibleSection>}
          {configTab === 'general' && <CollapsibleSection label="CG Output" defaultOpen={false}>
            <p className="app-settings-hint" style={{ margin: '0 0 8px' }}>
              Assign a channel/layer to play this widget straight to your own
              CG output — click the <Cast size={11} strokeWidth={2} style={{ verticalAlign: -1 }} /> icon on the widget itself to show/hide it there
              once set (see CG Playout in the sidebar for the full channel/layer board).
            </p>
            <Field label="Channel">
              <input className="field-input" type="number" min={1} value={cfg.cgChannel ?? 1}
                onChange={e => up({ cgChannel: Math.max(1, Number(e.target.value) || 1) })} />
            </Field>
            <Field label="Layer">
              <input className="field-input" type="number" min={0} value={cfg.cgLayer ?? 0}
                onChange={e => up({ cgLayer: Math.max(0, Number(e.target.value) || 0) })}
                placeholder="0 = not assigned" />
            </Field>
          </CollapsibleSection>}
        </div>
      )}
      <div
        className="config-panel-resize-x"
        onPointerDown={onResizeXDown}
        onPointerMove={onResizeXMove}
        onPointerUp={onResizeXUp}
      />
      {!panelCollapsed && (
        <div
          className="config-panel-resize-br"
          onPointerDown={onResizeBRDown}
          onPointerMove={onResizeBRMove}
          onPointerUp={onResizeBRUp}
        />
      )}
    </div>
  );
}
