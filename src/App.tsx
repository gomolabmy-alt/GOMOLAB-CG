import { useEffect, useState } from 'react';
import { Sun, Moon, Mic, PenTool } from 'lucide-react';
import { useVmixStore } from './stores/vmixStore';
import { useAppSettings } from './stores/appSettingsStore';
import { Sidebar } from './components/Sidebar';
import { Canvas } from './components/Canvas';
import { CgTemplateLibraryGrid } from './components/CgTemplateLibraryGrid';
import { CgMonitorBar } from './components/CgMonitorBar';
import { CgPlayoutPanel } from './components/CgPlayoutPanel';
import { SplashScreen } from './components/SplashScreen';
import { StatusBar } from './components/StatusBar';
import { SignInGate } from './components/SignInGate';
import { UndoToast } from './components/UndoToast';
import { useAuthStore } from './stores/authStore';
import { syncClient } from './lib/syncClient';
import { startCloudSync } from './lib/cloudSync';
import { startHotkeyRegistry } from './lib/hotkeyRegistry';
import { useMatchResultsStore } from './stores/matchResultsStore';
import { backfillTeamIds } from './lib/backfillTeamIds';
import { backfillResultStageData } from './lib/backfillResultStageData';
import { backfillTierMismatches } from './lib/backfillTierMismatches';
import { startTournamentAutoAdvance } from './lib/tournamentAutoAdvance';
import { startCountdownVmixSync } from './lib/countdownVmixSync';
import { startCustomTimerTickSync } from './lib/customTimerTickSync';
import { startCompanionBridge } from './lib/companionBridge';
import { useCanvasStore } from './stores/canvasStore';
import { preloadAllProjectAssets } from './lib/templatePreload';
import { startSystemStatsPolling, stopSystemStatsPolling } from './stores/systemStatsStore';

function CommentatorApp() {
  const { theme, setTheme } = useAppSettings();
  return (
    <div className="app-layout" style={{ background: '#111' }}>
      <button
        className="commentator-theme-btn"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      >{theme === 'dark' ? <Sun size={16} strokeWidth={1.75} /> : <Moon size={16} strokeWidth={1.75} />}</button>
      <Canvas mode="commentator" />
    </div>
  );
}

export function App() {
  const { connect, connectionStatus, savedConnections } = useVmixStore();
  const { theme, uiScale, statusBarEnabled } = useAppSettings();
  const [canvasMode, setCanvasMode] = useState<'main' | 'commentator' | 'library'>('main');
  const isDesktopHost = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  const [splashDone, setSplashDone] = useState(!isDesktopHost);
  const authStatus = useAuthStore(s => s.status);
  const offlineBypass = useAuthStore(s => s.offlineBypass);
  // "Everything should be 100% loaded" on open — every CG template's own
  // images/sequence frames/playlist slides, across Main Canvas AND the CG
  // Template Library, warmed into the browser's cache up front rather than
  // only ever fetched lazily the first time some layer happens to play
  // (which is what the per-layer preload in cgPlayoutStore.ts's loadLayer
  // already does — this is the whole-project version of that same
  // guarantee). `total` starts at -1 (not 0) so the indicator can tell
  // "haven't scanned yet" apart from "scanned and there's genuinely nothing
  // to load" — both look like 0 otherwise, and only one of them should ever
  // render a "fully loaded" state without a flash of it first.
  const [assetPreload, setAssetPreload] = useState({ loaded: 0, total: -1 });
  // Briefly confirms completion once loaded === total (a real total, not
  // the initial -1 "haven't scanned yet" placeholder) — "still loading" to
  // "loaded" should read as a visible transition an operator actually
  // sees, not the indicator just silently vanishing the instant it's done.
  // Self-clears; a project with nothing to preload at all (total === 0)
  // never shows either state, correctly reading as already fully ready.
  const [showAssetsLoadedToast, setShowAssetsLoadedToast] = useState(false);
  useEffect(() => {
    if (assetPreload.total <= 0 || assetPreload.loaded < assetPreload.total) return;
    setShowAssetsLoadedToast(true);
    const t = setTimeout(() => setShowAssetsLoadedToast(false), 2500);
    return () => clearTimeout(t);
  }, [assetPreload.loaded, assetPreload.total]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Whole-app UI scale — see appSettingsStore.ts's own doc comment on
  // uiScale for how this differs from canvasScale. Applied to <html> (not
  // just .app-layout) specifically so EVERYTHING scales together,
  // including things that portal straight to document.body outside the
  // normal component tree (LogoUrlPicker's library popup, ConfirmModal,
  // etc.) — scoping this to an inner wrapper div instead would leave those
  // portals at a mismatched, un-scaled size relative to everything else.
  // `zoom` (not `transform: scale`) because it's a real WebKit/Chromium
  // layout property — it reflows content at the scaled size instead of
  // just visually stretching a fixed-size layout, which is what a
  // `transform` would do here (clipping or leaving blank space depending
  // on direction, since nothing would actually reflow to fill or shrink
  // into the new size).
  useEffect(() => {
    (document.documentElement.style as any).zoom = uiScale;
  }, [uiScale]);

  useEffect(() => {
    if (!isDesktopHost) return;
    if (connectionStatus === 'disconnected' && savedConnections.length > 0) {
      const last = [...savedConnections].sort((a, b) => (b.lastConnected ?? 0) - (a.lastConnected ?? 0))[0];
      connect({ host: last.host, port: last.port });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Multi-venue cloud sync — only the desktop host itself runs this (LAN
  // remote/commentator clients mirror the host's state instead, and never
  // hold a sign-in token of their own). Push/pull both silently no-op until
  // signed in, so this is safe to start before that happens — and stays a
  // no-op for the lifetime of an offline-bypass session too, since bypass
  // never involves a token at all.
  useEffect(() => {
    if (!isDesktopHost) return;
    // Backfills teamAId/teamBId onto fixtures/results saved before those
    // fields existed, so old data gets promoted to unambiguous id matching
    // too (see backfillTeamIds.ts), not just new data going forward.
    const backfilled = backfillTeamIds();
    if (backfilled.matches > 0 || backfilled.results > 0) {
      console.log(`[teams] backfilled ids on ${backfilled.matches} fixture(s), ${backfilled.results} result(s)`);
    }
    // Backfills group/tier onto results saved before those fields existed,
    // by joining back to their originating fixture (see
    // backfillResultStageData.ts) — needed so group standings computed from
    // old data can already tell pool-stage results apart from bracket ones.
    const stageBackfilled = backfillResultStageData();
    if (stageBackfilled > 0) {
      console.log(`[results] backfilled group/tier on ${stageBackfilled} result(s)`);
    }
    // Silently corrects any fixture whose tier doesn't match its own round
    // text/references (see backfillTierMismatches.ts) — a drag/swap-left-
    // the-wrong-tier-behind fixture gets fixed automatically instead of
    // needing the operator to click through the Schedule/Bracket tab's
    // repair banner; only genuinely ambiguous ones stay there.
    const tierBackfilled = backfillTierMismatches();
    if (tierBackfilled > 0) {
      console.log(`[matches] backfilled tier on ${tierBackfilled} fixture(s)`);
    }
    // One-time cleanup of any results left duplicated by the old
    // random-id scheme before results got a deterministic id per fixture
    // (see matchResultsStore's addResult) — collapses them and queues the
    // extras for cloud deletion, so standings stop double-counting.
    const removed = useMatchResultsStore.getState().dedupeBySourceSchedule();
    if (removed > 0) console.log(`[results] collapsed ${removed} duplicate saved result(s)`);
    startCloudSync();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global OS-level hotkeys (Button widgets + any widget's Hotkeys section)
  // — registered once at launch, re-synced internally whenever canvas state
  // changes. Desktop-host only; fires even while minimized/unfocused.
  useEffect(() => {
    if (!isDesktopHost) return;
    startHotkeyRegistry();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bracket auto-advance, groups-knockout auto-fill, and bye/walkover sync —
  // always running now, not just while the 🏆 Tournament Database window is
  // open (see tournamentAutoAdvance.ts for why). Desktop-host only, same as
  // every other write-owning background process here.
  useEffect(() => {
    if (!isDesktopHost) return;
    startTournamentAutoAdvance();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Countdown widget → vMix text push, every second, regardless of which
  // canvas tab is currently active (see countdownVmixSync.ts — a widget on
  // an inactive tab isn't mounted at all, so its own per-render push effect
  // alone can't cover this). Desktop-host only, same as the above.
  useEffect(() => {
    if (!isDesktopHost) return;
    startCountdownVmixSync();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Custom Timer countdown/countup ticking, regardless of which canvas tab
  // is active — same "not mounted, doesn't tick" problem as the vMix push
  // right above, just for the on-screen/stored value itself instead of the
  // vMix push (see customTimerTickSync.ts). Desktop-host only, same as
  // every other background process here.
  useEffect(() => {
    if (!isDesktopHost) return;
    startCustomTimerTickSync();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stream Deck / Companion bridge — lets a Bitfocus Companion module
  // connected as a plain read-only sync client trigger any hotkey-bound
  // action and receive REC/STR/FTB/toggle feedback (see companionBridge.ts).
  useEffect(() => {
    if (!isDesktopHost) return;
    startCompanionBridge();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Whole-project CG asset preload — see templatePreload.ts's own doc
  // comment on preloadAllProjectAssets for the full "why". A one-time
  // snapshot read (getState(), not a reactive subscription) — this is
  // specifically the "on open" guarantee; an asset ADDED to a template
  // later is still covered normally the moment that template is actually
  // loaded/played (loadLayer's own existing per-layer preload), so nothing
  // is missed, this just doesn't re-scan the ENTIRE project on every
  // unrelated edit anywhere in the app. Never blocks anything — the app
  // stays fully usable throughout; the indicator below is purely
  // informational, so an operator can tell at a glance whether it's safe to
  // assume everything will play back smoothly yet.
  useEffect(() => {
    if (!isDesktopHost) return;
    const { pages, libraryPages } = useCanvasStore.getState();
    preloadAllProjectAssets(pages, libraryPages, (loaded, total) => setAssetPreload({ loaded, total }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-verify once at launch for an already-signed-in device — the only
  // other verify() call is right after completing sign-in itself, so a
  // long-lived 30-day token would otherwise never pick up an offline bypass
  // PIN an admin grants later. Silently no-ops offline (verify() already
  // tolerates network failure without forcing a sign-out).
  useEffect(() => {
    if (!isDesktopHost) return;
    if (authStatus === 'signed-in') useAuthStore.getState().verify();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bottom resource status bar's own live poll (systemStatsStore.ts) — a
  // single shared loop, started/stopped here rather than from StatusBar.tsx
  // itself so toggling the setting off (AppSettingsModal) genuinely stops
  // the underlying get_system_stats calls, not just hides the bar's DOM.
  useEffect(() => {
    if (isDesktopHost && statusBarEnabled) startSystemStatsPolling();
    else stopSystemStatsPolling();
  }, [isDesktopHost, statusBarEnabled]);

  if (syncClient.isCommentator) {
    return <CommentatorApp />;
  }

  // Remote/commentator browser clients connecting to an already-running,
  // already-signed-in host are never gated here — isDesktopHost is only ever
  // true for the actual packaged app.
  if (isDesktopHost && splashDone && authStatus !== 'signed-in' && !offlineBypass) {
    return (
      <div className="app-layout">
        <SignInGate />
      </div>
    );
  }

  return (
    <div className="app-layout">
      {!splashDone && <SplashScreen onDone={() => setSplashDone(true)} />}
      <div className="app-shell">
        <Sidebar />
        <div className="app-main">
          <UndoToast />
          {isDesktopHost && assetPreload.total > 0 && assetPreload.loaded < assetPreload.total && (
            <div className="cg-asset-preload-toast" title="Every CG template's own images, sequence frames, and playlist/carousel slides — across Main Canvas and the CG Template Library — are being warmed into cache so nothing flashes in blank or stutters the first time it actually plays on air.">
              <span className="cgp-spinner" />
              <span>Loading CG template assets… {assetPreload.loaded}/{assetPreload.total}</span>
              <div className="cg-asset-preload-bar"><div className="cg-asset-preload-bar-fill" style={{ width: `${(assetPreload.loaded / assetPreload.total) * 100}%` }} /></div>
            </div>
          )}
          {isDesktopHost && showAssetsLoadedToast && (
            <div className="cg-asset-preload-toast cg-asset-preload-toast--done">
              <span>✓ All CG template assets loaded ({assetPreload.total})</span>
            </div>
          )}
          {isDesktopHost && <CgMonitorBar />}
          {isDesktopHost && (
            <div className="canvas-mode-bar">
              <button
                className={`canvas-mode-btn ${canvasMode === 'main' ? 'canvas-mode-btn--active' : ''}`}
                onClick={() => setCanvasMode('main')}
              >Main Canvas</button>
              <button
                className={`canvas-mode-btn ${canvasMode === 'commentator' ? 'canvas-mode-btn--active' : ''}`}
                onClick={() => setCanvasMode('commentator')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
              ><Mic size={12} strokeWidth={2} /> Commentator</button>
              <button
                className={`canvas-mode-btn ${canvasMode === 'library' ? 'canvas-mode-btn--active' : ''}`}
                onClick={() => setCanvasMode('library')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                title="Custom CG templates live here, off the production canvas"
              ><PenTool size={12} strokeWidth={2} /> Templates</button>
            </div>
          )}
          {canvasMode === 'library' ? <CgTemplateLibraryGrid /> : <Canvas mode={canvasMode} />}
        </div>
        {isDesktopHost && <CgPlayoutPanel />}
      </div>
      {isDesktopHost && <StatusBar />}
    </div>
  );
}
