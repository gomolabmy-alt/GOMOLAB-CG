import { useRef } from 'react';
import { gradientHandlePosition, gradientFromHandleDrag } from '../lib/cgGradient';
import type { CgGradient } from '../types/canvas';

interface Props {
  gradient: CgGradient;
  w: number;
  h: number;
  /** Same delta-conversion role as TemplateElementWrapper.tsx's own zoom
   *  prop — drag deltas arrive in screen pixels, but the handle's position
   *  lives in the canvas's own (unscaled) coordinate space. */
  zoom: number;
  onGestureStart: () => void;
  onGestureEnd: () => void;
  onChange: (v: CgGradient) => void;
}

// A single draggable dot, rendered by TemplateElementWrapper.tsx as a
// sibling alongside its own delete button/resize handle (inside the
// `selected && (...)` block, NOT through the generic `children` prop, which
// renders inside `.tpl-el-body` and would inherit its own overflow:hidden/
// pointer-events:none) — lets an operator set a gradient's anchor point
// (radial: center; linear: direction) by dragging right on the element,
// instead of only typing numbers into ColorOrGradientPicker.tsx. Pointer
// handling mirrors TemplateElementWrapper's own drag exactly (stopPropagation
// + setPointerCapture so a fast drag can't fall out of the small hit area or
// bubble into starting a whole-element drag / deselecting via the canvas
// background), same screen-to-canvas `/zoom` delta conversion.
export function GradientAnchorHandle({ gradient, w, h, zoom, onGestureStart, onGestureEnd, onChange }: Props) {
  const dragRef = useRef<{ sx: number; sy: number; startPos: { x: number; y: number } } | null>(null);
  const pos = gradientHandlePosition(gradient, w, h);

  const onDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    onGestureStart();
    dragRef.current = { sx: e.clientX, sy: e.clientY, startPos: pos };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const hx = Math.max(0, Math.min(w, d.startPos.x + (e.clientX - d.sx) / zoom));
    const hy = Math.max(0, Math.min(h, d.startPos.y + (e.clientY - d.sy) / zoom));
    onChange(gradientFromHandleDrag(gradient, w, h, hx, hy));
  };
  const onUp = (e: React.PointerEvent) => {
    e.stopPropagation();
    dragRef.current = null;
    onGestureEnd();
  };

  const cx = w / 2;
  const cy = h / 2;

  return (
    <>
      {gradient.type === 'linear' && (
        <div
          className="tpld-gradient-line"
          style={{
            left: cx,
            top: cy,
            width: Math.hypot(pos.x - cx, pos.y - cy),
            transform: `rotate(${Math.atan2(pos.y - cy, pos.x - cx)}rad)`,
          }}
        />
      )}
      <div
        className="tpld-gradient-handle"
        style={{ left: pos.x, top: pos.y }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        title={gradient.type === 'radial' ? 'Drag to move the gradient center' : 'Drag to set the gradient direction'}
      />
    </>
  );
}
