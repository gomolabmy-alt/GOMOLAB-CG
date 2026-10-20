import { useEffect } from 'react';

export interface WaveWarpNodes {
  offset: SVGFEOffsetElement | null;
}

/** Continuously slides a Wave Warp filter's wave/noise field along its own
 *  Direction at Wave Speed — the same raw-rAF-writing-SVG-attributes
 *  technique lib/useFlagWave.ts already uses (GSAP tweens a CSS property;
 *  these are plain DOM attributes on an <feOffset>, not something GSAP's
 *  own string interpolation targets). Writing `dx`/`dy` instead of
 *  regenerating the whole wave map every frame is what makes an otherwise
 *  expensive-to-rebuild SVG filter animate smoothly: the map itself (see
 *  cgEffects.ts's buildWaveWarpMapSvg) only ever needs rebuilding when a
 *  SETTING changes, never on a timer. */
export function useWaveWarp(
  enabled: boolean,
  getNodes: () => WaveWarpNodes | undefined,
  pxPerSecond: number,
  phasePx: number,
  angleDeg: number,
): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const nodes = getNodes();
    if (!nodes?.offset) return undefined;

    const angleRad = (angleDeg * Math.PI) / 180;
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);

    let raf: number;
    const start = performance.now();
    const tick = (now: number) => {
      const t = (now - start) / 1000;
      const travel = phasePx + pxPerSecond * t;
      if (nodes.offset) {
        nodes.offset.setAttribute('dx', (travel * cosA).toFixed(2));
        nodes.offset.setAttribute('dy', (travel * sinA).toFixed(2));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, getNodes, pxPerSecond, phasePx, angleDeg]);
}
