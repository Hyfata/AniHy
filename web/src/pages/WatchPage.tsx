import { motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { get } from '../api/client';
import type { AnimeDetail, Episode } from '../api/types';
import { EpisodeRow } from '../components/EpisodeRow';
import { Modal } from '../components/Modal';
import { PlayerWrapper } from '../components/player/PlayerWrapper';
import { usePlayerSwipe } from '../components/player/usePlayerSwipe';
import type { VideoPlayerInstance } from '../components/player/video-player.d';
import { Spinner } from '../components/Spinner';
import {
  getHistory,
  migrateLocalHistory,
  saveHistory,
  saveHistoryKeepalive,
  SAVE_THROTTLE_MS,
} from '../lib/history';
import { tweenNormal, useMotionTransition } from '../lib/motion';
import {
  getLocalHistory,
  isNative,
  listDownloads,
  localChaptersUrl,
  localVideoUrl,
  recordLocalHistory,
  syncHistory,
} from '../lib/native';
import { useAuthStore } from '../stores/auth';
import { useUiStore } from '../stores/ui';
import { useConnectivityStore } from '../stores/connectivity';
import { dlKey, useDownloadsStore } from '../stores/downloads';
import styles from './WatchPage.module.css';

const AUTO_NEXT_KEY = 'anihy_auto_next';
const COMPLETED_RATIO = 0.95;

function readAutoNext(): boolean {
  return localStorage.getItem(AUTO_NEXT_KEY) !== '0';
}

/** 컨테이너 안에서 현재 회차(.active)가 상단에 오도록 스크롤 (구 watch.php 규약) */
function scrollActiveToTop(container: HTMLElement | null) {
  if (!container) return;
  const active = container.querySelector<HTMLElement>('[data-active="true"]');
  if (!active) return;
  const cRect = container.getBoundingClientRect();
  const aRect = active.getBoundingClientRect();
  container.scrollTop += aRect.top - cRect.top - 8;
}

export function WatchPage() {
  const { aid: aidParam, ep: epParam } = useParams();
  const aid = Number(aidParam);
  const ep = epParam ?? '';
  const navigate = useNavigate();
  const lastListPath = useUiStore((s) => s.lastListPath);
  const identity = useAuthStore((s) => s.identity);

  /** 애니 제목 탭: 마지막 목록 위치로 돌아가 해당 카드까지 스크롤한 뒤 상세 모달을 연다
      (구 from/ly 복귀 + 스크롤 복원 규약의 SPA판). 모달이 body 스크롤을 잠그므로
      반드시 스크롤을 먼저 수행하고 모달을 나중에 연다. */
  const openAnimeModal = useCallback(() => {
    const listPath = lastListPath || '/';
    navigate(listPath);
    const background = { pathname: listPath };
    const openModal = () => navigate(`/anime/${aid}`, { state: { background } });
    // 목록 렌더를 기다리며 카드를 찾아 중앙으로 스크롤 (무한스크롤 1페이지 밖이면 best-effort 포기)
    let tries = 0;
    const attempt = () => {
      const card = document.querySelector(`[data-anime-id="${aid}"]`);
      if (card) {
        card.scrollIntoView({ block: 'center' });
        setTimeout(openModal, 250); // 스크롤이 보인 뒤 모달
      } else if (++tries < 10) {
        setTimeout(attempt, 100);
      } else {
        openModal();
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(attempt));
  }, [aid, lastListPath, navigate]);
  const loggedIn = identity?.logged_in ?? false;
  const transition = useMotionTransition(tweenNormal);

  const [detail, setDetail] = useState<AnimeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [autoNext, setAutoNext] = useState(readAutoNext);

  const playerRef = useRef<VideoPlayerInstance | null>(null);
  const playerAreaRef = useRef<HTMLDivElement>(null);
  const sidebarListRef = useRef<HTMLDivElement>(null);
  const modalListRef = useRef<HTMLDivElement>(null);
  const lastSaveRef = useRef({ time: -1, at: 0 });
  const resumeDoneRef = useRef(false);
  // 실제 재생('play' 이벤트)이 있어야 시청기록 저장 — 진입만 하고 나간 경우 제외
  const playedRef = useRef(false);
  const online = useConnectivityStore((s) => s.online);
  const initConnectivity = useConnectivityStore((s) => s.init);
  const initDownloads = useDownloadsStore((s) => s.init);
  const isDownloaded = useDownloadsStore((s) => s.downloaded[dlKey(aid, ep)] ?? false);
  const liveRef = useRef({ aid, ep, loggedIn, online });
  liveRef.current = { aid, ep, loggedIn, online };

  usePlayerSwipe(playerAreaRef);

  useEffect(() => {
    initConnectivity();
    initDownloads();
  }, [initConnectivity, initDownloads]);

  // 온라인 복귀 시 오프라인 시청기록 동기화 (계획 §3.4)
  useEffect(() => {
    if (!isNative()) return;
    const onOnline = () => {
      void syncHistory().catch(() => {});
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  // 구 localStorage 진행률 마이그레이션 (로그인 시 1회) 후 상세 로드
  useEffect(() => {
    if (!Number.isFinite(aid) || aid <= 0 || identity === null) return;
    const controller = new AbortController();
    setDetail(null);
    setError(null);
    resumeDoneRef.current = false;
    (async () => {
      try {
        if (loggedIn) await migrateLocalHistory();
        const data = await get<AnimeDetail>(`/animes/${aid}`, controller.signal);
        setDetail(data);
      } catch (e) {
        if (controller.signal.aborted) return;
        // 네이티브 오프라인 폴팩: 저장본 메타로 최소 detail 구성 (계획 §3.3 오프라인 재생)
        if (isNative()) {
          try {
            const items = await listDownloads();
            const item = items.find((a) => a.animeId === aid);
            if (item) {
              setDetail({
                id: item.animeId,
                title: item.title,
                cover: item.cover,
                description: null,
                season_id: null,
                is_hidive: false,
                broadcast_year: null,
                broadcast_quarter: null,
                broadcast_day: null,
                download_url: null,
                namuwiki_url: null,
                broadcasts: [],
                episodes: item.episodes.map((ep) => ({
                  // 오프라인 저장본에는 서버 id가 없음 — 관리자 액션은 온라인 전용이라 0으로 둔다
                  id: 0,
                  episode_number: ep.episodeNumber,
                  title: ep.title,
                  duration_ms: null,
                  duration_text: '',
                  has_subtitle: false,
                  en_subtitle_url: null,
                  video_url: localVideoUrl(item.animeId, ep.episodeNumber),
                  thumb_url: null,
                  chapters_url: ep.chapters
                    ? localChaptersUrl(item.animeId, ep.episodeNumber)
                    : null,
                })),
                is_bookmarked: false,
                is_admin: false,
                logged_in: false,
              });
              return;
            }
          } catch {
            // 폴팩 실패 시 원래 에러 표시
          }
        }
        setError(e instanceof Error ? e.message : '불러오기에 실패했습니다');
      }
    })();
    return () => controller.abort();
  }, [aid, identity, loggedIn]);

  const episodes = detail?.episodes ?? [];
  const epIndex = episodes.findIndex((e) => e.episode_number === ep);
  const episode: Episode | undefined = epIndex >= 0 ? episodes[epIndex] : undefined;
  const nextEpisode = epIndex >= 0 ? episodes[epIndex + 1] : undefined;

  // 사이드바: 현재 회차 자동 스크롤
  useEffect(() => {
    if (detail) scrollActiveToTop(sidebarListRef.current);
  }, [detail, ep]);

  useEffect(() => {
    playedRef.current = false;
  }, [aid, ep]);

  const handlePlay = useCallback(() => {
    playedRef.current = true;
  }, []);

  const persistNow = useCallback(
    (keepalive: boolean) => {
      if (!playedRef.current) return;
      const video = playerRef.current?.video;
      if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
      const { aid: a, ep: e, loggedIn: li, online: on } = liveRef.current;
      // 오프라인(네이티브 로컬 재생)은 Rust 로컬 기록, 온라인+로그인은 서버 저장
      if (!on) {
        if (!isNative()) return;
        lastSaveRef.current = { time: video.currentTime, at: Date.now() };
        void recordLocalHistory(a, e, video.currentTime * 1000, video.duration * 1000).catch(
          () => {},
        );
        return;
      }
      if (!li) return;
      const posMs = video.currentTime * 1000;
      const durMs = video.duration * 1000;
      lastSaveRef.current = { time: video.currentTime, at: Date.now() };
      if (keepalive) {
        saveHistoryKeepalive(a, e, posMs, durMs);
      } else {
        void saveHistory(a, e, posMs, durMs).catch(() => {});
      }
    },
    [],
  );

  // pagehide 시 진행률 저장 (keepalive)
  useEffect(() => {
    const onPageHide = () => persistNow(true);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      persistNow(true); // 언마운트(다른 회차/페이지 이동) 시에도 저장
    };
  }, [persistNow, aid, ep]);

  const handleLoadedMetadata = useCallback(() => {
    if (resumeDoneRef.current) return;
    resumeDoneRef.current = true;
    const { aid: a, ep: e, loggedIn: li, online: on } = liveRef.current;
    void (async () => {
      // 오프라인은 로컬 기록으로 이어보기
      if (!on && isNative()) {
        const entry = await getLocalHistory(a, e).catch(() => null);
        if (!entry || entry.durationMs <= 0) return;
        const ratio = entry.positionMs / entry.durationMs;
        if (entry.positionMs > 0 && ratio < COMPLETED_RATIO) {
          playerRef.current?.seekTo(entry.positionMs / 1000);
        }
        return;
      }
      if (!li) return;
      const entry = await getHistory(a, e);
      if (!entry || entry.duration_ms <= 0) return;
      const ratio = entry.position_ms / entry.duration_ms;
      if (entry.position_ms > 0 && ratio < COMPLETED_RATIO) {
        playerRef.current?.seekTo(entry.position_ms / 1000);
      }
    })();
  }, []);

  const handleTimeUpdate = useCallback((currentTime: number, duration: number) => {
    if (!Number.isFinite(duration) || duration <= 0) return;
    const now = Date.now();
    const last = lastSaveRef.current;
    if (Math.abs(currentTime - last.time) >= 5 || now - last.at >= SAVE_THROTTLE_MS) {
      persistNow(false);
    }
  }, [persistNow]);

  const handlePause = useCallback(() => persistNow(false), [persistNow]);

  const handleEnded = useCallback(() => {
    const video = playerRef.current?.video;
    if (video && Number.isFinite(video.duration)) {
      const { aid: a, ep: e, loggedIn: li, online: on } = liveRef.current;
      // 완료 기록 (position = duration)
      if (!on && isNative()) {
        void recordLocalHistory(a, e, video.duration * 1000, video.duration * 1000).catch(
          () => {},
        );
      } else if (li) {
        saveHistoryKeepalive(a, e, video.duration * 1000, video.duration * 1000);
      }
    }
    if (readAutoNext() && nextEpisode) {
      navigate(`/watch/${aid}/${encodeURIComponent(nextEpisode.episode_number)}`);
    }
  }, [aid, nextEpisode, navigate]);

  const toggleAutoNext = () => {
    const next = !autoNext;
    setAutoNext(next);
    localStorage.setItem(AUTO_NEXT_KEY, next ? '1' : '0');
  };

  const openListModal = () => {
    playerRef.current?.pause();
    setListOpen(true);
    requestAnimationFrame(() => scrollActiveToTop(modalListRef.current));
  };

  if (!Number.isFinite(aid) || aid <= 0) {
    return (
      <div className="container">
        <div className={styles.centered}>잘못된 주소입니다.</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <div className={styles.centered}>
          <p>{error}</p>
          <Link className={styles.btn} to="/">
            홈으로
          </Link>
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="container">
        <Spinner centered />
      </div>
    );
  }

  if (!episode) {
    return (
      <div className="container">
        <div className={styles.centered}>
          <p>회차를 찾을 수 없습니다.</p>
          <button type="button" className={styles.btn} onClick={openAnimeModal}>
            {detail.title}
          </button>
        </div>
      </div>
    );
  }

  const renderList = (ref: typeof sidebarListRef, inModal: boolean) => (
    <div ref={ref} className={inModal ? styles.modalList : styles.episodeList}>
      {episodes.map((e) => (
        <div key={e.episode_number} data-active={e.episode_number === ep}>
          {inModal ? (
            <EpisodeRow
              animeId={aid}
              episode={e}
              active={e.episode_number === ep}
              onClick={() => {
                setListOpen(false);
                navigate(`/watch/${aid}/${encodeURIComponent(e.episode_number)}`);
              }}
            />
          ) : (
            <EpisodeRow animeId={aid} episode={e} active={e.episode_number === ep} />
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="container">
      <motion.div
        className={styles.layout}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={transition}
      >
        <div>
          <div ref={playerAreaRef} className={styles.playerWrap}>
            <PlayerWrapper
              key={ep}
              src={
                isDownloaded
                  ? localVideoUrl(aid, ep)
                  : episode.video_url
              }
              chaptersUrl={
                isDownloaded
                  ? localChaptersUrl(aid, ep)
                  : episode.chapters_url
              }
              playerRef={playerRef}
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
              onPause={handlePause}
              onEnded={handleEnded}
              onPlay={handlePlay}
            />
          </div>

          <div className={styles.info}>
            <h1 className={styles.episodeTitle}>
              {ep}화{episode.title ? ` | ${episode.title}` : ''}
            </h1>
            <button type="button" onClick={openAnimeModal} className={styles.animeTitle}>
              {detail.title}
            </button>
            <div className={styles.actions}>
              <button
                type="button"
                className={`${styles.btn} ${styles.listBtn}`}
                onClick={openListModal}
              >
                회차 목록
              </button>
              <button
                type="button"
                className={`${styles.btn}${autoNext ? ` ${styles.btnActive}` : ''}`}
                onClick={toggleAutoNext}
                aria-pressed={autoNext}
              >
                자동 다음화: {autoNext ? '켜짐' : '꺼짐'}
              </button>
              {episode.en_subtitle_url && (
                <a href={episode.en_subtitle_url} download className={styles.btn}>
                  영어 자막 다운로드
                </a>
              )}
            </div>
          </div>
        </div>

        <aside className={styles.sidebar}>
          <h3 className={styles.sidebarTitle}>회차 목록</h3>
          {renderList(sidebarListRef, false)}
        </aside>
      </motion.div>

      <Modal open={listOpen} onClose={() => setListOpen(false)} title="회차 목록">
        {renderList(modalListRef, true)}
      </Modal>
    </div>
  );
}
