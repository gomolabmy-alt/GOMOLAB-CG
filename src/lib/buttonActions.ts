import { useVmixStore } from '../stores/vmixStore';
import { useCanvasStore } from '../stores/canvasStore';
import { useCgPlayoutStore } from '../stores/cgPlayoutStore';

export type ActionItem = {
  fn: string;
  params: Record<string, string>;
  /** Editor-only UI preference for this action's own "Value" param — lets
   *  an operator turn ANY function's Value field into a slider with a
   *  range THEY define (e.g. a custom GT title field, like a specific
   *  image layer's opacity property that only exists in their own
   *  .gtzip template, which this app has no way to know about ahead of
   *  time) — see ActionListEditor.tsx's own "+ Use slider…" control.
   *  Deliberately a SIBLING of `params`, never inside it: dispatchAction
   *  below only ever reads `fn`/`params` when actually firing this action,
   *  so this is never sent to vMix as a bogus extra parameter. */
  valueRange?: { min: number; max: number; step?: number };
};
export type ButtonLike = { mode?: string; actions?: ActionItem[]; releaseActions?: ActionItem[] };

export function isAppFn(fn: string) { return fn?.startsWith('App.'); }
export function isCgFn(fn: string) { return fn?.startsWith('Cg.'); }

// Shared by dispatchCgAction/deriveToggleOn/runButtonPress so all three
// parse a Cg.* action's Channel/Layer params (and build cgPlayoutStore's
// own "<channel>-<layer>" lookup key) the exact same way.
function cgChannelLayer(params: Record<string, string>): [number, number] {
  const channel = parseInt(params.Channel ?? '1', 10) || 1;
  const layer = parseInt(params.Layer ?? '1', 10) || 1;
  return [channel, layer];
}

// Drives CG Playout directly from a button/hotkey — same Channel/Layer
// params the CG Playout Panel's own fields use. `Cg.In`'s widget reference
// is stored under the `Input` param key (not a new `Template` key) so it
// rides autoLink.ts's existing generic remapActionList for free: that
// remap matches on `params.Input` regardless of `fn`, so a renamed template
// keeps this button pointed at the right widget with no extra code here.
function dispatchCgAction(fn: string, params: Record<string, string>) {
  const [channel, layer] = cgChannelLayer(params);
  const store = useCgPlayoutStore.getState();
  switch (fn) {
    case 'Cg.In': {
      const widgetId = params.Input;
      if (!widgetId) return;
      store.loadLayer(channel, layer, widgetId, { playOnLoad: params.Destination !== 'preview' });
      break;
    }
    case 'Cg.Out':
      store.stopLayer(channel, layer);
      break;
    case 'Cg.Stage':
      store.continueLayer(channel, layer);
      break;
    case 'Cg.Loop':
      store.restartLoopLayer(channel, layer);
      break;
  }
}

// Runs one action item outside of React — usable from a widget's own click
// handler or from a global hotkey callback with no component mounted.
export async function dispatchAction(fn: string, params: Record<string, string>) {
  if (!fn) return;
  // Special-cased here rather than in executeAppFunction's switch: this is
  // the ONLY caller of executeAppFunction (grep-verified), and it's the one
  // that's actually async/awaited by runActions' for-loop below — a real
  // delay only holds up the next action in the list if it happens here,
  // before delegating to that synchronous switch.
  if (fn === 'App.Wait') {
    const seconds = parseFloat(params.Seconds ?? '1');
    if (seconds > 0) await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    return;
  }
  if (isAppFn(fn)) useCanvasStore.getState().executeAppFunction(fn, params);
  else if (isCgFn(fn)) dispatchCgAction(fn, params);
  else await useVmixStore.getState().getClient()?.sendFunction(fn, params);
}

export async function runActions(actions: ActionItem[]) {
  for (const action of actions) {
    await dispatchAction(action.fn, action.params);
  }
}

// Derives a toggle button's on/off state from live vMix state (or, for a
// Cg.In action, live CG Playout state) rather than local click tracking, so
// it reflects reality even when the state changed via another control
// surface, vMix/CG itself, or a command that silently failed. Checked ahead
// of the vmixState-gated logic below since a CG-only button needs this to
// work with no vMix connection at all.
export function deriveToggleOn(actions: ActionItem[], vmixState: any): boolean {
  const cgIn = actions.find(a => a.fn === 'Cg.In');
  if (cgIn) {
    const [channel, layer] = cgChannelLayer(cgIn.params);
    const layerState = useCgPlayoutStore.getState().layers[`${channel}-${layer}`];
    return !!layerState?.widgetId && layerState.status !== 'empty';
  }
  if (!vmixState) return false;
  for (const a of actions) {
    const fn = a.fn;
    if (!fn) continue;
    const ovlMatch = fn.match(/^OverlayInput(\d)(In|Out|Off|Toggle)?$/);
    if (ovlMatch) {
      const ch = parseInt(ovlMatch[1], 10);
      const overlay = vmixState.overlays?.find((o: any) => o.number === ch);
      if (overlay) return !!(overlay.key && overlay.key !== '');
    }
    // Input-switching functions — Cut/ActiveInput/QuickPlay target Program,
    // PreviewInput targets Preview. `a.params.Input` stores vMix's input
    // GUID (see ActionListEditor.tsx's own InputPickerDropdown), while
    // vmixState.active/preview are plain input NUMBERS, so resolve the GUID
    // to its current number via vmixState.inputs before comparing. Without
    // this, a toggle-mode button built to switch between two inputs could
    // never actually read vMix's real state back (every other case below
    // falls through to `return false` for any fn it doesn't recognize),
    // so it always re-ran its press actions and never its release ones —
    // visibly "stuck" rather than genuinely toggling.
    if (fn === 'Cut' || fn === 'ActiveInput' || fn === 'QuickPlay' || fn === 'PreviewInput') {
      const inputKey = a.params.Input;
      const input = inputKey ? vmixState.inputs?.find((i: any) => i.key === inputKey) : null;
      if (input) {
        return fn === 'PreviewInput' ? input.number === vmixState.preview : input.number === vmixState.active;
      }
    }
    switch (fn) {
      case 'StartRecording': case 'StopRecording': case 'RecordingToggle':
        return !!vmixState.recording;
      case 'StartStreaming': case 'StopStreaming': case 'StreamingToggle':
        return !!vmixState.streaming;
      case 'StartExternal': case 'StopExternal': case 'ExternalToggle':
        return !!vmixState.external;
      case 'StartFullScreen': case 'StopFullScreen': case 'FullScreenToggle':
        return !!vmixState.fullscreen;
      case 'FadeToBlack':
        return !!vmixState.fadeToBlack;
      case 'StartMultiCorder': case 'StopMultiCorder': case 'MultiCorderToggle':
        return !!vmixState.multiCorder;
    }
  }
  return false;
}

// Replicates a button's onPointerDown behavior (mode-aware: toggle flips
// between press/release action lists based on live vMix/CG state, momentary
// just runs the press actions) — shared by ButtonWidget's own click handler
// and the global hotkey registry so both trigger identical behavior.
export async function runButtonPress(btn: ButtonLike) {
  const press = btn.actions ?? [];
  const release = btn.releaseActions ?? [];
  if (btn.mode === 'toggle') {
    const vmixState = useVmixStore.getState().vmixState;
    const currentlyOn = deriveToggleOn([...press, ...release], vmixState);
    if (!currentlyOn) {
      await runActions(press);
    } else if (release.length) {
      await runActions(release);
    } else {
      // A lone Cg.In action (the common CG toggle setup — see
      // deriveToggleOn) needs no separately-configured Release action: its
      // own Channel/Layer already tell us what to stop.
      const cgIn = press.find(a => a.fn === 'Cg.In');
      if (cgIn) {
        const [channel, layer] = cgChannelLayer(cgIn.params);
        useCgPlayoutStore.getState().stopLayer(channel, layer);
      }
    }
  } else {
    await runActions(press);
  }
}

// Replicates a button's onPointerUp behavior — no-op for toggle mode, since
// toggle already resolved everything on press.
export async function runButtonRelease(btn: ButtonLike) {
  if (btn.mode !== 'toggle') await runActions(btn.releaseActions ?? []);
}
