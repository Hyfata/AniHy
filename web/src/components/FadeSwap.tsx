import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { tweenNormal, tweenSlow, useMotionTransition } from '../lib/motion';

/** Loading skeleton ↔ content crossfade: during the swap both occupy the same
   grid cell, so the skeleton fades out (slow) while the content fades in at
   the same time. The skeleton's own entrance fade is handled by .skeleton CSS. */
export function FadeSwap({
  loading,
  skeleton,
  children,
}: {
  loading: boolean;
  skeleton: ReactNode;
  children: ReactNode;
}) {
  const slow = useMotionTransition(tweenSlow);
  const normal = useMotionTransition(tweenNormal);
  return (
    // minmax(0, 1fr) + minWidth: 0 — an unconstrained grid track would grow to
    // the content's max-content width and break inner horizontal scroll rows
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)' }}>
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
}
