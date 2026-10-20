// "On Value Change" transitions — see types/canvas.ts's CgChangeAnim and
// CgTemplateWidget.tsx's TemplateElementView, which detects a text/image
// element's resolved value actually changing (while already mounted, not on
// initial reveal) and plays one of these on the element's own node: an
// "out" half animates the OLD value away, `onSwap` fires at the midpoint to
// swap the actually-displayed value (React state, not a raw DOM mutation —
// see TemplateElementView's displayedValue), then an "in" half animates the
// NEW value into place. Every preset owns its own timing split (some split
// half/half, some bias toward a punchier entrance) but always finishes
// within roughly `duration` seconds and always ends at rest (opacity 1,
// identity transform/filter) — CgTemplateWidget.tsx never needs to know
// which preset played to clean up after it.
import { gsap } from 'gsap';

export type CgChangeAnimPreset =
  | 'fall' | 'slide' | 'zoom' | 'flip' | 'morph' | 'kinetic' | 'wobble' | 'glitch' | 'blur'
  | 'tracking' | 'reveal' | 'typewriter' | 'scramble' | 'digitMorph' | 'gooeyMorph';

/** typewriter/scramble mutate the element's actual characters over time
 *  (see buildTypewriterChange/buildScrambleChange below) — meaningless for
 *  an 'image' element's URL, so CgTemplateDesigner.tsx's preset dropdown
 *  hides these two unless the selected element is kind:'text'. digitMorph
 *  is even narrower (see lib/sevenSegment.ts) — a real SVG shape morph
 *  between seven-segment digit outlines, so it only actually animates
 *  digit/colon characters — but is still text-only for the same reason.
 *  gooeyMorph (see buildGooeyMorphFilter's own doc comment in cgEffects.ts)
 *  is text-only because it needs a REAL rendered glyph shape — an image's
 *  own crossfade has nothing comparable to melt between.
 *  Unlike every OTHER preset here, digitMorph/gooeyMorph are never
 *  dispatched through buildChangeTransition below at all — digitMorph
 *  needs per-SEGMENT DOM refs (7 per digit position), gooeyMorph needs TWO
 *  overlapping text nodes (the outgoing and incoming value, both visible
 *  and independently blurred/faded at once) rather than the single node
 *  every other preset here tweens+hard-swaps, so
 *  CgTemplateWidget.tsx's/CgTemplateDesigner.tsx's own value-change effect
 *  branches on both directly before ever calling this file. */
export const TEXT_ONLY_CHANGE_PRESETS = new Set<CgChangeAnimPreset>(['typewriter', 'scramble', 'digitMorph', 'gooeyMorph']);

export const CHANGE_ANIM_PRESETS: { value: CgChangeAnimPreset; label: string }[] = [
  { value: 'fall', label: 'Fall' },
  { value: 'slide', label: 'Slide' },
  { value: 'zoom', label: 'Zoom' },
  { value: 'flip', label: 'Flip' },
  { value: 'morph', label: 'Morph' },
  { value: 'kinetic', label: 'Kinetic' },
  { value: 'wobble', label: 'Wobble' },
  { value: 'glitch', label: 'Glitch' },
  { value: 'blur', label: 'Blur' },
  { value: 'tracking', label: 'Tracking' },
  { value: 'reveal', label: 'Reveal' },
  { value: 'typewriter', label: 'Typewriter' },
  { value: 'scramble', label: 'Scramble' },
  { value: 'digitMorph', label: 'Digit Morph (7-segment)' },
  { value: 'gooeyMorph', label: 'Gooey Morph' },
];

type Builder = (node: HTMLElement, distance: number, half: number, onSwap: () => void) => gsap.core.Timeline;

const BUILDERS: Record<Exclude<CgChangeAnimPreset, 'typewriter' | 'scramble' | 'digitMorph' | 'gooeyMorph'>, Builder> = {
  // Old drops down and fades out; new drops in from above and fades in —
  // a flip-board/odometer feel.
  fall: (node, distance, half, onSwap) =>
    gsap.timeline()
      .to(node, { y: distance, opacity: 0, duration: half, ease: 'power1.in' })
      .call(onSwap)
      .set(node, { y: -distance })
      .to(node, { y: 0, opacity: 1, duration: half, ease: 'power2.out' }),

  // Same idea, horizontal — old exits left, new enters from the right.
  slide: (node, distance, half, onSwap) =>
    gsap.timeline()
      .to(node, { x: -distance, opacity: 0, duration: half, ease: 'power1.in' })
      .call(onSwap)
      .set(node, { x: distance })
      .to(node, { x: 0, opacity: 1, duration: half, ease: 'power2.out' }),

  // Camera-style zoom: old grows past the viewer and fades, new grows in
  // from tiny with a slight overshoot settle.
  zoom: (node, _distance, half, onSwap) =>
    gsap.timeline()
      .to(node, { scale: 1.6, opacity: 0, duration: half, ease: 'power1.in' })
      .call(onSwap)
      .set(node, { scale: 0.4 })
      .to(node, { opacity: 1, duration: half * 0.6, ease: 'power2.out' })
      .to(node, { scale: 1, duration: half, ease: 'back.out(1.7)' }, '<'),

  // 3D card flip — needs its own transformPerspective (GSAP applies this
  // straight to the node, no separate parent-perspective wrapper needed).
  flip: (node, _distance, half, onSwap) =>
    gsap.timeline()
      .to(node, { rotationX: 90, opacity: 0, duration: half, ease: 'power1.in', transformPerspective: 700 })
      .call(onSwap)
      .set(node, { rotationX: -90 })
      .to(node, { rotationX: 0, opacity: 1, duration: half, ease: 'power2.out' }),

  // Non-uniform squash/stretch (scaleX/scaleY independently) rather than a
  // uniform zoom — reads as one shape liquidly reshaping into the next,
  // settling with a soft elastic wobble rather than a hard stop. Opacity
  // gets its own plain-eased tween running in parallel ('<' = same start
  // time as the scale tween) rather than sharing the elastic ease — an
  // elastic/back ease overshoots its target as part of the curve, which
  // reads fine for a transform but would briefly compute opacity > 1 (the
  // browser just clamps it, so harmless, but not a value worth writing).
  morph: (node, _distance, half, onSwap) =>
    gsap.timeline()
      .to(node, { scaleX: 1.3, scaleY: 0.2, opacity: 0, duration: half, ease: 'power2.in' })
      .call(onSwap)
      .set(node, { scaleX: 1.3, scaleY: 0.2 })
      .to(node, { opacity: 1, duration: half * 0.6, ease: 'power2.out' })
      .to(node, { scaleX: 1, scaleY: 1, duration: half * 1.4, ease: 'elastic.out(1, 0.6)' }, '<'),

  // Punchy/energetic kinetic-typography throw: a quick, hard exit and a
  // snappier, slightly longer entrance with a strong overshoot — kinetic
  // type reads as fast and springy, not evenly-paced like fall/slide.
  // Opacity split out same as morph's, for the same reason.
  kinetic: (node, distance, half, onSwap) =>
    gsap.timeline()
      .to(node, { x: -distance * 1.4, rotation: -10, opacity: 0, duration: half * 0.65, ease: 'power2.in' })
      .call(onSwap)
      .set(node, { x: distance * 1.4, rotation: 10 })
      .to(node, { opacity: 1, duration: half * 0.7, ease: 'power2.out' })
      .to(node, { x: 0, rotation: 0, duration: half * 1.35, ease: 'back.out(2.6)' }, '<'),

  // Elastic wiggle on rotation+scale — the new value jiggles into place
  // rather than arriving cleanly. Opacity split out same as morph's.
  wobble: (node, _distance, half, onSwap) =>
    gsap.timeline()
      .to(node, { rotation: 12, scale: 0.9, opacity: 0, duration: half, ease: 'power1.in' })
      .call(onSwap)
      .set(node, { rotation: -12, scale: 0.9 })
      .to(node, { opacity: 1, duration: half * 0.6, ease: 'power2.out' })
      .to(node, { rotation: 0, scale: 1, duration: half * 1.5, ease: 'elastic.out(1, 0.5)' }, '<'),

  // Not a smooth two-phase tween — a handful of rapid, random small jumps
  // (a "corrupted signal") on both sides of the swap, settling cleanly at
  // the end. Genuine RGB-channel-split glitches need multiple layered
  // clones this single node doesn't have; this is the same idea's spirit
  // (jittery, unstable, then resolves) without that extra machinery.
  glitch: (node, distance, half, onSwap) => {
    const tl = gsap.timeline();
    const steps = 6;
    const stepDur = Math.max(0.02, half / steps);
    const jitter = Math.max(6, distance * 0.4);
    for (let i = 0; i < steps; i++) {
      tl.to(node, { x: (Math.random() - 0.5) * jitter, opacity: Math.random() > 0.35 ? 1 : 0.25, duration: stepDur, ease: 'none' });
    }
    tl.call(onSwap);
    for (let i = 0; i < steps; i++) {
      tl.to(node, { x: (Math.random() - 0.5) * jitter, opacity: Math.random() > 0.35 ? 1 : 0.25, duration: stepDur, ease: 'none' });
    }
    tl.to(node, { x: 0, opacity: 1, duration: Math.max(0.05, half * 0.4), ease: 'power2.out' });
    return tl;
  },

  // Pure focus pull, no movement at all — the subtlest option.
  blur: (node, _distance, half, onSwap) =>
    gsap.timeline()
      .to(node, { filter: 'blur(18px)', opacity: 0, duration: half, ease: 'power1.in' })
      .call(onSwap)
      .set(node, { filter: 'blur(18px)' })
      .to(node, { filter: 'blur(0px)', opacity: 1, duration: half, ease: 'power2.out' }),

  // After Effects' classic "Tracking In/Out" text animator — letters spread
  // apart and fade as the old value leaves, the new value's letters start
  // spread apart and pull together into normal spacing as it fades in. An
  // explicit .set() to a numeric baseline first: the element's own
  // letter-spacing is 'normal' (a keyword, not a length) until something
  // sets a real value, and GSAP can't tween FROM a keyword.
  tracking: (node, _distance, half, onSwap) =>
    gsap.timeline()
      .set(node, { letterSpacing: '0em' })
      .to(node, { letterSpacing: '0.6em', opacity: 0, duration: half, ease: 'power1.in' })
      .call(onSwap)
      .set(node, { letterSpacing: '0.6em' })
      .to(node, { letterSpacing: '0em', opacity: 1, duration: half, ease: 'power2.out' }),

  // A clip-path wipe rather than a fade — the old value is erased by a
  // moving edge, the new one is revealed by the same edge continuing past
  // it, like a wipe transition. No opacity involved at all, unlike every
  // other preset here — clip-path alone fully hides each side already.
  reveal: (node, _distance, half, onSwap) =>
    gsap.timeline()
      .set(node, { clipPath: 'inset(0% 0% 0% 0%)' })
      .to(node, { clipPath: 'inset(0% 0% 0% 100%)', duration: half, ease: 'power1.in' })
      .call(onSwap)
      .set(node, { clipPath: 'inset(0% 0% 0% 100%)' })
      .to(node, { clipPath: 'inset(0% 0% 0% 0%)', duration: half, ease: 'power2.out' }),
};

// ── Text-content presets (typewriter/scramble) ──────────────────────────
// These don't tween a transform/filter property at all — they mutate the
// node's actual characters over a series of `tl.call()` steps, the exact
// same technique cgAnimationEngine.ts's own buildTypewriter/buildScramble
// already use for the In/Out states (see those for the original algorithm
// this mirrors). `onSwap` still fires, but only once, at the very end —
// there's no separate "old fades, new fades in" swap point to hook since
// the whole transition IS the reveal; its only job here is handing
// TemplateElementView's `displayedValue` React state the final value so a
// later unrelated re-render doesn't stomp these direct textContent writes
// back to something stale.
type TextBuilder = (node: HTMLElement, from: string, to: string, duration: number, onSwap: () => void) => gsap.core.Timeline;

const TEXT_BUILDERS: Record<'typewriter' | 'scramble', TextBuilder> = {
  // Backspaces the old value away character by character, then types the
  // new one in the same way.
  typewriter: (node, from, to, duration, onSwap) => {
    const totalChars = from.length + to.length;
    const stepDur = totalChars > 0 ? duration / totalChars : duration;
    const tl = gsap.timeline();
    let t = 0;
    for (let i = from.length; i >= 0; i--) { tl.call(() => { node.textContent = from.substring(0, i); }, undefined, t); t += stepDur; }
    for (let i = 1; i <= to.length; i++) { tl.call(() => { node.textContent = to.substring(0, i); }, undefined, t); t += stepDur; }
    tl.call(onSwap, undefined, t);
    return tl;
  },
  // A "decrypting" reveal — random characters progressively lock in as the
  // correct ones, left to right, while the string's own length also
  // interpolates from the old value's length to the new one's.
  scramble: (node, from, to, duration, onSwap) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const steps = 16;
    const stepDur = duration / steps;
    const tl = gsap.timeline();
    for (let s = 0; s <= steps; s++) {
      const progress = s / steps;
      tl.call(() => {
        const len = Math.round(from.length + (to.length - from.length) * progress);
        const lockedCount = Math.round(to.length * progress);
        let result = '';
        for (let i = 0; i < len; i++) result += i < lockedCount ? to[i] : chars[Math.floor(Math.random() * chars.length)];
        node.textContent = result;
      }, undefined, s * stepDur);
    }
    tl.call(() => { node.textContent = to; }, undefined, duration);
    tl.call(onSwap, undefined, duration);
    return tl;
  },
};

/** Builds and returns the ready-to-play (not yet started) timeline for one
 *  value-change transition — caller (CgTemplateWidget.tsx) owns actually
 *  playing it (gsap.timeline() autoplays by default) and killing any
 *  still-running one before starting a new one. `distance` is a px offset
 *  scaled to the element's own size (see TemplateElementView) — presets
 *  that don't move the element ignore it. `textValues` (the old and new
 *  strings) is only needed for — and only used by — typewriter/scramble;
 *  pass it whenever the element is kind:'text' regardless of which preset
 *  is selected, since every other preset simply ignores it. Unknown/
 *  removed preset names (an older template, or typewriter/scramble
 *  requested without textValues because the element isn't text) fall back
 *  to 'fall', never a crash. */
export function buildChangeTransition(
  preset: string,
  node: HTMLElement,
  distance: number,
  duration: number,
  onSwap: () => void,
  textValues?: { from: string; to: string }
): gsap.core.Timeline {
  if (textValues && (preset === 'typewriter' || preset === 'scramble')) {
    return TEXT_BUILDERS[preset](node, textValues.from, textValues.to, duration, onSwap);
  }
  const half = Math.max(0.05, duration / 2);
  const builder = BUILDERS[preset as Exclude<CgChangeAnimPreset, 'typewriter' | 'scramble' | 'digitMorph' | 'gooeyMorph'>] ?? BUILDERS.fall;
  return builder(node, distance, half, onSwap);
}
