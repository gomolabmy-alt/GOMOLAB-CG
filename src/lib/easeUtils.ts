// Bezier-curve easing — lets a keyframe/preset's `.ease` field hold either
// a plain named GSAP ease (e.g. "power2.out", unchanged from before this
// existed) OR a custom 4-number cubic bezier the designer's EaseCurveEditor
// lets you drag, in the same "cubic-bezier(x1,y1,x2,y2)" shape CSS itself
// uses — GSAP has no native support for that string, so resolveEase()
// bridges it via the free CustomEase plugin.
import { gsap } from 'gsap';
import CustomEase from 'gsap/CustomEase';

gsap.registerPlugin(CustomEase);

const BEZIER_RE = /^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/;

export function parseBezierEase(ease?: string): [number, number, number, number] | null {
  if (!ease) return null;
  const m = BEZIER_RE.exec(ease);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
}

export function bezierEaseString(x1: number, y1: number, x2: number, y2: number): string {
  return `cubic-bezier(${x1},${y1},${x2},${y2})`;
}

/** Inverts a single ease so it reads correctly once time itself is
 *  reversed — a segment that used to decelerate INTO a keyframe (an
 *  `.out` ease) now needs to accelerate OUT of it once that same motion
 *  plays backwards (an `.in` ease), and vice versa; `.inOut` stays
 *  `.inOut` (symmetric either way); 'none'/'steps(n)'/anything not
 *  matching the plain `family.in|out|inOut(args)` shape is returned
 *  unchanged (both are already direction-agnostic enough that inverting
 *  them wouldn't mean anything different). A custom cubic-bezier reverses
 *  via the standard point-reflection identity: reversing a bezier curve in
 *  both time and progress swaps its two control points and complements
 *  each coordinate — `(x1,y1,x2,y2) -> (1-x2,1-y2,1-x1,1-y1)` (e.g. CSS's
 *  own ease-out `cubic-bezier(0,0,.58,1)` maps to exactly ease-in
 *  `cubic-bezier(.42,0,1,1)`, confirming the identity). Shared by
 *  CgTemplateTimeline.tsx's own per-track "reverse" button and
 *  cgAnimationEngine.ts's buildPresetAnimation (a preset's own "Reverse"
 *  toggle) — both are the exact same "time itself runs backward" idea,
 *  just applied to a hand-authored keyframe track vs. a canned preset's
 *  implicit two-point one. */
export function invertEaseName(ease: string | undefined): string | undefined {
  if (!ease) return undefined;
  const bezier = parseBezierEase(ease);
  if (bezier) {
    const [x1, y1, x2, y2] = bezier;
    return bezierEaseString(1 - x2, 1 - y2, 1 - x1, 1 - y1);
  }
  const m = /^([a-zA-Z0-9]+)\.(in|out|inOut)(\(.*\))?$/.exec(ease);
  if (!m) return ease;
  const [, family, dir, args = ''] = m;
  const invertedDir = dir === 'in' ? 'out' : dir === 'out' ? 'in' : 'inOut';
  return `${family}.${invertedDir}${args}`;
}

/** Every `X.ease || 'power2.out'` call site in cgAnimationEngine.ts routes
 *  its result through this before handing it to GSAP's `ease:` option. A
 *  plain named ease passes through untouched; a `cubic-bezier(...)` string
 *  gets (re-)registered as a CustomEase under its own literal text as the
 *  id — re-registering the same id is harmless, so no "already registered"
 *  bookkeeping is needed — and that same string is returned as the ease
 *  name, since CustomEase.create's id IS what GSAP looks up by. */
export function resolveEase(ease: string): string {
  const bezier = parseBezierEase(ease);
  if (!bezier) return ease;
  const [x1, y1, x2, y2] = bezier;
  CustomEase.create(ease, `M0,0 C${x1},${y1} ${x2},${y2} 1,1`);
  return ease;
}
