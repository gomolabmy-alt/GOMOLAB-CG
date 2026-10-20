import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Drop-in replacement for a plain <input type="color" className="color-custom">
// — same swatch-button trigger look (this reuses .color-custom itself, so
// every existing call site's styling carries over unchanged), same value/
// onChange contract (a plain "#rrggbb" string in, out — no format change,
// so every consumer downstream of a color field — resolveBackground,
// resolveSvgFill, hexToRgba, shadeHex, anything — keeps working with zero
// changes). What it actually swaps out is the PICKER ITSELF: the OS-native
// color dialog (jarring against this app's own dark theme, and wildly
// inconsistent across platforms) for an in-app popover matching gfx-
// studio-2/LogoUrlPicker's own established "portal to document.body,
// viewport-clamped, dismiss on outside click" convention — a saturation/
// value square + hue strip (the classic picker layout), a hex field for
// exact values, and a row of recently-used swatches remembered across the
// whole app (one shared localStorage list, not per-field) so a color
// picked once for one thing is one click away for the next.
interface Props {
  value: string;
  onChange: (hex: string) => void;
  className?: string;
  title?: string;
  disabled?: boolean;
}

const RECENT_KEY = 'gomolab-cg-recent-colors';
const MAX_RECENT = 12;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch { return []; }
}
function pushRecent(hex: string) {
  try {
    const next = [hex, ...loadRecent().filter((c) => c.toLowerCase() !== hex.toLowerCase())].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* private-browsing/storage-disabled — swatches just won't persist */ }
}

const PRESETS = [
  '#ffffff', '#c4c4c4', '#7d7d7d', '#000000',
  '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71',
  '#1abc9c', '#3498db', '#9b59b6', '#e91e8c',
];

function clamp01(n: number) { return Math.max(0, Math.min(1, n)); }
function isValidHex(s: string): boolean { return /^#[0-9a-f]{6}$/i.test(s.trim()); }
function normalizeHex(s: string): string | null {
  let t = s.trim();
  if (!t.startsWith('#')) t = `#${t}`;
  if (/^#[0-9a-f]{3}$/i.test(t)) t = `#${[...t.slice(1)].map((c) => c + c).join('')}`;
  return isValidHex(t) ? t.toLowerCase() : null;
}
function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(clamp01(v / 255) * 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return [(rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255];
}

export function ColorPicker({ value, onChange, className, title, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [hexDraft, setHexDraft] = useState(value);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  const safeValue = isValidHex(value) ? value : '#000000';
  const [h, s, v] = rgbToHsv(...hexToRgb(safeValue));
  // Hue is kept as its OWN piece of local state (not re-derived from
  // `value` every render) — a fully desaturated or zero-value color has no
  // recoverable hue from its RGB alone (rgbToHsv arbitrarily returns 0), so
  // re-deriving it every render would snap the hue slider's thumb back to
  // red the instant saturation/value drags to an edge, mid-gesture.
  const [hue, setHue] = useState(h);
  useEffect(() => { if (!open) setHue(h); }, [safeValue, open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setHexDraft(value); }, [value]);
  useEffect(() => { if (open) setRecent(loadRecent()); }, [open]);

  const commit = (nextHex: string) => { onChange(nextHex); };

  const setFromSv = (clientX: number, clientY: number) => {
    const rect = svRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = clamp01((clientX - rect.left) / rect.width);
    const sy = clamp01((clientY - rect.top) / rect.height);
    const [r, g, b] = hsvToRgb(hue, sx, 1 - sy);
    commit(rgbToHex(r, g, b));
  };
  const setFromHue = (clientX: number) => {
    const rect = hueRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nextHue = clamp01((clientX - rect.left) / rect.width) * 360;
    setHue(nextHue);
    const [r, g, b] = hsvToRgb(nextHue, s, v);
    commit(rgbToHex(r, g, b));
  };

  const draggingRef = useRef<'sv' | 'hue' | null>(null);
  useEffect(() => {
    if (!open) return;
    const onMove = (e: PointerEvent) => {
      if (draggingRef.current === 'sv') setFromSv(e.clientX, e.clientY);
      else if (draggingRef.current === 'hue') setFromHue(e.clientX);
    };
    const onUp = () => { draggingRef.current = null; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hue, s, v]);

  // Outside click / Escape closes — same convention LogoUrlPicker's own
  // library popup already uses.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (popupRef.current?.contains(e.target as Node) || anchorRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Committing (closing) is when this color actually joins the shared
  // "recently used" list — not every intermediate drag frame, which would
  // otherwise flood it with near-duplicate shades from one gesture.
  useEffect(() => {
    if (open) return;
    if (isValidHex(value)) pushRecent(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Positions the popup below-right of the swatch, fixed (so it escapes any
  // overflow:hidden ancestor — the Inspector's own scroll container
  // included), then clamps fully inside the viewport post-measure exactly
  // like LogoUrlPicker's own library popup does.
  const toggle = () => {
    if (disabled) return;
    if (!open && anchorRef.current) {
      const r = anchorRef.current.getBoundingClientRect();
      setPos({ left: r.left, top: r.bottom + 6 });
    }
    setOpen((o) => !o);
  };
  useLayoutEffect(() => {
    if (!open || !pos || !popupRef.current) return;
    const margin = 8;
    const node = popupRef.current;
    const rect = node.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - margin;
    const maxTop = window.innerHeight - rect.height - margin;
    node.style.left = `${Math.max(margin, Math.min(pos.left, Math.max(margin, maxLeft)))}px`;
    node.style.top = `${Math.max(margin, Math.min(pos.top, Math.max(margin, maxTop)))}px`;
  }, [open, pos]);

  const cursorLeft = `${s * 100}%`;
  const cursorTop = `${(1 - v) * 100}%`;
  const hueThumbLeft = `${(hue / 360) * 100}%`;

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={className ?? 'color-custom'}
        style={{ background: safeValue }}
        onClick={toggle}
        title={title ?? safeValue}
        disabled={disabled}
      />
      {open && pos && createPortal(
        <div ref={popupRef} className="cg-color-popup" style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 10000 }}>
          <div
            ref={svRef}
            className="cg-color-sv"
            style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hue}, 100%, 50%)` }}
            onPointerDown={(e) => { e.preventDefault(); draggingRef.current = 'sv'; setFromSv(e.clientX, e.clientY); }}
          >
            <div className="cg-color-sv-cursor" style={{ left: cursorLeft, top: cursorTop }} />
          </div>
          <div
            ref={hueRef}
            className="cg-color-hue"
            onPointerDown={(e) => { e.preventDefault(); draggingRef.current = 'hue'; setFromHue(e.clientX); }}
          >
            <div className="cg-color-hue-thumb" style={{ left: hueThumbLeft }} />
          </div>
          <div className="cg-color-hex-row">
            <span>#</span>
            <input
              className="field-input"
              value={hexDraft.replace(/^#/, '')}
              onChange={(e) => setHexDraft(e.target.value)}
              onBlur={() => { const n = normalizeHex(hexDraft); if (n) commit(n); else setHexDraft(value); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              maxLength={6}
              spellCheck={false}
            />
          </div>
          <div className="cg-color-swatches">
            {PRESETS.map((c) => (
              <button key={c} type="button" className="cg-color-swatch" style={{ background: c }} onClick={() => commit(c)} title={c} />
            ))}
          </div>
          {recent.length > 0 && (
            <>
              <div className="cg-color-swatches-label">Recent</div>
              <div className="cg-color-swatches">
                {recent.map((c, i) => (
                  <button key={`${c}-${i}`} type="button" className="cg-color-swatch" style={{ background: c }} onClick={() => commit(c)} title={c} />
                ))}
              </div>
            </>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
