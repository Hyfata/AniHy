import { useEffect, useRef } from 'react';
import { useAnimesInfinite } from '../api/hooks';
import { AnimeGrid, AnimeGridSkeleton } from '../components/home/AnimeGrid';
import styles from './pages.module.css';

const SCROLL_KEY = 'anihy_home_scroll';

/** 홈 무한스크롤 — index.php 홈 탭 대응 (IntersectionObserver 센티넬 + offset 페이지네이션) */
export function HomePage() {
  const { data, isLoading, isError, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useAnimesInfinite();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const restoredRef = useRef(false);

  // 스크롤 복원: 상세 다녀오면 위치 유지 (SPA에서는 from/ly 규약 대신 sessionStorage)
  useEffect(() => {
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved && !restoredRef.current) {
      restoredRef.current = true;
      // 콘텐츠가 렌더된 뒤 복원
      requestAnimationFrame(() => window.scrollTo(0, Number(saved)));
    }
    return () => {
      sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
    };
  }, []);

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
