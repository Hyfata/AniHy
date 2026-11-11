import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { get, post } from '../../api/client';
import type {
  JobProgress, QueueCompletedJob, QueueJob, QueueStatusResponse,
} from '../../api/types';
import { dateTime } from '../../lib/format';
import { tweenFast } from '../../lib/motion';
import { dialog } from '../../stores/dialog';
import { useUiStore } from '../../stores/ui';
import { FadeSwap } from '../FadeSwap';
import { Modal } from '../Modal';
import { Skeleton } from '../Spinner';
import styles from './QueueModal.module.css';

const POLL_MS = 3000;
/** 로그 뷰어 자동 스크롤 하드 규약: 하단 40px 이내일 때만 따라감 (app.js fetchLog 계승) */
const LOG_AUTOSCROLL_THRESHOLD_PX = 40;

const STATUS_LABEL: Record<string, string> = {
  pending: '대기 중',
  downloading: '다운로드 중',
  preparing: '자막 준비 중',
  encoding: '인코딩 중',
  completed: '완료',
  failed: '실패',
};

const SOURCE_LABEL: Record<string, string> = {
  upload: '업로드',
  server: '서버 파일',
  download: '스트리밍 다운로드',
};

function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

function statusClass(status: string): string {
  if (status === 'encoding') return styles.statusEncoding;
  if (status === 'completed') return styles.statusCompleted;
  if (status === 'failed') return styles.statusFailed;
  return '';
}

/** 회차 제목 — 항상 "N화"를 앞세우고, 부제는 폴백("N화")이 아닐 때만 (구 createEpisodeCard 규약). */
function episodeLabel(ep: { episode_number: string; episode_title: string }): string {
  const no = `${ep.episode_number}화`;
  return ep.episode_title === no ? no : `${no} · ${ep.episode_title}`;
}

/** 잡 상세(progress/encoder/source 등) — 활성 잡은 3초 폴, 완료·실패 잡은 1회만 조회. */
function useJobDetail(jobId: number, mode: 'poll' | 'once') {
  const [detail, setDetail] = useState<JobProgress | null>(null);
  const [encodePct, setEncodePct] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const [p, e] = await Promise.all([
          get<JobProgress>(`/jobs/${jobId}/progress`),
          get<{ encode_progress: number }>(`/jobs/${jobId}/encode-progress`),
        ]);
        if (cancelled) return;
        setDetail(p);
        setEncodePct(e.encode_progress);
      } catch {
        /* 조회 실패는 다음 틱에 재시도 (once면 재시도 없음) */
      }
    };
    void tick();
    if (mode !== 'poll') {
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [jobId, mode]);

  return { detail, encodePct };
}

/** 로그 뷰어 — offset 증분 append + 하단 40px 이내일 때만 자동 스크롤.
    스크롤은 content 커밋 후 이펙트에서 수행 (rAF는 React 렌더보다 먼저 돌아 옛 높이로 스크롤하는 버그).
    완료·실패 잡은 once — 로그가 더 늘지 않으므로 1회 조회만. */
function JobLog({ jobId, once = false }: { jobId: number; once?: boolean }) {
  const boxRef = useRef<HTMLPreElement>(null);
  const offsetRef = useRef(0);
  const followRef = useRef(true);
  const [content, setContent] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await get<{ content: string; offset: number; message?: string }>(
          `/jobs/${jobId}/log?offset=${offsetRef.current}`,
        );
        if (cancelled) return;
        const isFirst = offsetRef.current === 0;
        offsetRef.current = res.offset;
        const append = res.content || (isFirst && res.message ? res.message : '');
        if (append) {
          // append 전에 follow 여부를 기록 — 커밋 후 이펙트가 바닥으로 스크롤
          const box = boxRef.current;
          followRef.current =
            !box ||
            box.scrollHeight - box.scrollTop - box.clientHeight <= LOG_AUTOSCROLL_THRESHOLD_PX;
          setContent((prev) => prev + append);
        }
      } catch {
        /* 로그 조회 실패는 무시 */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    void tick();
    if (once) {
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [jobId, once]);

  // 커밋된 높이 기준으로 바닥 스크롤
  useEffect(() => {
    const box = boxRef.current;
    if (box && followRef.current) box.scrollTop = box.scrollHeight;
  }, [content]);

  if (content) {
    return (
      <pre
        ref={boxRef}
        className={styles.logBox}
        onScroll={(e) => {
          const el = e.currentTarget;
          followRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight <= LOG_AUTOSCROLL_THRESHOLD_PX;
        }}
      >
        {content}
      </pre>
    );
  }
  if (!loaded) {
    return (
      <div className={styles.logBox} aria-label="로그 로딩 중">
        <div className={styles.logSkeleton}>
          <Skeleton height={10} width="84%" />
          <Skeleton height={10} width="62%" />
          <Skeleton height={10} width="92%" />
          <Skeleton height={10} width="45%" />
        </div>
      </div>
    );
  }
  return <div className={styles.logBox}>표시할 로그가 없습니다.</div>;
}

/** 로그 뷰 타깃 — from은 진입 탭(뒤로가기 라벨/폴링 여부 판정). */
interface LogTarget {
  jobId: number;
  animeTitle: string;
  episode_number: string;
  episode_title: string;
  from: 'active' | 'done';
}

/** 완료·실패 잡의 애니별 그룹 (클라이언트 집계 — 서버는 updated_at desc 플랫 리스트). */
interface DoneGroup {
  anime_id: number;
  title: string;
  cover: string | null;
  completed: number;
  failed: number;
  jobs: QueueCompletedJob[];
}

/** 애니 그룹 카드 (진행 중/완료·실패 공용, 구 queue-group-card). 카드 클릭=회차 뷰,
    포스터 클릭=애니 상세 모달. progressPct는 진행 중 탭의 전체 진행률 바. */
function GroupCard({
  title,
  cover,
  meta,
  badgeStatus,
  progressPct,
  index,
  onOpen,
  onOpenAnime,
}: {
  title: string;
  cover: string | null;
  meta: string;
  badgeStatus?: string;
  progressPct?: number;
  index: number;
  onOpen: () => void;
  onOpenAnime: () => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ ...tweenFast, delay: Math.min(index, 5) * 0.04 }}
      className={styles.groupCard}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen();
      }}
    >
      <div className={styles.groupRow}>
        <div
          className={styles.groupPoster}
          role="button"
          tabIndex={0}
          aria-label={`${title} 상세 보기`}
          onClick={(e) => {
            e.stopPropagation();
            onOpenAnime();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation();
              onOpenAnime();
            }
          }}
        >
          {cover ? <img src={cover} alt="" loading="lazy" /> : null}
        </div>
        <div className={styles.groupInfo}>
          <div className={styles.groupTop}>
            <span className={styles.groupTitle}>{title}</span>
            {badgeStatus && (
              <span className={`${styles.statusBadge} ${statusClass(badgeStatus)}`}>
                {statusLabel(badgeStatus)}
              </span>
            )}
          </div>
          <p className={styles.groupMeta}>{meta}</p>
        </div>
      </div>
      {progressPct !== undefined && (
        <div className={styles.progressTrack} style={{ marginTop: 'var(--space-2)' }}>
          <div className={styles.progressFill} style={{ width: `${progressPct}%` }} />
        </div>
      )}
    </motion.div>
  );
}

/** 진행 중 2단계 — 회차 카드 (구 queue-episode-card). 진행률/message는 /jobs 폴 데이터 사용. */
function EpisodeCard({
  job,
  index,
  animeTitle,
  busy,
  onOpenLog,
  onStop,
}: {
  job: QueueJob;
  index: number;
  animeTitle: string;
  busy: boolean;
  onOpenLog: () => void;
  onStop: () => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ ...tweenFast, delay: Math.min(index, 5) * 0.04 }}
      className={styles.jobCard}
      role="button"
      tabIndex={0}
      onClick={onOpenLog}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpenLog();
      }}
    >
      <div className={styles.jobTop}>
        <span className={styles.jobEp} title={`${animeTitle} — ${job.episode_title}`}>
          {episodeLabel(job)}
          {job.is_test ? ' (테스트)' : ''}
        </span>
        <span className={`${styles.statusBadge} ${statusClass(job.status)}`}>
          {statusLabel(job.status)}
        </span>
      </div>
      <p className={styles.jobMessage}>{job.message}</p>
      <div className={styles.progressTrack}>
        <div
          className={styles.progressFill}
          style={{ width: `${Math.min(100, Math.max(0, job.progress))}%` }}
        />
      </div>
      <div className={styles.jobActions}>
        <button
          type="button"
          className={`${styles.jobBtn} ${styles.jobBtnDanger}`}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onStop();
          }}
        >
          {busy ? '중지 중…' : '중지'}
        </button>
      </div>
    </motion.div>
  );
}

/** 완료·실패 회차 카드 (그룹 드릴다운 2단계) — 애니 제목은 그룹 헤더가 담당. */
function DoneCard({
  job,
  index,
  retryBusy,
  onOpenLog,
  onRetry,
}: {
  job: QueueCompletedJob;
  index: number;
  retryBusy: boolean;
  onOpenLog: () => void;
  onRetry: () => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ ...tweenFast, delay: Math.min(index, 5) * 0.04 }}
      className={styles.jobCard}
      role="button"
      tabIndex={0}
      onClick={onOpenLog}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpenLog();
      }}
    >
      <div className={styles.jobTop}>
        <span className={styles.jobEp}>{episodeLabel(job)}</span>
        <span className={`${styles.statusBadge} ${statusClass(job.status)}`}>
          {statusLabel(job.status)}
        </span>
      </div>
      {/* 완료 잡의 message는 "완료" 문자열이라 배지와 중복 — 숨김 */}
      {job.message && job.status !== 'completed' && (
        <p className={styles.jobMessage}>{job.message}</p>
      )}
      <div className={styles.jobFooter}>
        <span className={styles.jobTime}>{dateTime(job.updated_at)}</span>
        {job.status === 'failed' && (
          <button
            type="button"
            className={styles.jobBtn}
            disabled={retryBusy}
            onClick={(e) => {
              e.stopPropagation();
              onRetry();
            }}
          >
            {retryBusy ? '재시도 중…' : '재시도'}
          </button>
        )}
      </div>
    </motion.div>
  );
}

/** 3단계 — 로그 뷰 (구 queue-log-view). 전체/인코딩 진행 바 + 설정한 메타만 + 로그 박스. */
function LogView({
  target,
  stopBusy,
  retryBusy,
  onBack,
  onStop,
  onRetry,
}: {
  target: LogTarget;
  stopBusy: boolean;
  retryBusy: boolean;
  onBack: () => void;
  onStop: () => void;
  onRetry: () => void;
}) {
  const { detail, encodePct } = useJobDetail(
    target.jobId,
    target.from === 'active' ? 'poll' : 'once',
  );

  const status = detail?.status ?? null;
  const progress = detail?.progress ?? 0;
  const message = detail?.message ?? '';

  const metaParts: string[] = [];
  if (detail?.encoder) metaParts.push(`인코딩 ${detail.encoder}`);
  if (detail?.source_type) {
    const source = SOURCE_LABEL[detail.source_type] ?? detail.source_type;
    metaParts.push(detail.source_name ? `원본: ${source} (${detail.source_name})` : `원본: ${source}`);
  }
  if (detail && detail.trim_seconds > 0) metaParts.push(`앞부분 자르기 ${detail.trim_seconds}s`);
  if (detail && detail.subtitle_offset !== 0) metaParts.push(`자막 싱크 ${detail.subtitle_offset}s`);

  const isFinished = status === 'completed' || status === 'failed';

  return (
    <div className={styles.logView}>
      <button type="button" className={styles.backBtn} onClick={onBack}>
        ← {target.from === 'active' ? '에피소드 목록' : '애니 목록'}
      </button>
      <div className={styles.logHeader}>
        <h3 className={styles.logTitle}>
          {target.animeTitle} · {episodeLabel(target)}
        </h3>
        {status ? (
          <span className={`${styles.statusBadge} ${statusClass(status)}`}>
            {statusLabel(status)}
          </span>
        ) : (
          <Skeleton
            width={52}
            height={22}
            style={{ flex: 'none', borderRadius: 'var(--radius-pill)' }}
          />
        )}
      </div>
      <FadeSwap loading={!detail} skeleton={<LogDetailSkeleton />} animateHeight>
        <>
          {message && <p className={styles.jobMessage}>{message}</p>}
          <div className={styles.jobCard}>
            <div className={styles.progressBlock}>
              <div className={styles.progressLabelRow}>
                <span>전체 진행</span>
                <span>{progress}%</span>
              </div>
              <div className={styles.progressTrack}>
                <div className={styles.progressFill} style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
              </div>
            </div>
            <div className={styles.progressBlock}>
              <div className={styles.progressLabelRow}>
                <span>인코딩 진행</span>
                <span>{encodePct}%</span>
              </div>
              <div className={styles.progressTrack}>
                <div className={styles.progressFill} style={{ width: `${Math.min(100, Math.max(0, encodePct))}%` }} />
              </div>
            </div>
            {metaParts.length > 0 && <p className={styles.jobMeta}>{metaParts.join(' · ')}</p>}
          </div>
        </>
      </FadeSwap>
      <JobLog jobId={target.jobId} once={target.from === 'done'} />
      <div className={styles.jobActions}>
        {status === 'failed' ? (
          <button
            type="button"
            className={styles.jobBtn}
            disabled={retryBusy}
            onClick={() => onRetry()}
          >
            {retryBusy ? '재시도 중…' : '재시도'}
          </button>
        ) : (
          !isFinished && status != null && (
            <button
              type="button"
              className={`${styles.jobBtn} ${styles.jobBtnDanger}`}
              disabled={stopBusy}
              onClick={() => onStop()}
            >
              {stopBusy ? '중지 중…' : '중지'}
            </button>
          )
        )}
      </div>
    </div>
  );
}

/** 로그 뷰 상세 스켈레톤 — 실제 블록(message 줄 + 진행 바 카드)과 같은 모양. */
function LogDetailSkeleton() {
  return (
    <>
      <Skeleton height={14} width="50%" style={{ marginBottom: 'var(--space-2)' }} />
      <div className={styles.jobCard}>
        {[0, 1].map((i) => (
          <div key={i} className={styles.progressBlock}>
            <Skeleton height={10} width={84} style={{ marginBottom: 5 }} />
            <Skeleton height={5} width="100%" />
          </div>
        ))}
        <Skeleton height={10} width="38%" style={{ marginTop: 'var(--space-2)' }} />
      </div>
    </>
  );
}

interface QueueModalProps {
  open: boolean;
  onClose: () => void;
}

/** 관리자 대기열 모달 — /api/jobs 3초 폴. 양 탭 모두 3뷰 드릴다운:
    애니 그룹 카드 → 회차 카드 → 로그 뷰 (진행 중 / 완료·실패). */
export function QueueModal({ open, onClose }: QueueModalProps) {
  const [data, setData] = useState<QueueStatusResponse | null>(null);
  const [tab, setTab] = useState<'active' | 'done'>('active');
  const [animeId, setAnimeId] = useState<number | null>(null);
  const [logTarget, setLogTarget] = useState<LogTarget | null>(null);
  const [stopBusyId, setStopBusyId] = useState<number | null>(null);
  const [retryBusyId, setRetryBusyId] = useState<number | null>(null);
  const viewWrapRef = useRef<HTMLDivElement>(null);

  const poll = useCallback(async () => {
    try {
      setData(await get<QueueStatusResponse>('/jobs'));
    } catch {
      /* 폴릴 실패는 다음 틱에 재시도 */
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [open, poll]);

  const groups = data?.groups ?? [];
  const completed = data?.completed ?? [];

  // 완료·실패 잡을 애니별로 그룹핑 (서버 응답은 updated_at desc 플랫 — 첫 잡이 그룹 최신)
  const doneGroups = useMemo<DoneGroup[]>(() => {
    const map = new Map<number, DoneGroup>();
    for (const job of completed) {
      let g = map.get(job.anime_id);
      if (!g) {
        g = {
          anime_id: job.anime_id, title: job.anime_title, cover: job.cover,
          completed: 0, failed: 0, jobs: [],
        };
        map.set(job.anime_id, g);
      }
      g.jobs.push(job);
      if (job.status === 'completed') g.completed += 1;
      else g.failed += 1;
    }
    return [...map.values()];
  }, [completed]);

  // 회차 뷰 대상 애니가 폴 결과에서 사라지면(마지막 잡 완료·24h 윈도우 이탈 등) 그룹 뷰로 복귀
  useEffect(() => {
    if (animeId != null && open) {
      const inActive = groups.some((g) => g.anime_id === animeId);
      const inDone = doneGroups.some((g) => g.anime_id === animeId);
      if (!inActive && !inDone) setAnimeId(null);
    }
  }, [groups, doneGroups, animeId, open]);

  const activeGroup = animeId != null ? groups.find((g) => g.anime_id === animeId) ?? null : null;
  const doneGroup = animeId != null ? doneGroups.find((g) => g.anime_id === animeId) ?? null : null;

  const viewKey = logTarget
    ? `log-${logTarget.jobId}`
    : tab === 'active'
      ? activeGroup
        ? `eps-${animeId}`
        : 'groups'
      : doneGroup
        ? `done-eps-${animeId}`
        : 'done-groups';

  // 뷰 전환 시 뷰 래퍼(스크롤 컨테이너)를 맨 위로
  useEffect(() => {
    viewWrapRef.current?.scrollTo({ top: 0 });
  }, [viewKey]);

  const goTab = (next: 'active' | 'done') => {
    setTab(next);
    setAnimeId(null);
    setLogTarget(null);
  };

  // 로그 뷰에서도 진입한 탭의 active를 유지 (뷰 깊이와 무관하게 소속 탭 표시)
  const effectiveTab = logTarget ? logTarget.from : tab;

  // 그룹 카드 포스터 → 애니 상세 모달 (/anime/:id 라우트 모달, background 규약).
  // 모달이 닫혀 이 경로로 돌아오면 TopNavbar가 대기열을 다시 열게 origin을 기록.
  const navigate = useNavigate();
  const location = useLocation();
  const setQueueReopenOrigin = useUiStore((s) => s.setQueueReopenOrigin);
  const openAnimeDetail = useCallback(
    (id: number) => {
      onClose();
      setQueueReopenOrigin(location.pathname + location.search + location.hash);
      navigate(`/anime/${id}`, { state: { background: location } });
    },
    [navigate, location, onClose, setQueueReopenOrigin],
  );

  const openLog = (job: QueueJob | QueueCompletedJob, animeTitle: string, from: 'active' | 'done') => {
    setLogTarget({
      jobId: job.job_id,
      animeTitle,
      episode_number: job.episode_number,
      episode_title: job.episode_title,
      from,
    });
  };

  const requestStop = async (
    jobId: number,
    animeTitle: string,
    ep: { episode_number: string; episode_title: string },
  ) => {
    if (
      !(await dialog.confirm(
        `[${animeTitle}] ${episodeLabel(ep)} 작업을 중지합니다. 진행 중인 인코딩이 실패 처리됩니다.`,
        { confirmLabel: '중지', danger: true },
      ))
    ) {
      return;
    }
    setStopBusyId(jobId);
    try {
      await post(`/jobs/${jobId}/stop`);
      await poll();
    } finally {
      setStopBusyId(null);
    }
  };

  const retry = async (jobId: number) => {
    setRetryBusyId(jobId);
    try {
      await post(`/jobs/${jobId}/retry`);
      await poll();
      // 재시도한 잡은 완료 목록을 떠나 활성으로 이동 — 로그 뷰 닫고 목록으로
      if (logTarget?.jobId === jobId) setLogTarget(null);
    } finally {
      setRetryBusyId(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="대기열" size="lg">
      <div className={styles.modalTabs}>
        <button
          type="button"
          className={`${styles.modalTab}${effectiveTab === 'active' ? ` ${styles.modalTabActive}` : ''}`}
          onClick={() => goTab('active')}
        >
          진행 중 ({groups.reduce((n, g) => n + g.episodes.length, 0)})
        </button>
        <button
          type="button"
          className={`${styles.modalTab}${effectiveTab === 'done' ? ` ${styles.modalTabActive}` : ''}`}
          onClick={() => goTab('done')}
        >
          완료·실패 ({completed.length})
        </button>
      </div>

      <div ref={viewWrapRef} className={styles.viewWrap}>
        <AnimatePresence mode="wait">
          <motion.div
            key={viewKey}
            initial={{ opacity: 0, x: 14 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={tweenFast}
          >
            {logTarget ? (
              <LogView
                target={logTarget}
                stopBusy={stopBusyId === logTarget.jobId}
                retryBusy={retryBusyId === logTarget.jobId}
                onBack={() => setLogTarget(null)}
                onStop={() => void requestStop(logTarget.jobId, logTarget.animeTitle, logTarget)}
                onRetry={() => void retry(logTarget.jobId)}
              />
            ) : tab === 'active' ? (
              activeGroup ? (
                <div className={styles.episodeList}>
                  <button type="button" className={styles.backBtn} onClick={() => setAnimeId(null)}>
                    ← 애니 목록
                  </button>
                  <div className={styles.groupHeader}>
                    <h3 className={styles.groupHeading}>{activeGroup.title}</h3>
                    <span className={styles.groupCount}>
                      {activeGroup.completed}/{activeGroup.total}개 처리 완료 ·{' '}
                      {activeGroup.episodes.length}개 진행 중
                    </span>
                  </div>
                  <AnimatePresence>
                    {activeGroup.episodes.map((job, i) => (
                      <EpisodeCard
                        key={job.job_id}
                        job={job}
                        index={i}
                        animeTitle={activeGroup.title}
                        busy={stopBusyId === job.job_id}
                        onOpenLog={() => openLog(job, activeGroup.title, 'active')}
                        onStop={() => void requestStop(job.job_id, activeGroup.title, job)}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              ) : groups.length === 0 ? (
                <div className={styles.empty}>진행 중인 작업이 없습니다.</div>
              ) : (
                <AnimatePresence>
                  {groups.map((g, i) => (
                    <GroupCard
                      key={g.anime_id}
                      title={g.title}
                      cover={g.cover}
                      meta={`${g.completed}/${g.total}개 처리 완료 · ${g.episodes.length}개 진행 중`}
                      badgeStatus={g.episodes[0]?.status}
                      progressPct={
                        g.episodes.length
                          ? Math.round(
                              g.episodes.reduce(
                                (n, ep) => n + Math.min(100, Math.max(0, ep.progress)),
                                0,
                              ) / g.episodes.length,
                            )
                          : 0
                      }
                      index={i}
                      onOpen={() => setAnimeId(g.anime_id)}
                      onOpenAnime={() => openAnimeDetail(g.anime_id)}
                    />
                  ))}
                </AnimatePresence>
              )
            ) : doneGroup ? (
              <div className={styles.episodeList}>
                <button type="button" className={styles.backBtn} onClick={() => setAnimeId(null)}>
                  ← 애니 목록
                </button>
                <div className={styles.groupHeader}>
                  <h3 className={styles.groupHeading}>{doneGroup.title}</h3>
                  <span className={styles.groupCount}>
                    완료 {doneGroup.completed}개 · 실패 {doneGroup.failed}개
                  </span>
                </div>
                <AnimatePresence>
                  {doneGroup.jobs.map((job, i) => (
                    <DoneCard
                      key={job.job_id}
                      job={job}
                      index={i}
                      retryBusy={retryBusyId === job.job_id}
                      onOpenLog={() => openLog(job, doneGroup.title, 'done')}
                      onRetry={() => void retry(job.job_id)}
                    />
                  ))}
                </AnimatePresence>
              </div>
            ) : doneGroups.length === 0 ? (
              <div className={styles.empty}>최근 24시간 내 완료/실패한 작업이 없습니다.</div>
            ) : (
              <AnimatePresence>
                {doneGroups.map((g, i) => {
                  const parts = [`완료 ${g.completed}개`, `실패 ${g.failed}개`];
                  const latest = dateTime(g.jobs[0]?.updated_at);
                  if (latest) parts.push(latest);
                  return (
                    <GroupCard
                      key={g.anime_id}
                      title={g.title}
                      cover={g.cover}
                      meta={parts.join(' · ')}
                      badgeStatus={g.jobs[0]?.status}
                      index={i}
                      onOpen={() => setAnimeId(g.anime_id)}
                      onOpenAnime={() => openAnimeDetail(g.anime_id)}
                    />
                  );
                })}
              </AnimatePresence>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </Modal>
  );
}
