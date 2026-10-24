import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { del, get, ApiError } from '../../api/client';
import type { HistoryItem } from '../../api/types';
import { dateTime, formatPlaytime, relativeTime } from '../../lib/format';
import { useReducedMotion } from '../../lib/motion';
import { useAuthStore } from '../../stores/auth';
import { Modal } from '../Modal';
import { Skeleton } from '../Spinner';
import { LoginPrompt } from './LoginPrompt';
import styles from './library.module.css';

interface AnimeGroup {
  anime_id: number;
  title: string;
  cover: string | null;
  latest: HistoryItem;
  /** updated_at 내림차순 */
  items: HistoryItem[];
}

const epLabelOf = (h: HistoryItem) =>
  h.episode_title ? `${h.episode_number}화 · ${h.episode_title}` : `${h.episode_number}화`;

const watchPath = (h: HistoryItem) =>
  `/watch/${h.anime_id}/${encodeURIComponent(h.episode_number)}`;

/** 서버는 updated_at 내림차순 flat 목록 — 애니별로 묶고, 그룹 순서는 최근 시청 순 */
function groupByAnime(items: HistoryItem[]): AnimeGroup[] {
  const groups: AnimeGroup[] = [];
  const byId = new Map<number, AnimeGroup>();
  for (const h of items) {
    let g = byId.get(h.anime_id);
    if (!g) {
      g = { anime_id: h.anime_id, title: h.title, cover: h.cover, latest: h, items: [] };
      byId.set(h.anime_id, g);
      groups.push(g);
    }
    g.items.push(h);
  }
  return groups;
}

/** 보관함 > 시청기록 — 애니별 그룹 카드. 카드 탭하면 회차 목록이 부드럽게 펼쳐지고,
   프로그레스 바 아래의 '바로 이어보기'는 가장 최근 회차로 직행. */
export function HistoryTab() {
  const identity = useAuthStore((s) => s.identity);
  const reducedMotion = useReducedMotion();
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [loginRequired, setLoginRequired] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

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
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} height={132} style={{ borderRadius: 'var(--radius)' }} />
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

  const groups = groupByAnime(items);

  return (
    <>
      <div className={styles.historyHeader}>
        <button type="button" className={styles.clearAllBtn} onClick={() => setConfirmClear(true)}>
          전체 삭제
        </button>
      </div>
      <div className={styles.historyList}>
        {groups.map((g) => {
          const ratio = Math.min(1, Math.max(0, g.latest.ratio));
          const open = expandedId === g.anime_id;
          return (
            <div key={g.anime_id} className={styles.historyGroup}>
              <div
                className={styles.historyGroupMain}
                role="button"
                tabIndex={0}
                aria-expanded={open}
                onClick={() => setExpandedId(open ? null : g.anime_id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setExpandedId(open ? null : g.anime_id);
                  }
                }}
              >
                <div className={styles.historyThumbWrap}>
                  {g.cover ? <img src={g.cover} alt="" loading="lazy" /> : null}
                  {g.latest.completed && <span className={styles.completedBadge}>시청 완료</span>}
                </div>
                <div className={styles.historyBody}>
                  <h3 className={styles.historyTitle}>{g.title}</h3>
                  <p className={styles.historyEp}>최근 시청: {epLabelOf(g.latest)}</p>
                  <div className={styles.historyMeta}>
                    <div className={styles.historyProgress}>
                      <div className={styles.historyProgressFill} style={{ width: `${ratio * 100}%` }} />
                    </div>
                    <span>
                      {Math.round(ratio * 100)}%
                      {g.latest.duration_ms > 0 && (
                        <>
                          {' '}
                          · {formatPlaytime(g.latest.position_ms)} /{' '}
                          {formatPlaytime(g.latest.duration_ms)}
                        </>
                      )}
                      {g.latest.updated_at && <> · {relativeTime(g.latest.updated_at)}</>}
                    </span>
                  </div>
                  <Link
                    to={watchPath(g.latest)}
                    className={styles.resumeBtn}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M8 5.14v14l11-7-11-7z" />
                    </svg>
                    바로 이어보기
                  </Link>
                </div>
                <svg
                  className={`${styles.historyChevron}${open ? ` ${styles.historyChevronOpen}` : ''}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </div>

              <AnimatePresence initial={false}>
                {open && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={
                      reducedMotion ? { duration: 0 } : { duration: 0.28, ease: [0.25, 0.9, 0.28, 1] }
                    }
                    style={{ overflow: 'hidden' }}
                  >
                    <div className={styles.historyEpisodes}>
                      {g.items.map((h) => {
                        const r = Math.min(1, Math.max(0, h.ratio));
                        return (
                          <Link
                            key={h.episode_number}
                            to={watchPath(h)}
                            className={styles.historyEpRow}
                          >
                            <span className={styles.historyEpThumb}>
                              {h.thumb_url ? <img src={h.thumb_url} alt="" loading="lazy" /> : null}
                            </span>
                            <span className={styles.historyEpBody}>
                              <span className={styles.historyEpLabel}>{epLabelOf(h)}</span>
                              <span className={styles.historyEpProgress}>
                                <span
                                  className={styles.historyProgressFill}
                                  style={{ width: `${r * 100}%` }}
                                />
                              </span>
                              <span className={styles.historyEpMeta}>
                                {Math.round(r * 100)}%
                                {h.duration_ms > 0 && (
                                  <> · {formatPlaytime(h.position_ms)} / {formatPlaytime(h.duration_ms)}</>
                                )}
                                {h.updated_at && (
                                  <>
                                    {' '}
                                    · {relativeTime(h.updated_at)} ({dateTime(h.updated_at)})
                                  </>
                                )}
                              </span>
                            </span>
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
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
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
