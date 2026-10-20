// "Text Reveal" — a dedicated, per-unit staggered entrance animation for
// 'text' elements, selectable as an ordinary Preset (see cgPresets.ts's own
// PRESETS.textReveal sentinel entry, same `_type`-tagged convention
// 'typewriter'/'scramble'/'wordSequence' already use — see
// cgAnimationEngine.ts's buildPresetAnimation, which dispatches to
// buildTextReveal below instead of the generic tl.from/tl.to path once it
// sees this preset). Splits the text into individual units (characters,
// words, or whole sentences — config.textRevealUnit), each getting its own
// independently-animated <span>, staggered one after another by
// config.textRevealStagger — the classic "SplitText" reveal technique
// countless motion-design tools/demos use, built here with plain CSS
// transforms + GSAP rather than pulling in a dedicated splitting library.
//
// A curated, not exhaustive, style catalog — "every animation on the
// internet" isn't a buildable/maintainable target, so this picks a broad,
// recognizable spread of the most common text-reveal motions (fades,
// slides, a 3D flip/tumble pair satisfying "3D effect for text", a couple
// of punchier ones, and one continuous non-entrance style, 'wave') rather
// than trying to be infinite.

export type TextRevealUnit = 'character' | 'word' | 'sentence';

export interface TextRevealFromState {
  opacity?: number;
  x?: number;
  y?: number;
  rotateX?: number;
  rotateY?: number;
  rotateZ?: number;
  scale?: number;
  skewX?: number;
  filter?: string;
}

export interface TextRevealStyleDef {
  label: string;
  from: TextRevealFromState;
  /** True for the one style (currently just 'wave') that isn't a one-shot
   *  reveal at all — it loops continuously the whole time the element is
   *  on screen, same relationship a 'ticker' element's scroll already has
   *  to the in/loop/out state machine, rather than animating FROM this
   *  pose TO rest once. buildTextReveal branches on this. */
  loop?: boolean;
  /** True for the 3D-flavored styles — buildTextReveal sets `perspective`/
   *  `transform-style:preserve-3d` on the shared container only when at
   *  least one style needing real 3D depth is actually in use, rather than
   *  unconditionally on every text element. */
  is3D?: boolean;
}

export const TEXT_REVEAL_STYLES: Record<string, TextRevealStyleDef> = {
  fadeUp: { label: 'Fade Up', from: { opacity: 0, y: 24 } },
  fadeDown: { label: 'Fade Down', from: { opacity: 0, y: -24 } },
  fadeIn: { label: 'Fade In', from: { opacity: 0 } },
  slideLeft: { label: 'Slide In (Left)', from: { opacity: 0, x: -40 } },
  slideRight: { label: 'Slide In (Right)', from: { opacity: 0, x: 40 } },
  scalePop: { label: 'Scale Pop', from: { opacity: 0, scale: 0 } },
  scaleDown: { label: 'Scale Down In', from: { opacity: 0, scale: 1.8 } },
  rotateIn: { label: 'Rotate In', from: { opacity: 0, rotateZ: -50 } },
  skewIn: { label: 'Skew In', from: { opacity: 0, skewX: -30, x: -15 } },
  blurIn: { label: 'Blur In', from: { opacity: 0, filter: 'blur(10px)' } },
  bounceUp: { label: 'Bounce Up', from: { opacity: 0, y: 40, scale: 0.7 } },
  flip3DX: { label: 'Flip Up (3D)', from: { opacity: 0, rotateX: -90 }, is3D: true },
  flip3DXDown: { label: 'Flip Down (3D)', from: { opacity: 0, rotateX: 90 }, is3D: true },
  flip3DY: { label: 'Flip In (3D, Y-axis)', from: { opacity: 0, rotateY: 90 }, is3D: true },
  tumble3D: { label: 'Tumble In (3D)', from: { opacity: 0, rotateX: 45, rotateY: 45, scale: 0.4 }, is3D: true },
  wave: { label: 'Wave (continuous)', from: {}, loop: true },
};

/** Per-style GSAP ease, chosen to suit the motion (a bounce needs an
 *  overshoot ease to actually read as a bounce, a flat fade doesn't) —
 *  overridable per layer via config.textRevealEase, this is only the
 *  default a freshly-picked style seeds that field with. */
export const TEXT_REVEAL_DEFAULT_EASE: Record<string, string> = {
  scalePop: 'back.out(2)',
  bounceUp: 'back.out(3)',
  rotateIn: 'back.out(1.7)',
};

/** Splits `text` into the units 'character'/'word'/'sentence' reveal
 *  granularity actually animates, keeping whitespace as its own separate,
 *  never-animated entries (marked `space: true`) so word-boundary wrapping
 *  still happens exactly where a real space sits — consecutive non-space
 *  units get no space between them in the rendered markup at all, and
 *  adjacent inline-block elements with no whitespace between them have no
 *  valid line-break opportunity, so natural word-wrapping is preserved for
 *  free without needing to nest characters inside per-word wrapper spans. */
export interface TextRevealToken { text: string; space?: boolean }

export function splitTextIntoUnits(text: string, unit: TextRevealUnit): TextRevealToken[] {
  if (!text) return [];
  if (unit === 'sentence') {
    // Keeps the sentence's own trailing punctuation attached, splits on the
    // whitespace that follows it — a plain, good-enough heuristic (no
    // attempt to handle abbreviations like "Mr." specially).
    const parts = text.split(/(?<=[.!?])\s+/).filter(Boolean);
    return parts.map((s) => ({ text: s }));
  }
  if (unit === 'word') {
    // Keep the whitespace runs themselves as separate, unanimated tokens —
    // preserves however much space was actually authored (single space,
    // double space, a tab) instead of collapsing it to one fixed gap.
    return text.split(/(\s+)/).filter((s) => s.length > 0).map((s) => (/^\s+$/.test(s) ? { text: s, space: true } : { text: s }));
  }
  // 'character' — Array.from (not a plain index loop) so multi-byte
  // Unicode characters (emoji, combining marks) split as one whole
  // grapheme-ish unit rather than corrupting into surrogate halves.
  return Array.from(text).map((ch) => (/^\s$/.test(ch) ? { text: ch, space: true } : { text: ch }));
}
