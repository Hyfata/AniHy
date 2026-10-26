import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { useQuarterDetail, useQuarters } from '../../api/hooks';
import { tweenFast } from '../../lib/motion';
import { Skeleton } from '../Spinner';
import { FadeSwap } from '../FadeSwap';
import { pickCurrentQuarter } from './currentQuarter';
import { PosterRow, PosterRowSkeleton } from './PosterRow';
import { SectionHeader } from './SectionHeader';
import sectionStyles from './SectionHeader.module.css';
import styles from './WeeklySection.module.css';

const DAY_ORDER = ['월', '화', '수', '목', '금', '토', '일'];
const todayDay = () => ['일', '월', '화', '수', '목', '금', '토'][new Date().getDay()];

/** Home "this quarter" section — day-of-week tabs (defaults to today) + poster row of the
   selected day. Fetches the quarter detail once without the day param; tab switches filter
   client-side. */
export function WeeklySection() {
  const { data: quarters, isLoading: quartersLoading, isError: quartersError } = useQuarters();
  const current = pickCurrentQuarter(quarters);
  const year = current?.group.year ?? 0;
  const quarter = current?.group.quarter ?? 0;
  const { data, isLoading, isError } = useQuarterDetail(year, quarter);
  const [day, setDay] = useState(todayDay);

  if (quartersError || (!quartersLoading && !current)) return null;

  const animes = data?.animes ?? [];
  const hasEtc = animes.some((a) => !DAY_ORDER.includes(a.broadcast_day));
  const tabs = hasEtc ? [...DAY_ORDER, '기타'] : DAY_ORDER;
  const filtered = animes.filter(
    (a) => (DAY_ORDER.includes(a.broadcast_day) ? a.broadcast_day : '기타') === day,
  );
  const today = todayDay();
  const title = !current || current.isCurrent ? '이번 분기 신작' : `${year}년 ${quarter}분기`;

  return (
    <section className={sectionStyles.section}>
      <SectionHeader
        title={title}
        moreTo={current ? `/quarter/${year}/${quarter}` : undefined}
      />
      <FadeSwap
        loading={quartersLoading || !current || isLoading}
        skeleton={
          <>
            <Skeleton height={34} style={{ width: 320, maxWidth: '100%', marginBottom: 'var(--space-4)' }} />
            <PosterRowSkeleton />
          </>
        }
      >
        {isError ? (
          <p className={styles.empty}>목록을 불러오지 못했습니다.</p>
        ) : (
          <>
          <div className={styles.tabs} role="tablist">
            {tabs.map((d) => (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={day === d}
                className={`${styles.tab}${day === d ? ` ${styles.tabActive}` : ''}`}
                onClick={() => setDay(d)}
              >
                {d}
                {d === today && <span className={styles.todayDot} title="오늘" />}
              </button>
            ))}
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={day}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={tweenFast}
            >
              {filtered.length > 0 ? (
                <PosterRow animes={filtered} />
              ) : (
                <p className={styles.empty}>이 요일에 방영하는 작품이 없습니다.</p>
              )}
            </motion.div>
          </AnimatePresence>
        </>
        )}
      </FadeSwap>
    </section>
  );
}
