import type { Anime } from '../../api/types';
import { AnimeCard } from '../AnimeCard';
import { Skeleton } from '../Spinner';
import styles from './PosterRow.module.css';

interface PosterRowProps {
  animes: Anime[];
  /** auxiliary text under the card title (e.g. relative time in the recent-updates row) */
  subLabel?: (anime: Anime) => string;
}

/** Horizontally scrolling poster row for home sections — reuses AnimeCard so the modal VT contract holds. */
export function PosterRow({ animes, subLabel }: PosterRowProps) {
  return (
    <div className={styles.row}>
      {animes.map((anime, i) => (
        <div key={anime.id} className={styles.item}>
          <AnimeCard anime={anime} index={i} subLabel={subLabel?.(anime)} />
        </div>
      ))}
    </div>
  );
}

export function PosterRowSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className={styles.row} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.item}>
          <Skeleton style={{ aspectRatio: '2 / 3', width: '100%' }} />
          <Skeleton height={13} style={{ marginTop: 8, width: '85%' }} />
        </div>
      ))}
    </div>
  );
}
