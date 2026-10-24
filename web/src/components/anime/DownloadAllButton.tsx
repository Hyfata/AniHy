import { useEffect, useRef, useState } from 'react';
import { API_BASE, get, post } from '../../api/client';
import type { Episode, ZipJob } from '../../api/types';
import { formatSpeed } from '../../lib/format';
import { cancelDownload, downloadAll, isNative } from '../../lib/native';
import { useDownloadsStore } from '../../stores/downloads';
import { dialog } from '../../stores/dialog';
import { ProgressRing } from '../ProgressRing';

interface DownloadAllButtonProps {
  animeId: number;
  className: string;
  children: React.ReactNode;
  /** 네이티브 전체 다운로드용 — 없으면 네이티브에서도 ZIP 경로로 폴팩 */
  animeTitle?: string;
  coverUrl?: string | null;
  episodes?: Episode[];
}

/** 전체 다운로드 (구 #download-all-btn 대응).
   웹: POST /api/downloads/bundle/{id} → 1초 폴 progress → done이면 file URL로 이동.
   네이티브: 회차별 순차 저장 (Rust download_all, ZIP 아님) + n/N · pct · 속도 라벨,
   진행 중 재탭 시 전체 취소 확인 (구 native-bridge 규약). */
export function DownloadAllButton({
  animeId,
  className,
  children,
  animeTitle,
  coverUrl,
  episodes,
}: DownloadAllButtonProps) {
  if (isNative() && animeTitle && episodes) {
    return (
      <NativeDownloadAll
        animeId={animeId}
        animeTitle={animeTitle}
        coverUrl={coverUrl ?? null}
        episodes={episodes}
        className={className}
      >
        {children}
      </NativeDownloadAll>
    );
  }
  return <WebZipDownload animeId={animeId} className={className}>{children}</WebZipDownload>;
}

// ---------- 네이티브: 회차별 순차 저장 ----------

interface NativeDownloadAllProps extends DownloadAllButtonProps {
  animeTitle: string;
  coverUrl: string | null;
  episodes: Episode[];
}

function NativeDownloadAll({
  animeId,
  animeTitle,
  coverUrl,
  episodes,
  className,
  children,
}: NativeDownloadAllProps) {
  const active = useDownloadsStore((s) => s.active);
  const downloaded = useDownloadsStore((s) => s.downloaded);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);

  const prefix = `${animeId}/`;
  const activeEntries = Object.entries(active).filter(([k]) => k.startsWith(prefix));
  const doneCount = episodes.filter(
    (e) => downloaded[`${animeId}/${e.episode_number}`],
  ).length;
  const total = episodes.length;
  const inFlight = activeEntries.length > 0;
  const showProgress = running || inFlight;

  // 진행률 집계: 완료 회차 + 현재 진행 중 회차의 pct
  const current = activeEntries[0]?.[1];
  const overall = total > 0 ? (doneCount + (current?.pct ?? 0)) / total : 0;

  // 모든 회차 완료 시 running 해제
  useEffect(() => {
    if (running && !inFlight && doneCount >= total) {
      setRunning(false);
    }
  }, [running, inFlight, doneCount, total]);

  const onClick = async () => {
    if (busy) return;
    if (showProgress) {
      if (await dialog.confirm('전체 다운로드를 취소할까요?', { confirmLabel: '취소하기', danger: true })) {
        setBusy(true);
        try {
          await cancelDownload(animeId);
        } finally {
          setBusy(false);
          setRunning(false);
        }
      }
      return;
    }
    const remaining = episodes.filter(
      (e) => !downloaded[`${animeId}/${e.episode_number}`],
    );
    if (remaining.length === 0) return;
    if (!(await dialog.confirm(`${remaining.length}개 회차를 기기에 저장할까요?`))) return;
    setBusy(true);
    try {
      await downloadAll(
        animeId,
        animeTitle,
        remaining.map((e) => ({ episodeNumber: e.episode_number, title: e.title })),
        coverUrl,
      );
      setRunning(true);
    } catch (err) {
      await dialog.alert(err instanceof Error ? err.message : '다운로드를 시작할 수 없습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className={className} disabled={busy} onClick={() => void onClick()}>
      {showProgress ? (
        <>
          <ProgressRing progress={overall} />
          <span>
            {doneCount}/{total}
            {current ? ` · ${Math.round(current.pct * 100)}% · ${formatSpeed(current.bytesPerSec)}` : ''}
          </span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

// ---------- 웹: 서버 ZIP ----------

function WebZipDownload({ animeId, className, children }: DownloadAllButtonProps) {
  const [percent, setPercent] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => stopPolling, []);

  const reset = (delay = 0) => {
    if (delay > 0) {
      setTimeout(() => setPercent(null), delay);
    } else {
      setPercent(null);
    }
  };

  const poll = async () => {
    try {
      const data = await get<{ ok: boolean; job?: ZipJob; detail?: string }>(
        `/downloads/bundle/${animeId}/progress`,
      );
      const job = data.job;
      if (!job) return;
      if (job.status === 'done') {
        stopPolling();
        setPercent(100);
        window.location.href = `${API_BASE}/downloads/bundle/${animeId}/file`;
        reset(1500);
      } else if (job.status === 'failed') {
        stopPolling();
        reset();
        void dialog.alert(job.message || '압축에 실패했습니다.');
      } else {
        setPercent(job.percent ?? 0);
      }
    } catch {
      // 일시적 네트워크 오류는 다음 폴에서 재시도 (구 프론트 규약)
    }
  };

  const onClick = async () => {
    if (timerRef.current) return;
    if (!(await dialog.confirm('압축이 완료된 후 다운로드가 시작됩니다.\n한번 시작된 압축 작업은 취소할 수 없습니다.\n\n계속하시겠습니까?'))) {
      return;
    }
    setPercent(0);
    try {
      await post(`/downloads/bundle/${animeId}`);
      timerRef.current = setInterval(() => void poll(), 1000);
      void poll();
    } catch (err) {
      reset();
      await dialog.alert(err instanceof Error ? err.message : '압축을 시작할 수 없습니다.');
    }
  };

  return (
    <button type="button" className={className} disabled={percent !== null} onClick={() => void onClick()}>
      {percent !== null ? (
        <>
          <ProgressRing progress={percent / 100} />
          <span>{Math.round(percent)}%</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
