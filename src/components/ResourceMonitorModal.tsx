import { Activity, X } from 'lucide-react';
import { useSystemStatsStore } from '../stores/systemStatsStore';
import { formatMb, formatRate } from './StatusBar';

interface Props {
  onClose: () => void;
}

// A plain SVG polyline — no charting library pulled in for this (same
// "hand-roll it, this app avoids heavy runtime deps" spirit as
// EaseCurveEditor.tsx's own curve canvas). `ceiling` fixes the Y axis at a
// known max (100 for a percent series) so the line's own height reads as an
// absolute level; omitted, it auto-scales to this series' own peak instead
// (memory/network/disk, where there's no natural 0-100 ceiling).
function Sparkline({ values, ceiling, color }: { values: number[]; ceiling?: number; color: string }) {
  const w = 300, h = 48;
  if (values.length < 2) {
    return <svg viewBox={`0 0 ${w} ${h}`} className="rmon-chart" preserveAspectRatio="none" />;
  }
  const max = Math.max(ceiling ?? 0, ...values, 0.0001);
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - (Math.max(0, v) / max) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const areaPoints = `0,${h} ${points} ${w},${h}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="rmon-chart" preserveAspectRatio="none">
      <polygon points={areaPoints} fill={color} opacity={0.12} />
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function StatRow({ label, color, ceiling, values, current, fmt }: {
  label: string;
  color: string;
  ceiling?: number;
  values: number[];
  current: string;
  fmt: (v: number) => string;
}) {
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  return (
    <div className="rmon-row">
      <div className="rmon-row-head">
        <span className="rmon-row-dot" style={{ background: color }} />
        <span className="rmon-row-label">{label}</span>
        <span className="rmon-row-current" style={{ color }}>{current}</span>
      </div>
      <Sparkline values={values} ceiling={ceiling} color={color} />
      <div className="rmon-row-stats">
        <span>min {fmt(min)}</span>
        <span>avg {fmt(avg)}</span>
        <span>max {fmt(max)}</span>
      </div>
    </div>
  );
}

// The status bar's own "+detail" page — same history the bar itself reads
// (systemStatsStore.ts), just charted over the last ~5 minutes instead of
// only ever showing the latest sample. A modal, not a canvas-mode tab
// (App.tsx's Main Canvas/Commentator/Templates), since this is a one-off
// diagnostic view rather than something an operator works IN.
export function ResourceMonitorModal({ onClose }: Props) {
  const history = useSystemStatsStore((s) => s.history);
  const latest = history[history.length - 1];

  if (!latest) {
    return (
      <div className="app-settings-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="app-settings-modal rmon-modal">
          <div className="app-settings-header">
            <span className="app-settings-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Activity size={14} strokeWidth={2} /> Resource Monitor</span>
            <button className="app-settings-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
          </div>
          <div className="app-settings-body"><p className="app-settings-hint">Collecting data…</p></div>
        </div>
      </div>
    );
  }

  const memPct = history.map((s) => (s.mem_total_mb > 0 ? (s.mem_used_mb / s.mem_total_mb) * 100 : 0));
  const hasGpu = history.some((s) => s.gpu_percent != null);
  const hasDisk = history.some((s) => s.disk_read_bps > 0 || s.disk_write_bps > 0);

  return (
    <div className="app-settings-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="app-settings-modal rmon-modal">
        <div className="app-settings-header">
          <span className="app-settings-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Activity size={14} strokeWidth={2} /> Resource Monitor</span>
          <button className="app-settings-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="app-settings-body">
          <p className="app-settings-hint">
            This app's own CPU/memory/disk usage, plus the whole machine's own GPU/network totals (no reliable per-app breakdown exists for those two) — the last {history.length} samples, about {Math.round((history.length * 2) / 60) || 1} minute{history.length > 30 ? 's' : ''} of history.
          </p>

          <div className="app-settings-section">
            <div className="app-settings-section-label">This App</div>
            <StatRow
              label="CPU" color="#2f8fe6" ceiling={100}
              values={history.map((s) => s.cpu_percent)}
              current={`${latest.cpu_percent.toFixed(0)}%`}
              fmt={(v) => `${v.toFixed(0)}%`}
            />
            <StatRow
              label="Memory" color="#9b59b6"
              values={memPct}
              current={`${formatMb(latest.mem_used_mb)} (${Math.round(memPct[memPct.length - 1])}%)`}
              fmt={(v) => `${v.toFixed(0)}%`}
            />
            {hasDisk && (
              <>
                <StatRow
                  label="Disk Read" color="#16a085"
                  values={history.map((s) => s.disk_read_bps)}
                  current={formatRate(latest.disk_read_bps)}
                  fmt={formatRate}
                />
                <StatRow
                  label="Disk Write" color="#d35400"
                  values={history.map((s) => s.disk_write_bps)}
                  current={formatRate(latest.disk_write_bps)}
                  fmt={formatRate}
                />
              </>
            )}
          </div>

          <div className="app-settings-section">
            <div className="app-settings-section-label">Whole Machine</div>
            {hasGpu && (
              <StatRow
                label="GPU" color="#e67e22" ceiling={100}
                values={history.map((s) => s.gpu_percent ?? 0)}
                current={`${(latest.gpu_percent ?? 0).toFixed(0)}%`}
                fmt={(v) => `${v.toFixed(0)}%`}
              />
            )}
            <StatRow
              label="Network ↓ (download)" color="#43a047"
              values={history.map((s) => s.net_recv_bps)}
              current={formatRate(latest.net_recv_bps)}
              fmt={formatRate}
            />
            <StatRow
              label="Network ↑ (upload)" color="#e53935"
              values={history.map((s) => s.net_sent_bps)}
              current={formatRate(latest.net_sent_bps)}
              fmt={formatRate}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
