import { useReducedMotion } from 'framer-motion';
import type { Transition } from 'framer-motion';

/** 모션 토큰 — spring vs tween 가이드는 CONTRIBUTING.md 참조 */
export const springPop: Transition = { type: 'spring', stiffness: 380, damping: 30 };
export const springGentle: Transition = { type: 'spring', stiffness: 300, damping: 34 };
export const tweenFast: Transition = { type: 'tween', duration: 0.15, ease: 'easeOut' };
export const tweenNormal: Transition = { type: 'tween', duration: 0.25, ease: [0.2, 0.7, 0.3, 1] };

/** 페이지 전환 variants (미묘한 fade + slide) */
export const pageVariants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

/** framer-motion이 자체적으로 prefers-reduced-motion을 transform/opacity 애니메이션에
   적용하지 않으므로, 이 훅으로 transition을 통째로 묠화한다. */
export function useMotionTransition(transition: Transition): Transition {
  const reduced = useReducedMotion();
  return reduced ? { duration: 0 } : transition;
}

export { useReducedMotion };
