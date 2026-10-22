import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { del, get, ApiError } from '../../api/client';
import type { HistoryItem } from '../../api/types';
import { formatPlaytime, relativeTime } from '../../lib/format';
import { useAuthStore } from '../../stores/auth';
import { Modal } from '../Modal';
import { Skeleton } from '../Spinner';
import { LoginPrompt } from './LoginPrompt';
import styles from './library.module.css';

/** 보관함 > 시청기록 — updated_at 내림차순, 개별/전체 삭제. */
export function HistoryTab() {
  const identity = useAuthStore((s) => s.identity);
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [loginRequired, setLoginRequired] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await get<{ history: HistoryItem[] }>('/history?limit=100', signal);
      setItems(data.history);
      setLoginRequired(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setLoginRequired(true);
        setItems([]);
      } else if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setItems([]);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setItems(null);
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const removeOne = async (animeId: number, ep: string) => {
    await del(`/history/${animeId}/${encodeURIComponent(ep)}`);
    setItems((prev) =>
      prev ? prev.filter((h) => !(h.anime_id === animeId && h.episode_number === ep)) : prev,
    );
  };

  const clearAll = async () => {
    setClearing(true);
    try {
      await del('/history');
      setItems([]);
      setConfirmClear(false);
    } finally {
      setClearing(false);
    }
  };

  if (loginRequired || (identity && !identity.logged_in)) {
    return <LoginPrompt feature="시청기록" />;
  }

  if (items === null) {
    return (
      <div className={styles.historyList}>
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} height={96} style={{ borderRadius: 'var(--radius)' }} />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>시청 기록이 없습니다</p>
        <p className={styles.emptyDesc}>애니를 시청하면 이어보기 목록이 여기에 표시됩니다.</p>
        <Link to="/" className={styles.ctaBtn}>
          애니 둘러보기
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className={styles.historyHeader}>
        <button type="button" className={styles.clearAllBtn} onClick={() => setConfirmClear(true)}>
          전체 삭제
        </button>
      </div>
      <div className={styles.historyList}>
        {items.map((h) => {
          const ratio = Math.min(1, Math.max(0, h.ratio));
          const epLabel = h.episode_title
            ? `${h.episode_number}화 · ${h.episode_title}`
            : `${h.episode_number}화`;
          return (
            <Link key={`${h.anime_id}-${h.episode_number}`} to={`/watch/${h.anime_id}/${encodeURIComponent(h.episode_number)}`} className={styles.historyRow}>
              <div className={styles.historyThumbWrap}>
                {h.cover ? <img src={h.cover} alt="" loading="lazy" /> : null}
                {h.completed && <span className={styles.completedBadge}>시청 완료</span>}
              </div>
              <div className={styles.historyBody}>
                <h3 className={styles.historyTitle}>{h.title}</h3>
                <p className={styles.historyEp}>{epLabel}</p>
                <div className={styles.historyMeta}>
                  <div className={styles.historyProgress}>
                    <div className={styles.historyProgressFill} style={{ width: `${ratio * 100}%` }} />
                  </div>
                  <span>{Math.round(ratio * 100)}%</span>
                  {h.duration_ms > 0 && (
                    <span>
                      {formatPlaytime(h.position_ms)} / {formatPlaytime(h.duration_ms)}
                    </span>
                  )}
                  <span>{relativeTime(h.updated_at)}</span>
                </div>
              </div>
              <button
                type="button"
                className={styles.historyDeleteBtn}
                aria-label="기록 삭제"
                title="기록 삭제"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void removeOne(h.anime_id, h.episode_number);
                }}
              >
                ×
              </button>
            </Link>
          );
        })}
      </div>

      <Modal open={confirmClear} onClose={() => setConfirmClear(false)} title="시청기록 전체 삭제" size="sm">
        <p className={styles.confirmText}>
          모든 시청 기록을 삭제합니다. 이어보기 위치가 모두 사라지며 되돌릴 수 없습니다.
        </p>
        <div className={styles.confirmActions}>
          <button type="button" className={styles.cancelBtn} onClick={() => setConfirmClear(false)}>
            취소
          </button>
          <button type="button" className={styles.dangerBtn} disabled={clearing} onClick={() => void clearAll()}>
            {clearing ? '삭제 중…' : '전체 삭제'}
          </button>
        </div>
      </Modal>
    </>
  );
}
