import { useEffect, useRef, useState } from 'react';
import { useSearchTitles, useTrending } from '../api/hooks';
import { AnimeGrid, AnimeGridSkeleton } from '../components/home/AnimeGrid';
import { RecentSearches, TrendingSearches } from '../components/search/SearchPanels';
import searchStyles from '../components/search/search.module.css';
import styles from './pages.module.css';

const RECENT_KEY = 'anihy_recent_searches';
const RECENT_MAX = 8;
const DEBOUNCE_MS = 250;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function pushRecent(term: string): string[] {
  const next = [term, ...loadRecent().filter((t) => t !== term)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // 저장 실패는 무시 (사파리 프라이빗 모드 등)
  }
  return next;
}

/** 검색 (/search) — index.php search 탭 대응: 디바운스 검색 + 트렌딩/최근 검색어 */
export function SearchPage() {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: trending } = useTrending();
  const trimmed = query.trim();
  const { data, isFetching, isError } = useSearchTitles(trimmed);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 디바운스
  useEffect(() => {
    const timer = setTimeout(() => setQuery(input), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  // 결과가 나오면 최근 검색어에 기록 (서버는 상위 1건을 search_hits에 기록)
  const resultCount = data?.animes.length ?? 0;
  useEffect(() => {
    if (trimmed && resultCount > 0) {
      setRecent(pushRecent(trimmed));
    }
  }, [trimmed, resultCount]);

  const select = (term: string) => {
    setInput(term);
    setQuery(term);
    inputRef.current?.focus();
  };

  const clear = () => {
    setInput('');
    setQuery('');
    inputRef.current?.focus();
  };

  const clearRecent = () => {
    try {
      localStorage.removeItem(RECENT_KEY);
    } catch {
      // 무시
    }
    setRecent([]);
  };

  const searching = trimmed.length > 0;

  return (
    <div className="container">
      <div className={styles.header}>
        <h1 className={styles.title}>검색</h1>
      </div>

      <div className={searchStyles.searchBox}>
        <div className={searchStyles.inputWrap}>
          <input
            ref={inputRef}
            type="text"
            className={searchStyles.input}
            placeholder="제목으로 검색 (한글은 로마자 발음으로도 찾아줍니다)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') clear();
            }}
            maxLength={100}
            autoComplete="off"
            enterKeyHint="search"
          />
          {input && (
            <button type="button" className={searchStyles.clear} onClick={clear} aria-label="지우기">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {!searching ? (
        <>
          <RecentSearches items={recent} onSelect={select} onClear={clearRecent} />
          <TrendingSearches items={trending ?? []} onSelect={select} />
        </>
      ) : (
        <>
          <p className={searchStyles.status}>
            {isFetching
              ? '검색 중…'
              : isError
                ? '검색에 실패했습니다.'
                : `'${trimmed}' 검색 결과 ${resultCount}건`}
          </p>
          {isFetching && !data ? (
            <AnimeGridSkeleton count={9} />
          ) : resultCount === 0 && !isFetching ? (
            <div className={styles.placeholder}>검색 결과가 없습니다.</div>
          ) : (
            <AnimeGrid animes={data?.animes ?? []} />
          )}
        </>
      )}
    </div>
  );
}
