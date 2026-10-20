import { useLayoutEffect, type RefObject } from 'react';
import { gsap } from 'gsap';

/** Drives a 'lightSweep' effect's own band — a continuous loop, independent
 *  of the in/loop/out state machine, same relationship a 'ticker' element's
 *  scroll already has to that timeline (see lib/useTickerScroll.ts). One
 *  call each from CgTemplateWidget.tsx's real output and
 *  CgTemplateDesigner.tsx's own preview, sharing this one implementation —
 *  the actual band/overlay JSX itself is still duplicated per file, same
 *  convention every other per-kind shared hook in this app already follows.
 *
 *  `bandRef` is the INNERMOST of the two overlay divs (see
 *  buildLightSweepGeometry's own doc comment) — a plain, un-rotated square
 *  this hook only ever translates along its own local X axis; the OUTER box
 *  (static, plain CSS `rotate(angle)`, never touched by GSAP) is what turns
 *  that translation into a sweep at the effect's own configured angle,
 *  keeping this hook itself angle-agnostic. */
export function useLightSweep(
  enabled: boolean,
  bandRef: RefObject<HTMLElement | null>,
  distance: number,
  duration: number,
  gap: number
): void {
  useLayoutEffect(() => {
    if (!enabled) return;
    const node = bandRef.current;
    if (!node) return;
    gsap.set(node, { x: -distance });
    const tween = gsap.to(node, {
      x: distance,
      duration: Math.max(0.1, duration),
      ease: 'power1.inOut',
      repeat: -1,
      repeatDelay: Math.max(0, gap),
    });
    return () => {
      tween.kill();
      // Scoped, not 'all' — see CgTemplateDesigner.tsx's resetToRest for why
      // a blanket clearProps on a node other code also styles is a bug.
      gsap.set(node, { clearProps: 'transform' });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, distance, duration, gap]);
}
