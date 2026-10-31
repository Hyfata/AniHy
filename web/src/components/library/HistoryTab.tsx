import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { del, get, ApiError } from '../../api/client';
import type { AnimeDetail, HistoryItem } from '../../api/types';
import { dateTime, formatPlaytime, relativeTime } from '../../lib/format';
import { useReducedMotion } from '../../lib/motion';
import { useAuthStore } from '../../stores/auth';
import { dialog } from '../../stores/dialog';
import { Modal } from '../Modal';
import { FadeSwap } from '../FadeSwap';
import { TrashIcon } from '../icons';
import { Skeleton } from '../Spinner';
import { LoginPrompt } from './LoginPrompt';
import { SelectBar } from './SelectBar';
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

/** Resume link for a group card. When the latest episode is completed, jumps to
   the next episode in the detail's episode list (same ordering as WatchPage);
   labels itself 다시보기 when there is no next episode. The detail query is
   fetched only for completed groups and shares the ['anime', id] cache. */
function ResumeLink({ group }: { group: AnimeGroup }) {
  const { anime_id, latest } = group;
  const navigate = useNavigate();
  const { data: detail } = useQuery({
    queryKey: ['anime', anime_id],
    queryFn: () => get<AnimeDetail>(`/animes/${anime_id}`),
    enabled: latest.completed,
  });

  let targetEp = latest.episode_number;
  let label = '이어보기';
  let isRewatch = false;
  if (latest.completed && detail) {
    const idx = detail.episodes.findIndex((e) => e.episode_number === latest.episode_number);
    const next = idx >= 0 ? detail.episodes[idx + 1] : undefined;
    if (next) targetEp = next.episode_number;
    else {
      label = '다시보기';
      isRewatch = true;
    }
  }

  const to = `/watch/${anime_id}/${encodeURIComponent(targetEp)}`;
  return (
    <Link
      to={to}
      className={`${styles.resumeBtn}${isRewatch ? ` ${styles.resumeBtnRewatch}` : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        if (!isRewatch) return;
        e.preventDefault();
        void dialog
          .confirm('이미 다 시청한 회차예요. 정말 다시 볼까요?', { confirmLabel: '다시보기' })
          .then((ok) => {
            if (ok) navigate(to);
          });
      }}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M8 5.14v14l11-7-11-7z" />
      </svg>
      {label}
    </Link>
  );
}

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

/** Library > watch history — per-anime group cards; tapping expands the episode
   list. The resume link (ResumeLink) jumps to the next episode when the latest
   one is completed, or becomes 다시보기 when there is none. */
export function HistoryTab({
  selectMode,
  onSelectModeChange,
  clearSignal,
  onClearHandled,
}: {
  selectMode: boolean;
  onSelectModeChange: (value: boolean) => void;
  clearSignal: number;
  onClearHandled: () => void;
}) {
  const identity = useAuthStore((s) => s.identity);
  const location = useLocation();
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
    if (!(await dialog.confirm(`${ep}화 시청 기록을 삭제할까요?`, { confirmLabel: '삭제', danger: true }))) return;
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

  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (clearSignal === 0) return;
    setConfirmClear(true);
    onClearHandled();
  }, [clearSignal, onClearHandled]);

  const toggle = (animeId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(animeId)) next.delete(animeId);
      else next.add(animeId);
      return next;
    });
  };

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    if (!(await dialog.confirm(`${selected.size}개 애니의 시청 기록을 삭제할까요?`, { confirmLabel: '삭제', danger: true }))) return;
    const targets = items!.filter((h) => selected.has(h.anime_id));
    await Promise.all(targets.map((h) => del(`/history/${h.anime_id}/${encodeURIComponent(h.episode_number)}`)));
    setItems((prev) => (prev ? prev.filter((h) => !selected.has(h.anime_id)) : prev));
    setSelected(new Set());
    onSelectModeChange(false);
  };

  if (loginRequired || (identity && !identity.logged_in)) {
    return <LoginPrompt feature="시청기록" />;
  }

  const groups = groupByAnime(items ?? []);

  return (
    <FadeSwap
      loading={items === null}
      skeleton={
        <div className={styles.historyList}>
          {Array.from({ length: 3 }, (_, i) => (
            // Same silhouette as the real group card (thumb + title/time + latest card + header strip)
            <div key={i} className={`${styles.historyGroup} ${styles.skeletonCard}`}>
              <div className={styles.historyGroupMain}>
                <Skeleton style={{ width: 104, aspectRatio: '2 / 3', flexShrink: 0 }} />
                <div className={styles.historyBody}>
                  <Skeleton height={22} style={{ width: '65%' }} />
                  <Skeleton height={16} style={{ width: '38%' }} />
                  <Skeleton
                    height={75}
                    style={{ marginTop: 'var(--space-2)', borderRadius: 'var(--radius-sm)' }}
                  />
                </div>
              </div>
              <Skeleton height={37} style={{ borderRadius: 0 }} />
            </div>
          ))}
        </div>
      }
    >
      {items && items.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>시청 기록이 없습니다</p>
          <p className={styles.emptyDesc}>애니를 시청하면 이어보기 목록이 여기에 표시됩니다.</p>
          <Link to="/" className={styles.ctaBtn}>
            애니 둘러보기
          </Link>
        </div>
      ) : (
        <>
          <SelectBar
        open={selectMode}
        count={selected.size}
        onDelete={() => void deleteSelected()}
        onCancel={() => {
          setSelected(new Set());
          onSelectModeChange(false);
        }}
      />
      <div className={styles.historyList}>
        {groups.map((g) => {
          const ratio = Math.min(1, Math.max(0, g.latest.ratio));
          const open = expandedId === g.anime_id;
          return (
            <div key={g.anime_id} className={styles.historyGroup}>
              <div
                className={styles.historyGroupMain}
                onClick={() => {
                  if (selectMode) toggle(g.anime_id);
                }}
              >
                {selectMode && (
                  <input
                    type="checkbox"
                    className={styles.selectCheck}
                    checked={selected.has(g.anime_id)}
                    onChange={() => toggle(g.anime_id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`${g.title} 선택`}
                  />
                )}
                <Link
                  to={`/anime/${g.anime_id}`}
                  state={{ background: location }}
                  className={styles.historyThumbWrap}
                  onClick={(e) => {
                    if (selectMode) e.preventDefault();
                  }}
                >
                  {g.cover ? <img src={g.cover} alt="" loading="lazy" /> : null}
                </Link>
                <div className={styles.historyBody}>
                  <h3 className={styles.historyTitle}>{g.title}</h3>
                  <div className={styles.historyTime}>
                    {g.latest.updated_at && relativeTime(g.latest.updated_at)}
                    <span className={styles.infoIcon} tabIndex={0} aria-label="마지막 시청 시간">
                      i
                      <span className={styles.timeTooltip}>
                        마지막 시청
                        <br />
                        {g.latest.updated_at && dateTime(g.latest.updated_at)}
                      </span>
                    </span>
                  </div>
                  <div className={styles.historyLatestCard}>
                    <div className={styles.historyLatestRow}>
                      <span className={styles.historyLatestEp}>{epLabelOf(g.latest)}</span>
                      <ResumeLink group={g} />
                    </div>
                    {g.latest.duration_ms > 0 && (
                      <div className={styles.historyPosition}>
                        {formatPlaytime(g.latest.position_ms)} / {formatPlaytime(g.latest.duration_ms)}
                      </div>
                    )}
                    <div className={styles.historyProgress}>
                      <div className={styles.historyProgressFill} style={{ width: `${ratio * 100}%` }} />
                    </div>
                  </div>
                </div>
              </div>

              <div
                className={styles.episodesHeader}
                role="button"
                tabIndex={0}
                aria-expanded={open}
                onClick={() => {
                  if (selectMode) return;
                  setExpandedId(open ? null : g.anime_id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (selectMode) return;
                    setExpandedId(open ? null : g.anime_id);
                  }
                }}
              >
                <span className={styles.episodesHeaderTitle}>
                  에피소드 기록
                  <span className={styles.epCountBadge}>{g.items.length}</span>
                </span>
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
                              {h.duration_ms > 0 && (
                                <span className={styles.historyEpMeta}>
                                  {formatPlaytime(h.position_ms)} / {formatPlaytime(h.duration_ms)}
                                </span>
                              )}
                              <span className={styles.historyEpProgress}>
                                <span
                                  className={styles.historyProgressFill}
                                  style={{ width: `${r * 100}%` }}
                                />
                              </span>
                            </span>
                            {h.updated_at && (
                              <span className={styles.historyEpTime}>{relativeTime(h.updated_at)}</span>
                            )}
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
                              <TrashIcon />
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
      )}
    </FadeSwap>
  );
}
