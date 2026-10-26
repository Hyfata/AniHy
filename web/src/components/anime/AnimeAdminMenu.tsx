import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { del, get } from '../../api/client';
import type { AnimeDetail } from '../../api/types';
import { tweenFast, useMotionTransition } from '../../lib/motion';
import { useAuthStore } from '../../stores/auth';
import { dialog } from '../../stores/dialog';
import { EditAnimeModal } from '../admin/EditAnimeModal';
import { EditIcon, TrashIcon } from '../icons';
import styles from './AnimeDetailModal.module.css';

/** Admin "more" menu in the modal chrome, left of the close button — holds
   download-source link / edit / delete. Shares the ['anime', id] query, so it
   renders only once is_admin is confirmed, with no extra request. */
export function AnimeAdminMenu({ animeId }: { animeId: number }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const identity = useAuthStore((s) => s.identity);
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const transition = useMotionTransition(tweenFast);

  const { data: detail, isPlaceholderData } = useQuery({
    queryKey: ['anime', animeId],
    queryFn: () => get<AnimeDetail>(`/animes/${animeId}`),
    enabled: Number.isFinite(animeId),
  });

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [open]);

  const isAdmin = !isPlaceholderData && ((detail?.is_admin ?? false) || (identity?.is_admin ?? false));
  if (!isAdmin || !detail) return null;

  const remove = async () => {
    if (!(await dialog.confirm('이 애니와 모든 에피소드를 삭제하시겠습니까?', { confirmLabel: '삭제', danger: true }))) return;
    try {
      await del(`/admin/animes/${detail.id}`);
      navigate('/');
    } catch (err) {
      await dialog.alert(err instanceof Error ? err.message : '삭제 실패');
    }
  };

  return (
    <div className={styles.moreWrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.more}
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
            {detail.download_url && (
              <a
                role="menuitem"
                className={styles.moreMenuItem}
                href={detail.download_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6" /><path d="M10 14 21 3" /></svg>
                다운로드 주소 열기
              </a>
            )}
            <button
              type="button"
              role="menuitem"
              className={styles.moreMenuItem}
              onClick={() => {
                setOpen(false);
                setEditOpen(true);
              }}
            >
              <EditIcon />
              수정
            </button>
            <button
              type="button"
              role="menuitem"
              className={`${styles.moreMenuItem} ${styles.moreMenuItemDanger}`}
              onClick={() => {
                setOpen(false);
                void remove();
              }}
            >
              <TrashIcon />
              삭제
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <EditAnimeModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        anime={detail}
        onSaved={() => void queryClient.invalidateQueries({ queryKey: ['anime', animeId] })}
        onDeleted={() => navigate('/')}
      />
    </div>
  );
}
