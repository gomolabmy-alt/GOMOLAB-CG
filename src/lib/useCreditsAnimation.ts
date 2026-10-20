import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { gsap } from 'gsap';
import { registerReliableTick } from '../stores/canvasStore';
import { PRESETS, OUT_PRESETS, restValueForPresetProp } from './cgPresets';
import type { TemplateElement } from '../types/canvas';

/** Drives a kind:'credits' element's own animation — shared by
 *  CgTemplateWidget.tsx's real output and CgTemplateDesigner.tsx's preview,
 *  one call each, same "one hook, called identically from both renderers"
 *  convention as useAnimatedBg/useFlagWave/useTickerScroll. Self-contained
 *  and always running the moment the element mounts, same as those — an
 *  end-credits roll isn't something an operator authors an in/loop/out
 *  entrance for, it just plays.
 *
 *  'scroll' mode: `scrollContentRef` (one node containing EVERY section
 *  laid out in a single strip — a column for `config.scrollDirection`
 *  'vertical', the default, or a row for 'horizontal'; the caller owns
 *  which via its own flexDirection, this hook just measures+animates
 *  whichever axis matches) is measured for its own natural size along that
 *  axis, then tweened across the element's own box — bottom-to-top
 *  (vertical) or right-to-left (horizontal), see TemplateElement's own doc
 *  comment on the 'credits' kind for the exact field meanings. 'sequence'
 *  mode: `getSectionNode(i)` reads back each
 *  section's own already-rendered (but ordinarily hidden) node — decoupled
 *  from however the caller stores them (a plain array ref, a Record — same
 *  "getter function, not a shared ref shape" convention getElRef/
 *  getFlagWaveRefs already use elsewhere), and this hook itself owns
 *  showing exactly one at a time via `registerReliableTick`, the same
 *  reliable (never throttled by a backgrounded window) advance timer
 *  'imagePlaylist'/'cardCarousel' already use for their own slideshow. */
export function useCreditsAnimation(
  enabled: boolean,
  el: TemplateElement,
  containerW: number,
  containerH: number,
  scrollContentRef: RefObject<HTMLElement | null>,
  getSectionNode: (index: number) => HTMLElement | null | undefined,
  sectionCount: number,
): void {
  const mode = el.config.mode ?? 'scroll';
  const direction: 'vertical' | 'horizontal' = el.config.scrollDirection ?? 'vertical';
  const tickInstanceIdRef = useRef(Math.random().toString(36).slice(2));

  // ── 'scroll' — one continuous crawl, bottom-to-top or right-to-left ────
  useLayoutEffect(() => {
    if (!enabled || mode !== 'scroll') return;
    const content = scrollContentRef.current;
    if (!content) return;
    const vertical = direction !== 'horizontal';
    const containerSize = vertical ? containerH : containerW;
    const contentSize = vertical ? content.offsetHeight : content.offsetWidth;
    if (contentSize <= 0) return;
    const speed = el.config.scrollSpeed > 0 ? el.config.scrollSpeed : 60;
    const loop = el.config.loop ?? true;
    const travel = containerSize + contentSize;
    const prop = vertical ? 'y' : 'x';
    gsap.killTweensOf(content);
    gsap.set(content, { [prop]: containerSize, ...(vertical ? { x: 0 } : { y: 0 }) });
    const tween = gsap.to(content, { [prop]: -contentSize, duration: travel / speed, ease: 'none', repeat: loop ? -1 : 0 });
    return () => { tween.kill(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, mode, direction, containerW, containerH, el.config.scrollSpeed, el.config.loop, sectionCount, JSON.stringify(el.config.sections)]);

  // ── 'sequence' — one section at a time, any preset transition ─────────
  const advanceRef = useRef<() => void>(() => {});
  const currentIndexRef = useRef(0);
  advanceRef.current = () => {
    if (sectionCount === 0) return;
    const presetName = el.config.transitionPreset ?? 'fadeIn';
    const duration = el.config.transitionDuration ?? 0.6;
    const ease = el.config.transitionEase ?? 'power2.inOut';
    const loop = el.config.loop ?? true;
    const inCfg = PRESETS[presetName] ?? PRESETS.fadeIn;
    const outCfg = OUT_PRESETS[presetName] ?? OUT_PRESETS.fadeOut;
    const curIdx = currentIndexRef.current;
    const nextIdx = curIdx + 1;
    if (nextIdx >= sectionCount && !loop) return; // hold on the last section
    const targetIdx = nextIdx % sectionCount;
    if (targetIdx === curIdx) return; // only one section — nothing to advance to
    const curNode = getSectionNode(curIdx);
    const nextNode = getSectionNode(targetIdx);
    if (curNode) gsap.to(curNode, { ...outCfg, duration, ease });
    if (nextNode) {
      gsap.set(nextNode, { clearProps: 'opacity,transform,filter,clipPath' });
      const restState: Record<string, any> = { duration, ease };
      for (const [prop, fromValue] of Object.entries(inCfg)) {
        if (prop === '_type' || prop === 'transformOrigin') continue;
        restState[prop] = restValueForPresetProp(prop, fromValue as any);
      }
      gsap.fromTo(nextNode, { ...inCfg }, restState);
    }
    currentIndexRef.current = targetIdx;
  };

  // Pose every section at rest except the first the moment sequence mode
  // (re)starts — mirrors 'imagePlaylist' /'cardCarousel' always resetting
  // to their own first slide on a fresh mount/config change, so re-editing
  // sections in the Designer doesn't leave stale mid-transition poses
  // behind.
  useLayoutEffect(() => {
    if (!enabled || mode !== 'sequence') return;
    currentIndexRef.current = 0;
    for (let i = 0; i < sectionCount; i++) {
      const node = getSectionNode(i);
      if (!node) continue;
      gsap.killTweensOf(node);
      gsap.set(node, i === 0 ? { clearProps: 'opacity,transform,filter,clipPath' } : { opacity: 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, mode, sectionCount, JSON.stringify(el.config.sections)]);

  useEffect(() => {
    if (!enabled || mode !== 'sequence' || sectionCount < 2) return;
    const ms = Math.max(500, (el.config.slideDuration ?? 3) * 1000);
    return registerReliableTick(`credits:${el.id}:${tickInstanceIdRef.current}`, ms, () => advanceRef.current());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, mode, sectionCount, el.config.slideDuration, el.id]);
}
