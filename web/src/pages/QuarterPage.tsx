import { motion } from 'framer-motion';
import { useQuarters } from '../api/hooks';
import type { QuarterGroup } from '../api/types';
import { QuarterCard, QuarterCardEmpty, QuarterCardSkeleton } from '../components/quarter/QuarterCard';
import { Skeleton } from '../components/Spinner';
import overviewStyles from '../components/quarter/quarter-overview.module.css';
import styles from './pages.module.css';

/** 분기 아카이브 (/quarter) — index.php quarter 탭 대응: 연도별 섹션 + 4분기 카드 */
export function QuarterPage() {
  const { data: quarters, isLoading, isError } = useQuarters();

  const now = new Date();
  const nowYear = now.getFullYear();
  const nowQuarter = Math.floor(now.getMonth() / 3) + 1;

  // year desc → quarter asc 그루핑
  const byYear = new Map<number, Map<number, QuarterGroup>>();
  for (const g of quarters ?? []) {
    if (!byYear.has(g.year)) byYear.set(g.year, new Map());
    byYear.get(g.year)!.set(g.quarter, g);
  }
  const years = [...byYear.keys()].sort((a, b) => b - a);

  return (
    <div className="container">
      <div className={styles.header}>
        <h1 className={styles.title}>방영 분기</h1>
      </div>
      {isLoading ? (
        // 연도 섹션 2개 분량의 스켈레톤 (스피너 대신 실제 레이아웃 형태로)
        <>
          {[0, 1].map((s) => (
            <section key={s} className={overviewStyles.yearSection} aria-hidden="true">
              <div className={overviewStyles.yearHead}>
                <Skeleton height={26} style={{ width: 90 }} />
                <Skeleton height={14} style={{ width: 64 }} />
              </div>
              <div className={overviewStyles.cardGrid}>
                {[1, 2, 3, 4].map((q) => (
                  <QuarterCardSkeleton key={q} />
                ))}
              </div>
            </section>
          ))}
        </>
      ) : isError ? (
        <div className={styles.placeholder}>목록을 불러오지 못했습니다.</div>
      ) : years.length === 0 ? (
        <div className={styles.placeholder}>등록된 애니가 없습니다.</div>
      ) : (
        years.map((year) => {
          const map = byYear.get(year)!;
          const yearTotal = [...map.values()].reduce((acc, g) => acc + g.count, 0);
          return (
            <motion.section
              key={year}
              className={overviewStyles.yearSection}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
            >
              <div className={overviewStyles.yearHead}>
                <h2 className={overviewStyles.yearTitle}>
                  {year}
                  <span>년</span>
                </h2>
                <span className={overviewStyles.yearTotal}>{yearTotal}개 작품</span>
              </div>
              <div className={overviewStyles.cardGrid}>
                {[1, 2, 3, 4].map((q) =>
                  map.has(q) ? (
                    <QuarterCard
                      key={q}
                      group={map.get(q)!}
                      isCurrent={year === nowYear && q === nowQuarter}
                    />
                  ) : (
                    <QuarterCardEmpty key={q} quarter={q} />
                  ),
                )}
              </div>
            </motion.section>
          );
        })
      )}
    </div>
  );
}
