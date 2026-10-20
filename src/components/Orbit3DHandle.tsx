import { useEffect, useRef } from 'react';
import { BlenderOrbitBall } from './BlenderOrbitBall';

interface Props {
  w: number;
  h: number;
  rotateX: number;
  rotateY: number;
  /** config.scene3DPerspective — see cgPresets.ts's buildStaticTransform3D.
   *  Scrolling on this handle adjusts it directly (Blender's own orbit
   *  gizmo doubles as a dolly-zoom control the same way — scroll changes
   *  how dramatic the perspective looks without touching rotation at all). */
  perspective: number;
  onGestureStart: () => void;
  onGestureEnd: () => void;
  onChange: (rotateX: number, rotateY: number) => void;
  onPerspectiveChange: (v: number) => void;
}

// Floats a BlenderOrbitBall (the Blender-style orbit ball — drag to orbit,
// click a dot to snap to that axis's view) just above the selected element
// — this wrapper's own job is purely positioning it there and layering on
// the ONE gesture the ball itself doesn't handle: scroll-to-zoom
// (config.scene3DPerspective), Blender's own dolly-zoom gesture on its
// viewport gizmo. Rendered by TemplateElementWrapper.tsx as a sibling
// alongside the delete button/resize handle/gradient handles (inside the
// `selected && (...)` block), only once this element has 3D enabled
// (config.scene3D).
export function Orbit3DHandle({ w, h, rotateX, rotateY, perspective, onGestureStart, onGestureEnd, onChange, onPerspectiveChange }: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);
  // Coalesces a whole scroll SESSION (many rapid wheel ticks in quick
  // succession, the normal shape of one trackpad/wheel gesture) into a
  // single undo step, the same way a drag's onGestureStart/End already
  // does for a whole pointer-down-to-up — without this, every individual
  // wheel tick would push its own undo entry (CgTemplateDesigner.tsx's
  // commitElements pushes history on every call unless a gesture is
  // already open), and Ctrl/Cmd+Z would only crawl back one tiny increment
  // at a time instead of undoing "that whole zoom".
  const wheelSessionRef = useRef<number | null>(null);
  // Always-current props for the native listener below, which (being
  // attached once on mount) would otherwise close over stale first-render
  // values — plain per-render assignment, no effect needed just for this.
  const latest = useRef({ perspective, onPerspectiveChange, onGestureStart, onGestureEnd });
  latest.current = { perspective, onPerspectiveChange, onGestureStart, onGestureEnd };

  // A REAL (non-React) wheel listener, registered non-passive — React (like
  // every modern browser's own default) treats wheel listeners as passive,
  // where calling preventDefault() is silently ignored and logs a console
  // warning rather than actually blocking the page/canvas's own scroll
  // underneath this handle. This is the one gesture here that genuinely
  // needs that: without it, scrolling to "zoom" also scrolls
  // .tpld-canvas-wrap out from under the cursor at the same time.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const { perspective, onPerspectiveChange, onGestureStart, onGestureEnd } = latest.current;
      if (wheelSessionRef.current == null) onGestureStart();
      else window.clearTimeout(wheelSessionRef.current);
      wheelSessionRef.current = window.setTimeout(() => {
        onGestureEnd();
        wheelSessionRef.current = null;
      }, 300);
      // Scrolling "up"/away (negative deltaY) dollies in — a SMALLER
      // perspective value, same convention scene3DPerspective's own
      // Inspector field already uses (smaller = more dramatic/closer,
      // larger = flatter/further), clamped to a sane range.
      onPerspectiveChange(Math.max(150, Math.min(3000, perspective + e.deltaY * 2)));
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  return (
    <div ref={elRef} className="tpld-orbit3d-handle" style={{ left: w / 2, top: -60 }}>
      <BlenderOrbitBall
        rotateX={rotateX}
        rotateY={rotateY}
        onChange={onChange}
        onGestureStart={onGestureStart}
        onGestureEnd={onGestureEnd}
        size={44}
        title="Drag to orbit this element's own 3D pose, scroll to change perspective, click a dot to snap to that view — double-click to reset rotation"
      />
    </div>
  );
}
