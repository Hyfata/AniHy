import { motion } from 'framer-motion';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { Anime } from '../api/types';
import { hasRecentEpisode } from '../lib/recency';
import { openAnimeModalVt, vtEnabled } from '../lib/viewTransition';
import { useUiStore } from '../stores/ui';
import styles from './AnimeCard.module.css';

interface AnimeCardProps {
  anime: Anime;
  broadcastDay?: string;
  index?: number;
}

export function AnimeCard({ anime, broadcastDay, index = 0 }: AnimeCardProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const isModalOrigin = useUiStore((s) => s.animeModalOriginId === anime.id);
  const hidden = isModalOrigin ? { opacity: 0 } : undefined;
  const isNew = hasRecentEpisode(anime.latest_episode_at);

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut', delay: Math.min(index, 6) * 0.04 }}
    >
      <Link
        to={`/anime/${anime.id}`}
        state={{ background: location }}
        className={styles.card}
        data-anime-id={anime.id}
        onClick={(e) => {
          if (!vtEnabled()) return;
          e.preventDefault();
          openAnimeModalVt(anime.id, location, navigate);
        }}
      >
        <div className={styles.poster} style={hidden}>
          {anime.cover ? <img src={anime.cover} alt={anime.title} loading="lazy" /> : null}
          {(isNew || broadcastDay) && (
            <div className={styles.badges}>
              {isNew && <span className={styles.newBadge}>New</span>}
              {broadcastDay && <span className={styles.dayBadge}>{broadcastDay}</span>}
            </div>
          )}
        </div>
        <div className={styles.body}>
          <h3 className={styles.title}>{anime.title}</h3>
        </div>
      </Link>
    </motion.div>
  );
}
