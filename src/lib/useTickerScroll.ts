import { useLayoutEffect, useState, type RefObject } from 'react';
import { gsap } from 'gsap';

/** Drives one 'ticker' element's continuous horizontal scroll — shared by
 *  CgTemplateWidget.tsx's real output and CgTemplateDesigner.tsx's own
 *  preview, one call each, so both always agree on how a ticker behaves
 *  and animate identically (same relationship lib/useAutoFitFontSize.ts
 *  already has with 'text' elements' autoFit).
 *
 *  Renders `repeats` (this hook's return value) side-by-side copies of the
 *  same text inside the caller's `trackRef` node, then continuously
 *  translates that whole track by exactly one copy's own measured width
 *  (via `unitRef`, which the caller must put on the FIRST copy specifically)
 *  — once the track has moved by that distance, the SECOND copy sits
 *  exactly where the first one started, so `repeat:-1` loops with no visible
 *  seam or jump. `repeats` itself is sized to always cover the container's
 *  width plus one extra full copy, so the loop never shows a gap regardless
 *  of how short the text is relative to the element's own width.
 *
 *  Unlike every other kind's animation (the in/loop/out states, authored
 *  per CgLayerAnim), this scroll is self-contained and always running from
 *  the moment the element mounts — a real news ticker just scrolls
 *  continuously the whole time it's on screen, it isn't something an
 *  operator authors an entrance/exit for. `enabled` (pass `el.kind ===
 *  'ticker'`) lets a caller invoke this unconditionally regardless of which
 *  kind it's currently rendering, same reason every other per-kind hook in
 *  TemplateElementView/ElementPreview takes an `enabled` flag rather than
 *  being called conditionally (React's rules of hooks). */
export function useTickerScroll(
  enabled: boolean,
  trackRef: RefObject<HTMLElement | null>,
  unitRef: RefObject<HTMLElement | null>,
  containerWidth: number,
  opts: { text: string; fontSize: number; bold: boolean; speed: number; direction: 'left' | 'right'; gap: number }
): number {
  const [repeats, setRepeats] = useState(2);

  // Pass 1: measure one copy (text+gap, via unitRef's own border-box width)
  // and size `repeats` so the track always fully covers the container plus
  // one more copy, however short the text or wide the box.
  useLayoutEffect(() => {
    if (!enabled) return;
    // offsetWidth, NOT getBoundingClientRect().width — the latter reports
    // the visually-rendered size AFTER every ancestor's own CSS transform,
    // which includes the CG Monitor's own small-preview scale-down (and the
    // designer canvas's own zoom) — using that here would size `repeats` off
    // a number smaller than this unit's TRUE layout width, undershooting.
    // offsetWidth reports the element's own layout box, in its own local
    // (unscaled) coordinate space, unaffected by any transform anywhere in
    // its ancestor chain — exactly what both this and the animation below
    // need, since the GSAP `x` distance below is ALSO a local-space value.
    const unitWidth = unitRef.current?.offsetWidth ?? 0;
    if (unitWidth <= 0) return;
    setRepeats(Math.max(2, Math.ceil((containerWidth + unitWidth) / unitWidth) + 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, opts.text, opts.fontSize, opts.bold, opts.gap, containerWidth]);

  // Pass 2: once `repeats` reflects the correct count (the state update
  // above, and this effect re-running on the resulting re-render, both
  // still land before the browser ever paints — same useLayoutEffect
  // same-flush guarantee CgTemplateWidget.tsx's value-change transitions
  // already rely on), build the actual endless scroll.
  useLayoutEffect(() => {
    if (!enabled) return;
    const track = trackRef.current;
    // offsetWidth — see the identical reasoning in the effect above.
    const unitWidth = unitRef.current?.offsetWidth ?? 0;
    if (!track || unitWidth <= 0) return;
    const dir = opts.direction === 'right' ? 1 : -1;
    const speed = opts.speed > 0 ? opts.speed : 120;
    gsap.set(track, { x: 0 });
    const tween = gsap.to(track, { x: dir * unitWidth, duration: unitWidth / speed, ease: 'none', repeat: -1 });
    return () => { tween.kill(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, repeats, opts.text, opts.fontSize, opts.bold, opts.gap, opts.speed, opts.direction]);

  return repeats;
}
