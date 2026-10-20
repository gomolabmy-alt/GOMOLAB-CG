// Animation presets — ported verbatim from gfx-studio-2's shared/presets.js
// (a separate, already-working broadcast-graphics app) so behavior and any
// muscle memory from that app carry over exactly. Used by both the CG
// template designer (CgTemplateDesigner.tsx/CgTemplateTimeline.tsx) and the
// playback engine (lib/cgAnimationEngine.ts).
//
// Each PRESETS entry is a GSAP `.from()` config (the element starts at these
// values and animates TO its normal CSS state); each OUT_PRESETS entry is a
// `.to()` config (the element animates FROM its current state TO these
// values). `_type` entries are special-cased in cgAnimationEngine.ts rather
// than being plain tween configs.

export interface PresetConfig {
  [key: string]: any;
  _type?: 'typewriter' | 'scramble' | 'sequencePlay' | 'morph' | 'wordSequence' | 'textReveal' | 'fire' | 'strokeTrail';
}

export const PRESETS: Record<string, PresetConfig> = {
  // --- Slides ---
  slideLeft:    { x: -200, opacity: 0 },
  slideRight:   { x: 200, opacity: 0 },
  slideUp:      { y: 100, opacity: 0 },
  slideDown:    { y: -100, opacity: 0 },

  // --- Fades ---
  fadeIn:       { opacity: 0 },
  fadeScale:    { opacity: 0, scale: 0.8 },
  fadeScaleUp:  { opacity: 0, scale: 0.5 },

  // --- Scales ---
  scaleX:       { scaleX: 0, transformOrigin: 'left center' },
  scaleXCenter: { scaleX: 0, transformOrigin: 'center center' },
  scaleY:       { scaleY: 0, transformOrigin: 'center top' },
  popIn:        { scale: 0, opacity: 0 },

  // --- Wipes (clip-path) ---
  wipeLeft:     { clipPath: 'inset(0 100% 0 0)' },
  wipeRight:    { clipPath: 'inset(0 0 0 100%)' },
  wipeUp:       { clipPath: 'inset(100% 0 0 0)' },
  wipeDown:     { clipPath: 'inset(0 0 100% 0)' },
  wipeCircle:   { clipPath: 'circle(0% at 50% 50%)' },

  // --- Rotations ---
  rotateIn:     { rotation: -90, opacity: 0, transformOrigin: 'left bottom' },
  flipX:        { rotationX: 90, opacity: 0 },
  flipY:        { rotationY: 90, opacity: 0 },
  flip3D:       { rotationY: 180, opacity: 0, transformPerspective: 800 },
  rollIn:       { x: -100, rotation: -120, opacity: 0 },
  newspaper:    { rotation: 720, scale: 0, opacity: 0 },

  // --- 3D (perspective-corrected — transformPerspective makes the rotation
  // actually look like it's tilting/turning in space instead of a flat
  // squish; TRACK_PROPERTIES below exposes the same components — rotationX/
  // rotationY/z/transformPerspective — for custom keyframe-driven 3D too) ---
  tilt3D:       { rotationX: -25, rotationY: 15, opacity: 0, transformPerspective: 900 },
  swivelLeft3D: { rotationY: -100, opacity: 0, transformPerspective: 900, transformOrigin: 'left center' },
  swivelRight3D:{ rotationY: 100, opacity: 0, transformPerspective: 900, transformOrigin: 'right center' },
  cardFlip3D:   { rotationY: 180, opacity: 0, transformPerspective: 1200 },
  popForward3D: { z: -500, scale: 0.7, opacity: 0, transformPerspective: 700 },

  // --- Blur ---
  blurIn:       { filter: 'blur(20px)', opacity: 0 },
  zoomBlur:     { scale: 2, filter: 'blur(20px)', opacity: 0 },

  // --- Skew ---
  skewLeft:     { skewX: -30, opacity: 0, x: -100 },
  skewRight:    { skewX: 30, opacity: 0, x: 100 },
  lightSpeedIn: { x: 150, skewX: -30, opacity: 0 },

  // --- Loop motions (MotionKit-style continuous/repeating moves) ---
  // Plain finite `.from()`-style presets like every other entry above —
  // nothing new engine-side. What makes them read as a continuous loop
  // instead of a one-shot entrance is authoring them on the Loop state
  // with its own Loop checkbox on (CgTemplateTimeline.tsx's per-state
  // panel — repeat(-1) on the WHOLE state timeline, see
  // cgAnimationEngine.ts's buildOneTimeline) — Yoyo ALSO on for every one
  // of these except 'spinLoop' (a genuine continuous one-direction spin
  // wants to just keep going the same way, not reverse). Suggested
  // Duration/Ease per preset noted alongside each — short and springy for
  // the jittery ones, slow and linear for the spin. Applying one WITHOUT
  // Loop/Yoyo still works, just plays once (from the offset to rest) like
  // any other preset — nothing about these requires the loop state
  // specifically, that's simply where they read as intended.
  wiggleLoop:   { rotation: -6, transformOrigin: 'center center' },   // Duration ~0.15s, ease 'sine.inOut', Loop+Yoyo
  shakeLoop:    { x: -6 },                                            // Duration ~0.1s,  ease 'power1.inOut', Loop+Yoyo
  bounceLoop:   { y: -18 },                                           // Duration ~0.4s,  ease 'power1.out',   Loop+Yoyo
  pulseLoop:    { scale: 1.08, transformOrigin: 'center center' },    // Duration ~0.6s,  ease 'sine.inOut',   Loop+Yoyo
  floatLoop:    { y: -10 },                                           // Duration ~1.4s,  ease 'sine.inOut',   Loop+Yoyo
  swingLoop:    { rotation: -12, transformOrigin: 'top center' },     // Duration ~0.8s,  ease 'sine.inOut',   Loop+Yoyo
  // A full, seamless spin: -360deg to the rest value (0) with a LINEAR
  // ease reads as one continuous rotation, not a snap-back, because -360
  // and 0 are the exact same visual orientation — the "wrap" at the end of
  // each repeat is invisible. Loop ON, Yoyo OFF (yoyo would reverse
  // direction every other pass, reading as a wobble instead of a spin).
  spinLoop:     { rotation: -360, transformOrigin: 'center center' }, // Duration ~2s, ease 'none', Loop only

  // --- Fire / stroke trail (special handling — see cgAnimationEngine.ts) ---
  // 'fire' — a flickering, randomly-timed glow/scale jitter in warm colors,
  // continuously looping on its own regardless of the Loop/Yoyo checkboxes
  // (a real flicker needs irregular timing a single from/to yoyo can't
  // produce — see buildFireFlicker). Any element kind.
  fire:         { _type: 'fire' },
  // 'strokeTrail' — a running dash chasing its own path with a fading
  // trail behind it, MotionKit AE's own "line draw with trail" look —
  // 'shape' elements only (needs a real stroked SVG path to run along; see
  // buildStrokeTrail). Also self-looping regardless of Loop/Yoyo.
  strokeTrail:  { _type: 'strokeTrail' },

  // --- Shape morph (see cgAnimationEngine.ts's buildMorph — 'shape' elements only) ---
  morph:        { _type: 'morph' },

  // --- Typewriter / Scramble / Sequence (special handling — see cgAnimationEngine.ts) ---
  typewriter:   { _type: 'typewriter' },
  scramble:     { _type: 'scramble' },
  sequencePlay: { _type: 'sequencePlay' },
  // "Machine Gun Text Effect"-style rapid word-by-word cycling — 'text'
  // elements only, driven by config.wordSequence (see canvas.ts's
  // CgWordSequenceItem / cgAnimationEngine.ts's buildWordSequence).
  wordSequence: { _type: 'wordSequence' },
  // Per-character/word/sentence staggered reveal — 'text' elements only,
  // driven by config.textRevealUnit/textRevealStyle/textRevealStagger/
  // textRevealDuration/textRevealEase (see lib/textReveal.ts's own catalog
  // and cgAnimationEngine.ts's buildTextReveal).
  textReveal:   { _type: 'textReveal' },

  // --- None ---
  none:         {},
};

export const OUT_PRESETS: Record<string, PresetConfig> = {
  slideLeft:     { x: -200, opacity: 0 },
  slideRight:    { x: 200, opacity: 0 },
  slideUp:       { y: -100, opacity: 0 },
  slideDown:     { y: 100, opacity: 0 },
  fadeOut:       { opacity: 0 },
  fadeScale:     { opacity: 0, scale: 0.8 },
  scaleX:        { scaleX: 0, transformOrigin: 'left center' },
  wipeLeft:      { clipPath: 'inset(0 100% 0 0)' },
  wipeRight:     { clipPath: 'inset(0 0 0 100%)' },
  wipeUp:        { clipPath: 'inset(0 0 100% 0)' },
  wipeDown:      { clipPath: 'inset(100% 0 0 0)' },
  wipeCircle:    { clipPath: 'circle(0% at 50% 50%)' },
  blurOut:       { filter: 'blur(20px)', opacity: 0 },
  zoomBlur:      { scale: 2, filter: 'blur(20px)', opacity: 0 },
  popOut:        { scale: 1.2, opacity: 0 },
  rollOut:       { x: 100, rotation: 120, opacity: 0 },
  lightSpeedOut: { x: -150, skewX: 30, opacity: 0 },
  flip3D:        { rotationY: 180, opacity: 0, transformPerspective: 800 },
  newspaper:     { rotation: 720, scale: 0, opacity: 0 },
  tilt3D:        { rotationX: 25, rotationY: -15, opacity: 0, transformPerspective: 900 },
  swivelLeft3D:  { rotationY: 100, opacity: 0, transformPerspective: 900, transformOrigin: 'left center' },
  swivelRight3D: { rotationY: -100, opacity: 0, transformPerspective: 900, transformOrigin: 'right center' },
  cardFlip3D:    { rotationY: 180, opacity: 0, transformPerspective: 1200 },
  popBack3D:     { z: -500, scale: 0.7, opacity: 0, transformPerspective: 700 },
  morph:         { _type: 'morph' },
  sequencePlay:  { _type: 'sequencePlay' },
  wordSequence:  { _type: 'wordSequence' },
  none:          {},
};

export const EASES = [
  'none', 'power1.in', 'power1.out', 'power1.inOut',
  'power2.in', 'power2.out', 'power2.inOut',
  'power3.in', 'power3.out', 'power3.inOut',
  'power4.in', 'power4.out', 'power4.inOut',
  'back.in(1.7)', 'back.out(1.7)', 'back.inOut(1.7)',
  'elastic.out(1,0.3)', 'elastic.in(1,0.3)',
  'bounce.out', 'bounce.in',
  'circ.in', 'circ.out', 'circ.inOut',
  'expo.in', 'expo.out', 'expo.inOut',
  'sine.in', 'sine.out', 'sine.inOut',
  'steps(5)', 'steps(10)', 'steps(20)',
];

// The addable keyframe-track properties (Keyframes mode's "+ Track" picker
// in CgTemplateTimeline.tsx) — same allowlist as the reference app, plus
// the 3D transform components (rotationX/rotationY/z/transformPerspective
// — rotationZ is just the existing plain "rotation") for custom keyframe-
// driven 3D moves beyond the canned tilt3D/swivel*3D/cardFlip3D/pop*3D
// presets above — e.g. a keyframed tilt that changes direction partway
// through, not just a single one-shot preset.
export const TRACK_PROPERTIES = [
  'x', 'y', 'z', 'opacity', 'scaleX', 'scaleY', 'scale', 'rotation', 'rotationX', 'rotationY',
  'transformPerspective', 'skewX', 'skewY',
  'clipPath', 'filter', 'width', 'height', 'borderRadius', 'backgroundColor',
  'color', 'fontSize', 'letterSpacing', 'blur',
];

/** A STATIC (never animated) CSS `transform` value from a TemplateElement's
 *  own Blender-style Transform fields — staticRotateX/Y/Z (Rotation),
 *  staticTranslateZ (Location Z — X/Y already live on the element's own
 *  x/y), staticScaleX/Y/Z (Scale, default 1 each) — see canvas.ts's own
 *  doc comment on `config` for the full "why" (a fixed 3D pose, e.g. one
 *  face of a 3D Box template, that's always in effect rather than only
 *  during an authored animation). Shared by both renderers so the exact
 *  same order/unit suffixes never drift apart between them. `undefined`
 *  when nothing is set (every rotate/translate at 0, every scale at 1), so
 *  a caller can skip touching `transform` at all rather than writing an
 *  inert `transform: ''`/`transform: none` onto every element that's never
 *  used this feature. Scale is the RIGHTMOST function in the chain (so, in
 *  CSS's right-to-left composition, the FIRST one applied to the element's
 *  own local geometry) — the standard 3D convention of scaling an object in
 *  its own local space before rotating/positioning it, which also keeps a
 *  3D Box face's existing rotate+translateZ "sweep around the box's own
 *  pivot" geometry unaffected by adding a scale on top of it.
 *
 *  `config.scene3D` (see its own doc comment in the Inspector/canvas.ts)
 *  ALSO prepends a `perspective(...)` transform FUNCTION right here, on
 *  THIS element's own transform — but ONLY for a LEAF element (`hasChildren`
 *  false). Without this, a rotated leaf with no scene3D-enabled ancestor of
 *  its own renders with no perspective context at all — flat/orthographic,
 *  none of the foreshortening depth cue that makes a 3D tilt actually read
 *  as 3D.
 *
 *  A GROUP (has children) that ALSO poses itself — a 3D Box's own
 *  container, orbited as one object — deliberately does NOT get this same
 *  self-perspective, even though its own `scene3D` is on: it already
 *  establishes a SEPARATE `perspective` CSS PROPERTY on its own body-
 *  wrapper for its children's shared 3D space (CgTemplateDesigner.tsx's/
 *  CgTemplateWidget.tsx's own scene3DStyle). Stacking a SECOND, independent
 *  perspective transform function on the container's own rotate as well
 *  would compound into a visibly warped double-perspective instead of one
 *  coherent camera — nothing like how After Effects' single 3D camera
 *  renders a whole group of 3D layers together. Rotating the container with
 *  NO perspective of its own instead still produces a mathematically
 *  correct 3D (orthographic) rotation of the whole rigid group — the
 *  children's own preserve-3d space, and its one perspective, rides along
 *  with that rotation unchanged, which is what actually reads as "orbiting
 *  one solid object" the way After Effects' camera does. */
export function buildStaticTransform3D(config: Record<string, any>, hasChildren = false): string | undefined {
  const { staticRotateX, staticRotateY, staticRotateZ, staticTranslateZ, staticScaleX, staticScaleY, staticScaleZ, scene3D, scene3DPerspective } = config;
  const sx = staticScaleX ?? 1;
  const sy = staticScaleY ?? 1;
  const sz = staticScaleZ ?? 1;
  const hasScale = sx !== 1 || sy !== 1 || sz !== 1;
  if (!staticRotateX && !staticRotateY && !staticRotateZ && !staticTranslateZ && !hasScale) return undefined;
  const parts: string[] = [];
  if (scene3D && !hasChildren) parts.push(`perspective(${scene3DPerspective ?? 800}px)`);
  if (staticRotateX) parts.push(`rotateX(${staticRotateX}deg)`);
  if (staticRotateY) parts.push(`rotateY(${staticRotateY}deg)`);
  if (staticRotateZ) parts.push(`rotateZ(${staticRotateZ}deg)`);
  if (staticTranslateZ) parts.push(`translateZ(${staticTranslateZ}px)`);
  if (hasScale) parts.push(`scale3d(${sx}, ${sy}, ${sz})`);
  return parts.join(' ');
}

// The "rest"/identity value for a property a preset animates FROM (or TO,
// for an OUT_PRESETS entry) — used by expandPresetToTracks below to build
// the OTHER end of a 2-keyframe track expanded from a one-sided preset
// config. transformPerspective has no natural rest value (zeroing it would
// just kill the 3D depth right as the animation settles), so it holds
// constant instead of resting to anything.
const PRESET_PROPERTY_REST: Record<string, any> = {
  x: 0, y: 0, z: 0, opacity: 1, scale: 1, scaleX: 1, scaleY: 1,
  rotation: 0, rotationX: 0, rotationY: 0, skewX: 0, skewY: 0,
};
export function restValueForPresetProp(prop: string, fromValue: any): any {
  if (prop === 'transformPerspective') return fromValue;
  if (prop === 'filter') return 'blur(0px)';
  if (prop === 'clipPath' && typeof fromValue === 'string') {
    if (fromValue.startsWith('circle(')) return 'circle(150% at 50% 50%)';
    if (fromValue.startsWith('inset(')) return 'inset(0% 0% 0% 0%)';
  }
  return prop in PRESET_PROPERTY_REST ? PRESET_PROPERTY_REST[prop] : fromValue;
}

/** Expands an authored preset into real, editable keyframe tracks — shared
 *  by CgTemplateDesigner.tsx's applyPreset (switching the Preset dropdown)
 *  and ElementPropertiesPanel.tsx's stopwatch toggle (keyframing one
 *  property while still in Preset mode first needs to convert the whole
 *  layer the same way, so both end up with byte-for-byte the same tracks
 *  for the same preset). Lives here rather than in either of those two
 *  component files so both can import it without one depending on the
 *  other. `keyframe` avoids a hard dependency on types/canvas.ts's
 *  CgKeyframe shape beyond {t,v,ease?} — this file otherwise only imports
 *  plain data, no component/type-layer coupling. */
export function expandPresetToTracks(preset: Record<string, any>, isOut: boolean, delay: number, duration: number, ease: string): Record<string, { t: number; v: any; ease?: string }[]> {
  const endTime = Number((delay + duration).toFixed(2));
  const tracks: Record<string, { t: number; v: any; ease?: string }[]> = {};
  Object.entries(preset).forEach(([prop, fromValue]) => {
    if (prop === 'transformOrigin') return;
    const rest = restValueForPresetProp(prop, fromValue);
    tracks[prop] = isOut
      ? [{ t: delay, v: rest }, { t: endTime, v: fromValue, ease }]
      : [{ t: delay, v: fromValue }, { t: endTime, v: rest, ease }];
  });
  return tracks;
}
