import { Link } from 'react-router-dom';
import { useQuarters } from '../../api/hooks';
import { Skeleton } from '../Spinner';
import { pickCurrentQuarter } from './currentQuarter';
import styles from './HomeHero.module.css';

const QUARTER_MONTHS: Record<number, string> = { 1: '1–3월', 2: '4–6월', 3: '7–9월', 4: '10–12월' };

/** Home hero banner for the current quarter — cover collage backdrop, links to the quarter detail. */
export function HomeHero() {
  const { data: quarters, isLoading } = useQuarters();
  const current = pickCurrentQuarter(quarters);

  if (isLoading) {
    return <Skeleton className={styles.heroSkeleton} />;
  }
  if (!current) return null;

  const { year, quarter, count, covers } = current.group;

  return (
    <Link to={`/quarter/${year}/${quarter}`} className={styles.hero}>
      {covers.length > 0 && (
        <span className={styles.backdrop} aria-hidden="true">
          {covers.slice(0, 3).map((c) => (
            <img key={c} src={c} alt="" />
          ))}
        </span>
      )}
      <span className={styles.content}>
        {current.isCurrent && <span className={styles.badge}>이번 분기</span>}
        <span className={styles.title}>
          {year}년 {quarter}분기{current.isCurrent ? ' 신작' : ''}
        </span>
        <span className={styles.meta}>
          {QUARTER_MONTHS[quarter]} · {count}개 작품
        </span>
        <span className={styles.cta}>모두 보기 →</span>
      </span>
      {covers.length > 0 && (
        <span className={styles.posters} aria-hidden="true">
          {covers.slice(0, 3).map((c) => (
            <img key={c} src={c} alt="" className={styles.poster} />
          ))}
        </span>
      )}
    </Link>
  );
}
