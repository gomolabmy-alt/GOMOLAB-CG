// Geometry + digit data for the 'digitMorph' On-Value-Change preset — a
// genuine SVG shape morph between digits (not a CSS transform trick like
// every other preset in cgChangePresets.ts), styled after the classic
// seven-segment display: each digit is 7 independently-shaped segments (the
// usual a/b/c/d/e/f/g naming), and changing digit means each segment
// morphs its OWN path between a fully-visible hexagon (segment "on") and a
// flattened, zero-area sliver at the same centerline (segment "off") — see
// CgTemplateWidget.tsx's/CgTemplateDesigner.tsx's own 'digitMorph' render
// branch, which builds one <path> per segment per character position and
// tweens the ones that actually change state via GSAP's MorphSVGPlugin.
//
// Every digit's "off" segments still get a real (degenerate) path here
// rather than being omitted — morphing FROM/TO a same-point-count
// degenerate shape at the right position reads as that segment cleanly
// growing/shrinking in place, which is what makes this look like one fluid
// shape rather than pieces popping in and out.

export const SEVEN_SEG_VIEWBOX = '0 0 60 100';
export const SEVEN_SEG_WIDTH = 60;
export const SEVEN_SEG_HEIGHT = 100;

export type SegmentName = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g';
export const SEGMENT_NAMES: SegmentName[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

// Standard 7-segment digit encoding — which segments are lit for each
// digit. No entry for anything but 0-9; callers fall back to plain text for
// any other character (letters, punctuation other than the colon dots
// buildColonDots below already covers separately).
export const DIGIT_SEGMENTS: Record<string, SegmentName[]> = {
  '0': ['a', 'b', 'c', 'd', 'e', 'f'],
  '1': ['b', 'c'],
  '2': ['a', 'b', 'g', 'e', 'd'],
  '3': ['a', 'b', 'g', 'c', 'd'],
  '4': ['f', 'g', 'b', 'c'],
  '5': ['a', 'f', 'g', 'c', 'd'],
  '6': ['a', 'f', 'g', 'e', 'c', 'd'],
  '7': ['a', 'b', 'c'],
  '8': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  '9': ['a', 'b', 'c', 'd', 'f', 'g'],
};

const HALF_THICKNESS = 6;
const MARGIN = 8;
const GAP = 3;
const MID_Y = SEVEN_SEG_HEIGHT / 2;

/** A segment's own slot — where it sits when fully "on". Horizontal
 *  segments (a/g/d) are defined by their y-center and x-span; vertical ones
 *  (b/c/e/f) by their x-center and y-span. */
interface SegmentSlot {
  axis: 'h' | 'v';
  center: number; // y for horizontal, x for vertical
  start: number; // x-start for horizontal, y-start for vertical
  end: number;
}

const SEGMENT_SLOTS: Record<SegmentName, SegmentSlot> = {
  a: { axis: 'h', center: MARGIN, start: MARGIN + GAP, end: SEVEN_SEG_WIDTH - MARGIN - GAP },
  g: { axis: 'h', center: MID_Y, start: MARGIN + GAP, end: SEVEN_SEG_WIDTH - MARGIN - GAP },
  d: { axis: 'h', center: SEVEN_SEG_HEIGHT - MARGIN, start: MARGIN + GAP, end: SEVEN_SEG_WIDTH - MARGIN - GAP },
  f: { axis: 'v', center: MARGIN, start: MARGIN + GAP, end: MID_Y - GAP },
  b: { axis: 'v', center: SEVEN_SEG_WIDTH - MARGIN, start: MARGIN + GAP, end: MID_Y - GAP },
  e: { axis: 'v', center: MARGIN, start: MID_Y + GAP, end: SEVEN_SEG_HEIGHT - MARGIN - GAP },
  c: { axis: 'v', center: SEVEN_SEG_WIDTH - MARGIN, start: MID_Y + GAP, end: SEVEN_SEG_HEIGHT - MARGIN - GAP },
};

/** A 6-point hexagon (pointed ends, beveled sides) spanning the segment's
 *  own slot — `thickness` 0..1 scales the half-thickness down to a
 *  degenerate zero-width line at the same centerline when 0 (the "off"
 *  shape), so "on" and "off" are the SAME 6 points, just moved — exactly
 *  what a clean, predictable morph needs (same point count, no path
 *  restructuring, only point positions changing). */
function segmentPath(name: SegmentName, thickness: number): string {
  const slot = SEGMENT_SLOTS[name];
  const ht = HALF_THICKNESS * thickness;
  if (slot.axis === 'h') {
    const { center: y, start: x0, end: x1 } = slot;
    return [
      `M ${x0} ${y}`,
      `L ${x0 + HALF_THICKNESS} ${y - ht}`,
      `L ${x1 - HALF_THICKNESS} ${y - ht}`,
      `L ${x1} ${y}`,
      `L ${x1 - HALF_THICKNESS} ${y + ht}`,
      `L ${x0 + HALF_THICKNESS} ${y + ht}`,
      'Z',
    ].join(' ');
  }
  const { center: x, start: y0, end: y1 } = slot;
  return [
    `M ${x} ${y0}`,
    `L ${x + ht} ${y0 + HALF_THICKNESS}`,
    `L ${x + ht} ${y1 - HALF_THICKNESS}`,
    `L ${x} ${y1}`,
    `L ${x - ht} ${y1 - HALF_THICKNESS}`,
    `L ${x - ht} ${y0 + HALF_THICKNESS}`,
    'Z',
  ].join(' ');
}

/** Every segment's own "on" (fully visible) and "off" (collapsed to its
 *  centerline) path, computed once — cheap enough to just keep as plain
 *  module-level constants rather than recomputing per render. */
export const SEGMENT_PATH_ON: Record<SegmentName, string> = Object.fromEntries(
  SEGMENT_NAMES.map((n) => [n, segmentPath(n, 1)])
) as Record<SegmentName, string>;
export const SEGMENT_PATH_OFF: Record<SegmentName, string> = Object.fromEntries(
  SEGMENT_NAMES.map((n) => [n, segmentPath(n, 0)])
) as Record<SegmentName, string>;

/** The path this segment should show for a given character — 'on' shape if
 *  that segment lights up for this digit, 'off' (collapsed) otherwise.
 *  Non-digit characters (colon, letters, spaces) light no segments at all —
 *  callers render those characters some other way entirely (see
 *  buildColonDots / the plain-text fallback in the render branch itself)
 *  rather than asking for a segment path for them. */
export function segmentPathFor(name: SegmentName, char: string): string {
  const lit = DIGIT_SEGMENTS[char];
  return lit && lit.includes(name) ? SEGMENT_PATH_ON[name] : SEGMENT_PATH_OFF[name];
}

export function isSevenSegmentDigit(char: string): boolean {
  return char in DIGIT_SEGMENTS;
}

// A ':' renders as two small static squares (top/bottom) rather than a
// morphing shape of its own — a colon never has a "different colon" to
// morph into/from, so there's nothing to animate; it just needs to sit at
// the same visual weight as the digits either side of it.
const DOT_SIZE = 8;
export function colonDotPaths(): [string, string] {
  const cx = SEVEN_SEG_WIDTH / 2;
  const half = DOT_SIZE / 2;
  const topY = SEVEN_SEG_HEIGHT * 0.32;
  const bottomY = SEVEN_SEG_HEIGHT * 0.68;
  const square = (cy: number) =>
    `M ${cx - half} ${cy - half} L ${cx + half} ${cy - half} L ${cx + half} ${cy + half} L ${cx - half} ${cy + half} Z`;
  return [square(topY), square(bottomY)];
}
