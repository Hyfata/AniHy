import { AnimatePresence, motion } from 'framer-motion';
import { tweenNormal, useMotionTransition } from '../../lib/motion';
import styles from './library.module.css';

/** Select-mode action bar shared by the library tabs. The height animation
   lets the list below shift smoothly instead of jumping. */
export function SelectBar({
  open,
  count,
  onDelete,
  onCancel,
}: {
  open: boolean;
  count: number;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const transition = useMotionTransition(tweenNormal);
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={transition}
          style={{ overflow: 'hidden' }}
        >
          <div className={styles.selectBar}>
            <span className={styles.selectCount}>{count}개 선택</span>
            <button type="button" className={styles.selectActionBtn} onClick={onDelete}>
              선택 삭제
            </button>
            <button type="button" className={styles.selectCancelBtn} onClick={onCancel}>
              취소
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
