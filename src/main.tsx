import './polyfill'; // must be first — patches crypto.randomUUID for older browsers
import { StrictMode, Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { syncClient } from './lib/syncClient';
import { useCanvasStore, initCanvasSync, initCommentatorSync } from './stores/canvasStore';
import { useTournamentStore, initTournamentSync } from './stores/tournamentStore';
import { useTeamDbStore } from './stores/teamDbStore';
import { useMatchScheduleStore } from './stores/matchScheduleStore';
import { useMatchResultsStore } from './stores/matchResultsStore';
import { useRundownStore } from './stores/rundownStore';
import { useAuthStore } from './stores/authStore';
import { useCgPlayoutStore, initPlayoutSync } from './stores/cgPlayoutStore';
import { parseCgOutputMode } from './lib/cgOutputMode';

class RootErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null };
  static getDerivedStateFromError(e: unknown) {
    return { error: String((e as any)?.message ?? e) };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ position: 'fixed', inset: 0, background: '#1a1a2e', color: '#ff6b6b',
          fontFamily: 'monospace', fontSize: 13, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>App Error</div>
          <div style={{ maxWidth: 600, textAlign: 'center', wordBreak: 'break-all',
            background: 'rgba(255,0,0,0.1)', padding: '10px 16px', borderRadius: 6 }}>
            {this.state.error}
          </div>
          <button onClick={() => window.location.reload()}
            style={{ marginTop: 8, padding: '8px 20px', background: '#ff6b6b', color: '#fff',
              border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Wire store handlers so incoming WS messages update local state
initCanvasSync();
initTournamentSync();
initCommentatorSync();
initPlayoutSync();

// Connect to sync server; desktop host sends full state on connect for new joiners
// Also treat localhost in Vite dev mode as host so UI preview works without the Tauri app
const isDesktopHost = typeof window !== 'undefined' && (
  '__TAURI_INTERNALS__' in window ||
  ((import.meta as any).env?.DEV && window.location.hostname === 'localhost')
);

// A popped-out canvas page (see Canvas.tsx's pop-out button / PopoutPage.tsx)
// is a second real Tauri window loading this exact same app with
// `?popoutPage=<id>` in its URL — still `isDesktopHost` (it IS a real Tauri
// webview), but it must never self-appoint as a second sync host: only the
// ONE main window does. Every "am I the host" decision below uses
// `isMainWindow`, not the raw `isDesktopHost` check.
const popoutPageId = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search).get('popoutPage')
  : null;
// The "own CG" output route (see CgOutputPage.tsx) — usually loaded on the
// read-only sync port (9888) by a completely different application (vMix's
// Web Browser input, an OBS Browser Source), but also opened as an in-app
// preview window (see CgOutputsPanel.tsx's "Preview" button), which IS a
// real Tauri webview — so, same as popoutPageId, it must never let that
// window self-appoint as the sync host.
const cgOutputWidgetId = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search).get('cgOutput')
  : null;
// A CasparCG-style channel output (see CgChannelOutputPage.tsx) — renders
// every on-air layer for one CG playout channel, stacked by z-order. Same
// story as cgOutputWidgetId: reached over the network by vMix/OBS, or opened
// as an in-app preview window (CgPlayoutPanel.tsx), either way a real Tauri
// webview that must never self-appoint as sync host.
const cgChannelParam = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search).get('cgChannel')
  : null;
// Fill/Key/Monitor — see lib/cgOutputMode.ts. Read once here (not inside
// either output page) so both `?cgOutput=`/`?cgChannel=` routes share the
// exact same `mode=` query-param convention. Absent/unrecognized -> 'monitor',
// so every URL written before this existed keeps behaving identically.
const cgOutputMode = typeof window !== 'undefined'
  ? parseCgOutputMode(new URLSearchParams(window.location.search).get('mode'))
  : 'monitor';
const isMainWindow = isDesktopHost && !popoutPageId && !cgOutputWidgetId && !cgChannelParam;

// Sign-in gate only applies to the actual packaged app's main window — a
// popped-out window doesn't need its own separate auth verification/
// deep-link handling, that's the main window's job.
if (isMainWindow) {
  import('./lib/deepLink').then(({ initDeepLink }) => initDeepLink());
  useAuthStore.getState().verify();
  // Re-checks periodically (not just at launch) so a remote "Force Sign Out"
  // from the Desktop Sessions admin page actually takes effect without the
  // user needing to relaunch the app.
  setInterval(() => useAuthStore.getState().verify(), 120_000);
}

syncClient.connect(isMainWindow ? () => ({
  type: 'FULL_STATE' as const,
  canvas: (() => {
    const s = useCanvasStore.getState();
    return { pages: s.pages, activePageId: s.activePageId };
  })(),
  tournament: (() => {
    const s = useTournamentStore.getState();
    return { tournaments: s.tournaments, activeTournamentId: s.activeTournamentId };
  })(),
  teamDb: { teams: useTeamDbStore.getState().teams },
  matchSchedule: { matches: useMatchScheduleStore.getState().matches },
  matchResults: { results: useMatchResultsStore.getState().results },
  rundown: { segments: useRundownStore.getState().segments },
  playout: { layers: useCgPlayoutStore.getState().layers },
  library: (() => {
    const s = useCanvasStore.getState();
    return { pages: s.libraryPages, activePageId: s.libraryActivePageId };
  })(),
}) : undefined);

function sendCommentatorHeartbeat() {
  if (!isMainWindow) return;
  const s = useCanvasStore.getState();
  syncClient.send({
    type: 'COMMENTATOR_FULL_STATE' as const,
    canvas: { pages: s.commentatorPages, activePageId: s.commentatorActivePageId },
  });
}

// Heartbeat: re-push FULL_STATE every 5 seconds so the Rust server's cache
// never gets stale. Without this, browsers that connect after a score change or
// timer update receive the original on-connect snapshot and miss those changes.
// Also push COMMENTATOR_FULL_STATE so new commentator clients get fresh state.
if (isMainWindow) {
  setInterval(() => {
    syncClient.sendFullState();
    sendCommentatorHeartbeat();
  }, 5000);
}

const rootEl = document.getElementById('root')!;
const fallbackEl = document.getElementById('boot-fallback');

// Loaded via a genuine dynamic import() — not a static one at the top of
// this file — specifically so Vite/Rollup code-splits each of these four
// page trees into its OWN chunk instead of bundling all of them (plus every
// module each one pulls in) into one shared entry chunk. This matters most
// for `?cgOutput=`/`?cgChannel=` (CgOutputPage/CgChannelOutputPage): the
// ACTUAL broadcast output surface, loaded over the network by vMix's/OBS'
// own Browser Source (often several simultaneous instances, one per CG
// layer/channel, each spinning up its own full Chromium process) — before
// this, hitting that URL downloaded/parsed/executed the ENTIRE editor (the
// whole Sidebar, Tournament Manager, Widget Palette, CgTemplateDesigner,
// every widget type, etc.) just to render one small template on screen.
// Now it only fetches CgOutputPage/CgChannelOutputPage and whatever THOSE
// actually need (CgTemplateWidget, the animation engine, gsap) — same for a
// popped-out canvas window (PopoutPage), which doesn't need the output-only
// code either. The main editor window still loads its own full chunk, just
// no longer forced onto every other window at the same time.
(async () => {
  let Page: React.ComponentType<any>;
  let props: Record<string, any> = {};
  if (cgOutputWidgetId) {
    ({ CgOutputPage: Page } = await import('./components/CgOutputPage'));
    props = { widgetId: cgOutputWidgetId, mode: cgOutputMode };
  } else if (cgChannelParam) {
    ({ CgChannelOutputPage: Page } = await import('./components/CgChannelOutputPage'));
    props = { channel: Number(cgChannelParam), mode: cgOutputMode };
  } else if (popoutPageId) {
    ({ PopoutPage: Page } = await import('./components/PopoutPage'));
    props = { pageId: popoutPageId };
  } else {
    ({ App: Page } = await import('./App'));
  }

  createRoot(rootEl).render(
    <StrictMode>
      <RootErrorBoundary>
        <Page {...props} />
      </RootErrorBoundary>
    </StrictMode>,
  );

  // Hide the "Loading…" overlay once React has taken over
  if (fallbackEl) {
    requestAnimationFrame(() => { fallbackEl.style.display = 'none'; });
  }
})();
