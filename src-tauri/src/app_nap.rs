// Prevents macOS "App Nap" from throttling this app's own timers whenever
// it isn't the frontmost/key application (minimized, another window on top,
// not currently focused) — this is a genuinely SEPARATE mechanism from
// commands.rs's existing set_sleep_block/caffeinate, which only keeps the
// whole MACHINE from sleeping. App Nap instead throttles CPU/timer
// scheduling PER PROCESS based on that process's own visibility/focus
// state, regardless of whether the machine as a whole is awake — so a
// spawned `caffeinate` child process running happily alongside this app
// does nothing to exempt THIS app's own threads (the Rust tokio tick timer
// in canvasStore.ts's Tauri path, AND the WebKit JS runloop that
// timer-tick's event listener runs in) from being napped once this app's
// own window loses focus or gets minimized/occluded — exactly the "timer
// slows down whenever the app isn't the active window" symptom this fixes.
//
// The fix is what any macOS app is expected to do when it has genuine
// background work that must keep running at full speed: hold an
// NSProcessInfo "activity" for as long as that work is happening (here:
// for as long as any timer widget anywhere is running), which tells the OS
// this process is doing user-initiated work and should not be napped.
// Toggled by the exact same "is any timer widget currently running" signal
// set_sleep_block already uses (see canvasStore.ts's syncSleepBlock) —
// both fire together from the same call site in commands.rs.

#[cfg(target_os = "macos")]
mod imp {
    use objc2::rc::Retained;
    use objc2::runtime::{NSObjectProtocol, ProtocolObject};
    use objc2_foundation::{NSActivityOptions, NSProcessInfo, NSString};
    use std::sync::Mutex;

    // objc2's Retained<ProtocolObject<dyn NSObjectProtocol>> has no
    // automatic Send/Sync — Objective-C objects generally can't assume
    // thread affinity is safe. Safe here regardless: this handle is only
    // ever read/written behind ACTIVITY's own Mutex, and endActivity: is
    // documented as callable from any thread (it's the standard "stop this
    // background activity" call, not a main-thread-only UI operation).
    struct ActivityToken(Retained<ProtocolObject<dyn NSObjectProtocol>>);
    unsafe impl Send for ActivityToken {}
    unsafe impl Sync for ActivityToken {}

    // The held activity token — its mere existence is what suppresses App
    // Nap; there is no separate "start"/"stop" call, only begin/end on this
    // one object. None = not currently blocking.
    static ACTIVITY: Mutex<Option<ActivityToken>> = Mutex::new(None);

    pub fn set_blocked(block: bool) {
        let mut guard = ACTIVITY.lock().unwrap();
        if block {
            if guard.is_some() {
                return; // already holding one
            }
            let process_info = NSProcessInfo::processInfo();
            let reason = NSString::from_str("Live broadcast timer running");
            // UserInitiated: the same "do real work at full speed, don't
            // nap me" flag Apple's own docs recommend for exactly this
            // "user started something that must keep running in real time"
            // case — also implicitly disables idle system sleep for as
            // long as it's held, overlapping with (not replacing) the
            // separate caffeinate-based block.
            let activity = process_info
                .beginActivityWithOptions_reason(NSActivityOptions::UserInitiated, &reason);
            *guard = Some(ActivityToken(activity));
        } else if let Some(token) = guard.take() {
            let process_info = NSProcessInfo::processInfo();
            unsafe { process_info.endActivity(&token.0) };
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    // App Nap is macOS-specific — Windows/Linux have no equivalent
    // per-process background throttle to defeat here.
    pub fn set_blocked(_block: bool) {}
}

pub use imp::set_blocked;

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use std::process::Command;

    // Real end-to-end check, not a mock — NSProcessInfo's activity API is
    // implemented on top of the same IOKit power-assertion mechanism
    // `pmset -g assertions` reports on, so a genuinely-held UserInitiated
    // activity should show up there, attributed to THIS process's own pid,
    // and disappear again once released. Matched by our own REASON string
    // specifically (not just "this pid has some assertion") — cargo runs
    // every #[test] in this crate as threads of the SAME process, and
    // another test running concurrently could independently hold its own
    // unrelated assertion under this exact pid, which a bare pid check
    // would collide with when the whole suite runs together.
    #[test]
    fn begin_activity_produces_a_real_power_assertion() {
        let reason_marker = "Live broadcast timer running";

        set_blocked(true);
        // Give the assertion a moment to register.
        std::thread::sleep(std::time::Duration::from_millis(300));
        let output = Command::new("pmset").args(["-g", "assertions"]).output().expect("pmset should run on macOS");
        let text = String::from_utf8_lossy(&output.stdout);
        assert!(
            text.contains(reason_marker),
            "expected pmset -g assertions to list our own '{reason_marker}' assertion while blocked, got:\n{text}"
        );

        set_blocked(false);
        std::thread::sleep(std::time::Duration::from_millis(300));
        let output = Command::new("pmset").args(["-g", "assertions"]).output().expect("pmset should run on macOS");
        let text = String::from_utf8_lossy(&output.stdout);
        assert!(
            !text.contains(reason_marker),
            "expected our own '{reason_marker}' assertion to be gone after unblocking, got:\n{text}"
        );
    }
}
