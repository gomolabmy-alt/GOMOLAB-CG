import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Loader2 } from 'lucide-react';
import { gsap } from 'gsap';
import { useCanvasStore, registerReliableTick } from '../../stores/canvasStore';
import { useTeamDbStore } from '../../stores/teamDbStore';
import { resolveImageUrl } from '../../lib/imageUrl';
import { resolveBindingValue, hasLiveBinding } from '../../lib/templateBinding';
import { buildChangeTransition } from '../../lib/cgChangePresets';
import { buildStateTimelines, buildStepTimelines, type CgStateName } from '../../lib/cgAnimationEngine';
import { resolveElementFilter, scalePathToUnitBox, findLightSweep, buildLightSweepGeometry, findGlass, buildGlassStyle, buildGlassEdgeStyle, buildImageGlassMask, buildTextGlassMask, findFlagWave, buildFlagWaveFilterProps, findBevel, buildBevelFilterProps, findInnerShadow, buildInnerShadowFilterProps, findAnimatedBg, buildAnimatedBgStyle, GOOEY_THRESHOLD_MATRIX, buildFractalGlassRidgeStyle, buildCrystalFacetStyle, buildLiquidGlassFilterProps, buildLiquidGlassMapSvg, hexToRgba, findRampBlur, buildRampBlurFilterProps, buildRampMaskSvg, buildRampMaskImage, combineGlassMasks, findStroke, buildStrokeGeometry, buildStrokeGlowFilter, findWaveWarp, buildWaveWarpFilterProps, buildWaveWarpMapSvg, buildWaveWarpPinMaskSvg, waveWarpMapPad } from '../../lib/cgEffects';
import { useFlagWave, type FlagWaveNodes } from '../../lib/useFlagWave';
import { useWaveWarp, type WaveWarpNodes } from '../../lib/useWaveWarp';
import { useSequenceLoop } from '../../lib/useSequenceLoop';
import { useAnimatedBg } from '../../lib/useAnimatedBg';
import { useElementConditions } from '../../lib/useElementConditions';
import { useCreditsAnimation } from '../../lib/useCreditsAnimation';
import { CreditsSectionContent, creditsStyleFromConfig } from '../../lib/creditsView';
import { PRESETS, OUT_PRESETS, buildStaticTransform3D } from '../../lib/cgPresets';
import { useLightSweep } from '../../lib/useLightSweep';
import { useRunningStroke } from '../../lib/useRunningStroke';
import { useMatchScheduleData, paginateMatches, matchSchedulePageCount, resolveRowTemplateId, buildMatchRowOverrides } from '../../lib/matchScheduleRow';
import { useStandingsData, paginateStandings, standingsPageCount, resolveStandingsRowTemplateId, buildStandingsRowOverrides } from '../../lib/standingsRow';
import { useBracketData, resolveBracketRowTemplateId, buildBracketRowOverrides } from '../../lib/bracketRow';
import { resolveBackground, resolveSvgFill, resolveTextColorStyle } from '../../lib/cgGradient';
import { useAutoFitFontSize } from '../../lib/useAutoFitFontSize';
import { useTickerScroll } from '../../lib/useTickerScroll';
import { ensureGoogleFontLoaded, fontFamilyCss } from '../../lib/cgFonts';
import { resolveStatbarValue, statbarPercentA, useStatbarRowTweens } from '../../lib/useStatbarValues';
import { applyCardOverrides } from '../../lib/cardCarousel';
import {
  SEVEN_SEG_VIEWBOX, SEVEN_SEG_WIDTH, SEVEN_SEG_HEIGHT, SEGMENT_NAMES,
  DIGIT_SEGMENTS, SEGMENT_PATH_ON, SEGMENT_PATH_OFF, segmentPathFor, isSevenSegmentDigit, colonDotPaths,
} from '../../lib/sevenSegment';
import { migrateLegacyElements } from '../../types/canvas';
import type { TemplateElement, StatBarRow, CgCarouselCard, CreditsSection } from '../../types/canvas';

interface Props {
  config: Record<string, any>;
  w: number;
  h: number;
  /** Set only by CgChannelOutputPage.tsx, only for a template that has
   *  authored config.states — everywhere else (the main canvas, the
   *  single-widget `?cgOutput=` route, or a CG-Playout'd template with no
   *  authored animation) this is undefined and every element just renders
   *  at rest, exactly as before animation support existed. */
  playPhase?: CgStateName;
  /** Bumped by the "Next Stage" button (CgPlayoutPanel.tsx) via
   *  cgPlayoutStore's continueLayer() — resumes the "in" timeline past a
   *  stop point. A `.play()` call when it isn't actually paused is inert,
   *  so this needs no guarding against firing on mount. */
  continueSignal?: number;
  /** Bumped by a `Cg.Loop` button action via cgPlayoutStore's
   *  restartLoopLayer() — force-restarts the "loop" timeline from its
   *  beginning, independent of whatever the "in"/"out" timelines are doing. */
  loopSignal?: number;
  /** Bumped by cgPlayoutStore's playLayer() on EVERY call, even one that
   *  leaves `playPhase` at 'in' unchanged (Play/Cg.In pressed again while
   *  this layer is already on air) — included in the playPhase effect's own
   *  dependency array below so a repeat "go live" always forces a real
   *  restart instead of silently doing nothing because playPhase's VALUE
   *  never actually changed. */
  playSignal?: number;
  /** `Date.now()` from whenever this layer actually went live (see
   *  cgPlayoutStore.ts's own doc comment on `CgLayer.playStartedAt`) — used
   *  only on this component's very FIRST playPhase activation (see the
   *  playPhase effect below) to tell a late-joining output client (this
   *  layer was already playing somewhere else; "Send to Display"/an NDI
   *  capture window just opened, or CgMonitorBar's own PROGRAM box just
   *  remounted) apart from the client the Play command was actually meant
   *  for, which mounts at essentially the same instant it fires. A late
   *  joiner skips straight to the settled post-"in" look instead of
   *  replaying the whole entrance animation from scratch — undefined (every
   *  caller from before this existed) always takes the old always-replay
   *  behavior, unchanged. */
  playStartedAt?: number;
  /** True for every REAL rendering of this template — CgOutputPage.tsx,
   *  CgChannelOutputPage.tsx, and CgMonitorBar.tsx's own Preview/Program
   *  boxes (see WidgetRenderer's own doc comment on this same prop) —
   *  false only for the main canvas's own editing-time widget preview.
   *  Suppresses the "this area is transparent" checkerboard .wgt-cgtemplate
   *  otherwise unconditionally paints (an editing aid with no business
   *  showing up anywhere actual pixels get captured — see index.css) —
   *  WITHOUT this, any transparent fill or reduced opacity anywhere in the
   *  template shows that faint gray grid instead of true transparency the
   *  instant it reaches Program or a real output URL, visibly tinting what
   *  should be letting the video underneath (or nothing at all, for
   *  Fill+Key/plain transparent output) show through untouched. */
  outputOnly?: boolean;
  /** Internal only — never passed by an actual caller (WidgetRenderer,
   *  CgOutputPage.tsx, etc. never set this). A 'cardCarousel' element's own
   *  cards each render an ENTIRE separate template via a NESTED
   *  CgTemplateWidget (see its own 'cardCarousel' doc comment in
   *  types/canvas.ts) — this is that recursion's own cycle guard: every
   *  templateId already rendered somewhere up this recursive chain, so a
   *  card that (directly, or via some other template's own carousel several
   *  levels down) ends up pointing back at one of its own ancestors renders
   *  a "Circular reference" placeholder instead of recursing forever. */
  ancestorTemplateIds?: string[];
}

// Renders a custom CG template's own free-form elements — the same
// component whether reached from the main canvas (a live preview while
// editing anything else on the project), CgOutputPage.tsx's `?cgOutput=`,
// or CgChannelOutputPage.tsx's `?cgChannel=`, since all three just hand a
// CanvasWidget to WidgetRenderer. Elements are built/positioned in
// CgTemplateDesigner.tsx; this component only ever reads config.elements/
// config.states, never writes them.
export function CgTemplateWidget({ config, w, h, playPhase, continueSignal, loopSignal, playSignal, playStartedAt, outputOnly, ancestorTemplateIds }: Props) {
  const resolvedAncestorTemplateIds = ancestorTemplateIds ?? [];
  // SVG ids (mask-<id>, effect-clip-<id> below) are only unique WITHIN one
  // element tree by construction — they're keyed by TemplateElement.id,
  // which is identical across every simultaneous render of the SAME saved
  // template (e.g. CgMonitorBar.tsx's PREVIEW and PROGRAM boxes, mounting
  // two independent CgTemplateWidget instances for the same widget config
  // side by side). Two <clipPath> elements sharing one id is invalid SVG —
  // `url(#id)` resolves to whichever comes FIRST in the document, so
  // without this, PROGRAM's own clip could silently end up using
  // PREVIEW's geometry (or vice versa) whenever they diverge (mid-
  // animation, differing playPhase, etc.). useId() gives each MOUNTED
  // instance of this component its own stable, collision-free prefix — the
  // colons React's own format includes (e.g. ":r0:") are valid in an HTML
  // id but not worth risking inside a CSS url(#...) reference on every
  // WebKit build, so they're stripped.
  const instanceId = useId().replace(/:/g, '');
  // A binding's source widget can live on Main Canvas OR in the CG Template
  // Library (a Scoreboard driving a library template, or one template
  // referencing another) — not commentatorPages, which stays unrelated.
  const { pages, libraryPages } = useCanvasStore();
  const allPages = [...pages, ...libraryPages];
  // Reactive subscription only — a groupSlot binding (see templateBinding.ts's
  // resolveGroupSlotValue) reads the Team Database directly rather than
  // through any widget's own config, so without this, a team actually
  // getting assigned to a group (the live draw, or a manual edit) would
  // never cause this element to re-render and show it.
  useTeamDbStore((s) => s.teams);
  const elements: TemplateElement[] = migrateLegacyElements(config.elements ?? []);
  // Forces a re-render every second whenever any element is bound to
  // another widget — most sources already tick on their own (a Scoreboard
  // score, a Timer's currentMs, both genuine store writes that already
  // trigger a normal re-render), but a 'target'-mode Countdown ticks purely
  // off Date.now() with nothing in the store itself changing as time
  // passes (see templateBinding.ts's hasLiveBinding/pomodoro resolver) — so
  // without this, that kind of binding would only ever update whenever
  // something UNRELATED happened to force a re-render, not tick live.
  const [, forceTick] = useState(0);
  // Every binding source id that could exist on any element/row — a plain
  // string so the effect below only restarts the interval when the actual
  // SET of bound sources changes, not on every unrelated re-render.
  const liveBindingSourcesKey = elements
    .map((e) => [e.binding?.sourceWidgetId, ...(e.kind === 'statbar' ? (e.config.rows ?? []).map((r: StatBarRow) => `${r.bindingA?.sourceWidgetId}:${r.bindingB?.sourceWidgetId}`) : [])].join('|'))
    .join(',');
  useEffect(() => {
    if (!hasLiveBinding(elements)) return;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveBindingSourcesKey]);
  const elRefs = useRef<Record<string, HTMLElement | null>>({});
  // The effects-filter wrapper node for each element that has any config.effects
  // (see TemplateElementView's needsWrapper below) — a DIFFERENT node than
  // elRefs (which targets the element's own animated leaf), written to
  // directly by cgAnimationEngine.ts's buildEffectKeyframeTracks when an
  // effect's own parameter (blur radius, glow color, etc.) is keyframed.
  // effectProxiesRef persists each animated effect's live value across
  // separate state/step timeline builds (see that function's own comment for
  // why) — reset alongside elRefs's inline styles on every fresh "in".
  const effectWrapperRefs = useRef<Record<string, HTMLElement | null>>({});
  const effectProxiesRef = useRef<Record<string, Record<string, any>>>({});
  const timelinesRef = useRef<Partial<Record<CgStateName, gsap.core.Timeline>>>({});
  // The ordered Step sequence (config.steps) that plays between "in" and
  // "loop" — see types/canvas.ts's CgStepState. Empty for every template
  // authored before Steps existed, or that simply doesn't use them —
  // advanceToStepOrLoop below falls straight through to "loop" in that
  // case, so this is fully backward compatible.
  const stepTlsRef = useRef<gsap.core.Timeline[]>([]);
  const currentStepIndexRef = useRef(-1);
  // True the instant "in" finishes with advanceMode:'manual' — distinct
  // from "in" merely being mid-pause at one of its own (older) stops[]
  // points, which needs a different resume (.play() the same timeline,
  // not advance past it) — see the continueSignal dispatcher below.
  const inWaitingToAdvanceRef = useRef(false);
  // See `playStartedAt`'s own doc comment above — this instance's own first
  // playPhase activation only, never a later replay (a repeat Play press on
  // this same still-open client always plays the full "in" for real, same
  // as always).
  const hasActivatedRef = useRef(false);
  const mountedAtRef = useRef(Date.now());
  // Comfortably longer than any normal same-moment sync propagation (WS
  // round-trip to the host and back) between however many clients are
  // simultaneously open when Play is actually pressed, short enough that a
  // genuine late joiner (opened seconds/minutes/hours after) is never
  // mistaken for one of those.
  const LATE_JOIN_THRESHOLD_MS = 400;
  // "Continue in feed" — how many seconds past the end of "in" a late
  // joiner's Step/Loop position should resume AT, instead of always
  // restarting Step 1 / the top of Loop (the limitation the late-join fix
  // above previously left unsolved — see its own comment). Set once, right
  // before `inTl.progress(1)` below; consumed (and cleared) by the very
  // next advanceToStepOrLoop() call, whichever path actually triggers it
  // (an automatic in→Step/Loop advance, or a later manual "Next Stage" if
  // "in" 's own advanceMode is 'manual'). null means "normal start from the
  // top", same behavior as before this existed.
  const lateJoinSeekSecondsRef = useRef<number | null>(null);

  // Advances from wherever playback currently is (the end of "in", or the
  // currently-active Step) to the next Step, or to "loop" once every Step
  // has played. Shared by "in"'s onComplete, each Step's own onComplete
  // (when advanceMode:'auto'), and the continueSignal effect (when
  // advanceMode:'manual' — the same "Next Stage"/Cg.Stage trigger that
  // already resumes a stops[] pause point just generalizes to mean
  // "advance to the next step" whenever a template has any).
  const advanceToStepOrLoop = () => {
    const steps = stepTlsRef.current;

    // "Continue in feed" — a late joiner resumes Steps/Loop at the real
    // elapsed position instead of always restarting Step 1 / the top of
    // Loop. Read-once: cleared immediately so every LATER advance (a
    // genuine Step finishing, a real Loop restart later in the show) goes
    // through the normal "from the top" path right below, same as always.
    const seekSeconds = lateJoinSeekSecondsRef.current;
    lateJoinSeekSecondsRef.current = null;
    if (seekSeconds != null && seekSeconds > 0) {
      let remaining = seekSeconds;
      for (let i = 0; i < steps.length; i++) {
        const stepDuration = steps[i].duration();
        if (remaining < stepDuration) {
          currentStepIndexRef.current = i;
          const stepTl = steps[i];
          const stepConfig = (config.steps ?? [])[i];
          stepTl.eventCallback('onComplete', () => {
            if (stepConfig?.advanceMode === 'auto') setTimeout(() => advanceToStepOrLoop(), stepConfig.autoAdvanceMs ?? 0);
          });
          stepTl.play(remaining);
          return;
        }
        remaining -= stepDuration;
        currentStepIndexRef.current = i;
      }
      // Elapsed time already covers every Step (or there were none) — the
      // rest belongs to Loop, resumed at the matching position within its
      // own one-cycle length instead of always its very start.
      const loopTl = timelinesRef.current.loop;
      if (loopTl) {
        const loopDuration = loopTl.duration();
        loopTl.play(loopDuration > 0 ? remaining % loopDuration : 0);
      }
      return;
    }

    const nextIndex = currentStepIndexRef.current + 1;
    if (nextIndex < steps.length) {
      currentStepIndexRef.current = nextIndex;
      const stepTl = steps[nextIndex];
      const stepConfig = (config.steps ?? [])[nextIndex];
      stepTl.eventCallback('onComplete', () => {
        if (stepConfig?.advanceMode === 'auto') {
          setTimeout(() => advanceToStepOrLoop(), stepConfig.autoAdvanceMs ?? 0);
        }
        // 'manual' — just stop and wait; the continueSignal effect below
        // resumes by calling advanceToStepOrLoop again.
      });
      stepTl.restart();
    } else {
      timelinesRef.current.loop?.restart();
    }
  };

  // Drives playback off the phase CgChannelOutputPage assigns this layer.
  // Rebuilds fresh timelines every time "in" starts (rather than reusing
  // whatever's left over from a previous play/stop cycle on this same
  // mounted instance) so a replay always starts from a clean state, even if
  // an earlier "out" got interrupted mid-animation by an immediate replay.
  //
  // useLayoutEffect, not useEffect: going from Preview to Program (loaded →
  // playing) mounts a brand-new instance of this component (CgChannelOutputPage.tsx/
  // CgMonitorBar.tsx both only render a layer at all once it's playing/
  // stopping) — its FIRST render paints every element in its plain
  // authored rest state (nothing has told GSAP to hide anything yet). The
  // hide-until-revealed `tl.set(el,{visibility:'hidden'},0)` inside
  // buildStateTimelines below only actually reaches the DOM once this
  // effect's body runs — with a plain useEffect, that happens AFTER the
  // browser has already painted that first, unhidden frame, so Program
  // visibly flashed the same static rest look Preview shows for one frame
  // before the real "in" reveal took over. useLayoutEffect runs the same
  // synchronous work before the browser paints anything, so that frame is
  // never actually shown.
  useLayoutEffect(() => {
    if (playPhase === undefined) return;

    const playIn = () => {
      Object.values(timelinesRef.current).forEach((tl) => tl?.kill());
      stepTlsRef.current.forEach((tl) => tl?.kill());
      currentStepIndexRef.current = -1;
      inWaitingToAdvanceRef.current = false;
      // Clear any GSAP-authored inline styles a previous cycle's animation
      // left behind, before re-hiding/replaying, so a replay never starts
      // from a half-finished "out" position/opacity/etc. Scoped to exactly
      // the properties presets/keyframe tracks animate (see cgPresets.ts's
      // PRESETS/OUT_PRESETS) rather than clearProps:'all' — GSAP's 'all'
      // wipes the ENTIRE inline style attribute, including React's own
      // position/left/top/width/height on each TemplateElementView, not
      // just properties GSAP itself set. That silently turned every
      // absolutely-positioned element into a plain block box (full
      // container width, ~0 height, wrong position) the instant an "in"
      // played — the GSAP tween itself then ran correctly on top of that
      // already-broken layout, which is why visibility/opacity/transform
      // all read back correctly while the box was visibly collapsed.
      elements.forEach((el) => { const node = elRefs.current[el.id]; if (node) gsap.set(node, { clearProps: 'opacity,visibility,transform,filter,clipPath' }); });
      // clearProps above just wiped `transform` on EVERY element wholesale
      // — including config.staticRotateX/Y/Z/staticTranslateZ's own
      // always-on pose (see canvas.ts's doc comment on why it exists and
      // fillStyle's own computation above), which isn't part of any state's
      // timeline and so would otherwise never get restored, permanently
      // flattening a 3D Box template's faces back to 2D the moment a "in"
      // ever plays. Re-apply it right after the reset, same as the filter
      // re-application right below does for effects.
      elements.forEach((el) => {
        const node = elRefs.current[el.id];
        const staticTransform = buildStaticTransform3D(el.config, elements.some((c) => c.parentId === el.id));
        if (node && staticTransform) gsap.set(node, { transform: staticTransform });
      });
      // Same problem, same fix, for a plain STATIC config.opacity (a 'rect'
      // element authored at less than full opacity, with no animation of
      // its own touching opacity at all) — clearProps above wiped that back
      // to the CSS default of 1 (fully opaque) too, and nothing else was
      // ever going to restore it for an element with no "in" opacity track/
      // preset of its own. This is exactly why a low-opacity element looked
      // correct in the Designer (which never runs this reset — it has no
      // playPhase-driven playback at all) but snapped to fully opaque the
      // instant the SAME template actually played on Program/a real output.
      elements.forEach((el) => {
        const node = elRefs.current[el.id];
        if (node && el.config.opacity !== undefined) gsap.set(node, { opacity: el.config.opacity });
      });
      // Same reset for the effects side — a killed mid-tween filter
      // shouldn't leak into a fresh replay, and effectProxiesRef itself
      // (the "wherever the last play-through left each effect's animated
      // value" store) gets wiped too, so a replay's own tween-into-first-
      // keyframe starts from the true static base again, not last time's
      // ending value.
      effectProxiesRef.current = {};
      elements.forEach((el) => {
        const wrapperNode = effectWrapperRefs.current[el.id];
        if (wrapperNode) wrapperNode.style.filter = resolveElementFilter(el.config, instanceId, el.id, el.changeAnim?.preset) || '';
      });
      // Only elements with an authored "in" animation ever get hidden —
      // buildStateTimelines() does that itself, as part of the timeline
      // (position 0), so there's no separate imperative call racing against
      // a reveal the timeline schedules at delay 0 (see cgAnimationEngine.ts
      // for why that ordering matters). Anything NOT animated in "in" is
      // left exactly as it renders normally (static, always visible) — a
      // template is a static design first, and animation is something
      // added to specific elements on top of that, not a requirement for
      // every element to be listed in every state just to stay visible.
      const timelines = buildStateTimelines(config.states, elements, elRefs.current, effectWrapperRefs.current, effectProxiesRef.current);
      timelinesRef.current = timelines;
      stepTlsRef.current = buildStepTimelines(config.steps, elements, elRefs.current, effectWrapperRefs.current, effectProxiesRef.current);

      // See `playStartedAt`'s own doc comment — only ever true on this
      // instance's very FIRST activation, never a genuine repeat Play press.
      const isLateJoin = !hasActivatedRef.current && playStartedAt != null && mountedAtRef.current - playStartedAt > LATE_JOIN_THRESHOLD_MS;
      hasActivatedRef.current = true;

      const inTl = timelines.in;
      if (inTl) {
        inTl.eventCallback('onComplete', () => {
          const advanceMode = config.states?.in?.advanceMode ?? 'auto';
          if (advanceMode === 'manual') {
            // Just stop and wait — the continueSignal dispatcher below
            // resumes by calling advanceToStepOrLoop once "Next Stage" is
            // actually pressed.
            inWaitingToAdvanceRef.current = true;
            return;
          }
          const ms = config.states?.in?.autoAdvanceMs ?? 0;
          if (ms > 0) setTimeout(() => advanceToStepOrLoop(), ms);
          else advanceToStepOrLoop();
        });
        if (isLateJoin) {
          // Jump straight to the settled post-"in" look instead of visibly
          // replaying the whole entrance from scratch — this is the "Send to
          // Display/NDI program feed always restarts" fix: a client that
          // opens well after Play was actually pressed has no business
          // showing the intro again. `progress(1)` (not `pause(duration)`)
          // deliberately still fires the SAME onComplete above, so whatever
          // happens after "in" (advance to Steps/Loop, or wait for manual
          // advance) is the exact same logic a real, on-time finish would
          // have run — just reached instantly.
          //
          // "Continue in feed" — real elapsed time past the end of "in"
          // (wall-clock, from playStartedAt) is what advanceToStepOrLoop
          // above uses to resume Steps/Loop at the matching position
          // instead of always Step 1 / the top of Loop — the limitation
          // this fix used to leave open. An approximation, not exact:
          // assumes the show actually progressed automatically the whole
          // way (any 'manual' advanceMode step genuinely waiting on an
          // operator's "Next Stage" click would make the real position
          // unknowable without the host also broadcasting it, same "out of
          // scope" reasoning as before) — but for the common all-automatic
          // case this is now a real resume, not a restart.
          lateJoinSeekSecondsRef.current = Math.max(0, (mountedAtRef.current - playStartedAt!) / 1000 - inTl.duration());
          inTl.progress(1);
        } else {
          inTl.restart();
        }
      } else {
        // No authored "in" — still honor Steps/Loop if either exist. Same
        // "continue in feed" resume as the isLateJoin branch above, just
        // with nothing to subtract an "in" duration for.
        if (isLateJoin) lateJoinSeekSecondsRef.current = Math.max(0, (mountedAtRef.current - playStartedAt!) / 1000);
        advanceToStepOrLoop();
      }
    };

    if (playPhase === 'in') {
      playIn();
    } else if (playPhase === 'out') {
      const timelines = timelinesRef.current;
      timelines.loop?.pause();
      timelines.in?.pause();
      stepTlsRef.current.forEach((tl) => tl?.pause());
      timelines.out?.restart();
    }
    // playSignal is deliberately in this dependency array even though the
    // effect body never reads it — its only job is forcing a re-fire when
    // Play/Cg.In is pressed again while playPhase is already 'in' (status
    // was already 'playing', so that prop's VALUE didn't change, and this
    // effect otherwise wouldn't know a fresh "go live" happened at all).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playPhase, playSignal]);

  // "Next Stage" — figures out what's actually waiting for it and resumes
  // that specifically, in priority order:
  //   1. "in" finished and is waiting because its own advanceMode is
  //      'manual' — move ON to Step 1/Loop, not just continue "in" (it's
  //      already finished).
  //   2. The currently-active Step, if it's genuinely paused mid-animation
  //      at one of its own stops[] (tl.addPause()) — resume THAT step;
  //      otherwise (it simply finished and is waiting on its own
  //      advanceMode:'manual') move on to the next Step/Loop.
  //   3. "out", if it's genuinely paused mid-animation at one of its own
  //      stops[] — resume it. Previously unresumable: this case wasn't
  //      checked at all, so pressing Next Stage while Out was paused did
  //      nothing useful.
  //   4. Fallback — "in" paused mid-animation at one of its own (older,
  //      pre-Steps) stops[] points.
  // "Genuinely mid-pause" (as opposed to "simply reached its end") is
  // .paused() (only ever true here from tl.addPause()) combined with
  // .time() being strictly between 0 and .duration() — a timeline that
  // finished on its own via .restart() is never .paused() at all.
  //
  // Skips its own first firing: `continueSignal` is a plain number
  // (default 0, never undefined) that's already reflecting whatever it was
  // set to by the time this component first mounts, so this effect always
  // runs once on mount regardless of whether an operator ever actually
  // pressed Next Stage. `.play()` on an already-playing/finished timeline
  // is harmlessly inert, which is why the fallback never needed this guard
  // — but advanceToStepOrLoop() is NOT inert, and would otherwise jump
  // straight to Step 1 the instant "in" starts, before anyone asked for it.
  const skipFirstContinueRef = useRef(true);
  useEffect(() => {
    if (continueSignal === undefined) return;
    if (skipFirstContinueRef.current) { skipFirstContinueRef.current = false; return; }

    const isMidPause = (tl: gsap.core.Timeline | undefined) => !!tl && tl.paused() && tl.time() > 0 && tl.time() < tl.duration();

    if (inWaitingToAdvanceRef.current) {
      inWaitingToAdvanceRef.current = false;
      advanceToStepOrLoop();
      return;
    }

    const activeStepTl = currentStepIndexRef.current >= 0 ? stepTlsRef.current[currentStepIndexRef.current] : undefined;
    if (activeStepTl) {
      if (isMidPause(activeStepTl)) activeStepTl.play();
      else advanceToStepOrLoop();
      return;
    }

    if (isMidPause(timelinesRef.current.out)) {
      timelinesRef.current.out!.play();
      return;
    }

    timelinesRef.current.in?.play();
  }, [continueSignal]);

  // "Cg.Loop" button action — force-restart the loop timeline from its
  // beginning, regardless of where it currently is in its cycle.
  useEffect(() => {
    if (loopSignal === undefined) return;
    timelinesRef.current.loop?.restart();
  }, [loopSignal]);

  useEffect(() => () => {
    Object.values(timelinesRef.current).forEach((tl) => tl?.kill());
    stepTlsRef.current.forEach((tl) => tl?.kill());
  }, []);

  // One hidden <clipPath> per distinct shape element referenced as a
  // maskId anywhere in this template — clip-path: url(#id) resolves
  // globally, so these live once at the top regardless of nesting depth,
  // shared by every element that points at the same mask.
  const maskIds = [...new Set(elements.map((e) => e.maskId).filter((id): id is string => !!id))];
  // One <filter> per element with an enabled flagWave effect — see
  // cgEffects.ts's own doc comment on the recipe and lib/useFlagWave.ts for
  // what animates baseFrequency/azimuth. flagWaveRefs holds each element's
  // own <feTurbulence>/<feDistantLight> nodes (populated by the ref
  // callbacks below), read back via getFlagWaveRefs from inside
  // TemplateElementView.
  const flagWaveRefs = useRef<Record<string, FlagWaveNodes>>({});
  const flagWaveEls = elements.filter((e) => findFlagWave(e.config.effects));
  // Same idea, one per element with an enabled 'waveWarp' effect — see
  // cgEffects.ts's own doc comment on the recipe and lib/useWaveWarp.ts for
  // what animates the feOffset's own dx/dy.
  const waveWarpRefs = useRef<Record<string, WaveWarpNodes>>({});
  const waveWarpEls = elements.filter((e) => findWaveWarp(e.config.effects));
  // Same idea, one per element with an enabled 'bevel' effect — see
  // cgEffects.ts's own doc comment on the recipe. Static (no ref map/hook
  // needed — nothing here animates, unlike flagWave's own turbulence/light).
  const bevelEls = elements.filter((e) => findBevel(e.config.effects));
  // Same idea again, one per element with an enabled 'innerShadow' effect —
  // see cgEffects.ts's buildInnerShadowFilterProps for the recipe. Also
  // static.
  const innerShadowEls = elements.filter((e) => findInnerShadow(e.config.effects));
  // Same idea, one per element with a ramp-masked plain 'blur' effect — see
  // cgEffects.ts's findRampBlur/buildRampMaskSvg for why this needs its own
  // per-element <filter> (a feImage-driven spatial mask blending a blurred
  // copy over the sharp original) rather than just a `blur(px)` CSS term.
  const rampBlurEls = elements.filter((e) => findRampBlur(e.config.effects));
  // Same idea, one per 'text' element with changeAnim.preset === 'gooeyMorph'
  // — see cgEffects.ts's GOOEY_THRESHOLD_MATRIX for the recipe. Also
  // static (the threshold itself never changes; it's the two glyph copies
  // sitting BEHIND it that GSAP animates, in the value-change effect
  // further down).
  const gooeyEls = elements.filter((e) => e.kind === 'text' && e.changeAnim?.preset === 'gooeyMorph');

  return (
    <div className={outputOnly ? undefined : 'wgt-cgtemplate'} style={{ position: 'relative', width: w, height: h, overflow: 'hidden' }}>
      {(maskIds.length > 0 || flagWaveEls.length > 0 || bevelEls.length > 0 || innerShadowEls.length > 0 || rampBlurEls.length > 0 || waveWarpEls.length > 0 || gooeyEls.length > 0) && (
        <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
          <defs>
            {maskIds.map((maskId) => {
              const shape = elements.find((e) => e.id === maskId && e.kind === 'shape');
              if (!shape) return null;
              return (
                <clipPath key={maskId} id={`${instanceId}-mask-${maskId}`} clipPathUnits="objectBoundingBox">
                  <path d={scalePathToUnitBox(shape.config.d ?? '', shape.w, shape.h)} />
                </clipPath>
              );
            })}
            {flagWaveEls.map((el) => {
              const fx = findFlagWave(el.config.effects)!;
              const p = buildFlagWaveFilterProps(fx);
              const entry = (flagWaveRefs.current[el.id] ??= { turbulence: null, light: null });
              return (
                <filter key={el.id} id={`${instanceId}-flagwave-${el.id}`} x="-20%" y="-20%" width="140%" height="140%">
                  <feTurbulence ref={(node) => { entry.turbulence = node; }} type="fractalNoise" baseFrequency={p.baseFrequency} numOctaves={2} seed={7} result="turbulence" />
                  <feDisplacementMap in="SourceGraphic" in2="turbulence" scale={p.scale} xChannelSelector="R" yChannelSelector="G" result="displaced" />
                  <feDiffuseLighting in="turbulence" lightingColor="#ffffff" surfaceScale={p.surfaceScale} diffuseConstant={1} result="light">
                    <feDistantLight ref={(node) => { entry.light = node; }} azimuth={p.azimuth} elevation={60} />
                  </feDiffuseLighting>
                  <feComposite in="light" in2="SourceAlpha" operator="in" result="lightMasked" />
                  <feBlend in="displaced" in2="lightMasked" mode="multiply" />
                </filter>
              );
            })}
            {bevelEls.map((el) => {
              const fx = findBevel(el.config.effects)!;
              const p = buildBevelFilterProps(fx);
              return (
                // color-interpolation-filters="sRGB" — feDiffuseLighting/
                // feSpecularLighting/feComponentTransfer below all need to
                // agree on ONE color space for the diffuseBaseline/
                // specBaseline intercepts (computed in cgEffects.ts as plain
                // 0..1 sRGB-ish numbers) to actually cancel a flat surface's
                // own baseline glow to ~0 — the default `linearRGB` filter
                // space would silently mismatch those constants (measured/
                // derived in sRGB) and leave the WHOLE shape washed out
                // toward white instead of just its edges, which is exactly
                // the "bevel doesn't hug the actual text/shape, just looks
                // like a flat glowing box" bug this whole recipe exists to
                // fix — see cgEffects.ts's own doc comment on
                // diffuseBaseline/specBaseline for the actual math.
                <filter key={el.id} id={`${instanceId}-bevel-${el.id}`} x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
                  <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="alphaMap" />
                  {p.edgeOnly && <feMorphology in="alphaMap" operator="erode" radius={p.ringWidth} result="eroded" />}
                  {p.edgeOnly && <feComposite in="alphaMap" in2="eroded" operator="out" result="alphaMap" />}
                  <feGaussianBlur in="alphaMap" stdDeviation={p.softness} result="bump" />
                  <feDiffuseLighting in="bump" surfaceScale={p.surfaceScale} diffuseConstant={1} lightingColor="#ffffff" result="diffuse">
                    <feDistantLight azimuth={p.azimuth} elevation={p.elevation} />
                  </feDiffuseLighting>
                  {/* Re-centers `diffuse` on a flat area to 0 (see
                     diffuseBaseline's own doc comment) — split into a
                     highlight-only map (positive deviations, clipped at 0)
                     and a shadow-only map (negative deviations, flipped
                     positive, also clipped at 0) so a flat surface
                     contributes NEITHER brightening nor darkening, and only
                     genuine edge relief shows up as one or the other. */}
                  <feComponentTransfer in="diffuse" result="highlight">
                    <feFuncR type="linear" slope="1" intercept={-p.diffuseBaseline} />
                    <feFuncG type="linear" slope="1" intercept={-p.diffuseBaseline} />
                    <feFuncB type="linear" slope="1" intercept={-p.diffuseBaseline} />
                  </feComponentTransfer>
                  <feComponentTransfer in="diffuse" result="shadowRaw">
                    <feFuncR type="linear" slope="-1" intercept={p.diffuseBaseline} />
                    <feFuncG type="linear" slope="-1" intercept={p.diffuseBaseline} />
                    <feFuncB type="linear" slope="-1" intercept={p.diffuseBaseline} />
                  </feComponentTransfer>
                  <feSpecularLighting in="bump" surfaceScale={p.surfaceScale} specularConstant={0.6} specularExponent={p.shininess} lightingColor="#ffffff" result="spec">
                    <feDistantLight azimuth={p.azimuth} elevation={p.elevation} />
                  </feSpecularLighting>
                  {/* Same re-centering as diffuse above, one-sided (a
                     specular highlight has no "negative" shadow side worth
                     rendering separately — see specBaseline's own doc
                     comment). */}
                  <feComponentTransfer in="spec" result="specNorm">
                    <feFuncR type="linear" slope="1" intercept={-p.specBaseline} />
                    <feFuncG type="linear" slope="1" intercept={-p.specBaseline} />
                    <feFuncB type="linear" slope="1" intercept={-p.specBaseline} />
                  </feComponentTransfer>
                  <feComposite in="specNorm" in2="SourceAlpha" operator="in" result="specClipped" />
                  <feBlend in="highlight" in2="specClipped" mode="screen" result="highlightPlusSpec" />
                  <feComposite in="highlightPlusSpec" in2="SourceAlpha" operator="in" result="litClipped" />
                  <feComposite in="shadowRaw" in2="SourceAlpha" operator="in" result="shadowClipped" />
                  {/* 1-shadowAmount, so a `multiply` below only ever darkens
                     (never no-ops to black outside the shadow band). */}
                  <feComponentTransfer in="shadowClipped" result="shadowInverted">
                    <feFuncR type="linear" slope="-1" intercept="1" />
                    <feFuncG type="linear" slope="-1" intercept="1" />
                    <feFuncB type="linear" slope="-1" intercept="1" />
                  </feComponentTransfer>
                  <feBlend in="SourceGraphic" in2="litClipped" mode="screen" result="withHighlight" />
                  <feBlend in="withHighlight" in2="shadowInverted" mode="multiply" />
                </filter>
              );
            })}
            {innerShadowEls.map((el) => {
              const fx = findInnerShadow(el.config.effects)!;
              const p = buildInnerShadowFilterProps(fx);
              return (
                <filter key={el.id} id={`${instanceId}-innershadow-${el.id}`} x="-30%" y="-30%" width="160%" height="160%">
                  <feComponentTransfer in="SourceAlpha" result="invertedAlpha">
                    <feFuncA type="table" tableValues="1 0" />
                  </feComponentTransfer>
                  <feOffset in="invertedAlpha" dx={p.offsetX} dy={p.offsetY} result="offsetInverted" />
                  <feGaussianBlur in="offsetInverted" stdDeviation={p.blur} result="blurredInverted" />
                  <feComposite in="blurredInverted" in2="SourceAlpha" operator="in" result="innerShadowAlpha" />
                  <feFlood floodColor={p.color} floodOpacity={p.opacity} result="shadowColor" />
                  <feComposite in="shadowColor" in2="innerShadowAlpha" operator="in" result="coloredInnerShadow" />
                  <feComposite in="coloredInnerShadow" in2="SourceGraphic" operator="over" />
                </filter>
              );
            })}
            {rampBlurEls.map((el) => {
              const fx = findRampBlur(el.config.effects)!;
              const p = buildRampBlurFilterProps(fx);
              const maskSvg = buildRampMaskSvg(el.w, el.h, p.angle);
              return (
                <filter key={el.id} id={`${instanceId}-rampblur-${el.id}`} x="0%" y="0%" width="100%" height="100%">
                  <feImage href={`data:image/svg+xml,${encodeURIComponent(maskSvg)}`} x="0" y="0" width={el.w} height={el.h} result="rampMask" />
                  <feGaussianBlur in="SourceGraphic" stdDeviation={p.blur} result="blurred" />
                  <feComposite in="blurred" in2="rampMask" operator="in" result="blurredMasked" />
                  <feComposite in="blurredMasked" in2="SourceGraphic" operator="over" />
                </filter>
              );
            })}
            {waveWarpEls.map((el) => {
              const fx = findWaveWarp(el.config.effects)!;
              const p = buildWaveWarpFilterProps(fx);
              const entry = (waveWarpRefs.current[el.id] ??= { offset: null });
              const isNoise = p.waveType === 'noise' || p.waveType === 'smoothNoise';
              const pad = waveWarpMapPad(el.w, el.h);
              const mapSvg = isNoise ? null : buildWaveWarpMapSvg(p.waveType, p.wavelength, p.angleDeg, p.antiAlias, el.w, el.h);
              const pinMaskSvg = p.pinning === 'none' ? null : buildWaveWarpPinMaskSvg(p.pinning, el.w, el.h);
              return (
                <filter key={el.id} id={`${instanceId}-wavewarp-${el.id}`} x="-60%" y="-60%" width="220%" height="220%">
                  {isNoise ? (
                    <feTurbulence type={p.waveType === 'noise' ? 'fractalNoise' : 'turbulence'} baseFrequency={p.baseFrequency} numOctaves={2} seed={11} stitchTiles="stitch" result="wavefield" />
                  ) : (
                    <feImage href={`data:image/svg+xml,${encodeURIComponent(mapSvg!)}`} x={-pad} y={-pad} width={el.w + pad * 2} height={el.h + pad * 2} result="wavefield" />
                  )}
                  <feOffset ref={(node) => { entry.offset = node; }} in="wavefield" dx={0} dy={0} result="offsetfield" />
                  <feDisplacementMap in="SourceGraphic" in2="offsetfield" scale={p.scale} xChannelSelector="R" yChannelSelector="G" result={pinMaskSvg ? 'displaced' : undefined} />
                  {pinMaskSvg && (
                    <>
                      <feImage href={`data:image/svg+xml,${encodeURIComponent(pinMaskSvg)}`} x="0" y="0" width={el.w} height={el.h} result="pinMaskImg" />
                      <feColorMatrix in="pinMaskImg" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="pinAlpha" />
                      <feComposite in="displaced" in2="pinAlpha" operator="in" result="displacedPinned" />
                      <feComposite in="SourceGraphic" in2="pinAlpha" operator="out" result="sourcePinned" />
                      <feMerge>
                        <feMergeNode in="sourcePinned" />
                        <feMergeNode in="displacedPinned" />
                      </feMerge>
                    </>
                  )}
                </filter>
              );
            })}
            {gooeyEls.map((el) => (
              // A hard threshold entirely on the ALPHA channel (RGB rows
              // are identity) — see cgEffects.ts's GOOEY_THRESHOLD_MATRIX
              // for the full recipe. x/y/width/height widen the filter's
              // own default region (objectBoundingBox -10%/-10%/120%/120%,
              // i.e. barely any margin around a typical single-line text
              // box) — the per-node blur this preset drives up to 100px
              // (see the value-change effect below) needs FAR more room
              // than that to actually reach this filter instead of being
              // clipped away to nothing before the threshold ever sees it,
              // which on a normal-sized text element (unlike the original
              // CodePen's own oversized demo box) reads as the text just
              // vanishing entirely rather than melting.
              <filter key={el.id} id={`${instanceId}-gooey-${el.id}`} x="-150%" y="-150%" width="400%" height="400%">
                <feColorMatrix in="SourceGraphic" type="matrix" values={GOOEY_THRESHOLD_MATRIX} />
              </filter>
            ))}
          </defs>
        </svg>
      )}
      {elements.filter((el) => !el.parentId).map((el) => (
        <TemplateElementView
          key={el.id}
          el={el}
          allElements={elements}
          pages={allPages}
          registerRefById={(id, node) => { elRefs.current[id] = node; }}
          registerEffectWrapperById={(id, node) => { effectWrapperRefs.current[id] = node; }}
          continueSignal={continueSignal}
          ancestorTemplateIds={resolvedAncestorTemplateIds}
          instanceId={instanceId}
          getFlagWaveRefs={(id) => flagWaveRefs.current[id]}
          getWaveWarpRefs={(id) => waveWarpRefs.current[id]}
          playStartedAt={playStartedAt}
        />
      ))}
    </div>
  );
}

function TemplateElementView({ el, allElements, pages, registerRefById, registerEffectWrapperById, continueSignal, ancestorTemplateIds, instanceId, getFlagWaveRefs, getWaveWarpRefs, playStartedAt }: {
  el: TemplateElement;
  allElements: TemplateElement[];
  pages: ReturnType<typeof useCanvasStore.getState>['pages'];
  /** This CgTemplateWidget mount's own useId() — see its doc comment. Only
   *  ever used to prefix the "mask-" / "effect-clip-" ids below, so two
   *  simultaneous instances of the SAME template (CgMonitorBar.tsx's own
   *  PREVIEW/PROGRAM pair, most notably) never collide over one SVG id. */
  instanceId: string;
  /** Reads flagWaveRefs.current[id] — CgTemplateWidget's own top-level map
   *  of each flagWave-enabled element's <feTurbulence>/<feDistantLight>
   *  nodes (built in the shared <defs> block) — see lib/useFlagWave.ts. */
  getFlagWaveRefs: (id: string) => FlagWaveNodes | undefined;
  /** Reads waveWarpRefs.current[id] — CgTemplateWidget's own top-level map
   *  of each waveWarp-enabled element's <feOffset> node (built in the shared
   *  <defs> block) — see lib/useWaveWarp.ts. */
  getWaveWarpRefs: (id: string) => WaveWarpNodes | undefined;
  /** CgTemplateWidget's own top-level prop, threaded straight through every
   *  level of recursion — a looping 'sequence' element's own frame clock
   *  (lib/useSequenceLoop.ts) anchors to this wall-clock instant instead of
   *  whenever THIS particular component instance happened to mount, so a
   *  reconnecting/late-joining output client's sequence lands on the same
   *  frame an already-open client is showing right now ("continue in
   *  feed") rather than restarting from frame 0. */
  playStartedAt?: number;
  /** Keyed by element id rather than a single-element callback (like every
   *  other renderer in this app uses) because ONE call site now has to
   *  register refs for a whole recursively-rendered subtree, not just its
   *  own element — every level of recursion passes the exact same function
   *  straight through, keyed by whichever element it's currently on. */
  registerRefById: (id: string, node: HTMLElement | null) => void;
  /** Same idea, for the effects-filter wrapper div below (a DIFFERENT node
   *  than registerRefById's target) — see cgAnimationEngine.ts's
   *  buildEffectKeyframeTracks, which writes an animated `filter` value
   *  straight onto whatever this registers. */
  registerEffectWrapperById: (id: string, node: HTMLElement | null) => void;
  /** Same prop CgTemplateWidget itself receives (see its own doc comment) —
   *  threaded straight through so a 'imagePlaylist' element in
   *  advanceMode:'manual' can react to the exact same "Next Stage" press
   *  that already resumes the whole-template Steps system, rather than CG
   *  Playout needing a second, separate "advance the playlist" control. */
  continueSignal?: number;
  /** Same prop CgTemplateWidget itself receives (see its own doc comment) —
   *  threaded straight through so a 'cardCarousel' element several levels
   *  deep still carries its own full ancestor chain for the cycle guard. */
  ancestorTemplateIds: string[];
}) {
  // 'sound' is a non-visual layer (see TemplateElement's own doc comment) —
  // never a single pixel on the real output, regardless of state/effects/
  // masking/anything else below. Its own cue is scheduled entirely by
  // cgAnimationEngine.ts's buildOneTimeline (CgLayerAnim.sfxId/sfxVolume),
  // which never looks for a DOM ref for it either — nothing here needs to
  // register one. Safe as the very first statement, before any Hook below —
  // this element's `kind` never changes across this component instance's
  // own lifetime, so this is never a CONDITIONAL early return from render
  // to render, just a fixed one for every render of a 'sound' element.
  if (el.kind === 'sound') return null;

  // A child renders NESTED inside its parent's own DOM node (below), so its
  // x/y resolve relative to the parent's box and it inherits the parent's
  // animated transform for free via ordinary CSS — no coordinate math
  // anywhere. Every element with no children (everything before this
  // feature existed) takes the plain, unwrapped branch further down,
  // byte-for-byte identical to before.
  const children = allElements.filter((c) => c.parentId === el.id);
  const flagWaveFx = findFlagWave(el.config.effects);
  const waveWarpFx = findWaveWarp(el.config.effects);
  const animatedBgFx = findAnimatedBg(el.config.effects);
  const animatedBgStyleObj = animatedBgFx ? buildAnimatedBgStyle(animatedBgFx) : null;
  const filterStr = resolveElementFilter(el.config, instanceId, el.id, el.changeAnim?.preset);
  const hasMask = !!el.maskId && allElements.some((e) => e.id === el.maskId && e.kind === 'shape');
  // Also wrapped whenever ANY effect entry exists at all (even currently
  // all-disabled, so filterStr is '') — keeps the wrapper (and therefore
  // its ref) present and stable regardless of a checkbox being toggled
  // mid-edit, rather than the node popping in/out of existence, which would
  // otherwise leave buildEffectKeyframeTracks writing to a stale/missing ref.
  const needsWrapper = !!filterStr || hasMask || children.length > 0 || !!el.config.effects?.length;
  const registerRef = (node: HTMLElement | null) => registerRefById(el.id, node);
  // A looping 'sequence' element's own double-buffered frame layers — see
  // lib/useSequenceLoop.ts's own doc comment. Local to this element
  // instance (not keyed into a shared ref map like elRefs/flagWaveRefs
  // above) since nothing outside this one element ever needs to read them.
  const seqLayerARef = useRef<HTMLDivElement | null>(null);
  const seqLayerBRef = useRef<HTMLDivElement | null>(null);

  const renderChildren = () => children.map((c) => (
    <TemplateElementView key={c.id} el={c} allElements={allElements} pages={pages} registerRefById={registerRefById} registerEffectWrapperById={registerEffectWrapperById} continueSignal={continueSignal} ancestorTemplateIds={ancestorTemplateIds} instanceId={instanceId} getFlagWaveRefs={getFlagWaveRefs} getWaveWarpRefs={getWaveWarpRefs} playStartedAt={playStartedAt} />
  ));

  // Called unconditionally regardless of kind (React's rules of hooks) —
  // `enabled` is what actually turns it on, only ever true for a 'text'
  // element with config.autoFit set.
  const textRef = useRef<HTMLDivElement | null>(null);
  const textContentForFit = el.kind === 'text' ? (el.binding ? resolveBindingValue(pages, el.binding) : (el.config.text ?? '')) : '';
  const fitFontSize = useAutoFitFontSize(el.kind === 'text' && !!el.config.autoFit, textRef, el.config.fontSize ?? 14, el.config.wordWrap ?? true, [textContentForFit, el.w, el.h]);

  // 'ticker' — see types/canvas.ts's own doc on this kind and
  // lib/useTickerScroll.ts for the shared scroll-loop mechanics.
  const tickerTrackRef = useRef<HTMLDivElement | null>(null);
  const tickerUnitRef = useRef<HTMLSpanElement | null>(null);
  const tickerText = el.kind === 'ticker' ? (el.binding ? resolveBindingValue(pages, el.binding) : (el.config.text ?? '')) : '';
  const tickerRepeats = useTickerScroll(el.kind === 'ticker', tickerTrackRef, tickerUnitRef, el.w, {
    text: tickerText, fontSize: el.config.fontSize ?? 32, bold: !!el.config.bold, speed: el.config.speed ?? 120, direction: el.config.direction ?? 'left', gap: el.config.gap ?? 80,
  });

  // 'credits' — see types/canvas.ts's own doc on this kind and
  // lib/useCreditsAnimation.ts for the shared scroll/sequence mechanics.
  // Plain local refs (not a shared Record keyed by id) are enough — this
  // component instance already IS scoped to just this one element.
  const creditsScrollRef = useRef<HTMLDivElement | null>(null);
  const creditsSectionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const creditsSections: CreditsSection[] = el.kind === 'credits' ? (el.config.sections ?? []) : [];
  useCreditsAnimation(el.kind === 'credits', el, el.w, el.h, creditsScrollRef, (i) => creditsSectionRefs.current[i], creditsSections.length);

  // Any kind with an enabled 'flagWave' effect — see lib/useFlagWave.ts's
  // own doc comment. Usable on ANY element, so this is gated purely on
  // flagWaveFx, not el.kind at all.
  const flagWaveProps = flagWaveFx ? buildFlagWaveFilterProps(flagWaveFx) : null;
  useFlagWave(
    !!flagWaveFx,
    () => getFlagWaveRefs(el.id),
    flagWaveProps?.baseFrequency ?? 0.01,
    flagWaveProps?.azimuth ?? 45,
    flagWaveProps?.cycleDuration ?? 3,
  );

  // Any kind with an enabled 'waveWarp' effect — see lib/useWaveWarp.ts's
  // own doc comment. Usable on any element, same as flagWave.
  const waveWarpProps = waveWarpFx ? buildWaveWarpFilterProps(waveWarpFx) : null;
  useWaveWarp(
    !!waveWarpFx,
    () => getWaveWarpRefs(el.id),
    waveWarpProps?.pxPerSecond ?? 0,
    waveWarpProps?.phasePx ?? 0,
    waveWarpProps?.angleDeg ?? 0,
  );

  // A 'sequence' element with config.loop on — see lib/useSequenceLoop.ts's
  // own doc comment. Independent of playPhase entirely (same "always
  // running once mounted" convention flagWave/waveWarp above already use),
  // so this keeps cycling even inside a nested template that never
  // receives a playPhase prop at all.
  const sequenceLoading = useSequenceLoop(
    el.kind === 'sequence' && !!el.config.loop,
    () => ({ a: seqLayerARef.current, b: seqLayerBRef.current }),
    el.config.frames ?? [],
    el.config.fps ?? 24,
    playStartedAt,
    el.config.blend ? Math.max(0, el.config.blendMs ?? 150) : 0,
  );

  // Any kind with an enabled 'animatedBg' effect — see lib/useAnimatedBg.ts's
  // own doc comment. Also usable on any element, same as flagWave/bevel.
  const animatedBgRef = useRef<HTMLDivElement | null>(null);
  useAnimatedBg(!!animatedBgFx, animatedBgRef, animatedBgStyleObj, animatedBgFx?.duration ?? 6, animatedBgFx?.loopMode ?? 'yoyo');

  // Any kind with `conditions` set — see lib/useElementConditions.ts's own
  // doc comment. Targets this WHOLE element's own outermost positioning
  // div (returned below) — a node nothing else here ever writes
  // opacity/visibility to, so it never fights the in/loop/out state
  // machine's own animated writes on el's own separate, inner ref.
  const conditionsRef = useRef<HTMLDivElement | null>(null);
  useElementConditions(el.conditions, pages, conditionsRef);

  // 'statbar' — see types/canvas.ts's own doc on this kind (and StatBarRow)
  // and lib/useStatbarValues.ts for the shared resolve/animate mechanics.
  // One segment-A DOM node per row, keyed by row id (see
  // useStatbarRowTweens's own doc on why identity, not array index).
  const statbarNodesRef = useRef<Record<string, HTMLDivElement | null>>({});
  const statbarRows: StatBarRow[] = el.kind === 'statbar' ? (el.config.rows ?? []) : [];
  const statbarRowValues = statbarRows.map((row) => {
    const valueA = resolveStatbarValue(row.bindingA ? resolveBindingValue(pages, row.bindingA) : undefined, row.valueA);
    const valueB = resolveStatbarValue(row.bindingB ? resolveBindingValue(pages, row.bindingB) : undefined, row.valueB);
    return { id: row.id, valueA, valueB, pctA: statbarPercentA(valueA, valueB) };
  });
  useStatbarRowTweens(statbarNodesRef, statbarRowValues.map((r) => ({ id: r.id, pct: r.pctA })), el.config.ease ?? 'power2.out');

  // registerReliableTick's own key namespace is shared PROCESS-WIDE (a
  // plain module-level object in canvasStore.ts), not scoped to any one
  // mounted component — so keying purely by el.id (as both 'imagePlaylist'
  // and 'cardCarousel' below originally did) breaks the moment the SAME
  // template happens to be rendered more than once at a time, which is an
  // entirely normal thing for a CG template to have happen (loaded into
  // both the Monitor's PREVIEW and PROGRAM boxes at once, played on two
  // output channels simultaneously, etc.): both mounted instances compute
  // the identical key, the second registration silently overwrites the
  // first's handler, and whichever instance happens to unmount FIRST (e.g.
  // Preview being reloaded with different content) deletes that SHARED key
  // out from under the surviving instance — which then simply never ticks
  // again, with nothing left to notice or recover. This is exactly the
  // "stops advancing on Program/Preview after some other page/cue change"
  // symptom that bug produces. A random id generated once per actual mount
  // makes every instance's own key unique regardless of how many times the
  // same underlying template is rendered concurrently, so one instance's
  // mount/unmount lifecycle can never affect another's.
  const tickInstanceIdRef = useRef(Math.random().toString(36).slice(2));

  // 'imagePlaylist' — see types/canvas.ts's own doc on this kind. Advancing
  // itself (the auto timer, or reacting to a manual "Next Stage" press) is
  // self-contained and mount-driven, same as 'ticker's own always-running
  // scroll — NOT reset by playIn()'s reset block above, so replaying this
  // template's own "in" doesn't interrupt wherever the slideshow currently
  // is. Only the transition tween itself is GSAP's; which slide is
  // "current" lives in a plain ref (not React state) since the actual pixel
  // change is a direct DOM mutation (node.src), the same imperative
  // discipline every other GSAP-owned property in this file already follows
  // (see wrapperRef's filter, segmentRefs' `d`).
  const playlistImgRef = useRef<HTMLImageElement | null>(null);
  const playlistIndexRef = useRef(0);
  const playlistAdvancingRef = useRef(false);
  const advancePlaylist = () => {
    if (el.kind !== 'imagePlaylist') return;
    const images: string[] = el.config.images ?? [];
    const node = playlistImgRef.current;
    if (images.length < 2 || !node || playlistAdvancingRef.current) return;
    const loop = el.config.loop ?? true;
    const nextIndex = playlistIndexRef.current + 1;
    if (nextIndex >= images.length && !loop) return; // stay on the last slide
    const targetIndex = nextIndex % images.length;
    const presetName = el.config.transitionPreset ?? 'fadeIn';
    const duration = el.config.transitionDuration ?? 0.6;
    const ease = el.config.transitionEase ?? 'power2.inOut';
    const outCfg = OUT_PRESETS[presetName] ?? OUT_PRESETS.fadeOut;
    const inCfg = PRESETS[presetName] ?? PRESETS.fadeIn;
    playlistAdvancingRef.current = true;
    gsap.killTweensOf(node);
    gsap.to(node, {
      ...outCfg, duration, ease,
      onComplete: () => {
        playlistIndexRef.current = targetIndex;
        node.src = resolveImageUrl(images[targetIndex]);
        // Same clearProps reset playIn() uses above — this slide's own
        // "out" half just left transform/filter/clipPath at ITS ending
        // values; wiping them back to the plain CSS rest state is what lets
        // the "in" half's .fromTo() below tween INTO a clean identity
        // rather than whatever the out preset happened to leave behind.
        gsap.set(node, { clearProps: 'opacity,transform,filter,clipPath' });
        gsap.fromTo(node, { ...inCfg }, {
          opacity: 1, x: 0, y: 0, z: 0, scale: 1, scaleX: 1, scaleY: 1,
          rotation: 0, rotationX: 0, rotationY: 0, skewX: 0, skewY: 0,
          filter: 'blur(0px)', clipPath: 'inset(0% 0% 0% 0%)',
          duration, ease,
          onComplete: () => { playlistAdvancingRef.current = false; },
        });
      },
    });
  };
  // Always call the LATEST closure — registerReliableTick below only
  // re-registers when the deps array actually changes (slideDuration/
  // advanceMode/image count), so without this a change to just the
  // transition preset/duration/ease/loop mid-playback would keep firing a
  // stale advancePlaylist that still uses the old values.
  const advancePlaylistRef = useRef(advancePlaylist);
  advancePlaylistRef.current = advancePlaylist;
  const playlistImages: string[] = el.kind === 'imagePlaylist' ? (el.config.images ?? []) : [];
  useEffect(() => {
    if (el.kind !== 'imagePlaylist') return;
    if ((el.config.advanceMode ?? 'auto') !== 'auto') return;
    if (playlistImages.length < 2) return;
    // registerReliableTick, not a plain setInterval — a CG output window is
    // exactly the kind of "must never silently stop just because this
    // window lost focus/is backgrounded" broadcast timing this app already
    // treats as critical everywhere else (see customTimerTickSync.ts's
    // identical reasoning).
    const ms = Math.max(500, (el.config.slideDuration ?? 4) * 1000);
    return registerReliableTick(`imagePlaylist:${el.id}:${tickInstanceIdRef.current}`, ms, () => advancePlaylistRef.current());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el.kind, el.id, el.config.advanceMode, el.config.slideDuration, playlistImages.length]);
  // Manual mode — advances only on the same continueSignal bump CG
  // Playout's "Next Stage" already drives for the whole-template Steps
  // system (see CgTemplateWidget's own dispatcher above); skips its own
  // first firing for the identical reason that one does — continueSignal is
  // already whatever it was by the time this element first mounts, so
  // without this an element mounting mid-session would immediately advance
  // once on mount.
  const skipFirstPlaylistContinueRef = useRef(true);
  useEffect(() => {
    if (el.kind !== 'imagePlaylist') return;
    if (continueSignal === undefined) return;
    // Consumed unconditionally on this effect's very first firing,
    // regardless of advanceMode at the time — an element that mounts in
    // 'auto' mode and only later switches to 'manual' must still have this
    // flag already spent by then, or the FIRST real bump after switching
    // would be silently swallowed as if it were the mount-time firing.
    if (skipFirstPlaylistContinueRef.current) { skipFirstPlaylistContinueRef.current = false; return; }
    if ((el.config.advanceMode ?? 'auto') !== 'manual') return;
    advancePlaylistRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continueSignal]);

  // 'cardCarousel' — see types/canvas.ts's own doc on this kind. Each card
  // is a whole separate template, rendered via a nested CgTemplateWidget
  // (below); THIS element's own job is purely the coverflow layout math and
  // the advance driver — mirrors 'imagePlaylist's own auto-timer/manual-
  // continueSignal pattern almost exactly (see its own comments just above
  // for the "why" of each piece), just re-tweening every visible card's
  // position/scale/rotation/opacity instead of crossfading one <img>.
  const carouselCards: CgCarouselCard[] = el.kind === 'cardCarousel' ? (el.config.cards ?? []) : [];
  const carouselCardNodesRef = useRef<Record<string, HTMLDivElement | null>>({});
  const carouselActiveIndexRef = useRef(0);
  // Signed distance from the active card, shortest way around the ring when
  // looping (so index 0 and index n-1 are NEIGHBORS, not opposite ends) —
  // plain linear distance when not looping (nothing past the last slide to
  // wrap toward).
  const carouselOffsetFor = (i: number, activeIndex: number, n: number, loop: boolean): number => {
    let raw = i - activeIndex;
    if (loop && n > 0) {
      raw = ((raw % n) + n) % n;
      if (raw > n / 2) raw -= n;
    }
    return raw;
  };
  // Three looks, all sharing the SAME four tunables (Card Gap/Side Scale/
  // Side Rotation/Side Opacity) reinterpreted per style — one shared mental
  // model for the operator rather than a new set of fields per style:
  //  - 'coverflow': centered/full-size at offset 0, shrunk + 3D-tilted (Y
  //    axis) + faded the further from center, fully hidden beyond offset
  //    ±2 (parked just past the visible window so it can slide back in
  //    smoothly on the very next advance rather than popping). Card Gap =
  //    horizontal spacing.
  //  - 'stack': a fanned deck — cards behind the active one displace
  //    diagonally (small, flat Z-axis rotation, not a 3D tilt) and shrink/
  //    fade, same ±2 visible window as coverflow. Card Gap's own scale is
  //    capped (a fanned deck's own offset is always small regardless of how
  //    wide a coverflow using the same saved config might have been) so the
  //    same field reads sensibly whichever style is picked.
  //  - 'wheel': every card sits on a real ring (Card Gap = ring radius),
  //    angularly spaced by 360/cardCount, using each one's RAW (unwrapped)
  //    distance from the active index rather than carouselOffsetFor's
  //    shortest-path-around-the-loop distance — a ring's own layout IS the
  //    full 360° distribution, independent of whether advancing past the
  //    ends is allowed to wrap. depthT (0 at the very front, 1 at the very
  //    back of the ring) drives scale/opacity/z-depth continuously, so
  //    unlike the other two styles nothing needs an explicit visible-window
  //    cutoff — cards on the far side are just naturally tiny/transparent.
  const carouselLayoutFor = (offset: number, cardCount: number) => {
    const style = el.config.carouselStyle ?? 'coverflow';
    const gap = el.config.cardGap ?? 260;
    const sideScale = el.config.sideScale ?? 0.75;
    const sideRotation = el.config.sideRotation ?? 35;
    const sideOpacity = el.config.sideOpacity ?? 0.6;
    const abs = Math.abs(offset);
    const dir = Math.sign(offset);

    if (style === 'wheel') {
      const step = cardCount > 0 ? 360 / cardCount : 0;
      const angle = offset * step;
      const rad = (angle * Math.PI) / 180;
      const depthT = (1 - Math.cos(rad)) / 2; // 0 at front, 1 at the far back
      return {
        x: Math.sin(rad) * gap, y: 0, z: gap * (Math.cos(rad) - 1),
        scale: 1 - depthT * (1 - sideScale), rotation: 0, rotationY: -angle,
        opacity: 1 - depthT * (1 - sideOpacity), zIndex: Math.round(100 - depthT * 90),
      };
    }

    if (style === 'stack') {
      if (abs === 0) return { x: 0, y: 0, z: 0, scale: 1, rotation: 0, rotationY: 0, opacity: 1, zIndex: 100 };
      const fanUnit = Math.min(gap, 200) * 0.12;
      if (abs > 2) return { x: dir * fanUnit * 3, y: fanUnit * 2.4, z: 0, scale: sideScale * 0.7, rotation: dir * sideRotation * 0.54, rotationY: 0, opacity: 0, zIndex: 10 };
      const reach = abs === 1 ? 1 : 1.8;
      const scale = abs === 1 ? sideScale : sideScale * 0.85;
      const opacity = abs === 1 ? sideOpacity : sideOpacity * 0.5;
      return { x: dir * fanUnit * reach, y: fanUnit * reach * 0.8, z: 0, scale, rotation: dir * sideRotation * 0.3 * reach, rotationY: 0, opacity, zIndex: 100 - abs * 25 };
    }

    // 'coverflow' (default)
    if (abs === 0) return { x: 0, y: 0, z: 0, scale: 1, rotation: 0, rotationY: 0, opacity: 1, zIndex: 100 };
    if (abs > 2) return { x: dir * gap * 2.4, y: 0, z: 0, scale: sideScale * 0.7, rotation: 0, rotationY: -dir * sideRotation, opacity: 0, zIndex: 10 };
    const reach = abs === 1 ? 1 : 1.8;
    const scale = abs === 1 ? sideScale : sideScale * 0.85;
    const opacity = abs === 1 ? sideOpacity : sideOpacity * 0.5;
    return { x: dir * gap * reach, y: 0, z: 0, scale, rotation: 0, rotationY: -dir * sideRotation, opacity, zIndex: 100 - abs * 25 };
  };
  const layoutCarousel = (instant: boolean) => {
    const n = carouselCards.length;
    const loop = el.config.loop ?? true;
    const style = el.config.carouselStyle ?? 'coverflow';
    carouselCards.forEach((card, i) => {
      const node = carouselCardNodesRef.current[card.id];
      if (!node) return;
      const offset = style === 'wheel' ? (i - carouselActiveIndexRef.current) : carouselOffsetFor(i, carouselActiveIndexRef.current, n, loop);
      const layout = carouselLayoutFor(offset, n);
      const vars = { xPercent: -50, yPercent: -50, x: layout.x, y: layout.y, z: layout.z, scale: layout.scale, rotation: layout.rotation, rotationY: layout.rotationY, opacity: layout.opacity, zIndex: layout.zIndex };
      if (instant) gsap.set(node, vars);
      else gsap.to(node, { ...vars, duration: el.config.transitionDuration ?? 0.6, ease: el.config.transitionEase ?? 'power2.inOut' });
    });
  };
  const advanceCarousel = () => {
    if (el.kind !== 'cardCarousel') return;
    const n = carouselCards.length;
    if (n < 2) return;
    const loop = el.config.loop ?? true;
    const next = carouselActiveIndexRef.current + 1;
    if (next >= n && !loop) return;
    carouselActiveIndexRef.current = next % n;
    layoutCarousel(false);
  };
  const advanceCarouselRef = useRef(advanceCarousel);
  advanceCarouselRef.current = advanceCarousel;
  // Instant (re)layout whenever the card list or any layout-affecting field
  // changes — e.g. an operator dragging the "Card Gap"/"Side Scale" sliders
  // in the inspector sees the result immediately, not just on the next
  // advance. Ref callbacks (below) attach before layout effects run, so
  // carouselCardNodesRef is already populated the first time this fires.
  useLayoutEffect(() => {
    if (el.kind !== 'cardCarousel') return;
    layoutCarousel(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el.kind, carouselCards.length, el.config.cardGap, el.config.sideScale, el.config.sideRotation, el.config.sideOpacity, el.config.loop, el.config.carouselStyle]);
  useEffect(() => {
    if (el.kind !== 'cardCarousel') return;
    if ((el.config.advanceMode ?? 'auto') !== 'auto') return;
    if (carouselCards.length < 2) return;
    const ms = Math.max(500, (el.config.slideDuration ?? 4) * 1000);
    return registerReliableTick(`cardCarousel:${el.id}:${tickInstanceIdRef.current}`, ms, () => advanceCarouselRef.current());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el.kind, el.id, el.config.advanceMode, el.config.slideDuration, carouselCards.length]);
  const skipFirstCarouselContinueRef = useRef(true);
  useEffect(() => {
    if (el.kind !== 'cardCarousel') return;
    if (continueSignal === undefined) return;
    if (skipFirstCarouselContinueRef.current) { skipFirstCarouselContinueRef.current = false; return; }
    if ((el.config.advanceMode ?? 'auto') !== 'manual') return;
    advanceCarouselRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continueSignal]);

  // 'matchSchedule' — see types/canvas.ts's own doc comment on this kind
  // and lib/matchScheduleRow.ts for the full recipe. Hook called
  // UNCONDITIONALLY (same "always call, only use the result for the right
  // kind" convention as every other per-kind hook here — see
  // useMatchScheduleData's own doc comment) with tournamentId/group simply
  // undefined (⇒ every match, unfiltered) for any non-matchSchedule element.
  const matchScheduleData = useMatchScheduleData(el.config.tournamentId, el.config.group);
  const [matchSchedulePageIndex, setMatchSchedulePageIndex] = useState(el.config.pageIndex ?? 0);
  const advanceMatchSchedulePage = () => {
    const pageCount = matchSchedulePageCount(matchScheduleData.matches.length, el.config.rowsPerPage ?? 4);
    setMatchSchedulePageIndex((i: number) => {
      const loop = el.config.loop ?? true;
      const next = i + 1;
      if (next >= pageCount) return loop ? 0 : i;
      return next;
    });
  };
  const advanceMatchScheduleRef = useRef(advanceMatchSchedulePage);
  advanceMatchScheduleRef.current = advanceMatchSchedulePage;
  useEffect(() => {
    if (el.kind !== 'matchSchedule') return;
    if ((el.config.advanceMode ?? 'manual') !== 'auto') return;
    const pageCount = matchSchedulePageCount(matchScheduleData.matches.length, el.config.rowsPerPage ?? 4);
    if (pageCount < 2) return;
    const ms = Math.max(1000, (el.config.pageDurationSec ?? 8) * 1000);
    return registerReliableTick(`matchSchedule:${el.id}:${tickInstanceIdRef.current}`, ms, () => advanceMatchScheduleRef.current());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el.kind, el.id, el.config.advanceMode, el.config.pageDurationSec, el.config.loop, el.config.rowsPerPage, matchScheduleData.matches.length]);
  const skipFirstMatchScheduleContinueRef = useRef(true);
  useEffect(() => {
    if (el.kind !== 'matchSchedule') return;
    if (continueSignal === undefined) return;
    if (skipFirstMatchScheduleContinueRef.current) { skipFirstMatchScheduleContinueRef.current = false; return; }
    if ((el.config.advanceMode ?? 'manual') !== 'manual') return;
    advanceMatchScheduleRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continueSignal]);

  // 'standings' — see types/canvas.ts's own doc comment and
  // lib/standingsRow.ts. Mirrors 'matchSchedule' 's own hook/pagination
  // block above exactly, just over rank rows instead of fixtures.
  const standingsData = useStandingsData(el.config.tournamentId, el.config.group, el.config.category);
  const [standingsPageIndex, setStandingsPageIndex] = useState(el.config.pageIndex ?? 0);
  const advanceStandingsPage = () => {
    const pageCount = standingsPageCount(standingsData.rows.length, el.config.rowsPerPage ?? 8);
    setStandingsPageIndex((i: number) => {
      const loop = el.config.loop ?? true;
      const next = i + 1;
      if (next >= pageCount) return loop ? 0 : i;
      return next;
    });
  };
  const advanceStandingsRef = useRef(advanceStandingsPage);
  advanceStandingsRef.current = advanceStandingsPage;
  useEffect(() => {
    if (el.kind !== 'standings') return;
    if ((el.config.advanceMode ?? 'manual') !== 'auto') return;
    const pageCount = standingsPageCount(standingsData.rows.length, el.config.rowsPerPage ?? 8);
    if (pageCount < 2) return;
    const ms = Math.max(1000, (el.config.pageDurationSec ?? 8) * 1000);
    return registerReliableTick(`standings:${el.id}:${tickInstanceIdRef.current}`, ms, () => advanceStandingsRef.current());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el.kind, el.id, el.config.advanceMode, el.config.pageDurationSec, el.config.loop, el.config.rowsPerPage, standingsData.rows.length]);
  const skipFirstStandingsContinueRef = useRef(true);
  useEffect(() => {
    if (el.kind !== 'standings') return;
    if (continueSignal === undefined) return;
    if (skipFirstStandingsContinueRef.current) { skipFirstStandingsContinueRef.current = false; return; }
    if ((el.config.advanceMode ?? 'manual') !== 'manual') return;
    advanceStandingsRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continueSignal]);

  // 'bracket' — see types/canvas.ts's own doc comment and
  // lib/bracketRow.ts. No pagination (a whole bracket renders as columns
  // at once), so just the one data hook, same unconditional-call convention.
  const bracketData = useBracketData(el.config.tournamentId, el.config.category, el.config.tier);

  // 'lightSweep' effect (any kind) — see types/canvas.ts's CgEffect doc and
  // lib/cgEffects.ts's buildLightSweepGeometry/lib/useLightSweep.ts for why
  // this is its own overlay rather than part of the `filter` composition.
  const lightSweepEffect = findLightSweep(el.config.effects);
  const sweepGeom = lightSweepEffect ? buildLightSweepGeometry(lightSweepEffect, el.w, el.h) : null;
  const sweepBandRef = useRef<HTMLDivElement | null>(null);
  useLightSweep(!!lightSweepEffect, sweepBandRef, sweepGeom?.distance ?? 0, lightSweepEffect?.duration ?? 1.4, lightSweepEffect?.gap ?? 2.5);

  // 'stroke' effect (any kind) — see types/canvas.ts's CgEffect doc and
  // lib/cgEffects.ts's buildStrokeGeometry/lib/useRunningStroke.ts for why
  // this is its own SVG overlay rather than part of the `filter`
  // composition. Rendered as a sibling inside the SAME filter-bearing
  // wrapper this element's own dropShadow/glow (elsewhere in this same
  // effects stack) already get, so those automatically wrap around it,
  // gap included — see effectWrapperRefs/needsWrapper further down.
  const strokeEffect = findStroke(el.config.effects) ?? null;
  const strokeGeom = strokeEffect
    ? buildStrokeGeometry(strokeEffect, el.w, el.h, el.kind === 'shape', el.config.d, el.config.viewBox, el.config.borderRadius)
    : null;
  // Typed as the shared SVGGeometryElement base (both <path> and <rect>
  // implement it, incl. getTotalLength/setAttribute, which is all this
  // ref's own consumer — useRunningStroke — actually calls) since only ONE
  // of the two ever renders per element instance depending on `el.kind` —
  // see the JSX below, which assigns this ref via a plain callback (an
  // upcast, always valid) rather than the `ref={strokeNodeRef}` object
  // form, which React types invariantly per concrete element and would
  // reject either JSX tag no matter which one this were typed for instead.
  const strokeNodeRef = useRef<SVGGeometryElement | null>(null);
  useRunningStroke(strokeEffect, strokeNodeRef);
  const strokeGlowFilter = strokeEffect ? buildStrokeGlowFilter(strokeEffect) : '';

  // 'glass' family (glass/fractalGlass/crystalGlass/liquidGlass, any kind)
  // — see types/canvas.ts's CgEffect doc and lib/cgEffects.ts's
  // buildGlassStyle for why this is applied as its own set of inline style
  // properties (backdrop-filter/background/box-shadow) rather than part of
  // the `filter` composition, and buildGlassEdgeStyle for the two masked
  // border overlays rendered alongside it below. fractalGlass additionally
  // replaces the chrome's own flat tint with a ridge/fluting pattern +
  // blend mode (fractalRidge, below — see buildFractalGlassRidgeStyle's own
  // doc comment for the recipe); crystalGlass additionally gets its own
  // facet overlay (crystalFacet, below); liquidGlass additionally appends
  // its own chromatic-aberration `<filter>` reference (built further down,
  // once displayedValue/fitFontSize are available — see this component's
  // own liquidGlassMapSvg below) to the shared backdropFilter string.
  const glassEffect = findGlass(el.config.effects);
  const liquidGlassApplies = glassEffect?.type === 'liquidGlass' && el.kind === 'text' && !el.config.fontFamily;
  const liquidGlassFilterUrl = liquidGlassApplies ? `url(#${instanceId}-liquidglass-${el.id})` : undefined;
  const glassStyle = glassEffect ? buildGlassStyle(glassEffect, liquidGlassFilterUrl) : null;
  const glassEdge = glassEffect ? buildGlassEdgeStyle(glassEffect) : null;
  const fractalRidge = glassEffect?.type === 'fractalGlass' ? buildFractalGlassRidgeStyle(glassEffect) : null;
  const crystalFacet = glassEffect?.type === 'crystalGlass' ? buildCrystalFacetStyle(glassEffect) : null;
  const rampMaskImage = glassEffect ? buildRampMaskImage(glassEffect) : undefined;

  // config.fontFamily ('text'/'ticker' only, but harmlessly inert — a no-op
  // — for every other kind since their own config never has this field) —
  // see lib/cgFonts.ts: a no-op for anything not in its own curated
  // GOOGLE_FONTS list (a local/system font name needs no loading at all).
  useEffect(() => { ensureGoogleFontLoaded(el.config.fontFamily); }, [el.config.fontFamily]);

  // config.changeAnim — a brief transition on this element's OWN displayed
  // value (resolved text, or image URL) whenever it changes WHILE already
  // mounted, instead of the new value just snapping in silently. Distinct
  // from (and independent of) the in/loop/out timelines: those replay a
  // whole entrance/idle/exit, this reacts to an ordinary content update
  // (cgPlayoutStore's updateLayer dataPatch, or a binding's live source
  // value ticking over) at any point during playback — a live score
  // changing, a name swapping in. Also called unconditionally (same
  // reasoning as textRef/fitFontSize above) — liveValue is undefined for
  // every kind but 'text'/'image', so the effect below is simply inert for
  // the rest. `displayedValue` (not the live target) is what actually
  // renders below, so the fall-out half genuinely finishes showing the OLD
  // value before the swap, rather than React already having repainted the
  // new one underneath a still-fading node.
  const liveValue = el.kind === 'text' ? textContentForFit
    : el.kind === 'image' ? resolveImageUrl(el.binding ? resolveBindingValue(pages, el.binding) : (el.config.imageUrl ?? ''))
    : undefined;
  const [displayedValue, setDisplayedValue] = useState(liveValue);
  // On 'text'/'image', glass hugs the actual glyphs/opaque pixels instead
  // of its whole rectangular box — see cgEffects.ts's own doc comment on
  // why this needs a real CSS mask (every OTHER effect already follows an
  // element's real rendered shape for free via plain `filter`; glass's
  // backdrop-filter/background don't). `displayedValue` (not config.text/
  // imageUrl directly) so a live-bound value is what actually gets masked.
  // Text masking only when fontFamily is unset (this app's own plain
  // default) — see buildTextGlassMask's own doc comment: a custom font
  // can't be matched reliably (the mask can't see the page's loaded
  // fonts), so a text element using one instead gets glass as a plain
  // full-box card, same as any non-text kind — correct, not almost-right.
  const glassContentMask = !glassEffect ? null
    : el.kind === 'image' ? buildImageGlassMask(resolveImageUrl(displayedValue), el.config.objectFit)
    : el.kind === 'text' && !el.config.fontFamily ? buildTextGlassMask(displayedValue ?? '', el.w, el.h, { fontSize: fitFontSize, bold: el.config.bold, align: el.config.align, valign: el.config.valign })
    : null;
  // Merges the content-shape mask above with the ramp-fade mask (see
  // cgEffects.ts's combineGlassMasks) into the one set of mask-* properties
  // the chrome div below actually applies.
  const glassMask = combineGlassMasks(glassContentMask, rampMaskImage);
  // liquidGlass's own chromatic-aberration map — needs displayedValue/
  // fitFontSize, only available here (not at this component's own
  // top-level, where every other per-element <filter> def lives), so this
  // one <filter> is rendered as a small local <svg> sibling further down
  // instead — see cgEffects.ts's buildLiquidGlassMapSvg's own doc comment.
  const liquidGlassProps = liquidGlassApplies ? buildLiquidGlassFilterProps(glassEffect!) : null;
  const liquidGlassMapSvg = liquidGlassApplies
    ? buildLiquidGlassMapSvg(displayedValue ?? '', el.w, el.h, { fontSize: fitFontSize, bold: el.config.bold, align: el.config.align, valign: el.config.valign }, liquidGlassProps!.mapBlur)
    : null;
  // Same idea, for 'lightSweep' — its own moving highlight band (rendered
  // below as a plain `position:absolute;inset:0` sibling, same reason
  // glass's own chrome needs to be a sibling rather than nested) was
  // painting across this element's WHOLE rectangular box regardless of
  // kind, which for 'text'/an image with real transparency reads as "a box
  // lighting up", not "the actual letters/opaque pixels shimmering" — the
  // exact bug report this fixes. Computed independently of glassMask (only
  // built when its OWN effect, lightSweep, is actually present) even
  // though both ultimately call the same buildTextGlassMask/
  // buildImageGlassMask — an element can have Glass and Light Sweep
  // together, each needing its own mask applied to its own overlay node.
  const sweepMask = !lightSweepEffect ? null
    : el.kind === 'image' ? buildImageGlassMask(resolveImageUrl(displayedValue), el.config.objectFit)
    : el.kind === 'text' && !el.config.fontFamily ? buildTextGlassMask(displayedValue ?? '', el.w, el.h, { fontSize: fitFontSize, bold: el.config.bold, align: el.config.align, valign: el.config.valign })
    : null;
  // Same idea again, for 'animatedBg' — its own moving gradient/aurora/
  // color-ramp background (rendered below as a plain `position:absolute;
  // inset:0` sibling painted BEHIND everything else) was filling this
  // element's whole rectangular box regardless of kind, same bug glass/
  // lightSweep had before their own fixes above — on a text element it read
  // as "a box of moving color with letters floating on top", not "the
  // actual letters filled with moving color". Independent of glassMask/
  // sweepMask (only built when animatedBg itself is present) for the same
  // "each effect masks its own overlay" reasoning those two already have.
  const animatedBgMask = !animatedBgFx ? null
    : el.kind === 'image' ? buildImageGlassMask(resolveImageUrl(displayedValue), el.config.objectFit)
    : el.kind === 'text' && !el.config.fontFamily ? buildTextGlassMask(displayedValue ?? '', el.w, el.h, { fontSize: fitFontSize, bold: el.config.bold, align: el.config.align, valign: el.config.valign })
    : null;
  const prevLiveValueRef = useRef(liveValue);
  const changeAnimNodeRef = useRef<HTMLElement | null>(null);
  // config.changeAnim.perCharacter — 'text' only: when the old and new
  // values are the same length, animates ONLY the character(s) that
  // actually differ (each its own tiny node, via the exact same preset
  // builders), leaving every unchanged character sitting still — a real
  // scoreboard/clock reads as "one digit ticking over", not the whole
  // number replacing itself. See TemplateElementView's own per-character
  // render branch below, which is what populates this ref array (index i
  // -> that character's own span), and types/canvas.ts's CgChangeAnim.
  const charRefs = useRef<(HTMLElement | null)[]>([]);
  // config.changeAnim.preset === 'digitMorph' — one entry per character
  // position, each holding that position's own 7 segment <path> elements
  // (indexed the same order as lib/sevenSegment.ts's SEGMENT_NAMES). Unlike
  // charRefs above, these are never React-re-rendered after their initial
  // paint (see the render branch below's ref callback) — their own `d`
  // attribute is exclusively GSAP's to write from here on, the same
  // "never let a re-render for an unrelated reason stomp a GSAP-owned
  // property" discipline wrapperRef's own filter handling already follows.
  const segmentRefs = useRef<(SVGPathElement | null)[][]>([]);
  // config.changeAnim.preset === 'gooeyMorph' — two overlapping copies of
  // this text element's own glyphs (see the render branch below), each
  // GSAP-owned from here on (never re-derived from React state after
  // mount, same discipline segmentRefs' own `d` attribute already
  // follows) — `gooeyPrevRef` is a plain snapshot of the OUTGOING value,
  // written once per change and then only ever faded/blurred, never
  // re-rendered by React; `gooeyNextRef` shows the actual `displayedValue`
  // (so it stays correct even if a re-render happens for an unrelated
  // reason mid-transition), with GSAP only ever touching its opacity/
  // filter, never its text.
  const gooeyPrevRef = useRef<HTMLSpanElement | null>(null);
  const gooeyNextRef = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    if (liveValue === prevLiveValueRef.current) return;
    const previousValue = prevLiveValueRef.current;
    prevLiveValueRef.current = liveValue;
    const anim = el.changeAnim;
    if (!anim) { setDisplayedValue(liveValue); return; }

    // digitMorph — see lib/sevenSegment.ts's own doc comment on why this is
    // handled entirely separately from buildChangeTransition's generic
    // single-node dispatch below: it needs each changed digit POSITION's 7
    // segment paths individually, not one node. Same-length values only
    // (matching perCharEligible's own reasoning just below) — a length
    // change has no single-digit reading, so it just snaps straight to
    // plain-text rendering of the new value instead (see the render
    // branch's own isSevenSegmentDigit checks, which fall back to plain
    // text for anything this preset doesn't recognize).
    if (anim.preset === 'digitMorph' && el.kind === 'text'
      && typeof previousValue === 'string' && typeof liveValue === 'string'
      && previousValue.length === liveValue.length) {
      const prevStr = previousValue;
      const nextStr = liveValue;
      const dur = anim.duration || 0.4;
      for (let i = 0; i < nextStr.length; i++) {
        if (prevStr[i] === nextStr[i]) continue;
        if (!isSevenSegmentDigit(prevStr[i]) || !isSevenSegmentDigit(nextStr[i])) continue;
        const segEls = segmentRefs.current[i];
        if (!segEls) continue;
        SEGMENT_NAMES.forEach((name, segIdx) => {
          const pathEl = segEls[segIdx];
          if (!pathEl) return;
          const wasOn = DIGIT_SEGMENTS[prevStr[i]].includes(name);
          const isOn = DIGIT_SEGMENTS[nextStr[i]].includes(name);
          if (wasOn === isOn) return; // this segment's own state doesn't change — nothing to morph
          gsap.killTweensOf(pathEl);
          gsap.to(pathEl, { morphSVG: isOn ? SEGMENT_PATH_ON[name] : SEGMENT_PATH_OFF[name], duration: dur, ease: 'power2.inOut' });
        });
      }
      setDisplayedValue(liveValue);
      return;
    }

    // gooeyMorph — the classic "melting text" crossfade (see
    // cgEffects.ts's GOOEY_THRESHOLD_MATRIX doc comment for the full
    // recipe and why this needs two overlapping nodes instead of
    // buildChangeTransition's single-node hard swap). `previousValue`
    // being a real string (not the initial-mount `undefined`) is the same
    // guard every other branch here already has.
    if (anim.preset === 'gooeyMorph' && el.kind === 'text' && typeof previousValue === 'string' && typeof liveValue === 'string') {
      const prevNode = gooeyPrevRef.current;
      const nextNode = gooeyNextRef.current;
      if (!prevNode || !nextNode) { setDisplayedValue(liveValue); return; }
      gsap.killTweensOf([prevNode, nextNode]);
      // Snapshot the OUTGOING value directly onto the "prev" node — the
      // ONLY place this preset ever writes textContent by hand; `nextNode`
      // instead gets its text the ordinary React way, one line down.
      prevNode.textContent = previousValue;
      // Immediately, not at the end — unlike every OTHER preset's `onSwap`
      // (which fires at the transition's own midpoint/end), gooeyMorph
      // needs `displayedValue` (and therefore `nextNode`'s own rendered
      // text) to already BE the new value from frame one, since both
      // nodes are visible and animating in parallel rather than one being
      // hidden until the other finishes.
      setDisplayedValue(liveValue);
      const dur = Math.max(0.1, anim.duration || 1);
      const proxy = { t: 0.001 };
      gsap.to(proxy, {
        t: 1, duration: dur, ease: 'none',
        onUpdate: () => {
          const f = proxy.t;
          nextNode.style.filter = `blur(${Math.min(8 / f - 8, 100)}px)`;
          nextNode.style.opacity = `${Math.pow(f, 0.4)}`;
          const inv = Math.max(0.001, 1 - f);
          prevNode.style.filter = `blur(${Math.min(8 / inv - 8, 100)}px)`;
          prevNode.style.opacity = `${Math.pow(inv, 0.4)}`;
        },
        onComplete: () => {
          nextNode.style.filter = '';
          nextNode.style.opacity = '1';
          prevNode.style.filter = '';
          prevNode.style.opacity = '0';
        },
      });
      return;
    }

    // Gradient text's own single clip-path span can't sensibly be split
    // per-character (see the render branch below) — falls back to the
    // whole-string path just below regardless of the option being on.
    const isGradient = el.kind === 'text' && 'background' in resolveTextColorStyle(el.config.color, '#ffffff');
    const perCharEligible = el.kind === 'text' && anim.perCharacter && !isGradient
      && anim.preset !== 'typewriter' && anim.preset !== 'scramble'
      && typeof previousValue === 'string' && typeof liveValue === 'string'
      && previousValue.length === liveValue.length && previousValue.length > 0;

    if (perCharEligible) {
      const prevStr = previousValue as string;
      const nextStr = liveValue as string;
      const distance = Math.max(8, (el.config.fontSize ?? 14) * 0.6);
      const swapCharAt = (idx: number) => setDisplayedValue((cur: string | undefined) => {
        const arr = (typeof cur === 'string' ? cur : nextStr).split('');
        arr[idx] = nextStr[idx];
        return arr.join('');
      });
      for (let i = 0; i < nextStr.length; i++) {
        if (prevStr[i] === nextStr[i]) continue;
        const charNode = charRefs.current[i];
        // No ref for this position (shouldn't normally happen — the spans
        // are already rendering by the time a SUBSEQUENT change can fire):
        // swap it in directly rather than leaving that one character stuck
        // on its old value forever.
        if (!charNode) { swapCharAt(i); continue; }
        gsap.killTweensOf(charNode);
        buildChangeTransition(anim.preset, charNode, distance, anim.duration || 0.4, () => swapCharAt(i));
      }
      return;
    }

    const node = changeAnimNodeRef.current;
    if (!node) { setDisplayedValue(liveValue); return; }
    // Known, accepted limitation: this ad-hoc timeline isn't registered
    // with CgTemplateWidget.tsx's timelinesRef, so replaying "in" via
    // playIn()'s own clearProps reset while a change transition happens to
    // be mid-flight can produce one visibly stale frame before this timeline
    // finishes writing over it — narrow enough (an operator would need to
    // hit Play again in the exact instant a bound value ticks over) not to
    // be worth the cross-component plumbing a real fix needs.
    gsap.killTweensOf(node);
    const distance = Math.max(20, Math.max(el.w, el.h) * 0.2);
    // typewriter/scramble mutate node.textContent directly instead of
    // tweening a property — only meaningful for actual text, and only
    // possible when both the old and new values are real strings (not
    // undefined, which liveValue can be for kinds other than text/image).
    const textValues = el.kind === 'text' && typeof previousValue === 'string' && typeof liveValue === 'string'
      ? { from: previousValue, to: liveValue } : undefined;
    buildChangeTransition(anim.preset, node, distance, anim.duration || 0.4, () => setDisplayedValue(liveValue), textValues);
  }, [liveValue]);

  // Also called unconditionally (same reasoning as textRef above) — this is
  // the effects-filter wrapper's own ref, kept LOCAL to this component (in
  // addition to being reported up via registerEffectWrapperById) so a real
  // useLayoutEffect, gated on React's own [filterStr] dependency comparison,
  // can own resetting its static value — the previous approach (an inline
  // ref-callback re-checking a hand-rolled "did this change" flag on every
  // render) relied on ref-callback re-invocation semantics that, while
  // correct in this React version, are far easier to get subtly wrong than
  // just letting React's own effect-dependency diffing do it. Runs whenever
  // `filterStr` (the STATIC, config-derived value) genuinely changes —
  // never on an unrelated re-render — so it can never stomp GSAP's own live
  // writes to the same property mid-tween (see buildEffectKeyframeTracks).
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (wrapperRef.current) wrapperRef.current.style.filter = filterStr || '';
  }, [filterStr]);

  // Position style: when wrapped, the outer div below owns the canvas
  // position/size and this fills it (100%); otherwise (the common case)
  // this owns its own absolute canvas position directly, exactly as always.
  // Static (non-animated) 3D pose — see canvas.ts's own doc comment on
  // config.staticRotateX/Y/Z/staticTranslateZ. Applied here (not via GSAP)
  // so it's always in effect, entrance animation or not — a 3D Box
  // template's own faces need to look like a real box at rest, not just
  // while some "in" animation happens to be mid-flight.
  //
  // When wrapped (this element has its own children), this does NOT go on
  // fillStyle/refdNode below — refdNode is only this element's OWN visual
  // content; its children render as a SEPARATE sibling (renderChildren(),
  // further down) under the shared OUTER box, never as refdNode's own DOM
  // descendants. Posing refdNode alone would rotate/push only this
  // element's own fill, leaving every child exactly where it was — visibly
  // wrong for a 3D Box's own container, whose whole point is posing itself
  // AND its 6 faces together. Applied to the OUTER box instead (below,
  // where scene3DStyle also lives) so it actually carries everything inside
  // it, itself included. A LEAF element (no children) has no such split —
  // its outer box and refdNode are the exact same node (see the
  // `!needsWrapper` early return below) — so fillStyle keeps it directly.
  const staticTransform3D = buildStaticTransform3D(el.config, children.length > 0);
  const fillStyle: React.CSSProperties = needsWrapper
    ? { position: 'absolute', inset: 0 }
    : { position: 'absolute', left: el.x, top: el.y, width: el.w, height: el.h, transform: staticTransform3D };

  let refdNode: React.ReactNode;

  if (el.kind === 'rect') {
    refdNode = (
      <div ref={registerRef} style={{
        ...fillStyle,
        background: resolveBackground(el.config.fill, '#000000'),
        opacity: el.config.opacity ?? 1,
        borderRadius: el.config.borderRadius ?? 0,
        // Inset, not a CSS `border` — a border adds to the box's own
        // footprint (even with box-sizing:border-box it visually eats into
        // the fill rather than sitting cleanly on the edge the way an SVG
        // shape's stroke does) and doesn't follow borderRadius as cleanly.
        // An inset box-shadow paints a solid ring precisely along the box's
        // already-rounded edge with zero layout impact.
        boxShadow: el.config.strokeWidth ? `inset 0 0 0 ${el.config.strokeWidth}px ${el.config.stroke ?? '#000000'}` : undefined,
      }} />
    );
  } else if (el.kind === 'shape') {
    const { fill: shapeFill, defs: shapeFillDefs } = resolveSvgFill(el.config.fill, `shapefill-${el.id}`, '#ffffff');
    refdNode = (
      <svg ref={registerRef as any} viewBox={el.config.viewBox ?? '0 0 100 100'} style={fillStyle}>
        {shapeFillDefs && <defs>{shapeFillDefs}</defs>}
        <path d={el.config.d ?? ''} fill={shapeFill} stroke={el.config.stroke ?? 'none'} strokeWidth={el.config.strokeWidth ?? 0} />
      </svg>
    );
  } else if (el.kind === 'sequence') {
    const frames: string[] = el.config.frames ?? [];
    const fit = el.config.objectFit ?? 'cover';
    const looping = !!el.config.loop;
    const layerStyle: React.CSSProperties = { position: 'absolute', inset: 0, backgroundSize: fit, backgroundPosition: 'center', backgroundRepeat: 'no-repeat' };
    refdNode = (
      <div ref={registerRef} style={fillStyle}>
        {looping ? (
          // Double-buffered — see lib/useSequenceLoop.ts's own doc comment.
          // Neither layer gets a React-rendered backgroundImage: the hook
          // owns both EXCLUSIVELY from the moment they mount (an earlier,
          // single-layer version of this let React's own re-renders fight
          // the hook's imperative writes, producing a visible blink back to
          // frame 1 — same risk here if either layer's style tried to set
          // backgroundImage too).
          <>
            <div ref={seqLayerARef} style={layerStyle} />
            <div ref={seqLayerBRef} style={layerStyle} />
          </>
        ) : (
          // Quoted url(...) — an unquoted CSS url() can't contain
          // whitespace, and broadcast-graphics frame filenames (exported
          // from After Effects/etc.) commonly have spaces; unquoted, the
          // whole declaration was silently invalid and nothing painted.
          <div style={{ ...layerStyle, backgroundImage: frames[0] ? `url("${resolveImageUrl(frames[0])}")` : undefined }} />
        )}
        {!frames.length && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#888', padding: 4 }}>
            <ImageIcon size={12} strokeWidth={2} /> No frames
          </span>
        )}
        {/* A HEAD-START batch of frames is preloaded before the loop starts
           ticking (see useSequenceLoop.ts's own doc comment on why) — this
           explicit placeholder is what shows during that brief window
           instead of a blank hole, which otherwise looked like the image
           had simply gone missing rather than "still loading". */}
        {sequenceLoading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)' }}>
            <Loader2 size={Math.min(28, Math.max(14, el.w * 0.08))} strokeWidth={2} color="#fff" style={{ animation: 'spin 0.7s linear infinite' }} />
          </div>
        )}
      </div>
    );
  } else if (el.kind === 'ticker') {
    const gap = el.config.gap ?? 80;
    refdNode = (
      <div ref={registerRef} style={{ ...fillStyle, overflow: 'hidden', background: resolveBackground(el.config.bgColor, 'transparent'), display: 'flex', alignItems: 'center' }}>
        <div ref={tickerTrackRef} style={{ display: 'flex', whiteSpace: 'nowrap', willChange: 'transform' }}>
          {Array.from({ length: tickerRepeats }, (_, i) => (
            <span
              key={i}
              ref={i === 0 ? tickerUnitRef : undefined}
              style={{ display: 'inline-block', paddingRight: gap, fontSize: (el.config.fontSize ?? 32) + 'px', fontFamily: fontFamilyCss(el.config.fontFamily), color: el.config.color ?? '#ffffff', fontWeight: el.config.bold ? 700 : 400, flexShrink: 0 }}
            >
              {tickerText}
            </span>
          ))}
        </div>
      </div>
    );
  } else if (el.kind === 'statbar') {
    const fontSize = el.config.fontSize ?? 20;
    const barHeight = el.config.barHeight ?? 24;
    const barRadius = el.config.barRadius ?? barHeight / 2;
    const trackColor = el.config.trackColor ?? '#333333';
    const separatorColor = el.config.separatorColor ?? '#444444';
    const showSeparators = el.config.showSeparators ?? true;
    const isPercent = (el.config.valueFormat ?? 'percent') === 'percent';
    refdNode = (
      <div ref={registerRef} style={{ ...fillStyle, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10, fontFamily: fontFamilyCss(el.config.fontFamily) }}>
        {statbarRows.map((row, i) => {
          const { valueA, valueB, pctA } = statbarRowValues[i];
          const colorA = row.colorA ?? '#e74c3c';
          const colorB = row.colorB ?? '#3498db';
          // Value-label text color: the solid case only — a gradient bar
          // fill (resolveBackground, below) reads fine on the bar segment
          // itself, but plain `color` has no gradient equivalent without
          // the separate background-clip:text treatment 'text' elements use
          // (resolveTextColorStyle) — not worth pulling in here for a
          // couple of small numeric labels, so a gradient row color just
          // falls back to the same plain default the label would show if
          // colorA/colorB were never set at all.
          const labelColorA = typeof colorA === 'string' ? colorA : '#e74c3c';
          const labelColorB = typeof colorB === 'string' ? colorB : '#3498db';
          // labelB is 100 - the ROUNDED labelA, not independently rounded —
          // rounding each side's own raw percentage separately (the
          // pre-multi-row version of this did) can drift by 1 on a .5
          // split (e.g. 37.5/62.5 -> "38%"/"63%", summing to 101 instead of
          // a clean 100), which reads as a math error to anyone doing the
          // addition. The bar segments' own WIDTHS still always split by
          // the true raw ratio either way — only these two text labels are
          // coupled like this.
          const roundedA = Math.round(pctA);
          const labelA = isPercent ? `${roundedA}%` : String(Math.round(valueA));
          const labelB = isPercent ? `${100 - roundedA}%` : String(Math.round(valueB));
          return (
            <div key={row.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {i > 0 && showSeparators && <div style={{ height: 1, background: separatorColor }} />}
              {(el.config.showLabel ?? true) && row.label && (
                <div style={{ textAlign: 'center', fontSize, color: el.config.labelColor ?? '#ffffff', fontWeight: 700 }}>{row.label}</div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {(el.config.showValues ?? true) && (
                  <span style={{ fontSize, color: labelColorA, fontWeight: 700, minWidth: fontSize * 2, textAlign: 'right' }}>{labelA}</span>
                )}
                <div style={{ flex: 1, height: barHeight, display: 'flex', borderRadius: barRadius, overflow: 'hidden', background: trackColor }}>
                  <div ref={(node) => { statbarNodesRef.current[row.id] = node; }} style={{ background: resolveBackground(colorA, '#e74c3c'), height: '100%' }} />
                  <div style={{ flex: 1, background: resolveBackground(colorB, '#3498db'), height: '100%' }} />
                </div>
                {(el.config.showValues ?? true) && (
                  <span style={{ fontSize, color: labelColorB, fontWeight: 700, minWidth: fontSize * 2, textAlign: 'left' }}>{labelB}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  } else if (el.kind === 'image') {
    const url = displayedValue;
    const fit: React.CSSProperties['objectFit'] = el.config.objectFit ?? 'contain';
    refdNode = (
      <div ref={(node) => { registerRef(node); changeAnimNodeRef.current = node; }} style={{ ...fillStyle, background: resolveBackground(el.config.bgColor, 'transparent') }}>
        {url ? (
          <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: fit }} draggable={false} />
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#888', padding: 4 }}>
            <ImageIcon size={12} strokeWidth={2} /> No image
          </span>
        )}
      </div>
    );
  } else if (el.kind === 'imagePlaylist') {
    const fit: React.CSSProperties['objectFit'] = el.config.objectFit ?? 'cover';
    const firstUrl = playlistImages[0] ? resolveImageUrl(playlistImages[0]) : '';
    refdNode = (
      <div ref={registerRef} style={{ ...fillStyle, background: resolveBackground(el.config.bgColor, 'transparent'), overflow: 'hidden' }}>
        {firstUrl ? (
          // src is only ever set here on this element's initial mount — from
          // that point on it's advancePlaylist's own DOM mutation exclusively
          // (see its own comment above), the same "React sets the initial
          // value, GSAP/imperative code owns it from then on" discipline
          // wrapperRef's filter and segmentRefs' `d` already follow. Plain
          // React reconciliation is safe here regardless (it diffs against
          // its OWN last-rendered value, not the live DOM), so no extra
          // ref-callback guard is needed the way segmentRefs' `d` needed one.
          <img ref={playlistImgRef} src={firstUrl} alt="" style={{ width: '100%', height: '100%', objectFit: fit }} draggable={false} />
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#888', padding: 4 }}>
            <ImageIcon size={12} strokeWidth={2} /> No images
          </span>
        )}
      </div>
    );
  } else if (el.kind === 'cardCarousel') {
    refdNode = (
      <div ref={registerRef} style={{ ...fillStyle, overflow: 'hidden', perspective: '1200px', transformStyle: 'preserve-3d' }}>
        {carouselCards.map((card, i) => {
          const cardWidget = card.templateId ? pages.flatMap((p) => p.widgets).find((w) => w.id === card.templateId) : undefined;
          const isCircular = !!card.templateId && ancestorTemplateIds.includes(card.templateId);
          return (
            <div
              key={card.id}
              ref={(node) => { carouselCardNodesRef.current[card.id] = node; }}
              data-carousel-card={card.id}
              style={{ position: 'absolute', left: '50%', top: '50%', willChange: 'transform, opacity' }}
            >
              {cardWidget && !isCircular ? (
                <CgTemplateWidget
                  config={applyCardOverrides(cardWidget.config, card, el.config.playlistImages ?? [], i)}
                  w={cardWidget.w}
                  h={cardWidget.h}
                  ancestorTemplateIds={[...ancestorTemplateIds, card.templateId!]}
                />
              ) : (
                <div style={{ width: 240, height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', color: '#888', fontSize: 11, textAlign: 'center', padding: 8 }}>
                  {isCircular ? 'Circular reference' : 'Pick a card style'}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  } else if (el.kind === 'nestedTemplate') {
    // "Precompose" — the AE-style "any composition can be a layer inside
    // any other composition" workflow, generalized from what was
    // previously only 'cardCarousel's own special case: this element
    // embeds ANOTHER whole CG Template Library entry, scaled to fit
    // (never upscaled) and centered within this element's own box, same
    // convention 'cardCarousel's card rendering already uses. Fully
    // self-contained playback — the nested template runs its own In/Loop/
    // Out independently, same as a real AE precomp keeps its own timeline.
    const nestedWidget = el.config.templateId ? pages.flatMap((p) => p.widgets).find((w) => w.id === el.config.templateId) : undefined;
    const isCircular = !!el.config.templateId && ancestorTemplateIds.includes(el.config.templateId);
    refdNode = (
      <div ref={registerRef} style={{ ...fillStyle, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {nestedWidget && !isCircular ? (
          <div style={{ width: nestedWidget.w, height: nestedWidget.h, transform: `scale(${Math.min(el.w / nestedWidget.w, el.h / nestedWidget.h, 1)})`, flexShrink: 0 }}>
            <CgTemplateWidget config={nestedWidget.config} w={nestedWidget.w} h={nestedWidget.h} ancestorTemplateIds={[...ancestorTemplateIds, el.config.templateId!]} />
          </div>
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', color: '#888', fontSize: 11, textAlign: 'center', padding: 8 }}>
            {isCircular ? 'Circular reference' : 'Pick a template'}
          </div>
        )}
      </div>
    );
  } else if (el.kind === 'matchSchedule') {
    // Paginated, live-bound fixture list — see types/canvas.ts's own doc
    // comment on this kind and lib/matchScheduleRow.ts for the full recipe.
    // Each row is an ordinary nested CG template (same recursion
    // 'cardCarousel'/'nestedTemplate' already use above), scaled to fit
    // this element's own width × `rowHeight` and stacked with `rowGap`
    // between them — a real static layout (not motion-driven the way
    // 'cardCarousel' is), since paging swaps in an entirely different set
    // of matches rather than repositioning the SAME always-mounted cards.
    const rowsPerPage = Math.max(1, el.config.rowsPerPage ?? 4);
    const rowHeight = el.config.rowHeight ?? 90;
    const rowGap = el.config.rowGap ?? 12;
    const pageMatches = paginateMatches(matchScheduleData.matches, rowsPerPage, matchSchedulePageIndex);
    refdNode = (
      <div ref={registerRef} style={{ ...fillStyle, overflow: 'hidden' }}>
        {pageMatches.length === 0 && (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', fontSize: 12 }}>No fixtures</div>
        )}
        {pageMatches.map((match, i) => {
          const status = matchScheduleData.getStatus(match);
          const score = matchScheduleData.getScore(match, status);
          const templateId = resolveRowTemplateId(el.config, match, status);
          const rowWidget = templateId ? pages.flatMap((p) => p.widgets).find((w) => w.id === templateId) : undefined;
          const isCircular = !!templateId && ancestorTemplateIds.includes(templateId);
          return (
            <div key={match.id} style={{ position: 'absolute', left: 0, top: i * (rowHeight + rowGap), width: '100%', height: rowHeight, overflow: 'hidden' }}>
              {rowWidget && !isCircular ? (
                <div style={{ width: rowWidget.w, height: rowWidget.h, transform: `scale(${Math.min(el.w / rowWidget.w, rowHeight / rowWidget.h, 1)})`, transformOrigin: 'top left' }}>
                  <CgTemplateWidget
                    config={buildMatchRowOverrides(rowWidget.config, match, status, score)}
                    w={rowWidget.w}
                    h={rowWidget.h}
                    ancestorTemplateIds={[...ancestorTemplateIds, templateId!]}
                  />
                </div>
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', color: '#888', fontSize: 11, textAlign: 'center', padding: 8 }}>
                  {isCircular ? 'Circular reference' : `Pick a ${status} row style`}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  } else if (el.kind === 'standings') {
    // Paginated, live-bound league/pool table — see types/canvas.ts's own
    // doc comment on this kind and lib/standingsRow.ts for the full recipe.
    // Mirrors the 'matchSchedule' branch above exactly, just over rank rows.
    const rowsPerPage = Math.max(1, el.config.rowsPerPage ?? 8);
    const rowHeight = el.config.rowHeight ?? 40;
    const rowGap = el.config.rowGap ?? 6;
    const pageRows = paginateStandings(standingsData.rows, rowsPerPage, standingsPageIndex);
    refdNode = (
      <div ref={registerRef} style={{ ...fillStyle, overflow: 'hidden' }}>
        {pageRows.length === 0 && (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', fontSize: 12 }}>No teams</div>
        )}
        {pageRows.map((row, i) => {
          const templateId = resolveStandingsRowTemplateId(el.config, row, standingsData.rows.length);
          const rowWidget = templateId ? pages.flatMap((p) => p.widgets).find((w) => w.id === templateId) : undefined;
          const isCircular = !!templateId && ancestorTemplateIds.includes(templateId);
          return (
            <div key={row.teamId} style={{ position: 'absolute', left: 0, top: i * (rowHeight + rowGap), width: '100%', height: rowHeight, overflow: 'hidden' }}>
              {rowWidget && !isCircular ? (
                <div style={{ width: rowWidget.w, height: rowWidget.h, transform: `scale(${Math.min(el.w / rowWidget.w, rowHeight / rowWidget.h, 1)})`, transformOrigin: 'top left' }}>
                  <CgTemplateWidget
                    config={buildStandingsRowOverrides(rowWidget.config, row)}
                    w={rowWidget.w}
                    h={rowWidget.h}
                    ancestorTemplateIds={[...ancestorTemplateIds, templateId!]}
                  />
                </div>
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', color: '#888', fontSize: 11, textAlign: 'center', padding: 8 }}>
                  {isCircular ? 'Circular reference' : 'Pick a row style'}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  } else if (el.kind === 'bracket') {
    // Live-bound knockout bracket, laid out in stage columns — see
    // types/canvas.ts's own doc comment on this kind and lib/bracketRow.ts
    // for the full recipe. A real static layout (no paging), one column
    // per stage, boxes stacked within each column.
    const boxWidth = el.config.boxWidth ?? 220;
    const boxHeight = el.config.boxHeight ?? 90;
    const columnGap = el.config.columnGap ?? 24;
    const boxGap = el.config.boxGap ?? 24;
    const columns = el.config.showThirdPlace && bracketData.thirdPlaceMatch
      ? [...bracketData.columns, { stage: '3rd Place', matches: [bracketData.thirdPlaceMatch] }]
      : bracketData.columns;
    refdNode = (
      <div ref={registerRef} style={{ ...fillStyle, overflow: 'hidden' }}>
        {columns.length === 0 && (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', fontSize: 12 }}>No knockout fixtures</div>
        )}
        {columns.map((col, ci) => (
          <div key={col.stage} style={{ position: 'absolute', left: ci * (boxWidth + columnGap), top: 0, width: boxWidth }}>
            {col.matches.map((match, mi) => {
              const status = bracketData.getStatus(match);
              const score = bracketData.getScore(match, status);
              const winnerSide = bracketData.getWinnerSide(match);
              const templateId = resolveBracketRowTemplateId(el.config, match, status);
              const rowWidget = templateId ? pages.flatMap((p) => p.widgets).find((w) => w.id === templateId) : undefined;
              const isCircular = !!templateId && ancestorTemplateIds.includes(templateId);
              return (
                <div key={match.id} style={{ position: 'absolute', left: 0, top: mi * (boxHeight + boxGap), width: boxWidth, height: boxHeight, overflow: 'hidden' }}>
                  {rowWidget && !isCircular ? (
                    <div style={{ width: rowWidget.w, height: rowWidget.h, transform: `scale(${Math.min(boxWidth / rowWidget.w, boxHeight / rowWidget.h, 1)})`, transformOrigin: 'top left' }}>
                      <CgTemplateWidget
                        config={buildBracketRowOverrides(rowWidget.config, match, status, score, winnerSide)}
                        w={rowWidget.w}
                        h={rowWidget.h}
                        ancestorTemplateIds={[...ancestorTemplateIds, templateId!]}
                      />
                    </div>
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', color: '#888', fontSize: 11, textAlign: 'center', padding: 8 }}>
                      {isCircular ? 'Circular reference' : `Pick a ${status} box style`}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  } else if (el.kind === 'credits') {
    const creditsStyle = creditsStyleFromConfig(el.config);
    const mode = el.config.mode ?? 'scroll';
    refdNode = mode === 'sequence' ? (
      <div ref={registerRef} style={{ ...fillStyle, overflow: 'hidden' }}>
        {creditsSections.map((section, i) => (
          <div
            key={section.id}
            ref={(node) => { creditsSectionRefs.current[i] = node; }}
            style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4%' }}
          >
            <CreditsSectionContent section={section} style={creditsStyle} />
          </div>
        ))}
      </div>
    ) : (
      <div ref={registerRef} style={{ ...fillStyle, overflow: 'hidden' }}>
        <div
          ref={creditsScrollRef}
          style={(el.config.scrollDirection ?? 'vertical') === 'horizontal' ? {
            position: 'absolute', top: 0, bottom: 0, display: 'flex', flexDirection: 'row', gap: creditsStyle.sectionGap,
            alignItems: 'center', padding: '4% 0',
          } : {
            position: 'absolute', left: 0, right: 0, display: 'flex', flexDirection: 'column', gap: creditsStyle.sectionGap,
            alignItems: creditsStyle.align === 'left' ? 'flex-start' : creditsStyle.align === 'right' ? 'flex-end' : 'center',
            padding: '0 4%',
          }}
        >
          {creditsSections.map((section) => <CreditsSectionContent key={section.id} section={section} style={creditsStyle} />)}
        </div>
      </div>
    );
  } else {
    // 'text'
    const content = displayedValue;
    const wordWrap = el.config.wordWrap ?? true;
    const valign = el.config.valign ?? 'middle';
    const gradientColor = resolveTextColorStyle(el.config.color, '#ffffff', el.config.colorOpacity);
    const isGradientText = 'background' in gradientColor;
    // Mirrors the effect above's OWN perCharEligible check exactly (same
    // conditions, gradient text and typewriter/scramble excluded) — always
    // rendered this way whenever the option is on, not just while a change
    // is actually in flight, so charRefs is already populated and ready
    // the moment the NEXT change happens instead of one render behind.
    const perCharMode = !!el.changeAnim?.perCharacter && !isGradientText
      && el.changeAnim.preset !== 'typewriter' && el.changeAnim.preset !== 'scramble';
    // digitMorph — see lib/sevenSegment.ts. A solid fill only (no gradient
    // support here — resolveSvgFill's own gradient-def machinery is a
    // reasonable follow-up, not worth the extra complexity for a first cut
    // of a preset already this narrow in scope); falls back to plain white
    // the same as everywhere else a color config could be a CgGradient
    // object instead of a string.
    const digitMorphMode = el.changeAnim?.preset === 'digitMorph';
    const gooeyMode = el.changeAnim?.preset === 'gooeyMorph';
    const digitMorphFill = hexToRgba(typeof el.config.color === 'string' ? el.config.color : '#ffffff', el.config.colorOpacity ?? 100);
    const digitH = fitFontSize * 1.05;
    const digitW = digitH * (SEVEN_SEG_WIDTH / SEVEN_SEG_HEIGHT);
    refdNode = (
      <div
        ref={(node) => { registerRef(node); textRef.current = node; changeAnimNodeRef.current = node; }}
        style={{
          ...fillStyle,
          fontSize: fitFontSize + 'px',
          fontFamily: fontFamilyCss(el.config.fontFamily),
          background: resolveBackground(el.config.bgColor, 'transparent'),
          ...(!isGradientText ? gradientColor : null),
          textAlign: el.config.align ?? 'center',
          fontWeight: el.config.bold ? 700 : 400,
          // WebKitTextStroke (not plain textStroke — no such unprefixed CSS
          // property, and WebKit/Safari, what this app's WKWebView actually
          // renders with, never needed one) is inherited, so setting it once
          // here reaches the per-character spans/gradient span below too —
          // no need to repeat it per-span.
          WebkitTextStroke: el.config.strokeWidth ? `${el.config.strokeWidth}px ${el.config.stroke ?? '#000000'}` : undefined,
          display: 'flex',
          alignItems: valign === 'top' ? 'flex-start' : valign === 'bottom' ? 'flex-end' : 'center',
          justifyContent: el.config.align === 'left' ? 'flex-start' : el.config.align === 'right' ? 'flex-end' : 'center',
          whiteSpace: wordWrap ? 'normal' : 'nowrap',
          overflowWrap: wordWrap ? 'break-word' : undefined,
          wordBreak: wordWrap ? 'break-word' : undefined,
          overflow: 'hidden',
        }}
      >
        {gooeyMode ? (
          // Two overlapping copies of this element's own glyphs — see the
          // value-change effect above (which owns their opacity/filter
          // from here on) and cgEffects.ts's GOOEY_THRESHOLD_MATRIX for why
          // this needs two nodes instead of the usual single one every
          // other changeAnim preset swaps in place. `position:absolute`
          // (not a second flex child) so both sit exactly on top of each
          // other rather than side by side; `alignItems`/`justifyContent:
          // 'inherit'` copies this wrapper's own centering so neither span
          // needs to duplicate it.
          <>
            <span ref={gooeyPrevRef} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'inherit', justifyContent: 'inherit' }} />
            <span ref={gooeyNextRef} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'inherit', justifyContent: 'inherit' }}>{content}</span>
          </>
        ) : digitMorphMode ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: digitW * 0.15 }}>
            {[...(content ?? '')].map((ch, i) => {
              if (isSevenSegmentDigit(ch)) {
                return (
                  <svg key={i} viewBox={SEVEN_SEG_VIEWBOX} width={digitW} height={digitH} style={{ flexShrink: 0, overflow: 'visible' }}>
                    {SEGMENT_NAMES.map((name, segIdx) => (
                      <path
                        key={name}
                        ref={(node) => {
                          if (!segmentRefs.current[i]) segmentRefs.current[i] = [];
                          segmentRefs.current[i][segIdx] = node;
                          // Set only once, on first mount for this node —
                          // every update after that is exclusively GSAP's
                          // own morphSVG tween (see the value-change effect
                          // above); re-deriving this from `ch` on every
                          // React re-render would stomp a live tween the
                          // instant displayedValue updates, snapping the
                          // segment straight to its end shape instead of
                          // morphing.
                          if (node && node.getAttribute('d') === null) node.setAttribute('d', segmentPathFor(name, ch));
                        }}
                        fill={digitMorphFill}
                      />
                    ))}
                  </svg>
                );
              }
              if (ch === ':') {
                const [top, bottom] = colonDotPaths();
                return (
                  <svg key={i} viewBox={SEVEN_SEG_VIEWBOX} width={digitW * 0.4} height={digitH} style={{ flexShrink: 0, overflow: 'visible' }}>
                    <path d={top} fill={digitMorphFill} />
                    <path d={bottom} fill={digitMorphFill} />
                  </svg>
                );
              }
              // Anything else this preset doesn't have a segment glyph for
              // (letters, other punctuation) — plain text, same size as the
              // element's own font, so a mixed "Score: 07" label still
              // reads fine with only the actual digits morphing.
              return <span key={i}>{ch === ' ' ? ' ' : ch}</span>;
            })}
          </span>
        ) : perCharMode ? (
          <span style={{ display: 'inline-block' }}>
            {[...(content ?? '')].map((ch, i) => (
              <span key={i} ref={(node) => { charRefs.current[i] = node; }} style={{ display: 'inline-block' }}>
                {ch === ' ' ? ' ' : ch}
              </span>
            ))}
          </span>
        ) : isGradientText ? <span style={gradientColor}>{content}</span> : content}
      </div>
    );
  }

  if (!needsWrapper) return <>{refdNode}</>;

  // config.scene3D — a shared 3D space for THIS element's own children
  // (rendered as siblings just below, via renderChildren()): perspective +
  // transform-style:preserve-3d go on their common PARENT (this outer box),
  // not on any one child, so each child's own rotationX/rotationY/z
  // (already keyframeable per-element — see cgPresets.ts's TRACK_PROPERTIES
  // — that part isn't new) composes correctly relative to its SIBLINGS
  // instead of each one rotating in its own isolated 3D space with no
  // visible depth relationship to the others. Without this, a grid of
  // child rects each keyframed with different rotationX/rotationY/z values
  // just looks like several flat, independently-tilted rectangles — WITH
  // it, they read as one real 3D scene, near/far children correctly
  // occluding each other and the whole group sharing one vanishing point.
  const scene3D = !!el.config.scene3D && children.length > 0;
  const scene3DStyle: React.CSSProperties = scene3D
    ? { perspective: `${el.config.scene3DPerspective ?? 800}px`, transformStyle: 'preserve-3d' }
    : {};

  return (
    <div
      ref={conditionsRef}
      style={{
        position: 'absolute', left: el.x, top: el.y, width: el.w, height: el.h, ...scene3DStyle, transform: staticTransform3D,
        // config.blendMode/clipToBounds — any kind, see TemplateElement's own
        // doc comment. Applied on this OUTERMOST per-element box (this
        // element's own content AND its children together, exactly like a
        // design tool's blend mode/"clip content" on a whole layer/group) —
        // not on the inner content-only node effects/filter use, which would
        // leave children unaffected instead.
        mixBlendMode: (el.config.blendMode && el.config.blendMode !== 'normal') ? el.config.blendMode : undefined,
        overflow: el.config.clipToBounds ? 'hidden' : undefined,
      }}
    >
      {/* 'animatedBg' — paints BEHIND everything else on this element
         (glass's own chrome included — a moving background AND a frosted
         glass panel on the same element is a legitimate combo: the glass
         genuinely blurs the moving pattern sitting behind it), same
         reasoning glass's own sibling-not-nested placement below has for
         needing its own independent compositing layer. */}
      {animatedBgStyleObj && (
        <div
          ref={animatedBgRef}
          style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            clipPath: hasMask ? `url(#${instanceId}-mask-${el.maskId})` : undefined,
            borderRadius: el.config.borderRadius,
            background: animatedBgStyleObj.background,
            backgroundSize: animatedBgStyleObj.backgroundSize,
            filter: animatedBgStyleObj.staticFilter,
            ...(animatedBgMask ? {
              WebkitMaskImage: animatedBgMask.maskImage, maskImage: animatedBgMask.maskImage,
              WebkitMaskSize: animatedBgMask.maskSize, maskSize: animatedBgMask.maskSize,
              WebkitMaskPosition: animatedBgMask.maskPosition, maskPosition: animatedBgMask.maskPosition,
              WebkitMaskRepeat: animatedBgMask.maskRepeat, maskRepeat: animatedBgMask.maskRepeat,
            } : null),
          }}
        />
      )}
      {/* liquidGlass's own chromatic-aberration <filter> — a small LOCAL
         defs block (unlike flagWave/bevel/rampblur's own shared top-level
         one) since it needs displayedValue/fitFontSize, only known at this
         per-element scope — see cgEffects.ts's buildLiquidGlassMapSvg's own
         doc comment. SVG id references resolve regardless of where in the
         document the <filter> physically lives, so this local def is
         referenced by the exact same `${instanceId}-liquidglass-${el.id}`
         url() above without issue. */}
      {liquidGlassMapSvg && liquidGlassProps && (
        <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
          <defs>
            <filter id={`${instanceId}-liquidglass-${el.id}`} primitiveUnits="objectBoundingBox" x="-0.2" y="-0.2" width="1.4" height="1.4">
              <feImage href={`data:image/svg+xml,${encodeURIComponent(liquidGlassMapSvg)}`} preserveAspectRatio="none" x="0" y="0" width="1" height="1" result="map" />
              <feGaussianBlur in="SourceGraphic" stdDeviation="0.01" result="blur" />
              <feColorMatrix in="blur" type="matrix" result="red_channel" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" />
              <feDisplacementMap in="red_channel" in2="map" scale={liquidGlassProps.scale} xChannelSelector="B" yChannelSelector="R" result="red_displaced" />
              <feColorMatrix in="blur" type="matrix" result="green_channel" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" />
              <feDisplacementMap in="green_channel" in2="map" scale={liquidGlassProps.scale} xChannelSelector="B" yChannelSelector="R" result="green_displaced" />
              <feColorMatrix in="blur" type="matrix" result="blue_channel" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" />
              <feDisplacementMap in="blue_channel" in2="map" scale={liquidGlassProps.scale} xChannelSelector="B" yChannelSelector="R" result="blue_displaced" />
              <feComposite in="red_displaced" in2="green_displaced" operator="arithmetic" k1={0} k2={1} k3={1} k4={0} result="rg_added" />
              <feComposite in="rg_added" in2="blue_displaced" operator="arithmetic" k1={0} k2={1} k3={1} k4={0} />
            </filter>
          </defs>
        </svg>
      )}
      {/* Glass's own blur/tint/shadow + two-tone edge highlight — rendered
         as a SIBLING of the filtered wrapper below, deliberately NOT nested
         inside it. `filter` on an ancestor establishes a new CSS stacking/
         "backdrop root" context that a descendant's `backdrop-filter` can't
         see past — so combining Glass with ANY other effect on the same
         element (Drop Shadow, Blur, Glow, …), which puts a real `filter`
         value on that wrapper, silently cut Glass off from whatever was
         actually behind THIS element, leaving it with nothing to blur and
         nowhere to composite its own translucency against — the actual
         "multiple effects together break" bug this fixes. Sibling of (not
         inside) the filtered node sidesteps that boundary entirely. Its own
         clipPath mirrors the wrapper's (both need it independently: a mask
         still needs to clip glass's own tint/blur, same as it clips
         everything else on this element), and it still paints BEFORE the
         wrapper (glass panel behind, real content in front) via plain DOM
         order. */}
      {glassStyle && (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          clipPath: hasMask ? `url(#${instanceId}-mask-${el.maskId})` : undefined,
          borderRadius: el.config.borderRadius,
          // willChange/translateZ(0) — the SAME WebKit compositing-layer-
          // promotion hint the filtered wrapper below already needs for a
          // plain `filter` to repaint reliably (see its own long comment),
          // and backdrop-filter needs it even more: without its own
          // compositing layer, WebKit can render it once and then fail to
          // UPDATE it at all once any ancestor's transform changes — e.g.
          // CgMonitorBar.tsx's PROGRAM box, which wraps every layer in its
          // own `transform: scale(...)` to fit the monitor's small preview
          // box (PREVIEW box does too, but happens to repaint from a fresh
          // mount far more often, which is what was masking this — the
          // underlying bug is identical in both). This is exactly the
          // "looks right in the designer/at first paint, breaks once
          // something moves/scales around it" WebKit symptom.
          willChange: 'backdrop-filter', transform: 'translateZ(0)',
          backdropFilter: glassStyle.backdropFilter, WebkitBackdropFilter: glassStyle.backdropFilter,
          background: fractalRidge ? fractalRidge.background : glassStyle.background,
          boxShadow: fractalRidge ? fractalRidge.boxShadow : glassStyle.boxShadow,
          ...(fractalRidge ? { mixBlendMode: fractalRidge.mixBlendMode, filter: `blur(${fractalRidge.selfBlur}px)` } : null),
          ...(glassMask ? {
            WebkitMaskImage: glassMask.maskImage, maskImage: glassMask.maskImage,
            WebkitMaskSize: glassMask.maskSize, maskSize: glassMask.maskSize,
            WebkitMaskPosition: glassMask.maskPosition, maskPosition: glassMask.maskPosition,
            WebkitMaskRepeat: glassMask.maskRepeat, maskRepeat: glassMask.maskRepeat,
            ...(glassMask.maskComposite ? { maskComposite: glassMask.maskComposite } : null),
          } : null),
        }}>
          {glassEdge && (
            <>
              <div style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', border: `1px solid ${glassEdge.shadowColor}`, WebkitMaskImage: glassEdge.shadowMask, maskImage: glassEdge.shadowMask }} />
              <div style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', border: '1px solid #ffffff', WebkitMaskImage: glassEdge.highlightMask, maskImage: glassEdge.highlightMask }} />
            </>
          )}
          {/* crystalGlass's own cut-facet overlay — see cgEffects.ts's
             buildCrystalFacetStyle. Sits inside this same clipped/masked
             chrome div so it inherits the exact same content-shape + ramp
             masking the tint/blur above already got, rather than needing
             its own separate mask computation. */}
          {crystalFacet && (
            <div style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', backgroundImage: crystalFacet.backgroundImage, backgroundSize: crystalFacet.backgroundSize, mixBlendMode: crystalFacet.mixBlendMode }} />
          )}
          {/* fractalGlass's own second, more-blurred ridge pass — the
             reference pen's own `::after`, a plain highlight layered on TOP
             of the blended result above rather than part of the blend mode
             itself (no mixBlendMode of its own — see
             buildFractalGlassRidgeStyle's own doc comment). */}
          {fractalRidge && (
            <div style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', background: fractalRidge.backgroundHighlight, filter: `blur(${fractalRidge.highlightBlur}px)` }} />
          )}
        </div>
      )}
      <div
        ref={(node) => { registerEffectWrapperById(el.id, node); wrapperRef.current = node; }}
        // `filter` is deliberately NOT in this style object — GSAP's
        // buildEffectKeyframeTracks (cgAnimationEngine.ts) writes an
        // animated filter value straight onto this same node via its own
        // onUpdate, exactly like every transform property this app already
        // hands entirely to GSAP (x/y/rotation/scale/opacity are never in a
        // React style object either, for the same reason). If `filter`
        // stayed in React's JSX too, EVERY re-render this component gets for
        // any unrelated reason (a store update elsewhere, a sibling layer's
        // own signal ticking) would reapply the plain static value here and
        // stomp GSAP's live one mid-tween. The useLayoutEffect above owns
        // resetting it to the static value instead, gated on filterStr
        // actually changing.
        //
        // willChange/translateZ(0): this wrapper's `filter` sits on a PLAIN
        // node while its own child (refdNode) is animated by GSAP via
        // hardware-accelerated transforms (translate3d/scale), which
        // promotes THAT child to its own GPU compositing layer. WebKit (the
        // actual engine the desktop app renders with — Safari/WKWebView,
        // not Chrome) has a long-standing bug where a `filter` on a node
        // that ISN'T itself composited fails to repaint correctly once a
        // composited descendant's transform changes underneath it: the
        // filter value is set correctly (confirmed directly on the live
        // node) but never visibly paints — exactly the "blur/drop shadow
        // effect doesn't show on the real output, only in the designer"
        // symptom this was chasing. Forcing this node onto its own
        // compositing layer, matching its animated child, is the standard
        // fix for that WebKit repaint bug — a hint with no visible effect
        // of its own when nothing is actually wrong.
        // transformStyle:preserve-3d unconditionally — a no-op visually
        // for anything not sitting inside a scene3D ancestor (there's no
        // 3D space to preserve without one), but WITHOUT it here, this
        // wrapper's own translateZ(0) (below, unrelated — the WebKit
        // repaint fix) would flatten this element's own content back to 2D
        // partway through an ancestor's shared 3D scene the instant this
        // element has any effect/mask/children of its own (the only case
        // that reaches this wrapper at all).
        //
        // Glass's own chrome does NOT go here anymore — see the dedicated
        // sibling div just above (rendered outside this filtered node
        // entirely — see ITS OWN long comment for why: `filter` here would
        // otherwise cut off backdrop-filter's view of anything behind it).
        style={{
          width: '100%', height: '100%', clipPath: hasMask ? `url(#${instanceId}-mask-${el.maskId})` : undefined,
          willChange: 'filter', transform: 'translateZ(0)', transformStyle: 'preserve-3d',
        }}
      >
        {refdNode}
        {sweepGeom && (
          <div style={{
            position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', mixBlendMode: 'screen',
            ...(sweepMask ? {
              WebkitMaskImage: sweepMask.maskImage, maskImage: sweepMask.maskImage,
              WebkitMaskSize: sweepMask.maskSize, maskSize: sweepMask.maskSize,
              WebkitMaskPosition: sweepMask.maskPosition, maskPosition: sweepMask.maskPosition,
              WebkitMaskRepeat: sweepMask.maskRepeat, maskRepeat: sweepMask.maskRepeat,
            } : null),
          }}>
            <div style={{ position: 'absolute', left: sweepGeom.left, top: sweepGeom.top, width: sweepGeom.boxSize, height: sweepGeom.boxSize, transform: `rotate(${lightSweepEffect!.angle ?? 115}deg)` }}>
              <div ref={sweepBandRef} style={{ position: 'absolute', inset: 0, background: sweepGeom.gradient }} />
            </div>
          </div>
        )}
        {/* 'stroke' effect's own ring — a sibling of refdNode INSIDE this
           same filter-bearing wrapper (not a separate node elsewhere) so a
           dropShadow/glow effect ALSO present in this element's own effects
           stack wraps around it too, gap included, via this wrapper's own
           `filter` — see cgEffects.ts's CgEffect doc comment on
           `strokeGap`. Its own glow (buildStrokeGlowFilter) is a SEPARATE,
           narrower `filter` on just this <svg>, so it never also glows the
           element's own base content. */}
        {strokeGeom && strokeEffect && (
          <svg
            viewBox={strokeGeom.viewBox}
            width={strokeGeom.boxW}
            height={strokeGeom.boxH}
            style={{ position: 'absolute', left: strokeGeom.left, top: strokeGeom.top, overflow: 'visible', pointerEvents: 'none', filter: strokeGlowFilter || undefined }}
          >
            {strokeGeom.rect ? (
              <rect
                ref={(node) => { strokeNodeRef.current = node; }}
                x={strokeGeom.rect.x} y={strokeGeom.rect.y} width={strokeGeom.rect.width} height={strokeGeom.rect.height} rx={strokeGeom.rect.rx}
                fill="none"
                stroke={hexToRgba(strokeEffect.color ?? '#ffffff', strokeEffect.opacity ?? 100)}
                strokeWidth={strokeEffect.strokeWidth ?? 3}
              />
            ) : (
              <g transform={strokeGeom.groupTransform}>
                <path
                  ref={(node) => { strokeNodeRef.current = node; }}
                  d={strokeGeom.d}
                  fill="none"
                  stroke={hexToRgba(strokeEffect.color ?? '#ffffff', strokeEffect.opacity ?? 100)}
                  strokeWidth={strokeEffect.strokeWidth ?? 3}
                />
              </g>
            )}
          </svg>
        )}
      </div>
      {renderChildren()}
    </div>
  );
}
