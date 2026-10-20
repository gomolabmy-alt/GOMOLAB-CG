import { useContext, useState } from 'react';
import { useVmixStore } from '../../stores/vmixStore';
import { useCanvasStore } from '../../stores/canvasStore';
import { CanvasActionContext } from '../../lib/canvasContext';
import { isAppFn, isCgFn, deriveToggleOn, runActions, runButtonPress, runButtonRelease, type ActionItem } from '../../lib/buttonActions';
import { hotkeyLabel } from '../../lib/hotkeyFormat';

interface Props {
  widgetId: string;
  config: Record<string, any>;
  w: number;
  h: number;
}

type SideButton = { id: string; label: string; color?: string; textColor?: string; fontSize?: number; mode?: string; actions: ActionItem[]; releaseActions?: ActionItem[]; hotkey?: string };
type ButtonState = { id: string; name: string; color?: string; textColor?: string; actions: ActionItem[] };

const isApp = isAppFn;

function getActions(
  actions: ActionItem[] | undefined,
  legacyFn: string | undefined,
  legacyParams: Record<string, string> | undefined,
): ActionItem[] {
  if (actions?.length) return actions;
  if (legacyFn) return [{ fn: legacyFn, params: legacyParams ?? {} }];
  return [];
}

function keyInOverlay(overlays: any[], key: string, inputNumber?: number): boolean {
  if (!key && !inputNumber) return false;
  return overlays?.some((o: any) => {
    if (key && o.key && o.key !== '' && o.key === key) return true;
    if (inputNumber && o.inputNumber && o.inputNumber > 0 && o.inputNumber === inputNumber) return true;
    return false;
  }) ?? false;
}

function tallyClass(inputKey: string | undefined, actions: ActionItem[], vmixState: any): string {
  if (!vmixState) return '';

  // Overlay function tally: detect channel state from fn name
  for (const a of actions) {
    const m = a.fn?.match(/^OverlayInput(\d)(In|Out|Off)?$/);
    if (!m) continue;
    const ch = parseInt(m[1]);
    const overlay = vmixState.overlays?.find((o: any) => o.number === ch);
    if (!overlay) continue;
    const channelActive = !!(overlay.key && overlay.key !== '');
    const type = m[2]; // 'In', 'Out', 'Off', or undefined (Toggle)
    if (type === 'Out' || type === 'Off') {
      if (channelActive) return 'wgt-btn--ovl';
    } else {
      // In or Toggle: PGM > OVL > PRV using key comparison (UUID from same XML source)
      const actionInput = a.params?.Input;
      if (actionInput) {
        const inp = vmixState.inputs?.find((i: any) => i.key === actionInput);
        if (inp && vmixState.active === inp.number) return 'wgt-btn--pgm';
        if (keyInOverlay(vmixState.overlays, actionInput, inp?.number)) return 'wgt-btn--ovl';
        if (inp && vmixState.preview === inp.number) return 'wgt-btn--prv';
      } else if (channelActive) {
        return 'wgt-btn--ovl';
      }
    }
  }

  // Regular input tally
  if (!inputKey) return '';
  const input = vmixState.inputs?.find((i: any) => i.key === inputKey);
  if (!input) return '';
  if (vmixState.active === input.number) return 'wgt-btn--pgm';
  if (keyInOverlay(vmixState.overlays, inputKey, input.number)) return 'wgt-btn--ovl';
  if (vmixState.preview === input.number) return 'wgt-btn--prv';
  return '';
}

function firstInputKey(actions: ActionItem[]): string | undefined {
  return actions.find(a => a.params?.Input)?.params?.Input;
}

export function ButtonWidget({ widgetId, config }: Props) {
  const { vmixState } = useVmixStore();
  const connVmixState = vmixState;
  const store = useCanvasStore();
  const ctx = useContext(CanvasActionContext);
  const updateWidgetConfig = ctx?.updateWidgetConfig ?? store.updateWidgetConfig;
  const [firing, setFiring] = useState(false);
  const [sideFiring, setSideFiring] = useState<Record<string, boolean>>({});

  const pressActions = getActions(config.actions, config.function, config.params);
  const releaseActions = getActions(config.releaseActions, config.releaseFunction, config.releaseParams);
  const sideButtons: SideButton[] = config.sideButtons ?? [];

  // Multi-State: no on/off to derive from vMix (unlike Toggle) — which
  // state is "current" is tracked directly on the widget's own config
  // (currentStateId), same source of truth a Toggle button would otherwise
  // read live from vMix, just local since an arbitrary N-way cycle has no
  // single vMix signal to derive it from. Falls back to the first state
  // whenever the id doesn't resolve (never configured yet, or that state
  // got deleted out from under it).
  const states: ButtonState[] = config.states ?? [];
  const currentStateIdx = Math.max(0, states.findIndex(s => s.id === config.currentStateId));
  const currentState = states[currentStateIdx];

  const handleDown = async () => {
    if (config.mode === 'multiState') {
      if (states.length === 0) return;
      setFiring(true);
      const nextIdx = (currentStateIdx + 1) % states.length;
      const nextState = states[nextIdx];
      updateWidgetConfig(widgetId, { currentStateId: nextState.id });
      await runActions(nextState.actions ?? []);
      return;
    }
    if (config.mode !== 'toggle') setFiring(true);
    await runButtonPress({ mode: config.mode, actions: pressActions, releaseActions });
  };

  const handleUp = async () => {
    if (config.mode === 'multiState') { setFiring(false); return; }
    if (config.mode !== 'toggle') {
      setFiring(false);
      await runButtonRelease({ mode: config.mode, actions: pressActions, releaseActions });
    }
  };

  const handleCancel = () => { setFiring(false); };

  const handleSbDown = async (sb: SideButton) => {
    if (sb.mode !== 'toggle') setSideFiring(p => ({ ...p, [sb.id]: true }));
    await runButtonPress(sb);
  };

  const handleSbUp = async (sb: SideButton) => {
    if (sb.mode !== 'toggle') {
      setSideFiring(p => ({ ...p, [sb.id]: false }));
      await runButtonRelease(sb);
    }
  };

  const hasVmixAction = [...pressActions, ...releaseActions, ...sideButtons.flatMap(sb => [...(sb.actions ?? []), ...(sb.releaseActions ?? [])]), ...states.flatMap(s => s.actions ?? [])].some(a => a.fn && !isApp(a.fn) && !isCgFn(a.fn));

  const mainInputKey = config.tallyInputKey || firstInputKey(pressActions) || firstInputKey(releaseActions);
  const mainTally = config.mode === 'multiState' ? '' : tallyClass(mainInputKey, [...pressActions, ...releaseActions], connVmixState);

  // Toggle derives "on" from live vMix state (overlay channel / recording /
  // streaming / etc.), momentary uses tally (PGM/OVL/PRV) — neither depends
  // on local click memory. Multi-State has no single "on" — see
  // currentState above, which IS its own local click memory (there's no
  // generic live-vMix signal for "which of N states").
  const isOn = config.mode === 'toggle'
    ? deriveToggleOn([...pressActions, ...releaseActions], connVmixState)
    : config.mode === 'multiState' ? false : !!mainTally;

  const mainBtn = (
    <button
      className={`wgt-btn${sideButtons.length ? ' wgt-btn--main' : ''} ${firing ? 'wgt-btn--fire' : ''} ${isOn ? 'wgt-btn--on' : ''} ${mainTally}`}
      style={{
        '--bc': (config.mode === 'multiState' ? currentState?.color : undefined) ?? config.color ?? '#3498db',
        '--tc': (config.mode === 'multiState' ? currentState?.textColor : undefined) ?? config.textColor ?? '#fff',
        fontSize: (config.fontSize ?? 14) + 'px',
      } as React.CSSProperties}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); handleDown(); }}
      onPointerUp={handleUp}
      onPointerCancel={handleCancel}
      disabled={hasVmixAction && !connVmixState}
    >
      {config.mode === 'toggle' && <span className="wgt-btn-dot" />}
      {config.mode === 'multiState' ? (currentState?.name || config.label || 'Button') : (config.label ?? 'Button')}
      {config.hotkey && <span className="wgt-btn-hotkey-badge" title={`Hotkey: ${hotkeyLabel(config.hotkey)}`}>{hotkeyLabel(config.hotkey)}</span>}
      {mainTally && <span className={`wgt-btn-tally-badge wgt-btn-tally-badge--${mainTally === 'wgt-btn--pgm' ? 'pgm' : mainTally === 'wgt-btn--ovl' ? 'ovl' : 'prv'}`}>
        {mainTally === 'wgt-btn--pgm' ? 'PGM' : mainTally === 'wgt-btn--ovl' ? 'OVL' : 'PRV'}
      </span>}
    </button>
  );

  if (sideButtons.length === 0) return mainBtn;

  return (
    <div className="wgt-btn-group">
      {mainBtn}
      {sideButtons.map(sb => {
        const sbFire = sideFiring[sb.id] ?? false;
        const sbInputKey = firstInputKey(sb.actions ?? []) || firstInputKey(sb.releaseActions ?? []);
        const sbActions = [...(sb.actions ?? []), ...(sb.releaseActions ?? [])];
        const sbTally = tallyClass(sbInputKey, sbActions, connVmixState);
        const sbOn = sb.mode === 'toggle' ? deriveToggleOn(sbActions, connVmixState) : !!sbTally;
        return (
          <button
            key={sb.id}
            className={`wgt-btn wgt-btn--side ${sbFire ? 'wgt-btn--fire' : ''} ${sbOn ? 'wgt-btn--on' : ''} ${sbTally}`}
            style={{
              '--bc': sb.color ?? '#555555',
              '--tc': sb.textColor ?? '#fff',
              fontSize: (sb.fontSize ?? 11) + 'px',
            } as React.CSSProperties}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); handleSbDown(sb); }}
            onPointerUp={() => handleSbUp(sb)}
            onPointerCancel={() => setSideFiring(p => ({ ...p, [sb.id]: false }))}
            disabled={hasVmixAction && !connVmixState}
          >
            {sb.mode === 'toggle' && <span className="wgt-btn-dot" />}
            {sb.label || '—'}
            {sb.hotkey && <span className="wgt-btn-hotkey-badge" title={`Hotkey: ${hotkeyLabel(sb.hotkey)}`}>{hotkeyLabel(sb.hotkey)}</span>}
            {sbTally && <span className={`wgt-btn-tally-badge wgt-btn-tally-badge--${sbTally === 'wgt-btn--pgm' ? 'pgm' : sbTally === 'wgt-btn--ovl' ? 'ovl' : 'prv'}`}>
              {sbTally === 'wgt-btn--pgm' ? 'PGM' : sbTally === 'wgt-btn--ovl' ? 'OVL' : 'PRV'}
            </span>}
          </button>
        );
      })}
    </div>
  );
}
