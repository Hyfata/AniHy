import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { tweenFast, useMotionTransition } from '../../lib/motion';
import { EditIcon, TrashIcon } from '../icons';
import styles from './library.module.css';

/** Small "more" dropdown for the library tabs: 선택 / 전체 삭제. */
export function MoreMenu({
  onSelectDelete,
  onClearAll,
}: {
  onSelectDelete: () => void;
  onClearAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const transition = useMotionTransition(tweenFast);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [open]);

  return (
    <div className={styles.moreWrap} ref={ref}>
      <button
        type="button"
        className={styles.moreBtn}
        aria-label="더보기"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className={styles.moreMenu}
            role="menu"
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -4 }}
            transition={transition}
            style={{ transformOrigin: 'top right' }}
          >
            <button
              type="button"
              role="menuitem"
              className={styles.moreMenuItem}
              onClick={() => {
                setOpen(false);
                onSelectDelete();
              }}
            >
              <EditIcon />
              선택
            </button>
            <button
              type="button"
              role="menuitem"
              className={`${styles.moreMenuItem} ${styles.moreMenuItemDanger}`}
              onClick={() => {
                setOpen(false);
                onClearAll();
              }}
            >
              <TrashIcon />
              전체 삭제
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
