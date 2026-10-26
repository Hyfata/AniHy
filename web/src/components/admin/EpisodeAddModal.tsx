import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { AnimeDetail } from '../../api/types';
import { tweenFast } from '../../lib/motion';
import { Modal } from '../Modal';
import { AddEpisodeForm } from './AddEpisodeForm';
import { BulkAddForm } from './BulkAddForm';
import styles from './admin.module.css';

type Mode = 'single' | 'bulk';

/** Single entry point for adding episodes — swaps between the single-add and
   bulk-add forms on one Modal shell. Each form's submit action is portaled
   into the shell's fixed footer (footerEl). */
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
