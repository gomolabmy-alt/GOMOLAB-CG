import { useLayoutEffect, useState, type RefObject } from 'react';

const MIN_FONT_SIZE = 6;

// Shrinks a text element's font size (from an authored maximum) until its
// content fits its box, the same "auto-fit" convenience some titling tools
// offer on top of vMix GT Designer's own plain word-wrap. No pure-CSS way
// to do this reliably for arbitrary wrapped text, so it's real DOM
// measurement: scrollHeight/scrollWidth always reflect the element's true
// content size regardless of its own `overflow` CSS, so no special styling
// is needed just to make the measurement itself work.
//
// Called unconditionally (React's rules of hooks) at the top of both
// CgTemplateWidget.tsx's and CgTemplateDesigner.tsx's text-rendering code —
// `enabled` is what actually turns it on/off per element; when disabled it
// just returns `maxFontSize` straight back, identical to every element
// that existed before this hook did.
export function useAutoFitFontSize(
  enabled: boolean,
  ref: RefObject<HTMLElement>,
  maxFontSize: number,
  wordWrap: boolean,
  deps: unknown[]
): number {
  const [fitSize, setFitSize] = useState(maxFontSize);

  useLayoutEffect(() => {
    if (!enabled) { setFitSize(maxFontSize); return; }
    const el = ref.current;
    if (!el) { setFitSize(maxFontSize); return; }

    const fits = () => (wordWrap ? el.scrollHeight <= el.clientHeight + 1 : el.scrollWidth <= el.clientWidth + 1);

    let size = maxFontSize;
    el.style.fontSize = size + 'px';
    while (size > MIN_FONT_SIZE && !fits()) {
      size -= 1;
      el.style.fontSize = size + 'px';
    }
    setFitSize(size);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, maxFontSize, wordWrap, ...deps]);

  return enabled ? fitSize : maxFontSize;
}
