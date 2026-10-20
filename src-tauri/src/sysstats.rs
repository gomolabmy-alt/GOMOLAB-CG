// Status bar resource monitor — see src/components/StatusBar.tsx, which
// polls get_system_stats every couple seconds. Deliberately app-scoped for
// CPU/memory (this PROCESS's own usage — "is THIS app straining the
// machine", which is what an operator actually wants from a status bar
// wedged into a broadcast control app), but GPU and network fall back to
// whole-MACHINE totals: neither has a meaningful per-process reading
// available on macOS without a private/root-only API (see gpu_percent
// below), so this reports the best available number instead of omitting
// the field entirely — a reasonable proxy given this machine's own other
// GPU/network activity is normally minimal during a broadcast.
use once_cell::sync::Lazy;
use serde::Serialize;
use std::sync::Mutex;
use std::time::Instant;
use sysinfo::{Networks, Pid, ProcessesToUpdate, System};

struct Monitor {
    sys: System,
    networks: Networks,
    pid: Pid,
    last_net_sample: Instant,
}

static MONITOR: Lazy<Mutex<Monitor>> = Lazy::new(|| {
    let pid = sysinfo::get_current_pid().unwrap_or(Pid::from_u32(std::process::id()));
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);
    sys.refresh_memory();
    Mutex::new(Monitor {
        sys,
        networks: Networks::new_with_refreshed_list(),
        pid,
        last_net_sample: Instant::now(),
    })
});

#[derive(Serialize, Clone, Copy)]
pub struct SystemStats {
    /// This app's own CPU usage, percent of one core — can exceed 100 on a
    /// multi-core machine using more than one core's worth of work, same
    /// convention Activity Monitor's own "%CPU" column uses.
    cpu_percent: f32,
    /// This app's own resident memory, MB.
    mem_used_mb: f64,
    /// Whole machine's own total physical memory, MB — paired with
    /// mem_used_mb so the frontend can show a fraction/bar without a
    /// second call.
    mem_total_mb: f64,
    /// Whole MACHINE's own GPU utilization, 0-100. None on non-macOS, or if
    /// this machine's own GPU driver doesn't expose the reading this looks
    /// for (see gpu_percent below) — the frontend hides the field rather
    /// than showing a misleading 0.
    gpu_percent: Option<f32>,
    /// Whole machine's own network throughput since the last poll,
    /// bytes/sec, summed across every non-loopback interface.
    net_sent_bps: f64,
    net_recv_bps: f64,
    /// This app's own disk I/O since the last poll, bytes/sec — relevant
    /// here given how much of what this app does (image/sequence import,
    /// CG asset caching) is itself disk-bound.
    disk_read_bps: f64,
    disk_write_bps: f64,
}

#[tauri::command]
pub fn get_system_stats() -> SystemStats {
    let mut m = MONITOR.lock().unwrap();

    m.sys.refresh_cpu_all();
    let pid = m.pid;
    m.sys.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);
    m.sys.refresh_memory();

    let (cpu_percent, mem_used_mb, disk_read, disk_write) = m
        .sys
        .process(pid)
        .map(|p| {
            let disk = p.disk_usage();
            (
                p.cpu_usage(),
                p.memory() as f64 / 1024.0 / 1024.0,
                disk.read_bytes,
                disk.written_bytes,
            )
        })
        .unwrap_or((0.0, 0.0, 0, 0));
    let mem_total_mb = m.sys.total_memory() as f64 / 1024.0 / 1024.0;

    let elapsed = m.last_net_sample.elapsed().as_secs_f64().max(0.001);
    m.last_net_sample = Instant::now();
    m.networks.refresh();
    let (mut net_sent, mut net_recv) = (0u64, 0u64);
    for (name, data) in m.networks.iter() {
        // Loopback carries this app's own localhost traffic (the CG output
        // HTTP server, WS sync, vMix control on 127.0.0.1) — excluded so
        // this reads as genuine network activity, not this app talking to
        // itself.
        if name.starts_with("lo") {
            continue;
        }
        net_sent += data.transmitted();
        net_recv += data.received();
    }

    drop(m);

    SystemStats {
        cpu_percent,
        mem_used_mb,
        mem_total_mb,
        gpu_percent: gpu_percent(),
        net_sent_bps: net_sent as f64 / elapsed,
        net_recv_bps: net_recv as f64 / elapsed,
        disk_read_bps: disk_read as f64 / elapsed,
        disk_write_bps: disk_write as f64 / elapsed,
    }
}

/// GPU utilization has no cross-platform crate support (sysinfo doesn't
/// track it at all — vendor GPU counters are their own, non-uniform APIs)
/// and no per-process breakdown on macOS without a private/root-only API,
/// so this shells out to `ioreg`, unprivileged, and reads the same overall
/// "Device Utilization %" counter Activity Monitor's own GPU History window
/// is built from. `-c IOAccelerator` matches whichever GPU driver class is
/// actually loaded (AGXAccelerator on Apple Silicon; confirmed working
/// there — Intel/AMD Macs share the same IOAccelerator match category but
/// weren't available to verify against, hence the graceful None below
/// rather than assuming the key name matches).
#[cfg(target_os = "macos")]
fn gpu_percent() -> Option<f32> {
    let output = std::process::Command::new("ioreg")
        .args(["-r", "-d", "1", "-c", "IOAccelerator"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let key = "\"Device Utilization %\"=";
    let idx = text.find(key)?;
    let digits: String = text[idx + key.len()..]
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    digits.parse::<f32>().ok()
}

#[cfg(not(target_os = "macos"))]
fn gpu_percent() -> Option<f32> {
    None
}
