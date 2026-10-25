import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { del, get, ApiError } from '../../api/client';
import type { Bookmark } from '../../api/types';
import { useAuthStore } from '../../stores/auth';
import { dialog } from '../../stores/dialog';
import { AnimeCard } from '../AnimeCard';
import { Skeleton } from '../Spinner';
import { LoginPrompt } from './LoginPrompt';
import styles from './library.module.css';

/** 보관함 > 북마크 — AnimeCard 그리드 + 호버/터치 해제 버튼.
   ['bookmarks'] 쿼리 캐시는 애니 상세 placeholder(포스터/제목 즉시 표시)에도 재사용된다. */
export function BookmarkTab() {
  const identity = useAuthStore((s) => s.identity);
  const queryClient = useQueryClient();
  const [removingId, setRemovingId] = useState<number | null>(null);

  const { data: items, error, isPending, refetch } = useQuery({
    queryKey: ['bookmarks'],
    queryFn: async () => (await get<{ bookmarks: Bookmark[] }>('/bookmarks')).bookmarks,
    // 보관함 진입 시 항상 최신 — 기본 staleTime(30s)에 걸리면 방금 한 북마크가 안 뜬다
    refetchOnMount: 'always',
  });

  const loginRequired =
    (error instanceof ApiError && error.status === 401) || (identity && !identity.logged_in);

  const unbookmark = async (animeId: number, title: string) => {
    if (!(await dialog.confirm(`'${title}' 북마크를 해제할까요?`, { confirmLabel: '해제' }))) return;
    setRemovingId(animeId);
    try {
      await del(`/bookmarks/${animeId}`);
      queryClient.setQueryData<Bookmark[]>(['bookmarks'], (prev) =>
        prev ? prev.filter((b) => b.id !== animeId) : prev,
      );
    } finally {
      setRemovingId(null);
    }
  };

  if (loginRequired) {
    return <LoginPrompt feature="북마크" />;
  }

  // 에러를 스켈레톤과 구분 — 이전엔 비401 에러도 `!items`라 무한 스켈레톤이었다
  if (error) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>북마크를 불러오지 못했습니다</p>
        <p className={styles.emptyDesc}>
          {error instanceof Error ? error.message : '알 수 없는 오류'}
        </p>
        <button type="button" className={styles.ctaBtn} onClick={() => void refetch()}>
          다시 시도
        </button>
      </div>
    );
  }

  if (isPending || !items) {
    return (
      <div className={styles.grid}>
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} style={{ aspectRatio: '2/3', borderRadius: 'var(--radius)' }} />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>북마크한 애니가 없습니다</p>
        <p className={styles.emptyDesc}>관심 있는 애니를 북마크하면 여기에 모아볼 수 있습니다.</p>
        <Link to="/" className={styles.ctaBtn}>
          애니 둘러보기
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.grid}>
      {items.map((b, i) => (
        <div key={b.id} className={styles.bookmarkItem}>
          <AnimeCard
            anime={{ id: b.id, title: b.title, cover: b.cover, latest_episode_at: b.latest_episode_at }}
            index={i}
          />
          <button
            type="button"
            className={`${styles.unbookmarkBtn}${removingId === b.id ? ` ${styles.removing}` : ''}`}
            aria-label={`${b.title} 북마크 해제`}
            title="북마크 해제"
            disabled={removingId === b.id}
            onClick={(e) => {
              e.preventDefault();
              void unbookmark(b.id, b.title);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
