import { useLayoutEffect, useRef, type RefObject } from 'react';
import { gsap } from 'gsap';

/** Resolves one 'statbar' row's own raw value — bound field (any widget,
 *  any numeric-ish bindable field, via the exact same lib/templateBinding.ts
 *  machinery every other bound element already uses) if set, else the
 *  row's static config value, else 50/50 (an even split reads more sensibly
 *  as a "nothing configured yet" default than one side at zero). A binding
 *  that resolves to something non-numeric (an empty/missing field) falls
 *  back to 0 rather than NaN propagating into the percentage math below. */
export function resolveStatbarValue(bound: string | undefined, staticValue: number | undefined): number {
  if (bound !== undefined) {
    const n = parseFloat(bound);
    return Number.isFinite(n) ? n : 0;
  }
  return staticValue ?? 50;
}

/** valueA:valueB -> the percentage side A's own segment should occupy —
 *  side B is never computed separately, it's simply `flex: 1` filling
 *  whatever side A's explicit width leaves behind (see
 *  TemplateElementView's/ElementPreview's own 'statbar' branch), so the two
 *  always sum to exactly 100% with no separate rounding/sync concern. Both
 *  sides at 0 (nothing to compare yet) reads as an even split, not a
 *  divide-by-zero blank bar. */
export function statbarPercentA(valueA: number, valueB: number): number {
  const total = valueA + valueB;
  return total > 0 ? (valueA / total) * 100 : 50;
}

/** Curated GSAP eases offered in the inspector's "Animation" dropdown — a
 *  small, broadcast-sensible subset of the full GSAP ease library rather
 *  than every named ease GSAP ships (CustomEase/EasePack extras, etc.),
 *  same "curated list, not the whole library" treatment
 *  lib/cgFonts.ts's GOOGLE_FONTS already gets. Every value here is a plain
 *  ease-string GSAP's own core parses natively — no plugin import needed,
 *  including the parameterized ones (e.g. "back.out(1.7)" is standard GSAP
 *  ease-string syntax, equivalent to the object form `Back.easeOut.config(1.7)`). */
export const STATBAR_EASE_OPTIONS: { value: string; label: string }[] = [
  { value: 'power2.out', label: 'Smooth (default)' },
  { value: 'power1.out', label: 'Soft' },
  { value: 'power3.out', label: 'Snappy' },
  { value: 'expo.out', label: 'Sharp' },
  { value: 'circ.out', label: 'Circular' },
  { value: 'sine.out', label: 'Gentle' },
  { value: 'back.out(1.7)', label: 'Overshoot' },
  { value: 'elastic.out(1,0.5)', label: 'Elastic' },
  { value: 'bounce.out', label: 'Bounce' },
  { value: 'linear', label: 'Linear (no ease)' },
];

/** Animates every row's bar segment `width` smoothly to its new percentage
 *  whenever it changes, instead of snapping — a possession/stat bar reads
 *  as "the split shifting", not a value-change transition the way text/
 *  image's own CgChangeAnim is for theirs, so this is unconditional, not a
 *  configurable per-row preset (only the ease itself, shared across every
 *  row on the element, is configurable — see STATBAR_EASE_OPTIONS above).
 *
 *  One hook call handles EVERY row on the element (not one call per row) —
 *  a statbar's row count is operator-editable at any time, and React's
 *  rules of hooks forbid a variable number of hook calls, so this takes the
 *  whole rows list at once and loops internally instead of the "call a
 *  per-kind hook once, unconditionally" pattern every other shared hook in
 *  this app uses.
 *
 *  Both `nodesRef` and the "what did this row show last" tracking below are
 *  keyed by each row's own `id`, NOT array position — deleting row 0 shifts
 *  every later row's INDEX without changing its identity, and indexing this
 *  positionally would misattribute the deleted row's last-known percentage
 *  to whatever row now happens to occupy that same slot, animating a bogus
 *  transition into it on its very next real change instead of recognizing
 *  it as a row that's never been shown before.
 *
 *  The very first render of a given row (by id) snaps instantly (nothing to
 *  animate FROM yet) — only genuine subsequent changes to that SAME row
 *  tween. Shared by CgTemplateWidget.tsx's real output and
 *  CgTemplateDesigner.tsx's own preview, one call each, same relationship
 *  every other per-kind hook in this app already has between those two
 *  files. */
export function useStatbarRowTweens(
  nodesRef: RefObject<Record<string, HTMLElement | null>>,
  rows: { id: string; pct: number }[],
  ease: string
): void {
  const prevRef = useRef<Record<string, number>>({});
  const pctsKey = rows.map((r) => `${r.id}:${r.pct}`).join(',');
  useLayoutEffect(() => {
    const liveIds = new Set(rows.map((r) => r.id));
    for (const { id, pct } of rows) {
      const node = nodesRef.current?.[id];
      if (!node) continue;
      const prev = prevRef.current[id];
      if (prev === undefined) {
        node.style.width = `${pct}%`;
        prevRef.current[id] = pct;
        continue;
      }
      if (prev === pct) continue;
      prevRef.current[id] = pct;
      gsap.to(node, { width: `${pct}%`, duration: 0.6, ease });
    }
    // Forget deleted rows — otherwise a NEW row that later reuses a
    // coincidentally-equal id (never happens with crypto.randomUUID, but
    // this is the cheap-to-keep-correct thing to do regardless) would read
    // as "unchanged" against a value it never actually displayed.
    for (const id of Object.keys(prevRef.current)) {
      if (!liveIds.has(id)) delete prevRef.current[id];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pctsKey, ease]);
}
