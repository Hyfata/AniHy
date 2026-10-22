import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';
import type { QuarterGroup } from '../../api/types';
import { Skeleton } from '../Spinner';
import styles from './QuarterCard.module.css';

const MONTHS: Record<number, string> = { 1: '1–3월', 2: '4–6월', 3: '7–9월', 4: '10–12월' };

interface QuarterCardProps {
  group: QuarterGroup;
  isCurrent: boolean;
}

/** 분기 아카이브 카드 — 모바일은 행 카드, PC는 썸네일 스트립 스탯 카드 (index.php quarter 탭) */
export function QuarterCard({ group, isCurrent }: QuarterCardProps) {
  const { year, quarter, count, covers } = group;
  const extraSlots = Math.max(0, Math.min(covers.length, 6) - 3);

  return (
    <Link
      to={`/quarter/${year}/${quarter}`}
      className={`${styles.card}${isCurrent ? ` ${styles.cardCurrent}` : ''}`}
    >
      {covers.length > 0 && (
        <span className={styles.glow} aria-hidden="true">
          {covers.slice(0, 3).map((c) => (
            <img key={c} src={c} alt="" />
          ))}
        </span>
      )}
      <span className={styles.text}>
        <span className={styles.title}>
          {quarter}분기
          {isCurrent && (
            <span className={styles.now} title="이번 분기">
              이번 분기
            </span>
          )}
        </span>
        <span className={styles.months}>{MONTHS[quarter]}</span>
        <span className={styles.count}>
          <span className={styles.countNum}>{count}</span>개 작품
        </span>
        {covers.length > 0 && (
          <span
            className={styles.thumbs}
            aria-hidden="true"
            style={{ '--x': extraSlots } as CSSProperties}
          >
            <span className={styles.thumbsTrack}>
              {covers.map((c, i) => (
                <span key={c} className={styles.thumb}>
                  <img src={c} alt="" loading="lazy" />
                  {i === 5 && count > 6 && <span className={styles.thumbMore}>+{count - 6}</span>}
                </span>
              ))}
            </span>
          </span>
        )}
      </span>
      <span className={styles.arrow}>→</span>
    </Link>
  );
}

/** 작품이 없는 분기 슬롯 */
export function QuarterCardEmpty({ quarter }: { quarter: number }) {
  return (
    <div className={`${styles.card} ${styles.cardEmpty}`}>
      <span className={styles.text}>
        <span className={styles.title}>{quarter}분기</span>
        <span className={styles.months}>{MONTHS[quarter]}</span>
        <span className={styles.count}>작품 없음</span>
      </span>
    </div>
  );
}

/** 로딩용 스켈레톤 카드 (실제 카드와 같은 레이아웃/높이) */
export function QuarterCardSkeleton() {
  return (
    <div className={styles.card} aria-hidden="true">
      <span className={styles.text}>
        <Skeleton height={18} style={{ width: '40%' }} />
        <Skeleton height={12} style={{ width: '28%', marginTop: 6 }} />
        <Skeleton height={22} style={{ width: '34%', marginTop: 10 }} />
        <span className={styles.thumbs}>
          <span className={styles.thumbsTrack}>
            {[0, 1, 2].map((i) => (
              <span key={i} className={styles.thumb}>
                <Skeleton style={{ width: '100%', height: '100%' }} />
              </span>
            ))}
          </span>
        </span>
      </span>
    </div>
  );
}
