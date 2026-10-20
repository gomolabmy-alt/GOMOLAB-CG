import { create } from 'zustand';

export interface SystemStats {
  cpu_percent: number;
  mem_used_mb: number;
  mem_total_mb: number;
  gpu_percent: number | null;
  net_sent_bps: number;
  net_recv_bps: number;
  disk_read_bps: number;
  disk_write_bps: number;
}

export interface SystemStatsSample extends SystemStats {
  t: number;
}

// ~5 minutes of history at the 2s poll interval below — enough for
// ResourceMonitorModal's own charts to show a meaningful trend without
// holding an unbounded, ever-growing array for an app that may run for
// hours during a broadcast.
const HISTORY_LIMIT = 150;
const POLL_MS = 2000;

interface SystemStatsStoreState {
  latest: SystemStatsSample | null;
  history: SystemStatsSample[];
}

// A single shared history, not per-component state — StatusBar.tsx and
// ResourceMonitorModal.tsx both read from here, so opening the detail
// modal doesn't start a second, independent poll loop (and losing the
// history collected before it opened).
export const useSystemStatsStore = create<SystemStatsStoreState>(() => ({
  latest: null,
  history: [],
}));

let timer: ReturnType<typeof setInterval> | undefined;

async function poll() {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const s = await invoke<SystemStats>('get_system_stats');
    const sample: SystemStatsSample = { ...s, t: Date.now() };
    useSystemStatsStore.setState((prev) => ({
      latest: sample,
      history: [...prev.history, sample].slice(-HISTORY_LIMIT),
    }));
  } catch {
    // Desktop-only Tauri command — silently no-ops in a browser tab/remote
    // client, same tolerance every other invoke() call in this app has.
  }
}

/** Idempotent — a second call while already running is a no-op, so App.tsx's
 *  own enable/disable effect can call this freely without tracking whether
 *  it's already active. */
export function startSystemStatsPolling() {
  if (timer) return;
  poll();
  timer = setInterval(poll, POLL_MS);
}

/** Also clears the accumulated history — turning the status bar back on
 *  after being off should start a fresh read of "right now", not resume
 *  charting across the gap as if nothing happened. */
export function stopSystemStatsPolling() {
  if (timer) { clearInterval(timer); timer = undefined; }
  useSystemStatsStore.setState({ latest: null, history: [] });
}
