import { useLayoutEffect, type RefObject } from 'react';
import { gsap } from 'gsap';
import type { CgEffect } from '../types/canvas';
import { buildStrokeDashArray, strokeLinecapFor } from './cgEffects';

/** Drives a 'stroke' effect's own ring — both its static dash pattern (set
 *  as a real SVG attribute here, since the dash lengths are computed as a
 *  proportion of the ring's own PERIMETER — only knowable once the node is
 *  actually mounted/laid out, via `getTotalLength()` — see cgEffects.ts's
 *  buildStrokeDashArray) and, once `animated` is on, its "marching ants"
 *  motion: a continuous `strokeDashoffset` loop, independent of the
 *  in/loop/out state machine, same relationship lightSweep's own motion
 *  already has to that timeline (see lib/useLightSweep.ts). One call each
 *  from CgTemplateWidget.tsx's real output and CgTemplateDesigner.tsx's own
 *  preview, sharing this one implementation — the actual ring/overlay JSX
 *  itself is still duplicated per file, same convention every other
 *  per-kind shared hook here follows.
 *
 *  `strokeRef` is the actual `<path>`/`<rect>` ring node. `strokeEffect` is
 *  the whole enabled 'stroke' CgEffect (or null/undefined — this hook is a
 *  no-op then, e.g. no stroke effect on this element at all). Mirrors
 *  cgAnimationEngine.ts's own `buildStrokeTrail` preset (the only other
 *  place in this app already animates dashoffset this way) for the actual
 *  dash math — that one is operator-authored into a specific Loop-state
 *  timeline; this is the same technique, just always-on the moment this
 *  effect is enabled, same "self-contained, not part of the timeline"
 *  treatment lightSweep itself gets. */
export function useRunningStroke(
  strokeEffect: CgEffect | null | undefined,
  strokeRef: RefObject<SVGGeometryElement | null>,
): void {
  useLayoutEffect(() => {
    if (!strokeEffect) return;
    const node = strokeRef.current;
    if (!node) return;
    const length = node.getTotalLength();
    if (!Number.isFinite(length) || length <= 0) return;

    const dasharray = buildStrokeDashArray(strokeEffect, length);
    if (dasharray) node.setAttribute('stroke-dasharray', dasharray);
    else node.removeAttribute('stroke-dasharray');
    node.setAttribute('stroke-linecap', strokeLinecapFor(strokeEffect));

    if (!strokeEffect.animated || (strokeEffect.dashStyle ?? 'dashed') === 'solid') return;
    gsap.set(node, { strokeDashoffset: 0 });
    const tween = gsap.to(node, {
      strokeDashoffset: strokeEffect.direction === 'reverse' ? length : -length,
      duration: Math.max(0.1, strokeEffect.duration ?? 2),
      ease: 'none',
      repeat: -1,
    });
    return () => {
      tween.kill();
      // Scoped, not 'all' — see CgTemplateDesigner.tsx's resetToRest for why
      // a blanket clearProps on a node other code also styles is a bug.
      gsap.set(node, { clearProps: 'strokeDashoffset' });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    strokeEffect?.dashStyle,
    strokeEffect?.animated,
    strokeEffect?.duration,
    strokeEffect?.direction,
    strokeEffect?.strokeWidth,
    strokeEffect?.strokeGap,
  ]);
}
