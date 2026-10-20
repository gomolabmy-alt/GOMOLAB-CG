// A small library of UI/broadcast sound effects — SYNTHESIZED entirely via
// the Web Audio API at playback time, not downloaded/bundled audio files.
// Deliberate choice: this app is commercial broadcast software, and
// "collect sound effects from the internet" runs straight into real
// licensing risk — the overwhelming majority of "free" SFX sites are
// CC-BY at best (attribution required in every shipped copy) or outright
// non-commercial-only, not the CC0/public-domain a product can actually
// redistribute without tracking a license per file. A synthesized tone
// carries none of that (no external asset, no attribution, no network
// dependency, no download to fail), costs a few KB of code instead of
// megabytes of audio, and is fully parametric — the "as many as possible"
// spirit of the ask is served by breadth of DISTINCT-sounding effects here
// (20, covering UI feedback, broadcast stingers, and game-y accents) rather
// than by pulling in arbitrary internet files of uncertain rights.
//
// Used by: CgTemplateDesigner.tsx's own "Snap Sound" (audible UI feedback
// when a smart guide snaps into place) and CgAnimState.soundEffect (an
// actual broadcast stinger played on the REAL output when that state's
// timeline starts — see cgAnimationEngine.ts's buildOneTimeline).

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  // Browsers/WebKit suspend a freshly-created (or long-idle) AudioContext
  // until a user gesture resumes it — every call site here is already
  // triggered by one (a drag, a button click, a template actually going
  // live), so resuming unconditionally is always safe and never surprises
  // anyone with unexpected audio.
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** A single oscillator with a short attack/decay envelope — the workhorse
 *  behind most of the library below. `freqEnd` (if given) sweeps the pitch
 *  exponentially over the tone's own duration — what gives "riser"/
 *  "downer"/"zap"-style effects their motion; a plain tone omits it. */
function tone(freq: number, duration: number, type: OscillatorType, volume: number, freqEnd?: number) {
  const c = getCtx();
  if (!c || volume <= 0) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(1, freq), c.currentTime);
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), c.currentTime + duration);
  const attack = Math.min(0.01, duration / 4);
  gain.gain.setValueAtTime(0, c.currentTime);
  gain.gain.linearRampToValueAtTime(volume, c.currentTime + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
  osc.connect(gain).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + duration + 0.05);
}

/** White noise through an optional lowpass filter — the basis for every
 *  "whoosh"/"swoosh"/impact-with-texture effect below, since a pure
 *  oscillator alone can't produce that broadband, airy quality. */
function noise(duration: number, volume: number, filterFreq?: number) {
  const c = getCtx();
  if (!c || volume <= 0) return;
  const bufferSize = Math.max(1, Math.floor(c.sampleRate * duration));
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buffer;
  const gain = c.createGain();
  gain.gain.setValueAtTime(volume, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
  let node: AudioNode = src;
  if (filterFreq) {
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    src.connect(filter);
    node = filter;
  }
  node.connect(gain).connect(c.destination);
  src.start();
}

/** Schedules a second tone slightly after the first — the basis for the
 *  handful of short melodic effects below (chime/success/notify/coin),
 *  each just a couple of these calls at small time offsets. */
function toneAt(delayMs: number, freq: number, duration: number, type: OscillatorType, volume: number) {
  if (delayMs <= 0) { tone(freq, duration, type, volume); return; }
  setTimeout(() => tone(freq, duration, type, volume), delayMs);
}

export interface SfxDef {
  id: string;
  label: string;
  play: (volume: number) => void;
}

export const SFX_LIBRARY: SfxDef[] = [
  { id: 'click', label: 'Click', play: (v) => tone(1200, 0.04, 'square', v * 0.3) },
  { id: 'tick', label: 'Tick', play: (v) => tone(2000, 0.02, 'square', v * 0.22) },
  { id: 'pop', label: 'Pop', play: (v) => tone(600, 0.08, 'sine', v * 0.5, 200) },
  { id: 'snap', label: 'Snap', play: (v) => tone(1800, 0.05, 'triangle', v * 0.35, 900) },
  { id: 'blip', label: 'Blip', play: (v) => tone(2400, 0.03, 'square', v * 0.25) },
  { id: 'ding', label: 'Ding', play: (v) => tone(1567.98, 0.6, 'sine', v * 0.4) },
  { id: 'chime', label: 'Chime', play: (v) => { tone(1046.5, 0.5, 'sine', v * 0.28); toneAt(80, 1318.5, 0.5, 'sine', v * 0.28); toneAt(160, 1567.98, 0.7, 'sine', v * 0.28); } },
  { id: 'notify', label: 'Notify', play: (v) => { tone(880, 0.1, 'sine', v * 0.3); toneAt(100, 1108.73, 0.15, 'sine', v * 0.3); } },
  { id: 'success', label: 'Success', play: (v) => { tone(523.25, 0.15, 'sine', v * 0.3); toneAt(100, 659.25, 0.15, 'sine', v * 0.3); toneAt(200, 783.99, 0.3, 'sine', v * 0.3); } },
  { id: 'error', label: 'Error', play: (v) => { tone(200, 0.15, 'square', v * 0.28); toneAt(120, 140, 0.25, 'square', v * 0.28); } },
  { id: 'coin', label: 'Coin', play: (v) => { tone(988, 0.08, 'square', v * 0.25); toneAt(80, 1319, 0.25, 'square', v * 0.25); } },
  { id: 'whoosh', label: 'Whoosh', play: (v) => noise(0.35, v * 0.5, 4000) },
  { id: 'swoosh', label: 'Swoosh', play: (v) => noise(0.25, v * 0.6, 6000) },
  { id: 'riser', label: 'Riser', play: (v) => tone(200, 0.8, 'sawtooth', v * 0.22, 1600) },
  { id: 'downer', label: 'Downer', play: (v) => tone(1200, 0.6, 'sawtooth', v * 0.22, 100) },
  { id: 'drop', label: 'Drop', play: (v) => tone(150, 0.3, 'sine', v * 0.5, 40) },
  { id: 'impact', label: 'Impact', play: (v) => { tone(80, 0.3, 'sine', v * 0.55, 30); noise(0.15, v * 0.35, 1500); } },
  { id: 'zap', label: 'Zap', play: (v) => tone(3000, 0.12, 'sawtooth', v * 0.3, 200) },
  { id: 'camera', label: 'Camera Shutter', play: (v) => noise(0.06, v * 0.7, 8000) },
  { id: 'typewriter', label: 'Typewriter Key', play: (v) => { noise(0.02, v * 0.4, 5000); tone(400, 0.02, 'square', v * 0.2); } },
];

const SFX_BY_ID: Record<string, SfxDef> = Object.fromEntries(SFX_LIBRARY.map((s) => [s.id, s]));

/** Plays one library sound by id — silently does nothing for an unknown id
 *  (a template authored with a since-removed effect, say) or in an
 *  environment with no Web Audio support at all, same "never crash over an
 *  optional cosmetic" tolerance every other effect in this app already has. */
export function playSfx(id: string | undefined, volume = 1): void {
  if (!id) return;
  SFX_BY_ID[id]?.play(Math.max(0, Math.min(1, volume)));
}

let primed = false;

/** Best-effort autoplay unlock for a page that never receives a real user
 *  gesture — the actual broadcast output routes (CgOutputPage.tsx,
 *  CgChannelOutputPage.tsx), which are loaded headless by vMix's "Web
 *  Browser" input / OBS's Browser Source, not clicked into by anyone.
 *  getCtx()'s own resume() call is enough everywhere else in the app
 *  (Designer clicks, button presses), but a fresh AudioContext there stays
 *  permanently suspended — a state's soundEffect would silently never be
 *  heard on the real output — since the browser's autoplay policy has
 *  nothing to unlock it with. This creates the context as early as
 *  possible and keeps retrying resume() both on a timer and on whatever
 *  interaction-shaped events might ever reach that page (a vMix/OBS
 *  version that does forward input, an operator alt-tabbing into it to
 *  check it), so the very first soundEffect call already has a running
 *  context instead of a permanently-stuck one. Call once per page mount;
 *  safe (a no-op) to call more than once or in a non-browser environment. */
export function primeAudio(): void {
  if (primed || typeof window === 'undefined') return;
  primed = true;
  getCtx();
  const unlock = () => {
    const c = getCtx();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
  };
  const events: Array<keyof WindowEventMap> = ['pointerdown', 'mousedown', 'keydown', 'touchstart', 'focus'];
  for (const ev of events) window.addEventListener(ev, unlock, { passive: true });
  document.addEventListener('visibilitychange', unlock, { passive: true });
  // Some engines allow resume() once a media-engagement threshold is met
  // rather than strictly requiring a gesture — cheap to keep polling for a
  // while, harmless once it succeeds (getCtx() itself no-ops on a running
  // context).
  let attempts = 0;
  const timer = setInterval(() => {
    attempts++;
    const c = getCtx();
    if (!c || c.state === 'running' || attempts > 30) { clearInterval(timer); return; }
  }, 1000);
}
