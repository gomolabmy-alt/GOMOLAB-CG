// Gradient color resolution for TemplateElement's fill/bgColor/color config
// fields — each one is a plain solid color string (as always) OR a
// CgGradient (see types/canvas.ts). Both CgTemplateWidget.tsx (real output)
// and CgTemplateDesigner.tsx's ElementPreview (live editing preview) route
// every color field through these so they stay in lockstep, the same
// relationship they already have with lib/cgEffects.ts.
// (.tsx, not .ts — resolveSvgFill returns actual JSX for the SVG defs.)
import type { CSSProperties, ReactNode } from 'react';
import type { CgGradient } from '../types/canvas';
import { hexToRgba } from './cgEffects';

export function isGradient(v: unknown): v is CgGradient {
  return !!v && typeof v === 'object' && 'stops' in (v as object);
}

function sortedStops(g: CgGradient): CgGradient['stops'] {
  return [...g.stops].sort((a, b) => a.offset - b.offset);
}

export function gradientToCss(g: CgGradient): string {
  const stopsCss = sortedStops(g).map((s) => `${s.color} ${s.offset}%`).join(', ');
  return g.type === 'radial'
    ? `radial-gradient(circle at ${g.cx ?? 50}% ${g.cy ?? 50}%, ${stopsCss})`
    : `linear-gradient(${g.angle ?? 90}deg, ${stopsCss})`;
}

/** Where GradientAnchorHandle.tsx's draggable dot should sit, in the
 *  element's own local pixel space (0..w, 0..h) — radial is literally its
 *  center point; linear has no real "position" in CSS (just a direction),
 *  so the handle instead sits out toward the element's edge, in the
 *  direction `angle` points — same CSS convention gradientToCss's own
 *  `${angle}deg` and resolveSvgFill's `rotate(angle-90,...)` already use
 *  (0deg = up, clockwise). See gradientFromHandleDrag for the inverse. */
export function gradientHandlePosition(g: CgGradient, w: number, h: number): { x: number; y: number } {
  if (g.type === 'radial') {
    return { x: ((g.cx ?? 50) / 100) * w, y: ((g.cy ?? 50) / 100) * h };
  }
  const rad = ((g.angle ?? 90) * Math.PI) / 180;
  const r = (Math.min(w, h) / 2) * 0.8;
  return { x: w / 2 + r * Math.sin(rad), y: h / 2 - r * Math.cos(rad) };
}

/** Inverse of gradientHandlePosition — given the handle's new (already
 *  clamped-to-the-element-box) local position, returns the updated
 *  gradient. Radial just becomes that position as a percent; linear
 *  recovers the angle from the drag vector relative to the element's
 *  center (atan2(dx, -dy) is the exact inverse of the sin/-cos pair
 *  above). */
export function gradientFromHandleDrag(g: CgGradient, w: number, h: number, hx: number, hy: number): CgGradient {
  if (g.type === 'radial') {
    const cx = Math.max(0, Math.min(100, (hx / w) * 100));
    const cy = Math.max(0, Math.min(100, (hy / h) * 100));
    return { ...g, cx, cy };
  }
  const dx = hx - w / 2;
  const dy = hy - h / 2;
  const angle = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  return { ...g, angle };
}

/** rect Fill, text/image Background — a gradient is just a different value
 *  for the same CSS `background` property a solid color already used. */
export function resolveBackground(v: string | CgGradient | undefined, fallback: string): string {
  if (isGradient(v)) return gradientToCss(v);
  return v ?? fallback;
}

/** Text Color — CSS can't give a plain `color` a gradient directly, so a
 *  gradient instead becomes a background clipped to the text's own shape.
 *  Callers only need this when el.config.color is actually a gradient
 *  (see the 'text' render branches — a solid color keeps applying `color`
 *  directly on the same node exactly as before this existed).
 *
 *  `opacityPct` (0-100, default 100) — text's own `config.colorOpacity`,
 *  letting the fill itself be partly or fully see-through (down to
 *  invisible glyphs, only their outline/stroke or an underlying glass
 *  effect's own chrome showing). Baked directly into the color/gradient
 *  stop VALUES themselves (an rgba()/8-digit-equivalent alpha via
 *  cgEffects.ts's hexToRgba) rather than a plain CSS `opacity` property on
 *  the text node — that property (and `filter`) is exactly what GSAP's own
 *  keyframe/preset engine imperatively tweens on this SAME node for
 *  entrance/exit fades and animated effects (see cgAnimationEngine.ts);
 *  setting either from here would fight the very next animation frame that
 *  writes to it. Baking alpha into the color VALUE instead touches a
 *  property GSAP never owns, so the two coexist with zero interaction —
 *  a look can fade in/out via the normal preset system AND independently
 *  have a partly-transparent fill throughout. */
export function resolveTextColorStyle(v: string | CgGradient | undefined, fallback: string, opacityPct?: number): CSSProperties {
  const alpha = opacityPct ?? 100;
  if (isGradient(v)) {
    const dimmed = alpha >= 100 ? v : { ...v, stops: v.stops.map((s) => ({ ...s, color: hexToRgba(s.color, alpha) })) };
    return {
      background: gradientToCss(dimmed),
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      color: 'transparent',
      WebkitTextFillColor: 'transparent',
    } as CSSProperties;
  }
  return { color: alpha >= 100 ? (v ?? fallback) : hexToRgba(v ?? fallback, alpha) };
}

/** shape Fill — SVG's `fill` attribute can't take CSS gradient syntax; it
 *  needs `fill="url(#id)"` referencing a <linearGradient>/<radialGradient>
 *  def. Renders the def self-contained inside that one shape's own <svg>
 *  (unlike mask <clipPath> defs, a shape's own fill gradient is never
 *  referenced by any other element, so it doesn't need to be hoisted
 *  anywhere shared). */
export function resolveSvgFill(v: string | CgGradient | undefined, gradientId: string, fallback: string): { fill: string; defs: ReactNode } {
  if (!isGradient(v)) return { fill: v ?? fallback, defs: null };
  const stops = sortedStops(v).map((s, i) => <stop key={i} offset={`${s.offset}%`} stopColor={s.color} />);
  if (v.type === 'radial') {
    return {
      fill: `url(#${gradientId})`,
      defs: <radialGradient id={gradientId} cx={`${v.cx ?? 50}%`} cy={`${v.cy ?? 50}%`}>{stops}</radialGradient>,
    };
  }
  // gradientTransform rotate() around the center (0.5,0.5) gives the same
  // "angle" convention as CSS linear-gradient(), applied to SVG's default
  // left-to-right (0%,0%)->(100%,0%) gradient vector.
  const angle = v.angle ?? 90;
  return {
    fill: `url(#${gradientId})`,
    defs: <linearGradient id={gradientId} gradientTransform={`rotate(${angle - 90} 0.5 0.5)`}>{stops}</linearGradient>,
  };
}
