// Animation playback engine — ported from gfx-studio-2's shared/buildTimeline.js
// (a separate, already-working broadcast-graphics app), retargeted from
// "create DOM then animate it" to "animate DOM elements React already
// rendered" (see CgTemplateWidget.tsx). The tween/keyframe/preset logic
// itself is unchanged from the original — same GSAP calls, same defaults.
import { gsap } from 'gsap';
import { MorphSVGPlugin } from 'gsap/MorphSVGPlugin';
import { PRESETS, OUT_PRESETS } from './cgPresets';
import { resolveImageUrl } from './imageUrl';
import { resolveEase, invertEaseName } from './easeUtils';
import { playSfx } from './sfxLibrary';
import { buildFilterString, parseEffectTrackKey, withLiveEffectValue } from './cgEffects';
import { TEXT_REVEAL_STYLES, splitTextIntoUnits } from './textReveal';
import type { CgAnimState, CgEffect, CgKeyframe, CgLayerAnim, CgStepState, CgWordSequenceItem, TemplateElement } from '../types/canvas';

// Free since GSAP 3.13 — no club-membership key needed, just registration.
gsap.registerPlugin(MorphSVGPlugin);

export type CgStateName = 'in' | 'loop' | 'out';

/** Builds one GSAP timeline per authored state, targeting the given DOM
 *  refs (keyed by TemplateElement.id — see CgTemplateWidget.tsx/
 *  CgTemplateDesigner.tsx, both of which keep a ref per rendered element).
 *  `effectRefs`/`effectProxies` are optional (default to empty) so any
 *  caller that predates keyframeable effects keeps compiling unchanged —
 *  see buildEffectKeyframeTracks below for what they're for. */
export function buildStateTimelines(
  states: Partial<Record<CgStateName, CgAnimState>> | undefined,
  templateElements: TemplateElement[],
  refs: Record<string, HTMLElement | null>,
  effectRefs: Record<string, HTMLElement | null> = {},
  effectProxies: Record<string, Record<string, any>> = {}
): Partial<Record<CgStateName, gsap.core.Timeline>> {
  const timelines: Partial<Record<CgStateName, gsap.core.Timeline>> = {};
  if (!states) return timelines;

  (Object.entries(states) as [CgStateName, CgAnimState][]).forEach(([stateName, stateConfig]) => {
    timelines[stateName] = buildOneTimeline(stateConfig, { isInState: stateName === 'in', isOutState: stateName === 'out' }, templateElements, refs, effectRefs, effectProxies);
  });

  return timelines;
}

/** Builds every Step's timeline, in order — a Step is never "in" (never
 *  hidden-until-revealed the way "in" is) and never "out" (always a
 *  `.from()`-style reveal via the regular PRESETS, never OUT_PRESETS) — it
 *  always starts from whatever state In (or the previous Step) already
 *  left visible. See widgets/CgTemplateWidget.tsx's playback effect for how
 *  the sequence actually advances between them. */
export function buildStepTimelines(
  steps: CgStepState[] | undefined,
  templateElements: TemplateElement[],
  refs: Record<string, HTMLElement | null>,
  effectRefs: Record<string, HTMLElement | null> = {},
  effectProxies: Record<string, Record<string, any>> = {}
): gsap.core.Timeline[] {
  if (!steps?.length) return [];
  return steps.map((step) => buildOneTimeline(step, { isInState: false, isOutState: false }, templateElements, refs, effectRefs, effectProxies));
}

/** Shared per-state build logic — the inner loop `buildStateTimelines` and
 *  `buildStepTimelines` both need, extracted so step timelines get the
 *  exact same keyframe/preset/stops/loop handling "in"/"loop"/"out" already
 *  have, without duplicating it. */
function buildOneTimeline(
  stateConfig: CgAnimState,
  flags: { isInState: boolean; isOutState: boolean },
  templateElements: TemplateElement[],
  refs: Record<string, HTMLElement | null>,
  effectRefs: Record<string, HTMLElement | null>,
  effectProxies: Record<string, Record<string, any>>
): gsap.core.Timeline {
  const tl = gsap.timeline({ paused: true });
  const layers = stateConfig.layers || [];

  layers.forEach((layerAnim) => {
    const baseElement = templateElements.find((e) => e.id === layerAnim.id);

    // A 'sound' layer has no DOM node at all (see TemplateElement's own doc
    // comment on the 'sound' kind) — it never reaches the `refs[]` lookup
    // below, and needs none of the visual machinery every other kind goes
    // through. Fires exactly once per actual play-through, `delay` seconds
    // into this state's own timeline, on every restart (a replay
    // legitimately wants its cue again too, not just the first time this
    // state ever played).
    if (baseElement?.kind === 'sound') {
      if (layerAnim.sfxId) {
        tl.call(() => playSfx(layerAnim.sfxId, layerAnim.sfxVolume), undefined, layerAnim.delay || 0);
      }
      return;
    }

    const el = refs[layerAnim.id];
    if (!el) return;

    // Hidden until its own animation reveals it — done as part of THIS
    // timeline (position 0) rather than a separate imperative gsap.set()
    // call from the caller, so there's no ordering ambiguity against a
    // reveal scheduled at delay 0 (e.g. scramble/typewriter, whose
    // visibility reveal is itself a same-timeline `tl.set(...,'visible')`
    // at `delay`, often 0 — two independent calls racing to set the same
    // property was exactly the kind of bug that made those presets look
    // broken). Only "in" ever does this — a Step always starts from
    // whatever's already visible, same as "loop"/"out" already do.
    if (flags.isInState) {
      tl.set(el, { visibility: 'hidden' }, 0);
    }

    if (layerAnim.transformOrigin) {
      gsap.set(el, { transformOrigin: layerAnim.transformOrigin });
    }

    // `preset` and `tracks` are independent and can coexist on the same
    // layer — a canned preset for the broad entrance/exit motion PLUS
    // hand-tuned keyframe tracks for anything the preset doesn't cover
    // (e.g. slideLeft for position, with a custom rotation track layered
    // on top), rather than being forced to pick exactly one for this
    // element and lose the other. Each just adds its own independent
    // tweens to the SAME timeline — GSAP handles two different PROPERTIES
    // animating on one element with no special handling needed here.
    // Caveat (documented on CgLayerAnim itself): if a track targets the
    // SAME property the preset also animates, whichever one's tween is
    // active for that property "wins" at any given moment — same as
    // deliberately double-authoring any other GSAP-owned property in this
    // app, not something this needs to guard against.
    if (layerAnim.preset && layerAnim.preset !== 'none') {
      buildPresetAnimation(tl, el, layerAnim, flags.isOutState, baseElement);
    }
    if (layerAnim.tracks) {
      // Split into ordinary (direct DOM/GSAP property) tracks and
      // `effect:<id>:<field>`-namespaced ones (see cgEffects.ts's
      // effectTrackKey) — GSAP can't tween a literal property by that
      // name, so those go through buildEffectKeyframeTracks's proxy-object
      // path instead, targeting the effects wrapper node, not `el` itself.
      const directTracks: Record<string, CgKeyframe[]> = {};
      const effectTracksMap: Record<string, CgKeyframe[]> = {};
      Object.entries(layerAnim.tracks).forEach(([prop, kfs]) => {
        (parseEffectTrackKey(prop) ? effectTracksMap : directTracks)[prop] = kfs;
      });
      buildKeyframeTracks(tl, el, directTracks, flags.isInState);
      buildEffectKeyframeTracks(tl, el, effectRefs[layerAnim.id], effectTracksMap, effectProxies, baseElement, flags.isInState, Object.keys(directTracks).length > 0);
    }

    if (layerAnim.contentOverride) {
      applyContentOverride(tl, el, layerAnim, baseElement);
    }
  });

  if (stateConfig.stops) {
    stateConfig.stops.forEach((stopTime) => tl.addPause(stopTime));
  }

  if (stateConfig.loop) {
    tl.repeat(-1);
    if (stateConfig.yoyo) tl.yoyo(true);
    if (stateConfig.repeatDelay) tl.repeatDelay(stateConfig.repeatDelay);
  }

  return tl;
}

function buildKeyframeTracks(tl: gsap.core.Timeline, el: HTMLElement, tracks: Record<string, CgKeyframe[]>, isInState: boolean) {
  let earliestTime = Infinity;
  Object.values(tracks).forEach((kfs) => {
    if (kfs.length && kfs[0].t < earliestTime) earliestTime = kfs[0].t;
  });
  if (earliestTime < Infinity) {
    tl.set(el, { visibility: 'visible' }, Math.max(0, earliestTime));
  }

  Object.entries(tracks).forEach(([prop, keyframes]) => {
    if (!keyframes || keyframes.length < 1) return;
    if (prop === 'visibility') return;

    if (keyframes.length >= 1) {
      const initVal = keyframes[0].v;
      const prop0 = prop === 'blur' ? 'filter' : prop;
      const val0 = prop === 'blur' ? `blur(${initVal}px)` : initVal;
      if (isInState) {
        // Entering "in" is a genuine reset point — nothing meaningful to
        // continue from (CgTemplateWidget.tsx clears prior inline styles
        // right before building it) — so jump straight to the authored
        // starting value, same as always.
        tl.set(el, { [prop0]: val0 }, keyframes[0].t);
      } else {
        // Every other state (Step/Loop/Out) picks up wherever the previous
        // state's timeline actually left this element — tweening TO the
        // authored value instead of snapping to it gives continuity between
        // states instead of a visible jump.
        tl.to(el, { [prop0]: val0, duration: Math.max(0.01, keyframes[0].t), ease: resolveEase(keyframes[0].ease || 'power2.out') }, 0);
      }
    }

    for (let i = 1; i < keyframes.length; i++) {
      const prev = keyframes[i - 1];
      const curr = keyframes[i];
      const duration = Math.max(0.01, curr.t - prev.t);

      const ease = resolveEase(curr.ease || 'power2.out');
      const tweenConfig: Record<string, any> = prop === 'blur'
        ? { filter: `blur(${curr.v}px)`, duration, ease }
        : { [prop]: curr.v, duration, ease };

      tl.to(el, tweenConfig, prev.t);
    }
  });
}

/** Same continuity idea as buildKeyframeTracks above, but for
 *  `effect:<id>:<field>`-namespaced track keys (see cgEffects.ts's
 *  effectTrackKey/parseEffectTrackKey) — GSAP can't tween a literal DOM
 *  property by that name, so each affected effect gets its own small plain
 *  "proxy" object instead; every tween segment's onUpdate recomposes the
 *  WHOLE effects stack's CSS `filter` string (so co-existing, non-animated
 *  effects on the same element keep rendering correctly) and writes it
 *  directly onto `wrapperEl` — a DIFFERENT node than `el` (see
 *  CgTemplateWidget.tsx/CgTemplateDesigner.tsx's own effectWrapperRefs).
 *  `el` itself is only touched here to reveal it, for the case an element
 *  is animated ONLY via an effect and has no transform/preset track of its
 *  own to do that — always at t=0 (not the effect's own first keyframe
 *  time), since an effect-only animation isn't an entrance the way a
 *  transform track's own delayed reveal can legitimately be: the element
 *  should just stay visible the whole time, the same as any other static,
 *  unanimated element, with only the effect's own parameter varying. When
 *  `hasDirectReveal` is true, this element's OTHER (direct/preset) reveal
 *  already handles "in"'s hide-until-revealed convention — including any
 *  intentional delay — so piling on a second, always-immediate reveal here
 *  would fight it (whichever is EARLIER wins, silently overriding a
 *  deliberately delayed entrance).
 *
 *  `effectProxies` is a plain object the CALLER owns and keeps alive across
 *  every separate state/step timeline build for one playback session (keyed
 *  by effect id — ids are unique across the whole template, so no need to
 *  further namespace by element) — reusing the SAME proxy instance rather
 *  than reseeding it fresh from the static base config every time is what
 *  gives Step/Loop/Out continuity for effect values, exactly the way `el`'s
 *  own persistent inline style already does for transform tracks: reading a
 *  live "wherever the last state left it" value as the tween-in's start
 *  point means an unchanged value produces no visible jump at all. The
 *  caller resets this object (to `{}`) at the same point it already resets
 *  `el`'s own inline styles for a fresh "in" replay. */
function buildEffectKeyframeTracks(
  tl: gsap.core.Timeline,
  el: HTMLElement,
  wrapperEl: HTMLElement | null | undefined,
  effectTracks: Record<string, CgKeyframe[]>,
  effectProxies: Record<string, Record<string, any>>,
  baseElement: TemplateElement | undefined,
  isInState: boolean,
  hasDirectReveal: boolean
) {
  const entries = Object.entries(effectTracks).filter(([, kfs]) => kfs?.length);
  if (!entries.length || !wrapperEl) return;

  if (isInState && !hasDirectReveal) {
    tl.set(el, { visibility: 'visible' }, 0);
  }

  const baseEffects = baseElement?.config?.effects as CgEffect[] | undefined;

  const byEffect = new Map<string, { field: string; keyframes: CgKeyframe[] }[]>();
  for (const [prop, keyframes] of entries) {
    const parsed = parseEffectTrackKey(prop);
    if (!parsed) continue;
    const list = byEffect.get(parsed.effectId) ?? [];
    list.push({ field: parsed.field, keyframes });
    byEffect.set(parsed.effectId, list);
  }

  byEffect.forEach((fields, effectId) => {
    const baseEffect = baseEffects?.find((e) => e.id === effectId);
    let proxy = effectProxies[effectId];
    if (!proxy) {
      proxy = {};
      fields.forEach(({ field }) => { proxy![field] = (baseEffect as any)?.[field]; });
      effectProxies[effectId] = proxy;
    }

    const applyToWrapper = () => {
      let live = baseEffects ?? [];
      fields.forEach(({ field }) => { live = withLiveEffectValue(live, effectId, field, proxy![field]); });
      wrapperEl.style.filter = buildFilterString(live) || '';
    };

    fields.forEach(({ field, keyframes }) => {
      const first = keyframes[0];
      // Always a real tween from the proxy's own current value INTO the
      // first keyframe (never a hard, instant .set()) — unlike a direct
      // transform property, an effect field has no other "reveal" tied
      // specifically to ITS OWN first-keyframe time: this same element can
      // already be visible (revealed by an unrelated opacity/position track
      // that starts earlier) while this effect's first keyframe is still
      // ahead. A hard snap there would leave the effect looking frozen at
      // its plain static value for the whole visible window before that
      // keyframe, then jump — exactly the "no effect while the animation is
      // running" bug this fixes. On "in" specifically this tweens from the
      // proxy's freshly-reseeded base value (the caller resets
      // effectProxies to {} right before every "in" rebuild, so there's
      // always a clean, predictable value to tween from — same effect as
      // buildKeyframeTracks's own isInState hard-set, just animated instead
      // of instant); on every other state it's the existing continuity
      // tween from wherever the previous state left the proxy. When
      // `first.t` is 0 (the common case) `duration` floors to 0.01s, which
      // reads as instant either way — this changes nothing for that case.
      tl.to(proxy!, { [field]: first.v, duration: Math.max(0.01, first.t), ease: resolveEase(first.ease || 'power2.out'), onUpdate: applyToWrapper }, 0);

      for (let i = 1; i < keyframes.length; i++) {
        const prev = keyframes[i - 1];
        const curr = keyframes[i];
        const duration = Math.max(0.01, curr.t - prev.t);
        tl.to(proxy!, { [field]: curr.v, duration, ease: resolveEase(curr.ease || 'power2.out'), onUpdate: applyToWrapper }, prev.t);
      }
    });
  });
}

function buildPresetAnimation(
  tl: gsap.core.Timeline,
  el: HTMLElement,
  layerAnim: CgLayerAnim,
  isOut: boolean,
  baseElement: TemplateElement | undefined
) {
  const presetName = layerAnim.preset!;
  const presetLib = isOut ? OUT_PRESETS : PRESETS;
  const preset = presetLib[presetName];
  if (!preset) return;

  if (preset._type === 'typewriter') return buildTypewriter(tl, el, layerAnim);
  if (preset._type === 'scramble') return buildScramble(tl, el, layerAnim);
  if (preset._type === 'sequencePlay') return buildSequencePlayback(tl, el, layerAnim, baseElement);
  if (preset._type === 'morph') return buildMorph(tl, el, layerAnim);
  if (preset._type === 'wordSequence') return buildWordSequence(tl, el, layerAnim, baseElement);
  if (preset._type === 'textReveal') return buildTextReveal(tl, el, layerAnim, baseElement);
  if (preset._type === 'fire') return buildFireFlicker(tl, el, layerAnim);
  if (preset._type === 'strokeTrail') return buildStrokeTrail(tl, el, layerAnim);

  const delay = layerAnim.delay || 0;
  const duration = layerAnim.duration || 0.5;
  const rawEase = layerAnim.ease || 'power2.out';
  // `reversed` — see CgLayerAnim's own doc comment: a genuine time-reversal,
  // not "the opposite preset" — invert the ease FIRST, on the raw authored
  // string (invertEaseName itself understands either a plain named ease or
  // a raw cubic-bezier(...) string), THEN resolve/register it for GSAP —
  // resolveEase's own CustomEase registration only matters for the string
  // GSAP actually receives, so it must run last regardless of direction.
  const ease = resolveEase(layerAnim.reversed ? (invertEaseName(rawEase) ?? rawEase) : rawEase);

  tl.set(el, { visibility: 'visible' }, delay);
  const config = { ...preset, duration, ease };
  // Normally isOut plays TO the preset's values and everything else plays
  // FROM them — reversed swaps which direction THIS layer uses, producing
  // the exact mathematical time-reversal of the un-reversed motion (see
  // easeUtils.ts's invertEaseName for the identity this relies on).
  const animatesTo = layerAnim.reversed ? !isOut : isOut;
  if (animatesTo) tl.to(el, config, delay);
  else tl.from(el, config, delay);
}

/** Discrete per-state content swap — text/image values that differ per
 *  state instead of sharing the one base value every state otherwise reads
 *  (TemplateElement.config.text/imageUrl). Scheduled via tl.call() so it
 *  only actually applies once THIS state's timeline plays, never at build
 *  time (every state's timelines are built together, ahead of playback —
 *  applying it eagerly would overwrite the element before its turn). */
function applyContentOverride(tl: gsap.core.Timeline, el: HTMLElement, layerAnim: CgLayerAnim, baseElement: TemplateElement | undefined) {
  const override = layerAnim.contentOverride!;
  const presetName = layerAnim.preset;
  const textHandledByPreset = presetName === 'typewriter' || presetName === 'scramble';

  if (override.text !== undefined && !textHandledByPreset) {
    tl.call(() => { el.textContent = override.text!; }, undefined, 0);
  }
  if (override.imageUrl !== undefined && baseElement?.kind === 'image') {
    tl.call(() => {
      const img = el.querySelector('img');
      if (img) img.src = resolveImageUrl(override.imageUrl!);
    }, undefined, 0);
  }
}

function buildTypewriter(tl: gsap.core.Timeline, el: HTMLElement, layerAnim: CgLayerAnim) {
  // Prefer this state's own content override as the source text — el's
  // actual DOM text at build time reflects whatever the PREVIOUS state left
  // it as (every state's timelines are built together, ahead of playback),
  // not necessarily what this state is meant to type out.
  const text = layerAnim.contentOverride?.text ?? el.textContent ?? '';
  const speed = (layerAnim as any).speed || 0.05;
  const delay = layerAnim.delay || 0;

  tl.set(el, { visibility: 'visible' }, delay);
  // i=0 already clears it (substring(0,0) === '') at this same position —
  // no separate clear call needed.
  for (let i = 0; i <= text.length; i++) {
    tl.call(() => { el.textContent = text.substring(0, i); }, undefined, delay + i * speed);
  }
}

function buildScramble(tl: gsap.core.Timeline, el: HTMLElement, layerAnim: CgLayerAnim) {
  const delay = layerAnim.delay || 0;
  const duration = layerAnim.duration || 1;
  // See buildTypewriter's comment above — same reasoning.
  const text = layerAnim.contentOverride?.text ?? el.textContent ?? '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

  tl.set(el, { visibility: 'visible' }, delay);
  const steps = 20;
  for (let s = 0; s <= steps; s++) {
    const progress = s / steps;
    tl.call(() => {
      let result = '';
      for (let i = 0; i < text.length; i++) {
        result += i < text.length * progress ? text[i] : chars[Math.floor(Math.random() * chars.length)];
      }
      el.textContent = result;
    }, undefined, delay + (s / steps) * duration);
  }
  tl.call(() => { el.textContent = text; }, undefined, delay + duration);
}

/** Morphs a 'shape' element's <path> toward `layerAnim.morphTo` via GSAP's
 *  MorphSVGPlugin — unlike plain clip-path tweening, this works between
 *  totally different shapes/point-counts. The path's CURRENT `d` (whatever
 *  the previous state left it at, or the base shape on first use) is the
 *  implicit start, so continuity between states is automatic. */
function buildMorph(tl: gsap.core.Timeline, el: HTMLElement, layerAnim: CgLayerAnim) {
  const target = layerAnim.morphTo;
  const pathEl = el.querySelector('path');
  if (!target || !pathEl) return;

  const delay = layerAnim.delay || 0;
  const duration = layerAnim.duration || 0.8;
  const ease = resolveEase(layerAnim.ease || 'power2.out');

  tl.set(el, { visibility: 'visible' }, delay);
  tl.to(pathEl, { morphSVG: target, duration, ease }, delay);
}

/** A flickering, irregularly-timed scale/skew/brightness jitter — a warm
 *  flame's own restlessness, not a smooth sine wave (which is what every
 *  OTHER loop preset here — wiggleLoop/pulseLoop/etc — deliberately IS: a
 *  clean back-and-forth). A finite, `layerAnim.duration`-long sequence
 *  added straight to `tl`, exactly like every other _type handler here —
 *  NOT its own independently-repeating tween outside it, so this stays
 *  100% safe to place on ANY state (In/Out/a Step included) without ever
 *  blocking that state's own timeline from completing and handing off to
 *  the next one, the way baking a real repeat:-1 directly into `tl` would.
 *  The actual continuous-fire look comes from the SAME place every other
 *  loop preset's does: put this on the Loop state with its own Loop
 *  checkbox on (CgTemplateTimeline.tsx), which repeats this whole finite
 *  sequence forever — a several-times-a-second flicker repeating its
 *  pattern every `duration` seconds reads as continuous fire to the eye,
 *  not as an obviously-looping GIF.
 *  The jitter sequence itself is a fixed (not Math.random()) pseudo-random
 *  curve — deterministic so this element's build is reproducible run to
 *  run — deliberately NOT true flame color: pair this with a Glow or Drop
 *  Shadow effect in a warm orange/red for the actual "on fire" look — this
 *  preset is purely the MOTION half of that combination, the same
 *  "presets and effects compose independently" split this app already
 *  uses everywhere else. */
function buildFireFlicker(tl: gsap.core.Timeline, el: HTMLElement, layerAnim: CgLayerAnim) {
  const delay = layerAnim.delay || 0;
  const duration = layerAnim.duration || 1.5;
  tl.set(el, { visibility: 'visible' }, delay);
  const steps = Math.max(6, Math.round(duration * 8));
  const stepDur = duration / steps;
  for (let i = 0; i < steps; i++) {
    const seed = Math.sin(i * 12.9898) * 43758.5453;
    const rnd = seed - Math.floor(seed);
    tl.to(el, {
      scale: 0.92 + rnd * 0.16,
      skewX: (rnd - 0.5) * 6,
      filter: `brightness(${Math.round(85 + rnd * 45)}%)`,
      duration: stepDur, ease: 'sine.inOut',
    }, delay + i * stepDur);
  }
  tl.to(el, { scale: 1, skewX: 0, filter: 'brightness(100%)', duration: stepDur, ease: 'sine.inOut' }, delay + duration);
}

/** A running dash chasing its own path with a trailing fade — MotionKit
 *  AE's own "line draw with trail"/"running light" look. 'shape' elements
 *  only, and only visible when this element already has its own stroke
 *  color+width set (see the Inspector's Stroke fields) — stroke-dasharray
 *  paints along the STROKE, not the fill, same requirement buildMorph has
 *  for `layerAnim.morphTo` (a field the operator sets separately, not
 *  auto-configured here).
 *  Single finite pass over `layerAnim.duration`, same "safe on any state,
 *  the Loop state's own Loop checkbox is what actually repeats it forever"
 *  reasoning buildFireFlicker/every loop preset above has — offsetting the
 *  dash by exactly the path's own total length wraps seamlessly (running
 *  off the end at `-totalLen` is the exact same visual position as the
 *  start at `0`), so a repeated pass shows no seam or snap-back. */
function buildStrokeTrail(tl: gsap.core.Timeline, el: HTMLElement, layerAnim: CgLayerAnim) {
  const pathEl = el.querySelector('path');
  if (!pathEl) return;

  const delay = layerAnim.delay || 0;
  const duration = layerAnim.duration || 2;
  const ease = resolveEase(layerAnim.ease || 'none');
  const totalLen = pathEl.getTotalLength();
  const trailLen = Math.max(6, totalLen * 0.18);

  tl.set(el, { visibility: 'visible' }, delay);
  tl.set(pathEl, { strokeDasharray: `${trailLen} ${Math.max(1, totalLen - trailLen)}`, strokeDashoffset: 0 }, delay);
  tl.to(pathEl, { strokeDashoffset: -totalLen, duration, ease }, delay);
}

function buildSequencePlayback(tl: gsap.core.Timeline, el: HTMLElement, layerAnim: CgLayerAnim, baseElement: TemplateElement | undefined) {
  const frames: string[] = baseElement?.config?.frames || [];
  if (!frames.length) return;
  const fps = baseElement?.config?.fps || 24;
  const delay = layerAnim.delay || 0;
  const frameDuration = 1 / fps;

  tl.set(el, { visibility: 'visible' }, delay);

  // `config.loop` (see TemplateElement's own 'sequence' doc comment and
  // lib/useSequenceLoop.ts) keeps this sequence cycling on its own, the
  // whole time the element is on screen — handled entirely by that
  // self-contained rAF hook instead of scheduling frame swaps on THIS GSAP
  // timeline. An earlier attempt nested a second repeat(-1) GSAP timeline
  // in here instead: that silently never actually looped, because a child
  // timeline added to a parent via .add() is driven by the PARENT's own
  // playhead, not an independent clock — a parent that itself only plays
  // once (no authored Loop state) never gives the nested repeat anywhere
  // to repeat INTO. A plain rAF loop, same proven approach flagWave/
  // waveWarp/ticker already use for "just keeps going regardless of the
  // state machine," doesn't have that problem at all. Nothing left to
  // schedule here for a looping sequence beyond the visibility reveal
  // above.
  if (baseElement?.config?.loop) return;

  // resolveImageUrl: same host/port rewriting every other image reference
  // in this app goes through — without it, a frame plays fine in the same
  // Tauri window it was authored in but breaks for a remote/readonly
  // client (see lib/imageUrl.ts). Quoted url(...) — an unquoted CSS
  // url() can't contain whitespace, and broadcast-graphics frame
  // filenames (exported from After Effects/etc.) commonly have spaces;
  // unquoted, the whole background-image declaration was silently
  // invalid and nothing ever painted.
  frames.forEach((url, i) => {
    tl.call(() => { el.style.backgroundImage = `url("${resolveImageUrl(url)}")`; }, undefined, delay + i * frameDuration);
  });
  // Hold the last frame for its full duration — otherwise the timeline's
  // length ends exactly at the last call and a repeat()'d loop wraps before
  // that frame is ever actually seen.
  tl.set(el, {}, delay + frames.length * frameDuration);
}

/** "Machine Gun Text Effect"-style word-at-a-time cycling — 'text' elements
 *  only, driven by `baseElement.config.wordSequence` (see canvas.ts's
 *  CgWordSequenceItem). Each entry's own authored `duration` is exactly how
 *  long it stays on screen before the next one replaces it — never derived
 *  from word length, per how this was scoped. Same continuity convention as
 *  buildSequencePlayback right above: schedules one tl.call() per word at
 *  its own cumulative start time, and a trailing tl.set() so a repeat()'d
 *  Loop state doesn't wrap before the last word's own hold time is up. */
function buildWordSequence(tl: gsap.core.Timeline, el: HTMLElement, layerAnim: CgLayerAnim, baseElement: TemplateElement | undefined) {
  const items: CgWordSequenceItem[] = baseElement?.config?.wordSequence || [];
  if (!items.length) return;
  const delay = layerAnim.delay || 0;

  tl.set(el, { visibility: 'visible' }, delay);
  let t = delay;
  items.forEach((item) => {
    const word = item.word ?? '';
    const duration = Math.max(0.02, item.duration || 0.15);
    tl.call(() => { el.textContent = word; }, undefined, t);
    t += duration;
  });
  tl.set(el, {}, t);
}

/** Per-character/word/sentence staggered reveal — see lib/textReveal.ts's
 *  own doc comment for the catalog/design. Rebuilds `el`'s own children
 *  into one <span> per unit SYNCHRONOUSLY, right here at build time (same
 *  moment every other preset's own tl.from/tl.to calls run) rather than
 *  deferred inside a tl.call() — the per-span tweens below need those
 *  spans to already exist as real nodes to target, and (just as
 *  importantly) need to be added to `tl` ITSELF via tl.set/tl.to, not as
 *  independent gsap.to() calls outside it, so scrubbing/pausing/reversing
 *  this state's own timeline (the Designer's preview scrubber, CG Playout)
 *  correctly carries the reveal along with it instead of it running on its
 *  own separate clock.
 *
 *  Idempotent: if `el` already holds spans built from this EXACT token
 *  sequence (tracked via a data attribute), those spans are reused instead
 *  of rebuilt — needed because "in" and "out" (or a Step) can each
 *  independently call this for the SAME element, and whichever runs last
 *  would otherwise blow away the DOM nodes an earlier-built timeline's own
 *  tl.to() calls already reference, leaving it animating nothing. Reused
 *  only when the text is IDENTICAL; a genuine content override (a Step
 *  revealing different text) still rebuilds fresh, same as buildTypewriter
 *  already accepts for its own simpler case. */
function buildTextReveal(tl: gsap.core.Timeline, el: HTMLElement, layerAnim: CgLayerAnim, baseElement: TemplateElement | undefined) {
  const cfg = baseElement?.config ?? {};
  const unit = cfg.textRevealUnit ?? 'character';
  const styleKey = cfg.textRevealStyle ?? 'fadeUp';
  const style = TEXT_REVEAL_STYLES[styleKey] ?? TEXT_REVEAL_STYLES.fadeUp;
  const stagger = Math.max(0, cfg.textRevealStagger ?? 0.05);
  const duration = Math.max(0.05, cfg.textRevealDuration ?? 0.6);
  const ease = resolveEase(cfg.textRevealEase || 'power2.out');
  const delay = layerAnim.delay || 0;
  // The text THIS state should reveal — a per-state content override (a
  // Step showing different text than "in" did) takes priority over
  // whatever el.textContent happens to currently hold, same source
  // buildTypewriter's own comment explains this exact same way.
  const text = layerAnim.contentOverride?.text ?? el.textContent ?? '';
  const tokens = splitTextIntoUnits(text, unit);
  const tokenKey = tokens.map((t) => t.text).join('');

  let spans: HTMLSpanElement[];
  if ((el as any).__cgTextRevealKey === tokenKey) {
    spans = Array.from(el.querySelectorAll(':scope > span[data-cg-reveal]')) as HTMLSpanElement[];
  } else {
    el.innerHTML = '';
    spans = [];
    for (const token of tokens) {
      if (token.space) {
        el.appendChild(document.createTextNode(token.text));
        continue;
      }
      const span = document.createElement('span');
      span.textContent = token.text;
      span.dataset.cgReveal = '1';
      span.style.display = 'inline-block';
      el.appendChild(span);
      spans.push(span);
    }
    (el as any).__cgTextRevealKey = tokenKey;
  }

  if (style.is3D) {
    el.style.perspective = '600px';
    el.style.transformStyle = 'preserve-3d';
  }
  // The element's own JSX styles it `display:flex` to center a SINGLE text
  // block — exactly wrong for MULTIPLE inline-block span children: flex's
  // default nowrap never wraps onto a second line at all (content just
  // overflows sideways, invisible past the clip), and a bare whitespace
  // TEXT NODE placed directly in a flex container collapses to zero width
  // as an anonymous flex item instead of keeping its usual "a space has
  // width" behavior — the exact "words run together with no gap" symptom
  // that broke without this. table-cell is a real, long-predates-flexbox
  // way to vertically center normal (wrapping) text content — `vertical-
  // align` takes the SAME 'top'/'middle'/'bottom' keywords `valign`
  // already uses, and plain `text-align` (already set elsewhere on this
  // same node from `config.align`) keeps handling horizontal alignment of
  // each wrapped line exactly as it already did before this feature
  // existed — none of that needs touching here.
  const valign = cfg.valign ?? 'middle';
  el.style.display = 'table-cell';
  el.style.verticalAlign = valign === 'top' ? 'top' : valign === 'bottom' ? 'bottom' : 'middle';

  tl.set(el, { visibility: 'visible' }, delay);
  const restState = { opacity: 1, x: 0, y: 0, rotateX: 0, rotateY: 0, rotateZ: 0, scale: 1, skewX: 0, filter: 'none' };
  // ALL spans snap to the hidden pose immediately at `delay` — not just
  // each one's own stagger point — so a later span sits invisible from the
  // very start of this state instead of flashing fully visible-then-
  // hidden-then-revealed for however long its own turn hasn't come up yet.
  if (!style.loop) spans.forEach((span) => tl.set(span, style.from, delay));
  spans.forEach((span, i) => {
    const t = delay + i * stagger;
    if (style.loop) {
      // 'wave' — continuous, independent of the in/loop/out state
      // machine's own finite length, same relationship a 'ticker'
      // element's scroll already has to it. repeat is a large FINITE
      // number (not -1) so this state's own tl.duration() stays finite —
      // an infinitely-repeating child tween would make the "advance once
      // the animation completes" logic that reads that duration see
      // Infinity instead. Still added to `tl` itself (not a bare
      // gsap.to()) so it scrubs/pauses correctly along with everything
      // else on this timeline.
      tl.set(span, { opacity: 1 }, delay);
      tl.to(span, { y: -10, duration: 0.6, repeat: 9999, yoyo: true, ease: 'sine.inOut' }, delay + i * 0.08);
      return;
    }
    tl.to(span, { ...restState, duration, ease }, t);
  });
}
