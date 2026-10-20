// Warms the browser's own image cache for everything a cg-template widget
// needs to render, ahead of actually playing it — see cgPlayoutStore.ts's
// loadLayer, which calls this the moment a layer is cued (Load), and defers
// the actual on-air transition until it resolves; and App.tsx's own
// whole-project startup preload (preloadAllProjectAssets below), which is
// what actually answers "is EVERYTHING loaded yet" rather than just
// whichever one template happens to be cued right now.
//
// Why this exists: CgTemplateWidget.tsx's static rest-state render only
// ever fetches a 'sequence'/'imagePlaylist' element's FIRST frame ahead of
// time (that's what the element looks like at rest) — every OTHER frame is
// only requested one-by-one, exactly when playback actually reaches it (see
// lib/cgAnimationEngine.ts's buildSequencePlayback, CgTemplateWidget.tsx's
// own imagePlaylist/cardCarousel advance logic). Each frame is typically a
// full-resolution PNG, so a just-in-time fetch+decode at animation/advance
// speed is what visibly stutters or flashes blank on air. Preloading every
// asset here means the browser already has them decoded and cached by the
// time playback actually reaches them.
import { resolveImageUrl } from './imageUrl';
import { resolveBindingValue } from './templateBinding';
import type { CanvasPage, CanvasWidget, CgCarouselCard, TemplateElement } from '../types/canvas';

const PRELOAD_TIMEOUT_MS = 8000;

// Session-lifetime cache of URLs already confirmed loaded (by ANY caller —
// a single-layer loadLayer() preload and the whole-project startup preload
// share this) — the browser's own HTTP cache already avoids a real network
// re-fetch, but this also skips the Image()/decode/timeout bookkeeping
// entirely for something already known-good, which matters once the
// project-wide preload is re-run (e.g. after editing a template) and most
// of its assets are unchanged from last time.
const confirmedLoaded = new Set<string>();

/** Whether `url` has already been confirmed loaded+decoded (see
 *  `confirmedLoaded` above) — a plain synchronous read, not a promise, for
 *  a caller (lib/useSequenceLoop.ts's own double-buffered frame advance)
 *  that needs to decide RIGHT NOW, on an animation-frame tick, whether a
 *  given frame is actually safe to show yet, rather than awaiting a fresh
 *  preload promise for it. */
export function isImagePreloaded(url: string): boolean {
  return !url || confirmedLoaded.has(url);
}

function preloadOne(url: string): Promise<void> {
  if (!url) return Promise.resolve();
  if (confirmedLoaded.has(url)) return Promise.resolve();
  return new Promise((resolve) => {
    const img = new Image();
    const done = () => { confirmedLoaded.add(url); resolve(); };
    // `onload` only guarantees the BYTES arrived, not that the browser has
    // actually finished decoding a large PNG off the main thread — that
    // decode can still happen lazily, right as playback first paints the
    // frame, which is exactly the "100%, zero buffer" gap this effect was
    // asked to close. `decode()` forces the real decode to happen now,
    // during preload, while nothing's on air yet; still resolve via `done`
    // if it's unsupported or rejects, same "never let one bad frame hold up
    // everything else" reasoning `onerror` below already has.
    img.onload = () => { img.decode ? img.decode().then(done, done) : done(); };
    // A broken/missing frame shouldn't block every other one — resolve
    // either way, same reasoning as the timeout fallback below. Not added
    // to confirmedLoaded, so a since-fixed URL gets a fair retry next time.
    img.onerror = () => resolve();
    const timer = setTimeout(() => resolve(), PRELOAD_TIMEOUT_MS);
    img.addEventListener('load', () => clearTimeout(timer));
    img.addEventListener('error', () => clearTimeout(timer));
    img.src = resolveImageUrl(url);
  });
}

/** Resolves a widget id (a CG Template Library/Main Canvas template
 *  referenced by id, e.g. a row template or a nested template) to its own
 *  gathered asset urls — shared by every "this element points at ANOTHER
 *  whole template" case below (nestedTemplate, matchSchedule/standings/
 *  bracket row templates, cardCarousel cards), so each only needs to
 *  resolve its own id(s) and hand off here. */
function gatherReferencedTemplateUrls(templateId: string | undefined, pages: CanvasPage[], seen: Set<string>, fullyEager: boolean): string[] {
  if (!templateId) return [];
  const widget = pages.flatMap((p) => p.widgets).find((w) => w.id === templateId);
  return widget ? gatherTemplateAssetUrls(widget, pages, seen, fullyEager) : [];
}

/** Every image URL ONE cg-template widget's own elements reference —
 *  'sequence' (every frame, not just the first), 'image' (its resolved
 *  static or live-bound URL), 'imagePlaylist' (every slide plus the
 *  shared image pool), 'cardCarousel' (its own shared image pool, plus —
 *  recursively — every card's own referenced template, since a card is an
 *  entire separate cg-template widget in its own right, see
 *  types/canvas.ts's CgCarouselCard), 'nestedTemplate' (its own
 *  `config.templateId`, same recursion), and 'matchSchedule'/'standings'/
 *  'bracket' (every one of their own row/box templates — the default
 *  rowTemplateId plus whichever status/zone-specific ones are set, plus
 *  every per-match/per-team rowOverrides template — since a visible row IS
 *  an entire separate cg-template widget too, same as a carousel card).
 *  `seen` guards the same card-references-its-own-ancestor cycle
 *  CgTemplateWidget.tsx's own ancestorTemplateIds already guards against at
 *  render time — without it a circular reference here would recurse
 *  forever instead of just rendering a placeholder.
 *
 *  `fullyEager` controls whether a 'sequence'/'imagePlaylist'/carousel
 *  playlist contributes EVERY frame or just its first (the same single
 *  frame CgTemplateWidget's own static rest-state render already fetches)
 *  — see preloadAllProjectAssets' own doc comment for why the
 *  whole-project startup pass only wants this true for Main Canvas
 *  templates, not every template sitting in the CG Template Library. */
function gatherTemplateAssetUrls(widget: CanvasWidget, pages: CanvasPage[], seen: Set<string> = new Set(), fullyEager: boolean = true): string[] {
  if (widget.type !== 'cg-template') return [];
  if (seen.has(widget.id)) return [];
  seen.add(widget.id);
  const elements: TemplateElement[] = widget.config.elements ?? [];
  const urls: string[] = [];
  const pick = (list: string[]) => (fullyEager ? list : list.slice(0, 1));

  for (const el of elements) {
    if (el.kind === 'sequence') {
      urls.push(...pick(el.config.frames ?? []));
    } else if (el.kind === 'image') {
      const raw = el.binding ? resolveBindingValue(pages, el.binding) : (el.config.imageUrl ?? '');
      if (raw) urls.push(raw);
    } else if (el.kind === 'imagePlaylist') {
      urls.push(...pick(el.config.images ?? []));
    } else if (el.kind === 'cardCarousel') {
      urls.push(...pick(el.config.playlistImages ?? []));
      const cards: CgCarouselCard[] = el.config.cards ?? [];
      for (const card of cards) {
        for (const ov of Object.values(card.overrides ?? {})) {
          if (ov.imageUrl) urls.push(ov.imageUrl);
        }
        urls.push(...gatherReferencedTemplateUrls(card.templateId, pages, seen, fullyEager));
      }
    } else if (el.kind === 'nestedTemplate') {
      urls.push(...gatherReferencedTemplateUrls(el.config.templateId, pages, seen, fullyEager));
    } else if (el.kind === 'matchSchedule' || el.kind === 'bracket') {
      for (const id of [el.config.rowTemplateId, el.config.liveRowTemplateId, el.config.finishedRowTemplateId]) {
        urls.push(...gatherReferencedTemplateUrls(id, pages, seen, fullyEager));
      }
      for (const ov of Object.values(el.config.rowOverrides ?? {}) as { templateId?: string }[]) {
        urls.push(...gatherReferencedTemplateUrls(ov.templateId, pages, seen, fullyEager));
      }
    } else if (el.kind === 'standings') {
      for (const id of [el.config.rowTemplateId, el.config.topRowTemplateId, el.config.bottomRowTemplateId]) {
        urls.push(...gatherReferencedTemplateUrls(id, pages, seen, fullyEager));
      }
      for (const ov of Object.values(el.config.rowOverrides ?? {}) as { templateId?: string }[]) {
        urls.push(...gatherReferencedTemplateUrls(ov.templateId, pages, seen, fullyEager));
      }
    }
  }
  return urls;
}

/** Preloads an explicit list of image URLs directly — the same
 *  fetch-and-decode guarantee/cache `preloadTemplateAssets` below gives a
 *  whole widget, for a caller that already has its own exact URL list and
 *  has no CanvasWidget/pages to hand this file's own `gatherTemplateAssetUrls`
 *  (e.g. lib/useSequenceLoop.ts, which preloads a 'sequence' element's own
 *  `frames` right before it starts cycling through them — a template's own
 *  cg-template-level preload, via loadLayer/App.tsx's startup pass, covers
 *  the normal CG Playout path already, but this gives the SAME guarantee to
 *  a looping sequence wherever else it might be used — the Designer's own
 *  live preview, most notably, which has no playout/preload concept of its
 *  own at all). */
export function preloadImageUrls(urls: string[]): Promise<void> {
  if (!urls.length) return Promise.resolve();
  return Promise.all(urls.map(preloadOne)).then(() => undefined);
}

/** Preloads everything ONE cg-template widget needs — see loadLayer's own
 *  call site for why this exists (deferring a layer's real on-air
 *  transition until it resolves). */
export function preloadTemplateAssets(widget: CanvasWidget, pages: CanvasPage[]): Promise<void> {
  const urls = gatherTemplateAssetUrls(widget, pages);
  return preloadImageUrls(urls);
}

/** Preloads cg-template assets across the whole project (Main Canvas pages
 *  + the CG Template Library) — the "make sure everything is running
 *  smooth" whole-project guarantee App.tsx's own startup indicator wants,
 *  rather than only whichever one template a given CG Playout layer
 *  happens to have cued right now.
 *
 *  Main Canvas templates get FULLY eager treatment (every sequence/
 *  playlist frame) — they're the active project's own on-screen content,
 *  the thing this session is actually built around.
 *
 *  CG Template Library templates only get their rest-state look warmed
 *  (first frame of each sequence/playlist, same single frame
 *  CgTemplateWidget's own static render already fetches) — a library
 *  commonly holds far more templates than any one broadcast session
 *  actually airs, and forcing EVERY frame of EVERY sequence of EVERY
 *  library template to decode at launch (full-res PNGs, often hundreds of
 *  frames per sequence) was the single biggest driver of this app's
 *  startup memory footprint for sequence-heavy projects, for content that
 *  frequently never even gets used. A library template's full frame-set
 *  still gets preloaded the normal way the moment it's actually cued onto
 *  a CG Playout channel — see loadLayer -> preloadTemplateAssets, which is
 *  always fully eager and unaffected by this.
 *
 *  De-duplicated (`Set`) across every template — the same logo/background
 *  image is commonly reused by many templates, and this preload only ever
 *  needs to actually fetch each distinct URL once regardless of how many
 *  templates reference it (a Main Canvas template referencing a Library
 *  row/card template via nestedTemplate/cardCarousel/matchSchedule etc.
 *  still pulls that referenced template in fully eager, since the
 *  recursion in gatherTemplateAssetUrls carries whichever `fullyEager` the
 *  top-level caller used).
 *  `onProgress(loaded, total)` fires once up front with the real total
 *  (so a consumer can render "0 / N" immediately instead of guessing) and
 *  once per completed URL after that — including ones already in
 *  `confirmedLoaded` from an earlier run, so progress always reaches
 *  `total` even when nothing actually needed fetching this time. */
export function preloadAllProjectAssets(
  pages: CanvasPage[],
  libraryPages: CanvasPage[],
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  const allPages = [...pages, ...libraryPages];
  const mainWidgets = pages.flatMap((p) => p.widgets).filter((w) => w.type === 'cg-template');
  const libraryWidgets = libraryPages.flatMap((p) => p.widgets).filter((w) => w.type === 'cg-template');
  const urlSet = new Set<string>();
  for (const w of mainWidgets) {
    for (const url of gatherTemplateAssetUrls(w, allPages, new Set(), true)) {
      if (url) urlSet.add(url);
    }
  }
  for (const w of libraryWidgets) {
    for (const url of gatherTemplateAssetUrls(w, allPages, new Set(), false)) {
      if (url) urlSet.add(url);
    }
  }
  const urls = [...urlSet];
  const total = urls.length;
  onProgress?.(0, total);
  if (total === 0) return Promise.resolve();

  let loaded = 0;
  return Promise.all(
    urls.map((url) => preloadOne(url).then(() => { loaded++; onProgress?.(loaded, total); }))
  ).then(() => undefined);
}
