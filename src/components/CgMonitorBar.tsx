import { useEffect, useRef, useState } from 'react';
import { Play, Square } from 'lucide-react';
import { useAppSettings } from '../stores/appSettingsStore';
import { useCanvasStore } from '../stores/canvasStore';
import { useCgPlayoutStore, LIBRARY_PREVIEW_LAYER, type CgLayer } from '../stores/cgPlayoutStore';
import { hasAnimationStates } from './CgChannelOutputPage';
import { WidgetRenderer } from './widgets/index';
import type { CanvasWidget } from '../types/canvas';

// The bar's original, fixed box size — now just the DEFAULT height (see
// appSettingsStore's cgMonitorBoxHeight) and the aspect ratio every other
// height derives its width from, via the resize handle below.
const DEFAULT_BOX_H = 124;
const BOX_ASPECT = 220 / DEFAULT_BOX_H;
const MAX_BOX_H_CEILING = 400;

// A broadcast-style Preview/Program monitor bank for one CG Playout
// channel — PROGRAM shows what's actually on air (status playing/stopping),
// PREVIEW shows what's cued and ready (status loaded, including
// CgTemplateLibraryGrid.tsx's own reserved LIBRARY_PREVIEW_LAYER), same
// PRV/PGM mental model this app already uses for vMix inputs, just for the
// CG side. PREVIEW renders on the left, PROGRAM on the right — same
// left-to-right "cue, then it becomes this" reading order a vision mixer's
// own Preview/Program pair conventionally uses. Two stacked bars at the top
// of the main content area (was a vertical right-hand sidebar before): a
// slim title bar (name/channel/collapse), then a dedicated bar holding just
// the boxes so resizing them doesn't jostle those controls around.
// Reads canvasStore/cgPlayoutStore directly rather than going through the
// `?cgChannel=` sync route — this main window already IS the sync host, so
// it already has the real state in the same process, no round-trip needed.
// PROGRAM mirrors the real output's In/Loop/Out animation (same
// hasAnimationStates/playPhase logic as CgChannelOutputPage.tsx) since it's
// meant to show what's actually on air — its own play phase/signals come
// straight from each layer's live `status` there's no other way to read.
// PREVIEW instead has its own small local Play/Stop toggle (previewPhase
// below) — deliberately never touching cgPlayoutStore/any layer's real
// `status`, so "just let me see the animation" can NEVER promote anything
// to Program or otherwise affect what's actually on air.
export function CgMonitorBar() {
  const { cgMonitorCollapsed, setCgMonitorCollapsed, cgMonitorChannel, setCgMonitorChannel, cgMonitorBoxHeight, setCgMonitorBoxHeight } = useAppSettings();
  const { pages, libraryPages } = useCanvasStore();
  const layers = useCgPlayoutStore((s) => s.layers);

  // PREVIEW's own local "play the animation" toggle — see the doc comment
  // above for why this is plain component state instead of routing through
  // playLayer()/stopLayer(). Reset back to "at rest" whenever a DIFFERENT
  // widget gets cued into the library-preview slot (comparing widgetId, not
  // just "any change" — reselecting the SAME template shouldn't reset an
  // animation already mid-flight) so switching templates in the library
  // never leaves the new one stuck showing a stale mid/end-of-animation
  // frame left over from whatever was cued there before.
  const [previewPhase, setPreviewPhase] = useState<'in' | 'out' | undefined>(undefined);
  const [previewPlaySignal, setPreviewPlaySignal] = useState(0);
  const libraryPreviewWidgetId = layers[`${cgMonitorChannel}-${LIBRARY_PREVIEW_LAYER}`]?.widgetId ?? null;
  const prevLibraryPreviewWidgetIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (libraryPreviewWidgetId !== prevLibraryPreviewWidgetIdRef.current) {
      prevLibraryPreviewWidgetIdRef.current = libraryPreviewWidgetId;
      setPreviewPhase(undefined);
    }
  }, [libraryPreviewWidgetId]);

  // The largest the boxes can grow before PROGRAM and PREVIEW would touch
  // both sides of the bar — measured from the bar's own actual rendered
  // width, so it stays correct as the window/sidebar resize. Padding/gap
  // are known constants matching .cgmon-topbar's own CSS (padding: 8px
  // 14px, gap: 18px) rather than read via getComputedStyle at runtime —
  // a WebKit quirk in resolving a flex container's column-gap as a plain
  // string (rather than reliably returning "18px") would silently turn
  // this into NaN, and NaN then poisons every value downstream (Math.min/
  // max/round all propagate it) — collapsing both boxes to an invalid
  // "NaNpx" size, which the browser just drops, leaving them sized by
  // nothing but their own position:absolute children (which contribute no
  // natural size) — i.e. invisible. Plain arithmetic on fixed numbers can't
  // fail that way.
  const BAR_PADDING_X = 14;
  const BOX_GAP = 18;
  const barRef = useRef<HTMLDivElement>(null);
  const [maxBoxH, setMaxBoxH] = useState(MAX_BOX_H_CEILING);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const recompute = () => {
      const available = el.clientWidth - BAR_PADDING_X * 2 - BOX_GAP;
      setMaxBoxH(Math.max(60, Math.min(MAX_BOX_H_CEILING, Math.floor(available / (2 * BOX_ASPECT)))));
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Dragging the handle along the bar's bottom edge resizes both boxes
  // together — width is derived to keep the shipped-with aspect ratio, so
  // there's one knob, not two, and the boxes always stay in proportion.
  // Capped at maxBoxH: the drag simply stops once PROGRAM/PREVIEW would
  // touch both sides of the bar, rather than overflowing it.
  const resizeRef = useRef<{ startY: number; startH: number } | null>(null);
  const onResizeDown = (e: React.PointerEvent) => {
    resizeRef.current = { startY: e.clientY, startH: cgMonitorBoxHeight };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onResizeMove = (e: React.PointerEvent) => {
    const r = resizeRef.current;
    if (!r) return;
    setCgMonitorBoxHeight(Math.min(r.startH + (e.clientY - r.startY), maxBoxH));
  };
  const onResizeUp = () => { resizeRef.current = null; };

  if (cgMonitorCollapsed) {
    return (
      <div className="cgmon-titlebar">
        <span className="cgmon-title">CG Monitor</span>
        <button className="sb-collapse-btn cgmon-collapse-btn" onClick={() => setCgMonitorCollapsed(false)} title="Expand CG monitor">▾</button>
      </div>
    );
  }

  const findWidget = (id: string) => [...pages, ...libraryPages].flatMap((p) => p.widgets).find((w) => w.id === id);
  const channelLayers = Object.values(layers).filter((l) => l.channel === cgMonitorChannel && l.widgetId);
  const programLayers = channelLayers.filter((l) => l.status === 'playing' || l.status === 'stopping').sort((a, b) => a.layer - b.layer);
  const previewLayers = channelLayers.filter((l) => l.status === 'loaded').sort((a, b) => a.layer - b.layer);
  // Also clamped on render (not just at drag-time) — if the window shrinks
  // after a large size was set, the boxes shrink to fit instead of forcing
  // horizontal scroll; the stored preference itself is untouched, so they
  // grow back to it once there's room again. Number.isFinite guards against
  // an invalid (NaN/Infinity) size ever reaching the DOM — a box sized off
  // a bad number doesn't just look wrong, the browser drops "NaNpx"
  // entirely, and with no CSS width/height left to fall back on and only
  // position:absolute children (which contribute no natural size), the box
  // collapses to invisible rather than merely wrong-sized.
  const boxH = Number.isFinite(maxBoxH) ? Math.min(cgMonitorBoxHeight, maxBoxH) : DEFAULT_BOX_H;
  const boxW = Number.isFinite(boxH) ? Math.round(boxH * BOX_ASPECT) : Math.round(DEFAULT_BOX_H * BOX_ASPECT);

  return (
    <>
      <div className="cgmon-titlebar">
        <span className="cgmon-title">CG Monitor</span>
        <div className="cgmon-channel-row">
          <label>Channel <input type="number" min={1} className="cgp-num-input" value={cgMonitorChannel}
            onChange={(e) => setCgMonitorChannel(Number(e.target.value) || 1)} /></label>
        </div>
        <button className="sb-collapse-btn cgmon-collapse-btn" onClick={() => setCgMonitorCollapsed(true)} title="Collapse CG monitor">▴</button>
      </div>

      <div className="cgmon-topbar" ref={barRef}>
        <div className="cgmon-box-wrap">
          <div className="cgmon-box-label-row">
            <div className="cgmon-box-label cgmon-box-label--pvw">PREVIEW</div>
            {previewLayers.length > 0 && (
              <div className="cgmon-preview-btns">
                <button onClick={() => { setPreviewPhase('in'); setPreviewPlaySignal((n) => n + 1); }} title="Play the cued template's animation — local to this box, never affects Program">
                  <Play size={11} strokeWidth={2} />
                </button>
                <button onClick={() => setPreviewPhase('out')} title="Play its Out animation">
                  <Square size={11} strokeWidth={2} />
                </button>
              </div>
            )}
          </div>
          <MonitorBox layers={previewLayers} findWidget={findWidget} boxW={boxW} boxH={boxH}
            animFor={() => (previewPhase ? { playPhase: previewPhase, playSignal: previewPlaySignal } : {})}
          />
        </div>

        <div className="cgmon-box-wrap">
          <div className="cgmon-box-label cgmon-box-label--pgm">PROGRAM</div>
          <MonitorBox layers={programLayers} findWidget={findWidget} boxW={boxW} boxH={boxH}
            animFor={(l) => ({ playPhase: l.status === 'playing' ? 'in' : 'out', continueSignal: l.continueSignal, loopSignal: l.loopSignal, playSignal: l.playSignal, playStartedAt: l.playStartedAt })}
          />
        </div>

        <div
          className="cgmon-resize-handle"
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          title="Drag to resize the monitor boxes"
        />
      </div>
    </>
  );
}

function MonitorBox({ layers, findWidget, boxW, boxH, animFor }: {
  layers: CgLayer[];
  findWidget: (id: string) => CanvasWidget | undefined;
  boxW: number; boxH: number;
  /** Returns the animation props to hand this one layer's WidgetRenderer —
   *  {} renders it at rest. PROGRAM derives playPhase from the layer's own
   *  live `status` (mirrors the real output exactly); PREVIEW's own caller
   *  instead returns ONE shared local phase/signal for every cued layer
   *  alike, regardless of `l` — see CgMonitorBar's own previewPhase doc
   *  comment for why that's local-only state, never cgPlayoutStore's. */
  animFor: (l: CgLayer) => { playPhase?: 'in' | 'out'; continueSignal?: number; loopSignal?: number; playSignal?: number; playStartedAt?: number };
}) {
  return (
    <div className="cgmon-box" style={{ width: boxW, height: boxH }}>
      {layers.map((l) => {
        const widget = findWidget(l.widgetId!);
        if (!widget) return null;
        const pinned = { ...widget, x: 0, y: 0, config: { ...widget.config, ...l.dataPatch } };
        const scale = Math.min(boxW / widget.w, boxH / widget.h, 1);
        const anim = hasAnimationStates(widget) ? animFor(l) : {};
        return (
          <div key={`${l.channel}-${l.layer}`} className="cgmon-box-layer" style={{ zIndex: l.layer }}>
            <div style={{ width: widget.w, height: widget.h, transform: `scale(${scale})` }}>
              <WidgetRenderer widget={pinned} outputOnly {...anim} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
