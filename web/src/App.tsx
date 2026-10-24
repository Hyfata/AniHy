import { AnimatePresence } from 'framer-motion';
import { useEffect } from 'react';
import type { Location } from 'react-router-dom';
import { Navigate, Route, Routes, useLocation, useMatch, useNavigate } from 'react-router-dom';
import { BottomTabbar } from './components/BottomTabbar';
import { AnimeDetailModal } from './components/anime/AnimeDetailModal';
import { QueueLauncher } from './components/admin/QueueLauncher';
import { DownloadsTab } from './components/library/DownloadsTab';
import { TopNavbar } from './components/TopNavbar';
import { useScrollRestoration } from './lib/scrollRestoration';
import { isOfflineMode } from './lib/native';
import { GatePage } from './pages/GatePage';
import { HomePage } from './pages/HomePage';
import { LibraryPage } from './pages/LibraryPage';
import { QuarterDetailPage } from './pages/QuarterDetailPage';
import { QuarterPage } from './pages/QuarterPage';
import { SearchPage } from './pages/SearchPage';
import { WatchPage } from './pages/WatchPage';
import { useAuthStore } from './stores/auth';
import { useUiStore } from './stores/ui';
import type { TabId } from './stores/ui';

function tabForPath(pathname: string): TabId {
  if (pathname.startsWith('/quarter')) return 'quarter';
  if (pathname.startsWith('/search')) return 'search';
  if (pathname.startsWith('/library')) return 'library';
  return 'home';
}

const OFFLINE = isOfflineMode();

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const isGate = location.pathname === '/gate';
  const fetchIdentity = useAuthStore((s) => s.fetchIdentity);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const setLastListPath = useUiStore((s) => s.setLastListPath);
  useScrollRestoration();

  useEffect(() => {
    void fetchIdentity();
  }, [fetchIdentity]);

  useEffect(() => {
    // 모달 경로(/anime/:id)는 오버레이라 활성 탭을 바꾸지 않는다 — 배경 페이지의 탭 유지
    if (!location.pathname.startsWith('/anime/')) {
      setActiveTab(tabForPath(location.pathname));
    }
    // 목록 페이지 경로를 기억 — watch에서 애니 제목 탭 시 이 위치를 배경으로 모달을 연다
    if (
      location.pathname === '/' ||
      location.pathname.startsWith('/quarter') ||
      location.pathname.startsWith('/search') ||
      location.pathname.startsWith('/library')
    ) {
      setLastListPath(location.pathname + location.search);
    }
  }, [location.pathname, location.search, setActiveTab, setLastListPath]);

  // 네이티브 탭바 연동 (Tauri에서만 동적 로드 — 웹 번들에는 코드 스플릿)
  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let cancelled = false;
    import('./lib/tabs')
      .then((m) => m.initNativeTabs((to) => navigate(to)))
      .then((fn) => {
        if (cancelled) fn?.();
        else cleanup = fn ?? null;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [navigate]);

  useEffect(() => {
    // 네이티브 탭 동기화도 모달 경로는 배경 탭 기준
    const effPath = animeMatch ? (effectiveBackground?.pathname ?? '/') : location.pathname;
    import('./lib/tabs')
      .then((m) => m.syncNativeTab(effPath))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // 라우트 모달: 카드에서 /anime/:id 진입 시 state.background에 이전 location을 실어 보냄.
  // background가 있으면 배경 페이지는 그대로 마운트 유지 + 상세는 모달로 오버레이.
  const background = (location.state as { background?: Location } | null)?.background;
  const animeMatch = useMatch('/anime/:id');
  // 직접 접속/새 탭/새로고침도 모달로 — 배경이 없으면 홈을 배경으로 깐다
  // (구 PHP의 anime.php?embed=1 모달과 동일한 UX. 카드가 없으면 모달이 자체 팝 애니메이션으로 열림)
  const HOME_BACKGROUND: Location = { pathname: '/', search: '', hash: '', state: null, key: 'home-bg' };
  const effectiveBackground = animeMatch ? (background ?? HOME_BACKGROUND) : background;
  const modalAnimeId = animeMatch ? Number(animeMatch.params.id) : null;

  if (isGate) {
    return (
      <Routes>
        <Route path="/gate" element={<GatePage />} />
      </Routes>
    );
  }

  // 오프라인 모드(#offline=1): 서버 없이 저장본 보관함 + 로컬 재생만 제공 (계획 §3.3)
  if (OFFLINE) {
    return (
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Routes>
          <Route
            path="/library"
            element={
              <div className="container" style={{ paddingTop: 'var(--space-4)' }}>
                <h1 style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--space-3)' }}>
                  보관함 — 오프라인
                </h1>
                <DownloadsTab />
              </div>
            }
          />
          <Route path="/watch/:aid/:ep" element={<WatchPage />} />
          <Route path="*" element={<Navigate to="/library" replace />} />
        </Routes>
      </main>
    );
  }

  return (
    <>
      <TopNavbar />
      <main className="appMain">
        {/* 페이지 전환 페이드 없음 (사용자 요청) — 라우트만 교체 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <Routes location={effectiveBackground ?? location}>
            <Route path="/" element={<HomePage />} />
            <Route path="/quarter" element={<QuarterPage />} />
            <Route path="/quarter/:year/:q" element={<QuarterDetailPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/watch/:aid/:ep" element={<WatchPage />} />
            <Route path="*" element={<HomePage />} />
          </Routes>
        </div>
      </main>
      {/* 모달은 자체 명령형 퇴장을 끝낸 뒤 navigate로 언마운트된다 — AnimatePresence exit에
          의존하지 않으며, 원본 카드 복구(animeModalOriginId 해제)는 모달의 언마운트 cleanup이 담당
          (여기서 onExitComplete로 지우면 빠른 재오픈 시 새 세션의 숨김을 늦게 지워 겹침) */}
      <AnimatePresence>
        {modalAnimeId !== null && Number.isFinite(modalAnimeId) && (
          <AnimeDetailModal key={modalAnimeId} animeId={modalAnimeId} background={effectiveBackground} />
        )}
      </AnimatePresence>
      <QueueLauncher />
      <BottomTabbar />
    </>
  );
}
