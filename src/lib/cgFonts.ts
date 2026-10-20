// Font selection for 'text'/'ticker' template elements — see
// CgTemplateWidget.tsx's/CgTemplateDesigner.tsx's own useGoogleFont calls.
//
// Two sources, one plain string field (TemplateElement.config.fontFamily):
//  - One of GOOGLE_FONTS below — loaded on demand from Google's own CDN
//    (fonts.googleapis.com), cached by the browser like any other stylesheet
//    once fetched. Requires internet access the first time a given font is
//    used in a session; every normal CSS font-family fallback behavior
//    still applies if the request fails (e.g. offline), so a template never
//    breaks outright — it just falls back to the generic sans-serif in the
//    stack below instead of the intended look. Not pre-bundled: broadcast
//    machines are effectively always online, and bundling even this curated
//    list would meaningfully bloat the app for a feature most templates
//    won't touch.
//  - Anything else — a plain CSS font-family name, resolved locally by
//    the OS/browser exactly like any other CSS value (e.g. a corporate
//    brand font already installed on the playout machine). Never sent to
//    Google's CDN — see useGoogleFont's own GOOGLE_FONTS.has(...) guard.
// Grouped by rough look/use — purely for maintainability here (FontPicker's
// own UI, see CgTemplateDesigner.tsx, flattens + alphabetizes-by-search
// instead of showing these groups) — every name is the font's exact,
// current Google Fonts catalog family name (what fonts.googleapis.com's
// css2 endpoint expects verbatim).
export const GOOGLE_FONTS: string[] = [
  // --- Sans / general-purpose ---
  'Roboto', 'Open Sans', 'Inter', 'Poppins', 'Lato', 'Nunito', 'Nunito Sans', 'Work Sans',
  'Manrope', 'DM Sans', 'Mulish', 'Karla', 'Rubik', 'Sora', 'Outfit', 'Plus Jakarta Sans',
  'Figtree', 'Space Grotesk', 'Urbanist', 'Jost', 'Josefin Sans', 'Quicksand', 'Comfortaa',
  'Raleway', 'PT Sans', 'Noto Sans', 'Source Sans 3', 'Heebo', 'Cabin', 'Hind', 'Assistant',
  'IBM Plex Sans',
  // --- Condensed / narrow (scoreboards, lower thirds, tight spaces) ---
  'Roboto Condensed', 'Barlow Condensed', 'Saira Condensed', 'Fjalla One', 'Yanone Kaffeesatz',
  'Big Shoulders Display', 'Big Shoulders Text', 'PT Sans Narrow', 'Khand', 'Bai Jamjuree',
  'Barlow', 'Teko', 'Staatliches',
  // --- Display / headline / impact ---
  'Montserrat', 'Oswald', 'Bebas Neue', 'Anton', 'Archivo Black', 'Russo One', 'Bungee',
  'Passion One', 'Alfa Slab One', 'Black Ops One', 'Squada One', 'Bowlby One', 'Bowlby One SC',
  'Racing Sans One', 'Monoton', 'Bungee Shade', 'Bungee Inline', 'Bangers', 'Permanent Marker',
  'Righteous', 'Bevan', 'Luckiest Guy', 'Titan One', 'Fredoka', 'Baloo 2',
  // --- Sporty / tech / futuristic (esports, sci-fi HUD looks) ---
  'Rajdhani', 'Saira', 'Titillium Web', 'Exo 2', 'Orbitron', 'Chakra Petch', 'Play', 'Kanit',
  'Audiowide', 'Michroma', 'Aldrich', 'Zen Dots', 'Wallpoet', 'Iceland', 'Syncopate',
  'Electrolize', 'Quantico',
  // --- Serif (elegant / news-style) ---
  'Playfair Display', 'Merriweather', 'Roboto Slab', 'Bitter', 'Libre Baskerville', 'Lora',
  'PT Serif', 'Cormorant Garamond', 'Noto Serif', 'Crimson Text',
  // --- Monospace (score tickers, digital/LCD-style readouts) ---
  'Roboto Mono', 'JetBrains Mono', 'Space Mono', 'IBM Plex Mono', 'Share Tech Mono', 'VT323',
  'Major Mono Display', 'Source Code Pro',
];

/** A real, always-available fallback appended to WHATEVER font-family is
 *  chosen — so a not-yet-loaded Google Font (or a mistyped/missing local
 *  one) still reads as reasonable sans-serif text for the split second (or
 *  indefinitely, if offline) before/unless the real one resolves, rather
 *  than falling all the way back to the browser's serif default. */
export function fontFamilyCss(fontFamily: string | undefined): string | undefined {
  if (!fontFamily) return undefined;
  const quoted = fontFamily.includes(' ') && !fontFamily.startsWith('"') ? `"${fontFamily}"` : fontFamily;
  return `${quoted}, sans-serif`;
}

const loadedGoogleFonts = new Set<string>();

/** Injects (once per font, ever, for this page's whole lifetime) a
 *  stylesheet link pulling one GOOGLE_FONTS entry from Google's CDN, at
 *  both weights 'bold' toggles between (400/700) so switching Bold on/off
 *  never silently falls back to a synthetic/faux-bold render. A no-op for
 *  anything not in GOOGLE_FONTS (a local/system font name) or already
 *  loaded. Safe to call unconditionally on every render — the Set guard
 *  makes every call after the first one for a given font an immediate
 *  no-op, and this never touches React state so it can't itself trigger a
 *  re-render loop. */
export function ensureGoogleFontLoaded(fontFamily: string | undefined): void {
  if (!fontFamily || !GOOGLE_FONTS.includes(fontFamily) || loadedGoogleFonts.has(fontFamily) || typeof document === 'undefined') return;
  loadedGoogleFonts.add(fontFamily);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontFamily)}:wght@400;700&display=swap`;
  document.head.appendChild(link);
}

/** Same as ensureGoogleFontLoaded, but for many fonts in ONE stylesheet
 *  request (Google's css2 endpoint accepts repeated `family=` params) —
 *  used by FontPicker's own dropdown (CgTemplateDesigner.tsx) to render
 *  every font in the list as a live, real sample of itself the moment the
 *  picker opens, instead of the plain-text names a bare <select> would show
 *  (or 105 separate HTTP requests, one per ensureGoogleFontLoaded call). A
 *  no-op once every font in `fontFamilies` has already been loaded (by this
 *  or any prior call, including single-font ensureGoogleFontLoaded ones —
 *  both share the same loadedGoogleFonts guard). */
export function ensureGoogleFontsLoaded(fontFamilies: string[]): void {
  const pending = fontFamilies.filter((f) => GOOGLE_FONTS.includes(f) && !loadedGoogleFonts.has(f));
  if (!pending.length || typeof document === 'undefined') return;
  pending.forEach((f) => loadedGoogleFonts.add(f));
  const families = pending.map((f) => `family=${encodeURIComponent(f)}:wght@400;700`).join('&');
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
  document.head.appendChild(link);
}
