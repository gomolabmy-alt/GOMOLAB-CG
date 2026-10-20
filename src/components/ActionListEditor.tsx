import { Field, VMIX_FUNCTIONS, VMIX_ALL_FNS, InputPickerDropdown, FieldPickerDropdown } from './WidgetConfigPanel';
import { ColorPicker } from './ColorPicker';
import { SliderNumberField } from './SliderNumberField';
import { LogoUrlPicker } from './LogoUrlPicker';
import type { CanvasPage, CanvasWidget } from '../types/canvas';
import type { VmixInput, GlobalVariable } from '../types/vmix';
import { isCgFn, type ActionItem } from '../lib/buttonActions';

// vMix's own SetColor Value param is a single AARRGGBB hex string (alpha
// byte first) — ColorPicker only ever speaks plain 6-digit #rrggbb, so this
// splits one into the other for the combined color+opacity control below,
// and the reverse (buildArgbHex) recombines them back into the one string
// the action's own params.Value actually stores. Same AARRGGBB convention
// TeamFormWidget.tsx's own toArgbHex already documents, generalized to a
// variable alpha byte instead of that helper's hardcoded-opaque 'FF'.
function parseArgbHex(v: string | undefined): { hex: string; alphaPct: number } {
  const clean = (v ?? '').replace('#', '').toUpperCase();
  if (/^[0-9A-F]{8}$/.test(clean)) {
    return { hex: `#${clean.slice(2)}`, alphaPct: Math.round((parseInt(clean.slice(0, 2), 16) / 255) * 100) };
  }
  if (/^[0-9A-F]{6}$/.test(clean)) {
    return { hex: `#${clean}`, alphaPct: 100 };
  }
  return { hex: '#ffffff', alphaPct: 100 };
}
function buildArgbHex(hex: string, alphaPct: number): string {
  const a = Math.round((Math.max(0, Math.min(100, alphaPct)) / 100) * 255);
  return `${a.toString(16).padStart(2, '0').toUpperCase()}${hex.replace('#', '').toUpperCase()}`;
}

// Known, documented value ranges for a handful of vMix functions' own
// "Value" param — keyed by `${fn}.${paramName}` since nothing in
// VMIX_FUNCTIONS' own `p: string[]` shape carries any type/range metadata
// (every param there is just a bare name) and this app has no OTHER
// per-param lookup to extend. Deliberately narrow: only functions whose
// range is already spelled out in that table's own `label` (e.g. "Set
// Volume (0–100)", "Set Balance (-1 to 1)") are listed here — guessing a
// wrong range for something less certain (pan, zoom, gain) would silently
// CLAMP a value an operator actually wanted, which is worse than just
// leaving it a plain text field.
const ACTION_PARAM_SLIDER_RANGES: Record<string, { min: number; max: number; step?: number }> = {
  'SetVolume.Value': { min: 0, max: 100 },
  'SetMasterVolume.Value': { min: 0, max: 100 },
  'SetHeadphonesVolume.Value': { min: 0, max: 100 },
  'SetBalance.Value': { min: -1, max: 1, step: 0.01 },
  // Overall opacity/transparency for ANY input (image, video, camera,
  // title, whatever) — vMix's own documented alpha-byte range, same
  // 0-255 convention SetColor's own ARGB alpha channel already uses above.
  // SetAlpha is the current official name (see WidgetConfigPanel.tsx's own
  // VMIX_FUNCTIONS doc comment); SetInputAlpha is kept there too as a
  // legacy alias, so both get the same slider.
  'SetAlpha.Value': { min: 0, max: 255 },
  'SetInputAlpha.Value': { min: 0, max: 255 },
  'SetFader.Value': { min: 0, max: 255 },
};

// Converts a CONCRETE field name (what FieldPickerDropdown offers — real
// fields that exist right now, e.g. "logo-15.Source" for whichever team
// currently sits in slot 15) into a per-slot TEMPLATE (the `{n}`-token
// convention TournamentManager.tsx's own applySlotTemplate substitutes the
// real slot number into at fire time, e.g. "logo-{n}.Source"). Without
// this, picking a concrete field locked every slot's own action to that
// ONE field — slot 1's, slot 2's, slot 15's, whichever's actions happened
// to fire, would all target the SAME single field, fighting each other
// (what looked like a field "randomly flipping between clear and an
// image" was actually multiple slots' own actions overwriting the same
// field in sequence, every push). Finds the LAST run of digits in the
// name — the slot number vMix's own numbered-field convention always
// places right before an optional ".Text"/".Source"-style suffix — and
// replaces just that with `{n}`, leaving everything else (including a
// literal hyphen/underscore separator some title templates use, e.g.
// "name-1") untouched.
function toSlotTemplate(fieldName: string): string {
  const m = fieldName.match(/^(.*?)(\d+)(\.[A-Za-z]+)?$/);
  if (!m) return fieldName; // no trailing number found — nothing to templatize
  return `${m[1]}{n}${m[3] ?? ''}`;
}

// Functions whose own "Value" param is UNAMBIGUOUSLY free text, never a
// number — the generic "+ Use slider…" control (for a param with no known
// range, further down) must never offer itself here. A text-only field
// accidentally turned into a slider silently sends whatever NUMBER the
// slider happens to be sitting on as the field's literal text (e.g. a
// team-name field sending "38") instead of the text an operator actually
// typed — exactly the bug this list exists to prevent.
const TEXT_ONLY_VALUE_FNS = new Set([
  'SetText', 'SetTextCase',
  // SetDynamicValue1-4 is the current official name (see
  // WidgetConfigPanel.tsx's VMIX_FUNCTIONS); SetDynamic1-4 kept too so an
  // action saved under the old catalog entry still gets the same
  // text-only protection.
  'SetDynamicValue1', 'SetDynamicValue2', 'SetDynamicValue3', 'SetDynamicValue4',
  'SetDynamic1', 'SetDynamic2', 'SetDynamic3', 'SetDynamic4',
  // SetDynamicInput1-4's own Value is an input NAME/key, also text.
  'SetDynamicInput1', 'SetDynamicInput2', 'SetDynamicInput3', 'SetDynamicInput4',
]);

export type { ActionItem };

interface ActionListEditorProps {
  actions: ActionItem[];
  onChange: (next: ActionItem[]) => void;
  sectionKey: string;
  pages: CanvasPage[];
  timerWidgets: CanvasWidget[];
  scoreboardWidgets: CanvasWidget[];
  globalVariables: GlobalVariable[];
  allInputs: VmixInput[];
  /** cg-template widgets from Main Canvas + the CG Template Library —
   *  picker options for a `Cg.In` action's target template. */
  cgTemplateWidgets: CanvasWidget[];
  /** When the CALLER already knows every action in this list targets the
   *  SAME one vMix input (e.g. a Pot List vMix target's own `inputKey`,
   *  which lib/TournamentManager.tsx's applySlotTemplate forces onto every
   *  action regardless of whatever's stored anyway) — hides the per-row
   *  Input picker entirely for any function that targets a named FIELD
   *  within that input (SetText/SetColor/SetImage/SetCountdown/etc. — see
   *  the `vmixDef.p.includes('SelectedName')` check below; functions
   *  WITHOUT a SelectedName param, like Overlay/PTZ, still show a normal
   *  Input picker, since for those "Input" means something else entirely
   *  — which CONTENT to show, not which title to edit), and upgrades that
   *  same function's own field-name param to a real FieldPickerDropdown
   *  scoped to this input, instead of a bare text box — same picker
   *  convenience the Team/Short/Logo prefix fields already have, covering
   *  text fields, image fields, and anything else that input happens to
   *  expose (vMix merges every named field, text or image, into one flat
   *  list — see FieldPickerDropdown's own doc comment). */
  lockedInputKey?: string;
  /** When set alongside `lockedInputKey` — a curated list of named field
   *  options (e.g. a Pot List vMix target's own already-configured "Team
   *  Name"/"Short Name"/"Logo" prefixes, each pre-built into the `{n}`
   *  per-slot template `toSlotTemplate` would otherwise have to derive from
   *  a picked field) — renders as a plain dropdown of THOSE options
   *  instead of FieldPickerDropdown's free browse of every field the whole
   *  input happens to expose. Nothing left to pick beyond "which of the
   *  fields I already set up elsewhere" — no risk of accidentally
   *  targeting some unrelated field this action was never meant to touch,
   *  and no separate `{n}`-templating step needed since every option here
   *  already IS one. Falls back to the free FieldPickerDropdown browse
   *  when this is empty/omitted (every other `lockedInputKey` caller). */
  lockedFieldOptions?: { label: string; template: string }[];
}

// Editor for a list of {fn, params} action items — App.* functions (targeting
// a specific timer/scoreboard widget instance), Cg.* functions (driving CG
// Playout directly), or raw vMix functions. Shared by the Button widget's
// Press/Release/Side-Button action lists and any per-widget "Hotkeys"
// section that wants the same function picker (extracted from
// WidgetConfigPanel so it isn't rebuilt for each use site).
export function ActionListEditor({ actions, onChange, sectionKey, pages, timerWidgets, scoreboardWidgets, globalVariables, allInputs, cgTemplateWidgets, lockedInputKey, lockedFieldOptions }: ActionListEditorProps) {
  const renderFnEditor = (
    action: ActionItem,
    setFn: (fn: string) => void,
    setParam: (k: string, v: string) => void,
    idxKey: string,
  ) => {
    const { fn, params } = action;
    const isApp = fn.startsWith('App.');
    const isCg = isCgFn(fn);
    const vmixDef = VMIX_ALL_FNS.find(f => f.fn === fn);
    const isCustomVmix = !isApp && !isCg && !vmixDef;
    const vmixSelectVal = vmixDef ? fn : '__custom__';

    return (
      <div key={idxKey} className="action-editor">
        <Field label="Type">
          <select className="field-input" value={isApp ? 'app' : isCg ? 'cg' : 'vmix'} onChange={e => {
            if (e.target.value === 'app') setFn('App.GoToPage');
            else if (e.target.value === 'cg') setFn('Cg.In');
            else setFn('Cut');
          }}>
            <option value="vmix">vMix Function</option>
            <option value="app">App Function</option>
            <option value="cg">CG Playout</option>
          </select>
        </Field>

        {isCg ? (
          <>
            <Field label="CG Function">
              <select className="field-input" value={fn} onChange={e => setFn(e.target.value)}>
                <option value="Cg.In">Play In (Load/Play)</option>
                <option value="Cg.Out">Stop (Play Out)</option>
                <option value="Cg.Stage">Next Stage</option>
                <option value="Cg.Loop">Restart Loop</option>
              </select>
            </Field>
            <Field label="Channel">
              <input className="field-input" type="number" min={1} value={params.Channel ?? '1'}
                onChange={e => setParam('Channel', e.target.value)} />
            </Field>
            <Field label="Layer">
              <input className="field-input" type="number" min={1} value={params.Layer ?? '1'}
                onChange={e => setParam('Layer', e.target.value)} />
            </Field>
            {fn === 'Cg.In' && (
              <>
                <Field label="Template">
                  <select className="field-input" value={params.Input ?? ''} onChange={e => setParam('Input', e.target.value)}>
                    <option value="">— select template —</option>
                    {cgTemplateWidgets.map(w => <option key={w.id} value={w.id}>{w.label || 'Untitled'}</option>)}
                  </select>
                </Field>
                <Field label="Destination">
                  <select className="field-input" value={params.Destination ?? 'program'} onChange={e => setParam('Destination', e.target.value)}>
                    <option value="program">Program (play immediately)</option>
                    <option value="preview">Preview (load only)</option>
                  </select>
                </Field>
              </>
            )}
          </>
        ) : isApp ? (
          <>
            <Field label="App Function">
              <select className="field-input" value={fn} onChange={e => setFn(e.target.value)}>
                <optgroup label="Navigation">
                  <option value="App.GoToPage">Go To Page</option>
                </optgroup>
                <optgroup label="Timer">
                  <option value="App.TimerStart">Timer: Start</option>
                  <option value="App.TimerPause">Timer: Pause</option>
                  <option value="App.TimerToggle">Timer: Toggle Start/Pause</option>
                  <option value="App.TimerReset">Timer: Reset</option>
                  <option value="App.TimerEndPeriod">Timer: End Period</option>
                  <option value="App.TimerSkipBreak">Timer: Skip Break</option>
                </optgroup>
                <optgroup label="Scoreboard">
                  <option value="App.ScoreA">Score: Add Team A</option>
                  <option value="App.ScoreB">Score: Add Team B</option>
                  <option value="App.ScoreReset">Score: Reset</option>
                </optgroup>
                <optgroup label="Variable">
                  <option value="App.SetVariable">Set Variable</option>
                </optgroup>
                <optgroup label="App">
                  <option value="App.ToggleEditMode">Toggle Edit Mode</option>
                </optgroup>
                <optgroup label="Timing">
                  <option value="App.Wait">Wait</option>
                </optgroup>
              </select>
            </Field>
            {fn === 'App.Wait' && (
              <Field label="Seconds">
                <input className="field-input" type="number" min={0} step={0.1} value={params.Seconds ?? '1'}
                  onChange={e => setParam('Seconds', e.target.value)} />
              </Field>
            )}
            {fn === 'App.GoToPage' && (
              <Field label="Page">
                <select className="field-input" value={params.Page ?? ''} onChange={e => setParam('Page', e.target.value)}>
                  <option value="">— select page —</option>
                  {pages.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                </select>
              </Field>
            )}
            {['App.TimerStart','App.TimerPause','App.TimerReset','App.TimerToggle','App.TimerEndPeriod','App.TimerSkipBreak'].includes(fn) && (
              <Field label="Timer Widget">
                <select className="field-input" value={params.Input ?? ''} onChange={e => setParam('Input', e.target.value)}>
                  <option value="">— select timer —</option>
                  {timerWidgets.map(w => <option key={w.id} value={w.id}>{w.config.name || 'Timer'}</option>)}
                </select>
              </Field>
            )}
            {(fn === 'App.ScoreReset') && (
              <Field label="Scoreboard Widget">
                <select className="field-input" value={params.Input ?? ''} onChange={e => setParam('Input', e.target.value)}>
                  <option value="">— select scoreboard —</option>
                  {scoreboardWidgets.map(w => <option key={w.id} value={w.id}>{w.config.teamAName} vs {w.config.teamBName}</option>)}
                </select>
              </Field>
            )}
            {(fn === 'App.ScoreA' || fn === 'App.ScoreB') && (
              <>
                <Field label="Scoreboard Widget">
                  <select className="field-input" value={params.Input ?? ''} onChange={e => setParam('Input', e.target.value)}>
                    <option value="">— select scoreboard —</option>
                    {scoreboardWidgets.map(w => <option key={w.id} value={w.id}>{w.config.teamAName} vs {w.config.teamBName}</option>)}
                  </select>
                </Field>
                <Field label="Points">
                  <input className="field-input" type="number" min={1} value={params.Value ?? '1'} onChange={e => setParam('Value', e.target.value)} />
                </Field>
                <Field label="Label (e.g. Try)">
                  <input className="field-input" value={params.Label ?? ''} placeholder="Try, Conv, Pen…" onChange={e => setParam('Label', e.target.value)} />
                </Field>
              </>
            )}
            {fn === 'App.SetVariable' && (
              <>
                <Field label="Variable">
                  <select className="field-input" value={params.Variable ?? ''} onChange={e => setParam('Variable', e.target.value)}>
                    <option value="">— select variable —</option>
                    {globalVariables.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
                  </select>
                </Field>
                <Field label="Value">
                  <input className="field-input" value={params.Value ?? ''} onChange={e => setParam('Value', e.target.value)} />
                </Field>
              </>
            )}
          </>
        ) : (
          <>
            <Field label="vMix Function">
              <select className="field-input" value={vmixSelectVal} onChange={e => {
                if (e.target.value === '__custom__') setFn('');
                else setFn(e.target.value);
              }}>
                {/* Locked to one input (a Pot List vMix target, most
                   notably) — every OTHER function group (Transitions,
                   PTZ, Audio, Replay, etc.) targets something that isn't
                   "an element inside this title" at all, and its own
                   Input param gets force-overridden to this same locked
                   input regardless (see TournamentManager.tsx's own
                   applySlotTemplate), so offering them here is just
                   confusing dead weight — "Cut" as the default new-action
                   function, with its own now-pointless Input picker, is
                   exactly that confusion. Narrowed to 'Title / GT' (every
                   text/image/color/shape-bound-field function vMix has)
                   plus 'Custom…', still reachable for anything this list
                   doesn't name. */}
                {(lockedInputKey ? VMIX_FUNCTIONS.filter(g => g.group === 'Title / GT' || g.group === 'Custom') : VMIX_FUNCTIONS).map(g => (
                  <optgroup key={g.group} label={g.group}>
                    {g.fns.map(f => <option key={f.fn} value={f.fn}>{f.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </Field>
            {isCustomVmix && (
              <Field label="Custom Function">
                <input className="field-input" value={fn} onChange={e => setFn(e.target.value)} placeholder="e.g. SetFader" />
              </Field>
            )}
            {vmixDef && vmixDef.p.map(pk => {
              // Any function's own Input param — not just ones with
              // SelectedName — gets force-overridden to `lockedInputKey`
              // at fire time (applySlotTemplate always does `Input:
              // inputKey`, unconditionally, for every action in a locked
              // list), so showing a picker here for ANY function would be
              // offering a choice that never actually takes effect. Hidden
              // whenever locked, full stop.
              const locksThisInput = !!lockedInputKey;
              if (pk === 'Input') {
                if (locksThisInput) return null; // already fixed by the caller — nothing to pick
                return (
                  <Field key={pk} label="Input">
                    <InputPickerDropdown
                      currentKey={params.Input ?? ''}
                      currentTitle={allInputs.find(i => i.key === (params.Input ?? ''))?.title}
                      allInputs={allInputs}
                      onSelect={(key) => setParam('Input', key)}
                    />
                  </Field>
                );
              }
              // vMix's own "which Mix bus" selector — Mix 1 is the main
              // Program/Preview, Mix 2-16 are independent mini-mixers (see
              // WidgetConfigPanel.tsx's VMIX_FUNCTIONS doc comment on the
              // 'Mix' param for the full explanation). Stored here as the
              // same 1-based number vMix's own UI shows (for readability);
              // vmixApi.ts's own fn() converts it to the real wire format
              // (lowercase `mix`, 0-based) right before sending — see its
              // doc comment for why, confirmed against bitfocus/companion-
              // module-studiocoast-vmix's actual source. No "Selected"
              // option (unlike Companion's own mixSelect field) — Companion
              // resolves that against its own live-tracked "currently
              // focused Mix" state, which this app doesn't keep, so
              // offering it here would just silently do nothing. Left
              // blank/omitted by default so every action created before
              // this field existed keeps firing against Mix 1 exactly as
              // before.
              if (pk === 'Mix') {
                return (
                  <Field key={pk} label="Mix">
                    <select
                      className="field-input"
                      value={params[pk] ?? ''}
                      onChange={e => {
                        const v = e.target.value;
                        // Blank = omit the param entirely (not Mix=""), so
                        // vMix falls back to its own default (Mix 1) exactly
                        // as every action created before this field existed
                        // already does — JSON.stringify drops an `undefined`
                        // property, so routing through __bulk__ here (the
                        // only existing way to replace the whole params
                        // object rather than just set one key) is what
                        // actually removes the key instead of leaving an
                        // empty-string one behind.
                        if (!v) { const { Mix: _drop, ...rest } = params; setParam('__bulk__', JSON.stringify(rest)); }
                        else setParam(pk, v);
                      }}
                    >
                      <option value="">Mix 1 (default)</option>
                      {Array.from({ length: 16 }, (_, i) => i + 1).map(n => (
                        <option key={n} value={n}>Mix {n}</option>
                      ))}
                    </select>
                  </Field>
                );
              }
              if (pk === 'SelectedName' && locksThisInput) {
                if (lockedFieldOptions?.length) {
                  return (
                    <Field key={pk} label="Field">
                      <select className="field-input" value={params[pk] ?? ''} onChange={e => setParam(pk, e.target.value)}>
                        <option value="">— choose field —</option>
                        {lockedFieldOptions.map(opt => <option key={opt.template} value={opt.template}>{opt.label}</option>)}
                      </select>
                    </Field>
                  );
                }
                return (
                  <Field key={pk} label="Field">
                    <FieldPickerDropdown
                      inputKey={lockedInputKey!}
                      value={params[pk] ?? ''}
                      onChange={v => setParam(pk, toSlotTemplate(v))}
                      placeholder="Pick a text/image field…"
                      allInputs={allInputs}
                    />
                  </Field>
                );
              }
              if (fn === 'SetColor' && pk === 'Value') {
                const { hex, alphaPct } = parseArgbHex(params[pk]);
                return (
                  <Field key={pk} label="Color">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <ColorPicker value={hex} onChange={v => setParam(pk, buildArgbHex(v, alphaPct))} />
                        <span className="field-label" style={{ margin: 0 }}>Opacity</span>
                        <SliderNumberField min={0} max={100} value={alphaPct} onChange={v => setParam(pk, buildArgbHex(hex, v))} />
                      </div>
                    </div>
                  </Field>
                );
              }
              // SetImage's own Value — a plain image URL, same thing every
              // logo field across this app already picks via this exact
              // component, instead of typing/pasting a URL by hand.
              if (fn === 'SetImage' && pk === 'Value') {
                return (
                  <Field key={pk} label="Image">
                    <LogoUrlPicker value={params[pk] ?? ''} onChange={v => setParam(pk, v)} placeholder="Pick an image…" />
                  </Field>
                );
              }
              const knownRange = ACTION_PARAM_SLIDER_RANGES[`${fn}.${pk}`];
              if (knownRange) {
                return (
                  <Field key={pk} label={pk}>
                    <SliderNumberField min={knownRange.min} max={knownRange.max} step={knownRange.step} value={Number(params[pk] ?? 0)} onChange={v => setParam(pk, String(v))} />
                  </Field>
                );
              }
              // "Value" with no known range — an operator's OWN custom
              // field (e.g. a specific image layer's opacity property only
              // their own .gtzip title template exposes, which this app has
              // no way to know about ahead of time) can still get a slider,
              // with a range THEY define here, via "+ Use slider…". The
              // range itself lives on `action.valueRange`, never inside
              // `params` — see ActionItem's own doc comment for why.
              if (pk === 'Value' && !TEXT_ONLY_VALUE_FNS.has(fn)) {
                const vr = action.valueRange;
                const setRange = (next: { min: number; max: number; step?: number } | undefined) =>
                  setParam('__range__', next ? JSON.stringify(next) : '');
                return (
                  <Field key={pk} label={pk}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
                      {vr ? (
                        <>
                          <SliderNumberField min={vr.min} max={vr.max} step={vr.step} value={Number(params[pk] ?? vr.min)} onChange={v => setParam(pk, String(v))} />
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <span className="field-label" style={{ margin: 0 }}>Min</span>
                            <input className="field-input" type="number" style={{ width: 70 }} value={vr.min} onChange={e => setRange({ ...vr, min: Number(e.target.value) || 0 })} />
                            <span className="field-label" style={{ margin: 0 }}>Max</span>
                            <input className="field-input" type="number" style={{ width: 70 }} value={vr.max} onChange={e => setRange({ ...vr, max: Number(e.target.value) || 100 })} />
                            <button className="btn btn--ghost btn--small" onClick={() => setRange(undefined)} title="Switch back to typing a value">Remove slider</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <input className="field-input" value={params[pk] ?? ''} onChange={e => setParam(pk, e.target.value)} />
                          <button className="cgo-copy-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setRange({ min: 0, max: 100 })}>+ Use slider…</button>
                        </>
                      )}
                    </div>
                  </Field>
                );
              }
              return (
                <Field key={pk} label={pk}>
                  <input className="field-input" value={params[pk] ?? ''} onChange={e => setParam(pk, e.target.value)} />
                </Field>
              );
            })}
            {isCustomVmix && (
              <Field label="Params (Key=Value)">
                <textarea className="field-input" rows={3}
                  value={Object.entries(params).map(([k,v]) => `${k}=${v}`).join('\n')}
                  onChange={e => {
                    const p: Record<string,string> = {};
                    e.target.value.split('\n').forEach(line => {
                      const [k,...rest] = line.split('=');
                      if (k?.trim()) p[k.trim()] = rest.join('=').trim();
                    });
                    setParam('__bulk__', JSON.stringify(p));
                  }} placeholder="Input=1&#10;Value=Hello" />
              </Field>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <>
      {actions.map((action, i) => (
        <div key={`${sectionKey}-${i}`} className="action-row">
          <div className="action-row-header">
            <span className="action-row-num">#{i + 1}</span>
            <button className="action-row-del" title="Remove" onClick={() => onChange(actions.filter((_, j) => j !== i))}>×</button>
          </div>
          {renderFnEditor(
            action,
            (fn) => onChange(actions.map((a, j) => j === i ? { fn, params: {} } : a)),
            (k, v) => {
              if (k === '__bulk__') {
                onChange(actions.map((a, j) => j === i ? { ...a, params: JSON.parse(v) } : a));
              } else if (k === '__range__') {
                onChange(actions.map((a, j) => j === i ? { ...a, valueRange: v ? JSON.parse(v) : undefined } : a));
              } else {
                onChange(actions.map((a, j) => j === i ? { ...a, params: { ...a.params, [k]: v } } : a));
              }
            },
            `${sectionKey}-${i}`,
          )}
        </div>
      ))}
      <button className="action-add-btn" onClick={() => onChange([...actions, { fn: lockedInputKey ? 'SetText' : 'Cut', params: {} }])}>
        + Add Action
      </button>
    </>
  );
}
