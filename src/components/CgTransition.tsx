import { useEffect, useRef, useState } from 'react';
import type { CgTransitionType } from '../stores/cgPlayoutStore';

interface Props {
  /** Renders `children` while true. On false→true it mounts and plays the
   *  in-transition; on true→false it keeps `children` mounted for
   *  `durationMs` while playing the out-transition, then unmounts. */
  active: boolean;
  type: CgTransitionType;
  durationMs: number;
  children: React.ReactNode;
}

// Hand-rolled mount/unmount transition — no animation library is used
// anywhere else in this codebase, so this stays plain CSS + a small phase
// state machine rather than pulling in a new dependency for three effects.
export function CgTransition({ active, type, durationMs, children }: Props) {
  const [mounted, setMounted] = useState(active);
  const [phase, setPhase] = useState<'in' | 'idle' | 'out'>(active ? 'idle' : 'in');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A layer is already 'playing' the moment it's first loaded with
  // playOnLoad — so `active` is `true` on this component's very FIRST
  // mount just as often as it is on a later activation (not just for a
  // late-joining output window). Without this guard, the effect below
  // would replay the whole hide→reveal cycle on every ordinary Play too,
  // needlessly hiding something the state initializer already rendered
  // correctly visible.
  const isFirstRun = useRef(true);

  useEffect(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const wasFirstRun = isFirstRun.current;
    isFirstRun.current = false;

    if (active) {
      setMounted(true);
      if (wasFirstRun) return; // already 'idle' from the state initializer — nothing to animate
      if (type === 'cut') { setPhase('idle'); return; }
      setPhase('in');
      // Double rAF so the browser paints the "in" (pre-transition) class
      // first, then flips to "idle" on the next frame — otherwise the
      // browser can coalesce both style changes into one paint and the
      // CSS transition never actually runs.
      requestAnimationFrame(() => requestAnimationFrame(() => setPhase('idle')));
    } else if (mounted) {
      if (type === 'cut') { setMounted(false); setPhase('in'); return; }
      setPhase('out');
      timerRef.current = setTimeout(() => { setMounted(false); setPhase('in'); }, durationMs);
    }

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, type]);

  if (!mounted) return null;

  return (
    <div
      className={`cgt cgt--${type} cgt--${phase}`}
      style={{ transitionDuration: type === 'cut' ? '0ms' : `${durationMs}ms` }}
    >
      {children}
    </div>
  );
}
