import { Plus, X } from 'lucide-react';
import { isGradient, gradientToCss } from '../lib/cgGradient';
import type { CgGradient } from '../types/canvas';
import { ColorPicker } from './ColorPicker';

interface Props {
  value: string | CgGradient | undefined;
  onChange: (v: string | CgGradient) => void;
  /** Used as the color input's value (and the seed for "switch to
   *  Gradient") when `value` is undefined. */
  fallback: string;
}

// Drop-in replacement for a plain <input type="color"> wherever a
// fill/bgColor/color config field lives — Solid mode is exactly that same
// input; Gradient mode edits a CgGradient (type/angle/stops) in place.
// Every renderer (CgTemplateWidget.tsx, CgTemplateDesigner.tsx's
// ElementPreview) resolves the resulting value via lib/cgGradient.ts.
export function ColorOrGradientPicker({ value, onChange, fallback }: Props) {
  const gradient = isGradient(value) ? value : null;
  const solidValue = typeof value === 'string' ? value : fallback;

  const toSolid = () => onChange(gradient?.stops[0]?.color ?? solidValue);
  const toGradient = () => onChange({
    type: 'linear',
    angle: 90,
    stops: [{ color: solidValue, offset: 0 }, { color: '#ffffff', offset: 100 }],
  });

  const updateGradient = (patch: Partial<CgGradient>) => { if (gradient) onChange({ ...gradient, ...patch }); };
  const updateStop = (i: number, patch: Partial<CgGradient['stops'][number]>) => {
    if (!gradient) return;
    updateGradient({ stops: gradient.stops.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) });
  };
  const addStop = () => gradient && updateGradient({ stops: [...gradient.stops, { color: '#ffffff', offset: 50 }] });
  const removeStop = (i: number) => {
    if (!gradient || gradient.stops.length <= 2) return;
    updateGradient({ stops: gradient.stops.filter((_, idx) => idx !== i) });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
      <div style={{ display: 'flex', gap: 4 }}>
        <button type="button" className={`tpld-tool-btn${!gradient ? ' tpld-tool-btn--active' : ''}`} onClick={toSolid}>Solid</button>
        <button type="button" className={`tpld-tool-btn${gradient ? ' tpld-tool-btn--active' : ''}`} onClick={toGradient}>Gradient</button>
      </div>

      {!gradient ? (
        <ColorPicker value={solidValue} onChange={onChange} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ width: '100%', height: 20, borderRadius: 4, background: gradientToCss(gradient), border: '1px solid var(--border)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <select className="field-input" value={gradient.type} onChange={(e) => updateGradient({ type: e.target.value as 'linear' | 'radial' })}>
              <option value="linear">Linear</option>
              <option value="radial">Radial</option>
            </select>
            {gradient.type === 'linear' && (
              <input type="number" className="field-input" style={{ width: 56 }} value={gradient.angle ?? 90}
                onChange={(e) => updateGradient({ angle: Number(e.target.value) || 0 })} title="Angle (degrees) — or drag the orange dot on the element itself" />
            )}
          </div>
          {gradient.type === 'radial' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Center</span>
              <input type="number" className="field-input" style={{ width: 52 }} min={0} max={100} value={Math.round(gradient.cx ?? 50)}
                onChange={(e) => updateGradient({ cx: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} title="Center X% — or drag the orange dot on the element itself" />
              <input type="number" className="field-input" style={{ width: 52 }} min={0} max={100} value={Math.round(gradient.cy ?? 50)}
                onChange={(e) => updateGradient({ cy: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} title="Center Y%" />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>%</span>
            </div>
          )}
          {gradient.stops.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <ColorPicker value={s.color} onChange={(v) => updateStop(i, { color: v })} />
              <input type="number" className="field-input" style={{ width: 56 }} min={0} max={100} value={s.offset}
                onChange={(e) => updateStop(i, { offset: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>%</span>
              <button type="button" className="tplt-track-remove" disabled={gradient.stops.length <= 2} onClick={() => removeStop(i)} title="Remove stop">
                <X size={11} strokeWidth={2} />
              </button>
            </div>
          ))}
          <button type="button" className="cgo-copy-btn" onClick={addStop}><Plus size={12} strokeWidth={2} /> Stop</button>
        </div>
      )}
    </div>
  );
}
