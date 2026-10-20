import type { CgCarouselCard } from '../types/canvas';

/** Builds the EFFECTIVE config a 'cardCarousel' card's own referenced
 *  template should render with — the template's own config, with this
 *  card's per-element overrides (text/imageUrl) merged in, and any of its
 *  own image elements flagged via `playlistSlots` swapped to pull from the
 *  carousel's shared `playlistImages` pool instead (indexed by this card's
 *  own position, wrapping if the pool is shorter than the card list) — see
 *  TemplateElement's own 'cardCarousel' doc comment in types/canvas.ts for
 *  the full "why" (multiple cards sharing one referenced template can still
 *  each show different content). Shared by CgTemplateWidget.tsx's real
 *  render and CgTemplateDesigner.tsx's static preview, so both always agree
 *  on what a given card actually looks like.
 *
 *  Returns the SAME object reference untouched when there's nothing to
 *  override (the common "this card is just its own independent element,
 *  nothing shared" case) — avoids handing a needlessly-cloned config to a
 *  nested CgTemplateWidget on every render for the majority of cards that
 *  don't need this at all. */
export function applyCardOverrides(
  templateConfig: Record<string, any>,
  card: CgCarouselCard | undefined,
  playlistImages: string[],
  cardIndex: number,
): Record<string, any> {
  if (!card) return templateConfig;
  const overrides = card.overrides ?? {};
  const playlistSlots = card.playlistSlots ?? [];
  if (!Object.keys(overrides).length && !playlistSlots.length) return templateConfig;
  const elements: any[] = templateConfig.elements ?? [];
  const nextElements = elements.map((el) => {
    if (playlistSlots.includes(el.id) && el.kind === 'image' && playlistImages.length > 0) {
      const url = playlistImages[cardIndex % playlistImages.length];
      return { ...el, config: { ...el.config, imageUrl: url } };
    }
    const ov = overrides[el.id];
    if (!ov) return el;
    const patch: Record<string, any> = {};
    if (ov.text !== undefined && el.kind === 'text') patch.text = ov.text;
    if (ov.imageUrl !== undefined && el.kind === 'image') patch.imageUrl = ov.imageUrl;
    if (!Object.keys(patch).length) return el;
    return { ...el, config: { ...el.config, ...patch } };
  });
  return { ...templateConfig, elements: nextElements };
}
