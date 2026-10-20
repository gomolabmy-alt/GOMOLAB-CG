import { useLayoutEffect, useRef } from 'react';

/**
 * Lightweight FLIP-style reorder animation for a plain keyed list (a
 * standings table, anything else where rows re-sort by rank/position) —
 * no animation library needed. React's own keyed reconciliation already
 * moves each row's DOM node to its new spot when the sorted array changes;
 * this just notices that move after it happens and animates it away with a
 * transform, instead of letting it snap straight to the new position.
 *
 * Usage: attach the returned ref to the rows' CONTAINER element, and give
 * each row `data-flip-key={someStableId}` (e.g. a team id) — nothing else
 * needs to change, rows can keep whatever layout (flex column, grid, …)
 * they already use.
 */
export function useReorderAnimation<T extends HTMLElement = HTMLDivElement>(
  durationMs = 350,
) {
  const containerRef = useRef<T>(null);
  const prevRects = useRef<Map<string, DOMRect>>(new Map());

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const rows = container.querySelectorAll<HTMLElement>('[data-flip-key]');
    const prev = prevRects.current;
    const next = new Map<string, DOMRect>();

    rows.forEach(row => {
      const key = row.dataset.flipKey;
      if (!key) return;
      const newRect = row.getBoundingClientRect();
      next.set(key, newRect);
      const oldRect = prev.get(key);
      if (!oldRect) return; // first time this row's been seen — nothing to animate from
      const dy = oldRect.top - newRect.top;
      if (Math.abs(dy) < 0.5) return; // didn't actually move (a stat changed but rank didn't)
      row.style.transition = 'none';
      row.style.transform = `translateY(${dy}px)`;
      // Forces the browser to flush the above BEFORE the transition below is
      // applied — otherwise both style writes can land in the same paint and
      // the "from" position never actually renders, so nothing visibly moves.
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      row.offsetHeight;
      row.style.transition = `transform ${durationMs}ms cubic-bezier(.2,.8,.2,1)`;
      row.style.transform = '';
    });

    prevRects.current = next;
  });

  return containerRef;
}
