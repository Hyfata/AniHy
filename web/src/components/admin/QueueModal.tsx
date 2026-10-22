import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { get, post } from '../../api/client';
import type { JobProgress, QueueJob, QueueStatusResponse } from '../../api/types';
import { tweenFast } from '../../lib/motion';
import { Modal } from '../Modal';
import styles from './QueueModal.module.css';

const POLL_MS = 3000;
/** 로그 뷰어 자동 스크롤 하드 규약: 하단 40px 이내일 때만 따라감 (app.js fetchLog 계승) */
const LOG_AUTOSCROLL_THRESHOLD_PX = 40;

const STATUS_LABEL: Record<string, string> = {
  pending: '대기 중',
  downloading: '다운로드',
  encoding: '인코딩',
  completed: '완료',
  failed: '실패',
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

/** 잡 상세(progress/encoder/source 등) + 인코딩 % 폴릴 — 모달이 열린 동안 3초 간격. */
function useJobDetail(jobId: number, enabled: boolean) {
  const [detail, setDetail] = useState<JobProgress | null>(null);
  const [encodePct, setEncodePct] = useState(0);

  useEffect(() => {
    if (!enabled) return;
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
        /* 폴릴 실패는 다음 틱에 재시도 */
      }
    };
    void tick();
    const timer = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [jobId, enabled]);

  return { detail, encodePct };
}

/** 로그 뷰어 — offset 증분 append + 하단 40px 이내일 때만 자동 스크롤. */
function JobLog({ jobId }: { jobId: number }) {
  const boxRef = useRef<HTMLPreElement>(null);
  const offsetRef = useRef(0);
  const [content, setContent] = useState('');

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await get<{ content: string; offset: number; message?: string }>(
          `/jobs/${jobId}/log?offset=${offsetRef.current}`,
        );
        if (cancelled) return;
        offsetRef.current = res.offset;
        const append = res.content || (offsetRef.current === 0 && res.message ? res.message : '');
        if (append) {
          setContent((prev) => prev + append);
          const box = boxRef.current;
          if (box) {
            const nearBottom =
              box.scrollHeight - box.scrollTop - box.clientHeight <= LOG_AUTOSCROLL_THRESHOLD_PX;
            if (nearBottom) {
              // append 반영 후 스크롤
              requestAnimationFrame(() => {
                box.scrollTop = box.scrollHeight;
              });
            }
          }
        }
      } catch {
        /* 로그 폴릴 실패는 무시 */
      }
    };
    void tick();
    const timer = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [jobId]);

  return (
    <pre ref={boxRef} className={styles.logBox}>
      {content || '로그를 불러오는 중…'}
    </pre>
  );
}

function ActiveJobCard({
  job,
  animeTitle,
  modalOpen,
  onAction,
}: {
  job: QueueJob;
  animeTitle: string;
  modalOpen: boolean;
  onAction: () => void;
}) {
  const { detail, encodePct } = useJobDetail(job.job_id, modalOpen);
  const [logOpen, setLogOpen] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [busy, setBusy] = useState(false);

  const status = detail?.status ?? job.status;
  const progress = status === 'encoding' ? encodePct : (detail?.progress ?? job.progress);
  const message = detail?.message ?? job.message;
  const isTest = detail?.encoder?.includes('(테스트)');

  const metaParts: string[] = [];
  if (detail?.encoder) metaParts.push(detail.encoder);
  if (detail?.source_name) metaParts.push(detail.source_name);
  if (detail && detail.trim_seconds > 0) metaParts.push(`앞부분 자르기 ${detail.trim_seconds}s`);
  if (detail && detail.subtitle_offset !== 0) metaParts.push(`자막 싱크 ${detail.subtitle_offset}s`);

  const stop = async () => {
    setBusy(true);
    try {
      await post(`/jobs/${job.job_id}/stop`);
      setConfirmStop(false);
      onAction();
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    setBusy(true);
    try {
      await post(`/jobs/${job.job_id}/retry`);
      onAction();
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={tweenFast}
      className={`${styles.jobCard}${status === 'failed' ? ` ${styles.jobCardFailed}` : ''}`}
    >
      <div className={styles.jobTop}>
        <span className={styles.jobEp} title={`${animeTitle} — ${job.episode_title}`}>
          {job.episode_title}
          {isTest ? ' (테스트)' : ''}
        </span>
        <span className={`${styles.statusBadge} ${statusClass(status)}`}>
          {statusLabel(status)}
        </span>
      </div>
      <p className={styles.jobMessage}>{message}</p>
      {metaParts.length > 0 && <p className={styles.jobMeta}>{metaParts.join(' · ')}</p>}
      <div className={styles.progressTrack}>
        <div className={styles.progressFill} style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
      </div>
      <div className={styles.jobActions}>
        <button type="button" className={styles.jobBtn} onClick={() => setLogOpen((v) => !v)}>
          {logOpen ? '로그 닫기' : '로그'}
        </button>
        {status === 'failed' ? (
          <button type="button" className={styles.jobBtn} disabled={busy} onClick={() => void retry()}>
            재시도
          </button>
        ) : (
          <button
            type="button"
            className={`${styles.jobBtn} ${styles.jobBtnDanger}`}
            disabled={busy}
            onClick={() => setConfirmStop(true)}
          >
            중지
          </button>
        )}
      </div>
      {logOpen && <JobLog jobId={job.job_id} />}

      <Modal open={confirmStop} onClose={() => setConfirmStop(false)} title="작업 중지" size="sm">
        <p style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--text-md)' }}>
          [{animeTitle}] {job.episode_title} 작업을 중지합니다. 진행 중인 인코딩이 실패 처리됩니다.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <button type="button" className={styles.jobBtn} onClick={() => setConfirmStop(false)}>
            취소
          </button>
          <button
            type="button"
            className={`${styles.jobBtn} ${styles.jobBtnDanger}`}
            disabled={busy}
            onClick={() => void stop()}
          >
            {busy ? '중지 중…' : '중지'}
          </button>
        </div>
      </Modal>
    </motion.div>
  );
}

interface QueueModalProps {
  open: boolean;
  onClose: () => void;
}

/** 관리자 대기열 모달 — /api/jobs 3초 폴릴, 진행 중/완료·실패 탭. */
export function QueueModal({ open, onClose }: QueueModalProps) {
  const [data, setData] = useState<QueueStatusResponse | null>(null);
  const [tab, setTab] = useState<'active' | 'done'>('active');
  const [retryBusyId, setRetryBusyId] = useState<number | null>(null);

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

  const retry = async (jobId: number) => {
    setRetryBusyId(jobId);
    try {
      await post(`/jobs/${jobId}/retry`);
      await poll();
    } finally {
      setRetryBusyId(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="대기열">
      <div className={styles.modalTabs}>
        <button
          type="button"
          className={`${styles.modalTab}${tab === 'active' ? ` ${styles.modalTabActive}` : ''}`}
          onClick={() => setTab('active')}
        >
          진행 중 ({groups.reduce((n, g) => n + g.episodes.length, 0)})
        </button>
        <button
          type="button"
          className={`${styles.modalTab}${tab === 'done' ? ` ${styles.modalTabActive}` : ''}`}
          onClick={() => setTab('done')}
        >
          완료·실패 ({completed.length})
        </button>
      </div>

      {tab === 'active' ? (
        groups.length === 0 ? (
          <div className={styles.empty}>진행 중인 작업이 없습니다.</div>
        ) : (
          groups.map((g) => (
            <div key={g.anime_id} className={styles.groupBlock}>
              <div className={styles.groupHeader}>
                <h3 className={styles.groupTitle}>{g.title}</h3>
                <span className={styles.groupCount}>
                  최근 24시간 {g.completed}/{g.total} 완료
                </span>
              </div>
              <AnimatePresence>
                {g.episodes.map((job) => (
                  <ActiveJobCard
                    key={job.job_id}
                    job={job}
                    animeTitle={g.title}
                    modalOpen={open}
                    onAction={() => void poll()}
                  />
                ))}
              </AnimatePresence>
            </div>
          ))
        )
      ) : completed.length === 0 ? (
        <div className={styles.empty}>최근 24시간 내 완료/실패한 작업이 없습니다.</div>
      ) : (
        <AnimatePresence>
          {completed.map((job) => (
            <motion.div
              key={job.job_id}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={tweenFast}
              className={`${styles.jobCard}${job.status === 'failed' ? ` ${styles.jobCardFailed}` : ''}`}
            >
              <div className={styles.jobTop}>
                <span className={styles.jobEp}>
                  [{job.anime_title}] {job.episode_title}
                </span>
                <span className={`${styles.statusBadge} ${statusClass(job.status)}`}>
                  {statusLabel(job.status)}
                </span>
              </div>
              {job.message && <p className={styles.jobMessage}>{job.message}</p>}
              {job.status === 'failed' && (
                <div className={styles.jobActions}>
                  <button
                    type="button"
                    className={styles.jobBtn}
                    disabled={retryBusyId === job.job_id}
                    onClick={() => void retry(job.job_id)}
                  >
                    {retryBusyId === job.job_id ? '재시도 중…' : '재시도'}
                  </button>
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      )}
    </Modal>
  );
}
