import { useEffect, useRef, type RefObject } from 'react';
import { gsap } from 'gsap';
import type { CanvasPage, ElementCondition } from '../types/canvas';
import { evaluateCondition } from './elementCondition';
import { PRESETS, restValueForPresetProp } from './cgPresets';

/** Applies an element's own `conditions` (see TemplateElement's own doc
 *  comment) to `wrapperRef`'s node — a DEDICATED div this element renders
 *  inside of only when at least one condition exists (see
 *  CgTemplateWidget.tsx's/CgTemplateDesigner.tsx's own 'conditions' branch),
 *  never the same node the in/loop/out state machine itself animates —
 *  the two systems would otherwise fight over the same opacity/visibility
 *  property on one node, same reason `filter` is kept off the state-
 *  machine's own ref elsewhere in this app.
 *
 *  Re-evaluated on every render (cheap — a handful of string/number
 *  comparisons) PLUS a plain 1s poll while any condition is actually bound
 *  live, same reasoning lib/templateBinding.ts's own hasLiveBinding poll
 *  already has (a source ticking purely off Date.now(), with nothing in
 *  the store itself changing, wouldn't otherwise trigger a re-check the
 *  moment it crosses a threshold).
 *
 *  Visibility rule when multiple conditions are present: ANY currently-true
 *  'hide' condition wins (element hidden) over everything else; failing
 *  that, if any 'show' conditions exist, the element is visible only when
 *  at least one of THEM is true (hidden by default otherwise); with
 *  neither kind present (only 'animate' conditions, or none at all) the
 *  element stays visible. 'animate' conditions never affect visibility —
 *  they only ever fire a one-shot preset animation on their own false→true
 *  edge, tracked independently per condition (by array index) so a
 *  transition is never missed or double-fired across re-renders. */
export function useElementConditions(
  conditions: ElementCondition[] | undefined,
  pages: CanvasPage[],
  wrapperRef: RefObject<HTMLElement | null>,
): void {
  const prevAnimateState = useRef<Record<number, boolean>>({});

  const evaluate = () => {
    const node = wrapperRef.current;
    if (!node || !conditions?.length) return;

    let anyHideTrue = false;
    let anyShowCondition = false;
    let anyShowTrue = false;

    conditions.forEach((condition, i) => {
      const isTrue = evaluateCondition(pages, condition);
      if (condition.action === 'hide' && isTrue) anyHideTrue = true;
      if (condition.action === 'show') {
        anyShowCondition = true;
        if (isTrue) anyShowTrue = true;
      }
      if (condition.action === 'animate') {
        const was = prevAnimateState.current[i] ?? false;
        if (isTrue && !was) {
          // A one-shot fromTo: FROM the preset's own hidden/offset pose TO
          // each of those same properties' natural resting value (the
          // exact same rest-value logic cgPresets.ts's own
          // expandPresetToTracks already uses to turn a preset into real
          // keyframes) — not tied to the in/loop/out state machine at all,
          // just a standalone flash on this node.
          const preset = condition.animatePreset ? PRESETS[condition.animatePreset] : null;
          if (preset && !preset._type) {
            const restState: Record<string, any> = {};
            for (const [prop, fromValue] of Object.entries(preset)) {
              if (prop === 'transformOrigin') { restState[prop] = fromValue; continue; }
              restState[prop] = restValueForPresetProp(prop, fromValue);
            }
            gsap.fromTo(node, { ...preset }, { ...restState, duration: 0.6, ease: 'power2.out' });
          }
        }
        prevAnimateState.current[i] = isTrue;
      }
    });

    const visible = !anyHideTrue && (!anyShowCondition || anyShowTrue);
    const next = visible ? 'visible' : 'hidden';
    if (node.style.visibility !== next) node.style.visibility = next;
  };

  useEffect(() => {
    evaluate();
    const hasLiveBinding = conditions?.some((c) => !!c.binding);
    if (!hasLiveBinding) return undefined;
    const id = setInterval(evaluate, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });
}
