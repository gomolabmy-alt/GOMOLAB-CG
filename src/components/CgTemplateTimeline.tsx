import { useRef } from 'react';
import { X, Diamond, Plus, Rewind, Volume2 } from 'lucide-react';
import { SFX_LIBRARY, playSfx } from '../lib/sfxLibrary';
import { TRACK_PROPERTIES, EASES } from '../lib/cgPresets';
import { parseBezierEase, bezierEaseString, invertEaseName } from '../lib/easeUtils';
import { EFFECT_LABELS, EFFECT_PARAMS, effectTrackKey, parseEffectTrackKey } from '../lib/cgEffects';
import { EaseCurveEditor } from './EaseCurveEditor';
import { KIND_LABEL, orderElementsForDisplay } from '../types/canvas';
import type { CgAnimState, CgKeyframe, CgLayerAnim, TemplateElement } from '../types/canvas';

/** Turns a raw track key into what an operator should actually read — bare
 *  transform/style props (x, opacity, ...) show as-is, but an
 *  `effect:<id>:<field>`-namespaced one (see cgEffects.ts) shows as e.g.
 *  "Drop Shadow: Blur Radius" instead of the raw uuid-bearing key. Falls
 *  back to the raw prop if the effect it names no longer exists (deleted
 *  out from under an still-authored track — same "orphaned but harmless"
 *  handling every other id-reference in this app gets). Shared with
 *  ElementPropertiesPanel.tsx so a track reads identically in both places. */
export function resolveTrackLabel(prop: string, elements: TemplateElement[]): string {
  const parsed = parseEffectTrackKey(prop);
  if (!parsed) return prop;
  for (const el of elements) {
    const fx = (el.config.effects as { id: string; type: keyof typeof EFFECT_LABELS }[] | undefined)?.find((e) => e.id === parsed.effectId);
    if (fx) {
      const param = EFFECT_PARAMS[fx.type]?.find((p) => p.field === parsed.field);
      return `${EFFECT_LABELS[fx.type]}: ${param?.label ?? parsed.field}`;
    }
  }
  return prop;
}

/** Reverses one track's own keyframes IN PLACE (same time span, same two
 *  endpoints' worth of coverage) — mirrors every keyframe's TIME around the
 *  track's own midpoint (`kfs[0].t + kfs[last].t`, not the whole state's
 *  duration — a track that only spans part of the timeline reverses within
 *  its own span, not the state's full length) while keeping each point's
 *  own VALUE attached, and re-derives each segment's ease via
 *  invertEaseName above so the reversed motion doesn't just play the same
 *  values backwards with the SAME (now direction-wrong) easing. The first
 *  (now time-earliest) keyframe's own `ease` is cleared — same convention
 *  addTrack already uses for a track's very first point, which never
 *  carries a meaningful "tween into" ease of its own. A single-keyframe (or
 *  empty) track has nothing to reverse and passes through unchanged. */
function reverseTrackKeyframes(kfs: CgKeyframe[]): CgKeyframe[] {
  const n = kfs.length;
  if (n < 2) return kfs;
  const pivot = kfs[0].t + kfs[n - 1].t;
  const flipped: CgKeyframe[] = kfs
    .map((k) => ({ t: Number((pivot - k.t).toFixed(4)), v: k.v }))
    .reverse();
  for (let i = 1; i < n; i++) {
    flipped[i] = { ...flipped[i], ease: invertEaseName(kfs[n - i].ease) };
  }
  flipped[0] = { ...flipped[0], ease: undefined };
  return flipped;
}

export type TimeUnit = 'seconds' | 'frames';
export type SelectedKf = { layerId: string; prop: string; idx: number };

interface Props {
  state: CgAnimState;
  elements: TemplateElement[];
  onChange: (next: CgAnimState) => void;
  /** Resolves what a brand-new track's starting value should be — walks
   *  back through whichever states/steps play before this one looking for
   *  the last keyframe already set for this exact property, falling back to
   *  `fallback` only once that search is exhausted (see
   *  CgTemplateDesigner.tsx's priorStatesChain/resolveSeedValue) — replaces
   *  a hardcoded `v: 0`, which was wrong for e.g. scale/opacity (identity is
   *  1) and ignored continuity with whatever a prior state already left. */
  getSeedValue: (elementId: string, prop: string, fallback: any) => any;
  playhead: number;
  onScrub: (t: number) => void;
  /** Frames-per-second used only to convert displayed/typed values below —
   *  every stored time (state.duration, keyframe .t, etc.) always stays in
   *  seconds; this never reaches cgAnimationEngine.ts. */
  fps: number;
  timeUnit: TimeUnit;
  /** Called once at the start/end of a keyframe-diamond drag gesture (not
   *  on every pointer-move, which still goes through onChange as before) —
   *  lets CgTemplateDesigner.tsx's undo history coalesce a whole drag into
   *  a single undo step instead of one per pixel moved. */
  onDragStart?: () => void;
  onDragEnd?: () => void;
  /** Which keyframe's t/v editor is showing — lifted up to
   *  CgTemplateDesigner.tsx (rather than local state) so a canvas drag can
   *  know which keyframe, if any, to target (see its drag-to-set-position
   *  feature) and so selecting a keyframe here can seek the canvas there. */
  selectedKf: SelectedKf | null;
  onSelectKeyframe: (kf: SelectedKf | null) => void;
  /** Overrides .tplt's own CSS default (230px) — CgTemplateDesigner.tsx's
   *  own drag handle above this panel adjusts this, persisted per
   *  appSettingsStore.ts's cgTimelinePanelHeight so it stays put across
   *  sessions, same convention CgMonitorBar.tsx's own resize handle
   *  already uses for its box height. */
  height?: number;
}

const PX_PER_SEC = 160;
// Must match .tplt-track-name's CSS width — every keyframe-mode track row
// reserves this much space for its property-name label before its lane
// begins, so the ruler (which has no such label) needs the same left inset
// on its own drawing (stops/playhead line) to share one coordinate origin
// with every lane below it. Without this, the playhead line and every
// keyframe diamond are drawn against two different x=0 points and never
// line up, even though both use the identical `t * PX_PER_SEC` formula.
const LABEL_WIDTH = 116;

// The visual keyframe timeline — ported (functionally, not pixel-for-pixel)
// from gfx-studio-2's designer: a ruler + one row per animated element
// (sub-rows per property in Keyframes mode), draggable diamond keyframes,
// stop-point markers. Preset-mode rows show a plain delay→delay+duration
// span (edited via the numeric Duration/Delay fields in the inspector,
// rather than by dragging the bar itself — the one simplification versus
// the reference app's fully-draggable preset bars).
export function CgTemplateTimeline({ state, elements, onChange, getSeedValue, playhead, onScrub, fps, timeUnit, onDragStart, onDragEnd, selectedKf, onSelectKeyframe, height }: Props) {
  const width = Math.max(240, state.duration * PX_PER_SEC);
  // Rows read top-to-bottom in the same order the Layers panel lists
  // elements (orderElementsForDisplay — reversed z-stack, children right
  // after their own parent), not `state.layers`'s own array order (whichever
  // sequence the operator happened to turn animation on for each element
  // in) — those two could easily disagree, showing the same set of
  // elements in two different sequences even though each row's own LABEL
  // TEXT already matched (see KIND_LABEL's doc comment for that earlier,
  // separate bug). A layer entry whose element was since deleted has no
  // position to sort by — those still render, just appended at the end
  // rather than disappearing.
  const orderedLayers = [
    ...orderElementsForDisplay(elements)
      .map((el) => state.layers.find((la) => la.id === el.id))
      .filter((la): la is CgLayerAnim => !!la),
    ...state.layers.filter((la) => !elements.some((el) => el.id === la.id)),
  ];
  const rulerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<{ layerId: string; prop: string; idx: number } | null>(null);

  // Seconds are the only unit ever stored/played back — these just govern
  // what a number input shows and how its typed value gets converted back.
  const toDisplay = (s: number) => (timeUnit === 'frames' ? Math.round(s * fps) : Number(s.toFixed(2)));
  const fromDisplay = (v: number) => (timeUnit === 'frames' ? v / fps : v);
  const unitLabel = timeUnit === 'frames' ? 'frames' : 's';
  const unitStep = timeUnit === 'frames' ? 1 : 0.05;

  const timeFromClientX = (clientX: number) => {
    const rect = rulerRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(state.duration, (clientX - rect.left - LABEL_WIDTH) / PX_PER_SEC));
  };

  // Scrubbing works from anywhere in the timeline now — the ruler AND the
  // track rows below it, not just the thin top bar — same as After Effects,
  // where clicking/dragging anywhere in the Timeline panel moves the
  // current-time indicator. Pointer events (not mouse events, as this used
  // to be) specifically so a keyframe diamond's own onPointerDown
  // (dragKfDown, below) reliably stopPropagation()s THIS same event type
  // and never races it — a mix of mouse+pointer events on the same
  // gesture doesn't respect each other's stopPropagation() at all, since
  // they're independently-dispatched events. draggingRef is also checked
  // directly (not just relying on propagation) since a captured pointer's
  // later move/up events still bubble to this parent even after capture.
  const scrubDown = (e: React.PointerEvent) => {
    if (draggingRef.current) return;
    if ((e.target as HTMLElement).closest('button, select, input')) return;
    onScrub(timeFromClientX(e.clientX));
  };
  const scrubMove = (e: React.PointerEvent) => {
    if (draggingRef.current || e.buttons !== 1) return;
    onScrub(timeFromClientX(e.clientX));
  };

  const updateLayerAnim = (id: string, patch: Partial<CgLayerAnim>) =>
    onChange({ ...state, layers: state.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) });

  const addStop = () => onChange({ ...state, stops: [...(state.stops ?? []), Number(playhead.toFixed(2))].sort((a, b) => a - b) });
  const removeStop = (t: number) => onChange({ ...state, stops: (state.stops ?? []).filter((s) => s !== t) });

  const addKeyframeAtPlayhead = (la: CgLayerAnim) => {
    if (!la.tracks) return;
    const tracks: Record<string, CgKeyframe[]> = {};
    for (const [prop, kfs] of Object.entries(la.tracks)) {
      const before = [...kfs].reverse().find((k) => k.t <= playhead);
      const v = before ? before.v : kfs[0]?.v ?? 0;
      tracks[prop] = [...kfs, { t: Number(playhead.toFixed(2)), v }].sort((a, b) => a.t - b.t);
    }
    updateLayerAnim(la.id, { tracks });
  };

  const addTrack = (la: CgLayerAnim, prop: string) => {
    if (!prop || la.tracks?.[prop]) return;
    // Both ends start at whatever the sequence already leaves this property
    // at (see getSeedValue's own doc) — a flat, unanimated 2-point track by
    // default, so adding a property never causes a visible jump until the
    // operator actually edits one of its keyframes.
    const seed = getSeedValue(la.id, prop, 0);
    const tracks = { ...(la.tracks ?? {}), [prop]: [{ t: 0, v: seed }, { t: Math.min(0.5, state.duration), v: seed, ease: 'power2.out' }] as CgKeyframe[] };
    updateLayerAnim(la.id, { tracks });
  };

  /** Not-yet-tracked effect-parameter keys for one element — the "+ Track"
   *  list's own addition to the plain TRACK_PROPERTIES entries, so an
   *  effect's blur radius/offset/color etc. can be keyframed the exact same
   *  way any transform property already can. */
  const effectTrackOptions = (la: CgLayerAnim): { key: string; label: string }[] => {
    const el = elements.find((e) => e.id === la.id);
    const effects = (el?.config.effects as { id: string; type: keyof typeof EFFECT_LABELS }[] | undefined) ?? [];
    const options: { key: string; label: string }[] = [];
    effects.forEach((fx) => {
      EFFECT_PARAMS[fx.type]?.forEach((param) => {
        const key = effectTrackKey(fx.id, param.field);
        if (!la.tracks?.[key]) options.push({ key, label: `${EFFECT_LABELS[fx.type]}: ${param.label}` });
      });
    });
    return options;
  };
  const removeTrack = (la: CgLayerAnim, prop: string) => {
    if (!la.tracks) return;
    const tracks = { ...la.tracks };
    delete tracks[prop];
    updateLayerAnim(la.id, { tracks });
  };
  // Per-track "reverse" — see reverseTrackKeyframes' own doc comment.
  // Independent of the sibling "remove" button; toggling it again reverses
  // right back (the operation is its own inverse), so there's no separate
  // undo-this-specific-action affordance needed beyond the app's own
  // regular undo history.
  const reverseTrack = (la: CgLayerAnim, prop: string) => {
    const kfs = la.tracks?.[prop];
    if (!kfs || kfs.length < 2) return;
    updateLayerAnim(la.id, { tracks: { ...la.tracks, [prop]: reverseTrackKeyframes(kfs) } });
  };

  const dragKfDown = (e: React.PointerEvent, layerId: string, prop: string, idx: number) => {
    e.stopPropagation();
    onDragStart?.();
    draggingRef.current = { layerId, prop, idx };
    onSelectKeyframe({ layerId, prop, idx });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const dragKfMove = (e: React.PointerEvent) => {
    const d = draggingRef.current;
    if (!d) return;
    const la = state.layers.find((l) => l.id === d.layerId);
    const kfs = la?.tracks?.[d.prop];
    if (!la || !kfs) return;
    const t = timeFromClientX(e.clientX);
    const next = kfs.map((k, i) => (i === d.idx ? { ...k, t } : k));
    updateLayerAnim(la.id, { tracks: { ...la.tracks, [d.prop]: next } });
  };
  const dragKfUp = () => {
    const d = draggingRef.current;
    draggingRef.current = null;
    onDragEnd?.();
    if (!d) return;
    const la = state.layers.find((l) => l.id === d.layerId);
    const kfs = la?.tracks?.[d.prop];
    if (!la || !kfs) return;
    const sorted = [...kfs].sort((a, b) => a.t - b.t);
    updateLayerAnim(la.id, { tracks: { ...la.tracks, [d.prop]: sorted } });
  };

  // Dragging a 'sound' layer's own single marker — same pointer-capture
  // convention as dragKfDown/Move/Up just above (stopPropagation so the
  // ruler/lane's own scrub-to-set-playhead handler on the ancestor
  // .tplt-scroll never also fires for this same gesture), just against
  // `delay` directly instead of one keyframe in a `tracks` entry — a sound
  // layer has no tracks at all to index into.
  const draggingSoundRef = useRef<string | null>(null);
  const dragSoundDown = (e: React.PointerEvent, layerId: string) => {
    e.stopPropagation();
    onDragStart?.();
    draggingSoundRef.current = layerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const dragSoundMove = (e: React.PointerEvent) => {
    const layerId = draggingSoundRef.current;
    if (!layerId) return;
    updateLayerAnim(layerId, { delay: Number(timeFromClientX(e.clientX).toFixed(3)) });
  };
  const dragSoundUp = () => {
    if (!draggingSoundRef.current) return;
    draggingSoundRef.current = null;
    onDragEnd?.();
  };

  const selectedKfData = selectedKf
    ? state.layers.find((l) => l.id === selectedKf.layerId)?.tracks?.[selectedKf.prop]?.[selectedKf.idx]
    : null;

  return (
    <div className="tplt" style={height != null ? { height } : undefined}>
      <div className="tplt-toolbar">
        <label>Duration ({unitLabel}) <input type="number" min={timeUnit === 'frames' ? 1 : 0.1} step={unitStep} className="field-input" style={{ width: 60 }}
          value={toDisplay(state.duration)}
          onChange={(e) => onChange({ ...state, duration: Math.max(0.1, fromDisplay(Number(e.target.value)) || state.duration) })} /></label>
        <button className="cgo-copy-btn" onClick={addStop}>◆ Add stop at playhead</button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
          <input type="checkbox" checked={!!state.loop} onChange={(e) => onChange({ ...state, loop: e.target.checked })} /> Loop
        </label>
        {state.loop && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
            <input type="checkbox" checked={!!state.yoyo} onChange={(e) => onChange({ ...state, yoyo: e.target.checked })} /> Yoyo
          </label>
        )}
        <span className="tplt-playhead">t = {timeUnit === 'frames' ? `${toDisplay(playhead)}f` : `${playhead.toFixed(2)}s`}</span>
      </div>

      <div className="tplt-scroll" onPointerDown={scrubDown} onPointerMove={scrubMove}>
        <div
          ref={rulerRef}
          className="tplt-ruler"
          style={{ width: width + LABEL_WIDTH }}
        >
          {(state.stops ?? []).map((s) => (
            <div key={s} className="tplt-stop" style={{ left: LABEL_WIDTH + s * PX_PER_SEC }} title={`Stop at ${timeUnit === 'frames' ? `${toDisplay(s)}f` : `${s}s`} — click to remove`}
              onClick={(e) => { e.stopPropagation(); removeStop(s); }} />
          ))}
          <div className="tplt-playhead-line" style={{ left: LABEL_WIDTH + playhead * PX_PER_SEC }}>
            {/* AE-style timecode badge riding along with the current-time
               indicator — always visible, not just while dragging, so
               scrubbing anywhere (including far down in the track rows,
               away from the toolbar's own t=... readout) always shows
               exactly where you landed. */}
            <span className="tplt-playhead-badge">{timeUnit === 'frames' ? `${toDisplay(playhead)}f` : `${playhead.toFixed(2)}s`}</span>
          </div>
        </div>

        <div className="tplt-rows" style={{ width: width + LABEL_WIDTH }}>
          {state.layers.length === 0 && <div className="tplt-empty">No animated elements in this state yet — click "+ Add Animation" above for the selected element.</div>}
          {orderedLayers.map((la) => {
            const el = elements.find((e) => e.id === la.id);
            // Matches CgTemplateDesigner.tsx's Layers panel exactly (same
            // el.name-or-"{Kind} {index+1}" fallback, same index — this
            // element's position in the FULL flat elements array, not a
            // per-kind counter) — previously showed a text element's own
            // CONTENT, or a bare kind string for anything else, neither of
            // which is what that element is actually called anywhere else
            // in the designer. An orphaned layer entry (el missing — the
            // element itself was deleted) still falls back to its id.
            const label = el ? (el.name || `${KIND_LABEL[el.kind]} ${elements.indexOf(el) + 1}`) : la.id.slice(0, 6);
            // A preset and keyframe tracks are independent and can coexist
            // on the same layer (see CgLayerAnim's own doc comment) — this
            // one group always shows BOTH when present: the preset's own
            // delay→delay+duration span first (if any), then every track
            // row, in the SAME element group rather than needing two
            // separate "layer" entries or a destructive mode switch between
            // them.
            const hasPreset = !!la.preset && la.preset !== 'none';
            const trackEntries = Object.entries(la.tracks ?? {});
            // A 'sound' layer has no preset/tracks at all (see
            // TemplateElement's own doc comment on the 'sound' kind) — just
            // one draggable marker showing when its chosen effect fires,
            // instead of the whole preset-bar/track/"+Track"/"+Keyframe"
            // apparatus every other kind gets.
            if (el?.kind === 'sound') {
              const sfxLabel = la.sfxId ? (SFX_LIBRARY.find((s) => s.id === la.sfxId)?.label ?? la.sfxId) : null;
              return (
                <div key={la.id} className="tplt-layer-group">
                  <div className="tplt-layer-label">
                    {label}
                    {sfxLabel && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> ({sfxLabel})</span>}
                  </div>
                  <div className="tplt-track-row">
                    <span className="tplt-track-name" />
                    <div className="tplt-track-lane" style={{ width }}>
                      {la.sfxId && (
                        <div
                          className="tplt-sound-marker"
                          style={{ left: (la.delay ?? 0) * PX_PER_SEC }}
                          onPointerDown={(e) => dragSoundDown(e, la.id)}
                          onPointerMove={dragSoundMove}
                          onPointerUp={dragSoundUp}
                          title={`Plays "${sfxLabel}" at t=${timeUnit === 'frames' ? `${toDisplay(la.delay ?? 0)}f` : (la.delay ?? 0).toFixed(2)} — drag to reposition`}
                        ><Volume2 size={11} strokeWidth={2} /></div>
                      )}
                    </div>
                  </div>
                </div>
              );
            }
            return (
              <div key={la.id} className="tplt-layer-group">
                <div className="tplt-layer-label">
                  {label}
                  {hasPreset && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> ({la.preset})</span>}
                  <select className="tplt-add-track" value="" onChange={(e) => { addTrack(la, e.target.value); }}>
                    <option value="">+ Track…</option>
                    {TRACK_PROPERTIES.filter((p) => !la.tracks?.[p]).map((p) => <option key={p} value={p}>{p}</option>)}
                    {effectTrackOptions(la).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                </div>
                {hasPreset && (
                  <div className="tplt-track-row">
                    {/* Empty spacer matching .tplt-track-name's width — keeps
                       this lane starting at the same x as every track row
                       (and the ruler above), even though the preset span has
                       no per-property label of its own to show here. */}
                    <span className="tplt-track-name" />
                    <div className="tplt-track-lane" style={{ width }}>
                      <div className="tplt-preset-bar" style={{ left: (la.delay ?? 0) * PX_PER_SEC, width: Math.max(4, (la.duration ?? 0.5) * PX_PER_SEC) }} />
                    </div>
                  </div>
                )}
                {trackEntries.map(([prop, kfs]) => (
                  <div key={prop} className="tplt-track-row">
                    <span className="tplt-track-name">
                      {resolveTrackLabel(prop, elements)}
                      <button className="tplt-track-reverse" disabled={kfs.length < 2}
                        title="Reverse this track's own keyframes in place — same time span, playing backwards (eases flip direction too)"
                        onClick={() => reverseTrack(la, prop)}><Rewind size={10} strokeWidth={2} /></button>
                      <button className="tplt-track-remove" onClick={() => removeTrack(la, prop)}><X size={10} strokeWidth={2} /></button>
                    </span>
                    <div className="tplt-track-lane" style={{ width }}>
                      {kfs.map((kf, idx) => (
                        <div
                          key={idx}
                          className={`tplt-diamond${selectedKf?.layerId === la.id && selectedKf.prop === prop && selectedKf.idx === idx ? ' tplt-diamond--selected' : ''}`}
                          style={{ left: kf.t * PX_PER_SEC }}
                          onPointerDown={(e) => dragKfDown(e, la.id, prop, idx)}
                          onPointerMove={dragKfMove}
                          onPointerUp={dragKfUp}
                          title={`t=${timeUnit === 'frames' ? `${toDisplay(kf.t)}f` : kf.t.toFixed(2)} v=${kf.v}`}
                        ><Diamond size={10} strokeWidth={2} /></div>
                      ))}
                    </div>
                  </div>
                ))}
                <button className="tplt-add-kf" disabled={trackEntries.length === 0} onClick={() => addKeyframeAtPlayhead(la)}><Plus size={11} strokeWidth={2} /> Keyframe at playhead</button>
              </div>
            );
          })}
        </div>
      </div>

      {selectedKf && selectedKfData && (
        <div className="tplt-kf-editor">
          {(() => {
            const updateSelectedKfEase = (ease: string) => {
              const la = state.layers.find((l) => l.id === selectedKf.layerId)!;
              const kfs = la.tracks![selectedKf.prop].map((k, i) => (i === selectedKf.idx ? { ...k, ease } : k));
              updateLayerAnim(la.id, { tracks: { ...la.tracks, [selectedKf.prop]: kfs } });
            };
            const bezier = parseBezierEase(selectedKfData.ease);
            return (
              <>
                <label>ease
                  <select className="field-input" style={{ width: 116 }}
                    value={bezier ? 'custom' : (selectedKfData.ease ?? 'power2.out')}
                    onChange={(e) => updateSelectedKfEase(e.target.value === 'custom' ? bezierEaseString(...(bezier ?? [0.25, 0.1, 0.25, 1])) : e.target.value)}>
                    {EASES.map((e2) => <option key={e2} value={e2}>{e2}</option>)}
                    <option value="custom">Custom curve…</option>
                  </select>
                </label>
                {bezier && <EaseCurveEditor value={bezier} onChange={(v) => updateSelectedKfEase(bezierEaseString(...v))} />}
              </>
            );
          })()}
          <label>t ({unitLabel}) <input type="number" step={unitStep} className="field-input" style={{ width: 60 }}
            value={toDisplay(selectedKfData.t)}
            onChange={(e) => {
              const la = state.layers.find((l) => l.id === selectedKf.layerId)!;
              const t = fromDisplay(Number(e.target.value));
              const kfs = la.tracks![selectedKf.prop].map((k, i) => (i === selectedKf.idx ? { ...k, t } : k));
              updateLayerAnim(la.id, { tracks: { ...la.tracks, [selectedKf.prop]: kfs } });
            }} /></label>
          <label>value <input className="field-input" style={{ width: 90 }}
            value={String(selectedKfData.v)}
            onChange={(e) => {
              const la = state.layers.find((l) => l.id === selectedKf.layerId)!;
              const raw = e.target.value;
              const v = raw !== '' && !isNaN(Number(raw)) ? Number(raw) : raw;
              const kfs = la.tracks![selectedKf.prop].map((k, i) => (i === selectedKf.idx ? { ...k, v } : k));
              updateLayerAnim(la.id, { tracks: { ...la.tracks, [selectedKf.prop]: kfs } });
            }} /></label>
          <button className="cgo-copy-btn" onClick={() => {
            const la = state.layers.find((l) => l.id === selectedKf.layerId)!;
            const kfs = la.tracks![selectedKf.prop].filter((_, i) => i !== selectedKf.idx);
            updateLayerAnim(la.id, { tracks: { ...la.tracks, [selectedKf.prop]: kfs } });
            onSelectKeyframe(null);
          }}><X size={12} strokeWidth={2} /> Remove keyframe</button>
        </div>
      )}
    </div>
  );
}
