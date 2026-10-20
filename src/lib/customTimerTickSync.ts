import { useCanvasStore, registerReliableTick, setTimerActive } from '../stores/canvasStore';

const _isTauriApp = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// Same root problem as countdownVmixSync.ts's own doc comment: a canvas page
// only renders (and so only ticks) its widgets while it's the ACTIVE tab
// (see Canvas.tsx — activePage?.widgets.map(...), every other page's
// widgets simply don't exist as mounted components) — so a Custom Timer's
// own countdown/countup ticking, which used to live entirely inside
// CustomTimerWidget.tsx's own useEffect (registerReliableTick already fixed
// it going STALE while the app was merely inactive/minimized, but not this
// — a genuinely UNMOUNTED component's effect cleanup unregisters that tick
// entirely), silently froze at whatever value it last held the moment the
// operator switched to a different canvas tab. This drives that same
// ticking from here instead — one shared reliable tick, independent of any
// widget/page ever being mounted, reading/writing the store directly, the
// same relationship countdownVmixSync.ts already has with its own push.
//
// 'target' mode deliberately isn't handled here: computeCountdownState
// derives its whole display purely from `Date.now()` + a fixed target
// timestamp, with no ticked/stored value of its own to keep fresh — nothing
// to do independent of a component actually being mounted to show it.

/** Wall-clock anchor per currently-RUNNING countdown/countup widget — same
 *  "recompute from elapsed real time, don't accumulate per-tick" pattern
 *  the sport game-clock timer (canvasStore.ts's own _runWallStart/
 *  _runGameMs) and this exact widget's own former component-ref version
 *  both already used; reset explicitly (see anchorCustomTimer below) by
 *  whatever actually changes the value (Play, or a +/-1-minute adjustment
 *  while running) rather than inferred by this driver watching for a
 *  running-flag transition, so it's always exact regardless of tick timing. */
const _anchor: Record<string, { wallStart: number; gameStart: number }> = {};

/** Called by CustomTimerWidget.tsx the moment it starts running (Play) or
 *  adjusts its value while already running (+/-1 min) — establishes/resets
 *  the anchor this driver's own tick reads from next. */
export function anchorCustomTimer(widgetId: string, gameStartMs: number) {
  _anchor[widgetId] = { wallStart: Date.now(), gameStart: gameStartMs };
}

/** Called on Pause (or once a countdown reaches zero) — without this, a
 *  stale anchor would sit around forever, harmless (the tick loop below
 *  already skips any widget whose own config.running is false) but pointless. */
export function clearCustomTimerAnchor(widgetId: string) {
  delete _anchor[widgetId];
}

function tick() {
  const { pages, updateWidgetConfig } = useCanvasStore.getState();
  let anyRunning = false;
  for (const page of pages) {
    for (const widget of page.widgets) {
      if (widget.type !== 'pomodoro') continue;
      const cfg = widget.config ?? {};
      if (!cfg.running || (cfg.timerMode ?? 'countdown') === 'target') continue;
      let anchor = _anchor[widget.id];
      if (!anchor) {
        // The store says this widget is running, but nothing in THIS
        // process has anchored it yet — a fresh app start (or restart)
        // with a timer that was still running when it last closed, most
        // likely. Self-heal by anchoring fresh from wherever currentMs was
        // last persisted, treating right now as the resume point, so it
        // picks back up seamlessly instead of sitting silently frozen
        // forever (anchorCustomTimer only ever gets called by an explicit
        // Play/adjust in the UI, which obviously can't happen before the
        // operator is even looking at it again).
        anchor = { wallStart: Date.now(), gameStart: cfg.currentMs ?? 0 };
        _anchor[widget.id] = anchor;
      }
      anyRunning = true;
      const elapsed = Date.now() - anchor.wallStart;
      if ((cfg.timerMode ?? 'countdown') === 'countdown') {
        const next = Math.max(0, anchor.gameStart - elapsed);
        if (next === 0) {
          clearCustomTimerAnchor(widget.id);
          updateWidgetConfig(widget.id, { currentMs: 0, running: false });
        } else {
          updateWidgetConfig(widget.id, { currentMs: next });
        }
      } else {
        updateWidgetConfig(widget.id, { currentMs: anchor.gameStart + elapsed });
      }
    }
  }
  // Blocks system sleep/App Nap for as long as ANY custom timer anywhere is
  // actually running — a single shared key (not one per widget) since this
  // one driver already covers every custom timer on every page at once.
  setTimerActive('custom-timer-global', anyRunning);
}

let started = false;

/** Starts the always-on Custom Timer countdown/countup tick loop. Desktop-
 *  host only, same as every other write-owning background process in this
 *  app (countdownVmixSync.ts, tournamentAutoAdvance.ts, ...). */
export function startCustomTimerTickSync() {
  if (!_isTauriApp || started) return;
  started = true;
  registerReliableTick('custom-timer-driver', 1000, tick);
}
