import { useEffect, useRef, useState } from 'react';
import { resolveImageUrl } from './imageUrl';
import { preloadImageUrls, isImagePreloaded } from './templatePreload';

/** How many frames get fetched up front before playback starts — the rest
 *  stream in afterward, in the background. A round number rather than
 *  anything tied to `fps`/duration: it's just enough to cover the
 *  perceptibly-instant opening moment of a loop, not a fixed TIME budget. */
const SEQUENCE_LOOP_HEAD_START_FRAMES = 6;

/** How long to wait before retrying a frame whose own fetch failed/timed
 *  out (templatePreload.ts's own preloadOne resolves either way on error,
 *  without ever adding a failed URL to its confirmedLoaded cache) — WITHOUT
 *  this, a single transient failure (a momentary network hiccup, the
 *  server's own zip-archive read briefly contending with something else)
 *  blacklisted that one frame for the rest of the session: the next time
 *  the loop came back around to that same index, the old "already
 *  attempted" guard saw it as already-tried and never asked again, so that
 *  one frame just silently never showed again — "random missing part
 *  after a while" from the outside, since every OTHER frame kept working
 *  fine. Retrying after a cooldown instead of once-ever is what fixes it:
 *  a real, permanent problem (frame genuinely gone) just keeps retrying
 *  forever at this same low rate, which costs nothing. */
const SEQUENCE_LOOP_RETRY_COOLDOWN_MS = 2000;

/** The two stacked, absolutely-positioned DOM nodes a looping sequence
 *  renders (see the two renderers' own 'sequence' JSX) — `a`/`b`, not
 *  "front"/"back", since which one is actually on top changes every frame
 *  advance; this hook alone tracks which is currently which. */
export interface SequenceLoopLayers {
  a: HTMLElement | null | undefined;
  b: HTMLElement | null | undefined;
}

/** Keeps a looping 'sequence' element's own frames cycling continuously,
 *  completely independent of the GSAP in/loop/out state machine — same
 *  "just keeps going the whole time this element is on screen" convention
 *  lib/useFlagWave.ts/useWaveWarp.ts and a Ticker's own scroll already use.
 *
 *  An earlier attempt instead nested a repeat(-1) GSAP timeline inside the
 *  state's own timeline (see cgAnimationEngine.ts's buildSequencePlayback)
 *  — that silently never actually looped: a child timeline added to a
 *  parent via `.add()` is driven by the PARENT's own playhead, not an
 *  independent clock, so a parent that itself only plays once (no authored
 *  Loop state) never gives the nested repeat anywhere to repeat INTO. A
 *  plain rAF loop, reading real elapsed time directly, sidesteps that
 *  entirely.
 *
 *  Only a HEAD-START batch of frames is preloaded before the loop starts
 *  ticking — every other frame streams in afterward, in the background,
 *  without blocking playback (the same "Smart Image Loading: only a few
 *  images are fetched on page load, the remaining ones load in the
 *  background" strategy scrollsequence.com documents for its own
 *  scroll-scrubbed sequences — not directly applicable here since a
 *  broadcast CG output has no scrolling, but the loading STRATEGY itself
 *  carries over cleanly). Returns `true` while that initial head-start
 *  batch is still in progress, so the caller can show an explicit loading
 *  placeholder on the element itself instead of a blank hole.
 *
 *  DOUBLE-BUFFERED frame advance (`layers.a`/`layers.b`) is what actually
 *  guarantees no stutter/blink for every frame AFTER that head-start, not
 *  just the first one: advancing to the next frame paints it into the
 *  currently-HIDDEN layer first, and only flips which layer is visible
 *  once that frame is confirmed loaded (`isImagePreloaded`) — a frame
 *  whose own fetch hasn't finished yet simply doesn't advance the visible
 *  layer at all, so whatever was already on screen just keeps showing
 *  (a real hold, not a blank gap) until the next one is actually ready.
 *  `blendMs` (0 = instant cut, the default) makes that flip a CSS opacity
 *  crossfade over that many ms instead of an instant swap — a purely
 *  cosmetic choice layered on top of the same hold-until-ready mechanism,
 *  not a replacement for it.
 *
 *  `startedAt` anchors the frame clock to a real wall-clock instant (see
 *  cgPlayoutStore.ts's own CgLayer.playStartedAt) rather than this
 *  component's own mount time — so a late-joining/reconnecting output
 *  client's sequence lands on the SAME frame a client that's been open the
 *  whole time would already be showing ("continue in feed"), instead of
 *  every remount restarting the loop from frame 0. Falls back to this
 *  hook's own first-enabled instant when no `startedAt` is given (the
 *  Designer's own live preview, which has no playout concept at all). */
export function useSequenceLoop(
  enabled: boolean,
  getLayers: () => SequenceLoopLayers,
  frames: string[],
  fps: number,
  startedAt: number | undefined,
  blendMs: number,
): boolean {
  // `getLayers` is a fresh inline closure at every call site, every render
  // — putting it straight in the effect's own deps array (an earlier
  // version of this hook did, for a single-node getter) meant the effect
  // below tore down and rebuilt on EVERY re-render, resetting the frame
  // clock's own anchor back to "right now" each time. The "latest ref"
  // pattern below reads whatever `getLayers` currently is at tick time,
  // without it ever being a dependency the effect restarts over.
  const getLayersRef = useRef(getLayers);
  getLayersRef.current = getLayers;
  const framesKey = frames.join('|');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || frames.length === 0) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);

    const frameDuration = 1 / Math.max(1, fps);
    const anchor = startedAt ?? Date.now();
    const transition = blendMs > 0 ? `opacity ${blendMs}ms linear` : 'none';

    // Which of layers.a/layers.b is currently the VISIBLE one — flips every
    // time the displayed frame actually advances (see tick() below).
    let front: 'a' | 'b' = 'a';
    // The frame index actually ON SCREEN right now — deliberately NOT the
    // same as "whichever index elapsed time says we should be at": those
    // two only stay equal when every frame loads fast enough to keep up;
    // when one doesn't, this just holds at its last value instead.
    let displayedIdx = -1;
    // When a not-yet-ready frame's own fetch was last (re)kicked off, keyed
    // by url — guards against re-requesting the exact same frame on every
    // single tick while waiting for it (preloadImageUrls' own
    // confirmedLoaded cache already makes a repeat call cheap, but there's
    // no reason to call it 60 times a second either), while still allowing
    // a RETRY after SEQUENCE_LOOP_RETRY_COOLDOWN_MS instead of giving up on
    // that frame forever the first time it fails — see that constant's own
    // doc comment for why a one-shot-only guard caused frames to silently
    // vanish for good after a transient failure.
    const lastAttemptAt = new Map<string, number>();

    const applyLayerOpacity = () => {
      const layers = getLayersRef.current();
      const frontNode = front === 'a' ? layers.a : layers.b;
      const backNode = front === 'a' ? layers.b : layers.a;
      if (frontNode) { frontNode.style.transition = transition; frontNode.style.opacity = '1'; }
      if (backNode) { backNode.style.transition = transition; backNode.style.opacity = '0'; }
    };

    let raf: number;
    const tick = () => {
      if (cancelled) return;
      const elapsedSec = (Date.now() - anchor) / 1000;
      const targetIdx = Math.floor(elapsedSec / frameDuration) % frames.length;

      if (targetIdx !== displayedIdx) {
        const url = frames[targetIdx];
        if (isImagePreloaded(url)) {
          const layers = getLayersRef.current();
          const backNode = front === 'a' ? layers.b : layers.a;
          if (backNode) backNode.style.backgroundImage = `url("${resolveImageUrl(url)}")`;
          front = front === 'a' ? 'b' : 'a';
          applyLayerOpacity();
          displayedIdx = targetIdx;
          lastAttemptAt.delete(url);
        } else {
          const last = lastAttemptAt.get(url);
          const now = Date.now();
          if (last === undefined || now - last >= SEQUENCE_LOOP_RETRY_COOLDOWN_MS) {
            lastAttemptAt.set(url, now);
            preloadImageUrls([url]);
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };

    const headStart = frames.slice(0, Math.min(frames.length, SEQUENCE_LOOP_HEAD_START_FRAMES));
    const rest = frames.slice(headStart.length);
    preloadImageUrls(headStart).then(() => {
      if (cancelled) return;
      setLoading(false);
      // Paint frame 0 into the initial front layer (`a`) BEFORE the first
      // tick, so there's no blank instant waiting for tick() to run once.
      const layers = getLayersRef.current();
      if (layers.a) layers.a.style.backgroundImage = `url("${resolveImageUrl(frames[0])}")`;
      displayedIdx = 0;
      applyLayerOpacity();
      raf = requestAnimationFrame(tick);
      preloadImageUrls(rest); // background — doesn't gate playback starting
    });
    return () => { cancelled = true; cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, framesKey, fps, startedAt, blendMs]);

  return enabled && loading;
}
