import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { AnimeDetail } from '../../api/types';
import { tweenFast } from '../../lib/motion';
import { Modal } from '../Modal';
import { AddEpisodeForm } from './AddEpisodeForm';
import { BulkAddForm } from './BulkAddForm';
import styles from './admin.module.css';

type Mode = 'single' | 'bulk';

/** 에피소드 추가 단일 진입점 — 하나의 Modal 셸 위에서 단일/일괄 폼만 교체한다.
   각 폼의 제출 액션은 footerEl 포털로 셸의 고정 footer에 렌더된다. */
export function EpisodeAddModal({
  open,
  onClose,
  anime,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  anime: AnimeDetail;
  onAdded?: () => void;
}) {
  const [mode, setMode] = useState<Mode>('single');
  const [footerEl, setFooterEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (open) setMode('single');
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="에피소드 추가"
      footer={<div ref={setFooterEl} style={{ display: 'contents' }} />}
    >
      <div className={styles.tabs}>
        {(
          [
            ['single', '단일 추가'],
            ['bulk', '일괄 추가'],
          ] as [Mode, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`${styles.tab}${mode === key ? ` ${styles.tabActive}` : ''}`}
            onClick={() => setMode(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={mode}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={tweenFast}
        >
          {mode === 'single' ? (
            <AddEpisodeForm anime={anime} onClose={onClose} onAdded={onAdded} footerEl={footerEl} />
          ) : (
            <BulkAddForm anime={anime} onClose={onClose} onAdded={onAdded} footerEl={footerEl} />
          )}
        </motion.div>
      </AnimatePresence>
    </Modal>
  );
}
