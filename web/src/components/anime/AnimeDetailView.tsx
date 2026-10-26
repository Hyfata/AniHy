import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { API_BASE, ApiError, del as delReq, get, post, put } from '../../api/client';
import type {
  AnimeDetail,
  AnimeListResponse,
  Bookmark,
  Episode,
  QuarterDetailResponse,
} from '../../api/types';
import detailStyles from '../../pages/AnimeDetailPage.module.css';
import { EpisodeRow } from '../EpisodeRow';
import { Modal } from '../Modal';
import { Skeleton } from '../Spinner';
import { useMotionTransition, useReducedMotion, tweenNormal } from '../../lib/motion';
import { VT_POSTER } from '../../lib/viewTransition';
import { isNative } from '../../lib/native';
import { useAuthStore } from '../../stores/auth';
import { dialog } from '../../stores/dialog';
import { useDownloadsStore } from '../../stores/downloads';
import { EpisodeAddModal } from '../admin/EpisodeAddModal';
import { EditAnimeModal } from '../admin/EditAnimeModal';
import { DownloadAllButton } from './DownloadAllButton';
import { EpisodeDownloadButton } from './EpisodeDownloadButton';

const SORT_KEY = 'anihy_ep_sort';
type SortOrder = 'asc' | 'desc';

const styles = detailStyles;

function initialOrder(): SortOrder {
  try {
    return localStorage.getItem(SORT_KEY) === 'asc' ? 'asc' : 'desc';
  } catch {
    return 'desc';
  }
}

/** 인라인 줄거리 (데스크톱) — 구 app.js desc-more 규약:
   - 넘치지 않으면 더보기 버튼을 렌더하지 않음 (scrollHeight > clientHeight 감지 + resize)
   - 펼침/접힘은 래퍼 높이 측정값 transition (0.3s ease). 접힘은 끝날 때까지 전체 텍스트 유지. */
function CollapsibleDesc({ text }: { text: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const pRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const animatingRef = useRef(false);
  const reducedMotion = useReducedMotion();

  useLayoutEffect(() => {
    const p = pRef.current;
    if (!p) return;
    const check = () => setOverflowing(p.scrollHeight > p.clientHeight + 1);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [text]);

  const toggle = () => {
    const wrap = wrapRef.current;
    if (!wrap || reducedMotion) {
      setExpanded((v) => !v);
      return;
    }
    if (animatingRef.current) return;
    animatingRef.current = true;
    const willExpand = !expanded;

    // 접힘: 클램프 높이를 재려면 클래스를 잠깐 제거했다 되돌린다 (동기 커밋이라 페인트 없음)
    wrap.style.height = '';
    const startH = wrap.offsetHeight;
    flushSync(() => setExpanded(willExpand));
    const endH = wrap.offsetHeight;
    if (!willExpand) flushSync(() => setExpanded(true));

    wrap.style.height = `${startH}px`;
    requestAnimationFrame(() => {
      wrap.style.height = `${endH}px`;
    });
    // transitionend 미발생(높이 동일, 중단) 대비 타이머 정리 (구 350ms 규약)
    window.setTimeout(() => {
      if (!willExpand) setExpanded(false);
      wrap.style.height = '';
      animatingRef.current = false;
    }, 350);
  };

  return (
    <div className={styles.descBox}>
      <div ref={wrapRef} className={styles.descWrap}>
        <p ref={pRef} className={`${styles.desc}${expanded ? ` ${styles.descExpanded}` : ''}`}>
          {text}
        </p>
      </div>
      {(overflowing || expanded) && (
        <button type="button" className={styles.descMore} onClick={toggle}>
          {expanded ? '접기' : '더보기'}
        </button>
      )}
    </div>
  );
}


/** 목록 캐시(홈 무한/검색/분기 상세/북마크)에서 포스터+제목만 꺼내 히어로를 즉시 렌더하기 위한
   placeholder detail — episodes/뱃지/액션은 isPlaceholderData로 게이트한다. */
function findCachedPartial(queryClient: QueryClient, id: number): AnimeDetail | undefined {
  let found: { title: string; cover: string | null } | undefined;

  for (const [, data] of queryClient.getQueriesData<InfiniteData<AnimeListResponse>>({
    queryKey: ['animes'],
  })) {
    found ??= data?.pages.flatMap((p) => p.animes).find((a) => a.id === id);
  }
  if (!found) {
    for (const [, data] of queryClient.getQueriesData<AnimeListResponse>({ queryKey: ['search'] })) {
      // ['search', 'trending'] also prefix-matches but caches {trending: [...]} — same shape guard as the quarters loop
      if (data && Array.isArray(data.animes)) found ??= data.animes.find((a) => a.id === id);
    }
  }
  if (!found) {
    // ['quarters'] 루트 쿼리({quarters:[...]})도 prefix 매칭되므로 animes 배열 유무로 걸러낸다
    for (const [, data] of queryClient.getQueriesData<QuarterDetailResponse>({
      queryKey: ['quarters'],
    })) {
      if (data && Array.isArray(data.animes)) found ??= data.animes.find((a) => a.id === id);
    }
  }
  if (!found) {
    for (const [, data] of queryClient.getQueriesData<Bookmark[]>({ queryKey: ['bookmarks'] })) {
      found ??= data?.find((b) => b.id === id);
    }
  }
  if (!found) return undefined;

  return {
    id,
    title: found.title,
    cover: found.cover,
    description: null,
    season_id: null,
    is_hidive: false,
    broadcast_year: null,
    broadcast_quarter: null,
    broadcast_day: null,
    download_url: null,
    namuwiki_url: null,
    broadcasts: [],
    episodes: [],
    is_bookmarked: false,
    is_admin: false,
    logged_in: false,
  };
}

/** 전체 로딩 스켈레톤 (캐시 없는 직접 진입) — 포스터(2:3) + 제목/메타 칩. */
function HeroSkeleton() {
  return (
    <div className={styles.hero} aria-hidden="true">
      <Skeleton className={styles.skPoster} />
      <div className={styles.info}>
        <Skeleton height={24} style={{ width: '60%', marginTop: 4 }} />
        <MetaSkeleton />
      </div>
    </div>
  );
}

function MetaSkeleton() {
  return (
    <div className={styles.metaRow} aria-hidden="true">
      <Skeleton height={23} style={{ width: 96, borderRadius: 'var(--radius-pill)' }} />
      <Skeleton height={23} style={{ width: 72, borderRadius: 'var(--radius-pill)' }} />
      <Skeleton height={23} style={{ width: 64, borderRadius: 'var(--radius-pill)' }} />
    </div>
  );
}

/** 에피소드 섹션 스켈레톤 — EpisodeRow와 같은 실루엣 6행. */
function EpisodeListSkeleton() {
  return (
    <>
      <div className={styles.sectionHeader} aria-hidden="true">
        <Skeleton height={24} style={{ width: 96 }} />
        <Skeleton height={30} style={{ width: 110 }} />
      </div>
      <div className={styles.episodeList} aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={styles.skRow}>
            <Skeleton className={styles.skThumb} />
            <div className={styles.skLines}>
              <Skeleton height={15} style={{ width: '55%' }} />
              <Skeleton height={13} style={{ width: '35%' }} />
            </div>
            <div className={styles.skGroove} />
          </div>
        ))}
      </div>
    </>
  );
}

export function AnimeDetailSkeleton() {
  return (
    <div aria-hidden="true">
      <HeroSkeleton />
      <EpisodeListSkeleton />
    </div>
  );
}

/** 애니 상세 본문 — 페이지(AnimeDetailPage)와 라우트 모달(AnimeDetailModal)이 공유.
   contentDelay > 0이면 히어로 이후 콘텐츠를 지연 fade in (카드 확장 전환 중 텍스트 번짐 방지).
   heroStatic: 카드→모달 FLIP 전환 시 히어로 자체 등장 애니메이션(scale 0.97 등)을 끈다 —
   히어로는 클론이 옮겨주므로 자체 애니메이션이 있으면 측정이 왜곡되고 이중으로 움직인다. */
export function AnimeDetailView({
  animeId,
  contentDelay = 0,
  heroStatic = false,
}: {
  animeId: number;
  contentDelay?: number;
  heroStatic?: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const identity = useAuthStore((s) => s.identity);

  const [order, setOrder] = useState<SortOrder>(initialOrder);
  const [synopsisOpen, setSynopsisOpen] = useState(false);
  const [loginPromptOpen, setLoginPromptOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [addEpOpen, setAddEpOpen] = useState(false);
  const [editEp, setEditEp] = useState<Episode | null>(null);
  const [editEpTitle, setEditEpTitle] = useState('');
  const [epBusy, setEpBusy] = useState(false);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);

  const heroTransition = useMotionTransition({ ...tweenNormal, duration: 0.35 });
  const reducedMotion = useReducedMotion();

  const {
    data: detail,
    error,
    isPlaceholderData,
    refetch,
  } = useQuery({
    queryKey: ['anime', animeId],
    queryFn: () => get<AnimeDetail>(`/animes/${animeId}`),
    enabled: Number.isFinite(animeId),
    // placeholderData는 캐시에 쓰이지 않으므로 실제 응답이 도착하면 반드시 교체된다
    placeholderData: () => findCachedPartial(queryClient, animeId),
  });

  // 네이티브: 다운로드 이벤트 구독 + 저장본 캐시 로드 (전역 1회)
  const initDownloads = useDownloadsStore((s) => s.init);
  useEffect(() => {
    initDownloads();
  }, [initDownloads]);

  const toggleSort = () => {
    const next: SortOrder = order === 'desc' ? 'asc' : 'desc';
    setOrder(next);
    try {
      localStorage.setItem(SORT_KEY, next);
    } catch {
      // localStorage 사용 불가 시 무시
    }
  };

  const toggleBookmark = async () => {
    if (!detail || isPlaceholderData || bookmarkBusy) return;
    if (!identity?.logged_in || !detail.logged_in) {
      setLoginPromptOpen(true);
      return;
    }
    setBookmarkBusy(true);
    try {
      if (detail.is_bookmarked) {
        await delReq(`/bookmarks/${detail.id}`);
        queryClient.setQueryData<AnimeDetail>(['anime', animeId], { ...detail, is_bookmarked: false });
      } else {
        await post(`/bookmarks/${detail.id}`);
        queryClient.setQueryData<AnimeDetail>(['anime', animeId], { ...detail, is_bookmarked: true });
      }
      // 보관함 북마크 탭 캐시 무효화 — 다음 진입 시 최신 목록
      void queryClient.invalidateQueries({ queryKey: ['bookmarks'] });
    } catch (err) {
      if (err instanceof ApiError && err.isLoginRequired) {
        setLoginPromptOpen(true);
      } else {
        await dialog.alert(err instanceof Error ? err.message : '북마크 변경 실패');
      }
    } finally {
      setBookmarkBusy(false);
    }
  };

  const webDownload = useCallback((episodeNumber: string) => {
    window.location.assign(
      `${API_BASE}/files/video/${animeId}/${encodeURIComponent(episodeNumber)}`,
    );
  }, [animeId]);

  const openEpisodeEdit = (ep: Episode) => {
    setEditEpTitle(ep.title);
    setEditEp(ep);
  };

  const saveEpisodeTitle = async () => {
    if (!editEp || epBusy) return;
    setEpBusy(true);
    try {
      await put(`/admin/episodes/${editEp.id}`, { title: editEpTitle });
      setEditEp(null);
      await refetch();
    } catch (err) {
      await dialog.alert(err instanceof Error ? err.message : '수정 실패');
    } finally {
      setEpBusy(false);
    }
  };

  const deleteEpisode = async (ep: Episode) => {
    if (!(await dialog.confirm(`${ep.episode_number}화를 삭제하시겠습니까?`, { confirmLabel: '삭제', danger: true }))) return;
    try {
      await delReq(`/admin/episodes/${ep.id}`);
      await refetch();
    } catch (err) {
      await dialog.alert(err instanceof Error ? err.message : '삭제 실패');
    }
  };

  if (error) {
    return (
      <div className={styles.empty} style={{ marginTop: 40 }}>
        {error instanceof Error ? error.message : '불러오지 못했습니다.'}
      </div>
    );
  }

  if (!detail) {
    return <AnimeDetailSkeleton />;
  }

  const isAdmin = !isPlaceholderData && (detail.is_admin || (identity?.is_admin ?? false));
  const hasDesc = !isPlaceholderData && (detail.description ?? '').trim() !== '';
  const badges = [
    ...detail.broadcasts.map(([y, q]) => `${y}년 ${q}분기`),
    ...(detail.broadcast_day ? [`${detail.broadcast_day}요일`] : []),
  ];
  const episodes = order === 'desc' ? [...detail.episodes].reverse() : detail.episodes;

  return (
    <>
      <motion.section
        className={styles.hero}
        initial={heroStatic ? false : { opacity: 0, scale: 0.97, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={heroTransition}
      >
        <div className={styles.posterCol}>
          {/* VT 공유 요소 전환의 착지 지점 — 카드 포스터와 같은 view-transition-name */}
          <div
            className={styles.poster}
            data-hero-poster
            style={{ viewTransitionName: VT_POSTER } as CSSProperties}
          >
            {detail.cover && <img src={detail.cover} alt={detail.title} />}
          </div>
          {!isPlaceholderData && (
            <div className={styles.posterActions}>
              <button
                type="button"
                className={`${styles.posterAction}${detail.is_bookmarked ? ` ${styles.posterActionActive}` : ''}`}
                disabled={bookmarkBusy}
                onClick={() => void toggleBookmark()}
              >
                <svg viewBox="0 0 24 24" fill={detail.is_bookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
                <span>{detail.is_bookmarked ? '북마크 해제' : '북마크'}</span>
              </button>
              {hasDesc && (
                <button type="button" className={`${styles.posterAction} ${styles.posterActionSynopsis}`} onClick={() => setSynopsisOpen(true)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
                  <span>줄거리</span>
                </button>
              )}
              {detail.namuwiki_url && (
                <a className={styles.posterAction} href={detail.namuwiki_url} target="_blank" rel="noopener noreferrer">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 5a2 2 0 0 1 2-2h7v18H4a2 2 0 0 1-2-2z" /><path d="M22 5a2 2 0 0 0-2-2h-7v18h7a2 2 0 0 0 2-2z" /></svg>
                  <span>나무위키</span>
                </a>
              )}
              {detail.episodes.length > 0 && (
                <DownloadAllButton
                  animeId={detail.id}
                  className={styles.posterAction}
                  animeTitle={detail.title}
                  coverUrl={detail.cover}
                  episodes={detail.episodes}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m6 11 6 6 6-6" /><path d="M4 21h16" /></svg>
                  <span>전체 다운로드</span>
                </DownloadAllButton>
              )}
            </div>
          )}
        </div>

        <div className={styles.info}>
          <div className={styles.titleRow}>
            {/* 제목은 클론/지연 fade 없이 히어로의 일부로 처음부터 표시 —
                북마크 버튼 등 info 영역과 같이 패널 확장 애니메이션에 실려 움직인다 */}
            <h1 data-hero-title>{detail.title}</h1>
            {isAdmin && (
              <div className={styles.adminActions}>
                {detail.download_url && (
                  <a className={styles.adminIconBtn} href={detail.download_url} target="_blank" rel="noopener noreferrer" title="다운로드 주소 열기">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m6 11 6 6 6-6" /><path d="M4 21h16" /></svg>
                  </a>
                )}
                <button type="button" className={styles.adminIconBtn} title="수정" onClick={() => setEditOpen(true)}>
                  ✎
                </button>
                <button
                  type="button"
                  className={`${styles.adminIconBtn} ${styles.adminIconDanger}`}
                  title="삭제"
                  onClick={async () => {
                    if (!(await dialog.confirm('이 애니와 모든 에피소드를 삭제하시겠습니까?', { confirmLabel: '삭제', danger: true }))) return;
                    try {
                      await delReq(`/admin/animes/${detail.id}`);
                      navigate('/');
                    } catch (err) {
                      await dialog.alert(err instanceof Error ? err.message : '삭제 실패');
                    }
                  }}
                >
                  ×
                </button>
              </div>
            )}
          </div>
          {isPlaceholderData ? (
            <MetaSkeleton />
          ) : (
            badges.length > 0 && (
              <div className={styles.metaRow}>
                {badges.map((b) => (
                  <span key={b} className={styles.badge}>
                    {b}
                  </span>
                ))}
              </div>
            )
          )}
        </div>

        {hasDesc && <CollapsibleDesc text={detail.description ?? ''} />}
      </motion.section>

      {/* 카드 확장 전환 중엔(contentDelay>0) 히어로만 보이고 나머지는 지연 fade in */}
      <motion.div
        initial={contentDelay > 0 ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={contentDelay > 0 ? { delay: contentDelay, duration: 0.2 } : undefined}
      >
      {isPlaceholderData ? (
        <EpisodeListSkeleton />
      ) : (
        <>
          <div className={styles.sectionHeader}>
            <h2>에피소드</h2>
            <div className={styles.sectionActions}>
              {detail.episodes.length > 0 && (
                <button type="button" className={styles.btnSm} onClick={toggleSort}>
                  {order === 'desc' ? '1화부터 보기' : '최신화부터 보기'}
                </button>
              )}
              {isAdmin && (
                <button
                  type="button"
                  className={`${styles.btnSm} ${styles.btnSmPrimary}`}
                  onClick={() => setAddEpOpen(true)}
                >
                  에피소드 추가
                </button>
              )}
            </div>
          </div>

          {detail.episodes.length === 0 ? (
            <div className={styles.empty}>등록된 에피소드가 없습니다.</div>
          ) : (
            <div className={styles.episodeList}>
              {episodes.map((ep, i) => (
                <motion.div
                  key={ep.episode_number}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={
                    reducedMotion
                      ? { duration: 0 }
                      : { duration: 0.35, ease: 'easeOut', delay: Math.min(i, 6) * 0.04 }
                  }
                >
                  <EpisodeRow
                    animeId={detail.id}
                    episode={ep}
                    actions={
                      <>
                        {isNative() ? (
                          <EpisodeDownloadButton
                            animeId={detail.id}
                            animeTitle={detail.title}
                            coverUrl={detail.cover}
                            episode={ep}
                            className={styles.dlBtn}
                          />
                        ) : (
                          /* 웹: 첨부 다운로드 엔드포인트로 바로 연결 (구 .episode-dl-btn 부활).
                           EpisodeRow가 <a>라 중첩 앵커 대신 버튼 + location.assign 사용 */
                          <button
                            type="button"
                            className={styles.epDlBtn}
                            title="다운로드"
                            aria-label={`${ep.episode_number}화 다운로드`}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              webDownload(ep.episode_number);
                            }}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m6 11 6 6 6-6" /><path d="M4 21h16" /></svg>
                          </button>
                        )}
                        {isAdmin && (
                          <>
                            <button
                              type="button"
                              className={styles.epAdminBtn}
                              title="제목 수정"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                openEpisodeEdit(ep);
                              }}
                            >
                              수정
                            </button>
                            <button
                              type="button"
                              className={`${styles.epAdminBtn} ${styles.epAdminBtnDanger}`}
                              title="삭제"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                void deleteEpisode(ep);
                              }}
                            >
                              삭제
                            </button>
                          </>
                        )}
                      </>
                    }
                  />
                </motion.div>
              ))}
            </div>
          )}
        </>
      )}
      </motion.div>

      {!isPlaceholderData && hasDesc && (
        <Modal open={synopsisOpen} onClose={() => setSynopsisOpen(false)} title="줄거리">
          <p className={styles.synopsis}>{detail.description}</p>
        </Modal>
      )}

      <Modal open={loginPromptOpen} onClose={() => setLoginPromptOpen(false)} title="로그인 필요" size="sm">
        <div className={styles.loginPrompt}>
          <p>북마크는 로그인 후 사용할 수 있습니다.</p>
          <button
            type="button"
            className={styles.loginBtn}
            onClick={() => window.location.assign(`${API_BASE}/auth/login`)}
          >
            로그인
          </button>
        </div>
      </Modal>

      {isAdmin && (
        <Modal
          open={editEp !== null}
          onClose={() => setEditEp(null)}
          title={editEp ? `${editEp.episode_number}화 제목 수정` : '제목 수정'}
          size="sm"
        >
          <input
            className={styles.epEditInput}
            value={editEpTitle}
            placeholder="에피소드 제목"
            onChange={(e) => setEditEpTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void saveEpisodeTitle();
              }
            }}
          />
          <div className={styles.epEditActions}>
            <button type="button" className={styles.btnSm} onClick={() => setEditEp(null)}>
              취소
            </button>
            <button
              type="button"
              className={`${styles.btnSm} ${styles.btnSmPrimary}`}
              disabled={epBusy}
              onClick={() => void saveEpisodeTitle()}
            >
              {epBusy ? '저장 중...' : '저장'}
            </button>
          </div>
        </Modal>
      )}

      {isAdmin && (
        <>
          <EditAnimeModal
            open={editOpen}
            onClose={() => setEditOpen(false)}
            anime={detail}
            onSaved={() => void refetch()}
            onDeleted={() => navigate('/')}
          />
          <EpisodeAddModal open={addEpOpen} onClose={() => setAddEpOpen(false)} anime={detail} />
        </>
      )}
    </>
  );
}
