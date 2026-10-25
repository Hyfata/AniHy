import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { get } from '../api/client';
import type { Bookmark } from '../api/types';
import { BookmarkTab } from '../components/library/BookmarkTab';
import { DownloadsTab } from '../components/library/DownloadsTab';
import { HistoryTab } from '../components/library/HistoryTab';
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

  const select = (id: LibrarySub) => {
    setParams({ sub: id }, { replace: true });
  };

  return (
    <div className="container">
      <div className={styles.header}>
        <h1 className={styles.title}>보관함</h1>
      </div>
      <nav className={libStyles.subtabs}>
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
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
      {sub === 'bookmark' && <BookmarkTab />}
      {sub === 'history' && <HistoryTab />}
      {sub === 'downloads' && <DownloadsTab />}
    </div>
  );
}
