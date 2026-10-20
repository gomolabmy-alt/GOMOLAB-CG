import { useState } from 'react';
import { Plus, Pencil, Copy, Trash2, Eye, Archive } from 'lucide-react';
import { useCanvasStore } from '../stores/canvasStore';
import { useAppSettings } from '../stores/appSettingsStore';
import { useCgPlayoutStore, LIBRARY_PREVIEW_LAYER } from '../stores/cgPlayoutStore';
import type { CanvasWidget, TemplateElement } from '../types/canvas';
import { CgTemplateWidget } from './widgets/CgTemplateWidget';
import { CgTemplateDesigner } from './CgTemplateDesigner';
import { ConfirmModal } from './ConfirmModal';
import { isSequenceConsolidated, consolidateSequenceFrames } from '../lib/sequenceConsolidate';

const TILE_W = 180;
const TILE_H = 100;

const isTauriApp = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// The CG Template Library — every custom template shown as a uniform,
// small thumbnail (like vMix's own Input list), not full scale on a
// freeform canvas the way Main Canvas/Commentator render widgets. Every
// library widget is (and can only ever be, per the "library-only" design)
// a 'cg-template', so previews render CgTemplateWidget directly rather than
// going through WidgetRenderer/WidgetWrapper — that wrapper's drag-handle/
// select chrome, tied to the app's shared editMode flag, doesn't belong on
// a thumbnail tile.
export function CgTemplateLibraryGrid() {
  const { libraryPages, addLibraryWidget, deleteLibraryWidget, duplicateLibraryWidget, updateLibraryWidget, updateLibraryWidgetConfig } = useCanvasStore();
  const { cgMonitorChannel } = useAppSettings();
  const previewEntry = useCgPlayoutStore((s) => s.layers[`${cgMonitorChannel}-${LIBRARY_PREVIEW_LAYER}`]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [consolidating, setConsolidating] = useState(false);
  const [consolidateResult, setConsolidateResult] = useState<string | null>(null);

  const widgets = libraryPages[0]?.widgets ?? [];

  const addTemplate = () => {
    addLibraryWidget('cg-template');
    const newId = useCanvasStore.getState().librarySelectedWidgetId;
    if (newId) setEditingId(newId);
  };

  // "make it only 1 file for image sequence" — for existing library
  // templates (imported before sequences bundled into a single file: one
  // save_image call per frame back then, cluttering the shared images
  // library with loose per-frame files). Re-fetches and re-bundles every
  // sequence element still in that old shape — a fresh "Replace…" import
  // already produces the new shape, so this only ever has work to do for
  // templates that predate it. Scans every library template's own elements
  // (this also naturally covers a 'cardCarousel' card's own referenced
  // style, since that's just another entry in this same widgets list).
  const hasUnconsolidatedSequence = widgets.some((w) =>
    (w.config.elements as TemplateElement[] | undefined ?? []).some(
      (el) => el.kind === 'sequence' && (el.config.frames ?? []).length > 0 && !isSequenceConsolidated(el.config.frames)
    )
  );
  const consolidateAllSequences = async () => {
    if (!isTauriApp || consolidating) return;
    setConsolidating(true);
    setConsolidateResult(null);
    let count = 0;
    try {
      for (const w of widgets) {
        const elements: TemplateElement[] = w.config.elements ?? [];
        let changed = false;
        const nextElements = await Promise.all(elements.map(async (el) => {
          if (el.kind !== 'sequence') return el;
          const frames: string[] = el.config.frames ?? [];
          if (!frames.length || isSequenceConsolidated(frames)) return el;
          const nextFrames = await consolidateSequenceFrames(frames);
          changed = true;
          count++;
          return { ...el, config: { ...el.config, frames: nextFrames } };
        }));
        if (changed) updateLibraryWidgetConfig(w.id, { elements: nextElements });
      }
    } finally {
      setConsolidating(false);
      setConsolidateResult(count > 0 ? `Consolidated ${count} image sequence${count === 1 ? '' : 's'} into single files.` : 'Every image sequence was already a single file.');
    }
  };

  // Cues onto the CG Monitor bar's own reserved preview slot — see
  // LIBRARY_PREVIEW_LAYER's doc comment for why layer 0 specifically can
  // never be a real on-air layer, so this can never disturb whatever the
  // operator actually has playing. Shows up in the Monitor's existing
  // PREVIEW box (CgMonitorBar.tsx) — no separate preview UI here.
  const previewTile = (widgetId: string) => {
    useCgPlayoutStore.getState().loadLayer(cgMonitorChannel, LIBRARY_PREVIEW_LAYER, widgetId, { playOnLoad: false });
  };

  return (
    <div className="cgtl-page">
      <div className="cgtl-preview-target">
        <Eye size={12} strokeWidth={2} />
        <span>Clicking a template cues it in the CG Monitor's PREVIEW box (channel {cgMonitorChannel}) — never on air.</span>
      </div>
      {(hasUnconsolidatedSequence || consolidating || consolidateResult) && (
        <div className="cgtl-preview-target" style={{ gap: 8 }}>
          <Archive size={12} strokeWidth={2} />
          {consolidateResult && !consolidating ? (
            <span>{consolidateResult}</span>
          ) : (
            <>
              <span>Some image sequences here still use one file per frame from before sequences were bundled into a single file.</span>
              <button className="cgo-copy-btn" disabled={!isTauriApp || consolidating} onClick={consolidateAllSequences} style={{ flexShrink: 0 }}>
                {consolidating ? 'Consolidating…' : 'Consolidate Image Sequences'}
              </button>
            </>
          )}
        </div>
      )}
      <div className="cgtl-grid">
        {widgets.map((w) => (
          <TemplateTile
            key={w.id}
            widget={w}
            active={previewEntry?.status === 'loaded' && previewEntry.widgetId === w.id}
            onPreview={() => previewTile(w.id)}
            onEdit={() => setEditingId(w.id)}
            onRename={(name) => updateLibraryWidget(w.id, { label: name })}
            onDuplicate={() => duplicateLibraryWidget(w.id)}
            onDelete={() => setConfirmDeleteId(w.id)}
          />
        ))}

        <button className="cgtl-tile cgtl-tile--add" onClick={addTemplate} title="New custom template">
          <Plus size={22} strokeWidth={1.75} />
          <span>New Template</span>
        </button>
      </div>

      {widgets.length === 0 && (
        <div className="cgtl-empty">No custom templates yet — click "New Template" to design one.</div>
      )}

      {editingId && (
        <CgTemplateDesigner widgetId={editingId} onClose={() => setEditingId(null)} />
      )}

      {confirmDeleteId && (
        <ConfirmModal
          title="Delete template?"
          message={`Delete "${widgets.find((w) => w.id === confirmDeleteId)?.label || 'this template'}"? This can't be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => { deleteLibraryWidget(confirmDeleteId); setConfirmDeleteId(null); }}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </div>
  );
}

function TemplateTile({ widget, active, onPreview, onEdit, onRename, onDuplicate, onDelete }: {
  widget: CanvasWidget;
  active: boolean;
  onPreview: () => void;
  onEdit: () => void;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  // Same "shrink a real render to fit a box" trick CgTemplateDesigner.tsx's
  // own zoom-to-fit uses — here computed per-tile so a 1920×1080 template
  // and a 320×240 one land in the exact same-size box.
  const scale = Math.min(TILE_W / widget.w, TILE_H / widget.h, 1);
  const [renaming, setRenaming] = useState(false);

  const commitRename = (value: string) => {
    setRenaming(false);
    const trimmed = value.trim();
    if (trimmed) onRename(trimmed);
  };

  return (
    <div className={`cgtl-tile${active ? ' cgtl-tile--active' : ''}`} onClick={onPreview} title="Cue in the CG Monitor's PREVIEW box">
      <div className="cgtl-tile-preview">
        <div style={{ width: widget.w, height: widget.h, transform: `scale(${scale})` }}>
          <CgTemplateWidget config={widget.config} w={widget.w} h={widget.h} />
        </div>
      </div>
      {renaming ? (
        <input
          className="cgtl-tile-rename"
          autoFocus
          defaultValue={widget.label || ''}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => commitRename(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') { e.preventDefault(); setRenaming(false); }
          }}
        />
      ) : (
        <div className="cgtl-tile-label" title="Double-click to rename" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => { e.stopPropagation(); setRenaming(true); }}>
          {widget.label || 'Untitled'}
        </div>
      )}
      <div className="cgtl-tile-actions" onClick={(e) => e.stopPropagation()}>
        <button onClick={onEdit} title="Open designer"><Pencil size={12} strokeWidth={2} /></button>
        <button onClick={onDuplicate} title="Duplicate"><Copy size={12} strokeWidth={2} /></button>
        <button onClick={onDelete} title="Delete"><Trash2 size={12} strokeWidth={2} /></button>
      </div>
    </div>
  );
}
