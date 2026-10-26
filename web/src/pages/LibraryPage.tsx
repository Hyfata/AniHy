import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get } from '../api/client';
import type { Bookmark } from '../api/types';
import { BookmarkTab } from '../components/library/BookmarkTab';
import { DownloadsTab } from '../components/library/DownloadsTab';
import { HistoryTab } from '../components/library/HistoryTab';
import { MoreMenu } from '../components/library/MoreMenu';
import libStyles from '../components/library/library.module.css';
import styles from './pages.module.css';

const SUB_TABS = [
  { id: 'bookmark', label: '북마크' },
  { id: 'history', label: '시청기록' },
  { id: 'downloads', label: '다운로드' },
] as const;

export type LibrarySub = (typeof SUB_TABS)[number]['id'];

export function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('sub');
  const sub: LibrarySub = SUB_TABS.some((t) => t.id === raw) ? (raw as LibrarySub) : 'bookmark';

  const { data: bookmarks } = useQuery({
    queryKey: ['bookmarks'],
    queryFn: async () => (await get<{ bookmarks: Bookmark[] }>('/bookmarks')).bookmarks,
  });

  const [selectMode, setSelectMode] = useState(false);
  const [clearSignal, setClearSignal] = useState(0);
  const onClearHandled = useCallback(() => setClearSignal(0), []);
  useEffect(() => {
    setSelectMode(false);
  }, [sub]);

  const select = (id: LibrarySub) => {
    setParams({ sub: id }, { replace: true });
  };

  const activeIndex = SUB_TABS.findIndex((t) => t.id === sub);
  const navRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  // Slide the active-tab indicator to the measured button offset — same
  // measurement-based pattern as BottomTabbar (framer layoutId drifts when a
  // page scroll reset happens mid-transition).
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const el = itemRefs.current[activeIndex];
      setIndicator(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [activeIndex, bookmarks?.length]);

  return (
    <div className="container">
      <div className={styles.header}>
        <h1 className={styles.title}>보관함</h1>
        <MoreMenu onSelectDelete={() => setSelectMode(true)} onClearAll={() => setClearSignal((s) => s + 1)} />
      </div>
      <nav ref={navRef} className={libStyles.subtabs}>
        {indicator && (
          <span
            className={libStyles.subtabIndicator}
            style={{ left: indicator.left, width: indicator.width }}
            aria-hidden="true"
          />
        )}
        {SUB_TABS.map((t, i) => (
          <button
            key={t.id}
            type="button"
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            className={`${libStyles.subtab}${sub === t.id ? ` ${libStyles.subtabActive}` : ''}`}
            onClick={() => select(t.id)}
          >
            <span style={{ position: 'relative', zIndex: 1 }}>
              {t.label}
              {t.id === 'bookmark' && (
                <span className={libStyles.subtabCount}>{bookmarks?.length ?? 0}</span>
              )}
            </span>
          </button>
        ))}
      </nav>
      {sub === 'bookmark' && (
        <BookmarkTab
          selectMode={selectMode}
          onSelectModeChange={setSelectMode}
          clearSignal={clearSignal}
          onClearHandled={onClearHandled}
        />
      )}
      {sub === 'history' && (
        <HistoryTab
          selectMode={selectMode}
          onSelectModeChange={setSelectMode}
          clearSignal={clearSignal}
          onClearHandled={onClearHandled}
        />
      )}
      {sub === 'downloads' && (
        <DownloadsTab
          selectMode={selectMode}
          onSelectModeChange={setSelectMode}
          clearSignal={clearSignal}
          onClearHandled={onClearHandled}
        />
      )}
    </div>
  );
}
