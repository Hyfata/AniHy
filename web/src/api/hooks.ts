/* TanStack Query 훅 — 서버 응답 shape은 api/types.ts 미러링 기준. */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { get } from './client';
import type {
  AnimeListResponse,
  QuarterDetailResponse,
  QuarterGroup,
  TrendingItem,
} from './types';

export const HOME_PAGE_SIZE = 30;

/** 홈 무한스크롤 — GET /api/animes?offset&limit (LIMIT+1 서버 has_more 판별) */
export function useAnimesInfinite() {
  return useInfiniteQuery({
    queryKey: ['animes', 'infinite'],
    queryFn: ({ pageParam }) =>
      get<AnimeListResponse>(`/animes?offset=${pageParam}&limit=${HOME_PAGE_SIZE}`),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      if (!lastPage.has_more) return undefined;
      return pages.reduce((acc, p) => acc + p.animes.length, 0);
    },
  });
}

/** 분기 아카이브 — GET /api/quarters */
export function useQuarters() {
  return useQuery({
    queryKey: ['quarters'],
    queryFn: () => get<{ quarters: QuarterGroup[] }>('/quarters'),
    select: (data) => data.quarters,
  });
}

/** 분기 상세 — GET /api/quarters/{year}/{q}?day= */
export function useQuarterDetail(year: number, quarter: number, day?: string) {
  const qs = day ? `?day=${encodeURIComponent(day)}` : '';
  return useQuery({
    queryKey: ['quarters', year, quarter, day ?? ''],
    queryFn: () => get<QuarterDetailResponse>(`/quarters/${year}/${quarter}${qs}`),
    enabled: quarter >= 1 && quarter <= 4,
  });
}

/** 검색 — GET /api/search?q= (로마자 근사 매칭은 서버가 결과에 포함) */
export function useSearchTitles(query: string) {
  return useQuery({
    queryKey: ['search', query],
    queryFn: () =>
      get<AnimeListResponse>(`/search?q=${encodeURIComponent(query)}`),
    enabled: query.trim().length > 0,
    placeholderData: (prev) => prev, // 입력 중 이전 결과 유지 (깜빡임 방지)
  });
}

/** 인기 검색어 — GET /api/search/trending */
export function useTrending() {
  return useQuery({
    queryKey: ['search', 'trending'],
    queryFn: () => get<{ trending: TrendingItem[] }>('/search/trending'),
    select: (data) => data.trending,
    staleTime: 60_000,
  });
}
