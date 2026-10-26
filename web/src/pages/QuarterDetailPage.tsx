import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuarterDetail } from '../api/hooks';
import { AnimeGrid, AnimeGridSkeleton } from '../components/home/AnimeGrid';
import { FadeSwap } from '../components/FadeSwap';
import detailStyles from '../components/quarter/quarter-detail.module.css';
import { tweenFast } from '../lib/motion';
import styles from './pages.module.css';

const DAY_ORDER = ['월', '화', '수', '목', '금', '토', '일', '기타'];

/** 분기 상세 (/quarter/:year/:q) — quarter.php 대응: 요일 필터 칩 + 스티키 헤더 + 요일별 분류 토글 */
export function QuarterDetailPage() {
  const { year: rawYear, q: rawQ } = useParams();
  const year = Number(rawYear);
  const quarter = Number(rawQ);
  const [params, setParams] = useSearchParams();
  const day = params.get('day') ?? '';
  const [groupByDay, setGroupByDay] = useState(false);

  const { data, isLoading, isError } = useQuarterDetail(year, quarter, day || undefined);

  const setDay = (d: string) => {
    setParams(d ? { day: d } : {}, { replace: true });
  };

  const animes = data?.animes ?? [];

  // 요일별 그룹 (전체 탭 + 토글 on일 때만)
  const grouped = new Map<string, typeof animes>();
  if (!day && groupByDay) {
    for (const a of animes) {
      const d = DAY_ORDER.includes(a.broadcast_day) ? a.broadcast_day : '기타';
      if (!grouped.has(d)) grouped.set(d, []);
      grouped.get(d)!.push(a);
    }
  }
  const groupKeys = [...grouped.keys()].sort(
    (a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b),
  );

  return (
    <div className="container">
      <div className={detailStyles.stickyHeader}>
        <div className={detailStyles.backRow}>
          <Link to="/quarter" className={detailStyles.backBtn}>
            ← 분기 목록
          </Link>
        </div>
        <h1 className={detailStyles.pageTitle}>
          {year}년 {quarter}분기
        </h1>
      </div>

      <div className={detailStyles.tabs} role="tablist">
        {['전체', ...DAY_ORDER].map((d) => {
          const value = d === '전체' ? '' : d;
          const active = day === value;
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={active}
              className={`${detailStyles.tab}${active ? ` ${detailStyles.tabActive}` : ''}`}
              onClick={() => setDay(value)}
            >
              {d}
            </button>
          );
        })}
      </div>

      {!day && (
        <button
          type="button"
          className={`${detailStyles.groupToggle}${groupByDay ? ` ${detailStyles.groupToggleOn}` : ''}`}
          onClick={() => setGroupByDay((v) => !v)}
          aria-pressed={groupByDay}
        >
          <span className={detailStyles.toggleTrack}>
            <span className={detailStyles.toggleThumb} />
          </span>
          요일별 분류
        </button>
      )}

      <FadeSwap loading={isLoading} skeleton={<AnimeGridSkeleton count={16} compact />}>
        {isError ? (
          <div className={styles.placeholder}>목록을 불러오지 못했습니다.</div>
        ) : animes.length === 0 ? (
          <div className={styles.placeholder}>해당하는 애니가 없습니다.</div>
        ) : (
          <AnimatePresence mode="wait">
          <motion.div
            key={`${day}|${groupByDay}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={tweenFast}
          >
            {groupByDay && !day ? (
              groupKeys.map((d) => (
                <section key={d} className={detailStyles.daySection}>
                  <h2 className={detailStyles.daySectionTitle}>
                    {d === '기타' ? '기타' : `${d}요일`}
                  </h2>
                  <AnimeGrid animes={grouped.get(d)!} compact />
                </section>
              ))
            ) : (
              <AnimeGrid animes={animes} compact />
            )}
          </motion.div>
          </AnimatePresence>
        )}
      </FadeSwap>
    </div>
  );
}
