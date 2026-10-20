import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Pencil, Plus, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { useAppSettings, type QuickButtonDef, type QuickSideButtonDef } from '../stores/appSettingsStore';
import { useVmixStore } from '../stores/vmixStore';
import { useCanvasStore } from '../stores/canvasStore';
import { CollapsibleSection, CardSelect, Field } from './WidgetConfigPanel';
import { ActionListEditor } from './ActionListEditor';
import { ColorPicker } from './ColorPicker';
import { deriveToggleOn, runButtonPress, runButtonRelease } from '../lib/buttonActions';
import { syncClient } from '../lib/syncClient';

const MIN_BTN_W = 60;
const MIN_BTN_H = 28;
const DEFAULT_BTN_W = 120;
const DEFAULT_BTN_H = 34;

// A Quick Button fires through the exact same lib/buttonActions.ts
// machinery a real canvas Button widget uses (runButtonPress/
// runButtonRelease/deriveToggleOn) — same behavior as a canvas button,
// just not tied to any one page/widget instance.
//
// Resize (editMode only): a hand-rolled pointer-drag handle, same
// setPointerCapture technique the button's own press/release already uses
// just below — NOT the plain native CSS `resize: both` TournamentManager.tsx's
// own floating window uses. That native approach silently did nothing here:
// WKWebView (Tauri's engine on macOS) doesn't reliably render/honor a
// resize handle on a `<button>` (a form-control element) the way it does on
// a plain block-level `<div>`, so nothing was ever actually resized to
// persist in the first place — this bypasses that entirely by tracking the
// drag ourselves and writing the final size straight into appSettingsStore.
function QuickButton({ btn, editMode, onEdit, onRemove, onResize }: {
  btn: QuickButtonDef; editMode: boolean; onEdit: () => void; onRemove: () => void; onResize: (w: number, h: number) => void;
}) {
  const vmixState = useVmixStore((s) => s.vmixState);
  const [firing, setFiring] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const resizeRef = useRef({ active: false, ox: 0, oy: 0, iw: 0, ih: 0 });
  const actions = btn.actions ?? [];
  const releaseActions = btn.releaseActions ?? [];
  const isOn = btn.mode === 'toggle' ? deriveToggleOn([...actions, ...releaseActions], vmixState) : firing;

  const handleDown = async () => {
    if (editMode) return;
    if (btn.mode !== 'toggle') setFiring(true);
    await runButtonPress(btn);
  };
  const handleUp = async () => {
    if (editMode) return;
    if (btn.mode !== 'toggle') {
      setFiring(false);
      await runButtonRelease(btn);
    }
  };

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeRef.current = {
      active: true, ox: e.clientX, oy: e.clientY,
      iw: btn.width ?? btnRef.current?.offsetWidth ?? DEFAULT_BTN_W,
      ih: btn.height ?? btnRef.current?.offsetHeight ?? DEFAULT_BTN_H,
    };
  };
  const moveResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current.active) return;
    const w = Math.max(MIN_BTN_W, Math.round(resizeRef.current.iw + (e.clientX - resizeRef.current.ox)));
    const h = Math.max(MIN_BTN_H, Math.round(resizeRef.current.ih + (e.clientY - resizeRef.current.oy)));
    onResize(w, h);
  };
  const endResize = (e: React.PointerEvent<HTMLDivElement>) => {
    resizeRef.current.active = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const sideButtons = btn.sideButtons ?? [];
  const inside = btn.sideButtonStyle === 'inside';

  return (
    <div className="qb-btn-group">
      {/* Edit controls/resize handle anchor to THIS wrap specifically (just
          the main button) — not the whole group — so resizing/removing
          targets the main button alone regardless of how many side pills
          are attached next to it. */}
      <div className="qb-wrap">
        <button
          ref={btnRef}
          className={`qb-btn ${firing ? 'qb-btn--fire' : ''} ${isOn ? 'qb-btn--on' : ''} ${editMode ? 'qb-btn--editing' : ''} ${inside && sideButtons.length ? 'qb-btn--has-inside-pills' : ''}`}
          style={{
            '--bc': btn.color ?? '#3498db', '--tc': btn.textColor ?? '#fff',
            width: btn.width ? `${btn.width}px` : undefined,
            height: btn.height ? `${btn.height}px` : undefined,
          } as React.CSSProperties}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); handleDown(); }}
          onPointerUp={handleUp}
          onPointerCancel={() => setFiring(false)}
        >
          {btn.mode === 'toggle' && <span className="wgt-btn-dot" />}
          {btn.label || 'Button'}
          {/* 'inside' style — side pills overlaid INSIDE this same button's
              own box (bottom-right corner) instead of sitting next to it as
              a flex sibling below. */}
          {inside && sideButtons.length > 0 && (
            <div className="qb-inside-pills">
              {sideButtons.map((sb) => (
                <QuickSideButtonPill key={sb.id} sb={sb} editMode={editMode} parentColor={btn.color} parentTextColor={btn.textColor} inside />
              ))}
            </div>
          )}
        </button>
        {editMode && (
          <>
            <div className="qb-edit-controls">
              <button className="qb-edit-btn" title="Edit button (label, color, actions, side buttons)" onClick={onEdit}><Pencil size={11} strokeWidth={2} /></button>
              <button className="qb-edit-btn" title="Remove button" onClick={onRemove}><X size={11} strokeWidth={2} /></button>
            </div>
            <div
              className="qb-resize-handle"
              title="Drag to resize"
              onPointerDown={startResize}
              onPointerMove={moveResize}
              onPointerUp={endResize}
              onPointerCancel={endResize}
            />
          </>
        )}
      </div>
      {!inside && sideButtons.map((sb) => (
        <QuickSideButtonPill key={sb.id} sb={sb} editMode={editMode} parentColor={btn.color} parentTextColor={btn.textColor} />
      ))}
    </div>
  );
}

// A small pill tag attached to the main button — NOT a second independent
// button, so it has no color of its own; always renders in the PARENT
// QuickButtonDef's own color/textColor (parentColor/parentTextColor,
// passed down from QuickButton below) so it visually reads as part of the
// same control rather than a separate peer sitting next to it. Still fires
// independently via the exact same runButtonPress/runButtonRelease/
// deriveToggleOn machinery as the main button.
//
// A plain clickable <div> (role="button"), not a real <button> — the
// 'inside' placement style (see QuickButton below) nests this INSIDE the
// main button's own <button> element, and a <button> nested inside another
// <button> is invalid HTML that browsers silently mangle; a div with the
// same pointer handlers behaves identically here with no such restriction.
// stopPropagation on every pointer event is what keeps a tap on this pill,
// while nested inside the main button, from ALSO bubbling up and firing
// the main button's own press/release.
function QuickSideButtonPill({ sb, editMode, parentColor, parentTextColor, inside }: {
  sb: QuickSideButtonDef; editMode: boolean; parentColor?: string; parentTextColor?: string; inside?: boolean;
}) {
  const vmixState = useVmixStore((s) => s.vmixState);
  const [firing, setFiring] = useState(false);
  const actions = sb.actions ?? [];
  const releaseActions = sb.releaseActions ?? [];
  const isOn = sb.mode === 'toggle' ? deriveToggleOn([...actions, ...releaseActions], vmixState) : firing;

  const handleDown = async () => {
    if (editMode) return;
    if (sb.mode !== 'toggle') setFiring(true);
    await runButtonPress(sb);
  };
  const handleUp = async () => {
    if (editMode) return;
    if (sb.mode !== 'toggle') {
      setFiring(false);
      await runButtonRelease(sb);
    }
  };

  return (
    <div
      role="button" tabIndex={0}
      className={`qb-btn-side-pill${inside ? ' qb-btn-side-pill--inside' : ''} ${firing ? 'qb-btn--fire' : ''} ${isOn ? 'qb-btn-side-pill--on' : ''}`}
      style={{ '--bc': parentColor ?? '#3498db', '--tc': parentTextColor ?? '#fff' } as React.CSSProperties}
      onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); handleDown(); }}
      onPointerUp={(e) => { e.stopPropagation(); handleUp(); }}
      onPointerCancel={(e) => { e.stopPropagation(); setFiring(false); }}
    >
      {sb.mode === 'toggle' && <span className="wgt-btn-dot" />}
      {sb.label || '—'}
    </div>
  );
}

function QuickButtonEditorModal({ btn, onSave, onClose }: {
  btn: QuickButtonDef; onSave: (next: QuickButtonDef) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState<QuickButtonDef>(btn);
  const [sbCollapsed, setSbCollapsed] = useState<Record<string, boolean>>({});
  const { pages, libraryPages } = useCanvasStore();
  const { globalVariables, vmixState } = useVmixStore();
  const allInputs = vmixState?.inputs ?? [];
  const timerWidgets = pages.flatMap((p) => p.widgets.filter((w) => w.type === 'timer'));
  const scoreboardWidgets = pages.flatMap((p) => p.widgets.filter((w) => w.type === 'scoreboard'));
  const cgTemplateWidgets = [...pages, ...libraryPages].flatMap((p) => p.widgets.filter((w) => w.type === 'cg-template'));

  const patch = (p: Partial<QuickButtonDef>) => setDraft((d) => ({ ...d, ...p }));

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560, maxHeight: '85vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Edit Quick Button</h3>
        <Field label="Label">
          <input className="field-input" value={draft.label} onChange={(e) => patch({ label: e.target.value })} />
        </Field>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', margin: '8px 0', flexWrap: 'wrap' }}>
          <Field label="Color">
            <ColorPicker value={draft.color ?? '#3498db'} onChange={(v) => patch({ color: v })} />
          </Field>
          <Field label="Text Color">
            <ColorPicker value={draft.textColor ?? '#ffffff'} onChange={(v) => patch({ textColor: v })} />
          </Field>
          <Field label="Mode">
            <CardSelect value={draft.mode ?? 'momentary'} onChange={(v) => patch({ mode: v })}
              options={[{ value: 'momentary', label: 'Momentary' }, { value: 'toggle', label: 'Toggle' }]} />
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', margin: '8px 0' }}>
          <Field label="Width (px)">
            <input className="field-input" type="number" min={MIN_BTN_W} style={{ width: 90 }}
              placeholder="auto" value={draft.width ?? ''}
              onChange={(e) => patch({ width: e.target.value ? Math.max(MIN_BTN_W, Number(e.target.value)) : undefined })} />
          </Field>
          <Field label="Height (px)">
            <input className="field-input" type="number" min={MIN_BTN_H} style={{ width: 90 }}
              placeholder="auto" value={draft.height ?? ''}
              onChange={(e) => patch({ height: e.target.value ? Math.max(MIN_BTN_H, Number(e.target.value)) : undefined })} />
          </Field>
          <p className="app-settings-hint" style={{ margin: 0 }}>Or drag the button's own bottom-right corner while in edit mode.</p>
        </div>

        <CollapsibleSection label="Press Actions">
          <ActionListEditor actions={draft.actions ?? []} onChange={(next) => patch({ actions: next })} sectionKey="qb-press"
            pages={pages} timerWidgets={timerWidgets} scoreboardWidgets={scoreboardWidgets}
            globalVariables={globalVariables} allInputs={allInputs} cgTemplateWidgets={cgTemplateWidgets} />
        </CollapsibleSection>

        <CollapsibleSection label="Release Actions">
          <ActionListEditor actions={draft.releaseActions ?? []} onChange={(next) => patch({ releaseActions: next })} sectionKey="qb-release"
            pages={pages} timerWidgets={timerWidgets} scoreboardWidgets={scoreboardWidgets}
            globalVariables={globalVariables} allInputs={allInputs} cgTemplateWidgets={cgTemplateWidgets} />
        </CollapsibleSection>

        <CollapsibleSection label="Side Buttons" defaultOpen={false}>
          {(() => {
            const sideButtons = draft.sideButtons ?? [];
            const updateSb = (i: number, p: Partial<QuickSideButtonDef>) =>
              patch({ sideButtons: sideButtons.map((sb, j) => (j === i ? { ...sb, ...p } : sb)) });
            return (
              <>
                <Field label="Placement">
                  <CardSelect value={draft.sideButtonStyle ?? 'outside'} onChange={(v) => patch({ sideButtonStyle: v })}
                    options={[
                      { value: 'outside', label: 'Outside', sub: 'Own pill next to the button' },
                      { value: 'inside', label: 'Inside', sub: 'Badge overlaid on the button itself' },
                    ]} />
                </Field>
                {sideButtons.map((sb, i) => {
                  const isCollapsed = sbCollapsed[sb.id] ?? false;
                  return (
                    <div key={sb.id} className="vil-cfg-block">
                      <div className="vil-cfg-header">
                        <button className="btn btn--ghost btn--small tf-collapse-btn"
                          onClick={() => setSbCollapsed((p) => ({ ...p, [sb.id]: !p[sb.id] }))}>
                          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                        </button>
                        <span className="vil-cfg-label">{sb.label || `Button ${i + 1}`}</span>
                        <button className="btn btn--ghost btn--small"
                          onClick={() => patch({ sideButtons: sideButtons.filter((_, j) => j !== i) })}>×</button>
                      </div>
                      {!isCollapsed && (
                        <>
                          <Field label="Label">
                            <input className="field-input" value={sb.label} onChange={(e) => updateSb(i, { label: e.target.value })} />
                          </Field>
                          <p className="app-settings-hint" style={{ margin: '0 0 8px' }}>A side button is a small pill tag on the main button, not a separate colored button — it always follows the main button's own color.</p>
                          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', margin: '8px 0', flexWrap: 'wrap' }}>
                            <Field label="Mode">
                              <CardSelect value={sb.mode ?? 'momentary'} onChange={(v) => updateSb(i, { mode: v })}
                                options={[{ value: 'momentary', label: 'Momentary' }, { value: 'toggle', label: 'Toggle' }]} />
                            </Field>
                          </div>
                          <CollapsibleSection label="Press Actions">
                            <ActionListEditor actions={sb.actions ?? []} onChange={(next) => updateSb(i, { actions: next })} sectionKey={`qb-sb-${i}-press`}
                              pages={pages} timerWidgets={timerWidgets} scoreboardWidgets={scoreboardWidgets}
                              globalVariables={globalVariables} allInputs={allInputs} cgTemplateWidgets={cgTemplateWidgets} />
                          </CollapsibleSection>
                          <CollapsibleSection label="Release Actions">
                            <ActionListEditor actions={sb.releaseActions ?? []} onChange={(next) => updateSb(i, { releaseActions: next })} sectionKey={`qb-sb-${i}-release`}
                              pages={pages} timerWidgets={timerWidgets} scoreboardWidgets={scoreboardWidgets}
                              globalVariables={globalVariables} allInputs={allInputs} cgTemplateWidgets={cgTemplateWidgets} />
                          </CollapsibleSection>
                        </>
                      )}
                    </div>
                  );
                })}
                <button className="action-add-btn"
                  onClick={() => patch({ sideButtons: [...sideButtons, { id: crypto.randomUUID(), label: 'Button', mode: 'momentary', actions: [] }] })}>
                  + Add Side Button
                </button>
              </>
            );
          })()}
        </CollapsibleSection>

        <div className="modal-actions">
          <button className="btn btn--ghost btn--small" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary btn--small" onClick={() => { onSave(draft); onClose(); }}>Save</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Optional bar directly below the Tournament Database's own Tournament/
// Category bar (TournamentScopeHeader) — see appSettingsStore's
// quickButtons/quickButtonsBarVisible doc comments. Add/remove/hide (the
// bar's own existence) is a local, per-device preference, same "off by
// default, its own Add/Remove toggle" pattern used elsewhere in this app.
//
// Separate from THAT is this bar's own Edit Mode (local component state,
// not persisted — same "starts fresh every time" reasoning the Canvas's
// own editMode doesn't need, since this is a deliberate one-session-at-a-
// time toggle, not a standing preference): while off, the bar is just a
// row of plain fire-on-press buttons; while on, every button also gets its
// edit/remove controls and a native resize handle. Hidden entirely for a
// pure view-only client (read-only/commentator) — any interactive client,
// host or remote, can use it, same gating DrawPanel's own
// isRemoteInteractive already uses.
export function QuickButtonsBar() {
  const { quickButtons, setQuickButtons, setQuickButtonsBarVisible } = useAppSettings();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const canEdit = !syncClient.isReadOnly && !syncClient.isCommentator;
  const editing = editMode && canEdit;

  const editingBtn = editingId === '__new__'
    ? { id: crypto.randomUUID(), label: 'Button', color: '#3498db', textColor: '#ffffff', mode: 'momentary' as const, actions: [], releaseActions: [] }
    : quickButtons.find((b) => b.id === editingId) ?? null;

  const saveButton = (next: QuickButtonDef) => {
    const exists = quickButtons.some((b) => b.id === next.id);
    setQuickButtons(exists ? quickButtons.map((b) => (b.id === next.id ? next : b)) : [...quickButtons, next]);
  };
  const removeButton = (id: string) => setQuickButtons(quickButtons.filter((b) => b.id !== id));
  const resizeButton = (id: string, w: number, h: number) =>
    setQuickButtons(quickButtons.map((b) => (b.id === id ? { ...b, width: w, height: h } : b)));

  return (
    <div className="qb-bar">
      {quickButtons.map((btn) => (
        <QuickButton
          key={btn.id} btn={btn} editMode={editing}
          onEdit={() => setEditingId(btn.id)}
          onRemove={() => removeButton(btn.id)}
          onResize={(w, h) => resizeButton(btn.id, w, h)}
        />
      ))}
      {editing && (
        <button className="qb-add-btn" title="Add a custom button" onClick={() => setEditingId('__new__')}>
          <Plus size={13} strokeWidth={2} /> Add Button
        </button>
      )}
      {canEdit && (
        <button
          className={`qb-edit-toggle${editMode ? ' qb-edit-toggle--active' : ''}`}
          style={{ marginLeft: 'auto' }}
          title={editMode ? 'Done editing' : 'Edit this bar — add, edit, remove or resize buttons'}
          onClick={() => setEditMode((v) => !v)}
        >{editMode ? <><Check size={13} strokeWidth={2} /> Done</> : <><Pencil size={13} strokeWidth={2} /> Edit</>}</button>
      )}
      <button
        className="qb-bar-remove"
        title="Remove this bar"
        onClick={() => setQuickButtonsBarVisible(false)}
      ><X size={14} strokeWidth={2} /></button>

      {editingBtn && (
        <QuickButtonEditorModal btn={editingBtn} onSave={saveButton} onClose={() => setEditingId(null)} />
      )}
    </div>
  );
}
