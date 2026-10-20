// Per-element effects stack (drop shadow / glow / blur / color adjustments)
// and mask-path scaling — see types/canvas.ts's CgEffect and
// TemplateElement.maskId. Both renderers (CgTemplateWidget.tsx's real
// output, CgTemplateDesigner.tsx's live preview) call into this file so the
// two stay in lockstep, the same relationship they already have with
// lib/cgAnimationEngine.ts.
import type { CgEffect } from '../types/canvas';

export const EFFECT_LABELS: Record<CgEffect['type'], string> = {
  dropShadow: 'Drop Shadow',
  glow: 'Glow',
  blur: 'Blur',
  brightness: 'Brightness',
  contrast: 'Contrast',
  saturate: 'Saturate',
  hueRotate: 'Hue Rotate',
  lightSweep: 'Light Sweep',
  glass: 'Glass',
  fractalGlass: 'Fractal Glass',
  crystalGlass: 'Crystal Glass',
  liquidGlass: 'Liquid Glass',
  flagWave: 'Flag Wave',
  bevel: 'Bevel & Emboss',
  innerShadow: 'Inner Shadow',
  animatedBg: 'Animated Background',
  stroke: 'Stroke',
  waveWarp: 'Wave Warp',
};

export function defaultEffect(type: CgEffect['type']): CgEffect {
  const id = crypto.randomUUID();
  switch (type) {
    case 'dropShadow': return { id, type, enabled: true, color: '#000000', offsetX: 2, offsetY: 2, blurRadius: 6, opacity: 100 };
    case 'glow': return { id, type, enabled: true, color: '#ffffff', blurRadius: 12 };
    case 'blur': return { id, type, enabled: true, blurRadius: 4 };
    case 'brightness': return { id, type, enabled: true, amount: 120 };
    case 'contrast': return { id, type, enabled: true, amount: 120 };
    case 'saturate': return { id, type, enabled: true, amount: 150 };
    case 'hueRotate': return { id, type, enabled: true, amount: 90 };
    case 'lightSweep': return { id, type, enabled: true, color: '#ffffff', angle: 115, bandWidth: 25, duration: 1.4, gap: 2.5, opacity: 70 };
    case 'glass': return { id, type, enabled: true, color: '#ffffff', blurRadius: 20, amount: 180, opacity: 18, angle: 135 };
    case 'fractalGlass': return { id, type, enabled: true, color: '#ffffff', blurRadius: 20, amount: 100, opacity: 100, angle: 90, bandWidth: 32, amplitude: 30, texture: FRACTAL_GLASS_STYLES[0].key };
    case 'crystalGlass': return { id, type, enabled: true, color: '#ffffff', blurRadius: 16, amount: 170, opacity: 20, angle: 135, bandWidth: 36 };
    case 'liquidGlass': return { id, type, enabled: true, color: '#ffffff', blurRadius: 20, amount: 160, opacity: 18, angle: 135, amplitude: 40 };
    case 'flagWave': return { id, type, enabled: true, amplitude: 10, frequency: 3, amount: 8, angle: 45, duration: 3 };
    case 'bevel': return { id, type, enabled: true, blurRadius: 3, amount: 4, angle: 135, elevation: 55, shininess: 12, edgeOnly: false, bandWidth: 8 };
    case 'innerShadow': return { id, type, enabled: true, color: '#000000', offsetX: 4, offsetY: 4, blurRadius: 5, opacity: 85 };
    case 'animatedBg': return { id, type, enabled: true, color: '#3355ff', animatedBgStyle: 'gradientShift', angle: 45, duration: 6 };
    case 'stroke': return { id, type, enabled: true, color: '#ffffff', strokeWidth: 3, strokeGap: 8, dashStyle: 'dashed', animated: true, duration: 2, direction: 'forward', opacity: 100, blurRadius: 0, amount: 0 };
    case 'waveWarp': return { id, type, enabled: true, waveType: 'sine', amplitude: 20, bandWidth: 60, angle: 0, frequency: 1, phase: 0, pinning: 'none', antiAlias: 'low' };
  }
}

/** Which of a CgEffect's own fields are meaningful per type, and how to
 *  present/edit each one — drives both ElementPropertiesPanel.tsx's
 *  per-effect keyframe rows and CgTemplateTimeline.tsx's "+ Track" list
 *  (see effectTrackKey below for how one of these becomes a track key). */
export const EFFECT_PARAMS: Record<CgEffect['type'], { field: 'offsetX' | 'offsetY' | 'blurRadius' | 'amount' | 'color' | 'opacity' | 'angle' | 'bandWidth' | 'duration' | 'gap' | 'amplitude' | 'frequency'; label: string; kind: 'number' | 'color' }[]> = {
  dropShadow: [
    { field: 'offsetX', label: 'Offset X', kind: 'number' },
    { field: 'offsetY', label: 'Offset Y', kind: 'number' },
    { field: 'blurRadius', label: 'Blur Radius', kind: 'number' },
    { field: 'opacity', label: 'Opacity', kind: 'number' },
    { field: 'color', label: 'Color', kind: 'color' },
  ],
  glow: [
    { field: 'blurRadius', label: 'Blur Radius', kind: 'number' },
    { field: 'color', label: 'Color', kind: 'color' },
  ],
  blur: [{ field: 'blurRadius', label: 'Blur Radius', kind: 'number' }],
  brightness: [{ field: 'amount', label: 'Amount', kind: 'number' }],
  contrast: [{ field: 'amount', label: 'Amount', kind: 'number' }],
  saturate: [{ field: 'amount', label: 'Amount', kind: 'number' }],
  hueRotate: [{ field: 'amount', label: 'Amount', kind: 'number' }],
  // lightSweep deliberately has NO entries here — unlike every other effect,
  // its fields don't feed buildFilterString/wrapperEl.style.filter at all
  // (see buildLightSweepStyle below), so this generic keyframe-capable row
  // system (ElementPropertiesPanel.tsx, backed by
  // cgAnimationEngine.ts's buildEffectKeyframeTracks, which only ever writes
  // an animated `filter` string) has nowhere to apply a keyframed value for
  // it — the stopwatch would silently do nothing, worse than not offering
  // it. lightSweep gets its own small plain-fields block instead (same
  // "self-contained, not part of the keyframe timeline" treatment a
  // 'ticker' element's speed/gap/direction already have).
  lightSweep: [],
  // glass — same reasoning as lightSweep just above: its fields drive
  // `backdrop-filter`/`background`/`border`/`box-shadow` (see
  // buildGlassStyle below), none of which the animated `filter` proxy
  // touches, so there's nowhere for a keyframe stopwatch here to apply a
  // tweened value. Its own plain-fields block lives in
  // ElementPropertiesPanel.tsx next to lightSweep's.
  glass: [],
  // fractalGlass/crystalGlass/liquidGlass — same reasoning as glass just
  // above (their own fields drive backdrop-filter/background/mask-image,
  // plus each one's own extra overlay — a ridge pattern, a facet pattern,
  // or a chromatic-aberration filter — never the animated `filter` proxy).
  // Own plain-fields blocks in ElementPropertiesPanel.tsx next to glass's.
  fractalGlass: [],
  crystalGlass: [],
  liquidGlass: [],
  // flagWave — same reasoning again: its own baseFrequency/azimuth are
  // continuously animated by lib/useFlagWave.ts's own rAF loop, imperatively
  // written straight onto SVG filter-primitive ATTRIBUTES (not the animated
  // `filter` PROPERTY string this keyframe system proxies) — nowhere for a
  // stopwatch here to apply a tweened value either. Own plain-fields block
  // in ElementPropertiesPanel.tsx next to lightSweep's/glass's.
  flagWave: [],
  // bevel — same reasoning as flagWave just above: static, not animated,
  // but still not a keyframeable-through-`filter`-property effect in the
  // sense this table cares about (it's a per-element SVG filter reference,
  // same shape as flagWave). Own plain-fields block in
  // ElementPropertiesPanel.tsx next to flagWave's.
  bevel: [],
  // innerShadow — same shape as bevel/flagWave just above: a per-element
  // SVG filter reference (url(#innerShadow-<id>), NOT a plain CSS filter
  // function), so its own fields live in ElementPropertiesPanel.tsx's own
  // plain-fields block, not this generic keyframeable-through-`filter`-
  // string table.
  innerShadow: [],
  // animatedBg — own plain-fields block in ElementPropertiesPanel.tsx, same
  // "self-contained, not part of the animated `filter` proxy" reasoning as
  // glass/lightSweep — it paints its own background div (see
  // lib/useAnimatedBg.ts), nowhere for a filter-string keyframe to apply.
  animatedBg: [],
  // stroke — same reasoning as lightSweep/animatedBg: paints its own SVG
  // ring (see buildStrokeGeometry below) and, once `animated` is on, is
  // continuously driven by lib/useRunningStroke.ts's own GSAP tween — none
  // of that is the animated `filter` PROPERTY string this table proxies.
  // Own plain-fields block in ElementPropertiesPanel.tsx.
  stroke: [],
  // waveWarp — same shape as flagWave just above: a per-element SVG filter
  // reference, continuously driven by lib/useWaveWarp.ts's own rAF loop
  // writing straight to filter-primitive attributes (an feOffset's dx/dy) —
  // not the animated `filter` PROPERTY string this table proxies. Own
  // plain-fields block in ElementPropertiesPanel.tsx next to flagWave's.
  waveWarp: [],
};

/** A keyframe-track key for one effect's own field — namespaced so it can
 *  live in the exact same CgLayerAnim.tracks map every transform property
 *  already uses, with no type/schema change at all (see cgAnimationEngine.ts's
 *  buildEffectKeyframeTracks, which recognizes this prefix and animates a
 *  proxy object instead of a literal DOM property of this name). */
export function effectTrackKey(effectId: string, field: string): string {
  return `effect:${effectId}:${field}`;
}

export function parseEffectTrackKey(prop: string): { effectId: string; field: string } | null {
  if (!prop.startsWith('effect:')) return null;
  const [, effectId, field] = prop.split(':');
  if (!effectId || !field) return null;
  return { effectId, field };
}

/** Returns a new effects array with just one effect's one field overridden —
 *  used to recompose a live `filter` string every tick while a field is
 *  mid-tween (see buildEffectKeyframeTracks's onUpdate) without disturbing
 *  any other effect in the same stack. Pure — never mutates `effects`. */
export function withLiveEffectValue(effects: CgEffect[] | undefined, effectId: string, field: string, value: any): CgEffect[] {
  if (!effects) return [];
  return effects.map((e) => (e.id === effectId ? { ...e, [field]: value } : e));
}

/** CSS drop-shadow() takes one color argument with no separate opacity knob
 *  — dropShadow's own `opacity` field (0-100) only has anywhere to go by
 *  folding it into that color as an alpha channel. `color` is always a
 *  plain "#rrggbb"/"#rgb" hex string here (ColorOrGradientPicker's solid
 *  side, never a gradient — dropShadow's color field predates gradients and
 *  was never wired to accept one), so a regex-free channel split is enough;
 *  falls back to opaque black for anything else (a blank/mid-edit field). */
export function hexToRgba(hex: string | undefined, opacityPct: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return `rgba(0, 0, 0, ${Math.max(0, Math.min(100, opacityPct)) / 100})`;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(100, opacityPct)) / 100})`;
}

/** Composes every enabled effect, in order, into one CSS `filter` value —
 *  '' (falsy) when there's nothing to render, which every existing
 *  template (no `config.effects` at all) always gets, so callers can just
 *  skip wrapping entirely rather than emitting an inert `filter: none`. */
export function buildFilterString(effects: CgEffect[] | undefined): string {
  if (!effects?.length) return '';
  const parts: string[] = [];
  for (const e of effects) {
    if (!e.enabled) continue;
    switch (e.type) {
      case 'dropShadow':
        parts.push(`drop-shadow(${e.offsetX ?? 2}px ${e.offsetY ?? 2}px ${e.blurRadius ?? 6}px ${hexToRgba(e.color ?? '#000000', e.opacity ?? 100)})`);
        break;
      case 'glow':
        // A glow is a zero-offset, larger-radius shadow, doubled for punch
        // — the same trick used everywhere CSS lacks a real glow filter.
        parts.push(`drop-shadow(0 0 ${e.blurRadius ?? 12}px ${e.color ?? '#ffffff'}) drop-shadow(0 0 ${e.blurRadius ?? 12}px ${e.color ?? '#ffffff'})`);
        break;
      case 'blur':
        // Skip the plain CSS blur() term when this blur is ramp-masked —
        // it's handled entirely by a dedicated per-element SVG filter
        // instead (see findRampBlur/buildRampBlurFilterProps below,
        // appended by resolveElementFilter same as flagWave/bevel), which
        // needs an unblurred SourceGraphic to composite against; emitting
        // BOTH here would double-blur the ramp's own "sharp" side.
        if (!e.rampMask) parts.push(`blur(${e.blurRadius ?? 4}px)`);
        break;
      case 'brightness':
        parts.push(`brightness(${e.amount ?? 100}%)`);
        break;
      case 'contrast':
        parts.push(`contrast(${e.amount ?? 100}%)`);
        break;
      case 'saturate':
        parts.push(`saturate(${e.amount ?? 100}%)`);
        break;
      case 'hueRotate':
        parts.push(`hue-rotate(${e.amount ?? 0}deg)`);
        break;
      case 'lightSweep':
        // Not a filter primitive — see buildLightSweepGeometry below and the
        // CgEffect doc comment on why this is rendered as its own overlay
        // instead. Explicitly a no-op here (rather than falling through)
        // so an enabled lightSweep never contributes a bogus filter term.
        break;
      case 'glass':
        // Also not a `filter` primitive — backdrop-filter is a SEPARATE CSS
        // property (it blurs whatever is BEHIND the element, not the
        // element's own rendered content the way every filter above does),
        // so it can't be composed into this string at all. See
        // buildGlassStyle below — applied directly as inline style
        // properties by the two renderers instead.
        break;
      case 'fractalGlass':
      case 'crystalGlass':
      case 'liquidGlass':
        // Same as 'glass' just above — all four variants share its exact
        // backdrop-filter/background chrome (see buildGlassStyle/findGlass's
        // own doc comment on treating them all as one "glass family").
        break;
      case 'flagWave':
        // IS a `filter` primitive, just not one of the built-in CSS
        // functions above — a per-element `url(#flagwave-<id>)` reference
        // to an <feTurbulence>/<feDisplacementMap>/<feDiffuseLighting> SVG
        // filter (see buildFlagWaveFilterProps below), which resolveElementFilter
        // appends by id since building it requires this element's own id
        // (unlike every plain CSS function above, which needs no external
        // reference at all). Deliberately a no-op HERE — the actual url()
        // term is added by resolveElementFilter itself, once per element,
        // not per-effect-in-the-loop, since only ONE flagWave can ever be
        // active at a time anyway (see findFlagWave's own "first enabled"
        // convention).
        break;
      case 'bevel':
        // Same shape as flagWave just above — a per-element
        // `url(#bevel-<id>)` reference, appended by resolveElementFilter
        // itself rather than here (see buildBevelFilterProps' own doc
        // comment for the actual filter recipe).
        break;
      case 'animatedBg':
        // Not a `filter` primitive at all — a real `background`/
        // `background-position` on its own sibling div (see
        // buildAnimatedBgStyle below), same "paints behind, applied
        // directly as inline style properties by the two renderers"
        // treatment glass's own chrome already gets.
        break;
      case 'stroke':
        // Not a `filter` primitive — a real SVG ring rendered as a sibling
        // inside this same filter-bearing wrapper (see buildStrokeGeometry
        // below and the CgEffect doc comment on `strokeGap`) so that a
        // dropShadow/glow ALSO present in this effects stack naturally
        // wraps around it via this exact filter string, without this case
        // needing to do anything itself.
        break;
      case 'waveWarp':
        // Same shape as flagWave/bevel just above — a per-element
        // `url(#wavewarp-<id>)` reference, appended by resolveElementFilter
        // itself rather than here (see buildWaveWarpFilterProps' own doc
        // comment for the actual filter recipe).
        break;
    }
  }
  return parts.join(' ');
}

/** Darkens/lightens a "#rrggbb" color by a percentage (-100..100, negative
 *  = darker) — shared by the 3D Box's own per-face shading
 *  (CgTemplateDesigner.tsx's create3DBoxElements) and buildExtrudeFilter
 *  below, both wanting the same "one base color, several tonal steps" look
 *  a lit 3D surface has. Returns `hex` unchanged for anything that doesn't
 *  parse as a plain 6-digit hex (a gradient object, an empty string mid-
 *  edit) — same tolerance every other color field in this app already has. */
export function shadeHex(hex: string, pct: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const adjust = (channel: number) => {
    const v = pct < 0 ? channel * (1 + pct / 100) : channel + (255 - channel) * (pct / 100);
    return Math.max(0, Math.min(255, Math.round(v)));
  };
  const r = adjust((n >> 16) & 0xff);
  const g = adjust((n >> 8) & 0xff);
  const b = adjust(n & 0xff);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

/** "Extrude" — Blender's own extrude, faked with pure CSS on a SINGLE
 *  element (see TemplateElement's own doc comment on `config.extrudeDepth`/
 *  `extrudeColor`) rather than generating separate front/back/side face
 *  elements: a staircase of stacked `drop-shadow()` steps offset diagonally
 *  reads as a solid extruded edge trailing behind the element, the same
 *  "layered box-shadow/text-shadow" trick every CSS-only 3D-text tutorial
 *  uses — `drop-shadow` specifically (not `box-shadow`/`text-shadow`)
 *  because it's the one shadow primitive that follows the element's ACTUAL
 *  rendered alpha shape (glyph outlines, a PNG's own transparency, an SVG
 *  path) rather than just its rectangular box, so this reads correctly on
 *  every element kind — text, image, shape, rect alike — with one code
 *  path. Each step is shaded slightly darker than the last (shadeHex above)
 *  for a subtle lit-surface gradient along the depth, matching the spirit
 *  of the 3D Box's own per-face shading without needing separate faces to
 *  shade. Step count is downsampled for larger depths (a real per-pixel
 *  filter op stacked 1:1 with px would get expensive fast) — capped well
 *  short of where a filter chain this long would cost real frame time.
 *  A flat, front-on illusion: since `drop-shadow` paints as part of this
 *  element's own 2D layer, rotating the element in 3D (config.scene3D's
 *  staticRotateX/Y) rotates the WHOLE painted illusion as one flat card
 *  rather than the shadow steps re-projecting as independent geometry —
 *  an honest limitation of faking this on one element instead of building
 *  real per-face geometry (see the 3D Box template for that alternative
 *  when independently-posable faces are actually needed). '' (falsy) when
 *  there's no depth set, so callers can skip touching `filter` at all. */
export function buildExtrudeFilter(config: Record<string, any>): string {
  const depth = config.extrudeDepth;
  if (!depth || depth <= 0) return '';
  const color = config.extrudeColor || '#333333';
  const steps = Math.min(40, Math.max(1, Math.round(depth / 1.5)));
  const stepPx = depth / steps;
  const parts: string[] = [];
  for (let i = 1; i <= steps; i++) {
    const offset = (stepPx * i).toFixed(2);
    const shaded = shadeHex(color, -((i / steps) * 35));
    parts.push(`drop-shadow(${offset}px ${offset}px 0px ${shaded})`);
  }
  return parts.join(' ');
}

/** Every place either renderer sets an element's CSS `filter` should call
 *  THIS instead of buildFilterString(effects) directly — folds the extrude
 *  illusion above in alongside the ordinary effects stack (drop shadow/
 *  glow/blur/etc.), so both keep working together in one `filter` value
 *  regardless of which one(s) are actually in use. Order matters here:
 *  extrude's own steps are appended AFTER the effects stack, so e.g. a
 *  glow/drop-shadow effect still reads as sitting ON TOP of (closer to the
 *  viewer than) the extruded depth trailing behind it, not the reverse.
 *
 *  `instanceId`/`elId` — this CgTemplateWidget/CgTemplateDesigner mount's
 *  own useId() and this element's own id, used to rebuild the exact same
 *  `${instanceId}-<effectType>-${elId}` id each per-element <filter> def
 *  is published under (see the shared <defs> block each renderer builds) —
 *  every id-based filter effect (currently flagWave, bevel, innerShadow,
 *  gooey) shares this ONE naming scheme, so adding another one later never
 *  needs a new parameter here, just another `find*`/url() line below. Omit
 *  both (or either) and those effects are simply never applied, same as
 *  any caller that predates one of them existing.
 *  `changeAnimPreset` — this element's own `changeAnim?.preset` (a
 *  TemplateElement-level field, not part of `config`, hence the separate
 *  parameter) — appends the 'gooeyMorph' value-change preset's own
 *  threshold filter + a tiny blur (see GOOEY_MATRIX's own doc comment)
 *  whenever that preset is selected, regardless of whether this element
 *  has any `config.effects` at all. Absent (every caller written before
 *  gooeyMorph existed) simply never adds it. */
export function resolveElementFilter(config: Record<string, any>, instanceId?: string, elId?: string, changeAnimPreset?: string): string {
  const filterId = (effectType: string) => (instanceId && elId ? `url(#${instanceId}-${effectType}-${elId})` : '');
  const flagWave = findFlagWave(config.effects) ? filterId('flagwave') : '';
  const bevel = findBevel(config.effects) ? filterId('bevel') : '';
  const innerShadow = findInnerShadow(config.effects) ? filterId('innershadow') : '';
  const rampBlur = findRampBlur(config.effects) ? filterId('rampblur') : '';
  const waveWarp = findWaveWarp(config.effects) ? filterId('wavewarp') : '';
  // The tiny blur softens the glyphs' own hard-antialiased edges just
  // enough for the threshold matrix below to actually have a gradient to
  // work with right at the boundary — straight from the original "Text
  // Morph" technique this preset ports (its own #container rule is
  // `filter: url(#threshold) blur(0.6px)`), always present alongside the
  // threshold reference, not on its own line — kept as one filterId(...)
  // call's own string so it can't accidentally get reordered relative to
  // the reference it depends on.
  const gooey = changeAnimPreset === 'gooeyMorph' ? `${filterId('gooey')} blur(0.6px)`.trim() : '';
  return [buildFilterString(config.effects), buildExtrudeFilter(config), flagWave, bevel, innerShadow, rampBlur, waveWarp, gooey].filter(Boolean).join(' ');
}

// ── Flag Wave (a genuinely-looking-3D cloth ripple, pure SVG filter) ────────
// A rippling "waving flag/cloth" distortion, usable on ANY element (text,
// image, rect, an NDI camera, anything) since it operates on this element's
// own ALREADY-RENDERED pixels — the exact same "just another filter
// primitive" trick Extrude above already uses, so unlike a real cloth
// simulation this needs no separate mesh/geometry (and, per this session's
// own "remove all the heavy 3D/WebGL stuff" directive, no Three.js either):
// <feTurbulence> generates an organic noise field, <feDisplacementMap> warps
// this element's own pixels along it (the geometric ripple), and
// <feDiffuseLighting> (fed the SAME turbulence as a bump map, then
// recombined) paints shaded highlights/shadows along those ripples the way
// real light raking across a folded, moving surface would — THAT lighting
// pass is what actually reads as "3D", not just a flat 2D warp. Animated by
// smoothly oscillating baseFrequency (a "breathing" ripple density, avoids
// the hard visual jump a changing `seed` would cause) and sweeping the
// light's own azimuth continuously — see lib/useFlagWave.ts, the shared
// rAF loop driving both, one hook call each from CgTemplateWidget.tsx/
// CgTemplateDesigner.tsx, same convention useLightSweep.ts already follows.

/** Finds the first enabled flagWave effect in a stack — same "only the
 *  first one" convention findGlass/findLightSweep already use. */
export function findFlagWave(effects: CgEffect[] | undefined): CgEffect | undefined {
  return effects?.find((e) => e.type === 'flagWave' && e.enabled);
}

export interface FlagWaveFilterProps {
  /** feDisplacementMap's own `scale`, px — how far pixels actually move.
   *  Effect's own `amplitude`, default 10. */
  scale: number;
  /** feTurbulence's own `baseFrequency`, oscillated by useFlagWave.ts
   *  between [base*0.7, base*1.3] rather than held fixed — a static
   *  frequency displaces pixels but never visibly MOVES once rendered.
   *  Derived from the effect's own `frequency` (a friendlier 1-10 "ripple
   *  density" dial, default 3) via `/300`, landing in feTurbulence's own
   *  usual useful range (roughly 0.005-0.05) without an operator ever
   *  needing to know that raw unit. */
  baseFrequency: number;
  /** feDiffuseLighting's own `surfaceScale` — how tall the simulated relief
   *  is, i.e. how strong the light/shadow ridges along the ripple read.
   *  Reuses the effect's own `amount` field (default 8; unlike glass's
   *  reuse of the same field for a 100-300ish saturate() percentage, this
   *  is a small 0-20ish range — see CgEffect's own doc comment). */
  surfaceScale: number;
  /** feDistantLight's own starting `azimuth`, degrees — reuses the effect's
   *  own `angle` field (default 45), swept continuously from here by
   *  useFlagWave.ts rather than held fixed, for the same "a static light
   *  never looks like it's moving" reason baseFrequency above isn't fixed
   *  either. */
  azimuth: number;
  /** Seconds for one full oscillation/sweep cycle of both animated
   *  properties above — reuses the effect's own `duration` field (default
   *  3), same "how long one pass takes" meaning lightSweep's own duration
   *  already has, just for a different animated quantity. */
  cycleDuration: number;
}

export function buildFlagWaveFilterProps(effect: CgEffect): FlagWaveFilterProps {
  return {
    scale: Math.max(0, effect.amplitude ?? 10),
    baseFrequency: Math.max(0.001, (effect.frequency ?? 3) / 300),
    surfaceScale: Math.max(0, effect.amount ?? 8),
    azimuth: effect.angle ?? 45,
    cycleDuration: Math.max(0.2, effect.duration ?? 3),
  };
}

// ── Wave Warp (After Effects' own "Wave Warp", pure SVG filter) ────────────
// Mirrors AE's full parameter set — Wave Type, Wave Height, Wave Width,
// Direction, Wave Speed, Phase, Pinning, Anti-aliasing — as a per-element SVG
// filter, same "just another filter primitive, no mesh/geometry" trick
// flagWave/bevel above already use. Two families of wave type:
//  - 'noise'/'smoothNoise' route through a live <feTurbulence> (fractalNoise/
//    turbulence respectively) — the same organic-noise primitive flagWave's
//    own cloth ripple uses, giving the "fractal" ripple look this effect was
//    specifically asked for.
//  - every other wave shape (sine/square/triangle/sawtooth/circle/
//    semicircle) is a procedurally generated, seamlessly-tileable 1-D
//    waveform baked into a <linearGradient spreadMethod="repeat"> (see
//    buildWaveWarpMapSvg) — a periodic function along one axis is exactly
//    what SVG's own repeating-gradient feature already computes for free, no
//    custom tiling/pattern math needed.
// Both families feed the SAME downstream pipeline (see the <filter> markup
// in CgTemplateDesigner.tsx/CgTemplateWidget.tsx): the wave/noise field goes
// through <feOffset> (continuously animated by lib/useWaveWarp.ts's own rAF
// loop, sliding it along Direction at Wave Speed — this is what makes it a
// TRAVELING wave rather than a static ripple) into <feDisplacementMap>
// against SourceGraphic. Pinning (see CgEffect's own doc comment) is applied
// as a separate pass AFTER displacement: a generated edge-falloff mask
// (buildWaveWarpPinMaskSvg) blends between the raw SourceGraphic (0%
// displacement at a pinned edge) and the fully displaced result.

/** Finds the first enabled waveWarp effect in a stack — same "only the first
 *  one" convention every other effect-finder here already uses. */
export function findWaveWarp(effects: CgEffect[] | undefined): CgEffect | undefined {
  return effects?.find((e) => e.type === 'waveWarp' && e.enabled);
}

const WAVE_WARP_NOISE_TYPES = new Set(['noise', 'smoothNoise']);

export interface WaveWarpFilterProps {
  waveType: NonNullable<CgEffect['waveType']>;
  /** feDisplacementMap's own `scale`, px — effect's own `amplitude` (AE's
   *  "Wave Height"), default 20. */
  scale: number;
  /** One full wave's length, px — effect's own `bandWidth` (AE's "Wave
   *  Width"), default 60. Meaningless for the two noise wave types (no
   *  single repeating crest spacing), which fall back to a fixed 80px
   *  "distance per cycle" stand-in instead (see `pxPerSecond`/`phasePx`
   *  below) purely so Wave Speed still reads as a consistent dial across
   *  every wave type. */
  wavelength: number;
  /** Direction the wave travels, degrees — effect's own `angle`. */
  angleDeg: number;
  /** How far the wave/noise field travels per second, px — effect's own
   *  `frequency` (AE's "Wave Speed", cycles/sec) times `wavelength` (or the
   *  noise stand-in), so one cycle advances exactly one wavelength per
   *  second at speed 1. */
  pxPerSecond: number;
  /** Starting offset along Direction, px — effect's own `phase` (degrees),
   *  converted via `phase/360 * wavelength`. */
  phasePx: number;
  /** feTurbulence's own `baseFrequency` — noise types only, derived from
   *  `wavelength` the same inverse relationship flagWave's own `frequency`
   *  dial already uses (a bigger Wave Width reads as bigger, looser noise
   *  blobs). */
  baseFrequency: number;
  pinning: NonNullable<CgEffect['pinning']>;
  antiAlias: NonNullable<CgEffect['antiAlias']>;
}

export function buildWaveWarpFilterProps(effect: CgEffect): WaveWarpFilterProps {
  const waveType = effect.waveType ?? 'sine';
  const wavelength = Math.max(4, effect.bandWidth ?? 60);
  const isNoise = WAVE_WARP_NOISE_TYPES.has(waveType);
  const cycleDistance = isNoise ? 80 : wavelength;
  return {
    waveType,
    scale: Math.max(0, effect.amplitude ?? 20),
    wavelength,
    angleDeg: effect.angle ?? 0,
    pxPerSecond: (effect.frequency ?? 1) * cycleDistance,
    phasePx: ((effect.phase ?? 0) / 360) * cycleDistance,
    baseFrequency: Math.max(0.002, Math.min(0.08, 0.9 / wavelength)),
    pinning: effect.pinning ?? 'none',
    antiAlias: effect.antiAlias ?? 'low',
  };
}

/** One wave shape's own value at normalized phase `p` (`[0, 1)` = one full
 *  period), range `[-1, 1]` — faithful APPROXIMATIONS of AE's own curve
 *  shapes (AE's exact internal algorithm isn't public), not literal
 *  reverse-engineered copies, same "original interpretation, not a clone"
 *  approach every other reference-inspired effect in this file already
 *  takes. 'sine' is exact (it IS just sin()); square/triangle/sawtooth are
 *  exact textbook periodic waveforms; circle/semicircle trace a genuine
 *  circular arc's own height per period, matching AE's own "scalloped"
 *  rather than smooth-sinusoidal read for those two. */
function waveWarpValue(waveType: string, p: number): number {
  switch (waveType) {
    case 'square': return p < 0.5 ? 1 : -1;
    case 'sawtooth': return 2 * p - 1;
    case 'triangle': return p < 0.5 ? (-1 + 4 * p) : (3 - 4 * p);
    case 'circle': {
      // Two half-arcs per period — an upper bulge then a lower one, tracing
      // a genuine circle's own outline rather than a smooth sine curve.
      const q = p < 0.5 ? p * 2 : (p - 0.5) * 2;
      const arc = Math.sqrt(Math.max(0, 1 - (2 * q - 1) * (2 * q - 1)));
      return p < 0.5 ? arc : -arc;
    }
    case 'semicircle': {
      // One upward-only bulge per period (never crosses to negative) —
      // AE's "Semicircle" reads as a series of one-directional humps.
      const arc = Math.sqrt(Math.max(0, 1 - (2 * p - 1) * (2 * p - 1)));
      return 2 * arc - 1;
    }
    case 'sine':
    default:
      return Math.sin(2 * Math.PI * p);
  }
}

const WAVE_WARP_STOP_COUNTS: Record<string, number> = { off: 16, low: 32, high: 64 };

/** Builds a seamlessly-tileable 1-D waveform map as raw <svg> markup (the
 *  caller wraps it as a data URI, same `data:image/svg+xml,${encodeURIComponent(...)}`
 *  convention buildRampMaskSvg's own callers already use) — a single <rect>,
 *  generously oversized relative to the element so a rotated sample never
 *  runs off its edge, filled with a <linearGradient spreadMethod="repeat">
 *  whose stops sample the chosen wave shape once per `wavelength` px along
 *  Direction (`gradientTransform="rotate(angleDeg)"` — SVG's own repeating-
 *  gradient feature already does the "tile a periodic function along one
 *  axis" work, no custom pattern/tiling math needed). Each stop's color
 *  encodes a displacement VECTOR, not a plain height: R and G both carry the
 *  SAME wave value scaled by cos/sin of Direction respectively, so once fed
 *  through <feDisplacementMap> (R→dx, G→dy) the net pixel displacement
 *  always points along one consistent world-space axis regardless of how
 *  the gradient itself is rotated internally — exactly how AE's own Wave
 *  Warp displaces every pixel along a single Direction, not toward/away
 *  from some center point. Regenerated only when settings/element size
 *  change (NOT per animation frame) — lib/useWaveWarp.ts instead slides this
 *  already-built map via a cheap <feOffset>, same "write a live SVG
 *  attribute every frame, don't rebuild a whole filter subtree" convention
 *  flagWave's own baseFrequency/azimuth sweep already established.
 *  `antiAlias` controls the stop count — AE's own "Anti-aliasing for Best
 *  Quality" tiers, approximated here as map resolution: more stops read as
 *  smoother curves and sharper hard edges (square/sawtooth's own
 *  discontinuity softens over roughly one stop's width). */
export function buildWaveWarpMapSvg(waveType: string, wavelength: number, angleDeg: number, antiAlias: string, w: number, h: number): string {
  const stopCount = WAVE_WARP_STOP_COUNTS[antiAlias] ?? 32;
  const angleRad = (angleDeg * Math.PI) / 180;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  const stops: string[] = [];
  for (let i = 0; i <= stopCount; i++) {
    const p = i / stopCount;
    const v = waveWarpValue(waveType, p);
    const r = Math.round(128 + 127 * v * cosA);
    const g = Math.round(128 + 127 * v * sinA);
    stops.push(`<stop offset="${(p * 100).toFixed(3)}%" stop-color="rgb(${r},${g},128)"/>`);
  }
  const pad = Math.max(w, h) * 0.6 + 100;
  const size = Math.max(w, h) + pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="${wavelength}" y2="0" gradientUnits="userSpaceOnUse" spreadMethod="repeat" gradientTransform="rotate(${angleDeg} ${size / 2} ${size / 2})">` +
    stops.join('') +
    `</linearGradient></defs><rect width="${size}" height="${size}" fill="url(#g)"/></svg>`;
}

/** How far (as a fraction of the element's own width/height) the padded
 *  wave map built by buildWaveWarpMapSvg above extends past each edge — the
 *  <feImage> referencing it needs this same box, see the <filter> markup
 *  itself. */
export function waveWarpMapPad(w: number, h: number): number {
  return Math.max(w, h) * 0.6 + 100;
}

/** Builds the pinning edge-falloff mask as raw <svg> markup (data-URI'd by
 *  the caller, same convention as buildWaveWarpMapSvg above) — white (full
 *  warp) fading to black (zero warp, i.e. perfectly pinned) over roughly a
 *  third of the element's own size from whichever edge(s) `pinning` names.
 *  The <filter> markup reads this back out via feColorMatrix as an alpha
 *  value blending the displaced result over the untouched SourceGraphic.
 *  'all' approximates "every edge pinned, free in the middle" with a radial
 *  falloff rather than a true inset-rectangle falloff — an honest
 *  simplification, not a pixel-exact match for AE's own "All Edges". */
export function buildWaveWarpPinMaskSvg(pinning: string, w: number, h: number): string {
  const gw = Math.max(1, w), gh = Math.max(1, h);
  const edgeStops = (invert: boolean) => invert
    ? '<stop offset="0%" stop-color="#fff"/><stop offset="67%" stop-color="#fff"/><stop offset="100%" stop-color="#000"/>'
    : '<stop offset="0%" stop-color="#000"/><stop offset="33%" stop-color="#fff"/><stop offset="100%" stop-color="#fff"/>';
  const pairStops = '<stop offset="0%" stop-color="#000"/><stop offset="22%" stop-color="#fff"/><stop offset="78%" stop-color="#fff"/><stop offset="100%" stop-color="#000"/>';
  let defs: string;
  switch (pinning) {
    case 'left': defs = `<linearGradient id="p" x1="0" y1="0" x2="1" y2="0">${edgeStops(false)}</linearGradient>`; break;
    case 'right': defs = `<linearGradient id="p" x1="0" y1="0" x2="1" y2="0">${edgeStops(true)}</linearGradient>`; break;
    case 'top': defs = `<linearGradient id="p" x1="0" y1="0" x2="0" y2="1">${edgeStops(false)}</linearGradient>`; break;
    case 'bottom': defs = `<linearGradient id="p" x1="0" y1="0" x2="0" y2="1">${edgeStops(true)}</linearGradient>`; break;
    case 'leftRight': defs = `<linearGradient id="p" x1="0" y1="0" x2="1" y2="0">${pairStops}</linearGradient>`; break;
    case 'topBottom': defs = `<linearGradient id="p" x1="0" y1="0" x2="0" y2="1">${pairStops}</linearGradient>`; break;
    case 'all':
    default:
      defs = `<radialGradient id="p" cx="50%" cy="50%" r="70%"><stop offset="0%" stop-color="#fff"/><stop offset="70%" stop-color="#fff"/><stop offset="100%" stop-color="#000"/></radialGradient>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${gw}" height="${gh}"><defs>${defs}</defs><rect width="${gw}" height="${gh}" fill="url(#p)"/></svg>`;
}

// ── Bevel & Emboss (a raised, lit 3D relief, pure SVG filter) ──────────────
// Photoshop's own "Bevel and Emboss" layer style, usable on ANY element the
// same way flagWave is — this element's own alpha channel becomes a height
// map (no turbulence/randomness this time, unlike flagWave — a bevel traces
// the ACTUAL shape's own edges, not a random ripple), blurred slightly for
// a smooth transition, then lit from one side via <feDiffuseLighting>: a
// real diffuse light responds to the SURFACE NORMAL direction, so edges
// facing the light naturally come out bright and edges facing away
// naturally come out dark — one lighting pass gets both the highlight AND
// the shadow side of the relief for free, unlike a pure specular-only
// approach which would only ever produce a hotspot with no shading. The
// result is blended back over the original graphic (mode: 'overlay', the
// same blend mode Photoshop's own Bevel/Emboss uses internally) so the
// original colors show through the relief rather than being replaced by
// it. `edgeOnly` (see TemplateElement's own doc comment) narrows the alpha
// map down to a thin ring first, via feMorphology's erode operator
// subtracted from the original alpha (an "outline-only" mask) — same
// lighting recipe after that, just applied to a ring instead of the whole
// shape. Static, not animated (see lib/useFlagWave.ts's own doc comment on
// why THAT effect needs continuous motion — a bevel doesn't; a fixed lit
// relief is the whole point of the look).

/** Finds the first enabled bevel effect in a stack — same "only the first
 *  one" convention every other effect-finder here already uses. */
export function findBevel(effects: CgEffect[] | undefined): CgEffect | undefined {
  return effects?.find((e) => e.type === 'bevel' && e.enabled);
}

export interface BevelFilterProps {
  /** feGaussianBlur's own stdDeviation on the alpha-derived height map —
   *  effect's own `blurRadius`, default 3. */
  softness: number;
  /** feDiffuseLighting's own surfaceScale — effect's own `amount`, default 4. */
  surfaceScale: number;
  /** feDistantLight's own azimuth, degrees — effect's own `angle`, default 135. */
  azimuth: number;
  /** feDistantLight's own elevation, degrees — effect's own `elevation`, default 55. */
  elevation: number;
  /** feSpecularLighting's own specularExponent (the highlight's own shine/
   *  glossiness) — effect's own `shininess`, default 12. */
  shininess: number;
  /** Whether to narrow the relief to a thin outline ring — effect's own
   *  `edgeOnly`, default false. */
  edgeOnly: boolean;
  /** feMorphology's own erode radius when `edgeOnly` is on — effect's own
   *  `bandWidth` (px here, not the percentage lightSweep uses it as),
   *  default 8. */
  ringWidth: number;
  /** feDiffuseLighting's own OUTPUT for a perfectly FLAT surface normal —
   *  see the `<filter>` markup's own doc comment for why every renderer
   *  subtracts this (as a feComponentTransfer intercept) from `diffuse`
   *  before using it. Depends only on `elevation` — `N·L` for a flat
   *  normal (0,0,1) is just `L.z`, and feDistantLight's own L.z is
   *  sin(elevation) — independent of surfaceScale/diffuseConstant=1. */
  diffuseBaseline: number;
  /** feSpecularLighting's own OUTPUT for a perfectly FLAT surface normal —
   *  same idea as diffuseBaseline, subtracted from `spec` before use. Per
   *  the spec's own Si = specularConstant * pow(N·H, specularExponent)
   *  formula, with N=(0,0,1) and H the light/eye halfway vector (eye
   *  looking straight down +Z): N·H reduces to sqrt((1+sin(elevation))/2)
   *  (H.z after normalizing L+(0,0,1) — the algebra cancels azimuth
   *  entirely, as it should for a symmetric front-on viewer). specularConstant
   *  is fixed at 0.6 in the actual filter markup (not a user-facing field),
   *  so this hardcodes the same constant to match. An approximation (real
   *  engines' exact specular formula has minor implementation differences)
   *  rather than an exact cancellation, so a very faint sheen can still
   *  remain on a fully flat surface — a legitimate, Photoshop-like "glossy"
   *  characteristic at that point, not a bug, and far short of the
   *  effect's own pre-fix whole-shape wash-out this exists to prevent. */
  specBaseline: number;
}

export function buildBevelFilterProps(effect: CgEffect): BevelFilterProps {
  const elevation = Math.max(0, Math.min(90, effect.elevation ?? 55));
  const shininess = Math.max(1, effect.shininess ?? 12);
  const elevationRad = (elevation * Math.PI) / 180;
  return {
    softness: Math.max(0, effect.blurRadius ?? 3),
    surfaceScale: Math.max(0, effect.amount ?? 4),
    azimuth: effect.angle ?? 135,
    elevation,
    shininess,
    edgeOnly: !!effect.edgeOnly,
    ringWidth: Math.max(1, effect.bandWidth ?? 8),
    diffuseBaseline: Math.max(0, Math.sin(elevationRad)),
    specBaseline: 0.6 * Math.pow(Math.sqrt(Math.max(0, (1 + Math.sin(elevationRad)) / 2)), shininess),
  };
}

export function findInnerShadow(effects: CgEffect[] | undefined): CgEffect | undefined {
  return effects?.find((e) => e.type === 'innerShadow' && e.enabled);
}

export interface InnerShadowFilterProps {
  offsetX: number;
  offsetY: number;
  /** feGaussianBlur's own stdDeviation on the offset, inverted-alpha
   *  "outside" mask — effect's own `blurRadius`, default 5. */
  blur: number;
  color: string;
  /** feFlood's own flood-opacity, 0-1 — effect's own `opacity` (0-100),
   *  default 85. */
  opacity: number;
}

/** "Inner Shadow" — a pressed-in/engraved 3D look, the natural complement
 *  to Bevel & Emboss's raised one, and a much simpler recipe (plain alpha/
 *  offset/blur/composite, no lighting-baseline math to get right the way
 *  bevel's feDiffuseLighting/feSpecularLighting needed — see
 *  buildBevelFilterProps' own doc comment on diffuseBaseline/specBaseline
 *  for why THAT one needed correcting). The classic "invert the alpha,
 *  offset it, blur it, clip back to the original shape" trick: SourceAlpha
 *  inverted (1 where the element is TRANSPARENT, 0 where it's opaque) is
 *  offset toward the light and blurred, so blurring spreads darkness
 *  INWARD from whichever edge faces away from the light — then the whole
 *  thing is clipped back to the element's own true shape (feComposite
 *  operator="in" against SourceAlpha) so it only ever darkens genuinely
 *  covered pixels, and finally painted OVER the original content. Follows
 *  SourceAlpha throughout, exactly like bevel — glyph shapes, an image's
 *  own transparency, an SVG path, alike, never a rectangular "box". */
export function buildInnerShadowFilterProps(effect: CgEffect): InnerShadowFilterProps {
  return {
    offsetX: effect.offsetX ?? 4,
    offsetY: effect.offsetY ?? 4,
    blur: Math.max(0, effect.blurRadius ?? 5),
    color: effect.color ?? '#000000',
    opacity: Math.max(0, Math.min(100, effect.opacity ?? 85)) / 100,
  };
}

// ── Gooey Morph (changeAnim preset, not a config.effects entry) ────────────
// The classic "melting text" crossfade — ported from the well-known
// "SVG Filter Text Morph" technique (feColorMatrix used as a hard alpha
// threshold): TWO overlapping copies of this text element's own glyphs (the
// outgoing value and the incoming one), each independently blurred/faded by
// lib/useGooeyMorph.ts-equivalent logic in CgTemplateWidget.tsx/
// CgTemplateDesigner.tsx's own value-change effect (no separate hook file —
// unlike flagWave/lightSweep's OWN continuous rAF loops, this is a single
// GSAP tween per value change, the same shape every other changeAnim
// preset in cgChangePresets.ts already is, just driving two nodes instead
// of one) — this filter is what turns "two blurry, semi-transparent copies
// of some text overlapping" into the actual gooey/liquid merge look: a
// steep threshold on the ALPHA channel alone (RGB rows below are identity —
// r'=r, g'=g, b'=b) snaps every pixel to either fully opaque or fully
// transparent at ~54% alpha, so wherever the two blurred glyphs' soft edges
// overlap enough to cross that threshold TOGETHER, they read as one solid
// merged blob instead of two visibly separate, blurry words. Values kept
// numerically identical to the original technique (a `255`/`-140` step
// entirely on the alpha row) rather than re-derived, since it's already a
// well-proven exact recipe. */
export const GOOEY_THRESHOLD_MATRIX = '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 255 -140';

// ── Animated Background ──────────────────────────────────────────────────
// A moving pattern behind this element's own content, instead of a flat
// solid color or a static CgGradient — a curated, not exhaustive, spread
// of the most common "animated background" looks (a panning gradient,
// scrolling stripes, a breathing glow, a hue-cycling wash), each just a
// plain CSS background + one animated property (background-position,
// filter: hue-rotate, or opacity/scale) rather than anything exotic — no
// canvas/WebGL particle system, in keeping with this session's own "stop
// pulling in heavy runtime machinery" direction. The actual motion is a
// shared GSAP loop (lib/useAnimatedBg.ts, one hook call each from
// CgTemplateWidget.tsx/CgTemplateDesigner.tsx, same convention
// useLightSweep.ts already established); this just computes each style's
// own static CSS (the "at rest" look before its own animated property
// starts moving).

export interface AnimatedBgStyle {
  background: string;
  backgroundSize?: string;
  /** 'prism' only — a plain, UNANIMATED `filter: blur(...)` for its own
   *  `blurRadius`-driven "Soften" (see TemplateElement's own doc comment on
   *  that reuse). Applied as a static style property alongside `background`
   *  — distinct from `animate`'s own 'filter' case below (colorCycle's
   *  hue-rotate), which DOES tween over time. */
  staticFilter?: string;
  /** Which CSS property useAnimatedBg.ts actually animates for this style,
   *  and its own to/from bounds — kept alongside the static background
   *  above so both live in one place instead of the two renderers each
   *  needing to know a given style's own animated property by name. */
  animate: { prop: 'backgroundPositionX' | 'backgroundPosition' | 'filter' | 'opacity' | 'scale' | 'rotation'; from: string | number; to: string | number };
  /** Whether `animate`'s own `to` state is PIXEL-IDENTICAL to `from` — i.e.
   *  whether a hard "loop" restart (snap straight back to `from`, see
   *  lib/useAnimatedBg.ts's own 'loop' playMode) is actually invisible, not
   *  just unlikely to be noticed. True for anything built on a genuinely
   *  periodic/tiling pattern panned by an exact multiple of its own period,
   *  or a rotation/hue-rotate that completes a full 360° (always identical
   *  to its own start). False for a few styles (pulse's breathing scale,
   *  aurora/mesh's drifting blob cluster, prism/pixel's own non-periodic
   *  shape curve or diagonal sampling) where no cheap construction closes
   *  the loop — useAnimatedBg.ts falls those back to yoyo motion under
   *  'loop' mode instead of ever actually risking a visible jump cut. */
  loopSafe: boolean;
}

/** Finds the first enabled animatedBg effect in a stack — same "only the
 *  first one" convention every other effect-finder here already uses. */
export function findAnimatedBg(effects: CgEffect[] | undefined): CgEffect | undefined {
  return effects?.find((e) => e.type === 'animatedBg' && e.enabled);
}

/** Rotates a "#rrggbb" color's own HUE by `degrees` around the color wheel,
 *  keeping its saturation/lightness — 'colorRamp' below's own building
 *  block (a spectrum of stops all sharing one color's own richness/depth,
 *  not a jarring pure-rainbow regardless of what was actually picked).
 *  Falls back to `hex` unchanged for anything that doesn't parse, same
 *  tolerance shadeHex above already has. */
function hueRotateHex(hex: string, degrees: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 0xff) / 255, g = ((n >> 8) & 0xff) / 255, b = (n & 0xff) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  h = (h + degrees) % 360;
  if (h < 0) h += 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m2 = l - c / 2;
  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const toHex = (v: number) => Math.round((v + m2) * 255).toString(16).padStart(2, '0');
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
}

/** A genuine multi-hue spectrum — 7 stops evenly spaced all the way around
 *  the wheel starting from `hex`, ending back at `hex` itself (a seamless
 *  loop once panned). Used by 'colorRamp' below — distinct from
 *  'gradientShift' (a plain 2-color diagonal) and 'colorCycle' (one solid
 *  color hue-rotated as a whole) in actually reading as a moving rainbow
 *  strip, not just a shifting tint. */
function rampStopsFromColor(hex: string): string[] {
  const steps = 6;
  return Array.from({ length: steps + 1 }, (_, i) => hueRotateHex(hex, (360 / steps) * i));
}

/** A static (non-animated) monochrome noise texture, as a data-URI
 *  `url(...)` usable directly as one layer of a multi-layer CSS
 *  `background` — 'animatedBg' 's own 'grain' style below layers this on
 *  top of a plain panning gradient. feTurbulence generates the noise,
 *  feColorMatrix desaturates it (color noise reads as confetti, not film
 *  grain), feComponentTransfer's own linear `slope` is what actually
 *  applies `opacity` (an `<feTurbulence>` alone has no opacity knob — the
 *  overlay must fade the NOISE itself, not the whole layer via CSS
 *  opacity, since that would also fade the gradient underneath it when
 *  composited as a single `background` shorthand). `baseFrequency` is
 *  derived from `freq` (1-10, higher = finer/tighter grain) the same
 *  friendly-dial way flagWave's own `frequency` field already maps to its
 *  turbulence. Tiled at a fixed 180×180px (see buildAnimatedBgStyle's own
 *  `backgroundSize` for this layer) regardless of element size — grain
 *  reads as a fixed-scale texture, not something that should stretch. */
function buildGrainOverlaySvg(opacity: number, freq: number): string {
  const baseFrequency = 0.02 + (Math.max(1, Math.min(10, freq)) / 10) * 0.6;
  const clampedOpacity = Math.max(0, Math.min(1, opacity));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180">`
    + `<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="${baseFrequency}" numOctaves="2" stitchTiles="stitch" result="t"/>`
    + `<feColorMatrix in="t" type="saturate" values="0"/>`
    + `<feComponentTransfer><feFuncA type="linear" slope="${clampedOpacity}"/></feComponentTransfer></filter>`
    + `<rect width="100%" height="100%" filter="url(#n)"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Linearly interpolates between two "#rrggbb" colors at `t` (0=a, 1=b) —
 *  'prism' 's own band-sampling building block. Falls back to `a` unchanged
 *  for anything that doesn't parse, same tolerance shadeHex/hueRotateHex
 *  already have. */
function lerpHex(a: string, b: string, t: number): string {
  const ma = /^#([0-9a-f]{6})$/i.exec(a), mb = /^#([0-9a-f]{6})$/i.exec(b);
  if (!ma || !mb) return a;
  const na = parseInt(ma[1], 16), nb = parseInt(mb[1], 16);
  const lerp = (shift: number) => {
    const va = (na >> shift) & 0xff, vb = (nb >> shift) & 0xff;
    return Math.round(va + (vb - va) * t);
  };
  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${toHex(lerp(16))}${toHex(lerp(8))}${toHex(lerp(0))}`;
}

/** 'prism' 's own ordered color ramp, as cumulative 0-1 stop positions —
 *  `effect.colors` (each stop's own `weight` becomes its share of the
 *  0-1 ramp; equal weights spread evenly) when present, else a plain
 *  `color`→`color2` 2-stop fallback so a freshly-added prism effect (no
 *  colors authored yet) still shows something. `reverseColors` flips the
 *  authored order before weights are applied. Always at least 2 stops. */
export function resolveColorStops(effect: CgEffect): { hex: string; pos: number }[] {
  const raw = effect.colors?.length ? effect.colors : [
    { id: 'a', hex: effect.color ?? '#3355ff', weight: 1 },
    { id: 'b', hex: effect.color2 ?? shadeHex(effect.color ?? '#3355ff', -45), weight: 1 },
  ];
  const ordered = effect.reverseColors ? [...raw].reverse() : raw;
  const totalWeight = ordered.reduce((sum, c) => sum + Math.max(0.01, c.weight), 0);
  let cursor = 0;
  return ordered.map((c) => {
    const pos = cursor / totalWeight;
    cursor += Math.max(0.01, c.weight);
    return { hex: c.hex, pos };
  });
}

/** Samples `stops` (see resolveColorStops) at ramp position `t` (0-1),
 *  linearly blending between whichever two stops straddle it. */
export function sampleColorStops(stops: { hex: string; pos: number }[], t: number): string {
  if (stops.length === 0) return '#3355ff';
  if (stops.length === 1 || t <= stops[0].pos) return stops[0].hex;
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i].pos || i === stops.length - 1) {
      const prev = stops[i - 1];
      const span = Math.max(0.0001, stops[i].pos - prev.pos);
      return lerpHex(prev.hex, stops[i].hex, Math.max(0, Math.min(1, (t - prev.pos) / span)));
    }
  }
  return stops[stops.length - 1].hex;
}

/** Each 'prism' shape preset's own band-height curve — `t` is that band's
 *  position along the strip (0-1), `peak` is `acrossPct`/100 (where the
 *  curve's own peak sits; slant ignores it, it has none). Returns a 0-1
 *  fraction of the pattern's own max height (`heightPct`). See
 *  TemplateElement's own 'animatedBg'/`shapePreset` doc comment for what
 *  each one is meant to look like. */
function prismShapeHeight(preset: string, t: number, peak: number): number {
  if (preset === 'lens') {
    const d = Math.abs(t - peak) / Math.max(peak, 1 - peak, 0.01);
    return Math.max(0.08, 1 - d * d);
  }
  if (preset === 'crest') {
    // A broader, flatter-topped single hump than 'lens' — sin() raised to
    // a fractional power widens the near-peak plateau.
    const shifted = peak === 0.5 ? t : Math.min(1, Math.max(0, (t - peak) * 0.5 + 0.5));
    return Math.max(0.08, Math.pow(Math.sin(shifted * Math.PI), 0.6));
  }
  if (preset === 'valley') {
    const shifted = peak === 0.5 ? t : Math.min(1, Math.max(0, (t - peak) * 0.5 + 0.5));
    return Math.max(0.08, 1 - Math.pow(Math.sin(shifted * Math.PI), 0.6) * 0.85);
  }
  if (preset === 'tide') {
    return Math.max(0.08, 0.5 + 0.5 * Math.sin(t * Math.PI * 2 - peak * Math.PI * 2));
  }
  // 'slant' (default) — a plain linear ramp, no single peak.
  return Math.max(0.05, t);
}

/** A static 'prism' pattern — `stripCount` colored bands, each sampled
 *  from `resolveColorStops` at its own position and sized by
 *  `prismShapeHeight`, as a data-URI `url(...)` usable directly as a CSS
 *  `background` layer — same technique buildGrainOverlaySvg already uses.
 *  Built on a 0-100 viewBox regardless of the element's own real size (CSS
 *  `background-size: 100% 100%` below stretches it to fit), so no element
 *  width/height needs to reach this function at all. `direction` picks
 *  which axis the bands run and which end `colors`' first stop starts
 *  from; `amount` (0-100) softens each band's own hard edge into its
 *  neighbor via a per-band linear-gradient fade instead of a flat fill
 *  once above 0; `facetsPct` (0-100) overlays a repeating diagonal
 *  highlight/shadow hairline pattern for a faceted-glass glint. */
function buildPrismSvg(effect: CgEffect): string {
  const stops = resolveColorStops(effect);
  const stripCount = Math.max(2, Math.min(80, Math.round(effect.stripCount ?? 22)));
  const shapePreset = effect.shapePreset ?? 'slant';
  const heightPct = Math.max(0, Math.min(100, effect.heightPct ?? 60)) / 100;
  const acrossPct = Math.max(0, Math.min(100, effect.acrossPct ?? 50)) / 100;
  const alongPct = Math.max(0, Math.min(100, effect.alongPct ?? 50)) / 100;
  const direction = effect.bandDirection ?? 'up';
  const blend = Math.max(0, Math.min(100, effect.amount ?? 0)) / 100;
  const facets = Math.max(0, Math.min(100, effect.facetsPct ?? 0)) / 100;
  const vertical = direction === 'up' || direction === 'down';
  const flip = direction === 'down' || direction === 'left';

  const bandW = 100 / stripCount;
  let defs = '';
  let body = '';
  for (let i = 0; i < stripCount; i++) {
    const t = (i + 0.5) / stripCount;
    const sampleT = flip ? 1 - t : t;
    const hex = sampleColorStops(stops, sampleT);
    const hFrac = prismShapeHeight(shapePreset, t, acrossPct) * heightPct;
    const bandH = Math.max(2, hFrac * 100);
    const baseline = 100 - alongPct * 100;
    const top = Math.max(0, baseline - bandH);
    const x = i * bandW;
    let fill = hex;
    if (blend > 0 && i < stripCount - 1) {
      const nextT = (i + 1.5) / stripCount;
      const nextHex = sampleColorStops(stops, flip ? 1 - nextT : nextT);
      const gid = `g${i}`;
      defs += `<linearGradient id="${gid}" ${vertical ? 'x1="0" y1="0" x2="1" y2="0"' : 'x1="0" y1="0" x2="0" y2="1"'}>`
        + `<stop offset="${Math.max(0, 50 - blend * 50)}%" stop-color="${hex}"/>`
        + `<stop offset="${Math.min(100, 50 + blend * 50)}%" stop-color="${nextHex}"/></linearGradient>`;
      fill = `url(#${gid})`;
    }
    if (vertical) {
      body += `<rect x="${x}" y="${top}" width="${bandW + 0.5}" height="${bandH}" fill="${fill}"/>`;
    } else {
      body += `<rect x="${top}" y="${x}" width="${bandH}" height="${bandW + 0.5}" fill="${fill}"/>`;
    }
  }
  if (facets > 0) {
    const fid = 'facet';
    const spacing = Math.max(2, 10 - facets * 8);
    defs += `<pattern id="${fid}" width="${spacing}" height="${spacing}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">`
      + `<rect width="${spacing / 2}" height="${spacing}" fill="rgba(255,255,255,${0.12 * facets})"/></pattern>`;
    body += `<rect x="0" y="0" width="100" height="100" fill="url(#${fid})"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none">`
    + (defs ? `<defs>${defs}</defs>` : '') + body + `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** A repeating horizontal sine-wave boundary between bands sampled across
 *  `colors` — one 240×240 tile (see buildAnimatedBgStyle's own
 *  `backgroundSize` for this layer), panned sideways for a flowing-water
 *  read. `frequency` (reused, 1-10) is how many waves fit across one tile;
 *  `amplitude` (reused, 0-100) is wave height as a fraction of the tile. */
function buildWaveSvg(effect: CgEffect): string {
  const stops = resolveColorStops(effect);
  const waveCount = Math.max(1, Math.min(10, effect.frequency ?? 3));
  const amp = (Math.max(0, Math.min(100, effect.amplitude ?? 40)) / 100) * 50;
  const bandCount = Math.max(2, stops.length);
  const tile = 240;
  const mid = tile / 2;
  let body = '';
  for (let i = 0; i < bandCount; i++) {
    const t = i / (bandCount - 1);
    const hex = sampleColorStops(stops, t);
    const phase = (i / bandCount) * Math.PI * 2;
    const yAt = (x: number) => mid + Math.sin((x / tile) * waveCount * Math.PI * 2 + phase) * amp * (1 - Math.abs(t - 0.5) * 0.6);
    let d = `M 0 ${tile} L 0 ${yAt(0).toFixed(1)}`;
    for (let x = 0; x <= tile; x += 12) d += ` L ${x} ${yAt(x).toFixed(1)}`;
    d += ` L ${tile} ${tile} Z`;
    body += `<path d="${d}" fill="${hex}" opacity="${(1 / bandCount * 1.6).toFixed(2)}"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${tile}">`
    + `<rect width="${tile}" height="${tile}" fill="${stops[0].hex}"/>` + body + `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** A mosaic grid of flat-colored square-ish cells, each sampled from
 *  `colors` DIAGONALLY across the grid — `stripCount` (reused) is columns,
 *  rows derive from a fixed 0-100 viewBox so cells read roughly square
 *  regardless of the element's own aspect ratio. `reverseColors` (reused)
 *  flips the sampling direction. */
function buildPixelSvg(effect: CgEffect): string {
  const stops = resolveColorStops(effect);
  const cols = Math.max(2, Math.min(60, Math.round(effect.stripCount ?? 16)));
  const rows = cols;
  const cellW = 100 / cols, cellH = 100 / rows;
  const reverse = !!effect.reverseColors;
  let body = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let t = (r + c) / (rows + cols - 2 || 1);
      if (reverse) t = 1 - t;
      const hex = sampleColorStops(stops, t);
      body += `<rect x="${(c * cellW).toFixed(2)}" y="${(r * cellH).toFixed(2)}" width="${(cellW + 0.3).toFixed(2)}" height="${(cellH + 0.3).toFixed(2)}" fill="${hex}"/>`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none">${body}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function buildAnimatedBgStyle(effect: CgEffect): AnimatedBgStyle {
  const color = effect.color ?? '#3355ff';
  const color2 = effect.color2 ?? shadeHex(color, -45);
  const angle = effect.angle ?? 45;
  const style = effect.animatedBgStyle ?? 'gradientShift';

  if (style === 'stripes') {
    // A wide diagonal repeating band — backgroundPositionX pans it along
    // its own gradient axis, reading as continuously scrolling stripes.
    // The repeating-linear-gradient's own `angle` rotates the WHOLE
    // pattern; position panning always just slides along that same
    // rotated axis, whatever it is.
    // Period is exactly 80px (40px + 40px); panning by 160px — two full
    // periods — means the frame at `to` is pixel-identical to `from`, so a
    // hard 'loop' restart is genuinely invisible, not just unlikely to be
    // noticed.
    return {
      background: `repeating-linear-gradient(${angle}deg, ${color} 0 40px, ${color2} 40px 80px)`,
      backgroundSize: '200% 200%',
      animate: { prop: 'backgroundPositionX', from: '0px', to: '160px' },
      loopSafe: true,
    };
  }
  if (style === 'pulse') {
    // A soft glow breathing in size/opacity — the gradient itself stays
    // fixed, `scale`/`opacity` on the whole background div do the animating
    // (see useAnimatedBg.ts — this one style doesn't use backgroundPositionX
    // at all, `animate` here is really just documentation; the hook branches
    // on style === 'pulse' directly for its own two-property tween).
    // 0.85 and 1.15 are genuinely different scales — no hard 'loop' restart
    // closes that gap invisibly, so useAnimatedBg.ts falls this back to
    // yoyo motion regardless of the operator's own Play Mode pick.
    return {
      background: `radial-gradient(circle at 50% 50%, ${hexToRgba(color, 55)}, ${hexToRgba(color2, 0)} 70%)`,
      animate: { prop: 'scale', from: 0.85, to: 1.15 },
      loopSafe: false,
    };
  }
  if (style === 'colorCycle') {
    // A plain solid wash — the color itself never changes, `filter:
    // hue-rotate()` on the background div sweeps it through the whole
    // wheel instead, cheaper than actually re-computing new colors.
    // hue-rotate(360deg) is mathematically identical to hue-rotate(0deg)
    // (hue is modulo 360°) — a full cycle always closes perfectly.
    return {
      background: color,
      animate: { prop: 'filter', from: 'hue-rotate(0deg)', to: 'hue-rotate(360deg)' },
      loopSafe: true,
    };
  }
  if (style === 'glass') {
    // A glossy highlight sweeping across a softly frosted, translucent
    // tint — reads as light catching a moving pane of glass, not a flat
    // color panning. Own SVG mode filed under a DIFFERENT catalog (the
    // static 'glass' CgEffect elsewhere — a backdrop-filter blur/frost on
    // this element's own content); this one is purely a background paint,
    // no backdrop-filter involved, so it works even with nothing behind
    // this element to actually blur. A REPEATING 3-stop gradient (tint →
    // highlight → the SAME tint, one exact 400px period) rather than the
    // old 4-stop one-shot sheen — that one didn't close (its own first and
    // last stops were different alphas), so panning across it and hard-
    // restarting would have visibly jumped; this always closes.
    const period = 400;
    return {
      background: `repeating-linear-gradient(115deg, ${hexToRgba(color, 10)} 0px, ${hexToRgba('#ffffff', 35)} ${period * 0.5}px, ${hexToRgba(color, 10)} ${period}px)`,
      animate: { prop: 'backgroundPositionX', from: '0px', to: `${period}px` },
      loopSafe: true,
    };
  }
  if (style === 'colorRamp') {
    // A genuine multi-hue spectrum strip derived from `color` alone (see
    // rampStopsFromColor above) — distinct from gradientShift's plain
    // 2-color diagonal and colorCycle's single-solid hue-rotate.
    // rampStopsFromColor's own last stop already equals its first (a full
    // 360° hue loop) — spread as a REPEATING gradient over one exact 350px
    // period (rather than the old oversized-image-plus-percentage-pan,
    // which didn't actually traverse one full period) and panned by
    // exactly that period, so the loop genuinely closes.
    const period = 350;
    const rampStops = rampStopsFromColor(color);
    const stopStr = rampStops.map((c, i) => `${c} ${Math.round((i / (rampStops.length - 1)) * period)}px`).join(', ');
    return {
      background: `repeating-linear-gradient(${angle}deg, ${stopStr})`,
      animate: { prop: 'backgroundPositionX', from: '0px', to: `${period}px` },
      loopSafe: true,
    };
  }
  if (style === 'aurora') {
    // Several large, soft, overlapping color blobs (northern-lights style)
    // — `background-position` (both axes as one CSS value, still a SINGLE
    // property useAnimatedBg.ts's generic animator can tween) pans the
    // whole cluster diagonally, reading as slow, organic drifting rather
    // than a mechanical left-right pan.
    // The blob cluster drifts from one corner toward the other — `to` is a
    // genuinely different crop of the image than `from` (blobs don't wrap
    // around to recreate the start), so a hard 'loop' restart WOULD jump;
    // useAnimatedBg.ts falls this back to yoyo instead.
    return {
      background: [
        `radial-gradient(circle at 20% 30%, ${hexToRgba(color, 55)}, transparent 55%)`,
        `radial-gradient(circle at 80% 70%, ${hexToRgba(color2, 50)}, transparent 55%)`,
        `radial-gradient(circle at 50% 50%, ${hexToRgba(hueRotateHex(color, 60), 40)}, transparent 60%)`,
      ].join(', '),
      backgroundSize: '200% 200%',
      animate: { prop: 'backgroundPosition', from: '0% 0%', to: '100% 100%' },
      loopSafe: false,
    };
  }
  if (style === 'mesh') {
    // Four large, soft corner blobs sized to overlap across the WHOLE
    // element — a smooth full-bleed color field (the "mesh gradient" look
    // popularized by Apple marketing pages), distinct from 'aurora' 's own
    // three smaller glowing blobs on an implied dark base. Two authored
    // colors plus two hue-derived tones for real richness, panned
    // diagonally the same gentle way 'aurora' already does.
    // Same reasoning as 'aurora' just above — a genuine drift, not a
    // wrapping pattern, so 'loop' mode falls back to yoyo too.
    return {
      background: [
        `radial-gradient(circle at 15% 20%, ${hexToRgba(color, 85)}, transparent 65%)`,
        `radial-gradient(circle at 85% 15%, ${hexToRgba(hueRotateHex(color, 40), 75)}, transparent 65%)`,
        `radial-gradient(circle at 20% 85%, ${hexToRgba(hueRotateHex(color2, -30), 75)}, transparent 65%)`,
        `radial-gradient(circle at 85% 85%, ${hexToRgba(color2, 85)}, transparent 65%)`,
      ].join(', '),
      backgroundSize: '160% 160%',
      animate: { prop: 'backgroundPosition', from: '0% 0%', to: '100% 100%' },
      loopSafe: false,
    };
  }
  if (style === 'grain') {
    // A plain panning diagonal gradient (identical base to 'gradientShift',
    // now also a REPEATING gradient — see that style's own comment below)
    // with a static noise texture layered on top — see
    // buildGrainOverlaySvg for the actual SVG feTurbulence recipe (built
    // with `stitchTiles="stitch"`, which is SVG's own guarantee that a
    // feTurbulence tile repeats seamlessly at its own edges). Both layers
    // now share the exact SAME 180px period, so the one shared
    // `backgroundPositionX` pan closes both of them at once.
    // `amplitude` is the grain's own opacity (0-100, default 35),
    // `frequency` its coarseness (1-10, default 5, higher = finer grain).
    const grainOpacity = (effect.amplitude ?? 35) / 100;
    const grainFreq = effect.frequency ?? 5;
    const period = 180;
    return {
      background: [
        buildGrainOverlaySvg(grainOpacity, grainFreq),
        `repeating-linear-gradient(${angle}deg, ${color} 0px, ${color2} ${period / 2}px, ${color} ${period}px)`,
      ].join(', '),
      backgroundSize: `${period}px ${period}px, ${period}px ${period}px`,
      animate: { prop: 'backgroundPositionX', from: '0px', to: `${period}px` },
      loopSafe: true,
    };
  }
  if (style === 'prism') {
    // A real static multi-band SVG pattern (see buildPrismSvg) — panned the
    // same gentle way every other style here already is; `blurRadius`
    // (reused, "Soften") is a plain unanimated CSS blur on top. The band
    // SHAPE curves (lens/crest/valley/tide all peak once, not periodically)
    // mean an 8% pan doesn't land back on an identical crop, so 'loop' mode
    // falls back to yoyo rather than ever risking a visible jump.
    const soften = effect.blurRadius ?? 0;
    return {
      background: buildPrismSvg(effect),
      // Oversized (not a flush 100% 100%) so there's actual room for the
      // pan below to shift within — at an exact 100% fit there's no slack
      // to move, nothing would visibly animate.
      backgroundSize: '112% 112%',
      staticFilter: soften > 0 ? `blur(${soften}px)` : undefined,
      animate: { prop: 'backgroundPositionX', from: '0%', to: '8%' },
      loopSafe: false,
    };
  }
  if (style === 'conic') {
    // A native CSS conic-gradient sweep, sampled across the same N-color
    // ramp 'prism' uses — spun via actual rotation (GSAP's own `rotation`
    // tween) rather than panning, the one style here that moves this way.
    // A full 360° rotation of ANY element is always visually identical to
    // 0° (rotation is a continuous group operation — there is no pixel
    // difference between unrotated and rotated-exactly-once-around), so
    // this is unconditionally seamless.
    const stops = resolveColorStops(effect);
    const stopList = stops.map((s) => `${s.hex} ${Math.round(s.pos * 100)}%`).join(', ');
    return {
      background: `conic-gradient(from ${angle}deg, ${stopList}, ${stops[0].hex} 100%)`,
      animate: { prop: 'rotation', from: 0, to: 360 },
      loopSafe: true,
    };
  }
  if (style === 'wave') {
    // buildWaveSvg's own tile is built from an integer number of full sine
    // cycles across its own width, so the wave's height/slope at x=0 and
    // x=tileWidth always match exactly — panning by one full tile width is
    // a genuinely seamless loop, not an approximation.
    return {
      background: buildWaveSvg(effect),
      backgroundSize: '240px 100%',
      animate: { prop: 'backgroundPositionX', from: '0px', to: '240px' },
      loopSafe: true,
    };
  }
  if (style === 'pixel') {
    // The mosaic's own colors sample a continuous diagonal ramp across the
    // WHOLE grid (corner to corner), not a wrapping/tileable pattern, so an
    // 8% pan doesn't land back on an identical crop — 'loop' mode falls
    // back to yoyo, same reasoning as 'prism'.
    return {
      background: buildPixelSvg(effect),
      backgroundSize: '112% 112%',
      animate: { prop: 'backgroundPositionX', from: '0%', to: '8%' },
      loopSafe: false,
    };
  }
  if (style === 'liquidDiffuse') {
    // A cluster of soft overlapping blobs (same N-color ramp every multi-
    // color style here shares) that continuously blur in and out — an
    // "ink spreading in water" read. The motion IS the blur amount itself
    // (CSS `filter: blur()`, GSAP interpolates the px value smoothly),
    // not a position pan — no backgroundSize/oversizing needed at all.
    // 2px and 26px are different states (no amount of blur closes that
    // gap seamlessly), so this falls back to yoyo under 'loop' mode —
    // which is also just the RIGHT motion for a breathing diffuse effect
    // regardless, not really a loss.
    const stops = resolveColorStops(effect);
    const positions: [number, number][] = [[25, 30], [75, 25], [30, 75], [75, 75]];
    const blobs = stops.slice(0, 4).map((s, i) => {
      const [px, py] = positions[i % positions.length];
      return `radial-gradient(circle at ${px}% ${py}%, ${hexToRgba(s.hex, 70)}, transparent 60%)`;
    });
    return {
      background: blobs.join(', '),
      animate: { prop: 'filter', from: 'blur(2px)', to: 'blur(26px)' },
      loopSafe: false,
    };
  }
  // 'gradientShift' (default) — a REPEATING two-color diagonal gradient
  // (color → color2 → color, one exact 300px period) rather than the old
  // single non-repeating gradient panned across an oversized box — that
  // approach never actually completed one period within its own pan range,
  // so a hard 'loop' restart would have visibly jumped; this always closes.
  {
    const period = 300;
    return {
      background: `repeating-linear-gradient(${angle}deg, ${color} 0px, ${color2} ${period / 2}px, ${color} ${period}px)`,
      animate: { prop: 'backgroundPositionX', from: '0px', to: `${period}px` },
      loopSafe: true,
    };
  }
}

// ── Light Sweep overlay ─────────────────────────────────────────────────
// An AE-style shine/flare band that sweeps across the element — see the
// CgEffect doc comment in types/canvas.ts for why this lives outside the
// `filter` composition above. The actual sweep MOTION is a shared GSAP loop
// (lib/useLightSweep.ts, one hook call each from CgTemplateWidget.tsx's real
// output and CgTemplateDesigner.tsx's own preview, same relationship every
// other per-kind hook in this app already has); this just computes the
// static geometry/CSS both renderers build their (identical, duplicated —
// same convention as ticker/statbar) JSX from.

export interface LightSweepGeometry {
  /** Side length of the square band-carrying box, in px — oversized (the
   *  element's own diagonal × 1.5) so that after ANY rotation angle it still
   *  fully covers the element's own w×h box with room to spare at both
   *  sweep extremes, rather than clipping a corner at some angles. */
  boxSize: number;
  /** Where that box sits so it's centered over the element, in px, relative
   *  to the element's own top-left. */
  left: number;
  top: number;
  /** A left-to-right (0deg-in-gradient-space) band gradient — the outer box
   *  is what actually rotates it to the effect's own `angle`, so this string
   *  never needs the angle baked in. */
  gradient: string;
  /** One-way sweep distance, in px — useLightSweep animates the inner
   *  band's own `x` from -distance to +distance, which (since distance ===
   *  boxSize) guarantees the bright band fully enters from one side, crosses
   *  the whole visible box, and fully exits the other, at every angle. */
  distance: number;
}

/** Finds the first enabled lightSweep effect in a stack, if any — effects
 *  are visually stackABLE in general, but a second simultaneous sweep band
 *  reads as visual noise rather than a compounding look, so only the first
 *  one enabled actually renders (same "just take the first" simplicity
 *  bindings elsewhere in this app already default to). */
export function findLightSweep(effects: CgEffect[] | undefined): CgEffect | undefined {
  return effects?.find((e) => e.type === 'lightSweep' && e.enabled);
}

export function buildLightSweepGeometry(effect: CgEffect, w: number, h: number): LightSweepGeometry {
  const boxSize = Math.max(1, Math.sqrt(w * w + h * h) * 1.5);
  const bandWidth = Math.max(1, Math.min(100, effect.bandWidth ?? 25));
  const half = bandWidth / 2;
  const rgba = hexToRgba(effect.color ?? '#ffffff', effect.opacity ?? 70);
  return {
    boxSize,
    left: (w - boxSize) / 2,
    top: (h - boxSize) / 2,
    gradient: `linear-gradient(90deg, transparent 0%, transparent ${50 - half}%, ${rgba} 50%, transparent ${50 + half}%, transparent 100%)`,
    distance: boxSize,
  };
}

// ── Stroke (kind-agnostic, gapped, optionally-animated ring) ────────────
// A second, independent outline on top of whatever plain flush
// `config.stroke`/`config.strokeWidth` a 'text'/'shape'/'rect' element
// already has — see the CgEffect doc comment on `strokeGap` for the full
// reasoning. Rendered as a real SVG <rect> (every kind except 'shape') or a
// scaled copy of the shape's own <path> ('shape' only, so a hand-drawn Pen
// shape or a library shape both get a ring that follows their actual
// silhouette, not just its bounding box) — a sibling inside the SAME
// filter-bearing wrapper div CgTemplateWidget.tsx/CgTemplateDesigner.tsx
// already give any element with a non-empty effects stack, so a dropShadow/
// glow effect elsewhere in that same stack wraps around this ring for free,
// gap included. The marching-ants MOTION itself is a shared GSAP loop (see
// lib/useRunningStroke.ts), same "one hook, called identically from both
// renderers" relationship lightSweep's own motion hook already has.

export interface StrokeGeometry {
  /** Size of the oversized SVG canvas this ring renders inside, in px — the
   *  element's own w×h expanded on every side by its outset gap PLUS a full
   *  stroke width of extra headroom, so the ring (drawn on a centerline
   *  `strokeGap + strokeWidth/2` outside the element's own edge) never gets
   *  clipped by its own stroke's outer half. */
  boxW: number;
  boxH: number;
  /** Where that oversized canvas sits, in px relative to the element's own
   *  top-left (negative — it extends past the element on every side). */
  left: number;
  top: number;
  /** This canvas's own SVG viewBox — draw `rect`/`d` directly in these
   *  coordinates, no further translation needed. */
  viewBox: string;
  /** 'shape' elements only — that shape's own path data, unmodified (see
   *  `groupTransform` for how it actually gets scaled outward). */
  d?: string;
  /** 'shape' elements only — scales that shape's own path outward from its
   *  own bounding-box center so it grows by roughly `strokeGap` px on every
   *  side. An approximation (a true geometric path OFFSET would need a
   *  polygon-offsetting library this app doesn't have) — reads correctly
   *  for the built-in shape library's own rects/circles/stars/arrows and
   *  for a typical hand-drawn Pen shape, which is what this is actually
   *  for; a shape with very uneven/concave geometry may show the ring
   *  slightly nearer one side than another rather than a mathematically
   *  uniform offset. */
  groupTransform?: string;
  /** Every other kind — a rounded rect centered on the ring's own
   *  centerline (already accounts for `strokeWidth` so the drawn stroke's
   *  near edge sits exactly `strokeGap` px outside the element). */
  rect?: { x: number; y: number; width: number; height: number; rx: number };
}

/** Effects are visually stackable in general, but two independent running
 *  rings would just read as visual noise — same "take the first enabled
 *  one" simplicity findLightSweep above already settled on. */
export function findStroke(effects: CgEffect[] | undefined): CgEffect | undefined {
  return effects?.find((e) => e.type === 'stroke' && e.enabled);
}

export function buildStrokeGeometry(
  effect: CgEffect,
  w: number,
  h: number,
  isShapeKind: boolean,
  shapeD?: string,
  shapeViewBox?: string,
  borderRadius?: number,
): StrokeGeometry {
  const gap = Math.max(0, effect.strokeGap ?? 8);
  const strokeW = Math.max(0.5, effect.strokeWidth ?? 3);
  const pad = gap + strokeW; // gap + strokeW/2 to the ring's own centerline, + another strokeW/2 of headroom for the drawn stroke's own outer half
  const boxW = w + pad * 2;
  const boxH = h + pad * 2;

  if (isShapeKind && shapeD) {
    const parts = (shapeViewBox ?? `0 0 ${w} ${h}`).split(/\s+/).map(Number);
    const [vx, vy, vw, vh] = parts.length === 4 ? parts : [0, 0, w, h];
    const cx = vx + vw / 2;
    const cy = vy + vh / 2;
    const scale = 1 + (gap * 2) / Math.max(vw, vh, 1);
    return {
      boxW, boxH, left: -pad, top: -pad,
      viewBox: `${vx - pad} ${vy - pad} ${vw + pad * 2} ${vh + pad * 2}`,
      d: shapeD,
      groupTransform: `translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})`,
    };
  }

  return {
    boxW, boxH, left: -pad, top: -pad,
    viewBox: `0 0 ${boxW} ${boxH}`,
    rect: {
      x: strokeW / 2,
      y: strokeW / 2,
      width: Math.max(0, w + gap * 2 + strokeW),
      height: Math.max(0, h + gap * 2 + strokeW),
      rx: Math.max(0, (borderRadius ?? 0) + gap),
    },
  };
}

/** SVG `stroke-dasharray` for one of the three dash presets, computed as a
 *  proportion of the ring's own real perimeter (only known at render time,
 *  via the live `<path>`/`<rect>` node's own `getTotalLength()` — see
 *  lib/useRunningStroke.ts) rather than fixed pixel lengths, so the dash
 *  pattern scales sensibly whether this ring is tiny or huge. `undefined`
 *  for 'solid' — no dasharray at all, a plain continuous ring. */
export function buildStrokeDashArray(effect: CgEffect, perimeter: number): string | undefined {
  const style = effect.dashStyle ?? 'dashed';
  if (style === 'solid' || perimeter <= 0) return undefined;
  if (style === 'dotted') {
    const dot = Math.max(1, effect.strokeWidth ?? 3);
    return `0.1 ${dot * 2.2}`; // near-zero dash + round linecap below = a clean round dot
  }
  const dash = Math.max(4, perimeter * 0.035);
  return `${dash} ${dash * 0.6}`;
}

/** SVG `stroke-linecap` for one of the three dash presets — round for
 *  'dotted' (a near-zero dasharray only reads as actual dots with round
 *  caps; butt caps would make it invisible), butt for 'dashed'/'solid'
 *  (crisp rectangular dash ends, the more common "marching ants" look). */
export function strokeLinecapFor(effect: CgEffect): 'round' | 'butt' {
  return (effect.dashStyle ?? 'dashed') === 'dotted' ? 'round' : 'butt';
}

/** The stroke's own glow — "stroke can add effect also": applied as a plain
 *  inline `filter` on JUST the ring's own `<path>`/`<rect>` node (not the
 *  whole element's wrapper, which would glow the base content too), same
 *  double-drop-shadow trick Glow itself uses. Empty string (no `filter` at
 *  all) when `amount`/`blurRadius` are 0 — the default for a freshly-added
 *  stroke, a plain crisp ring with no glow. */
export function buildStrokeGlowFilter(effect: CgEffect): string {
  const amount = effect.amount ?? 0;
  const blur = effect.blurRadius ?? 0;
  if (amount <= 0 || blur <= 0) return '';
  const color = hexToRgba(effect.color ?? '#ffffff', Math.min(100, amount));
  return `drop-shadow(0 0 ${blur}px ${color}) drop-shadow(0 0 ${blur}px ${color})`;
}

// ── Glass (Apple-style frosted/"Liquid Glass" material) ────────────────
// A translucent panel that blurs and saturates whatever sits BEHIND it —
// not the element's own content, which stays perfectly crisp on top — the
// classic macOS/iOS "frosted glass" look (Control Center, sidebars, sheets).
// Deliberately outside the `filter` composition above for the same reason
// lightSweep is: `backdrop-filter` is its own separate CSS property with
// completely different semantics (it samples the page BEHIND the element,
// while `filter` only ever transforms the element's own rendered pixels),
// so it can never be one more term in that string.
//
// IMPORTANT limitation worth knowing (not a bug, just how backdrop-filter
// works): it can only blur what's BEHIND this element WITHIN THIS SAME
// template's own render — another element positioned behind it (e.g. a
// background image/video element earlier in z-order), or a solid Program
// Background. On a fully transparent output (the common Fill/Key/Monitor
// default), there IS nothing behind it to blur, so glass renders as a
// plain, un-blurred translucent tint instead — exactly like Apple's own
// glass UI, which likewise only blurs whatever app content actually sits
// underneath it, not whatever is beneath the whole display.

/** Finds the first enabled glass-FAMILY effect in a stack, if any — 'glass',
 *  'fractalGlass' and 'crystalGlass' all share one exact backdrop-filter/
 *  background/edge-highlight/content-mask recipe (buildGlassStyle/
 *  buildGlassEdgeStyle/buildImageGlassMask/buildTextGlassMask below are
 *  already type-agnostic, just reading shared fields), so every existing
 *  call site here (both renderers' own glass chrome) automatically gained
 *  fractalGlass/crystalGlass support the moment this predicate widened —
 *  no other change needed for the shared base look. Same "only the first
 *  one" simplicity findLightSweep above
 *  already uses (a second simultaneous glass-family panel on the same
 *  element doesn't compose into anything meaningfully different from just
 *  a stronger single one). */
export function findGlass(effects: CgEffect[] | undefined): CgEffect | undefined {
  return effects?.find((e) => (e.type === 'glass' || e.type === 'fractalGlass' || e.type === 'crystalGlass' || e.type === 'liquidGlass') && e.enabled);
}

/** Finds the first enabled liquidGlass effect specifically — used only to
 *  know whether THIS element also needs its own extra chromatic-aberration
 *  `<filter>` def (see buildLiquidGlassFilterProps/buildLiquidGlassMapSvg
 *  above); the shared glass chrome itself still goes through findGlass
 *  above. */
export function findLiquidGlass(effects: CgEffect[] | undefined): CgEffect | undefined {
  return effects?.find((e) => e.type === 'liquidGlass' && e.enabled);
}

export interface GlassStyle {
  backdropFilter: string;
  background: string;
  boxShadow: string;
}

/** The "glassmorphism" CSS recipe: blur + saturate the backdrop, wash a
 *  translucent DIAGONAL tint over it (not flat — a gradient reads as a
 *  physical pane catching light unevenly, the way a flat tint never does),
 *  and a drop shadow to sell the sense of a pane sitting slightly above the
 *  surface behind it. The gradient's own direction is `angle` (same field
 *  lightSweep's own band direction already uses, and the same convention —
 *  0 = bottom-to-top, 90 = left-to-right, clockwise), also reused by
 *  buildGlassEdgeStyle below so the tint and the edge highlight always
 *  agree on which corner the "light" is coming from. */
// Confirmed (a plain two-<div> reproduction with zero app code involved,
// tested directly in real engine builds — see the PR/commit this comment
// shipped with for the actual before/after screenshots) that real Safari/
// WebKit simply doesn't apply `backdrop-filter` at all in some builds —
// the property is RECOGNIZED (CSS.supports reports true, so an
// @supports-based fallback can't detect this — it only ever checks syntax,
// not "does it actually render") but visually inert: the panel's own tint/
// shadow still show, but whatever's behind it stays perfectly sharp,
// completely unblurred. Chromium (and Chromium-based vMix/OBS Browser
// Sources) render it correctly. There's no reliable in-page JS way to
// probe "did backdrop-filter actually composite" (no API reads back a
// live element's rendered pixels short of a full screen-capture
// permission prompt), so this falls back to engine sniffing — Safari
// specifically, and ONLY when this page is genuinely running inside it,
// not Tauri's own WKWebView (which reports as "Safari" in its own user
// agent too, but isn't affected — the Designer/in-app Preview/Program
// boxes all run there and blur correctly). When true, boosts the tint's
// own opacity so text behind a glass panel is at least PARTIALLY obscured
// by a stronger wash instead of fully exposed, sharp, through a blur that
// silently isn't happening.
function isKnownBackdropFilterBrokenEngine(): boolean {
  if (typeof navigator === 'undefined') return false;
  if ('__TAURI_INTERNALS__' in window) return false;
  const ua = navigator.userAgent;
  return /Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg/.test(ua);
}

/** `backdropFilterExtra` — liquidGlass only: a `url(#...)` reference to
 *  this element's own chromatic-aberration `<filter>` (see
 *  buildLiquidGlassFilterProps/buildLiquidGlassMapSvg above and the two
 *  renderers' own per-element `<filter>` def), appended as an EXTRA
 *  backdrop-filter term after blur/saturate — backdrop-filter accepts the
 *  same `<filter-value-list>` `filter` does, url() references included.
 *  Omitted for 'glass'/'fractalGlass'/'crystalGlass', which have no
 *  refraction of their own. */
export function buildGlassStyle(effect: CgEffect, backdropFilterExtra?: string): GlassStyle {
  const blur = Math.max(0, effect.blurRadius ?? 20);
  const saturateAmt = Math.max(100, effect.amount ?? 180);
  const angle = effect.angle ?? 135;
  let opacity = effect.opacity ?? 18;
  if (isKnownBackdropFilterBrokenEngine()) opacity = Math.min(100, Math.max(opacity, 55));
  const tint = effect.color ?? '#ffffff';
  return {
    backdropFilter: [`blur(${blur}px)`, `saturate(${saturateAmt}%)`, backdropFilterExtra].filter(Boolean).join(' '),
    background: `linear-gradient(${angle}deg, ${hexToRgba(tint, opacity)}, ${hexToRgba(tint, opacity / 2)})`,
    boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
  };
}

export interface GlassEdgeStyle {
  /** mask-image value for the bright "light is hitting this corner" border
   *  overlay — opaque (visible) toward `angle`'s own direction, fading to
   *  transparent (invisible) by the midpoint. */
  highlightMask: string;
  /** mask-image value for the OPPOSITE, tint-colored border overlay — the
   *  exact inverse gradient of highlightMask, so together they cover the
   *  whole edge with no gap or overlap, one glowing white, the other a
   *  faint wash of the glass's own tint color — a real (if subtle) sense of
   *  directional light the single flat border this used to be never had. */
  shadowMask: string;
  shadowColor: string;
}

/** Two-tone edge highlight — styled after real glass/"Liquid Glass" specular
 *  edges: a bright rim where the (implied) light source catches the pane's
 *  edge, and a faint colored rim on the opposite side, rather than one flat
 *  border all the way around. Rendered as two actual overlay elements (see
 *  CgTemplateWidget.tsx's/CgTemplateDesigner.tsx's own glass JSX) — CSS
 *  mask-image can't be expressed as part of a plain `border` shorthand, so
 *  this can't just be one more property folded into buildGlassStyle's own
 *  object the way a flat border could. */
export function buildGlassEdgeStyle(effect: CgEffect): GlassEdgeStyle {
  const angle = effect.angle ?? 135;
  return {
    highlightMask: `linear-gradient(${angle}deg, #fff, transparent 50%)`,
    shadowMask: `linear-gradient(${angle}deg, transparent 50%, #fff)`,
    shadowColor: effect.color ?? '#ffffff',
  };
}

// ── Fractal Glass texture (a static grain overlay, not a live backdrop
// warp) ──────────────────────────────────────────────────────────────────
// An earlier version of this warped the actual BACKDROP via a live
// <feTurbulence>/<feDisplacementMap> SVG filter appended as an extra
// backdrop-filter term (`blur(...) saturate(...) url(#...)`). That relies
// on backdrop-filter accepting an SVG filter reference inside its own
// value list — a rare enough combination that WebKit (the actual engine
// Tauri's Designer/Preview run in, NOT Chromium, despite this app's other
// backdrop-filter usage working fine there — see
// isKnownBackdropFilterBrokenEngine's own doc comment on that same "reports
// as Safari but isn't the broken one" WKWebView) apparently either drops
// the url() term silently or invalidates the WHOLE backdrop-filter
// declaration once it's present, per CSS's own "one invalid component
// invalidates the whole value" parsing rule. A follow-up rewrite replaced
// that with a static SVG-noise grain rasterized into a `background-image`
// (still texture-reactive, but not what "fractal glass" actually turned out
// to mean — see below) — abandoned in turn once the user pointed at the
// actual reference (a CodePen titled "Fractal glass effect",
// https://codepen.io/galayder/pen/NWmZOGb). That pen has NO noise/turbulence
// at all: it's a `repeating-linear-gradient` ridge/fluting pattern painted
// on the SAME element as `backdrop-filter: blur(...)`, with
// `mix-blend-mode: color-dodge` on top — color-dodge blows out the ridges
// wherever a bright/colorful blurred shape sits behind them, and the
// resulting uneven, prismatic blow-out is what actually reads as
// "fractal"-looking, not literal fractal math. This is that recipe, ported:
// buildGlassStyle's own blur/saturate/tint stay exactly as they were (the
// pen's own panel uses backdrop-filter blur too); buildFractalGlassRidgeStyle
// below replaces the FLAT tint gradient with the ridge pattern +
// mix-blend-mode, and adds the pen's own `::after` highlight layer as a
// second overlay div. Pure CSS gradients/blend-modes throughout — no SVG
// filter, no data-URI raster, so none of the backdrop-filter+url() or
// engine-support risk either earlier attempt carried.

/** A curated spread of named blend-mode/contrast combinations — each ridge
 *  pattern is identical in SHAPE (a repeating-linear-gradient light/dark/
 *  light band, `stripeAlpha` just scaling how strong each band reads), so
 *  the actual visual variety comes entirely from `blendMode`, the one
 *  ingredient that changes how dramatically the pattern reacts to whatever
 *  color/light sits behind the panel — the same reason the reference pen's
 *  own look depends on `color-dodge` specifically, not the gradient values
 *  themselves. 'prism' matches the reference pen's own numbers exactly
 *  (0.10/0.38/0.27, color-dodge); the rest vary the blend mode for a
 *  genuinely different character each (aurora's plus-lighter glows soft and
 *  additive, hologram's difference inverts into a lurid negative-image
 *  look, frost's overlay stays gentle, etc.) rather than being subtle
 *  variations on one look the way differently-tuned noise presets were. */
export interface FractalGlassStylePreset {
  key: string;
  label: string;
  blendMode: 'color-dodge' | 'plus-lighter' | 'difference' | 'overlay' | 'screen' | 'soft-light' | 'hard-light' | 'exclusion';
  stripeAlpha: [number, number, number];
}

export const FRACTAL_GLASS_STYLES: FractalGlassStylePreset[] = [
  { key: 'prism', label: 'Prism', blendMode: 'color-dodge', stripeAlpha: [0.10, 0.38, 0.27] },
  { key: 'aurora', label: 'Aurora', blendMode: 'plus-lighter', stripeAlpha: [0.08, 0.30, 0.22] },
  { key: 'hologram', label: 'Hologram', blendMode: 'difference', stripeAlpha: [0.15, 0.45, 0.30] },
  { key: 'softFrost', label: 'Soft Frost', blendMode: 'overlay', stripeAlpha: [0.06, 0.20, 0.14] },
  { key: 'mirrorShard', label: 'Mirror Shard', blendMode: 'screen', stripeAlpha: [0.12, 0.40, 0.28] },
  { key: 'velvetGlow', label: 'Velvet Glow', blendMode: 'soft-light', stripeAlpha: [0.10, 0.34, 0.24] },
  { key: 'chromeEdge', label: 'Chrome Edge', blendMode: 'hard-light', stripeAlpha: [0.14, 0.42, 0.30] },
  { key: 'neonExclusion', label: 'Neon Exclusion', blendMode: 'exclusion', stripeAlpha: [0.12, 0.36, 0.26] },
];

export function findFractalGlassStyle(key: string | undefined): FractalGlassStylePreset {
  return FRACTAL_GLASS_STYLES.find((s) => s.key === key) ?? FRACTAL_GLASS_STYLES[0];
}

export interface FractalGlassRidgeStyle {
  /** Replaces buildGlassStyle's own flat tint gradient on the shared chrome
   *  div — the repeating ridge pattern, in the light band's own tint color
   *  against plain black valleys (the reference pen's own bands are plain
   *  white/black; tinting only the LIGHT band lets `color`/`opacity` stay
   *  meaningful per-effect while defaulting to an exact match of the pen
   *  when color is white, fractalGlass's own default). */
  background: string;
  mixBlendMode: FractalGlassStylePreset['blendMode'];
  /** The pen's own `::after` — a second, more-blurred pass of the same
   *  ridge pattern with no blend mode of its own (a plain semi-transparent
   *  highlight layered on TOP of the blended result below it, not part of
   *  the color-dodge/etc. math itself). Rendered as its own sibling div. */
  backgroundHighlight: string;
  /** The panel's own self-blur (`filter: blur(...)`), softening the ridge
   *  edges — the pen's own 0.5px, scaled by `amplitude` (reused as a 0-100
   *  "softness" dial; default 30 lands close to the pen's own value). */
  selfBlur: number;
  /** The highlight layer's own blur — the pen's own 2px, scaled the same way. */
  highlightBlur: number;
  /** Replaces buildGlassStyle's own drop shadow — an inward vignette
   *  instead, matching the pen's own `inset 0 0 10px #000` (a floating
   *  panel's drop shadow doesn't suit a pane whose whole look is about
   *  light bending THROUGH it, not sitting above a surface). */
  boxShadow: string;
}

export function buildFractalGlassRidgeStyle(effect: CgEffect): FractalGlassRidgeStyle {
  const style = findFractalGlassStyle(effect.texture);
  const angle = effect.angle ?? 90;
  const step = Math.max(4, effect.bandWidth ?? 32);
  const strength = Math.max(0, Math.min(100, effect.opacity ?? 100)) / 100;
  const tint = effect.color ?? '#ffffff';
  const [a1, a2, a3] = style.stripeAlpha.map((a) => a * strength);
  const softness = Math.max(0, Math.min(100, effect.amplitude ?? 30)) / 100;
  return {
    background: `repeating-linear-gradient(${angle}deg, ${hexToRgba(tint, a1 * 100)}, rgba(0,0,0,${a2}), ${hexToRgba(tint, a3 * 100)} ${step}px)`,
    mixBlendMode: style.blendMode,
    // A subtler pass of the same pattern — the pen's own `::after`, a plain
    // highlight layered on top rather than part of the blend math above.
    backgroundHighlight: `repeating-linear-gradient(${angle}deg, ${hexToRgba(tint, a1 * 100)}, rgba(0,0,0,${a2}), ${hexToRgba(tint, a1 * 100)} ${step}px)`,
    selfBlur: softness * 2,
    highlightBlur: 1 + softness * 5,
    boxShadow: 'inset 0 0 10px rgba(0,0,0,0.45)',
  };
}

// ── Crystal Glass facets (cut-glass/prism overlay) ──────────────────────
// See CgEffect's own doc comment for the overall recipe — a crisp geometric
// counterpart to fractalGlass's organic warp, built entirely from two
// overlapping repeating-linear-gradient hairline grids (no SVG filter
// needed, unlike fractalGlass) rather than a single flat tint, so light
// reads as catching individual cut facets rather than one uniform pane.

export interface CrystalFacetStyle {
  backgroundImage: string;
  backgroundSize: string;
  mixBlendMode: 'overlay';
}

export function buildCrystalFacetStyle(effect: CgEffect): CrystalFacetStyle {
  const cell = Math.max(8, effect.bandWidth ?? 36);
  const angle = effect.angle ?? 135;
  const a1 = angle + 30;
  const a2 = angle - 30;
  return {
    backgroundImage: [
      `repeating-linear-gradient(${a1}deg, rgba(255,255,255,0.4) 0px, rgba(255,255,255,0.4) 1px, transparent 1px, transparent ${cell}px)`,
      `repeating-linear-gradient(${a2}deg, rgba(0,0,0,0.22) 0px, rgba(0,0,0,0.22) 1px, transparent 1px, transparent ${cell}px)`,
    ].join(', '),
    backgroundSize: `${cell}px ${cell}px`,
    mixBlendMode: 'overlay',
  };
}

// ── Ramp Mask (gradient-driven spatial fade) ────────────────────────────
// See CgEffect's own doc comment on `rampMask` for the overall idea: point
// a gradient across the element so the glass/blur effect builds up toward
// one side and fades to nothing by the other, instead of applying at one
// uniform strength everywhere.

/** The glass-family's own version — a plain `mask-image` gradient applied
 *  to the chrome panel (see both renderers' own glass JSX), combined with
 *  any content-shape mask (buildImageGlassMask/buildTextGlassMask) via
 *  `mask-composite: intersect` when both are present — see
 *  combineGlassMasks below for that combination. `undefined` when this
 *  effect doesn't have ramp masking on, so callers can skip touching
 *  mask-image at all (same "absent means untouched" convention every
 *  other optional style piece in this file already has). */
export function buildRampMaskImage(effect: CgEffect): string | undefined {
  if (!effect.rampMask) return undefined;
  const angle = effect.angle ?? 135;
  return `linear-gradient(${angle}deg, transparent 0%, #000 100%)`;
}

export interface CombinedMaskStyle {
  maskImage: string;
  maskSize: string;
  maskPosition: string;
  maskRepeat: string;
  maskComposite?: 'intersect';
}

/** Merges glass's own content-shape mask (image alpha / text glyphs, either
 *  or neither) with its ramp mask (gradient fade, either or neither) into
 *  ONE set of mask-* properties — CSS masks stack as a comma-separated
 *  layer list, each layer needing its own size/position/repeat entry at
 *  the same index, so this is the one place that has to know both shapes
 *  at once rather than each caller re-deriving the combination. Returns
 *  `null` when neither is present (nothing to mask at all — the chrome
 *  should stay a plain, unmasked rectangle, its existing default). */
export function combineGlassMasks(contentMask: GlassMaskStyle | null, rampMaskImage: string | undefined): CombinedMaskStyle | null {
  if (contentMask && rampMaskImage) {
    return {
      maskImage: `${contentMask.maskImage}, ${rampMaskImage}`,
      maskSize: `${contentMask.maskSize}, 100% 100%`,
      maskPosition: `${contentMask.maskPosition}, center`,
      maskRepeat: `${contentMask.maskRepeat}, no-repeat`,
      maskComposite: 'intersect',
    };
  }
  if (contentMask) return { maskImage: contentMask.maskImage, maskSize: contentMask.maskSize, maskPosition: contentMask.maskPosition, maskRepeat: contentMask.maskRepeat };
  if (rampMaskImage) return { maskImage: rampMaskImage, maskSize: '100% 100%', maskPosition: 'center', maskRepeat: 'no-repeat' };
  return null;
}

/** Finds the first enabled PLAIN 'blur' effect that also has ramp masking
 *  on — a ramp-masked blur needs its own per-element SVG `<filter>` def
 *  (see buildRampBlurFilterProps + buildRampMaskSvg below), unlike a plain
 *  uniform blur which stays just a `blur(px)` CSS function term (see
 *  buildFilterString's own 'blur' case, which skips emitting that term
 *  whenever THIS returns a match, to avoid double-blurring).
 *
 *  Worth knowing (same spirit as isKnownBackdropFilterBrokenEngine's own
 *  doc comment on glass/Safari): this relies on `<feImage>` referencing a
 *  data-URI SVG as a `<filter>` primitive's input, a considerably less
 *  battle-tested corner of the SVG filter spec than the feTurbulence/
 *  feDiffuseLighting/feComponentTransfer primitives flagWave/bevel/
 *  innerShadow above already ship with — some WebKit builds render feImage
 *  data-URI sources unreliably (or not at all). The real broadcast OUTPUT
 *  (vMix/OBS's own Chromium/CEF Browser Source) renders it correctly; a
 *  gap here would only ever affect the Designer's own live preview. */
export function findRampBlur(effects: CgEffect[] | undefined): CgEffect | undefined {
  return effects?.find((e) => e.type === 'blur' && e.enabled && e.rampMask);
}

export interface RampBlurFilterProps {
  blur: number;
  angle: number;
}

export function buildRampBlurFilterProps(effect: CgEffect): RampBlurFilterProps {
  return { blur: Math.max(0, effect.blurRadius ?? 4), angle: effect.angle ?? 135 };
}

/** A tiny inline SVG — a single rect filled with a black-to-white linear
 *  gradient at `angle` — used as an <feImage> source inside the ramp-blur
 *  `<filter>` def (see both renderers' own JSX): feImage rasterizes this at
 *  the element's OWN pixel size (`w`/`h`, matching <feImage>'s default
 *  `primitiveUnits="userSpaceOnUse"`, i.e. the same local px coordinate
 *  system feOffset's dx/dy already use elsewhere in this file), so the
 *  gradient it produces lines up 1:1 with the element's real box regardless
 *  of that element's own size — the same reason buildTextGlassMask below
 *  takes `w`/`h` too instead of a fixed viewBox. White = keep the blurred
 *  copy (feComposite operator="in" below), black = let the sharp original
 *  show through instead. */
export function buildRampMaskSvg(w: number, h: number, angle: number): string {
  const gw = Math.max(1, w), gh = Math.max(1, h);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${gw}" height="${gh}"><defs><linearGradient id="g" gradientTransform="rotate(${angle} 0.5 0.5)"><stop offset="0%" stop-color="#000"/><stop offset="100%" stop-color="#fff"/></linearGradient></defs><rect width="${gw}" height="${gh}" fill="url(#g)"/></svg>`;
}

// ── Glass content masking (text/image) ──────────────────────────────────
// Without this, glass on a 'text' or 'image' element blurs/tints its whole
// RECTANGULAR box — most of which is empty space around the actual glyphs
// or a transparent PNG's actual opaque pixels — instead of hugging the
// content the way every OTHER effect already does for free (a plain CSS
// `filter` naturally follows an element's own real alpha/rendered pixels,
// since it operates on the bitmap itself; glass's `backdrop-filter`/
// `background` don't — they paint the WHOLE box regardless of what's
// actually opaque inside it). These two masks make glass follow the real
// content shape instead, applied via CSS `mask-image` to glass's own
// wrapper (see the two renderers' own 'glass chrome' div) — masking a
// backdrop-filtered/background-painted element clips its WHOLE composited
// result, so this correctly clips the blur+tint+edge-highlight together as
// one unit, not just the flat color.

export interface GlassMaskStyle {
  maskImage: string;
  maskSize: string;
  maskPosition: string;
  maskRepeat: string;
}

/** 'image' elements — masks to the image's own real ALPHA channel (a raster
 *  image source defaults CSS mask-image to alpha-based, not luminance —
 *  exactly what a transparent PNG/SVG logo needs), sized/positioned to
 *  match its own `objectFit` so the mask lines up with the real <img>
 *  pixel-for-pixel. `resolvedUrl` is the caller's own already-resolved src
 *  (see lib/imageUrl.ts's resolveImageUrl) — this file stays free of that
 *  Tauri/remote-host rewriting concern, same reasoning as every other
 *  renderer-shared helper here taking pre-resolved values. */
export function buildImageGlassMask(resolvedUrl: string, objectFit: string | undefined): GlassMaskStyle {
  return {
    maskImage: `url("${resolvedUrl}")`,
    maskSize: objectFit === 'cover' ? 'cover' : objectFit === 'fill' ? '100% 100%' : 'contain',
    maskPosition: 'center',
    maskRepeat: 'no-repeat',
  };
}

/** 'text' elements — masks to (an approximation of) the real glyph shapes,
 *  by rendering the same text as an SVG `<text>` on an otherwise EMPTY
 *  (not just black-filled) canvas and using it as an alpha mask — a plain
 *  `mask-image: url(...)` masks by ALPHA for an image source (SVG included
 *  — it's rasterized like any other image URL here, not referenced as an
 *  SVG `<mask>` element), the same rule buildImageGlassMask's own real PNG
 *  alpha channel already relies on. A solid-colored background rect behind
 *  the text (an earlier, wrong attempt at this) is uniformly OPAQUE same as
 *  the text itself, so alpha masking would see no difference between them
 *  at all and mask nothing — visible color/luminance is irrelevant to an
 *  alpha mask; only leaving the canvas genuinely transparent outside the
 *  glyphs makes them the only opaque, and so the only visible, area.
 *
 *  Best-effort, not pixel-perfect: SVG text metrics can differ slightly
 *  from the HTML text it's masking (different layout engine), and — unlike
 *  the real text, which can wrap via `wordWrap` — this only ever lays text
 *  out on as many lines as the string has explicit '\n's; a long
 *  single-line string that visually wraps in the real element masks a
 *  WIDER area than the wrapped glyphs actually occupy. Deliberately the
 *  safe direction to be approximate in: at worst some empty space next to
 *  the text also gets the glass look, never a glyph losing it.
 *
 *  Font handling — the actual reason this only ever runs for the PLAIN
 *  DEFAULT font (see the `fontFamily` check at every call site, not
 *  anything in this function itself): a `data:image/svg+xml` used as a
 *  `mask-image` is fetched as its own separate, isolated resource — it has
 *  no access to `document.fonts` and doesn't inherit whatever Google Font
 *  <link> the real text's own page already loaded (see cgFonts.ts's
 *  ensureGoogleFontLoaded), even though that same font file is sitting
 *  right there in the browser cache. An `@import` of that font's own
 *  stylesheet embedded directly in this SVG's `<style>` was tried and
 *  measurably does NOT fix it: the browser genuinely re-fetches that font
 *  (confirmed — a real, separate network request for it fires) but the
 *  already-rasterized mask image never repaints once it arrives, even
 *  seconds later — CSS mask-image values apparently don't carry the same
 *  "redraw once a referenced external resource finishes loading" behavior
 *  a normal `<img>` gets. Rather than risk shipping a mask that's
 *  confidently, visibly WRONG for any custom font (a duplicate-looking
 *  glyph silhouette floating in the wrong place — worse than no masking at
 *  all), callers only ask for this when `fontFamily` is unset, where the
 *  mask's own 'sans-serif' fallback and the real text's inherited default
 *  (this app's own body font stack, also a sans-serif) are at least in the
 *  same family and stay close enough to read as intentional. A text
 *  element using one of this app's own Google Fonts instead gets glass as
 *  a plain full-box card behind it (glassMask simply isn't built at all
 *  for it) — the same look glass already has on any non-text element,
 *  correct and predictable rather than subtly broken. */
/** The actual glyph layout math, factored out so buildLiquidGlassMapSvg
 *  below can rasterize the EXACT same glyph shapes this mask does — the two
 *  need to agree precisely, since the mask clips to this shape and the
 *  liquid refraction map (when that effect is active) needs to warp along
 *  the SAME edges, not a slightly different approximation of them. Returns
 *  just the joined `<text>` elements, not a wrapping `<svg>` — each caller
 *  wraps it in its own outer document, since they need different root
 *  attributes (a plain mask here, a blurred `<g filter=...>` there). */
function buildTextSvgMarkup(text: string, w: number, h: number, opts: { fontFamily?: string; fontSize: number; bold?: boolean; align?: string; valign?: string }): string {
  const lines = (text || '').split('\n');
  const fontSize = Math.max(1, opts.fontSize);
  const lineHeight = fontSize * 1.25;
  const totalH = lines.length * lineHeight;
  const valign = opts.valign ?? 'middle';
  const blockTop = valign === 'top' ? 0 : valign === 'bottom' ? h - totalH : (h - totalH) / 2;
  // Text baseline sits below a line's own top by roughly this fraction of
  // the font size for most fonts — a plain heuristic (no real font metrics
  // available here), close enough for this mask's own approximate purpose.
  const firstBaselineY = blockTop + fontSize * 0.9;
  const align = opts.align ?? 'center';
  const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
  const x = align === 'left' ? 0 : align === 'right' ? w : w / 2;
  const fam = (opts.fontFamily || 'sans-serif').replace(/"/g, '');
  return lines.map((line, i) =>
    `<text x="${x}" y="${firstBaselineY + i * lineHeight}" font-family="${fam}, sans-serif" font-size="${fontSize}" font-weight="${opts.bold ? 700 : 400}" text-anchor="${anchor}" fill="#fff">${escapeXmlText(line)}</text>`
  ).join('');
}

export function buildTextGlassMask(text: string, w: number, h: number, opts: { fontFamily?: string; fontSize: number; bold?: boolean; align?: string; valign?: string }): GlassMaskStyle {
  const textEls = buildTextSvgMarkup(text, w, h, opts);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(1, w)}" height="${Math.max(1, h)}">${textEls}</svg>`;
  return {
    maskImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
    maskSize: '100% 100%',
    maskPosition: 'center',
    maskRepeat: 'no-repeat',
  };
}

// ── Liquid Glass (text-only chromatic-aberration refraction) ────────────
// Ported from a reference CodePen ("Liquid Glass Clock",
// https://codepen.io/alexandrevacassin/pen/YPqqqwr): each glyph is its own
// backdrop-filter panel whose referenced <filter> runs the backdrop through
// a per-channel <feDisplacementMap> — an R/G/B split, each channel's own
// copy displaced independently along the SAME map — faking the way a real
// glass lens bends different wavelengths of light by very slightly
// different amounts. That per-channel offset (recombined afterward via
// feComposite) IS the "chromatic aberration" that reads as genuine liquid
// glass rather than a flat blur.
//
// The pen's own filters each reference a hand-authored bitmap "height map"
// baked from that EXACT glyph's own shape (a different base64 PNG per
// digit 0-9). That's only possible there because a clock only ever shows
// ten distinct glyphs, each hand-prepared in advance — backdrop-filter's
// referenced <filter> only ever receives the BACKDROP pixels as
// SourceGraphic; it has no access to the masking element's own alpha/shape
// (the `mask`/`mask-image` property is applied separately, AFTER this
// filter already ran), so there's no way to derive "where this glyph's
// edges are" from inside the filter itself. This app can't hand-author a
// bitmap per every possible glyph across every font/size/string an
// operator might type, so buildLiquidGlassMapSvg below builds the
// equivalent map DYNAMICALLY instead: the same <text> markup
// buildTextGlassMask above already rasterizes for its own alpha mask, this
// time pre-blurred (baked into the SAME one-shot data-URI raster, the same
// "run a filter once inside a static image" trick buildRampMaskSvg already
// relies on) so feDisplacementMap has smooth gradients at the glyph edges
// to displace along, instead of hard, jagged discontinuities. Text-only,
// and only when `fontFamily` is unset — same reasoning, and the same
// limitation, as buildTextGlassMask's own doc comment above: there's no
// equivalent glyph shape to derive a map from for a rect/image/shape
// element, or for a custom font this mask/map machinery can't see loaded.
// On anything that doesn't qualify, this effect simply falls back to the
// plain shared glass chrome (blur/saturate/tint), no refraction — never an
// error, just a quieter look, same as glass on a non-text element already
// behaves today.

/** `blurPx` is baked into this SAME one-shot raster (see this section's own
 *  doc comment) — a `<feGaussianBlur>` runs ONCE here, softening the
 *  glyph's hard vector edges into a smooth gradient before
 *  feDisplacementMap ever sees it. An un-blurred glyph edge would displace
 *  as a hard, aliased jump instead of the smooth "light bending near an
 *  edge" look the reference pen's own hand-authored maps have. */
export function buildLiquidGlassMapSvg(text: string, w: number, h: number, opts: { fontFamily?: string; fontSize: number; bold?: boolean; align?: string; valign?: string }, blurPx: number): string {
  const textEls = buildTextSvgMarkup(text, w, h, opts);
  const gw = Math.max(1, w), gh = Math.max(1, h);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${gw}" height="${gh}"><filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${blurPx}"/></filter><g filter="url(#b)">${textEls}</g></svg>`;
}

export interface LiquidGlassFilterProps {
  /** feDisplacementMap's own `scale` — this filter's own `primitiveUnits`
   *  is `objectBoundingBox` (matching the reference pen exactly, needed so
   *  the SAME numbers work regardless of this element's real pixel size),
   *  so this is a fraction of the element's own box, not px. Effect's own
   *  `amplitude` (reused from flagWave's identical "how far things actually
   *  displace" meaning elsewhere in this file) divided by 100 — default 40
   *  lands on 0.4, matching the reference pen's own scale exactly. */
  scale: number;
  /** The map SVG's own feGaussianBlur stdDeviation, ALSO in
   *  objectBoundingBox-ish fractional terms (baked into that separate,
   *  independent raster — see buildLiquidGlassMapSvg above — so this is
   *  actually relative to ITS OWN pixel dimensions, not this filter's
   *  primitiveUnits). Effect's own `blurRadius` (reused from glass's usual
   *  "backdrop blur px" meaning) scaled down into that image's own small
   *  useful range. */
  mapBlur: number;
}

export function buildLiquidGlassFilterProps(effect: CgEffect): LiquidGlassFilterProps {
  return {
    scale: Math.max(0, effect.amplitude ?? 40) / 100,
    mapBlur: Math.max(0, Math.min(80, effect.blurRadius ?? 20)) / 4,
  };
}

function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Mask path scaling ───────────────────────────────────────────────────
// `clip-path: url(#id)` needs a <clipPath clipPathUnits="objectBoundingBox">
// whose path coordinates are fractions (0–1) of the TARGET element's own
// box, not the mask shape's own pixel-space `d`. This rewrites every
// x/y-pair number token by dividing by the mask shape's own w/h. Handles
// every command the pen tool ever emits (M/L/Z) plus C/Q (covers the built-
// in SHAPE_LIBRARY paths too) — an A (arc) command, only reachable via a
// hand-pasted custom path, is left unscaled: a documented best-effort limit
// rather than a silently wrong result for the two path-drawing tools this
// app actually has.
const PAIR_COMMANDS = new Set(['M', 'L', 'C', 'Q', 'T', 'S']);

export function scalePathToUnitBox(d: string, w: number, h: number): string {
  if (!w || !h) return d;
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g);
  if (!tokens) return d;

  let out = '';
  let command = '';
  let argIndexInCommand = 0;
  for (const tok of tokens) {
    if (/[a-zA-Z]/.test(tok)) {
      command = tok;
      argIndexInCommand = 0;
      out += (out ? ' ' : '') + tok;
      continue;
    }
    const isPairCommand = PAIR_COMMANDS.has(command.toUpperCase());
    const n = Number(tok);
    // A relative command's numbers are deltas rather than coordinates, but
    // scaling is linear either way — dividing by the box dimension is the
    // correct transform for both absolute positions and relative offsets.
    const scaled = isPairCommand ? n / (argIndexInCommand % 2 === 0 ? w : h) : n;
    out += ' ' + scaled;
    argIndexInCommand++;
  }
  return out.trim();
}
