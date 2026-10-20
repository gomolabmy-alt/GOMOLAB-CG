import { useEffect, useRef, useState } from 'react';
import { Copy, Check, Eye, Play, Square, Trash2, Upload, Pencil, SkipForward, Layers, ChevronsRight, ChevronsLeft, Monitor } from 'lucide-react';
import { useCanvasStore } from '../stores/canvasStore';
import { useCgPlayoutStore, type CgTransitionType } from '../stores/cgPlayoutStore';
import { useAppSettings } from '../stores/appSettingsStore';
import { WIDGET_TYPE_LABELS } from '../types/canvas';
import { CgTemplateDesigner } from './CgTemplateDesigner';
import { ColorPicker } from './ColorPicker';

const TRANSITIONS: CgTransitionType[] = ['cut', 'fade', 'wipe'];
const STATUS_LABEL: Record<string, string> = { empty: 'Empty', loaded: 'Loaded', playing: 'On Air', stopping: 'Stopping' };

// CasparCG-style channel/layer playout control — LOAD a template into a
// numbered layer, PLAY it on air (with an in-transition), STOP it (with an
// out-transition), CLEAR it. The actual playout state lives in
// cgPlayoutStore.ts; this panel is purely a control surface for it, exactly
// the same relationship CgOutputsPanel.tsx has to the single-widget
// `?cgOutput=` route (which this panel does not touch or replace — that
// stays the "quick single-widget preview/capture" tool, this is the
// multi-layer playout board, output via `?cgChannel=<n>`).
//
// Docked on the right of the app shell (see App.tsx) rather than a modal you
// have to open — a layer's current template/status and its Clear/Play/Stop
// controls are things an operator wants glanceable and one click away during
// a live show, not buried behind an extra open/close step every time.
export function CgPlayoutPanel() {
  const { pages, libraryPages } = useCanvasStore();
  const layers = useCgPlayoutStore((s) => s.layers);
  const { loadLayer, playLayer, stopLayer, clearLayer, continueLayer } = useCgPlayoutStore();
  const { cgPlayoutSidebarCollapsed, setCgPlayoutSidebarCollapsed, cgMonitorBg, setCgMonitorBg, cgMonitorBgColor, setCgMonitorBgColor } = useAppSettings();

  const [channel, setChannel] = useState(1);
  const [layerCount, setLayerCount] = useState(4);
  const [pendingTemplate, setPendingTemplate] = useState<Record<number, string>>({});
  const [pendingTransition, setPendingTransition] = useState<Record<number, CgTransitionType>>({});
  const [pendingDuration, setPendingDuration] = useState<Record<number, number>>({});

  const [serverInfo, setServerInfo] = useState<{ readonlyUrl: string; readonlyEnabled: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [templateDesignerId, setTemplateDesignerId] = useState<string | null>(null);
  // Which of this channel's 3 CasparCG-style output feeds Preview/Copy URL
  // below act on — see lib/cgOutputMode.ts. Monitor is the same plain,
  // transparent output every URL had before Fill/Key existed; Fill/Key are
  // meant for vMix/OBS's own DeckLink output feature to pick up as two more
  // Browser Sources and drive a real hardware Fill+Key pair from.
  const [outputMode, setOutputMode] = useState<'monitor' | 'fill' | 'key'>('monitor');
  const urlInputRef = useRef<HTMLInputElement>(null);
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  // "Send to Display" — puts this channel's own output on a real connected
  // screen as a borderless, undecorated window sized to exactly cover it,
  // rather than a resizable preview window you have to manually maximize.
  // Deliberately NOT a native DeckLink/Blackmagic SDK integration — this
  // app has no hardware video output of its own by design (see
  // lib/cgOutputMode.ts's own doc comment: the Fill/Key/Monitor trio exists
  // so vMix/OBS's OWN already-hardware-tested DeckLink output feature does
  // that job). What this DOES cover: any Blackmagic (or other) capture/
  // playback card whose own driver exposes its monitor-out as an ordinary
  // macOS/Windows display — Blackmagic Desktop Video does exactly that for
  // several of their devices — plus any real second monitor, projector,
  // etc. Uses only Tauri's existing window/monitor APIs (no new Rust code,
  // no proprietary SDK, works with zero extra hardware installed — a
  // regular laptop display is a perfectly good target to test this
  // against).
  const [monitors, setMonitors] = useState<import('@tauri-apps/api/window').Monitor[]>([]);
  const [selectedMonitor, setSelectedMonitor] = useState(0);
  // Keyed by `cg-channel-display-${channel}-${outputMode}` (same label the
  // window itself is created with) rather than one flat on/off flag — a
  // channel+mode combo already sent to a display should keep reading as
  // "on" even after switching the Channel/Output selectors above to author
  // a DIFFERENT combo, and Stop needs to close the right window rather than
  // whichever one happened to be sent most recently.
  const [activeDisplays, setActiveDisplays] = useState<Set<string>>(new Set());
  const [displayBusy, setDisplayBusy] = useState(false);
  const [displayError, setDisplayError] = useState<string | null>(null);
  const displayLabel = `cg-channel-display-${channel}-${outputMode}`;
  const displayActive = activeDisplays.has(displayLabel);
  const refreshMonitors = async () => {
    if (!isTauri) return [] as import('@tauri-apps/api/window').Monitor[];
    const { availableMonitors } = await import('@tauri-apps/api/window');
    const list = await availableMonitors();
    setMonitors(list);
    return list;
  };
  useEffect(() => { refreshMonitors().catch(() => {}); }, [isTauri]);
  const stopDisplay = async (label: string) => {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const existing = await WebviewWindow.getByLabel(label).catch(() => null);
    if (existing) await existing.close().catch(() => {});
    setActiveDisplays((cur) => { const next = new Set(cur); next.delete(label); return next; });
  };
  const toggleDisplay = async () => {
    if (displayActive) { await stopDisplay(displayLabel); return; }
    if (!serverInfo) return;
    setDisplayBusy(true);
    setDisplayError(null);
    try {
      // Re-fetched right before opening (not just the mount-time list) so a
      // display plugged in mid-session is actually there to pick from.
      const list = await refreshMonitors();
      if (!list.length) throw new Error('No displays found');
      const mon = list[Math.min(selectedMonitor, list.length - 1)];
      // Monitor.position/size are physical pixels; WebviewWindow's own
      // x/y/width/height options are logical — see Tauri's own Monitor.
      // position doc comment for this exact conversion.
      const sf = mon.scaleFactor || 1;
      const x = mon.position.x / sf;
      const y = mon.position.y / sf;
      const width = mon.size.width / sf;
      const height = mon.size.height / sf;
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const label = displayLabel;
      const existing = await WebviewWindow.getByLabel(label).catch(() => null);
      if (existing) await existing.close().catch(() => {});
      const win = new WebviewWindow(label, {
        url: channelUrl(),
        title: `CG Channel ${channel} — Display Output`,
        x, y, width, height,
        decorations: false,
        resizable: false,
        alwaysOnTop: false,
        skipTaskbar: true,
        focus: false,
      });
      win.once('tauri://error', (e) => {
        setDisplayError(String((e as any).payload ?? e));
        setActiveDisplays((cur) => { const next = new Set(cur); next.delete(label); return next; });
      });
      // If it closes for any reason other than our own Stop button (the
      // operator closing it some other way, or the OS reclaiming the
      // display it was on), this row's own "Display: On" state shouldn't
      // keep claiming otherwise.
      win.once('tauri://destroyed', () => setActiveDisplays((cur) => { const next = new Set(cur); next.delete(label); return next; }));
      setActiveDisplays((cur) => new Set(cur).add(label));
    } catch (e) {
      setDisplayError(e instanceof Error ? e.message : String(e));
    } finally {
      setDisplayBusy(false);
    }
  };

  // Closing every still-open display window behind us if this panel
  // unmounts — don't leave an orphaned output running with nothing left to
  // stop it. Reads activeDisplays via
  // a ref rather than depending on it directly, so this only ever runs
  // once, on actual unmount — not after every single toggle.
  const activeDisplaysRef = useRef(activeDisplays);
  activeDisplaysRef.current = activeDisplays;
  useEffect(() => () => { activeDisplaysRef.current.forEach((label) => stopDisplay(label)); }, []);

  useEffect(() => {
    if (!isTauri) return;
    import('@tauri-apps/api/core').then(({ invoke }) =>
      invoke<any>('get_server_info').then((info) => { if (info?.readonlyUrl) setServerInfo(info); })
    ).catch(() => {});
  }, [isTauri]);

  // Templates live in the CG Template Library now, not necessarily Main Canvas.
  const allWidgets = [...pages, ...libraryPages].flatMap((p) => p.widgets.map((widget) => ({ widget, pageName: p.name })));
  const canAct = !!serverInfo?.readonlyEnabled;
  const channelUrl = () => `${serverInfo!.readonlyUrl}/?cgChannel=${channel}${outputMode === 'monitor' ? '' : `&mode=${outputMode}`}`;

  // Genuinely awaited now, not fire-and-forget — `navigator.clipboard`
  // inside this app's Tauri webview has no dedicated clipboard permission
  // set up (no @tauri-apps/plugin-clipboard-manager capability), so a write
  // can silently fail here in a way it wouldn't in a normal browser tab.
  // The previous version showed "Copied!" regardless of whether the write
  // actually succeeded, which combined with there being no visible URL
  // anywhere else in this panel meant a failed copy left the operator with
  // no way to get the URL at all. Now a failure falls back to selecting the
  // always-visible read-only field below instead, so the URL's own TEXT is
  // there to read/manually copy (Cmd/Ctrl+C) either way.
  const copyUrl = async () => {
    if (!serverInfo) return;
    try {
      await navigator.clipboard.writeText(channelUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      urlInputRef.current?.select();
    }
  };

  const preview = async () => {
    if (!serverInfo) return;
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    // One window per channel+mode — Monitor/Fill/Key can each stay open
    // side by side instead of one replacing another.
    const label = `cg-channel-preview-${channel}-${outputMode}`;
    try {
      const existing = await WebviewWindow.getByLabel(label);
      if (existing) { await existing.setFocus(); return; }
    } catch { /* no existing preview window — fall through and create one */ }
    new WebviewWindow(label, {
      url: channelUrl(),
      title: `CG Channel ${channel} — ${outputMode === 'monitor' ? 'Preview' : outputMode === 'fill' ? 'Fill' : 'Key'}`,
      width: 960,
      height: 540,
      resizable: true,
    });
  };

  const rows = Array.from({ length: layerCount }, (_, i) => i + 1).map((layerNum) => {
    const key = `${channel}-${layerNum}`;
    return { layerNum, entry: layers[key] };
  });

  if (cgPlayoutSidebarCollapsed) {
    return (
      <aside className="app-cgplayout-sidebar app-cgplayout-sidebar--collapsed">
        <button className="cgpl-expand-btn" onClick={() => setCgPlayoutSidebarCollapsed(false)} title="Expand CG Playout">
          <Layers size={15} strokeWidth={2} />
          <ChevronsLeft size={13} strokeWidth={2} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="app-cgplayout-sidebar">
      <div className="cgpl-header">
        <span className="cgpl-title"><Layers size={14} strokeWidth={2} /> CG Playout</span>
        <button className="sb-collapse-btn" onClick={() => setCgPlayoutSidebarCollapsed(true)} title="Collapse CG Playout"><ChevronsRight size={14} strokeWidth={2} /></button>
      </div>

      <div className="cgpl-scroll">
        <div className="cgp-channel-bar" title="Applies to every channel's default output (the plain URL with no &mode= — what a normal vMix/OBS Browser Source actually uses on air). Fill/Key stay opaque black regardless — that's protocol-required, not a preference.">
          <label className="cgp-channel-label">
            Program Background
            <select className="cgp-select" value={cgMonitorBg} onChange={(e) => setCgMonitorBg(e.target.value as typeof cgMonitorBg)}>
              <option value="transparent">Transparent</option>
              <option value="solid">Solid Color</option>
            </select>
          </label>
          {cgMonitorBg === 'solid' && (
            <ColorPicker value={cgMonitorBgColor} onChange={setCgMonitorBgColor} />
          )}
        </div>
        <div className="cgp-channel-bar">
          <label className="cgp-channel-label">
            Channel
            <input type="number" min={1} className="cgp-num-input" value={channel}
              onChange={(e) => setChannel(Math.max(1, Number(e.target.value) || 1))} />
          </label>
          <label className="cgp-channel-label" title="Same CasparCG-style Fill+Key+Screen trio, reached via this channel's own URL — Fill/Key are meant for vMix/OBS's own DeckLink output feature, not for viewing directly.">
            Output
            <select className="cgp-select" value={outputMode} onChange={(e) => setOutputMode(e.target.value as typeof outputMode)}>
              <option value="monitor">Monitor</option>
              <option value="fill">Fill</option>
              <option value="key">Key</option>
            </select>
          </label>
          <div className="cgp-channel-actions">
            <button className="cgo-copy-btn" onClick={preview} disabled={!canAct} title={`Open this channel's ${outputMode} output in its own preview window`}>
              <Eye size={13} strokeWidth={2} /> Preview
            </button>
            <button className="cgo-copy-btn" onClick={copyUrl} disabled={!canAct} title={`Copy this channel's ${outputMode} output URL (for a vMix/OBS Browser Source)`}>
              {copied ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={2} />}
              {copied ? 'Copied' : 'Copy URL'}
            </button>
          </div>
        </div>
        <div className="cgp-channel-bar" title="Puts this channel's own output on a real connected screen as a borderless window sized to exactly cover it — a second monitor, projector, or a Blackmagic/other capture card whose own driver exposes its monitor-out as an ordinary system display.">
          <label className="cgp-channel-label">
            Display
            <select
              className="cgp-select"
              value={selectedMonitor}
              onChange={(e) => setSelectedMonitor(Number(e.target.value))}
              disabled={!isTauri || displayActive}
            >
              {monitors.length === 0 && <option value={0}>No displays found</option>}
              {monitors.map((m, i) => (
                <option key={i} value={i}>{m.name || `Display ${i + 1}`} ({m.size.width}×{m.size.height})</option>
              ))}
            </select>
          </label>
          <div className="cgp-channel-actions">
            <button
              className={`cgo-copy-btn${displayActive ? ' cgp-ndi-btn--live' : ''}`}
              onClick={toggleDisplay}
              disabled={!isTauri || !canAct || displayBusy || monitors.length === 0}
              title={displayActive
                ? `Close this channel's ${outputMode} display output window`
                : `Send this channel's ${outputMode} output fullscreen to the selected display`}
            >
              <Monitor size={13} strokeWidth={2} />
              {displayActive ? 'Display: On' : displayBusy ? 'Sending…' : 'Send to Display'}
            </button>
          </div>
        </div>
        {displayError && <div className="cgo-warning">Display output failed: {displayError}</div>}

        {canAct && (
          // Always visible, not just clipboard-copyable — Copy URL's own
          // navigator.clipboard.writeText can fail silently in this app's
          // Tauri webview (no dedicated clipboard permission set up for
          // it), and before this there was nowhere else the URL's actual
          // TEXT ever appeared, so a failed copy left nothing to fall back
          // to. Click-to-select-all, so a manual Cmd/Ctrl+C always works
          // regardless of whether the Copy button's own clipboard call does.
          <div className="cgp-url-row">
            <input
              ref={urlInputRef}
              className="cgp-url-display"
              readOnly
              value={channelUrl()}
              onClick={(e) => e.currentTarget.select()}
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>
        )}

        {!isTauri ? (
          <div className="cgo-warning">Output links are only available from the desktop app, not this browser preview.</div>
        ) : serverInfo && !serverInfo.readonlyEnabled ? (
          <div className="cgo-warning">
            Read-only Remote Access is off — turn it on under "Remote Access" in the sidebar, or this channel's output won't load anywhere but this machine.
          </div>
        ) : null}

        <div className="cgp-list">
          {rows.map(({ layerNum, entry }) => {
            const template = pendingTemplate[layerNum] ?? entry?.widgetId ?? '';
            const transition = pendingTransition[layerNum] ?? entry?.transitionIn ?? 'fade';
            const duration = pendingDuration[layerNum] ?? entry?.durationMs ?? 300;
            const status = entry?.status ?? 'empty';
            const preloading = !!entry?.preloading;
            // A play-intent load (Play button/Cg.In without Destination:preview)
            // stages in the background via bgWidgetId now, precisely so it
            // never touches this layer's visible status/preloading fields
            // while arming — Play's own disabled/label state needs its own
            // check for that in-flight window instead.
            const bgPreloading = !!entry?.bgWidgetId;
            const current = entry?.widgetId ? allWidgets.find((w) => w.widget.id === entry.widgetId) : null;
            const hasSteps = !!current?.widget.config.steps?.length;

            return (
              <div key={layerNum} className="cgp-row">
                <div className="cgp-row-top">
                  <span className="cgp-layer-num">{layerNum}</span>
                  <span className={`cgp-status cgp-status--${status}`}>{STATUS_LABEL[status]}</span>
                  {status === 'loaded' && preloading && (
                    <span className="cgp-preload-note" title="Fetching every image/sequence frame this template needs, so playback doesn't stutter when you press Play">
                      <span className="cgp-spinner" /> loading…
                    </span>
                  )}
                  <button
                    className="cgo-copy-btn cgp-clear-btn"
                    disabled={status === 'empty'}
                    title="Clear this layer immediately, no transition"
                    onClick={() => clearLayer(channel, layerNum)}
                  ><Trash2 size={13} strokeWidth={2} /></button>
                </div>

                <select
                  className="cgp-select cgp-select--full"
                  value={template}
                  onChange={(e) => setPendingTemplate((p) => ({ ...p, [layerNum]: e.target.value }))}
                >
                  <option value="">
                    {current ? (current.widget.label || WIDGET_TYPE_LABELS[current.widget.type]) : '— choose template —'}
                  </option>
                  {allWidgets.map(({ widget, pageName }) => (
                    <option key={widget.id} value={widget.id}>
                      {(widget.label || WIDGET_TYPE_LABELS[widget.type])} — {pageName}
                    </option>
                  ))}
                </select>

                <div className="cgp-row-mid">
                  <select
                    className="cgp-select cgp-select--sm"
                    value={transition}
                    onChange={(e) => setPendingTransition((p) => ({ ...p, [layerNum]: e.target.value as CgTransitionType }))}
                  >
                    {TRANSITIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input
                    type="number" min={0} step={50} className="cgp-num-input cgp-num-input--sm"
                    value={duration}
                    onChange={(e) => setPendingDuration((p) => ({ ...p, [layerNum]: Math.max(0, Number(e.target.value) || 0) }))}
                    title="Transition duration (ms)"
                  />
                  {template && allWidgets.find((w) => w.widget.id === template)?.widget.type === 'cg-template' && (
                    <button className="cgo-copy-btn" title="Edit this custom template's design" onClick={() => setTemplateDesignerId(template)}>
                      <Pencil size={13} strokeWidth={2} />
                    </button>
                  )}
                </div>

                <div className="cgp-row-actions">
                  <button
                    className="cgo-copy-btn"
                    disabled={!template}
                    title="Load this template into the layer, cued but not yet on air"
                    onClick={() => loadLayer(channel, layerNum, template, { transitionIn: transition, transitionOut: transition, durationMs: duration })}
                  ><Upload size={13} strokeWidth={2} /></button>
                  <button
                    className="cgo-copy-btn"
                    disabled={!template || preloading || bgPreloading}
                    title={(preloading || bgPreloading) ? 'Fetching this template\'s images/sequence frames — Play will be enabled once everything is ready' : 'Load (if needed) and play this template on air'}
                    onClick={() => loadLayer(channel, layerNum, template, { playOnLoad: true, transitionIn: transition, transitionOut: transition, durationMs: duration })}
                  >{(preloading || bgPreloading) ? <span className="cgp-spinner" /> : <Play size={13} strokeWidth={2} />}</button>
                  <button
                    className="cgo-copy-btn"
                    disabled={status !== 'playing'}
                    title={hasSteps ? 'Advance to this template\'s next Step' : "Resume this layer's animation past a stop point (no-op if it isn't paused at one)"}
                    onClick={() => continueLayer(channel, layerNum)}
                  ><SkipForward size={13} strokeWidth={2} /></button>
                  <button
                    className="cgo-copy-btn"
                    disabled={status !== 'playing' && status !== 'loaded'}
                    title="Stop this layer (plays its out-transition)"
                    onClick={() => stopLayer(channel, layerNum)}
                  ><Square size={13} strokeWidth={2} /></button>
                </div>
              </div>
            );
          })}
        </div>

        <button className="cgp-add-layer" onClick={() => setLayerCount((n) => n + 1)}>+ Layer {layerCount + 1}</button>
      </div>

      {templateDesignerId && (
        <CgTemplateDesigner widgetId={templateDesignerId} onClose={() => setTemplateDesignerId(null)} />
      )}
    </aside>
  );
}
