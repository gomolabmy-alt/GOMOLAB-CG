import { Clock, ChevronLeft, ChevronRight, Diamond, X } from 'lucide-react';
import { TRACK_PROPERTIES, expandPresetToTracks } from '../lib/cgPresets';
import { EFFECT_LABELS, EFFECT_PARAMS, defaultEffect, effectTrackKey, FRACTAL_GLASS_STYLES } from '../lib/cgEffects';
import type { CgAnimState, CgEffect, CgKeyframe, CgLayerAnim, TemplateElement } from '../types/canvas';
import type { SelectedKf } from './CgTemplateTimeline';
import { ColorPicker } from './ColorPicker';
import { SliderNumberField } from './SliderNumberField';

interface Props {
  el: TemplateElement;
  currentState: CgAnimState;
  selectedAnim: CgLayerAnim | null;
  /** PRESETS or OUT_PRESETS, whichever this state actually uses — needed
   *  only to expand a Preset-mode layer into tracks the first time a
   *  stopwatch here is toggled on (see ensureTracksLayer). */
  presetLib: Record<string, any>;
  isOut: boolean;
  onChangeState: (next: CgAnimState) => void;
  onConfigChange: (patch: Record<string, any>) => void;
  /** See CgTemplateDesigner.tsx's priorStatesChain/resolveSeedValue — what a
   *  brand new track should start at (continuing wherever the sequence
   *  already leaves this property) rather than an arbitrary default. */
  getSeedValue: (elementId: string, prop: string, fallback: any) => any;
  playhead: number;
  selectedKf: SelectedKf | null;
  onSelectKeyframe: (kf: SelectedKf | null) => void;
}

// The always-shown "core" Transform rows, same 4 properties After Effects
// always shows for every layer (Position combines x+y into one row here,
// matching AE's own single 2D Position property) — everything else in
// TRACK_PROPERTIES is reachable via "+ Add Property" once needed, rather
// than cluttering every element with 15+ rows it'll almost never touch.
const CORE_PROPS = ['x', 'y', 'scale', 'rotation', 'opacity'];

const PROP_LABELS: Record<string, string> = {
  x: 'Position X', y: 'Position Y', z: 'Z Position', scale: 'Scale', scaleX: 'Scale X', scaleY: 'Scale Y',
  rotation: 'Rotation', rotationX: 'Rotation X', rotationY: 'Rotation Y',
  transformPerspective: 'Perspective', skewX: 'Skew X', skewY: 'Skew Y',
  clipPath: 'Clip Path', filter: 'Filter', width: 'Width', height: 'Height',
  borderRadius: 'Border Radius', backgroundColor: 'Background Color', color: 'Color',
  fontSize: 'Font Size', letterSpacing: 'Letter Spacing', blur: 'Blur (px)', opacity: 'Opacity',
};
const COLOR_PROPS = new Set(['backgroundColor', 'color']);
const STRING_PROPS = new Set(['clipPath', 'filter']);
const IDENTITY_DEFAULTS: Record<string, number> = {
  x: 0, y: 0, z: 0, opacity: 1, scale: 1, scaleX: 1, scaleY: 1,
  rotation: 0, rotationX: 0, rotationY: 0, transformPerspective: 0,
  skewX: 0, skewY: 0, letterSpacing: 0, borderRadius: 0, blur: 0,
};

function defaultForProp(el: TemplateElement, prop: string): any {
  if (prop in IDENTITY_DEFAULTS) return IDENTITY_DEFAULTS[prop];
  if (prop === 'width') return el.w;
  if (prop === 'height') return el.h;
  if (prop === 'fontSize') return el.config.fontSize ?? 14;
  if (COLOR_PROPS.has(prop)) {
    const base = el.config.color ?? el.config.fill ?? el.config.bgColor;
    return typeof base === 'string' ? base : '#ffffff';
  }
  if (prop === 'filter') return 'none';
  if (prop === 'clipPath') return 'none';
  return 0;
}

function kfNavInfo(kfs: CgKeyframe[] | undefined, playhead: number) {
  if (!kfs?.length) return { hasPrev: false, hasNext: false, atExact: false };
  return {
    hasPrev: kfs.some((k) => k.t < playhead - 0.001),
    hasNext: kfs.some((k) => k.t > playhead + 0.001),
    atExact: kfs.some((k) => Math.abs(k.t - playhead) < 0.001),
  };
}

// The AE-style unified property list, replacing the old "Mode: Keyframes ->
// bare tip text, edit tracks in the timeline below" block. Every Transform
// property (core 4 always, the rest via "+ Add Property") and every
// attached Effect's own parameters get an identical stopwatch + value +
// keyframe-nav row here — the SAME CgLayerAnim.tracks map
// CgTemplateTimeline.tsx already renders as draggable diamonds, so a
// keyframe added here shows up there and vice versa; this panel is just a
// second, more AE-familiar view onto the exact same data, not a parallel
// store of its own.
export function ElementPropertiesPanel({ el, currentState, selectedAnim, presetLib, isOut, onChangeState, onConfigChange, getSeedValue, playhead, selectedKf, onSelectKeyframe }: Props) {
  const t = () => Number(playhead.toFixed(2));

  // Guarantees selectedAnim is a real, tracks-mode CgLayerAnim — creating one
  // from scratch if this element has no entry in currentState at all yet, or
  // expanding a Preset-mode layer into real tracks first (same expansion
  // applyPreset itself uses, via the shared expandPresetToTracks — so a
  // preset's OTHER properties survive the switch exactly as they would if
  // the operator had picked the same preset again from the dropdown).
  // Special (_type) presets have nothing to expand — treated as if starting
  // from empty tracks, since mixing e.g. "scramble text" with a manually
  // keyframed property isn't something either system tries to reconcile.
  const ensureTracksLayer = (): CgLayerAnim => {
    if (selectedAnim?.tracks) return selectedAnim;
    const base = {
      id: el.id,
      ...(selectedAnim?.transformOrigin ? { transformOrigin: selectedAnim.transformOrigin } : {}),
      ...(selectedAnim?.contentOverride ? { contentOverride: selectedAnim.contentOverride } : {}),
    };
    if (selectedAnim?.preset) {
      const preset = presetLib[selectedAnim.preset];
      if (preset && !preset._type) {
        const delay = selectedAnim.delay ?? 0;
        const duration = selectedAnim.duration ?? 0.5;
        const ease = selectedAnim.ease ?? 'power2.out';
        return { ...base, tracks: expandPresetToTracks(preset, isOut, delay, duration, ease) };
      }
    }
    return { ...base, tracks: {} };
  };

  const commitLayer = (layer: CgLayerAnim) => {
    const exists = currentState.layers.some((l) => l.id === el.id);
    onChangeState({
      ...currentState,
      layers: exists ? currentState.layers.map((l) => (l.id === el.id ? layer : l)) : [...currentState.layers, layer],
    });
  };

  const nearestValueAtPlayhead = (kfs: CgKeyframe[]) => {
    const before = [...kfs].reverse().find((k) => k.t <= playhead);
    return before ? before.v : kfs[0]?.v;
  };

  const readValue = (prop: string, fallback: any) => {
    const kfs = selectedAnim?.tracks?.[prop];
    if (kfs?.length) return nearestValueAtPlayhead(kfs);
    return getSeedValue(el.id, prop, fallback);
  };

  const setTracks = (patch: Record<string, CgKeyframe[] | undefined>) => {
    const layer = ensureTracksLayer();
    const tracks = { ...layer.tracks };
    Object.entries(patch).forEach(([prop, kfs]) => { if (kfs) tracks[prop] = kfs; else delete tracks[prop]; });
    commitLayer({ ...layer, tracks });
  };

  const toggleStopwatch = (prop: string, fallback: any) => {
    if (selectedAnim?.tracks?.[prop]) { setTracks({ [prop]: undefined }); return; }
    setTracks({ [prop]: [{ t: t(), v: readValue(prop, fallback) }] });
  };

  // Editing the value directly while untracked creates a plain, unanimated
  // single-keyframe track (pinned at t=0 — "when" is moot with nothing else
  // to interpolate against); while tracked with exactly one keyframe, edits
  // that same point in place (still just a static override); with more than
  // one keyframe, edits whichever one already sits exactly at the playhead
  // (the row shows the nav buttons instead of a bare input once that's
  // ambiguous — see PropertyRow below).
  const setValue = (prop: string, value: any, fallback: any) => {
    const kfs = selectedAnim?.tracks?.[prop];
    if (!kfs?.length) { setTracks({ [prop]: [{ t: 0, v: value }] }); return; }
    if (kfs.length === 1) { setTracks({ [prop]: [{ ...kfs[0], v: value }] }); return; }
    const idx = kfs.findIndex((k) => Math.abs(k.t - playhead) < 0.001);
    if (idx >= 0) setTracks({ [prop]: kfs.map((k, i) => (i === idx ? { ...k, v: value } : k)) });
    void fallback;
  };

  const addKeyframeAtPlayhead = (prop: string, fallback: any) => {
    const kfs = selectedAnim?.tracks?.[prop];
    if (!kfs?.length) { toggleStopwatch(prop, fallback); return; }
    const v = nearestValueAtPlayhead(kfs);
    const withoutSameTime = kfs.filter((k) => Math.abs(k.t - playhead) >= 0.001);
    setTracks({ [prop]: [...withoutSameTime, { t: t(), v }].sort((a, b) => a.t - b.t) });
  };

  const gotoKeyframe = (prop: string, dir: -1 | 1) => {
    const kfs = selectedAnim?.tracks?.[prop];
    if (!kfs?.length) return;
    const withIdx = kfs.map((k, i) => ({ k, i })).sort((a, b) => a.k.t - b.k.t);
    const target = dir === 1
      ? withIdx.find((x) => x.k.t > playhead + 0.001)
      : [...withIdx].reverse().find((x) => x.k.t < playhead - 0.001);
    if (target) onSelectKeyframe({ layerId: el.id, prop, idx: target.i });
  };

  // ── Position (x+y paired — see CORE_PROPS's own comment) ──────────────
  const posTracked = !!(selectedAnim?.tracks?.x || selectedAnim?.tracks?.y);
  const xVal = readValue('x', 0);
  const yVal = readValue('y', 0);
  const togglePosition = () => {
    if (posTracked) { setTracks({ x: undefined, y: undefined }); return; }
    setTracks({ x: [{ t: t(), v: xVal }], y: [{ t: t(), v: yVal }] });
  };
  const addPositionKeyframe = () => {
    if (!posTracked) { togglePosition(); return; }
    const xKfs = selectedAnim?.tracks?.x ?? [{ t: 0, v: xVal }];
    const yKfs = selectedAnim?.tracks?.y ?? [{ t: 0, v: yVal }];
    const nextX = [...xKfs.filter((k) => Math.abs(k.t - playhead) >= 0.001), { t: t(), v: nearestValueAtPlayhead(xKfs) }].sort((a, b) => a.t - b.t);
    const nextY = [...yKfs.filter((k) => Math.abs(k.t - playhead) >= 0.001), { t: t(), v: nearestValueAtPlayhead(yKfs) }].sort((a, b) => a.t - b.t);
    setTracks({ x: nextX, y: nextY });
  };
  // Position's own nav follows the x track specifically (an arbitrary but
  // consistent choice) — since this row always adds/removes x and y
  // together, they only diverge if the timeline below is used to hand-edit
  // one independently of the other, an acceptable edge case to under-serve
  // for a single combined nav control.
  const posNav = kfNavInfo(selectedAnim?.tracks?.x, playhead);

  const trackedExtraProps = Object.keys(selectedAnim?.tracks ?? {}).filter((p) => TRACK_PROPERTIES.includes(p) && !CORE_PROPS.includes(p));
  const addablePropOptions = TRACK_PROPERTIES.filter((p) => p !== 'x' && p !== 'y' && !CORE_PROPS.includes(p) && !trackedExtraProps.includes(p));

  const effects: CgEffect[] = el.config.effects ?? [];

  return (
    <>
      <div className="tpld-fields" style={{ marginTop: 14 }}>
        <div className="tpld-fields-label">Transform</div>
        <div className="epp-row">
          <button className={`epp-stopwatch${posTracked ? ' epp-stopwatch--active' : ''}`} title={posTracked ? 'Keyframed — click to remove' : 'Click to start keyframing Position'} onClick={togglePosition}>
            <Clock size={12} strokeWidth={2} />
          </button>
          <span className="epp-row-label">Position</span>
          <input className="field-input" type="number" style={{ width: 56 }} value={Number(xVal) || 0} onChange={(e) => setValue('x', Number(e.target.value), 0)} />
          <input className="field-input" type="number" style={{ width: 56 }} value={Number(yVal) || 0} onChange={(e) => setValue('y', Number(e.target.value), 0)} />
          {!posTracked && (
            <button className="epp-nav-btn" title="Start keyframing at the playhead" onClick={togglePosition}><Diamond size={10} strokeWidth={2} /></button>
          )}
          {posTracked && (
            <span className="epp-kf-nav">
              <button className="epp-nav-btn" disabled={!posNav.hasPrev} title="Previous keyframe" onClick={() => gotoKeyframe('x', -1)}><ChevronLeft size={11} strokeWidth={2} /></button>
              <button className={`epp-nav-btn${posNav.atExact ? ' epp-nav-btn--active' : ''}`} title="Add/update keyframe at playhead" onClick={addPositionKeyframe}><Diamond size={10} strokeWidth={2} /></button>
              <button className="epp-nav-btn" disabled={!posNav.hasNext} title="Next keyframe" onClick={() => gotoKeyframe('x', 1)}><ChevronRight size={11} strokeWidth={2} /></button>
            </span>
          )}
        </div>

        {['scale', 'rotation', 'opacity', ...trackedExtraProps].map((prop) => (
          <PropertyRow
            key={prop}
            prop={prop}
            label={PROP_LABELS[prop] ?? prop}
            kind={COLOR_PROPS.has(prop) ? 'color' : STRING_PROPS.has(prop) ? 'text' : 'number'}
            value={readValue(prop, defaultForProp(el, prop))}
            kfs={selectedAnim?.tracks?.[prop]}
            playhead={playhead}
            onToggle={() => toggleStopwatch(prop, defaultForProp(el, prop))}
            onChangeValue={(v) => setValue(prop, v, defaultForProp(el, prop))}
            onAddKeyframe={() => addKeyframeAtPlayhead(prop, defaultForProp(el, prop))}
            onPrev={() => gotoKeyframe(prop, -1)}
            onNext={() => gotoKeyframe(prop, 1)}
            selected={selectedKf?.layerId === el.id && selectedKf.prop === prop}
          />
        ))}

        <div className="field-row" style={{ marginTop: 4 }}>
          <select className="field-input" style={{ fontSize: 11 }} value="" onChange={(e) => { if (e.target.value) toggleStopwatch(e.target.value, defaultForProp(el, e.target.value)); }}>
            <option value="">+ Add Property…</option>
            {addablePropOptions.map((p) => <option key={p} value={p}>{PROP_LABELS[p] ?? p}</option>)}
          </select>
        </div>

        <div className="field-row" style={{ marginTop: 8 }}>
          <label className="field-label">Transform Origin</label>
          <input className="field-input" placeholder="e.g. center center" value={selectedAnim?.transformOrigin ?? ''}
            onChange={(e) => commitLayer({ ...(selectedAnim ?? { id: el.id }), transformOrigin: e.target.value })} />
        </div>
      </div>

      <div className="tpld-fields" style={{ marginTop: 14 }}>
        <div className="tpld-fields-label">Effects</div>
        {effects.map((fx) => (
          <div key={fx.id}>
            <div className="epp-effect-header">
              <input type="checkbox" checked={fx.enabled} onChange={(e) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, enabled: e.target.checked } : f)) })} title="Enable/disable" />
              <span className="field-label">{EFFECT_LABELS[fx.type]}</span>
              <button className="tplt-track-remove" onClick={() => onConfigChange({ effects: effects.filter((f) => f.id !== fx.id) })} title="Remove effect"><X size={11} strokeWidth={2} /></button>
            </div>
            {EFFECT_PARAMS[fx.type].map((param) => {
              const prop = effectTrackKey(fx.id, param.field);
              // dropShadow's opacity defaults to fully-opaque (100), not 0,
              // for every dropShadow authored before this field existed —
              // matching buildFilterString's own `e.opacity ?? 100` so an
              // old effect's row here doesn't show "0" (reads as invisible)
              // for a shadow that's actually rendering at full strength.
              const fallback = param.field === 'opacity' ? 100 : (param.kind === 'color' ? '#ffffff' : 0);
              return (
                <PropertyRow
                  key={prop}
                  prop={prop}
                  label={param.label}
                  kind={param.kind}
                  value={readValue(prop, (fx as any)[param.field] ?? fallback)}
                  kfs={selectedAnim?.tracks?.[prop]}
                  playhead={playhead}
                  onToggle={() => toggleStopwatch(prop, (fx as any)[param.field] ?? fallback)}
                  onChangeValue={(v) => {
                    // Untracked: this IS the effect's own static field — edit
                    // config.effects directly (same as the old Effects
                    // section did) rather than creating a 1-keyframe track,
                    // so a never-animated effect param stays a plain value.
                    if (!selectedAnim?.tracks?.[prop]?.length) { onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, [param.field]: v } : f)) }); return; }
                    setValue(prop, v, 0);
                  }}
                  onAddKeyframe={() => addKeyframeAtPlayhead(prop, (fx as any)[param.field] ?? fallback)}
                  onPrev={() => gotoKeyframe(prop, -1)}
                  onNext={() => gotoKeyframe(prop, 1)}
                  selected={selectedKf?.layerId === el.id && selectedKf.prop === prop}
                />
              );
            })}
            {/* lightSweep — plain fields, not PropertyRow/keyframeable (see
               cgEffects.ts's EFFECT_PARAMS.lightSweep comment for why: its
               fields never feed the wrapper's `filter` string, so a
               keyframe track here would silently do nothing). */}
            {fx.type === 'lightSweep' && (
              <>
                <div className="field-row">
                  <label className="field-label">Angle</label>
                  <SliderNumberField min={0} max={360} step={1} value={fx.angle ?? 115} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, angle: v } : f)) })} />
                </div>
                <div className="field-row">
                  <label className="field-label">Band Width</label>
                  <SliderNumberField min={1} max={100} value={fx.bandWidth ?? 25} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, bandWidth: Math.max(1, Math.min(100, v)) } : f)) })} />
                </div>
                <div className="field-row">
                  <label className="field-label">Sweep Duration (s)</label>
                  <SliderNumberField min={0.1} max={20} step={0.1} value={fx.duration ?? 1.4} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, duration: Math.max(0.1, v) } : f)) })} />
                </div>
                <div className="field-row">
                  <label className="field-label" title="Pause between one sweep pass ending and the next starting — 0 sweeps back-to-back, continuously">Repeat Gap (s)</label>
                  <SliderNumberField min={0} max={10} step={0.1} value={fx.gap ?? 2.5} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, gap: Math.max(0, v) } : f)) })} />
                </div>
                <div className="field-row">
                  <label className="field-label">Brightness</label>
                  <SliderNumberField min={0} max={100} value={fx.opacity ?? 70} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, opacity: Math.max(0, Math.min(100, v)) } : f)) })} />
                </div>
                <div className="field-row">
                  <label className="field-label">Color</label>
                  <ColorPicker value={fx.color ?? '#ffffff'} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, color: v } : f)) })} />
                </div>
              </>
            )}
            {/* stroke — plain fields, same "not keyframeable" reasoning as
               lightSweep just above (see cgEffects.ts's EFFECT_PARAMS.stroke
               comment). Works on any element kind — for 'shape' the ring
               follows that shape's own path, everywhere else it's a rounded
               rect following the element's own box/borderRadius. */}
            {fx.type === 'stroke' && (
              <>
                <div className="field-row">
                  <label className="field-label">Color</label>
                  <ColorPicker value={fx.color ?? '#ffffff'} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, color: v } : f)) })} />
                </div>
                <div className="field-row">
                  <label className="field-label">Width</label>
                  <SliderNumberField min={0.5} max={30} step={0.5} value={fx.strokeWidth ?? 3} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, strokeWidth: Math.max(0.5, v) } : f)) })} />
                </div>
                <div className="field-row" title="How far outset from the element's own edge this ring sits — 0 sits flush against it, like a plain border.">
                  <label className="field-label">Gap</label>
                  <SliderNumberField min={0} max={100} value={fx.strokeGap ?? 8} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, strokeGap: Math.max(0, v) } : f)) })} />
                </div>
                <div className="field-row">
                  <label className="field-label">Opacity</label>
                  <SliderNumberField min={0} max={100} value={fx.opacity ?? 100} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, opacity: Math.max(0, Math.min(100, v)) } : f)) })} />
                </div>
                <div className="field-row">
                  <label className="field-label">Dash Style</label>
                  <select className="field-input" value={fx.dashStyle ?? 'dashed'} onChange={(e) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, dashStyle: e.target.value as 'solid' | 'dashed' | 'dotted' } : f)) })}>
                    <option value="solid">Solid</option>
                    <option value="dashed">Dashed</option>
                    <option value="dotted">Dotted</option>
                  </select>
                </div>
                {(fx.dashStyle ?? 'dashed') !== 'solid' && (
                  <>
                    <div className="field-row">
                      <label className="field-label" title="Continuously marches the dash pattern around the ring, like a classic 'marching ants' selection outline — runs the whole time this element is on screen, independent of its own In/Loop/Out animation.">
                        <input type="checkbox" checked={fx.animated ?? true} onChange={(e) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, animated: e.target.checked } : f)) })} /> Running Animation
                      </label>
                    </div>
                    {(fx.animated ?? true) && (
                      <>
                        <div className="field-row">
                          <label className="field-label">Speed (s / lap)</label>
                          <SliderNumberField min={0.2} max={20} step={0.1} value={fx.duration ?? 2} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, duration: Math.max(0.2, v) } : f)) })} />
                        </div>
                        <div className="field-row">
                          <label className="field-label">Direction</label>
                          <select className="field-input" value={fx.direction ?? 'forward'} onChange={(e) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, direction: e.target.value as 'forward' | 'reverse' } : f)) })}>
                            <option value="forward">Forward</option>
                            <option value="reverse">Reverse</option>
                          </select>
                        </div>
                      </>
                    )}
                  </>
                )}
                <div className="field-row" title="An optional glow on just this ring, independent of any Glow effect elsewhere on this element's own base content.">
                  <label className="field-label">Glow Strength</label>
                  <SliderNumberField min={0} max={100} value={fx.amount ?? 0} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, amount: Math.max(0, Math.min(100, v)) } : f)) })} />
                </div>
                {(fx.amount ?? 0) > 0 && (
                  <div className="field-row">
                    <label className="field-label">Glow Blur</label>
                    <SliderNumberField min={0} max={60} value={fx.blurRadius ?? 0} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, blurRadius: Math.max(0, v) } : f)) })} />
                  </div>
                )}
              </>
            )}
            {/* glass — plain fields, same "not keyframeable" reasoning as
               lightSweep just above (see cgEffects.ts's EFFECT_PARAMS.glass
               comment). */}
            {fx.type === 'glass' && (
              <>
                <div className="field-row">
                  <label className="field-label" title="Backdrop blur strength — how strongly this panel blurs whatever is BEHIND it (another element, or the Program Background). Has nothing to blur — and so shows no blur — over a fully transparent output with nothing else behind it.">Blur</label>
                  <SliderNumberField min={0} max={80} value={fx.blurRadius ?? 20} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, blurRadius: Math.max(0, v) } : f)) })} />
                </div>
                <div className="field-row">
                  <label className="field-label" title="Boosts the color richness of the blurred backdrop — the second half of the classic frosted-glass look; a plain blur alone reads flat/milky.">Saturate</label>
                  <SliderNumberField min={100} max={300} value={fx.amount ?? 180} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, amount: Math.max(100, v || 100) } : f)) })} />
                </div>
                <div className="field-row">
                  <label className="field-label">Tint Color</label>
                  <ColorPicker value={fx.color ?? '#ffffff'} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, color: v } : f)) })} />
                </div>
                <div className="field-row">
                  <label className="field-label" title="How strongly the tint washes over the blurred backdrop — low keeps the backdrop mostly visible through the glass, high moves toward a solid panel.">Tint Opacity</label>
                  <SliderNumberField min={0} max={100} value={fx.opacity ?? 18} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, opacity: Math.max(0, Math.min(100, v)) } : f)) })} />
                </div>
                <div className="field-row">
                  <label className="field-label" title="Which corner the tint gradient and edge highlight read as 'lit from' — the bright edge sits on this side, a faint tint-colored edge on the opposite side. Same angle convention as a gradient fill (0 = up, 90 = right, clockwise). Also the Ramp Mask's own direction below, when that's on.">Light Angle</label>
                  <SliderNumberField min={0} max={360} step={1} value={fx.angle ?? 135} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, angle: v } : f)) })} />
                </div>
                <div className="field-row" title="Fades the whole panel spatially along Light Angle instead of applying at one uniform strength everywhere — strongest at the edge opposite Light Angle, fading to none by the angle's own edge. Point it at exactly the area you want to read as glass.">
                  <label className="field-label">Ramp Mask</label>
                  <input type="checkbox" checked={!!fx.rampMask} onChange={(e) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, rampMask: e.target.checked } : f)) })} />
                </div>
              </>
            )}
            {/* fractalGlass — plain fields, same "not keyframeable" reasoning
               as glass just above; shares every one of glass's own fields
               (see cgEffects.ts's findGlass doc comment on treating the
               whole glass family as one shared recipe) plus its own texture
               picker and distortion strength. */}
            {fx.type === 'fractalGlass' && (
              <>
                <div className="field-row" title="Which CSS blend mode the ridge pattern reacts through — this is what actually gives each style its own character (a plain gradient looks nearly the same regardless; the blend mode is what changes how it reacts to color/light behind the panel).">
                  <label className="field-label">Style</label>
                  <select className="field-input" value={fx.texture ?? FRACTAL_GLASS_STYLES[0].key} onChange={(e) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, texture: e.target.value } : f)) })}>
                    {FRACTAL_GLASS_STYLES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
                <div className="field-row" title="Spacing between ridges, in pixels.">
                  <label className="field-label">Ridge Spacing</label>
                  <SliderNumberField min={4} max={200} value={fx.bandWidth ?? 32} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, bandWidth: Math.max(4, v || 4) } : f)) })} />
                </div>
                <div className="field-row" title="How soft/blurred the ridges themselves read. 0 is crisp, thin lines; higher is a softer, glowier fluting.">
                  <label className="field-label">Softness</label>
                  <SliderNumberField min={0} max={100} value={fx.amplitude ?? 30} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, amplitude: Math.max(0, v) } : f)) })} />
                </div>
                <div className="field-row" title="Backdrop blur strength, same as plain Glass.">
                  <label className="field-label">Blur</label>
                  <SliderNumberField min={0} max={80} value={fx.blurRadius ?? 20} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, blurRadius: Math.max(0, v) } : f)) })} />
                </div>
                <div className="field-row" title="Backdrop saturate boost, same as plain Glass.">
                  <label className="field-label">Saturate</label>
                  <SliderNumberField min={100} max={300} value={fx.amount ?? 100} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, amount: Math.max(100, v || 100) } : f)) })} />
                </div>
                <div className="field-row">
                  <label className="field-label">Ridge Color</label>
                  <ColorPicker value={fx.color ?? '#ffffff'} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, color: v } : f)) })} />
                </div>
                <div className="field-row" title="Overall contrast of the ridge pattern — low reads as a subtle fluting, high as bold, high-contrast bands.">
                  <label className="field-label">Contrast</label>
                  <SliderNumberField min={0} max={100} value={fx.opacity ?? 100} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, opacity: Math.max(0, Math.min(100, v)) } : f)) })} />
                </div>
                <div className="field-row">
                  <label className="field-label">Ridge Angle</label>
                  <SliderNumberField min={0} max={360} step={1} value={fx.angle ?? 90} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, angle: v } : f)) })} />
                </div>
                <div className="field-row" title="Fades the panel spatially along Ridge Angle instead of one uniform strength everywhere.">
                  <label className="field-label">Ramp Mask</label>
                  <input type="checkbox" checked={!!fx.rampMask} onChange={(e) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, rampMask: e.target.checked } : f)) })} />
                </div>
              </>
            )}
            {/* crystalGlass — plain fields, same shape as fractalGlass just
               above, its own facet cell size instead of a texture/distortion
               pair. */}
            {fx.type === 'crystalGlass' && (
              <>
                <div className="field-row" title="Size of each cut-glass facet cell, in pixels.">
                  <label className="field-label">Facet Size</label>
                  <SliderNumberField min={8} max={200} value={fx.bandWidth ?? 36} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, bandWidth: Math.max(8, v || 8) } : f)) })} />
                </div>
                <div className="field-row" title="Backdrop blur strength, same as plain Glass.">
                  <label className="field-label">Blur</label>
                  <SliderNumberField min={0} max={80} value={fx.blurRadius ?? 16} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, blurRadius: Math.max(0, v) } : f)) })} />
                </div>
                <div className="field-row" title="Backdrop saturate boost, same as plain Glass.">
                  <label className="field-label">Saturate</label>
                  <SliderNumberField min={100} max={300} value={fx.amount ?? 170} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, amount: Math.max(100, v || 100) } : f)) })} />
                </div>
                <div className="field-row">
                  <label className="field-label">Tint Color</label>
                  <ColorPicker value={fx.color ?? '#ffffff'} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, color: v } : f)) })} />
                </div>
                <div className="field-row">
                  <label className="field-label">Tint Opacity</label>
                  <SliderNumberField min={0} max={100} value={fx.opacity ?? 20} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, opacity: Math.max(0, Math.min(100, v)) } : f)) })} />
                </div>
                <div className="field-row">
                  <label className="field-label">Light Angle</label>
                  <SliderNumberField min={0} max={360} step={1} value={fx.angle ?? 135} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, angle: v } : f)) })} />
                </div>
                <div className="field-row" title="Fades the panel spatially along Light Angle instead of one uniform strength everywhere.">
                  <label className="field-label">Ramp Mask</label>
                  <input type="checkbox" checked={!!fx.rampMask} onChange={(e) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, rampMask: e.target.checked } : f)) })} />
                </div>
              </>
            )}
            {/* liquidGlass — plain fields, same shape as fractalGlass/
               crystalGlass above. The chromatic-aberration refraction itself
               only ever shows on a 'text' element with no custom font set
               (see cgEffects.ts's own doc comment on why) — on anything
               else this quietly behaves like plain Glass instead, so the
               hint below is worth surfacing rather than leaving an operator
               to wonder why nothing looks different. */}
            {fx.type === 'liquidGlass' && (
              <>
                {el.kind !== 'text' && (
                  <p className="app-settings-hint" style={{ margin: '0 0 8px' }}>
                    The liquid refraction only shows on Text elements (with no custom font set) — on this element kind it behaves like plain Glass.
                  </p>
                )}
                {el.kind === 'text' && el.config.fontFamily && (
                  <p className="app-settings-hint" style={{ margin: '0 0 8px' }}>
                    This text has a custom font set — the refraction can't follow those glyph shapes, so it falls back to plain Glass. Switch Font back to "Default" to get the liquid look.
                  </p>
                )}
                {el.kind === 'text' && !el.config.fontFamily && (
                  <p className="app-settings-hint" style={{ margin: '0 0 8px' }}>
                    For a solid, lit "3D glass" look (not just a flat frosted pane): lower this text's own Text Opacity (in Text Color, above) so it's translucent, then also add a Bevel &amp; Emboss effect — its raised, lit relief follows these same glyph shapes and reads as chunky glass letters catching light, with the refraction showing through.
                  </p>
                )}
                <div className="field-row" title="How strongly the backdrop bends/chromatically separates near each glyph's own edges.">
                  <label className="field-label">Refraction</label>
                  <SliderNumberField min={0} max={100} value={fx.amplitude ?? 40} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, amplitude: Math.max(0, v) } : f)) })} />
                </div>
                <div className="field-row" title="Backdrop blur strength — also softens the internal refraction map itself, same field.">
                  <label className="field-label">Blur</label>
                  <SliderNumberField min={0} max={80} value={fx.blurRadius ?? 20} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, blurRadius: Math.max(0, v) } : f)) })} />
                </div>
                <div className="field-row" title="Backdrop saturate boost, same as plain Glass.">
                  <label className="field-label">Saturate</label>
                  <SliderNumberField min={100} max={300} value={fx.amount ?? 160} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, amount: Math.max(100, v || 100) } : f)) })} />
                </div>
                <div className="field-row">
                  <label className="field-label">Tint Color</label>
                  <ColorPicker value={fx.color ?? '#ffffff'} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, color: v } : f)) })} />
                </div>
                <div className="field-row">
                  <label className="field-label">Tint Opacity</label>
                  <SliderNumberField min={0} max={100} value={fx.opacity ?? 18} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, opacity: Math.max(0, Math.min(100, v)) } : f)) })} />
                </div>
                <div className="field-row">
                  <label className="field-label">Light Angle</label>
                  <SliderNumberField min={0} max={360} step={1} value={fx.angle ?? 135} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, angle: v } : f)) })} />
                </div>
                <div className="field-row" title="Fades the panel spatially along Light Angle instead of one uniform strength everywhere.">
                  <label className="field-label">Ramp Mask</label>
                  <input type="checkbox" checked={!!fx.rampMask} onChange={(e) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, rampMask: e.target.checked } : f)) })} />
                </div>
              </>
            )}
            {/* blur — otherwise a plain keyframeable PropertyRow (see
               EFFECT_PARAMS.blur above); Ramp Mask itself has nowhere to go
               in that generic keyframe-row system (a boolean toggle, not a
               tweenable number), so it gets this one small plain-fields
               addendum, same "own block bolted on next to the generic rows"
               shape lightSweep/glass/etc. already established. */}
            {fx.type === 'blur' && (
              <>
                <div className="field-row" title="Fades the blur spatially across the element instead of applying at one uniform strength everywhere — strongest at the edge opposite the angle below, fading to fully sharp by the angle's own edge.">
                  <label className="field-label">Ramp Mask</label>
                  <input type="checkbox" checked={!!fx.rampMask} onChange={(e) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, rampMask: e.target.checked } : f)) })} />
                </div>
                {fx.rampMask && (
                  <div className="field-row" title="Which direction the blur builds up toward.">
                    <label className="field-label">Ramp Angle</label>
                    <SliderNumberField min={0} max={360} step={1} value={fx.angle ?? 135} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, angle: v } : f)) })} />
                  </div>
                )}
              </>
            )}
            {/* flagWave — plain fields, same "not keyframeable" reasoning as
               lightSweep/glass above (see cgEffects.ts's EFFECT_PARAMS.flagWave
               comment). Works on any element's own content, no separate mesh
               or WebGL — see cgEffects.ts's own doc comment on the recipe. */}
            {fx.type === 'flagWave' && (
              <>
                <div className="field-row" title="How far this element's own pixels actually get displaced by the ripple. Small = a subtle cloth shimmer, large = an exaggerated, almost liquid distortion.">
                  <label className="field-label">Amplitude</label>
                  <SliderNumberField min={0} max={100} value={fx.amplitude ?? 10} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, amplitude: Math.max(0, v) } : f)) })} />
                </div>
                <div className="field-row" title="Roughly how many separate ripples fit across the element.">
                  <label className="field-label">Frequency</label>
                  <SliderNumberField min={1} max={10} step={0.5} value={fx.frequency ?? 3} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, frequency: Math.max(0.5, Math.min(10, v)) } : f)) })} />
                </div>
                <div className="field-row" title="How tall the simulated cloth relief reads — the light/shadow ridges along the ripple. 0 is a flat 2D warp with no shading at all.">
                  <label className="field-label">Relief</label>
                  <SliderNumberField min={0} max={20} value={fx.amount ?? 8} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, amount: Math.max(0, Math.min(20, v)) } : f)) })} />
                </div>
                <div className="field-row" title="Starting direction the simulated light comes from — it keeps sweeping from here, a fixed light wouldn't look like it's moving.">
                  <label className="field-label">Light Angle</label>
                  <SliderNumberField min={0} max={360} step={1} value={fx.angle ?? 45} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, angle: v } : f)) })} />
                </div>
                <div className="field-row" title="Seconds for one full cycle of the ripple's own breathing density + one full sweep of the light direction.">
                  <label className="field-label">Cycle (s)</label>
                  <SliderNumberField min={0.2} max={20} step={0.1} value={fx.duration ?? 3} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, duration: Math.max(0.2, v) } : f)) })} />
                </div>
              </>
            )}
            {/* waveWarp — plain fields, same "not keyframeable" reasoning as
               flagWave above (see cgEffects.ts's EFFECT_PARAMS.waveWarp
               comment). Mirrors After Effects' own Wave Warp parameter set
               field-for-field — see CgEffect's own doc comment on each of
               these for exactly what each one maps to. */}
            {fx.type === 'waveWarp' && (
              <>
                <div className="field-row" title="Which shape of wave travels across the element. Noise/Smooth Noise give an organic, fractal-looking ripple instead of a regular repeating wave.">
                  <label className="field-label">Wave Type</label>
                  <select className="field-input" value={fx.waveType ?? 'sine'} onChange={(e) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, waveType: e.target.value as NonNullable<CgEffect['waveType']> } : f)) })}>
                    <option value="sine">Sine</option>
                    <option value="square">Square</option>
                    <option value="circle">Circle</option>
                    <option value="semicircle">Semicircle</option>
                    <option value="triangle">Triangle</option>
                    <option value="sawtooth">Sawtooth</option>
                    <option value="noise">Noise</option>
                    <option value="smoothNoise">Smooth Noise</option>
                  </select>
                </div>
                <div className="field-row" title="How far pixels actually get pushed from their resting position.">
                  <label className="field-label">Wave Height</label>
                  <SliderNumberField min={0} max={150} value={fx.amplitude ?? 20} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, amplitude: Math.max(0, v) } : f)) })} />
                </div>
                {fx.waveType !== 'noise' && fx.waveType !== 'smoothNoise' && (
                  <div className="field-row" title="The distance between successive wave crests.">
                    <label className="field-label">Wave Width</label>
                    <SliderNumberField min={4} max={400} value={fx.bandWidth ?? 60} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, bandWidth: Math.max(4, v || 4) } : f)) })} />
                  </div>
                )}
                <div className="field-row" title="The single axis every wave's displacement travels along.">
                  <label className="field-label">Direction</label>
                  <SliderNumberField min={0} max={360} step={1} value={fx.angle ?? 0} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, angle: v } : f)) })} />
                </div>
                <div className="field-row" title="How many full wave cycles travel past a fixed point per second. 0 freezes it at Phase; negative reverses direction.">
                  <label className="field-label">Wave Speed</label>
                  <SliderNumberField min={-10} max={10} step={0.1} value={fx.frequency ?? 1} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, frequency: v } : f)) })} />
                </div>
                <div className="field-row" title="A fixed starting offset for the wave, on top of whatever Wave Speed is already sweeping it through.">
                  <label className="field-label">Phase</label>
                  <SliderNumberField min={0} max={360} step={1} value={fx.phase ?? 0} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, phase: v } : f)) })} />
                </div>
                <div className="field-row" title="Keeps the named edge(s) perfectly still while the rest of the element still ripples — like a flag pinned to a pole.">
                  <label className="field-label">Pinning</label>
                  <select className="field-input" value={fx.pinning ?? 'none'} onChange={(e) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, pinning: e.target.value as NonNullable<CgEffect['pinning']> } : f)) })}>
                    <option value="none">None</option>
                    <option value="left">Left Edge</option>
                    <option value="right">Right Edge</option>
                    <option value="top">Top Edge</option>
                    <option value="bottom">Bottom Edge</option>
                    <option value="leftRight">Left-Right Edges</option>
                    <option value="topBottom">Top-Bottom Edges</option>
                    <option value="all">All Edges</option>
                  </select>
                </div>
                <div className="field-row" title="Higher settings sample the wave shape at a higher resolution — smoother curves and sharper hard edges (Square/Sawtooth), at a small extra cost.">
                  <label className="field-label">Anti-aliasing</label>
                  <select className="field-input" value={fx.antiAlias ?? 'low'} onChange={(e) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, antiAlias: e.target.value as NonNullable<CgEffect['antiAlias']> } : f)) })}>
                    <option value="off">Off</option>
                    <option value="low">Low</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </>
            )}
            {/* bevel — plain fields, same "not keyframeable" reasoning as
               flagWave above (see cgEffects.ts's EFFECT_PARAMS.bevel
               comment). Static, not animated — see cgEffects.ts's own doc
               comment on why a bevel doesn't need continuous motion the
               way flagWave does. */}
            {fx.type === 'bevel' && (
              <>
                <div className="field-row" title="Restricts the raised 3D look to a thin ring at the element's own outline instead of its whole surface — a '3D stroke' look.">
                  <label className="field-label">Edge Only</label>
                  <input type="checkbox" checked={!!fx.edgeOnly} onChange={(e) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, edgeOnly: e.target.checked } : f)) })} />
                </div>
                {fx.edgeOnly && (
                  <div className="field-row" title="How wide the outline ring is, in pixels.">
                    <label className="field-label">Ring Width</label>
                    <SliderNumberField min={1} max={60} value={fx.bandWidth ?? 8} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, bandWidth: Math.max(1, v || 1) } : f)) })} />
                  </div>
                )}
                <div className="field-row" title="How pronounced the raised 3D relief reads. 0 is flat.">
                  <label className="field-label">Depth</label>
                  <SliderNumberField min={0} max={20} value={fx.amount ?? 4} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, amount: Math.max(0, Math.min(20, v)) } : f)) })} />
                </div>
                <div className="field-row" title="How soft the relief's own edge transition reads — small is a crisp, hard edge, large is smooth and rounded.">
                  <label className="field-label">Softness</label>
                  <SliderNumberField min={0} max={20} value={fx.blurRadius ?? 3} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, blurRadius: Math.max(0, v) } : f)) })} />
                </div>
                <div className="field-row" title="Which direction the simulated light comes from.">
                  <label className="field-label">Light Angle</label>
                  <SliderNumberField min={0} max={360} step={1} value={fx.angle ?? 135} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, angle: v } : f)) })} />
                </div>
                <div className="field-row" title="How high overhead the light sits — low values throw long, dramatic shadows and a strong highlight; high values read flatter.">
                  <label className="field-label">Light Elevation</label>
                  <SliderNumberField min={0} max={90} value={fx.elevation ?? 55} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, elevation: Math.max(0, Math.min(90, v)) } : f)) })} />
                </div>
                <div className="field-row" title="How tight/glossy the highlight reads — low is a soft matte shine, high is a tight, plastic/metallic one.">
                  <label className="field-label">Shininess</label>
                  <SliderNumberField min={1} max={60} value={fx.shininess ?? 12} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, shininess: Math.max(1, v || 1) } : f)) })} />
                </div>
              </>
            )}
            {/* innerShadow — plain fields, same "not keyframeable" reasoning
               as bevel just above (see cgEffects.ts's EFFECT_PARAMS.innerShadow
               comment) — a pressed-in complement to bevel's raised look. */}
            {fx.type === 'innerShadow' && (
              <>
                <div className="field-row" title="Which direction the shadow's own offset leans — the edge facing AWAY from this darkens, same convention as Drop Shadow's offset.">
                  <label className="field-label">Offset X</label>
                  <SliderNumberField min={-50} max={50} step={1} value={fx.offsetX ?? 4} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, offsetX: v } : f)) })} />
                </div>
                <div className="field-row">
                  <label className="field-label">Offset Y</label>
                  <SliderNumberField min={-50} max={50} step={1} value={fx.offsetY ?? 4} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, offsetY: v } : f)) })} />
                </div>
                <div className="field-row" title="How far the pressed-in shading spreads inward from the edge.">
                  <label className="field-label">Blur</label>
                  <SliderNumberField min={0} max={60} value={fx.blurRadius ?? 5} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, blurRadius: Math.max(0, v) } : f)) })} />
                </div>
                <div className="field-row">
                  <label className="field-label">Color</label>
                  <ColorPicker value={fx.color ?? '#000000'} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, color: v } : f)) })} />
                </div>
                <div className="field-row">
                  <label className="field-label">Opacity</label>
                  <SliderNumberField min={0} max={100} value={fx.opacity ?? 85} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, opacity: Math.max(0, Math.min(100, v)) } : f)) })} />
                </div>
              </>
            )}
            {/* animatedBg — plain fields, same "not keyframeable" reasoning
               as flagWave/bevel above. A real moving background pattern,
               not the element's own solid-color/gradient fill (which stays
               editable separately, wherever that field normally lives). */}
            {fx.type === 'animatedBg' && (
              <>
                <div className="field-row" title="Which moving pattern to paint behind this element's own content.">
                  <label className="field-label">Style</label>
                  <select className="field-input" value={fx.animatedBgStyle ?? 'gradientShift'} onChange={(e) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, animatedBgStyle: e.target.value } : f)) })}>
                    <option value="gradientShift">Gradient Shift</option>
                    <option value="stripes">Diagonal Stripes</option>
                    <option value="pulse">Pulse Glow</option>
                    <option value="colorCycle">Color Cycle</option>
                    <option value="glass">Glass</option>
                    <option value="colorRamp">Color Ramp</option>
                    <option value="aurora">Aurora</option>
                    <option value="mesh">Mesh Gradient</option>
                    <option value="grain">Grainy Gradient</option>
                    <option value="prism">Prism</option>
                    <option value="conic">Conic Sweep</option>
                    <option value="wave">Wave</option>
                    <option value="pixel">Pixel Mosaic</option>
                    <option value="liquidDiffuse">Liquid Diffuse</option>
                  </select>
                </div>
                {!['prism', 'conic', 'wave', 'pixel', 'liquidDiffuse'].includes(fx.animatedBgStyle ?? 'gradientShift') && (
                  <div className="field-row">
                    <label className="field-label">Color</label>
                    <ColorPicker value={fx.color ?? '#3355ff'} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, color: v } : f)) })} />
                  </div>
                )}
                {!['colorCycle', 'colorRamp', 'glass', 'prism', 'conic', 'wave', 'pixel', 'liquidDiffuse'].includes(fx.animatedBgStyle ?? 'gradientShift') && (
                  <div className="field-row" title="The pattern's own second color — leave unset for an automatic darker shade of the first.">
                    <label className="field-label">Color 2</label>
                    <ColorPicker value={fx.color2 ?? '#000033'} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, color2: v } : f)) })} />
                  </div>
                )}
                {!['pulse', 'colorCycle', 'glass', 'aurora', 'mesh', 'grain', 'prism', 'wave', 'pixel', 'liquidDiffuse'].includes(fx.animatedBgStyle ?? 'gradientShift') && (
                  <div className="field-row" title={fx.animatedBgStyle === 'conic' ? "The sweep's own starting angle." : "The pattern's own direction."}>
                    <label className="field-label">Angle</label>
                    <SliderNumberField min={0} max={360} step={1} value={fx.angle ?? 45} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, angle: v } : f)) })} />
                  </div>
                )}
                {fx.animatedBgStyle === 'grain' && (
                  <>
                    <div className="field-row" title="The grain texture's own opacity — how strongly it shows over the gradient underneath.">
                      <label className="field-label">Grain Amount</label>
                      <SliderNumberField min={0} max={100} step={1} value={fx.amplitude ?? 35} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, amplitude: Math.max(0, Math.min(100, v)) } : f)) })} />
                    </div>
                    <div className="field-row" title="How coarse the grain reads — low is big/blotchy, high is fine/tight film grain.">
                      <label className="field-label">Grain Size</label>
                      <SliderNumberField min={1} max={10} step={1} value={fx.frequency ?? 5} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, frequency: Math.max(1, Math.min(10, v)) } : f)) })} />
                    </div>
                  </>
                )}
                {fx.animatedBgStyle === 'prism' && (
                  <PrismFields fx={fx} effects={effects} onConfigChange={onConfigChange} />
                )}
                {fx.animatedBgStyle === 'conic' && (
                  <ColorStopsEditor fx={fx} effects={effects} onConfigChange={onConfigChange} />
                )}
                {fx.animatedBgStyle === 'wave' && (
                  <>
                    <ColorStopsEditor fx={fx} effects={effects} onConfigChange={onConfigChange} />
                    <div className="field-row" title="How many waves fit across one tile.">
                      <label className="field-label">Waves</label>
                      <SliderNumberField min={1} max={10} step={1} value={fx.frequency ?? 3} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, frequency: v } : f)) })} />
                    </div>
                    <div className="field-row" title="How tall each wave is.">
                      <label className="field-label">Wave Height</label>
                      <SliderNumberField min={0} max={100} step={1} value={fx.amplitude ?? 40} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, amplitude: v } : f)) })} />
                    </div>
                  </>
                )}
                {fx.animatedBgStyle === 'pixel' && (
                  <>
                    <ColorStopsEditor fx={fx} effects={effects} onConfigChange={onConfigChange} />
                    <div className="field-row" title="How many columns/rows the mosaic grid has.">
                      <label className="field-label">Grid Size</label>
                      <SliderNumberField min={2} max={60} step={1} value={fx.stripCount ?? 16} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, stripCount: Math.round(v) } : f)) })} />
                    </div>
                    <div className="field-row">
                      <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input type="checkbox" checked={!!fx.reverseColors} onChange={(e) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, reverseColors: e.target.checked } : f)) })} /> Reverse
                      </label>
                    </div>
                  </>
                )}
                {fx.animatedBgStyle === 'liquidDiffuse' && (
                  <ColorStopsEditor fx={fx} effects={effects} onConfigChange={onConfigChange} />
                )}
                <div className="field-row" title="How the motion repeats. Yoyo — plays forward then back, continuously (smooth, organic). Loop — plays forward only, restarting at the start each time, constant speed, no easing pulse at the restart — every style here is built so that restart point is pixel-seamless, not a visible cut (a few styles that genuinely can't close the loop — Pulse Glow, Aurora, Mesh, Prism, Pixel Mosaic, Liquid Diffuse — quietly use Yoyo instead even when Loop is picked, since that never jumps either). Once — plays forward a single time, then holds there.">
                  <label className="field-label">Play Mode</label>
                  <select className="field-input" value={fx.loopMode ?? 'yoyo'} onChange={(e) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, loopMode: e.target.value } : f)) })}>
                    <option value="yoyo">Yoyo (back &amp; forth)</option>
                    <option value="loop">Loop (seamless repeat)</option>
                    <option value="once">Once (play, then hold)</option>
                  </select>
                </div>
                <div className="field-row" title="Seconds for one full animation cycle.">
                  <label className="field-label">Speed (s)</label>
                  <SliderNumberField min={0.5} max={20} step={0.5} value={fx.duration ?? 6} onChange={(v) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, duration: Math.max(0.5, v || 0.5) } : f)) })} />
                </div>
              </>
            )}
          </div>
        ))}
        <div className="field-row" style={{ marginTop: 4 }}>
          <select className="field-input" style={{ fontSize: 11 }} value="" onChange={(e) => { const type = e.target.value as CgEffect['type']; if (type) onConfigChange({ effects: [...effects, defaultEffect(type)] }); }}>
            <option value="">+ Effect…</option>
            {(Object.keys(EFFECT_LABELS) as CgEffect['type'][])
              // liquidGlass's own chromatic-aberration refraction only ever
              // shows on a 'text' element with no custom font (see
              // cgEffects.ts's own doc comment on why) — offering it on any
              // other kind just adds an option that silently behaves like
              // plain Glass, which reads as broken rather than restricted.
              .filter((type) => type !== 'liquidGlass' || el.kind === 'text')
              .map((type) => <option key={type} value={type}>{EFFECT_LABELS[type]}</option>)}
          </select>
        </div>
      </div>
    </>
  );
}

// Eight original, hand-picked quick-apply color sets for 'prism' — one
// click replaces the whole `colors` list with that set (equal weights,
// re-editable afterward same as any manually-built list). Purely a
// starting-point convenience, same spirit as any color-palette picker.
const PRISM_PALETTES: { name: string; colors: string[] }[] = [
  { name: 'Deep Harbor', colors: ['#0b1d3a', '#1b4965', '#5fa8d3', '#bee9e8'] },
  { name: 'Wildfire', colors: ['#240046', '#9d0208', '#f48c06', '#ffba08'] },
  { name: 'Citrus Grove', colors: ['#1b4332', '#52b788', '#b7e4c7', '#ffe066'] },
  { name: 'Rosewood', colors: ['#3d0301', '#813405', '#b03052', '#e2a0ff'] },
  { name: 'Arctic Mint', colors: ['#03045e', '#0077b6', '#90e0ef', '#caf0f8'] },
  { name: 'Desert Bloom', colors: ['#5e2a84', '#c1121f', '#f4a261', '#ffe8d6'] },
  { name: 'Nightshade', colors: ['#10002b', '#5a189a', '#9d4edd', '#e0aaff'] },
  { name: 'Golden Hour', colors: ['#390099', '#9e0059', '#ff5400', '#ffbd00'] },
];

/** 'prism' animatedBg style's own full control set — Palettes/Colours,
 *  Shape, Direction, Geometry, Fusion, Finish. See TemplateElement's own
 *  'animatedBg'/`colors`/`stripCount`/etc. doc comments in types/canvas.ts
 *  for exactly what each field does; this is purely the editor for them. */
/** Shared "Palettes + Colours" editor for every multi-color animatedBg
 *  style (prism/conic/wave/pixel) — one click on a palette swatch replaces
 *  the whole list; each color row has its own Weight (relative share of
 *  the ramp), reorder arrows, and remove. Falls back to a plain 2-entry
 *  list built from `fx.color`/`fx.color2` when `fx.colors` is still empty
 *  (a freshly-switched-to style), same default resolveColorStops itself
 *  falls back to. */
function ColorStopsEditor({ fx, effects, onConfigChange }: {
  fx: CgEffect;
  effects: CgEffect[];
  onConfigChange: (patch: Record<string, any>) => void;
}) {
  const update = (patch: Partial<CgEffect>) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, ...patch } : f)) });
  const colors = fx.colors?.length ? fx.colors : [
    { id: 'a', hex: fx.color ?? '#3355ff', weight: 1 },
    { id: 'b', hex: fx.color2 ?? '#000033', weight: 1 },
  ];
  const updateColors = (next: { id: string; hex: string; weight: number }[]) => update({ colors: next });

  return (
    <>
      <div className="tpld-fields-label" style={{ marginTop: 10 }}>Palettes</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {PRISM_PALETTES.map((p) => (
          <button
            key={p.name}
            type="button"
            title={p.name}
            onClick={() => updateColors(p.colors.map((hex) => ({ id: crypto.randomUUID(), hex, weight: 1 })))}
            style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', width: 40, height: 22, border: '1px solid var(--border)', cursor: 'pointer', padding: 0 }}
          >
            {p.colors.map((hex, i) => <span key={i} style={{ flex: 1, background: hex }} />)}
          </button>
        ))}
      </div>

      <div className="tpld-fields-label" title="Each colour's own Weight is its relative share of the ramp — a bigger weight gives it more of the pattern before the ramp moves to the next colour.">Colours ({colors.length})</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
        {colors.map((c, i) => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <ColorPicker value={c.hex} onChange={(v) => updateColors(colors.map((cc) => (cc.id === c.id ? { ...cc, hex: v } : cc)))} />
            <input
              className="field-input" type="number" min={0.1} max={10} step={0.1}
              style={{ width: 48 }}
              value={c.weight}
              title="Weight — this colour's own relative share of the ramp"
              onChange={(e) => updateColors(colors.map((cc) => (cc.id === c.id ? { ...cc, weight: Math.max(0.1, Number(e.target.value) || 1) } : cc)))}
            />
            <button type="button" className="cgo-copy-btn" disabled={i === 0} title="Move earlier" onClick={() => {
              const next = [...colors]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; updateColors(next);
            }}>↑</button>
            <button type="button" className="cgo-copy-btn" disabled={i === colors.length - 1} title="Move later" onClick={() => {
              const next = [...colors]; [next[i + 1], next[i]] = [next[i], next[i + 1]]; updateColors(next);
            }}>↓</button>
            <button type="button" className="cgo-copy-btn" disabled={colors.length <= 2} title="Remove" onClick={() => updateColors(colors.filter((cc) => cc.id !== c.id))}>
              <X size={11} strokeWidth={2} />
            </button>
          </div>
        ))}
        <button type="button" className="cgo-copy-btn" style={{ alignSelf: 'flex-start' }}
          onClick={() => updateColors([...colors, { id: crypto.randomUUID(), hex: '#ffffff', weight: 1 }])}>
          + Add colour
        </button>
      </div>
    </>
  );
}

function PrismFields({ fx, effects, onConfigChange }: {
  fx: CgEffect;
  effects: CgEffect[];
  onConfigChange: (patch: Record<string, any>) => void;
}) {
  const update = (patch: Partial<CgEffect>) => onConfigChange({ effects: effects.map((f) => (f.id === fx.id ? { ...f, ...patch } : f)) });

  return (
    <>
      <ColorStopsEditor fx={fx} effects={effects} onConfigChange={onConfigChange} />

      <div className="tpld-fields-label" style={{ marginTop: 10 }}>Shape</div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
        {(['slant', 'lens', 'crest', 'valley', 'tide'] as const).map((s) => (
          <button key={s} type="button"
            className={`tpld-tool-btn${(fx.shapePreset ?? 'slant') === s ? ' tpld-tool-btn--active' : ''}`}
            onClick={() => update({ shapePreset: s })}
            style={{ textTransform: 'capitalize', fontSize: 11 }}
          >{s}</button>
        ))}
      </div>

      <div className="field-row" title="Which way the bands run, and which end the first colour starts from.">
        <label className="field-label">Direction</label>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['up', 'right', 'down', 'left'] as const).map((d) => (
            <button key={d} type="button"
              className={`cgo-copy-btn${(fx.bandDirection ?? 'up') === d ? ' tpld-tool-btn--active' : ''}`}
              title={d} onClick={() => update({ bandDirection: d })}
            >{d === 'up' ? '↑' : d === 'right' ? '→' : d === 'down' ? '↓' : '←'}</button>
          ))}
        </div>
      </div>

      <div className="tpld-fields-label" style={{ marginTop: 10 }}>Geometry</div>
      <div className="field-row">
        <label className="field-label">Strips</label>
        <SliderNumberField min={2} max={80} step={1} value={fx.stripCount ?? 22} onChange={(v) => update({ stripCount: Math.round(v) })} />
      </div>
      <div className="field-row">
        <label className="field-label">Height</label>
        <SliderNumberField min={0} max={100} step={1} value={fx.heightPct ?? 60} onChange={(v) => update({ heightPct: v })} />
      </div>
      {fx.shapePreset !== 'slant' && (
        <div className="field-row" title="Where the shape's own peak sits along the strip.">
          <label className="field-label">Across</label>
          <SliderNumberField min={0} max={100} step={1} value={fx.acrossPct ?? 50} onChange={(v) => update({ acrossPct: v })} />
        </div>
      )}
      <div className="field-row" title="Where the whole pattern's own baseline sits vertically.">
        <label className="field-label">Along</label>
        <SliderNumberField min={0} max={100} step={1} value={fx.alongPct ?? 50} onChange={(v) => update({ alongPct: v })} />
      </div>

      <div className="tpld-fields-label" style={{ marginTop: 10 }}>Fusion</div>
      <div className="field-row" title="How much adjacent bands blend into each other — 0 is crisp stripes, 100 is one smooth gradient.">
        <label className="field-label">Blend</label>
        <SliderNumberField min={0} max={100} step={1} value={fx.amount ?? 0} onChange={(v) => update({ amount: v })} />
      </div>
      <div className="field-row" title="A faceted-glass highlight/shadow hairline texture layered on top.">
        <label className="field-label">Facets</label>
        <SliderNumberField min={0} max={100} step={1} value={fx.facetsPct ?? 0} onChange={(v) => update({ facetsPct: v })} />
      </div>
      <div className="field-row">
        <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={!!fx.reverseColors} onChange={(e) => update({ reverseColors: e.target.checked })} /> Reverse colours
        </label>
      </div>

      <div className="tpld-fields-label" style={{ marginTop: 10 }}>Finish</div>
      <div className="field-row" title="An overall soft blur over the whole pattern.">
        <label className="field-label">Soften (px)</label>
        <SliderNumberField min={0} max={40} step={1} value={fx.blurRadius ?? 0} onChange={(v) => update({ blurRadius: v })} />
      </div>
    </>
  );
}

function PropertyRow({ prop, label, kind, value, kfs, playhead, onToggle, onChangeValue, onAddKeyframe, onPrev, onNext, selected }: {
  prop: string;
  label: string;
  kind: 'number' | 'color' | 'text';
  value: any;
  kfs: CgKeyframe[] | undefined;
  playhead: number;
  onToggle: () => void;
  onChangeValue: (v: any) => void;
  onAddKeyframe: () => void;
  onPrev: () => void;
  onNext: () => void;
  selected: boolean;
}) {
  const tracked = !!kfs?.length;
  const nav = kfNavInfo(kfs, playhead);
  return (
    <div className={`epp-row${selected ? ' epp-diamond--selected' : ''}`}>
      <button className={`epp-stopwatch${tracked ? ' epp-stopwatch--active' : ''}`} title={tracked ? 'Keyframed — click to remove' : `Click to start keyframing ${label}`} onClick={onToggle}>
        <Clock size={12} strokeWidth={2} />
      </button>
      <span className="epp-row-label">{label}</span>
      {kind === 'color' ? (
        <ColorPicker value={typeof value === 'string' && value.startsWith('#') ? value : '#ffffff'} onChange={onChangeValue} />
      ) : kind === 'text' ? (
        <input className="field-input" style={{ width: 90 }} value={String(value ?? '')} onChange={(e) => onChangeValue(e.target.value)} />
      ) : (
        <input className="field-input" type="number" style={{ width: 64 }} value={typeof value === 'number' ? value : Number(value) || 0} onChange={(e) => onChangeValue(Number(e.target.value))} />
      )}
      {tracked && (
        <span className="epp-kf-nav">
          <button className="epp-nav-btn" disabled={!nav.hasPrev} title="Previous keyframe" onClick={onPrev}><ChevronLeft size={11} strokeWidth={2} /></button>
          <button className={`epp-nav-btn${nav.atExact ? ' epp-nav-btn--active' : ''}`} title="Add/update keyframe at playhead" onClick={onAddKeyframe}><Diamond size={10} strokeWidth={2} /></button>
          <button className="epp-nav-btn" disabled={!nav.hasNext} title="Next keyframe" onClick={onNext}><ChevronRight size={11} strokeWidth={2} /></button>
        </span>
      )}
    </div>
  );
}
