import { useState } from 'react';
import { Settings, X } from 'lucide-react';
import { useAppSettings, SCALE_PRESETS } from '../stores/appSettingsStore';
import { useVmixStore } from '../stores/vmixStore';

const DURATION_PRESETS = [2000, 3000, 5000, 8000, 10000, 15000, 20000, 30000];
const POLL_RATE_PRESETS = [200, 500, 1000, 2000, 5000];
const UI_SCALE_PRESETS = [0.8, 0.9, 1, 1.1, 1.25, 1.5];

interface Props {
  onClose: () => void;
}

const SIZE_PRESETS = [
  { label: '1920 × 1080', w: 1920, h: 1080 },
  { label: '2560 × 1440', w: 2560, h: 1440 },
  { label: '2000 × 1400', w: 2000, h: 1400 },
  { label: '1600 × 900',  w: 1600, h: 900  },
  { label: '1280 × 720',  w: 1280, h: 720  },
  { label: '1024 × 768',  w: 1024, h: 768  },
];

export function AppSettingsModal({ onClose }: Props) {
  const {
    canvasWidth, canvasHeight, canvasScale, setCanvasSize, setCanvasScale,
    uiScale, setUiScale,
    notifyGoal, notifyCard, notifySub, notifyTimePause, notifyDurationMs,
    setNotifyGoal, setNotifyCard, setNotifySub, setNotifyTimePause, setNotifyDurationMs,
    simplifyMuhammadNames, simplifyFirstNameOnly, removeBinMarkers, truncateAtBinMarker,
    setSimplifyMuhammadNames, setSimplifyFirstNameOnly, setRemoveBinMarkers, setTruncateAtBinMarker,
    vmixPollRateMs, setVmixPollRateMs,
    statusBarEnabled, setStatusBarEnabled,
  } = useAppSettings();

  const [draftW, setDraftW] = useState(String(canvasWidth));
  const [draftH, setDraftH] = useState(String(canvasHeight));

  const applySize = () => {
    const w = parseInt(draftW, 10);
    const h = parseInt(draftH, 10);
    if (w > 0 && h > 0) setCanvasSize(w, h);
  };

  // Persists the setting AND, if a vMix connection is already live, pushes
  // the new rate straight into its running poll loop — see vmixApi.ts's
  // own setPollIntervalMs doc comment for why that live wiring lives here
  // rather than inside either store (this class is deliberately store-
  // agnostic, and appSettingsStore importing vmixStore back would risk a
  // circular import for no real benefit over just doing it at this one
  // UI call site instead).
  const applyPollRate = (ms: number) => {
    setVmixPollRateMs(ms);
    useVmixStore.getState().client?.setPollIntervalMs(ms);
  };

  return (
    <div className="app-settings-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="app-settings-modal">
        <div className="app-settings-header">
          <span className="app-settings-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Settings size={14} strokeWidth={2} /> App Settings</span>
          <button
            className="app-settings-close"
            onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); onClose(); }}
            onClick={(e) => e.stopPropagation()}
          ><X size={16} strokeWidth={2} /></button>
        </div>

        <div className="app-settings-body">

          {/* ── Canvas Size ─────────────────────────────────────────────── */}
          <div className="app-settings-section">
            <div className="app-settings-section-label">Canvas Size</div>
            <p className="app-settings-hint">
              The virtual canvas widgets are placed on. Match this to your content layout size.
            </p>

            <div className="app-settings-presets">
              {SIZE_PRESETS.map(p => (
                <button
                  key={p.label}
                  className={`app-settings-preset ${p.w === canvasWidth && p.h === canvasHeight ? 'app-settings-preset--active' : ''}`}
                  onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); setCanvasSize(p.w, p.h); setDraftW(String(p.w)); setDraftH(String(p.h)); }}
                  onClick={(e) => e.stopPropagation()}
                >{p.label}</button>
              ))}
            </div>

            <div className="app-settings-size-row">
              <div className="app-settings-field">
                <label className="app-settings-label">Width (px)</label>
                <input
                  type="number"
                  className="app-settings-input"
                  value={draftW}
                  min={400}
                  max={8000}
                  onChange={e => setDraftW(e.target.value)}
                  onBlur={applySize}
                  onKeyDown={e => e.key === 'Enter' && applySize()}
                />
              </div>
              <span className="app-settings-size-x">×</span>
              <div className="app-settings-field">
                <label className="app-settings-label">Height (px)</label>
                <input
                  type="number"
                  className="app-settings-input"
                  value={draftH}
                  min={300}
                  max={8000}
                  onChange={e => setDraftH(e.target.value)}
                  onBlur={applySize}
                  onKeyDown={e => e.key === 'Enter' && applySize()}
                />
              </div>
            </div>
            <div className="app-settings-current">
              Current: {canvasWidth} × {canvasHeight} px
            </div>
          </div>

          {/* ── Canvas Scale ─────────────────────────────────────────────── */}
          <div className="app-settings-section">
            <div className="app-settings-section-label">Canvas Zoom</div>
            <p className="app-settings-hint">
              Scale the canvas view to fit your screen. Widget positions are not affected.
            </p>

            <div className="app-settings-presets">
              {SCALE_PRESETS.map(s => (
                <button
                  key={s}
                  className={`app-settings-preset ${Math.abs(s - canvasScale) < 0.01 ? 'app-settings-preset--active' : ''}`}
                  onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); setCanvasScale(s); }}
                  onClick={(e) => e.stopPropagation()}
                >{Math.round(s * 100)}%</button>
              ))}
            </div>

            <div className="app-settings-scale-row">
              <input
                type="range"
                className="app-settings-slider"
                min={10}
                max={200}
                step={1}
                value={Math.round(canvasScale * 100)}
                onChange={e => setCanvasScale(Number(e.target.value) / 100)}
              />
              <span className="app-settings-scale-val">{Math.round(canvasScale * 100)}%</span>
            </div>
          </div>

          {/* ── App UI Scale ─────────────────────────────────────────────── */}
          <div className="app-settings-section">
            <div className="app-settings-section-label">App UI Scale</div>
            <p className="app-settings-hint">
              Scales the WHOLE app — sidebar, toolbars, panels, every popup —
              not just the canvas above. Useful on a small or very high-DPI
              screen, or just personal preference. Takes effect immediately.
            </p>

            <div className="app-settings-presets">
              {UI_SCALE_PRESETS.map(s => (
                <button
                  key={s}
                  className={`app-settings-preset ${Math.abs(s - uiScale) < 0.01 ? 'app-settings-preset--active' : ''}`}
                  onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); setUiScale(s); }}
                  onClick={(e) => e.stopPropagation()}
                >{Math.round(s * 100)}%</button>
              ))}
            </div>

            <div className="app-settings-scale-row">
              <input
                type="range"
                className="app-settings-slider"
                min={50}
                max={200}
                step={5}
                value={Math.round(uiScale * 100)}
                onChange={e => setUiScale(Number(e.target.value) / 100)}
              />
              <span className="app-settings-scale-val">{Math.round(uiScale * 100)}%</span>
            </div>
          </div>

          {/* ── Read-only Notifications ────────────────────────────────── */}
          <div className="app-settings-section">
            <div className="app-settings-section-label">Read-only Notifications</div>
            <p className="app-settings-hint">
              Show popup alerts on read-only (viewer) devices when key events happen.
            </p>

            <div className="app-settings-notif-toggles">
              {[
                { label: 'Goal / Score', value: notifyGoal, set: setNotifyGoal, color: '#2ecc71' },
                { label: 'Player Card', value: notifyCard, set: setNotifyCard, color: '#e74c3c' },
                { label: 'Substitution', value: notifySub, set: setNotifySub, color: '#3498db' },
                { label: 'Time Off (pause)', value: notifyTimePause, set: setNotifyTimePause, color: '#95a5a6' },
              ].map(({ label, value, set, color }) => (
                <label key={label} className="app-settings-notif-toggle">
                  <input
                    type="checkbox"
                    checked={value}
                    onChange={e => set(e.target.checked)}
                  />
                  <span className="app-settings-notif-dot" style={{ background: color }} />
                  <span>{label}</span>
                </label>
              ))}
            </div>

            <div className="app-settings-field" style={{ marginTop: 12 }}>
              <label className="app-settings-label">Display duration</label>
              <div className="app-settings-presets">
                {DURATION_PRESETS.map(d => (
                  <button
                    key={d}
                    className={`app-settings-preset ${notifyDurationMs === d ? 'app-settings-preset--active' : ''}`}
                    onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); setNotifyDurationMs(d); }}
                    onClick={(e) => e.stopPropagation()}
                  >{d / 1000}s</button>
                ))}
              </div>
              <div className="app-settings-scale-row" style={{ marginTop: 8 }}>
                <input
                  type="range"
                  className="app-settings-slider"
                  min={1000}
                  max={30000}
                  step={500}
                  value={notifyDurationMs}
                  onChange={e => setNotifyDurationMs(Number(e.target.value))}
                />
                <span className="app-settings-scale-val">{(notifyDurationMs / 1000).toFixed(1)}s</span>
              </div>
            </div>
          </div>

          {/* ── vMix Live State Polling ─────────────────────────────────── */}
          <div className="app-settings-section">
            <div className="app-settings-section-label">vMix Live State Polling</div>
            <p className="app-settings-hint">
              How often the app fetches vMix's own live state over HTTP — every
              current input, its own text/state, tally, and preview/program
              status all come from this. Faster feels more responsive but adds
              load on both apps; slower is gentler but state can lag a little
              behind what's actually happening in vMix. Separate from the
              real-time TCP push the desktop app already uses when available
              (always on, not affected by this setting) — this is what a
              browser/remote client relies on entirely, and what desktop falls
              back to whenever TCP itself is down or reconnecting.
            </p>

            <div className="app-settings-presets">
              {POLL_RATE_PRESETS.map(ms => (
                <button
                  key={ms}
                  className={`app-settings-preset ${vmixPollRateMs === ms ? 'app-settings-preset--active' : ''}`}
                  onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); applyPollRate(ms); }}
                  onClick={(e) => e.stopPropagation()}
                >{ms}ms</button>
              ))}
            </div>

            <div className="app-settings-scale-row" style={{ marginTop: 8 }}>
              <input
                type="range"
                className="app-settings-slider"
                min={100}
                max={5000}
                step={100}
                value={vmixPollRateMs}
                onChange={e => applyPollRate(Number(e.target.value))}
              />
              <span className="app-settings-scale-val">{vmixPollRateMs}ms</span>
            </div>
          </div>

          {/* ── Simple Names ─────────────────────────────────────────────── */}
          <div className="app-settings-section">
            <div className="app-settings-section-label">Simple Names</div>
            <p className="app-settings-hint">
              Applies everywhere a player's name is shown or pushed to vMix
              — never to a name you're actively editing, so this can't
              overwrite anyone's real stored name.
            </p>

            <div className="app-settings-notif-toggles">
              <label className="app-settings-notif-toggle">
                <input type="checkbox" checked={simplifyMuhammadNames} onChange={e => setSimplifyMuhammadNames(e.target.checked)} />
                <span>Shorten Muhammad / Mohd / etc. to "M."</span>
              </label>
              <label className="app-settings-notif-toggle">
                <input type="checkbox" checked={simplifyFirstNameOnly} onChange={e => setSimplifyFirstNameOnly(e.target.checked)} />
                <span>First name only</span>
              </label>
              <label className="app-settings-notif-toggle">
                <input type="checkbox" checked={removeBinMarkers} disabled={truncateAtBinMarker} onChange={e => setRemoveBinMarkers(e.target.checked)} />
                <span>Remove "bin"/"binti"/"bt"/"b." (e.g. "Ahmad bin Abdullah" → "Ahmad Abdullah")</span>
              </label>
              <label className="app-settings-notif-toggle">
                <input type="checkbox" checked={truncateAtBinMarker} onChange={e => setTruncateAtBinMarker(e.target.checked)} />
                <span>Hide everything after "bin"/"binti"/"bt"/"b." (e.g. "Ahmad bin Abdullah" → "Ahmad") — overrides the option above</span>
              </label>
            </div>
          </div>

          {/* ── Status Bar ───────────────────────────────────────────────── */}
          <div className="app-settings-section">
            <div className="app-settings-section-label">Status Bar</div>
            <p className="app-settings-hint">
              The thin resource bar along the bottom of the window (CPU/memory/GPU/network/disk usage). Its own hide button turns this off too — this is how to bring it back.
            </p>
            <div className="app-settings-notif-toggles">
              <label className="app-settings-notif-toggle">
                <input type="checkbox" checked={statusBarEnabled} onChange={e => setStatusBarEnabled(e.target.checked)} />
                <span>Show status bar</span>
              </label>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
