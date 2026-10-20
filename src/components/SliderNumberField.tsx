// A range slider paired with the same numeric field it drives — either one
// edits the exact same value, so an operator can drag for a quick "by feel"
// adjustment or click into the number for an exact one, without picking
// between the two ahead of time. Drop-in replacement for a bare
// `<input className="field-input" type="number" .../>` wherever the value
// has a genuine bounded range (every Effect parameter in
// ElementPropertiesPanel.tsx does) — `onChange` receives the plain numeric
// value already, so existing clamp/round logic at each call site is
// unchanged, just fed from here instead of `Number(e.target.value)`.
interface Props {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}

export function SliderNumberField({ value, min, max, step = 1, onChange }: Props) {
  // Keeps the slider thumb somewhere sane (rather than snapping to whichever
  // end is closer) if `value` is ever outside [min, max] — e.g. a template
  // authored before this field's own range existed/changed, or a keyframe
  // value nudged past it by hand.
  const clamped = Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  return (
    <div className="field-slidernum">
      <input
        className="field-slidernum-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={clamped}
        onChange={(e) => onChange(e.target.valueAsNumber)}
      />
      <input
        className="field-input field-slidernum-number"
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
