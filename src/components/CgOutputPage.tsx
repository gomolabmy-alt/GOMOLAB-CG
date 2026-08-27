import { useEffect } from 'react';
import { useCanvasStore } from '../stores/canvasStore';
import { WidgetRenderer } from './widgets/index';

// Root component for the "own CG" output route — `?cgOutput=<widgetId>` on
// the READ-ONLY sync port (see syncClient.ts: isReadOnly is derived purely
// from the page's port, 9888). Meant to be loaded as a capture source (vMix
// "Web Browser" input, OBS Browser Source), not viewed as part of the app's
// own UI: no tab bar/Sidebar, no editor chrome, a transparent page
// background so the surrounding page shows through wherever the widget
// itself doesn't paint, and this widget's own operator-facing buttons
// suppressed (see the `outputOnly` prop threaded into WidgetRenderer, and
// each lower-third-style widget's own "-actions" block) — this route is a
// picture, not a control panel.
//
// This is a pure sync CLIENT like any other browser/commentator connection
// (see PopoutPage.tsx for the equivalent for a whole popped-out page) — it
// never assumes a Tauri context, since it's normally loaded by a completely
// different application (the video switcher), not this app's own webview.
export function CgOutputPage({ widgetId }: { widgetId: string }) {
  const { pages } = useCanvasStore();
  const widget = pages.flatMap((p) => p.widgets).find((w) => w.id === widgetId);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlBg = html.style.background;
    const prevBodyBg = body.style.background;
    html.style.background = 'transparent';
    body.style.background = 'transparent';
    return () => {
      html.style.background = prevHtmlBg;
      body.style.background = prevBodyBg;
    };
  }, []);

  // No widget (id typo'd, deleted, or state hasn't arrived yet over the
  // sync connection) — stay fully transparent rather than showing any kind
  // of placeholder text, since that text would otherwise be part of the
  // captured picture for however long it's visible.
  if (!widget) return null;

  // Pinned to (0,0) regardless of where this widget actually sits on its
  // real canvas page — WidgetWrapper positions by widget.x/y, which only
  // matters for the operator's own canvas layout, not for a standalone
  // capture source sized to exactly this one widget.
  const pinned = { ...widget, x: 0, y: 0 };

  return (
    <div style={{ position: 'relative', width: widget.w, height: widget.h, background: 'transparent' }}>
      <WidgetRenderer widget={pinned} outputOnly />
    </div>
  );
}
