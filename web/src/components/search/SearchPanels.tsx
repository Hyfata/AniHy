import { motion } from 'framer-motion';
import type { TrendingItem } from '../../api/types';
import styles from './search.module.css';

interface TrendingSearchesProps {
  items: TrendingItem[];
  onSelect: (title: string) => void;
}

/** 인기 검색어 패널 — index.php trending-searches 대응 (순위 칩, 탭하면 검색어 채움) */
export function TrendingSearches({ items, onSelect }: TrendingSearchesProps) {
  if (items.length === 0) return null;
  return (
    <motion.section
      className={styles.panel}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>인기 검색어</span>
      </div>
      <ol className={styles.list}>
        {items.map((item, i) => (
          <li key={item.id}>
            <button type="button" className={styles.chip} onClick={() => onSelect(item.title)}>
              <span className={`${styles.rank}${i < 3 ? ` ${styles.rankTop}` : ''}`}>{i + 1}</span>
              <span className={styles.chipTitle}>{item.title}</span>
            </button>
          </li>
        ))}
      </ol>
    </motion.section>
  );
}

interface RecentSearchesProps {
  items: string[];
  onSelect: (term: string) => void;
  onClear: () => void;
}

/** 최근 검색어 (localStorage, 클라이언트 전용) */
export function RecentSearches({ items, onSelect, onClear }: RecentSearchesProps) {
  if (items.length === 0) return null;
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>최근 검색어</span>
        <button type="button" className={styles.panelAction} onClick={onClear}>
          전체 삭제
        </button>
      </div>
      <ul className={styles.list}>
        {items.map((term) => (
          <li key={term}>
            <button type="button" className={styles.chip} onClick={() => onSelect(term)}>
              <span className={styles.chipTitle}>{term}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
