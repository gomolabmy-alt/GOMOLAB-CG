import { useLayoutEffect, type RefObject } from 'react';
import { gsap } from 'gsap';
import type { AnimatedBgStyle } from './cgEffects';

export type AnimatedBgLoopMode = 'yoyo' | 'loop' | 'once';

/** Drives an 'animatedBg' effect's own background div — a continuous loop,
 *  independent of the in/loop/out state machine, same relationship
 *  'lightSweep' 's own band already has to that timeline (see
 *  lib/useLightSweep.ts). One call each from CgTemplateWidget.tsx's real
 *  output and CgTemplateDesigner.tsx's own preview, sharing this one
 *  implementation.
 *
 *  Animates whichever ONE property `style.animate` names, per `loopMode`
 *  (see TemplateElement's own `loopMode` doc comment for what each one
 *  looks like) — 'yoyo' (default) halves `durationSec` per leg (there are
 *  two legs per full cycle) and eases both ways; 'loop'/'once' use the
 *  FULL `durationSec` for their one forward leg, 'loop' at a constant
 *  linear speed (a sine ease restarting every cycle would visibly pulse
 *  speed at each loop point) so a tiled pattern's own seamless restart
 *  actually reads as unbroken continuous motion. */
export function useAnimatedBg(
  enabled: boolean,
  bgRef: RefObject<HTMLElement | null>,
  style: AnimatedBgStyle | null,
  durationSec: number,
  loopMode: AnimatedBgLoopMode = 'yoyo',
): void {
  useLayoutEffect(() => {
    if (!enabled || !style) return undefined;
    const node = bgRef.current;
    if (!node) return undefined;

    // A style whose `to` isn't pixel-identical to `from` (see
    // AnimatedBgStyle's own `loopSafe` doc comment) can't honor 'loop' mode
    // without a visible jump at every restart — silently falls back to
    // 'yoyo' instead, which never jumps (it always ends exactly where it
    // began), rather than ever actually producing a stitch-cut.
    const effectiveMode = loopMode === 'loop' && !style.loopSafe ? 'yoyo' : loopMode;

    const { prop, from, to } = style.animate;
    gsap.set(node, { [prop]: from });
    const tween = gsap.to(node, {
      [prop]: to,
      duration: effectiveMode === 'yoyo' ? Math.max(0.5, durationSec) / 2 : Math.max(0.5, durationSec),
      ease: effectiveMode === 'loop' ? 'none' : 'sine.inOut',
      repeat: effectiveMode === 'once' ? 0 : -1,
      yoyo: effectiveMode === 'yoyo',
    });
    return () => {
      tween.kill();
      gsap.set(node, { clearProps: prop });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, bgRef, style?.animate.prop, style?.animate.from, style?.animate.to, style?.loopSafe, durationSec, loopMode]);
}
