// Fill/Key/Monitor render modes for the standalone CG output routes
// (CgOutputPage.tsx's `?cgOutput=`, CgChannelOutputPage.tsx's `?cgChannel=`)
// — the same three-feed model CasparCG itself offers (a DECKLINK consumer's
// paired Fill+Key device outputs, plus a SCREEN consumer for local
// monitoring), reached here via a `mode=` query param on the exact same URL
// rather than a genuinely separate hardware consumer, since this app has no
// native video output of its own: the intended real-world setup is vMix/OBS
// capturing THREE separate Browser Sources (one per mode) and using ITS OWN
// already-hardware-tested DeckLink output feature to actually drive a real
// Fill/Key/Monitor SDI/HDMI trio from them.
//
//  - 'monitor' (default — an absent/unrecognized `mode=` behaves exactly as
//    every URL written before this existed did): full color, background
//    per the operator's own cgMonitorBg/cgMonitorBgColor app setting —
//    'transparent' (the only behavior before that setting existed) suits a
//    Browser Source that already composites alpha correctly; 'solid' is for
//    a capture path that doesn't, or for lining the CG up against a
//    specific color on purpose.
//  - 'fill': full color, but opaque BLACK instead of transparent — an SDI
//    Fill feed can't carry alpha at all, so "nothing painted here" has to
//    mean solid black, not see-through.
//  - 'key': a true luma matte — every visible pixel becomes solid WHITE at
//    its own original alpha, composited over solid black, so the resulting
//    grayscale level IS that pixel's original opacity (fully opaque -> pure
//    white, fully transparent -> pure black, a soft edge -> the correctly
//    graduated gray in between) — exactly the signal a hardware external
//    keyer expects on its Key input.
export type CgOutputMode = 'monitor' | 'fill' | 'key';

export function parseCgOutputMode(raw: string | null): CgOutputMode {
  return raw === 'fill' || raw === 'key' ? raw : 'monitor';
}

/** <html>/<body> background for a given mode — see useTransparentBackground,
 *  which this feeds directly. `monitorBg`/`monitorBgColor` are the
 *  operator's own cgMonitorBg/cgMonitorBgColor app setting, only consulted
 *  for 'monitor' — 'fill'/'key' stay unconditionally opaque black
 *  regardless, that's protocol-required (no alpha channel to fall back on
 *  over hardware/SDI), not a preference. */
export function cgOutputBackground(mode: CgOutputMode, monitorBg: 'transparent' | 'solid', monitorBgColor: string): string {
  if (mode !== 'monitor') return '#000000';
  return monitorBg === 'solid' ? monitorBgColor : 'transparent';
}

/** The CSS filter that turns a normal color render into a luma key matte —
 *  brightness(0) zeroes every pixel's R/G/B (alpha is untouched, CSS filters
 *  never touch it), then invert(1) flips that black to white, so every
 *  visible pixel ends up pure white at its own original alpha — which then
 *  correctly alpha-composites down to the right gray level once painted
 *  over solid black (see cgOutputBackground). undefined for 'fill'/'monitor'
 *  — no filter applied, normal full-color render. */
export function cgKeyFilter(mode: CgOutputMode): string | undefined {
  return mode === 'key' ? 'brightness(0) invert(1)' : undefined;
}
