import { useRef } from 'react';

// A drag-a-curve bezier ease editor, AE/CSS-devtools style — two draggable
// control-point handles hanging off the fixed corners (0,0)→(1,1), each
// dragged independently. `value`/`onChange` are the same 4 numbers
// lib/easeUtils.ts's bezierEaseString/parseBezierEase read and write, so
// this component never needs to know it's ultimately feeding GSAP.
const PAD = 84;
const MARGIN = 18;
const SIZE = PAD + MARGIN * 2;

export function EaseCurveEditor({ value, onChange }: {
  value: [number, number, number, number];
  onChange: (v: [number, number, number, number]) => void;
}) {
  const [x1, y1, x2, y2] = value;
  const svgRef = useRef<SVGSVGElement>(null);
  const draggingRef = useRef<1 | 2 | null>(null);

  const toX = (x: number) => x * PAD;
  const toY = (y: number) => MARGIN + (1 - y) * PAD;
  // y is deliberately allowed a bit outside [0,1] — that's what makes an
  // "overshoot"/anticipation curve draggable at all, matching AE.
  const fromClient = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / PAD));
    const y = Math.max(-0.5, Math.min(1.5, (MARGIN + PAD - (clientY - rect.top)) / PAD));
    return { x, y };
  };

  const onDown = (which: 1 | 2) => (e: React.PointerEvent) => {
    e.stopPropagation();
    draggingRef.current = which;
    (e.currentTarget as SVGCircleElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const which = draggingRef.current;
    if (!which) return;
    const { x, y } = fromClient(e.clientX, e.clientY);
    if (which === 1) onChange([Number(x.toFixed(3)), Number(y.toFixed(3)), x2, y2]);
    else onChange([x1, y1, Number(x.toFixed(3)), Number(y.toFixed(3))]);
  };
  const onUp = () => { draggingRef.current = null; };

  const p0 = { x: toX(0), y: toY(0) };
  const p3 = { x: toX(1), y: toY(1) };
  const h1 = { x: toX(x1), y: toY(y1) };
  const h2 = { x: toX(x2), y: toY(y2) };

  return (
    <svg ref={svgRef} width={PAD} height={SIZE} className="ease-curve-editor" onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
      <rect x={0} y={MARGIN} width={PAD} height={PAD} className="ease-curve-box" />
      <line x1={p0.x} y1={p0.y} x2={h1.x} y2={h1.y} className="ease-curve-handle-line" />
      <line x1={p3.x} y1={p3.y} x2={h2.x} y2={h2.y} className="ease-curve-handle-line" />
      <path d={`M${p0.x},${p0.y} C${h1.x},${h1.y} ${h2.x},${h2.y} ${p3.x},${p3.y}`} className="ease-curve-path" />
      <circle cx={p0.x} cy={p0.y} r={2.5} className="ease-curve-anchor" />
      <circle cx={p3.x} cy={p3.y} r={2.5} className="ease-curve-anchor" />
      <circle cx={h1.x} cy={h1.y} r={5} className="ease-curve-handle" onPointerDown={onDown(1)} />
      <circle cx={h2.x} cy={h2.y} r={5} className="ease-curve-handle" onPointerDown={onDown(2)} />
    </svg>
  );
}
