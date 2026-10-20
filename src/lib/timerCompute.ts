// Shared with TimerWidget.tsx's own on-screen render AND lib/templateBinding.ts's
// CG-template binding resolver, so "what does this Timer widget currently
// display" has exactly one definition both agree on — same reasoning as
// countdownCompute.ts's identical split for the Countdown/pomodoro widget.

/** Pure function: the widget's own period-aware "accumulated" time, given
 *  its (possibly linked-timer-resolved) effective config — no React, no
 *  store subscription, safe to call from anywhere. During a count-up
 *  overrun this is elapsed-since-overrun-start (from 00:00), not the full
 *  accumulated period time — see TimerWidget.tsx's identical original
 *  comment on this same logic. */
export function computeTimerAccumulatedMs(dc: Record<string, any>): number {
  const isCountdown = (dc.mode ?? 'countdown') === 'countdown';
  const isContinue = (dc.periodMode ?? 'reset') === 'continue';

  if (isCountdown || isContinue) {
    // Countup+continue overrun: currentMs = periodStart + durationMs + elapsed → strip the offset
    if (!isCountdown && (dc.overrunning ?? false) && (dc.durationMs ?? 0) > 0) {
      return Math.max(0, (dc.currentMs ?? 0) - (dc.periodStartMs ?? 0) - dc.durationMs);
    }
    return dc.currentMs ?? 0;
  }
  // Countup+reset overrun: same strip
  if ((dc.overrunning ?? false) && (dc.durationMs ?? 0) > 0) {
    return Math.max(0, (dc.currentMs ?? 0) - (dc.periodStartMs ?? 0) - dc.durationMs);
  }
  const period = Math.min(dc.currentPeriod ?? 1, dc.periods ?? 1);
  return (period - 1) * (dc.durationMs ?? 0) + (dc.currentMs ?? 0);
}
