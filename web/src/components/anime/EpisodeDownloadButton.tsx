import { useState } from 'react';
import type { Episode } from '../../api/types';
import { formatSpeed } from '../../lib/format';
import { cancelDownload, deleteDownload, downloadEpisode } from '../../lib/native';
import { dlKey, useDownloadsStore } from '../../stores/downloads';
import { dialog } from '../../stores/dialog';
import { ProgressRing } from '../ProgressRing';

interface EpisodeDownloadButtonProps {
  animeId: number;
  animeTitle: string;
  coverUrl: string | null;
  episode: Episode;
  className?: string;
}

/** 네이티브 전용 회차 다운로드 버튼.
   기본: 다운로드 아이콘 → 탭하면 저장 시작
   진행 중: 진행률 링 + % + 속도 → 탭하면 취소 확인
   완료: 체크 아이콘 → 탭하면 삭제 확인 */
export function EpisodeDownloadButton({
  animeId,
  animeTitle,
  coverUrl,
  episode,
  className,
}: EpisodeDownloadButtonProps) {
  const key = dlKey(animeId, episode.episode_number);
  const active = useDownloadsStore((s) => s.active[key]);
  const downloaded = useDownloadsStore((s) => s.downloaded[key]);
  const [busy, setBusy] = useState(false);

  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;

    if (active) {
      void (async () => {
        if (!(await dialog.confirm('다운로드를 취소할까요?', { confirmLabel: '취소하기', danger: true }))) return;
        setBusy(true);
        void cancelDownload(animeId, episode.episode_number).finally(() => setBusy(false));
      })();
      return;
    }
    if (downloaded) {
      void (async () => {
        if (!(await dialog.confirm('저장된 회차를 삭제할까요?', { confirmLabel: '삭제', danger: true }))) return;
        setBusy(true);
        void deleteDownload(animeId, episode.episode_number)
          .then(() => useDownloadsStore.getState().refresh())
          .finally(() => setBusy(false));
      })();
      return;
    }
    setBusy(true);
    void downloadEpisode(animeId, episode.episode_number, episode.title, animeTitle, {
      chaptersUrl: episode.chapters_url,
      coverUrl,
    })
      .catch((err: unknown) => void dialog.alert(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  const cls = className ?? '';
  if (active) {
    return (
      <button type="button" className={cls} onClick={onClick} aria-label="다운로드 취소">
        <ProgressRing progress={active.pct} size={18} />
        <span>
          {Math.round(active.pct * 100)}% · {formatSpeed(active.bytesPerSec)}
        </span>
      </button>
    );
  }
  if (downloaded) {
    return (
      <button type="button" className={cls} onClick={onClick} aria-label="저장본 삭제" title="저장됨 — 탭하여 삭제">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </button>
    );
  }
  return (
    <button type="button" className={cls} onClick={onClick} aria-label="회차 다운로드" disabled={busy}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
        <path d="M12 3v12" />
        <path d="m6 11 6 6 6-6" />
        <path d="M4 21h16" />
      </svg>
    </button>
  );
}
