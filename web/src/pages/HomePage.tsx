import { useEffect, useRef } from 'react';
import { useAnimesInfinite } from '../api/hooks';
import { AnimeGrid, AnimeGridSkeleton } from '../components/home/AnimeGrid';
import styles from './pages.module.css';

/** 홈 무한스크롤 — index.php 홈 탭 대응 (IntersectionObserver 센티넬 + offset 페이지네이션) */
export function HomePage() {
  const { data, isLoading, isError, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useAnimesInfinite();
  const sentinelRef = useRef<HTMLDivElement>(null);
  // 스크롤 복원은 전역 훅(useScrollRestoration, App.tsx)이 담당

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: '400px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const animes = data?.pages.flatMap((p) => p.animes) ?? [];
  const total = data?.pages[0]?.total ?? 0;

  return (
    <div className="container">
      <div className={styles.header}>
        <h1 className={styles.title}>홈</h1>
        {total > 0 && <p className={styles.subtitle}>{total}개 작품</p>}
      </div>
      {isLoading ? (
        <AnimeGridSkeleton count={15} />
      ) : isError ? (
        <div className={styles.placeholder}>목록을 불러오지 못했습니다.</div>
      ) : animes.length === 0 ? (
        <div className={styles.placeholder}>등록된 애니가 없습니다.</div>
      ) : (
        <>
          <AnimeGrid animes={animes} />
          <div ref={sentinelRef} className={styles.sentinel} />
          {/* 다음 페이지 로딩 중에는 그리드 끝에 스켈레톤 카드를 이어붙인다 (스피너 대신) */}
          {isFetchingNextPage && <AnimeGridSkeleton count={6} />}
          {!hasNextPage && <div className={styles.end}>모든 작품을 불러왔습니다.</div>}
        </>
      )}
    </div>
  );
}
