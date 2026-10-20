import { useEffect, useState } from 'react';
import { Copy, Check, X, Eye } from 'lucide-react';
import { useCanvasStore } from '../stores/canvasStore';
import type { CanvasWidget } from '../types/canvas';
import { WIDGET_TYPE_LABELS } from '../types/canvas';
import { WidgetIcon } from './widgets/WidgetIcon';

interface Props {
  onClose: () => void;
}

// Lists every widget across every canvas page with a one-click "Copy URL"
// (for pasting into a vMix "Web Browser" input or an OBS Browser Source) and
// a "Preview" button that opens the same standalone CG output — see
// CgOutputPage.tsx / main.tsx's `?cgOutput=<widgetId>` route — in its own
// window right here in the app, so you can check a graphic without leaving
// or touching vMix/OBS at all.
//
// Both actions go through the read-only server's real network URL (not a
// relative in-app path) so Preview sees exactly what a capture source would
// — hence both need Read-only Remote Access switched ON in the sidebar,
// and the warning banner when it's off.
export function CgOutputsPanel({ onClose }: Props) {
  const { pages, libraryPages } = useCanvasStore();
  const [serverInfo, setServerInfo] = useState<{ readonlyUrl: string; readonlyEnabled: boolean } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Set only when Copy URL's own navigator.clipboard.writeText genuinely
  // fails (this app's Tauri webview has no dedicated clipboard permission
  // set up for it, so it can) — reveals a plain selectable text field with
  // that row's URL so there's still SOME way to get it, rather than the
  // previous version's fire-and-forget write that showed "Copied!"
  // regardless of whether anything actually reached the clipboard.
  const [revealUrlId, setRevealUrlId] = useState<string | null>(null);
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  useEffect(() => {
    if (!isTauri) return;
    import('@tauri-apps/api/core').then(({ invoke }) =>
      invoke<any>('get_server_info').then((info) => { if (info?.readonlyUrl) setServerInfo(info); })
    ).catch(() => {});
  }, [isTauri]);

  const outputUrl = (widgetId: string) => `${serverInfo!.readonlyUrl}/?cgOutput=${widgetId}`;

  const copy = async (widgetId: string) => {
    if (!serverInfo) return;
    try {
      await navigator.clipboard.writeText(outputUrl(widgetId));
      setCopiedId(widgetId);
      setTimeout(() => setCopiedId((id) => (id === widgetId ? null : id)), 1200);
    } catch {
      setRevealUrlId(widgetId);
    }
  };

  const preview = async (widget: CanvasWidget) => {
    if (!serverInfo) return;
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const label = `cg-preview-${widget.id}`;
    try {
      const existing = await WebviewWindow.getByLabel(label);
      if (existing) { await existing.setFocus(); return; }
    } catch { /* no existing preview window — fall through and create one */ }
    new WebviewWindow(label, {
      url: outputUrl(widget.id),
      title: `CG Preview — ${widget.label || WIDGET_TYPE_LABELS[widget.type]}`,
      width: Math.max(widget.w, 240),
      height: Math.max(widget.h, 160),
      resizable: true,
    });
  };

  const canAct = !!serverInfo?.readonlyEnabled;
  // Templates live in the CG Template Library now, not necessarily Main Canvas.
  const allWidgets = [...pages, ...libraryPages].flatMap((p) => p.widgets.map((widget) => ({ widget, pageName: p.name })));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal cgo-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">CG Outputs</span>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>

        {!isTauri ? (
          <div className="cgo-warning">Output links are only available from the desktop app, not this browser preview.</div>
        ) : serverInfo && !serverInfo.readonlyEnabled ? (
          <div className="cgo-warning">
            Read-only Remote Access is off — turn it on under "Remote Access" in the sidebar, or these links won't load anywhere but this machine.
          </div>
        ) : null}

        <div className="cgo-list">
          {allWidgets.length === 0 && (
            <div className="cgo-empty">No widgets on any page yet — add one from the canvas first.</div>
          )}
          {allWidgets.map(({ widget, pageName }) => (
            <div key={widget.id} className="cgo-row">
              <span className="cgo-row-icon"><WidgetIcon type={widget.type} size={14} strokeWidth={2} /></span>
              <div className="cgo-row-text">
                <span className="cgo-row-label">{widget.label || WIDGET_TYPE_LABELS[widget.type]}</span>
                <span className="cgo-row-page">{pageName}</span>
              </div>
              <div className="cgo-row-actions">
                <button
                  className="cgo-copy-btn"
                  onClick={() => preview(widget)}
                  disabled={!canAct}
                  title="Open this widget's output in its own preview window"
                >
                  <Eye size={13} strokeWidth={2} /> Preview
                </button>
                <button
                  className="cgo-copy-btn"
                  onClick={() => copy(widget.id)}
                  disabled={!canAct}
                  title="Copy this widget's standalone output URL (for a vMix/OBS Browser Source)"
                >
                  {copiedId === widget.id ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={2} />}
                  {copiedId === widget.id ? 'Copied' : 'Copy URL'}
                </button>
              </div>
              {revealUrlId === widget.id && (
                <input
                  className="cgp-url-display cgo-row-url"
                  readOnly
                  autoFocus
                  value={outputUrl(widget.id)}
                  onClick={(e) => e.currentTarget.select()}
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={() => setRevealUrlId(null)}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
