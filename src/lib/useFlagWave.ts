import { useEffect } from 'react';

export interface FlagWaveNodes {
  turbulence: SVGFETurbulenceElement | null;
  light: SVGFEDistantLightElement | null;
}

/** Drives a 'flagWave' effect's own SVG filter (see cgEffects.ts's own doc
 *  comment on the filter recipe) — a continuous loop, independent of the
 *  in/loop/out state machine, same relationship 'lightSweep' 's own band
 *  already has to that timeline (see lib/useLightSweep.ts). One call each
 *  from CgTemplateWidget.tsx's real output and CgTemplateDesigner.tsx's own
 *  preview, sharing this one implementation.
 *
 *  Animates two SVG filter-primitive ATTRIBUTES directly (not a CSS
 *  property GSAP could tween normally) via a plain requestAnimationFrame
 *  loop rather than gsap.to — simpler and more reliable than fighting
 *  GSAP's string-interpolation plugin over `baseFrequency`, which can take
 *  either one shared value or an "x y" pair depending on how many numbers
 *  are present; this only ever writes one. `baseFrequency` OSCILLATES
 *  (rather than climbing/wrapping) between [base*0.7, base*1.3] — a
 *  perfectly steady frequency displaces pixels once and then just sits
 *  there, never reading as motion at all; oscillating it is what makes the
 *  ripple density visibly "breathe". `azimuth` SWEEPS continuously through
 *  a full 360° instead — the moving light direction is what makes the
 *  ridges' own highlights/shadows read as travelling across the surface,
 *  the actual "3D looking" part of this effect.
 *
 *  `getNodes` is called fresh EVERY TIME this effect (re)starts, not once
 *  at the call site — the actual <feTurbulence>/<feDistantLight> nodes live
 *  in a shared <defs> block one level up from wherever this element itself
 *  renders (same "look them up by id from a shared ref map" shape
 *  lib/useEffectSourceOnlyReveal.ts's own `getCoveringNode` already uses),
 *  and aren't guaranteed attached yet during THIS component's own render —
 *  only by the time its OWN effects run, after the whole tree has
 *  committed. */
export function useFlagWave(
  enabled: boolean,
  getNodes: () => FlagWaveNodes | undefined,
  baseFrequency: number,
  startAzimuth: number,
  cycleDurationSec: number,
): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const nodes = getNodes();
    if (!nodes || (!nodes.turbulence && !nodes.light)) return undefined;

    let raf: number;
    const start = performance.now();
    const tick = (now: number) => {
      const t = (now - start) / 1000;
      const phase = (2 * Math.PI * t) / cycleDurationSec;
      if (nodes.turbulence) {
        const freq = Math.max(0.0001, baseFrequency * (1 + 0.3 * Math.sin(phase)));
        nodes.turbulence.setAttribute('baseFrequency', freq.toFixed(4));
      }
      if (nodes.light) {
        const azimuth = (startAzimuth + (t / cycleDurationSec) * 360) % 360;
        nodes.light.setAttribute('azimuth', azimuth.toFixed(1));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, getNodes, baseFrequency, startAzimuth, cycleDurationSec]);
}
