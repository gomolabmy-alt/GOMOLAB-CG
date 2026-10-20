import { useEffect } from 'react';

// Forces <html>/<body> to a given background for the lifetime of the
// calling component, restoring whatever was there before on unmount.
// Shared by every standalone CG output route (CgOutputPage,
// CgChannelOutputPage) — these are meant to be captured as a vMix "Web
// Browser" input / OBS Browser Source, so nothing but the graphic itself
// should ever paint. Defaults to 'transparent' (the only behavior before
// the `mode` query param existed) — a Fill/Key render passes '#000000'
// instead, since those are meant for hardware/SDI capture (via vMix/OBS's
// own DeckLink output) that can't carry alpha at all, so "nothing painted"
// there needs to mean opaque black, not see-through.
export function useTransparentBackground(background: string = 'transparent') {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlBg = html.style.background;
    const prevBodyBg = body.style.background;
    html.style.background = background;
    body.style.background = background;
    return () => {
      html.style.background = prevHtmlBg;
      body.style.background = prevBodyBg;
    };
  }, [background]);
}
