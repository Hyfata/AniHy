import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Episode } from '../api/types';
import { hasRecentEpisode, useNewBadgeWindowMs } from '../lib/recency';
import styles from './EpisodeRow.module.css';

interface EpisodeRowProps {
  animeId: number;
  episode: Episode;
  /** 현재 재생 중 회차 (watch 페이지 사이드바) */
  active?: boolean;
  /** 다운로드 버튼 등 우측 액션 슬롯 */
  actions?: ReactNode;
  onClick?: () => void;
}

/** 회차 행: 썸네일 + 번호 뱃지 + 제목 + 영상 시간 서브메타 + 하단 시청 진행 바.
   진행률은 서버 응답의 episode.watch_progress.ratio (0~1)로 채운다. */
export function EpisodeRow({ animeId, episode, active = false, actions, onClick }: EpisodeRowProps) {
  const ratio = episode.watch_progress?.ratio ?? 0;
  const newWindowMs = useNewBadgeWindowMs();
  const inner = (
    <>
      <div className={styles.meta}>
        <div className={styles.thumb}>
          {episode.thumb_url ? <img src={episode.thumb_url} alt="" loading="lazy" /> : null}
          {hasRecentEpisode(episode.created_at, newWindowMs) && <span className={styles.newBadge}>New</span>}
          <span className={styles.thumbBadge}>{episode.episode_number}</span>
        </div>
        <div className={styles.text}>
          <span className={styles.title}>{episode.title || `${episode.episode_number}화`}</span>
          {episode.duration_text && <span className={styles.submeta}>{episode.duration_text}</span>}
        </div>
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
      {ratio > 0 && (
        <div className={styles.progressBar}>
          <div
            className={styles.progressFill}
            style={{ width: `${Math.min(ratio, 1) * 100}%` }}
          />
        </div>
      )}
    </>
  );

  const className = `${styles.item}${active ? ` ${styles.itemActive}` : ''}`;

  if (onClick) {
    return (
      <div className={className} onClick={onClick} role="button" tabIndex={0}>
        {inner}
      </div>
    );
  }
  return (
    <Link to={`/watch/${animeId}/${encodeURIComponent(episode.episode_number)}`} className={className}>
      {inner}
    </Link>
  );
}
