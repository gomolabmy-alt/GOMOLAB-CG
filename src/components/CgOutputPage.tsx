import { useEffect } from 'react';
import { useCanvasStore } from '../stores/canvasStore';
import { useAppSettings } from '../stores/appSettingsStore';
import { useTransparentBackground } from '../lib/transparentPage';
import { type CgOutputMode, cgOutputBackground, cgKeyFilter } from '../lib/cgOutputMode';
import { primeAudio } from '../lib/sfxLibrary';
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
// `mode` — see lib/cgOutputMode.ts — same Fill/Key/Monitor trio
// CgChannelOutputPage.tsx offers, for this single-widget route.
export function CgOutputPage({ widgetId, mode = 'monitor' }: { widgetId: string; mode?: CgOutputMode }) {
  const { pages, libraryPages } = useCanvasStore();
  // Templates live in the CG Template Library now, not necessarily Main Canvas.
  const widget = [...pages, ...libraryPages].flatMap((p) => p.widgets).find((w) => w.id === widgetId);

  const { cgMonitorBg, cgMonitorBgColor } = useAppSettings();
  const background = cgOutputBackground(mode, cgMonitorBg, cgMonitorBgColor);
  useTransparentBackground(background);
  // This page never gets a real click/keypress (it's a capture source, not
  // something anyone operates) — without this, a state's soundEffect would
  // build fine but never actually be heard, since a fresh AudioContext
  // starts suspended and nothing here would ever unlock it.
  useEffect(() => { primeAudio(); }, []);

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
    <div style={{ position: 'relative', width: widget.w, height: widget.h, background }}>
      <div style={{ position: 'relative', width: '100%', height: '100%', filter: cgKeyFilter(mode) }}>
        <WidgetRenderer widget={pinned} outputOnly />
      </div>
    </div>
  );
}
