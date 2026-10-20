import { useRef } from 'react';
import { X } from 'lucide-react';
import { playSfx } from '../lib/sfxLibrary';

/** Candidate alignment lines (canvas-space, unscaled) a drag/resize can
 *  snap to — see CgTemplateDesigner.tsx's own computeSnapGuides, which
 *  builds this once per render from every OTHER element at the same
 *  nesting level plus the canvas/parent's own edges and center. `vLines`
 *  are vertical guide lines (values compared against x-ish positions:
 *  left/right/centerX); `hLines` are horizontal ones (top/bottom/centerY). */
export interface SnapGuides { vLines: number[]; hLines: number[] }

interface Props {
  x: number; y: number; w: number; h: number;
  selected: boolean;
  canvasW: number; canvasH: number;
  /** The designer canvas's current display scale — drag/resize deltas
   *  arrive in screen pixels, but x/y/w/h live in the canvas's own
   *  (unscaled) coordinate space, so raw mouse deltas need dividing by this
   *  to track the cursor correctly once the canvas itself is zoomed out
   *  (see CgTemplateDesigner.tsx's fit-to-view zoom). */
  zoom: number;
  onSelect: () => void;
  onChange: (patch: Partial<{ x: number; y: number; w: number; h: number }>) => void;
  onDelete: () => void;
  children: React.ReactNode;
  /** Ref to the element's own content div (inside the positioning wrapper)
   *  — this is what CgTemplateDesigner.tsx's Preview/scrub hands to GSAP,
   *  the same relationship CgTemplateWidget.tsx has with its rendered
   *  elements in the real output. */
  contentRef?: (node: HTMLDivElement | null) => void;
  /** Called once at the start/end of a drag or resize gesture (not on every
   *  pointer-move, which still goes through onChange as before) — lets
   *  CgTemplateDesigner.tsx's undo history coalesce a whole drag/resize
   *  into a single undo step instead of one per pixel moved. */
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
  /** Rounds dragged/resized x/y/w/h to the nearest 10px — same GRID_SIZE
   *  and rounding rule as gfx-studio-2's own snapValue(). Smart guide
   *  snapping (below) takes priority over this on whichever axis it
   *  actually matches; grid snap is only the fallback for an axis with no
   *  guide match. */
  snapEnabled?: boolean;
  /** Candidate alignment lines this element's own edges/center can snap
   *  to — see SnapGuides' own doc comment. Absent/empty = no smart-guide
   *  snapping at all for this drag (smartSnapEnabled below still gates it
   *  even when guides ARE provided). */
  guides?: SnapGuides;
  /** "Snap to Guides" — center/edge alignment against other elements and
   *  the canvas itself, independent of (and higher priority than) the
   *  plain grid snap above. */
  smartSnapEnabled?: boolean;
  /** Reports which guide lines are ACTIVELY matched right now, every
   *  pointer-move during a drag/resize, and clears to {vLines:[],hLines:[]}
   *  on gesture end — CgTemplateDesigner.tsx renders these as thin overlay
   *  lines across the canvas for visual feedback, the same "smart guides"
   *  convention Figma/PowerPoint/Keynote already use. */
  onActiveGuides?: (g: SnapGuides) => void;
  /** Audible "snap" feedback — see appSettingsStore.ts's snapSoundEnabled/
   *  snapSoundId. Only ever plays on the RISING edge of a NEW axis
   *  engaging (not on every pointer-move while already snapped, which
   *  would machine-gun the same sound while the cursor just sits there). */
  snapSoundEnabled?: boolean;
  snapSoundId?: string;
  /** Editor-only "hide while I work on other layers" toggle (Layers panel's
   *  eye icon) — never written to config, mirrors gfx-studio-2's ephemeral
   *  `_hidden` (stripped before save/export there, never even persisted
   *  here). Skips rendering entirely rather than dimming, same as theirs. */
  hidden?: boolean;
  /** Overrides .tpl-el-body's default `overflow: hidden` — set to 'visible'
   *  by the caller when this element actually has children nested inside
   *  it (see CgTemplateDesigner.tsx's renderElementTree), so a parent
   *  doesn't clip them to its own box the way a plain leaf element's
   *  overflow (correctly) still clips its own oversized content. */
  bodyOverflow?: 'hidden' | 'visible';
  /** GradientAnchorHandle.tsx/Orbit3DHandle.tsx instance(s) for this
   *  element — whichever of its own color fields are currently gradients,
   *  plus (once config.scene3D is on) its own 3D-pose orbit handle — see
   *  CgTemplateDesigner.tsx's renderElementTree, which builds this bundle
   *  per-element. Rendered as a sibling alongside the delete button/resize
   *  handle below (NOT through `children`, which renders inside
   *  .tpl-el-body and would inherit its own overflow:hidden/
   *  pointer-events:none), only while selected, same as those two. */
  extraHandles?: React.ReactNode;
  /** config.scene3D support (CgTemplateDesigner.tsx's renderElementTree) —
   *  `{ perspective: '<n>px', transformStyle: 'preserve-3d' }` when this
   *  element shares a 3D space with its own children, else undefined.
   *  Applied to .tpl-el-body specifically (not the outer .tpl-el root),
   *  since that's the box this element's own content-wrapper and its
   *  nested children (rendered via `children`, see renderElementTree) are
   *  BOTH inside as siblings — the same relationship CgTemplateWidget.tsx's
   *  own scene3D wrapper div has with its content-wrapper + renderChildren()
   *  siblings. See that file's identical comment for the full reasoning. */
  scene3DStyle?: React.CSSProperties;
  /** config.staticRotateX/Y/Z/staticTranslateZ's own CSS `transform` value
   *  (see cgPresets.ts's buildStaticTransform3D) — applied to this root box
   *  (matching CgTemplateWidget.tsx's own leaf-element placement of the
   *  same value on ITS outer positioned box), so a 3D Box template's own
   *  face elements hold their fixed pose in the designer preview exactly
   *  like the real output. `undefined` for every element not using this
   *  (the overwhelming majority), a no-op. */
  staticTransform?: string;
}

const GRID_SIZE = 10;
const snapCoord = (v: number, snap: boolean | undefined) => (snap ? Math.round(v / GRID_SIZE) * GRID_SIZE : Math.round(v));

// How close (in SCREEN pixels, i.e. independent of the canvas's own zoom
// level) an edge/center needs to be to a guide line before it snaps — a
// small, constant on-screen distance is what actually feels right to drag
// against; converted to canvas-space by dividing by zoom wherever it's used
// below, so the feel stays consistent whether zoomed in or out.
const SNAP_THRESHOLD_SCREEN_PX = 6;

/** Finds the single CLOSEST guide line (if any, within threshold) each of
 *  `candidates` would land on, and returns the delta needed to shift the
 *  dragged box so that candidate's own edge/center sits exactly on it.
 *  Only ever returns ONE match (the closest) rather than every candidate
 *  that happens to be in range — matches every "smart guides" tool's own
 *  behavior (Figma/Keynote/PowerPoint all resolve to a single snap per
 *  axis, not several fighting at once). */
function closestSnap(candidates: number[], lines: number[], threshold: number): { delta: number; line: number } | null {
  let best: { delta: number; line: number; dist: number } | null = null;
  for (const c of candidates) {
    for (const line of lines) {
      const dist = Math.abs(c - line);
      if (dist <= threshold && (!best || dist < best.dist)) {
        best = { delta: line - c, line, dist };
      }
    }
  }
  return best ? { delta: best.delta, line: best.line } : null;
}

// Drag/resize for one element inside CgTemplateDesigner.tsx's mini canvas —
// same pointer-event math as WidgetWrapper.tsx (clamp to the surrounding
// canvas, minimum size floor) but driven by plain callback props instead of
// canvasStore mutators, since this edits one element inside a single
// widget's config.elements array, not the app-wide canvas.
export function TemplateElementWrapper({ x, y, w, h, selected, canvasW, canvasH, zoom, onSelect, onChange, onDelete, children, contentRef, onGestureStart, onGestureEnd, snapEnabled, guides, smartSnapEnabled, onActiveGuides, snapSoundEnabled, snapSoundId, hidden, bodyOverflow, extraHandles, scene3DStyle, staticTransform }: Props) {
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const resizeRef = useRef<{ sx: number; sy: number; ow: number; oh: number } | null>(null);
  // Tracks whether each axis was ALREADY snapped as of the last pointer-move
  // — the snap sound only fires on the transition into a new engagement
  // (false -> true), never while just holding position inside an already-
  // matched guide (which would otherwise machine-gun the same sound on
  // every move event for as long as the cursor sits there).
  const wasSnappedRef = useRef<{ v: boolean; h: boolean }>({ v: false, h: false });

  if (hidden) return null;

  // Applies smart-guide snapping (if enabled and a guide is within
  // threshold) to a set of candidate edge/center values on one axis,
  // falling back to `fallback` (already grid-snapped or plain-rounded)
  // when nothing matches. Reports the matched line (or null) so the
  // caller can accumulate active guides + decide whether to play the snap
  // sound. `candidates` are the box's OWN tentative edge/center values —
  // the delta found is applied to `rawBase` (the un-snapped position this
  // axis is measured from) so every candidate on this axis shifts together
  // (e.g. snapping the box's center also moves its left/right edges by the
  // same amount, not just the one point that happened to match).
  const applyAxisSnap = (rawBase: number, candidates: number[], lines: number[]): { value: number; line: number | null } => {
    if (!smartSnapEnabled || !lines.length) return { value: rawBase, line: null };
    const match = closestSnap(candidates, lines, SNAP_THRESHOLD_SCREEN_PX / zoom);
    return match ? { value: rawBase + match.delta, line: match.line } : { value: rawBase, line: null };
  };

  const reportGuides = (vLine: number | null, hLine: number | null) => {
    onActiveGuides?.({ vLines: vLine != null ? [vLine] : [], hLines: hLine != null ? [hLine] : [] });
    const nowV = vLine != null;
    const nowH = hLine != null;
    if (snapSoundEnabled && ((nowV && !wasSnappedRef.current.v) || (nowH && !wasSnappedRef.current.h))) {
      playSfx(snapSoundId, 0.5);
    }
    wasSnappedRef.current = { v: nowV, h: nowH };
  };

  const onDragDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    onSelect();
    onGestureStart?.();
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: x, oy: y };
    wasSnappedRef.current = { v: false, h: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onDragMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const { sx, sy, ox, oy } = dragRef.current;
    const rawX = Math.max(0, Math.min(ox + (e.clientX - sx) / zoom, canvasW - w));
    const rawY = Math.max(0, Math.min(oy + (e.clientY - sy) / zoom, canvasH - h));
    const snapX = applyAxisSnap(rawX, [rawX, rawX + w / 2, rawX + w], guides?.vLines ?? []);
    const snapY = applyAxisSnap(rawY, [rawY, rawY + h / 2, rawY + h], guides?.hLines ?? []);
    reportGuides(snapX.line, snapY.line);
    onChange({
      x: snapX.line != null ? snapX.value : snapCoord(rawX, snapEnabled),
      y: snapY.line != null ? snapY.value : snapCoord(rawY, snapEnabled),
    });
  };
  const onDragUp = () => {
    dragRef.current = null;
    onActiveGuides?.({ vLines: [], hLines: [] });
    onGestureEnd?.();
  };

  const onResizeDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    onGestureStart?.();
    resizeRef.current = { sx: e.clientX, sy: e.clientY, ow: w, oh: h };
    wasSnappedRef.current = { v: false, h: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onResizeMove = (e: React.PointerEvent) => {
    if (!resizeRef.current) return;
    const { sx, sy, ow, oh } = resizeRef.current;
    const rawW = Math.max(10, Math.min(ow + (e.clientX - sx) / zoom, canvasW - x));
    const rawH = Math.max(10, Math.min(oh + (e.clientY - sy) / zoom, canvasH - y));
    // Only the right/bottom edges are meaningful to snap here (this handle
    // only ever resizes from the bottom-right corner) — x/y (top-left)
    // stay fixed during a resize, so the box's own center also moves as it
    // grows/shrinks and isn't a stable snap target the way it is for a
    // plain drag.
    const snapW = applyAxisSnap(rawW, [x + rawW], guides?.vLines ?? []);
    const snapH = applyAxisSnap(rawH, [y + rawH], guides?.hLines ?? []);
    reportGuides(snapW.line, snapH.line);
    onChange({
      w: snapW.line != null ? snapW.value : snapCoord(rawW, snapEnabled),
      h: snapH.line != null ? snapH.value : snapCoord(rawH, snapEnabled),
    });
  };
  const onResizeUp = () => {
    resizeRef.current = null;
    onActiveGuides?.({ vLines: [], hLines: [] });
    onGestureEnd?.();
  };

  return (
    <div
      className={`tpl-el${selected ? ' tpl-el--selected' : ''}`}
      style={{ left: x, top: y, width: w, height: h, transform: staticTransform }}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      onPointerDown={onDragDown}
      onPointerMove={onDragMove}
      onPointerUp={onDragUp}
    >
      <div className="tpl-el-body" ref={contentRef} style={{ ...(bodyOverflow ? { overflow: bodyOverflow } : undefined), ...scene3DStyle }}>{children}</div>
      {selected && (
        <>
          <button className="tpl-el-del" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onDelete(); }}>
            <X size={11} strokeWidth={2} />
          </button>
          <div className="tpl-el-resize" onPointerDown={onResizeDown} onPointerMove={onResizeMove} onPointerUp={onResizeUp} />
          {extraHandles}
        </>
      )}
    </div>
  );
}
