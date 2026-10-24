import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { springPop, tweenFast } from '../lib/motion';
import styles from './Modal.module.css';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  size?: 'md' | 'sm';
  children: ReactNode;
  /** 스크롤과 무관하게 모달 하단에 고정되는 푸터 (주 액션 버튼 등) */
  footer?: ReactNode;
}

/** 모달 베이스: spring 진입/퇴장, 백드롭 클릭·Esc 닫기, 열린 동안 body 스크롤 잠금.
   중첩 모달은 이 컴포넌트를 쌓아서 사용 (z-index는 ui store가 관리할 때 조정). */
export function Modal({ open, onClose, title, size = 'md', children, footer }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className={styles.overlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={tweenFast}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            className={`${styles.modal}${size === 'sm' ? ` ${styles.modalSm}` : ''}`}
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, y: 18, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={springPop}
          >
            {title !== undefined && (
              <div className={styles.header}>
                <h2>{title}</h2>
                <button type="button" className={styles.close} onClick={onClose} aria-label="닫기">
                  ×
                </button>
              </div>
            )}
            <div className={styles.body}>{children}</div>
            {footer && <div className={styles.footer}>{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
