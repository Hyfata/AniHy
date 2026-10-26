import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchSuggestions, useSearchTitles, useTrending } from '../api/hooks';
import { FadeSwap } from '../components/FadeSwap';
import { AnimeGrid, AnimeGridSkeleton } from '../components/home/AnimeGrid';
import { RecentSearches, SearchSuggestions, TrendingSearches } from '../components/search/SearchPanels';
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

/** 검색 (/search) — 타이핑 중엔 연관 검색어만 제안하고, 검색 확정(Enter/모바일 키보드 검색
   버튼/제안 탭) 시에만 결과 표시 + 최근 검색어 기록 (중간 타이핑이 기록을 오염시키지 않도록) */
export function SearchPage() {
  const [input, setInput] = useState('');
  const [committed, setCommitted] = useState('');
  const [suggestQuery, setSuggestQuery] = useState('');
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: trending } = useTrending();
  const committedTrim = committed.trim();
  const { data, isFetching, isError } = useSearchTitles(committedTrim);
  const { data: suggestData, isFetching: suggestFetching } = useSearchSuggestions(suggestQuery);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 연관 검색어 디바운스
  useEffect(() => {
    const timer = setTimeout(() => setSuggestQuery(input.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  // 확정 검색이 결과를 내면 최근 검색어에 기록 (서버는 상위 1건을 search_hits에 기록)
  const resultCount = data?.animes.length ?? 0;
  useEffect(() => {
    if (committedTrim && resultCount > 0) {
      setRecent(pushRecent(committedTrim));
    }
  }, [committedTrim, resultCount]);

  const commit = (term: string) => {
    setInput(term);
    setCommitted(term.trim());
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    commit(input);
    inputRef.current?.blur(); // 모바일 키보드를 내려 결과가 보이게
  };

  const clear = () => {
    setInput('');
    setCommitted('');
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

  const inputTrim = input.trim();
  const viewingResults = committedTrim.length > 0 && inputTrim === committedTrim;
  const typing = inputTrim.length > 0 && !viewingResults;
  const suggestions = suggestData?.suggestions ?? [];

  return (
    <div className="container">
      <div className={styles.header}>
        <h1 className={styles.title}>검색</h1>
      </div>

      <form className={searchStyles.searchBox} role="search" onSubmit={onSubmit}>
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
      </form>

      {typing ? (
        suggestions.length > 0 ? (
          <SearchSuggestions items={suggestions} onSelect={commit} />
        ) : !suggestFetching && suggestQuery ? (
          <p className={searchStyles.status}>일치하는 제목이 없습니다. Enter로 직접 검색할 수 있습니다.</p>
        ) : null
      ) : !viewingResults ? (
        <>
          <RecentSearches items={recent} onSelect={commit} onClear={clearRecent} />
          <TrendingSearches items={trending ?? []} onSelect={commit} />
        </>
      ) : (
        <>
          <p className={searchStyles.status}>
            {isFetching
              ? '검색 중…'
              : isError
                ? '검색에 실패했습니다.'
                : `'${committedTrim}' 검색 결과 ${resultCount}건`}
          </p>
          <FadeSwap loading={isFetching && !data} skeleton={<AnimeGridSkeleton count={9} />}>
            {resultCount === 0 && !isFetching ? (
              <div className={styles.placeholder}>검색 결과가 없습니다.</div>
            ) : (
              <AnimeGrid animes={data?.animes ?? []} />
            )}
          </FadeSwap>
        </>
      )}
    </div>
  );
}
