// "Variables"/conditions — a live "if this value..." rule watching some
// OTHER widget's own bindable field (the same catalog/sourceWidgetId+key
// shape TemplateElementBinding already uses for CONTENT bindings — see
// lib/templateBinding.ts) and reacting to it: hide/show this element, or
// fire a one-shot animation, entirely on its own. See TemplateElement's own
// doc comment on `conditions` and lib/useElementConditions.ts for how this
// actually gets applied.
import type { CanvasPage, ElementCondition } from '../types/canvas';
import { resolveBindingValue } from './templateBinding';

/** Turns whatever string a binding resolves to into a real number to
 *  compare against a threshold. Plain numeric text ("0", "3", "12.5")
 *  parses directly. A Timer/Countdown's own formatted "mm:ss" or
 *  "hh:mm:ss" display (see templateBinding.ts's own TIMER_PARTS resolver)
 *  is NOT a bare number — parseFloat("02:45") would silently return 2, not
 *  165 seconds, which is exactly wrong for a "hide once the clock hits
 *  zero" condition — so this recognizes that shape specifically and
 *  converts it to total seconds first. Anything else unparseable is 0. */
export function parseConditionNumber(raw: string): number {
  const trimmed = raw.trim();
  const direct = Number(trimmed);
  if (Number.isFinite(direct) && trimmed !== '') return direct;
  const timeMatch = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(trimmed);
  if (timeMatch) {
    const [, a, b, c] = timeMatch;
    // Two groups = mm:ss, three = hh:mm:ss.
    return c !== undefined ? Number(a) * 3600 + Number(b) * 60 + Number(c) : Number(a) * 60 + Number(b);
  }
  return 0;
}

/** Resolves one condition's own CURRENT watched value — live via its
 *  binding, or the fixed `staticValue` when unbound. */
export function resolveConditionValue(pages: CanvasPage[], condition: ElementCondition): number {
  if (!condition.binding?.sourceWidgetId) return condition.staticValue ?? 0;
  return parseConditionNumber(resolveBindingValue(pages, condition.binding));
}

export function evaluateConditionOperator(current: number, operator: ElementCondition['operator'], threshold: number): boolean {
  switch (operator) {
    case 'eq': return current === threshold;
    case 'neq': return current !== threshold;
    case 'gt': return current > threshold;
    case 'gte': return current >= threshold;
    case 'lt': return current < threshold;
    case 'lte': return current <= threshold;
  }
}

/** True/false for one condition right now — the one function both the
 *  visibility side and the animate-trigger side of
 *  lib/useElementConditions.ts actually call. */
export function evaluateCondition(pages: CanvasPage[], condition: ElementCondition): boolean {
  return evaluateConditionOperator(resolveConditionValue(pages, condition), condition.operator, condition.value);
}

export const CONDITION_OPERATOR_LABELS: Record<ElementCondition['operator'], string> = {
  eq: '= equals',
  neq: '≠ not equals',
  gt: '> greater than',
  gte: '≥ at least',
  lt: '< less than',
  lte: '≤ at most',
};
