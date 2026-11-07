import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { tweenNormal, tweenSlow, useMotionTransition } from '../lib/motion';

/** Loading skeleton ↔ content crossfade: during the swap both occupy the same
   grid cell, so the skeleton fades out (slow) while the content fades in at
   the same time. The skeleton's own entrance fade is handled by .skeleton CSS.
   With `animateHeight`, the wrapper eases between the measured heights instead
   of snapping when the two contents differ in size. */
export function FadeSwap({
  loading,
  skeleton,
  children,
  animateHeight = false,
}: {
  loading: boolean;
  skeleton: ReactNode;
  children: ReactNode;
  animateHeight?: boolean;
}) {
  const slow = useMotionTransition(tweenSlow);
  const normal = useMotionTransition(tweenNormal);
  const contentRef = useRef<HTMLDivElement>(null);
  const lastHeight = useRef<number>();
  const [height, setHeight] = useState<number>();
  const [clipping, setClipping] = useState(false);

  useEffect(() => {
    if (!animateHeight) return;
    const el = contentRef.current;
    if (!el) return;
    const update = () => {
      const next = el.offsetHeight;
      if (next === lastHeight.current) return;
      if (lastHeight.current !== undefined) setClipping(true);
      lastHeight.current = next;
      setHeight(next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [animateHeight]);

  const inner = (
    // minmax(0, 1fr) + minWidth: 0 — an unconstrained grid track would grow to
    // the content's max-content width and break inner horizontal scroll rows
    <div ref={contentRef} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)' }}>
      {/* Do NOT pass initial={false}: it propagates through PresenceContext and
          would suppress mount animations of nested content (card stagger etc.) */}
      <AnimatePresence>
        {loading ? (
          <motion.div
            key="skeleton"
            exit={{ opacity: 0 }}
            transition={slow}
            style={{ gridArea: '1 / 1', minWidth: 0 }}
          >
            {skeleton}
          </motion.div>
        ) : (
          <motion.div
            key="content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={normal}
            style={{ gridArea: '1 / 1', minWidth: 0 }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  if (!animateHeight) return inner;

  return (
    <motion.div
      animate={height === undefined ? undefined : { height }}
      transition={normal}
      onAnimationComplete={() => setClipping(false)}
      style={{ overflow: clipping ? 'hidden' : 'visible' }}
    >
      {inner}
    </motion.div>
  );
}
