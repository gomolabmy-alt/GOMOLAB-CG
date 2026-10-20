import { useState } from 'react';
import { Cpu, MemoryStick, Gauge, ArrowUp, ArrowDown, HardDrive, LineChart, EyeOff } from 'lucide-react';
import { useSystemStatsStore } from '../stores/systemStatsStore';
import { useAppSettings } from '../stores/appSettingsStore';
import { ResourceMonitorModal } from './ResourceMonitorModal';

// Bytes/sec -> "12.3 KB/s" / "1.2 MB/s" — never more than one decimal, so a
// fast-changing number doesn't jitter the bar's own width every poll.
export function formatRate(bps: number): string {
  if (bps < 1024) return `${bps.toFixed(0)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
}

export function formatMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
}

// This app's own live CPU/memory/disk usage, plus whole-machine GPU/network
// (see src-tauri/src/sysstats.rs's own doc comment for why those two can't
// be attributed to just this process) — a thin, always-visible footer so an
// operator can catch this app straining the machine mid-broadcast without
// alt-tabbing to Activity Monitor. The actual poll loop lives in
// systemStatsStore.ts, started/stopped from App.tsx based on
// appSettingsStore's statusBarEnabled — this component only ever reads it.
export function StatusBar() {
  const stats = useSystemStatsStore((s) => s.latest);
  const setStatusBarEnabled = useAppSettings((s) => s.setStatusBarEnabled);
  const [showMonitor, setShowMonitor] = useState(false);

  if (!stats) return null;

  const memPct = stats.mem_total_mb > 0 ? Math.round((stats.mem_used_mb / stats.mem_total_mb) * 100) : 0;

  return (
    <>
      <div className="status-bar" title="This app's own live resource usage">
        <span className="status-bar-item" title={`CPU — this app's own usage, percent of one core (${stats.cpu_percent.toFixed(0)}%)`}>
          <Cpu size={11} strokeWidth={2} /> {stats.cpu_percent.toFixed(0)}%
        </span>
        <span className="status-bar-item" title={`Memory — this app's own usage (${formatMb(stats.mem_used_mb)} of ${formatMb(stats.mem_total_mb)} total)`}>
          <MemoryStick size={11} strokeWidth={2} /> {formatMb(stats.mem_used_mb)} ({memPct}%)
        </span>
        {stats.gpu_percent != null && (
          <span className="status-bar-item" title="GPU — whole machine's own utilization (no per-app breakdown available)">
            <Gauge size={11} strokeWidth={2} /> {stats.gpu_percent.toFixed(0)}%
          </span>
        )}
        <span className="status-bar-item" title="Network — whole machine's own throughput">
          <ArrowDown size={11} strokeWidth={2} /> {formatRate(stats.net_recv_bps)}
          <ArrowUp size={11} strokeWidth={2} style={{ marginLeft: 6 }} /> {formatRate(stats.net_sent_bps)}
        </span>
        {(stats.disk_read_bps > 0 || stats.disk_write_bps > 0) && (
          <span className="status-bar-item" title="Disk — this app's own read/write throughput">
            <HardDrive size={11} strokeWidth={2} /> {formatRate(stats.disk_read_bps)} / {formatRate(stats.disk_write_bps)}
          </span>
        )}
        <span className="status-bar-spacer" />
        <button className="status-bar-btn" onClick={() => setShowMonitor(true)} title="Open Resource Monitor — charts and detailed history">
          <LineChart size={11} strokeWidth={2} />
        </button>
        <button className="status-bar-btn" onClick={() => setStatusBarEnabled(false)} title="Hide this bar (App Settings → Status Bar to bring it back)">
          <EyeOff size={11} strokeWidth={2} />
        </button>
      </div>
      {showMonitor && <ResourceMonitorModal onClose={() => setShowMonitor(false)} />}
    </>
  );
}
