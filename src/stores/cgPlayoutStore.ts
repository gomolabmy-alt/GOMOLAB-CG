import { create } from 'zustand';
import { syncClient } from '../lib/syncClient';
import { useCanvasStore } from './canvasStore';
import { preloadTemplateAssets } from '../lib/templatePreload';

export type CgTransitionType = 'cut' | 'fade' | 'wipe';

/** Reserved layer number, on whichever channel the CG Monitor bar currently
 *  has selected, for CgTemplateLibraryGrid.tsx's own "click a thumbnail to
 *  cue it" feature — structurally impossible for a REAL on-air layer to
 *  ever collide with, since CgPlayoutPanel.tsx's own layer rows are always
 *  numbered 1..layerCount (never 0). Clicking a library thumbnail used to
 *  loadLayer() onto a user-configurable channel/layer pair, which could
 *  accidentally BE a layer the operator was actually running live —
 *  overwriting its widgetId and dropping it out of 'playing' status the
 *  moment a template got clicked while just browsing. Loading onto this
 *  fixed, reserved slot instead makes that collision impossible by
 *  construction rather than by operator care. */
export const LIBRARY_PREVIEW_LAYER = 0;

export interface CgLayer {
  channel: number;
  layer: number;
  /** The real CanvasWidget.id this layer is playing — a template is never
   *  cloned (that would break every linked*Id reference on it and defeat
   *  the point of reusing one template across plays). */
  widgetId: string | null;
  /** LOADBG-style preload target — armed but not yet visible. Not rendered
   *  anywhere by itself; PLAY promotes it to `widgetId`. */
  bgWidgetId: string | null;
  status: 'empty' | 'loaded' | 'playing' | 'stopping';
  /** Per-instance override merged over the template's own config at render
   *  time only (see CgChannelOutputPage) — NEVER written back into the
   *  template widget itself, so playing the same template twice with
   *  different data can't corrupt the shared original. */
  dataPatch: Record<string, any>;
  transitionIn: CgTransitionType;
  transitionOut: CgTransitionType;
  durationMs: number;
  /** Bumped by continueLayer() — a template's CgTemplateWidget instance
   *  watches this (threaded down as a prop, same as `status`) and resumes
   *  its "in" timeline past a stop point every time it changes. The value
   *  itself is meaningless, only the change is — see CgTemplateWidget.tsx. */
  continueSignal: number;
  /** Bumped by restartLoopLayer() — mirrors continueSignal exactly, but
   *  restarts the Loop timeline from its beginning instead of resuming the
   *  In timeline past a stop point. */
  loopSignal: number;
  /** Bumped by EVERY playLayer() call, even one that leaves `status` at
   *  'playing' unchanged (pressing Play/Cg.In again on something already on
   *  air) — CgTemplateWidget.tsx's playPhase effect depends on this too, so
   *  a repeat "go live" always forces a real restart from "in" instead of
   *  silently doing nothing because `status` (and therefore the derived
   *  `playPhase` prop) never actually changed value. */
  playSignal: number;
  /** Wall-clock `Date.now()` set whenever this layer actually goes live
   *  (every place `playSignal` bumps above also sets this) — lets a
   *  BRAND-NEW output client (e.g. "Send to Display" opened, or an NDI
   *  capture window, while this layer is already on air) tell "I'm the
   *  client this Play command was actually meant for" apart from "I'm a
   *  late joiner walking in on something already playing", which its own
   *  first render of `playPhase==='in'` can't otherwise distinguish (see
   *  CgTemplateWidget.tsx's own playPhase effect for how it uses this to
   *  skip straight to the settled Loop look instead of replaying the
   *  whole "in" animation from scratch for a late joiner — the "Send to
   *  Display program feed always restarts" bug this fixes). */
  playStartedAt: number;
  /** True from the moment loadLayer cues this layer until every image/
   *  sequence-frame asset it needs has finished preloading in THIS process
   *  (see lib/templatePreload.ts) — gates CgPlayoutPanel.tsx's Play button
   *  so playback never starts before everything it needs is already warm
   *  in cache (the actual fix for first-play stuttering on a sequence), AND
   *  gates CgChannelOutputPage.tsx's own render of this layer: `status` is
   *  a SHARED/synced field (driven by the host, or by whichever client's
   *  operator clicked Play), but this one is computed independently by
   *  EVERY connected client from its own local preload promise — a slower
   *  remote output client (a different machine/process entirely — a vMix/
   *  OBS Browser Source, a separate NDI capture window) can still be mid-
   *  preload even after `status` has already flipped to 'playing'
   *  elsewhere, and this is what lets THAT client hold off rendering until
   *  its own copy is actually ready, instead of showing it half-buffered. */
  preloading: boolean;
}

const key = (channel: number, layer: number) => `${channel}-${layer}`;

const DEFAULT_LAYER = (channel: number, layer: number): CgLayer => ({
  channel,
  layer,
  widgetId: null,
  bgWidgetId: null,
  status: 'empty',
  dataPatch: {},
  transitionIn: 'fade',
  transitionOut: 'fade',
  durationMs: 300,
  continueSignal: 0,
  loopSignal: 0,
  playSignal: 0,
  playStartedAt: 0,
  preloading: false,
});

export interface LoadLayerOptions {
  playOnLoad?: boolean;
  dataPatch?: Record<string, any>;
  transitionIn?: CgTransitionType;
  transitionOut?: CgTransitionType;
  durationMs?: number;
}

interface CgPlayoutStore {
  /** Sparse map keyed by "<channel>-<layer>" — absent entries are empty layers. */
  layers: Record<string, CgLayer>;

  loadLayer: (channel: number, layer: number, widgetId: string, opts?: LoadLayerOptions) => void;
  playLayer: (channel: number, layer: number) => void;
  stopLayer: (channel: number, layer: number) => void;
  /** Host-only follow-up to stopLayer, fired once the out-transition has had
   *  time to finish — see stopLayer's isHost-gated setTimeout below. Synced
   *  like any other action so every client converges on the same end state. */
  _finishStop: (channel: number, layer: number) => void;
  /** Host-only follow-up to a playOnLoad:true loadLayer() call, fired once
   *  its background preload (staged via bgWidgetId, never touching the
   *  layer's real widgetId/status) finishes — promotes it straight to
   *  widgetId/status:'playing' in one atomic step, so it never passes
   *  through a visible status:'loaded' (Preview) state at all. Synced like
   *  _finishStop, so every client converges on the same end state. */
  _promoteBg: (channel: number, layer: number, widgetId: string, opts: LoadLayerOptions) => void;
  updateLayer: (channel: number, layer: number, dataPatch: Record<string, any>) => void;
  /** Resumes a playing layer's "in" timeline past a `stops[]` pause point —
   *  a no-op if it isn't actually paused there. */
  continueLayer: (channel: number, layer: number) => void;
  /** Force-restarts a playing layer's Loop timeline from its beginning. */
  restartLoopLayer: (channel: number, layer: number) => void;
  clearLayer: (channel: number, layer: number) => void;
  clearChannel: (channel: number) => void;
  /** Applied from an incoming FULL_STATE snapshot — never re-sent (a remote
   *  client adopting the host's snapshot isn't a local mutation). */
  restorePlayout: (layers: Record<string, CgLayer>) => void;
}

export const useCgPlayoutStore = create<CgPlayoutStore>()((set, get) => ({
  layers: {},

  loadLayer: (channel, layer, widgetId, opts = {}) => {
    const k = key(channel, layer);
    // A cg-template with an authored Out animation knows its own real
    // out-transition length — prefer that over the generic default so the
    // host's stopLayer() timer (below) lines up with the actual GSAP
    // timeline instead of an arbitrary 300ms. Only used when the caller
    // didn't explicitly pass a durationMs of their own.
    // Templates live in the CG Template Library now, not necessarily Main Canvas.
    const { pages: cgPages, libraryPages: cgLibraryPages } = useCanvasStore.getState();
    const allPages = [...cgPages, ...cgLibraryPages];
    const templateWidget = allPages.flatMap((p) => p.widgets).find((w) => w.id === widgetId);
    const templateOutSeconds = templateWidget?.type === 'cg-template' ? templateWidget.config.states?.out?.duration : undefined;
    const resolvedDurationMs = opts.durationMs ?? (templateOutSeconds != null ? templateOutSeconds * 1000 : undefined);

    if (opts.playOnLoad) {
      // Straight-to-Program intent: stage in the background via bgWidgetId
      // instead of the real widgetId/status — the layer's actual on-screen
      // state (whatever's currently showing in Preview OR Program) is left
      // completely untouched for the whole preload window, so a play-intent
      // load never flashes into the Preview box the way a genuine "cue to
      // preview" load correctly does. _promoteBg (host-only, below) is what
      // actually cuts it to Program once it's ready.
      set((s) => {
        const existing = s.layers[k] ?? DEFAULT_LAYER(channel, layer);
        return { layers: { ...s.layers, [k]: { ...existing, bgWidgetId: widgetId, preloading: true } } };
      });
      syncClient.send({ type: 'ACTION', store: 'playout', fn: 'loadLayer', args: [channel, layer, widgetId, opts] });

      // Every connected client independently warms its own cache here (same
      // "no new sync message needed for the preload itself" reasoning the
      // preview-cue path below already relies on) — only the decision to
      // actually promote is host-gated. `preloading` itself is cleared
      // locally too (by THIS client, for THIS client's own copy of the
      // layer) rather than as part of _promoteBg's own replayed patch —
      // _promoteBg fires once the HOST's preload finishes and is replayed
      // onto every other client verbatim, which would otherwise force
      // `preloading: false` everywhere the instant the host is ready
      // regardless of whether a slower remote output client's OWN assets
      // have actually finished warming yet (the exact "still stutters
      // despite all this preload machinery" gap this fixes — see
      // CgChannelOutputPage.tsx's own render gate, which waits on this
      // per-client flag, not on `status` alone).
      (templateWidget ? preloadTemplateAssets(templateWidget, allPages) : Promise.resolve()).finally(() => {
        set((s) => {
          const cur = s.layers[k];
          // Superseded by a newer load/clear on this layer since — matches
          // against EITHER field since _promoteBg may have already moved
          // widgetId<-bgWidgetId on this client by the time this resolves.
          if (!cur || (cur.bgWidgetId !== widgetId && cur.widgetId !== widgetId)) return s;
          return { layers: { ...s.layers, [k]: { ...cur, preloading: false } } };
        });
        if (syncClient.isHost) get()._promoteBg(channel, layer, widgetId, { ...opts, durationMs: resolvedDurationMs });
      });
      return;
    }

    set((s) => {
      const existing = s.layers[k] ?? DEFAULT_LAYER(channel, layer);
      return {
        layers: {
          ...s.layers,
          [k]: {
            ...existing,
            widgetId,
            bgWidgetId: null,
            status: 'loaded',
            preloading: true,
            dataPatch: opts.dataPatch ?? {},
            transitionIn: opts.transitionIn ?? existing.transitionIn,
            transitionOut: opts.transitionOut ?? existing.transitionOut,
            durationMs: resolvedDurationMs ?? existing.durationMs,
          },
        },
      };
    });
    syncClient.send({ type: 'ACTION', store: 'playout', fn: 'loadLayer', args: [channel, layer, widgetId, opts] });

    // This function is replayed verbatim on EVERY connected sync client
    // (see initPlayoutSync's switch below) — the host, any in-app preview
    // window, and any external vMix/OBS Browser Source all independently
    // run this same preload in their own process, warming each one's own
    // image cache with no new sync message needed for that part.
    (templateWidget ? preloadTemplateAssets(templateWidget, allPages) : Promise.resolve()).finally(() => {
      set((s) => {
        const cur = s.layers[k];
        // Superseded by a newer load/clear on this layer since — don't
        // stomp on whatever's there now.
        if (!cur || cur.widgetId !== widgetId) return s;
        return { layers: { ...s.layers, [k]: { ...cur, preloading: false } } };
      });
    });
  },

  _promoteBg: (channel, layer, widgetId, opts) => {
    const k = key(channel, layer);
    set((s) => {
      const cur = s.layers[k];
      // Superseded by a newer load/arm/preview-cue on this layer since this
      // preload started — don't stomp on whatever's armed or showing now
      // ("latest intent wins", same philosophy the preview-cue path's own
      // widgetId guard above already uses).
      if (!cur || cur.bgWidgetId !== widgetId) return s;
      return {
        layers: {
          ...s.layers,
          [k]: {
            ...cur,
            bgWidgetId: null,
            widgetId,
            status: 'playing',
            // Deliberately NOT touched here — this whole patch is replayed
            // onto every other client the instant the HOST's own preload
            // finishes (see the syncClient.send below), which would
            // otherwise force every remote client's `preloading` to false
            // too regardless of whether ITS OWN assets have actually
            // finished warming — see loadLayer's own playOnLoad branch,
            // which clears this locally per-client from its own preload
            // promise instead.
            playSignal: cur.playSignal + 1,
            playStartedAt: Date.now(),
            dataPatch: opts.dataPatch ?? {},
            transitionIn: opts.transitionIn ?? cur.transitionIn,
            transitionOut: opts.transitionOut ?? cur.transitionOut,
            durationMs: opts.durationMs ?? cur.durationMs,
          },
        },
      };
    });
    syncClient.send({ type: 'ACTION', store: 'playout', fn: '_promoteBg', args: [channel, layer, widgetId, opts] });
  },

  playLayer: (channel, layer) => {
    const k = key(channel, layer);
    set((s) => {
      const existing = s.layers[k];
      if (!existing || !existing.widgetId) return s;
      // playSignal bumps unconditionally — status may already BE 'playing'
      // (Play/Cg.In pressed again on something already on air), in which
      // case that field alone wouldn't change value and wouldn't retrigger
      // anything watching it; this is the part that always does.
      return { layers: { ...s.layers, [k]: { ...existing, status: 'playing', playSignal: existing.playSignal + 1, playStartedAt: Date.now() } } };
    });
    syncClient.send({ type: 'ACTION', store: 'playout', fn: 'playLayer', args: [channel, layer] });
  },

  stopLayer: (channel, layer) => {
    const k = key(channel, layer);
    let durationMs = 300;
    set((s) => {
      const existing = s.layers[k];
      if (!existing || existing.status === 'empty') return s;
      durationMs = existing.durationMs;
      return { layers: { ...s.layers, [k]: { ...existing, status: 'stopping' } } };
    });
    syncClient.send({ type: 'ACTION', store: 'playout', fn: 'stopLayer', args: [channel, layer] });
    // Only the host schedules the follow-up clear — every other connected
    // client (including every open CG output window) just reacts to the
    // 'stopping' status arriving above and runs its own local out-transition;
    // if each of them also scheduled _finishStop, N clients would all race to
    // send the same clear.
    if (syncClient.isHost) {
      setTimeout(() => get()._finishStop(channel, layer), durationMs);
    }
  },

  _finishStop: (channel, layer) => {
    const k = key(channel, layer);
    set((s) => {
      const existing = s.layers[k];
      if (!existing || existing.status !== 'stopping') return s;
      return { layers: { ...s.layers, [k]: { ...existing, widgetId: null, dataPatch: {}, status: 'empty' } } };
    });
    syncClient.send({ type: 'ACTION', store: 'playout', fn: '_finishStop', args: [channel, layer] });
  },

  updateLayer: (channel, layer, dataPatch) => {
    const k = key(channel, layer);
    set((s) => {
      const existing = s.layers[k];
      if (!existing) return s;
      return { layers: { ...s.layers, [k]: { ...existing, dataPatch: { ...existing.dataPatch, ...dataPatch } } } };
    });
    syncClient.send({ type: 'ACTION', store: 'playout', fn: 'updateLayer', args: [channel, layer, dataPatch] });
  },

  continueLayer: (channel, layer) => {
    const k = key(channel, layer);
    set((s) => {
      const existing = s.layers[k];
      if (!existing) return s;
      return { layers: { ...s.layers, [k]: { ...existing, continueSignal: existing.continueSignal + 1 } } };
    });
    syncClient.send({ type: 'ACTION', store: 'playout', fn: 'continueLayer', args: [channel, layer] });
  },

  restartLoopLayer: (channel, layer) => {
    const k = key(channel, layer);
    set((s) => {
      const existing = s.layers[k];
      if (!existing) return s;
      return { layers: { ...s.layers, [k]: { ...existing, loopSignal: existing.loopSignal + 1 } } };
    });
    syncClient.send({ type: 'ACTION', store: 'playout', fn: 'restartLoopLayer', args: [channel, layer] });
  },

  clearLayer: (channel, layer) => {
    const k = key(channel, layer);
    set((s) => {
      if (!(k in s.layers)) return s;
      const rest = { ...s.layers };
      delete rest[k];
      return { layers: rest };
    });
    syncClient.send({ type: 'ACTION', store: 'playout', fn: 'clearLayer', args: [channel, layer] });
  },

  clearChannel: (channel) => {
    set((s) => {
      const rest: Record<string, CgLayer> = {};
      for (const [k, v] of Object.entries(s.layers)) if (v.channel !== channel) rest[k] = v;
      return { layers: rest };
    });
    syncClient.send({ type: 'ACTION', store: 'playout', fn: 'clearChannel', args: [channel] });
  },

  restorePlayout: (layers) => {
    // A late-joining client (an output window opened well after playback
    // already started, or any sync client reconnecting) otherwise adopts
    // the host's own snapshot verbatim — including `preloading: false` for
    // an already-'playing' layer — and starts rendering content it has
    // never actually fetched a single frame of itself in THIS process (the
    // "continue in feed" stutter: loadLayer's own per-client preload only
    // ever runs for a client that was already connected when Load/Play was
    // first issued). Kicks off this client's own local preload for
    // whichever layers reference a DIFFERENT widget than this client's
    // previous snapshot did, and keeps this client's own already-computed
    // `preloading` for anything unchanged (a snapshot's own `preloading`
    // value only ever reflects the HOST's process, never this one's).
    const prev = get().layers;
    const { pages: cgPages, libraryPages: cgLibraryPages } = useCanvasStore.getState();
    const allPages = [...cgPages, ...cgLibraryPages];
    const findWidget = (id: string | null) => (id ? allPages.flatMap((p) => p.widgets).find((w) => w.id === id) : undefined);
    const sameContent = (k: string, incoming: CgLayer) => {
      const p = prev[k];
      return !!p && p.widgetId === incoming.widgetId && p.bgWidgetId === incoming.bgWidgetId;
    };

    const merged: Record<string, CgLayer> = {};
    for (const [k, incoming] of Object.entries(layers)) {
      merged[k] = sameContent(k, incoming)
        ? { ...incoming, preloading: prev[k].preloading }
        : { ...incoming, preloading: !!(incoming.widgetId || incoming.bgWidgetId) };
    }
    set({ layers: merged });

    for (const [k, incoming] of Object.entries(layers)) {
      if (sameContent(k, incoming)) continue;
      const targetId = incoming.bgWidgetId ?? incoming.widgetId;
      const widget = findWidget(targetId);
      if (!widget) continue;
      preloadTemplateAssets(widget, allPages).finally(() => {
        set((s) => {
          const cur = s.layers[k];
          // Superseded by a newer load/clear on this layer since — don't
          // stomp on whatever's there now, same guard every other local
          // preload-completion callback in this file already uses.
          if (!cur || (cur.widgetId !== targetId && cur.bgWidgetId !== targetId)) return s;
          return { layers: { ...s.layers, [k]: { ...cur, preloading: false } } };
        });
      });
    }
  },
}));

// Resolves an AMCP "{template}" argument (a widget's label, falling back to
// its id) to a real widget id — used by initPlayoutSync's loadLayer case so
// the Rust AMCP listener never needs to know about CanvasWidget/pages at all,
// it just passes the raw string through.
export function resolveTemplateId(templateNameOrId: string): string | null {
  const { pages, libraryPages } = useCanvasStore.getState();
  const all = [...pages, ...libraryPages].flatMap((p) => p.widgets);
  return (all.find((w) => w.label === templateNameOrId) ?? all.find((w) => w.id === templateNameOrId))?.id ?? null;
}

// Mirrors initCanvasSync()'s switch-on-msg.fn dispatch — applies an incoming
// 'playout' ACTION by re-invoking the matching local mutator, following the
// exact same convention every other store's sync init uses.
export function initPlayoutSync() {
  syncClient.onMessage((msg) => {
    if (msg.type === 'FULL_STATE') {
      if (!syncClient.isHost && msg.playout) useCgPlayoutStore.getState().restorePlayout(msg.playout.layers);
      return;
    }
    if (msg.type !== 'ACTION' || msg.store !== 'playout') return;
    const store = useCgPlayoutStore.getState();
    switch (msg.fn) {
      case 'loadLayer': {
        let [channel, layer, widgetId, opts] = msg.args as [number, number, string, LoadLayerOptions | undefined];
        // AMCP sends a human-readable template name/label; resolve it to a
        // real widget id the same way a local ADD-by-name would. A local
        // caller (the UI) always passes an id directly, so resolving here is
        // a harmless no-op in that case (a matching id resolves to itself).
        widgetId = resolveTemplateId(widgetId) ?? widgetId;
        store.loadLayer(channel, layer, widgetId, opts);
        break;
      }
      case 'playLayer': store.playLayer(msg.args[0], msg.args[1]); break;
      case 'stopLayer': store.stopLayer(msg.args[0], msg.args[1]); break;
      case '_finishStop': store._finishStop(msg.args[0], msg.args[1]); break;
      case '_promoteBg': store._promoteBg(msg.args[0], msg.args[1], msg.args[2], msg.args[3]); break;
      case 'updateLayer': store.updateLayer(msg.args[0], msg.args[1], msg.args[2]); break;
      case 'continueLayer': store.continueLayer(msg.args[0], msg.args[1]); break;
      case 'restartLoopLayer': store.restartLoopLayer(msg.args[0], msg.args[1]); break;
      case 'clearLayer': store.clearLayer(msg.args[0], msg.args[1]); break;
      case 'clearChannel': store.clearChannel(msg.args[0]); break;
    }
  });
}
