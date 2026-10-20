import { useRef } from 'react';

type Vec3 = [number, number, number];

interface Props {
  rotateX: number;
  rotateY: number;
  onChange: (rotateX: number, rotateY: number) => void;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
  size?: number;
  title?: string;
}

const AXES: { v: Vec3; label: string; color: string }[] = [
  { v: [1, 0, 0], label: 'X', color: '#e0524f' },
  { v: [-1, 0, 0], label: '', color: '#e0524f' },
  { v: [0, 1, 0], label: 'Y', color: '#5cb853' },
  { v: [0, -1, 0], label: '', color: '#5cb853' },
  { v: [0, 0, 1], label: 'Z', color: '#4a90e2' },
  { v: [0, 0, -1], label: '', color: '#4a90e2' },
];

/** Rotates a unit vector by rotateX/rotateY degrees using the exact same
 *  `rotateX(...) rotateY(...)` composition order this app's own CSS
 *  transform strings already use everywhere (buildStaticTransform3D, the
 *  3D World transform) — so a dot's projected position always visually
 *  agrees with what dragging these same two numbers actually does to real
 *  content, rather than the gizmo silently using its own, different
 *  convention. */
function rotateVec([x, y, z]: Vec3, rxDeg: number, ryDeg: number): Vec3 {
  const ry = (ryDeg * Math.PI) / 180;
  const rx = (rxDeg * Math.PI) / 180;
  const x1 = x * Math.cos(ry) + z * Math.sin(ry);
  const y1 = y;
  const z1 = -x * Math.sin(ry) + z * Math.cos(ry);
  const y2 = y1 * Math.cos(rx) - z1 * Math.sin(rx);
  const z2 = y1 * Math.sin(rx) + z1 * Math.cos(rx);
  return [x1, y2, z2];
}

// Canonical rotateX/rotateY for snapping straight down one axis — clicking
// a dot jumps to that exact view, the same shortcut Blender's own gizmo
// dots give (click +Z/-Y/etc. for an instant front/top/side view instead
// of dragging to eyeball it).
const AXIS_VIEW: Record<string, { x: number; y: number }> = {
  '1,0,0': { x: 0, y: -90 },
  '-1,0,0': { x: 0, y: 90 },
  '0,1,0': { x: -90, y: 0 },
  '0,-1,0': { x: 90, y: 0 },
  '0,0,1': { x: 0, y: 0 },
  '0,0,-1': { x: 0, y: 180 },
};

// A small "orbit ball" modeled on Blender's own viewport gizmo — a sphere
// with 6 axis dots (X red, Y green, Z blue, matching Blender's own color
// convention) that visibly rotate as the view orbits, each clickable to
// snap straight to that axis's view; dragging anywhere else on the ball
// orbits freely, same two gestures Blender's gizmo offers. Purely a
// rotateX/rotateY in-and-out control — callers own what those two numbers
// actually mean (a single element's own static pose, or the whole canvas's
// "3D World" camera), this component only draws the ball and reports drags/
// clicks back through `onChange`.
export function BlenderOrbitBall({ rotateX, rotateY, onChange, onGestureStart, onGestureEnd, size = 56, title }: Props) {
  const dragRef = useRef<{ sx: number; sy: number; startX: number; startY: number } | null>(null);

  const onBallDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    onGestureStart?.();
    dragRef.current = { sx: e.clientX, sy: e.clientY, startX: rotateX, startY: rotateY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onBallMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    const nextY = Math.max(-179, Math.min(179, d.startY + dx * 0.4));
    const nextX = Math.max(-89, Math.min(89, d.startX - dy * 0.4));
    onChange(nextX, nextY);
  };
  const onBallUp = (e: React.PointerEvent) => {
    e.stopPropagation();
    dragRef.current = null;
    onGestureEnd?.();
  };
  const snapTo = (e: React.MouseEvent, view: { x: number; y: number } | undefined) => {
    e.stopPropagation();
    if (!view) return;
    onGestureStart?.();
    onChange(view.x, view.y);
    onGestureEnd?.();
  };

  const radius = size / 2;
  const dotR = Math.max(4, Math.round(size * 0.11));
  const travel = radius - dotR - 1;

  return (
    <div
      className="tpld-blender-gizmo"
      style={{ width: size, height: size }}
      onPointerDown={onBallDown}
      onPointerMove={onBallMove}
      onPointerUp={onBallUp}
      onDoubleClick={(e) => { e.stopPropagation(); onGestureStart?.(); onChange(0, 0); onGestureEnd?.(); }}
      title={title ?? 'Drag to orbit — click a dot to snap to that view — double-click to reset'}
    >
      <div className="tpld-blender-gizmo-ball" />
      {AXES.map((axis) => {
        const [rx, ry, rz] = rotateVec(axis.v, rotateX, rotateY);
        const front = rz >= -0.01;
        const left = radius + rx * travel - dotR;
        const top = radius - ry * travel - dotR;
        const view = AXIS_VIEW[axis.v.join(',')];
        return (
          <div
            key={axis.v.join(',')}
            className={`tpld-blender-gizmo-dot${front ? ' tpld-blender-gizmo-dot--front' : ' tpld-blender-gizmo-dot--back'}`}
            style={{
              left, top, width: dotR * 2, height: dotR * 2,
              background: front ? axis.color : 'transparent',
              borderColor: axis.color,
              zIndex: front ? 2 : 1,
              fontSize: Math.max(7, dotR),
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => snapTo(e, view)}
            title={axis.label ? `${axis.label} view` : undefined}
          >
            {axis.label}
          </div>
        );
      })}
    </div>
  );
}
