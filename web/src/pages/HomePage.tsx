import { useEffect, useRef } from 'react';
import { useAnimesInfinite } from '../api/hooks';
import { AnimeGrid, AnimeGridSkeleton } from '../components/home/AnimeGrid';
import { HomeHero } from '../components/home/HomeHero';
import { PosterRow, PosterRowSkeleton } from '../components/home/PosterRow';
import { SectionHeader } from '../components/home/SectionHeader';
import sectionStyles from '../components/home/SectionHeader.module.css';
import { WeeklySection } from '../components/home/WeeklySection';
import { relativeTime } from '../lib/format';
import styles from './pages.module.css';

const RECENT_ROW_SIZE = 15;

/** Home — streaming-site layout: hero (current quarter) + weekly row + recent updates + the full infinite grid. */
export function HomePage() {
  const { data, isLoading, isError, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useAnimesInfinite();
  const sentinelRef = useRef<HTMLDivElement>(null);
  // scroll restoration is handled by the global hook (useScrollRestoration, App.tsx)

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

  // Recent updates: latest_episode_at desc within the loaded pages. /api/animes is created_at
  // desc, so the row refreshes automatically as later pages load (derived without a new API).
  const recent = animes
    .filter((a) => a.latest_episode_at)
    .sort((a, b) => Date.parse(b.latest_episode_at!) - Date.parse(a.latest_episode_at!))
    .slice(0, RECENT_ROW_SIZE);

  return (
    <div className="container">
      <HomeHero />
      <WeeklySection />

      {isLoading ? (
        <section className={sectionStyles.section}>
          <SectionHeader title="최근 업데이트" />
          <PosterRowSkeleton />
        </section>
      ) : (
        recent.length > 0 && (
          <section className={sectionStyles.section}>
            <SectionHeader title="최근 업데이트" />
            <PosterRow
              animes={recent}
              subLabel={(a) => `${relativeTime(a.latest_episode_at)} 업데이트`}
            />
          </section>
        )
      )}

      <section className={sectionStyles.section}>
        <SectionHeader title="전체 애니" meta={total > 0 ? `${total}개 작품` : undefined} />
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
            {/* append skeleton cards at the grid end while fetching the next page (no spinner) */}
            {isFetchingNextPage && <AnimeGridSkeleton count={6} />}
            {!hasNextPage && <div className={styles.end}>모든 작품을 불러왔습니다.</div>}
          </>
        )}
      </section>
    </div>
  );
}
