import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ActionItem } from '../lib/buttonActions';

export type AppTheme = 'dark' | 'light';
export interface ReferenceBg { type: 'transparent' | 'color' | 'image'; color?: string; imageUrl?: string }

// One button on the Tournament Database's own Quick Buttons bar (see
// QuickButtonsBar.tsx) — a persisted, freestanding equivalent of a canvas
// Button widget's own press/release actions, fired through the exact same
// runButtonPress/runButtonRelease/deriveToggleOn machinery
// (lib/buttonActions.ts) so it behaves identically to a real widget, just
// not tied to any one page/widget instance.
// A small pill attached to a QuickButtonDef — same idea as the canvas
// Button widget's own "Side Buttons" (WidgetConfigPanel.tsx's SideButton,
// rendered via ButtonWidget.tsx's wgt-btn-group), minus a hotkey (no canvas
// widget instance for a global hotkey to target) AND minus its own
// color/textColor — deliberately NOT a second independently-styled button,
// just a smaller accessory tag on the main one, so it always renders in
// the parent QuickButtonDef's own color (see QuickSideButtonPill). Fires
// through the same runButtonPress/runButtonRelease machinery as the main
// button, independently.
export interface QuickSideButtonDef {
  id: string;
  label: string;
  mode?: 'momentary' | 'toggle';
  actions: ActionItem[];
  releaseActions?: ActionItem[];
}

export interface QuickButtonDef {
  id: string;
  label: string;
  color?: string;
  textColor?: string;
  mode?: 'momentary' | 'toggle';
  actions: ActionItem[];
  releaseActions?: ActionItem[];
  /** Pixel size — unset means the CSS default pill size (auto width,
   *  34px tall). Set by dragging the resize handle in the bar's own edit
   *  mode (see QuickButtonsBar.tsx) or typed directly in the editor modal. */
  width?: number;
  height?: number;
  /** One or more secondary function buttons attached to this one — see
   *  QuickSideButtonDef above. */
  sideButtons?: QuickSideButtonDef[];
  /** 'outside' (default) — side pills sit next to the main button, in its
   *  own row. 'inside' — side pills are overlaid INSIDE the main button's
   *  own box (bottom-right corner), so the whole thing reads as one
   *  control instead of a button with something attached alongside it. */
  sideButtonStyle?: 'outside' | 'inside';
}

interface AppSettingsState {
  canvasWidth: number;
  canvasHeight: number;
  canvasScale: number;
  setCanvasSize: (w: number, h: number) => void;
  setCanvasScale: (s: number) => void;
  // Whole-app UI scale (sidebar, toolbars, panels, modals, popups —
  // everything) — see App.tsx's own `document.documentElement.style.zoom`
  // effect. Distinct from canvasScale above, which only zooms the
  // production canvas ITSELF (widget positions/sizes stay in real pixels);
  // this scales the whole surrounding app chrome, for a small/high-DPI
  // screen or plain personal preference — the same idea as a browser's own
  // Ctrl/Cmd +/- zoom, just persisted per this app instead of per tab.
  uiScale: number;
  setUiScale: (s: number) => void;
  // CG Template Designer's own canvas backdrop — a visual aid ONLY, shown
  // behind the template's own transparent areas while designing so an
  // operator can preview roughly how it'll composite over real video
  // (or just eyeball contrast/legibility) — never saved into the template
  // itself, never synced to other clients, never part of the real output.
  // Deliberately a single global preference (not per-template) in this
  // store, same as canvasScale/uiScale above, rather than living in
  // config.elements/widget.config anywhere a real template field would —
  // that's precisely what would make it stop being "only for reference".
  referenceBg: ReferenceBg;
  setReferenceBg: (v: Partial<ReferenceBg>) => void;
  // The workspace area OUTSIDE the canvas bounds (.tpld-canvas-wrap) —
  // independent of referenceBg above, which is the canvas's OWN backdrop.
  // 'transparent' (the default, and the only look before this setting
  // existed) is the checkerboard pattern already baked into
  // .tpld-canvas-wrap's own CSS; 'solid' replaces it with a plain flat
  // fill so the outside area doesn't visually compete with a 'transparent'
  // reference chosen for the canvas itself. Same "visual aid only, never
  // touches the actual template" rule as referenceBg.
  referenceBgOutside: 'solid' | 'transparent';
  setReferenceBgOutside: (v: 'solid' | 'transparent') => void;
  // Theme
  theme: AppTheme;
  setTheme: (t: AppTheme) => void;
  // Read-only notification popups
  notifyGoal: boolean;
  notifyCard: boolean;
  notifySub: boolean;
  notifyTimePause: boolean;
  notifyDurationMs: number;
  setNotifyGoal: (v: boolean) => void;
  setNotifyCard: (v: boolean) => void;
  setNotifySub: (v: boolean) => void;
  setNotifyTimePause: (v: boolean) => void;
  setNotifyDurationMs: (v: number) => void;
  // How often (ms) the app polls vMix's own live XML state over HTTP — the
  // response this drives everything from (every current input, its own
  // state/text fields, tally, overlay/preview/program status, etc.) is
  // what the whole app's "live" view of vMix is actually built from. See
  // api/vmixApi.ts's own startPolling/setPollIntervalMs — deliberately
  // store-agnostic (no import of this store, or any other, to keep it a
  // plain API client), so wiring a live change through to an already-
  // connected client is done at the call site (AppSettingsModal.tsx) via
  // useVmixStore.getState().client?.setPollIntervalMs(...) directly,
  // rather than from in here. Independent of vMix's own real-time TCP
  // push (Tauri only, ~200ms, unaffected by this setting) — this only
  // governs the HTTP fallback/backup poll, which is the ONLY live-state
  // path a browser client (no TCP) has at all, and is also what keeps
  // state fresh on desktop whenever TCP itself is down/reconnecting.
  vmixPollRateMs: number;
  setVmixPollRateMs: (v: number) => void;
  // Remote-client-only: while true, incoming host sync for the Team DB /
  // Schedule / Results / Tournament stores is paused so local edits aren't
  // clobbered by the host's periodic re-broadcast — the operator explicitly
  // pushes changes back with "Save to Host" instead of continuous mirroring.
  remoteEditMode: boolean;
  setRemoteEditMode: (v: boolean) => void;
  // Remote-client-only, Draw tab: while true, every draw change (team
  // drawn, group/position assigned) is auto-pushed to the host a moment
  // after it happens — no manual "Save to Host" click needed. Independent
  // of remoteEditMode: this client keeps receiving the host's broadcasts
  // normally, it just also proactively pushes its own changes.
  liveSyncDraw: boolean;
  setLiveSyncDraw: (v: boolean) => void;
  // Title bar clock. Empty string = follow system local time zone;
  // otherwise an IANA time zone name (e.g. "Europe/London").
  clockTimeZone: string;
  setClockTimeZone: (v: string) => void;
  // This physical install's venue scope — local-only, NOT synced, so each
  // venue running its own copy of the app can filter the (shared, synced)
  // match schedule down to just its own fixtures for the canvas's "Upcoming
  // Matches" widget and "Load Match" picker. Empty tournament id = show
  // every tournament; empty venue = show every venue within it.
  canvasTournamentId: string;
  canvasVenue: string;
  setCanvasTournamentId: (v: string) => void;
  setCanvasVenue: (v: string) => void;
  // Same idea as canvasTournamentId/canvasVenue, one axis further — which
  // category (e.g. "Men Open") this install's canvas is scoped to. Empty =
  // every category. Local-only, not synced, same reasoning as the two above.
  canvasCategory: string;
  setCanvasCategory: (v: string) => void;
  // Whether the Tournament/Category scope bar (see Canvas.tsx, reuses
  // TournamentManager.tsx's own TournamentScopeHeader) shows above the
  // canvas — off by default (most installs never need it visible; the
  // Sidebar's own compact venue-scope picker already covers the common
  // case), toggled on/off per-device via its own Add/Remove control.
  canvasScopeBarVisible: boolean;
  setCanvasScopeBarVisible: (v: boolean) => void;
  // Quick Buttons bar — an optional bar below the Tournament/Category bar
  // in the Tournament Database window (see QuickButtonsBar.tsx), holding
  // freestanding custom buttons an operator builds themselves (same
  // press/release-action editor and firing behavior as a canvas Button
  // widget, just not tied to any one page/widget instance). Off by
  // default, per-device Add/Remove toggle; the buttons themselves persist
  // independently of whether the bar is currently shown, so hiding it
  // doesn't lose anything already built.
  quickButtons: QuickButtonDef[];
  setQuickButtons: (v: QuickButtonDef[]) => void;
  quickButtonsBarVisible: boolean;
  setQuickButtonsBarVisible: (v: boolean) => void;
  // App sidebar (replaces the old separate title bar + status bar) — whether
  // it's showing full labels or just its icon rail. Persisted so a venue
  // that always runs collapsed for max canvas space doesn't have to
  // re-collapse it every launch.
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  // Top-bar CG Preview/Program monitor (CgMonitorBar.tsx) — same collapse
  // convention as the left sidebar above, plus which CG Playout channel
  // it's currently watching.
  cgMonitorCollapsed: boolean;
  setCgMonitorCollapsed: (v: boolean) => void;
  cgMonitorChannel: number;
  setCgMonitorChannel: (v: number) => void;
  // Height (px) of the PROGRAM/PREVIEW boxes — dragging the bar's own
  // bottom-edge resize handle sets this; each box's width is then derived
  // to keep the same aspect ratio the bar shipped with (220:124), so the
  // boxes just scale up/down together rather than needing two knobs.
  cgMonitorBoxHeight: number;
  setCgMonitorBoxHeight: (v: number) => void;
  // Height (px) of the CG Template Designer's own bottom Timeline panel
  // (CgTemplateTimeline.tsx) — dragging its own top-edge resize handle
  // (CgTemplateDesigner.tsx) sets this, same convention as
  // cgMonitorBoxHeight above. 230 matches .tplt's own CSS default, so a
  // template designed before this setting existed opens looking exactly
  // the same.
  cgTimelinePanelHeight: number;
  setCgTimelinePanelHeight: (v: number) => void;
  // Background for the default/"monitor" CG output (`?cgChannel=`/`?cgOutput=`
  // with no `mode=` — see lib/cgOutputMode.ts; Fill/Key stay unconditionally
  // opaque black regardless of this, that's protocol-required, not a
  // preference). 'transparent' (the only behavior before this setting
  // existed) suits a Browser Source that already composites alpha
  // correctly; 'solid' is for a capture path that doesn't (or for lining
  // the CG up against a specific color on purpose) — cgMonitorBgColor is
  // only read when this is 'solid'.
  cgMonitorBg: 'transparent' | 'solid';
  setCgMonitorBg: (v: 'transparent' | 'solid') => void;
  cgMonitorBgColor: string;
  setCgMonitorBgColor: (v: string) => void;
  // CG Playout sidebar (CgPlayoutPanel.tsx) — docked on the right, same
  // collapse convention as the left sidebar/CG Monitor above. Was a modal
  // you had to open/close; now always mounted so a layer's status/template
  // is visible at a glance and Clear/Play/Stop are one click away.
  cgPlayoutSidebarCollapsed: boolean;
  setCgPlayoutSidebarCollapsed: (v: boolean) => void;
  // Simple Names — applies everywhere a player's name is read-only
  // displayed or pushed to vMix (never to an editable name input, so it
  // can't overwrite a player's real stored name). See src/lib/simpleName.ts.
  simplifyMuhammadNames: boolean;
  simplifyFirstNameOnly: boolean;
  removeBinMarkers: boolean;
  truncateAtBinMarker: boolean;
  setSimplifyMuhammadNames: (v: boolean) => void;
  setSimplifyFirstNameOnly: (v: boolean) => void;
  setRemoveBinMarkers: (v: boolean) => void;
  setTruncateAtBinMarker: (v: boolean) => void;
  // Bottom resource status bar (StatusBar.tsx) — whether it's shown at all.
  // false fully stops the underlying poll too (see systemStatsStore.ts's
  // start/stop lifecycle in App.tsx), not just hiding the DOM node, so
  // turning it off genuinely costs this app nothing, not just screen space.
  statusBarEnabled: boolean;
  setStatusBarEnabled: (v: boolean) => void;
}

export const useAppSettings = create<AppSettingsState>()(
  persist(
    (set) => ({
      canvasWidth: 2000,
      canvasHeight: 1400,
      canvasScale: 1.0,

      setCanvasSize: (w, h) => set({ canvasWidth: Math.max(400, w), canvasHeight: Math.max(300, h) }),
      setCanvasScale: (s) => set({ canvasScale: Math.min(3, Math.max(0.1, s)) }),

      uiScale: 1.0,
      setUiScale: (s) => set({ uiScale: Math.min(2, Math.max(0.5, s)) }),

      referenceBg: { type: 'transparent' },
      setReferenceBg: (v) => set((s) => ({ referenceBg: { ...s.referenceBg, ...v } })),

      referenceBgOutside: 'transparent',
      setReferenceBgOutside: (v) => set({ referenceBgOutside: v }),

      theme: 'dark',
      setTheme: (t) => set({ theme: t }),

      notifyGoal: true,
      notifyCard: true,
      notifySub: true,
      notifyTimePause: true,
      notifyDurationMs: 5000,
      setNotifyGoal: (v) => set({ notifyGoal: v }),
      setNotifyCard: (v) => set({ notifyCard: v }),
      setNotifySub: (v) => set({ notifySub: v }),
      setNotifyTimePause: (v) => set({ notifyTimePause: v }),
      setNotifyDurationMs: (v) => set({ notifyDurationMs: Math.max(1000, Math.min(30000, v)) }),

      vmixPollRateMs: 500,
      setVmixPollRateMs: (v) => set({ vmixPollRateMs: Math.max(100, Math.min(5000, Math.round(v))) }),

      remoteEditMode: false,
      setRemoteEditMode: (v) => set({ remoteEditMode: v }),

      liveSyncDraw: false,
      setLiveSyncDraw: (v) => set({ liveSyncDraw: v }),

      clockTimeZone: '',
      setClockTimeZone: (v) => set({ clockTimeZone: v }),

      canvasTournamentId: '',
      canvasVenue: '',
      setCanvasTournamentId: (v) => set({ canvasTournamentId: v, canvasVenue: '', canvasCategory: '' }),
      setCanvasVenue: (v) => set({ canvasVenue: v }),
      canvasCategory: '',
      setCanvasCategory: (v) => set({ canvasCategory: v }),
      canvasScopeBarVisible: false,
      setCanvasScopeBarVisible: (v) => set({ canvasScopeBarVisible: v }),
      quickButtons: [],
      setQuickButtons: (v) => set({ quickButtons: v }),
      quickButtonsBarVisible: false,
      setQuickButtonsBarVisible: (v) => set({ quickButtonsBarVisible: v }),

      sidebarCollapsed: false,
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),

      cgMonitorCollapsed: false,
      setCgMonitorCollapsed: (v) => set({ cgMonitorCollapsed: v }),
      cgMonitorChannel: 1,
      setCgMonitorChannel: (v) => set({ cgMonitorChannel: Math.max(1, v) }),
      cgMonitorBoxHeight: 124,
      setCgMonitorBoxHeight: (v) => set({ cgMonitorBoxHeight: Math.max(60, Math.min(400, v)) }),
      cgTimelinePanelHeight: 230,
      setCgTimelinePanelHeight: (v) => set({ cgTimelinePanelHeight: Math.max(120, Math.min(600, v)) }),
      cgMonitorBg: 'transparent',
      setCgMonitorBg: (v) => set({ cgMonitorBg: v }),
      cgMonitorBgColor: '#000000',
      setCgMonitorBgColor: (v) => set({ cgMonitorBgColor: v }),

      cgPlayoutSidebarCollapsed: false,
      setCgPlayoutSidebarCollapsed: (v) => set({ cgPlayoutSidebarCollapsed: v }),

      simplifyMuhammadNames: false,
      simplifyFirstNameOnly: false,
      removeBinMarkers: false,
      truncateAtBinMarker: false,
      setSimplifyMuhammadNames: (v) => set({ simplifyMuhammadNames: v }),
      setSimplifyFirstNameOnly: (v) => set({ simplifyFirstNameOnly: v }),
      setRemoveBinMarkers: (v) => set({ removeBinMarkers: v }),
      setTruncateAtBinMarker: (v) => set({ truncateAtBinMarker: v }),

      statusBarEnabled: true,
      setStatusBarEnabled: (v) => set({ statusBarEnabled: v }),
    }),
    { name: 'gomolab-app-settings' },
  ),
);

export const SCALE_PRESETS = [0.25, 0.33, 0.5, 0.67, 0.75, 1.0, 1.25, 1.5, 2.0];

export function nearestScalePreset(current: number, direction: 1 | -1): number {
  if (direction === 1) {
    const next = SCALE_PRESETS.find(s => s > current + 0.01);
    return next ?? SCALE_PRESETS[SCALE_PRESETS.length - 1];
  } else {
    const prev = [...SCALE_PRESETS].reverse().find(s => s < current - 0.01);
    return prev ?? SCALE_PRESETS[0];
  }
}
