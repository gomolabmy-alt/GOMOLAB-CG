import { useEffect, useState } from 'react';
import { useCanvasStore } from '../stores/canvasStore';
import { useCgPlayoutStore } from '../stores/cgPlayoutStore';
import { useAppSettings } from '../stores/appSettingsStore';
import { useTransparentBackground } from '../lib/transparentPage';
import { type CgOutputMode, cgOutputBackground, cgKeyFilter } from '../lib/cgOutputMode';
import { primeAudio } from '../lib/sfxLibrary';
import { CgTransition } from './CgTransition';
import { WidgetRenderer } from './widgets/index';
import type { CanvasWidget } from '../types/canvas';

// A 'cg-template' widget with at least one authored animation state plays
// its own GSAP-driven In/Loop/Out (see CgTemplateWidget.tsx) instead of the
// generic cut/fade/wipe every other widget type gets from CgTransition —
// every other widget/layer is completely unaffected by this.
export function hasAnimationStates(widget: CanvasWidget): boolean {
  if (widget.type !== 'cg-template') return false;
  const states = widget.config.states;
  return !!(states?.in?.layers?.length || states?.loop?.layers?.length || states?.out?.layers?.length);
}

// Reference broadcast frame (matches WIDGET_DEFAULTS['cg-template']'s own
// 1920×1080) that every layer's content is authored/positioned against.
// The window this page actually renders in — a vMix/OBS Browser Source set
// to exactly this resolution, or the app's own smaller "Preview" window —
// isn't guaranteed to match it pixel-for-pixel, so the whole channel is
// scaled (and centered/letterboxed) to fit whatever viewport it's given,
// the same "shrink a real render to fit a box" trick already used by
// CgMonitorBar.tsx/CgTemplateLibraryGrid.tsx. A correctly-configured
// capture source sized to exactly 1920×1080 gets scale=1 — pixel-identical
// to before this existed — so this is a pure robustness fix, not a
// behavior change for anyone already set up right.
const CHANNEL_W = 1920;
const CHANNEL_H = 1080;

function useViewportSize() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

// Root component for the CasparCG-style "own CG" channel route —
// `?cgChannel=<n>` — the multi-layer counterpart to CgOutputPage.tsx's
// single-widget `?cgOutput=<id>`. Renders every layer LOADed/PLAYing on this
// channel, stacked bottom-to-top by layer number, each running its own
// in/out transition independently. Like CgOutputPage.tsx this is a pure sync
// client (readonly port, or an in-app preview window) — it never assumes
// it's the host, and never mutates playout state itself.
//
// v1 scope: layers stack by z-order only, each pinned to (0,0) sized to its
// own widget's w/h — there's no per-layer repositioning within the channel's
// frame (that would be a mini compositor/editor of its own).
//
// `mode` — see lib/cgOutputMode.ts — lets the SAME channel be captured as
// three separate Browser Sources (`?cgChannel=1`, `?cgChannel=1&mode=fill`,
// `?cgChannel=1&mode=key`), the CasparCG Fill+Key+Screen model, for vMix/
// OBS's own DeckLink output to drive real Fill/Key/Monitor SDI feeds from.
export function CgChannelOutputPage({ channel, mode = 'monitor' }: { channel: number; mode?: CgOutputMode }) {
  const { pages, libraryPages } = useCanvasStore();
  const layers = useCgPlayoutStore((s) => s.layers);
  const { cgMonitorBg, cgMonitorBgColor } = useAppSettings();
  const background = cgOutputBackground(mode, cgMonitorBg, cgMonitorBgColor);
  useTransparentBackground(background);
  // Same headless-autoplay concern as CgOutputPage.tsx: nobody ever clicks
  // into this page, so without this a layer's soundEffect would build fine
  // and never be heard on the real output.
  useEffect(() => { primeAudio(); }, []);
  const { w: vw, h: vh } = useViewportSize();
  const scale = Math.min(vw / CHANNEL_W, vh / CHANNEL_H) || 1;

  // Templates live in the CG Template Library now, not necessarily Main
  // Canvas — a played layer's widget can be in either.
  const findWidget = (id: string) => [...pages, ...libraryPages].flatMap((p) => p.widgets).find((w) => w.id === id);

  const channelLayers = Object.values(layers)
    .filter((l) => l.channel === channel && l.widgetId)
    .sort((a, b) => a.layer - b.layer);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh', background, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {/* The key filter is scoped to just this inner box (the actual
         composited frame), not the outer full-viewport div above — that
         outer div's own plain background is what shows in any letterbox/
         pillarbox margin around it, and needs to stay true solid black
         there (correctly reading as "fully transparent" on a Key output)
         rather than also being inverted to white by the same filter. */}
      <div style={{ position: 'relative', width: CHANNEL_W, height: CHANNEL_H, flexShrink: 0, transform: `scale(${scale})`, filter: cgKeyFilter(mode) }}>
        {channelLayers.map((l) => {
          const widget = findWidget(l.widgetId!);
          // Widget deleted from the canvas since being loaded, or state hasn't
          // arrived yet over the sync connection — render nothing for this
          // layer rather than a placeholder (same call CgOutputPage.tsx makes).
          if (!widget) return null;
          const pinned = { ...widget, x: 0, y: 0, config: { ...widget.config, ...l.dataPatch } };

          // `l.preloading` is computed independently by THIS client from its
          // own local image cache (see cgPlayoutStore.ts's own doc comment
          // on CgLayer.preloading) — `l.status` alone can already say
          // 'playing' (driven by the host, or by whichever remote client's
          // operator clicked Play) while THIS client's own copy of a
          // sequence/image's frames hasn't actually finished warming yet.
          // Staying invisible until this flips false is what makes a layer
          // go on air already 100% buffered here, instead of visibly
          // stuttering through its first pass while frames fetch on demand.
          if (l.status === 'playing' && l.preloading) return null;

          if (hasAnimationStates(widget)) {
            // 'loaded' (cued, not yet played) stays fully invisible, same as
            // the generic path below does before it's ever gone active.
            if (l.status !== 'playing' && l.status !== 'stopping') return null;
            return (
              <div key={`${l.channel}-${l.layer}`} style={{ position: 'absolute', top: 0, left: 0, width: widget.w, height: widget.h, zIndex: l.layer }}>
                <WidgetRenderer widget={pinned} outputOnly playPhase={l.status === 'playing' ? 'in' : 'out'} continueSignal={l.continueSignal} loopSignal={l.loopSignal} playSignal={l.playSignal} playStartedAt={l.playStartedAt} />
              </div>
            );
          }

          // 'loaded' (LOAD/ADD without play-on-load) is cued but not yet on
          // air — only 'playing' should actually be visible; 'stopping' also
          // passes `active:false` here so the existing out-transition runs.
          const active = l.status === 'playing';
          return (
            <CgTransition
              key={`${l.channel}-${l.layer}`}
              active={active}
              type={active ? l.transitionIn : l.transitionOut}
              durationMs={l.durationMs}
            >
              <div style={{ position: 'absolute', top: 0, left: 0, width: widget.w, height: widget.h, zIndex: l.layer }}>
                <WidgetRenderer widget={pinned} outputOnly />
              </div>
            </CgTransition>
          );
        })}
      </div>
    </div>
  );
}
