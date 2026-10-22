import { motion } from 'framer-motion';
import { Link, useLocation } from 'react-router-dom';
import type { Anime } from '../api/types';
import { useUiStore } from '../stores/ui';
import styles from './AnimeCard.module.css';

interface AnimeCardProps {
  anime: Anime;
  /** 방영 요일 뱃지 (분기 상세에서만) */
  broadcastDay?: string;
  /** 목록 stagger 등장 인덱스 (0이면 즉시) */
  index?: number;
}

export function AnimeCard({ anime, broadcastDay, index = 0 }: AnimeCardProps) {
  const location = useLocation();
  // 카드→모달 FLIP 전환: 모달이 이 카드에서 열려 있는 동안(클론 비행~퇴장 착지까지)
  // 원본 포스터만 숨긴다 — 제목은 클론이 없으므로 그대로 둔다.
  const isModalOrigin = useUiStore((s) => s.animeModalOriginId === anime.id);
  const hidden = isModalOrigin ? { opacity: 0 } : undefined;
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut', delay: Math.min(index, 6) * 0.04 }}
    >
      {/* background location을 실어 상세를 라우트 모달로 연다 (App.tsx 참조)
          마크업 계약(FLIP 측정이 의존): 첫째 자식=포스터 div */}
      <Link
        to={`/anime/${anime.id}`}
        state={{ background: location }}
        className={styles.card}
        data-anime-id={anime.id}
      >
        <div className={styles.poster} style={hidden}>
          {anime.cover ? <img src={anime.cover} alt={anime.title} loading="lazy" /> : null}
          {broadcastDay && <span className={styles.dayBadge}>{broadcastDay}</span>}
        </div>
        <div className={styles.body}>
          <h3 className={styles.title}>{anime.title}</h3>
        </div>
      </Link>
    </motion.div>
  );
}
