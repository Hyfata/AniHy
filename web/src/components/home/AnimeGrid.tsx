import type { Anime } from '../../api/types';
import { AnimeCard } from '../AnimeCard';
import { Skeleton } from '../Spinner';
import styles from './AnimeGrid.module.css';

interface AnimeGridProps {
  animes: Anime[];
  /** compact = 분기 상세의 촘촘한 그리드 */
  compact?: boolean;
}

export function AnimeGrid({ animes, compact = false }: AnimeGridProps) {
  return (
    <div className={`${styles.grid}${compact ? ` ${styles.gridCompact}` : ''}`}>
      {animes.map((anime, i) => (
        <AnimeCard key={anime.id} anime={anime} index={i % 8} />
      ))}
    </div>
  );
}

export function AnimeGridSkeleton({ count = 12, compact = false }: { count?: number; compact?: boolean }) {
  return (
    <div className={`${styles.grid}${compact ? ` ${styles.gridCompact}` : ''}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <Skeleton style={{ aspectRatio: '2 / 3', width: '100%' }} />
          <Skeleton height={14} style={{ marginTop: 10, width: '85%' }} />
        </div>
      ))}
    </div>
  );
}
