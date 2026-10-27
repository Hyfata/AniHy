import { useQuery } from '@tanstack/react-query';
import { get } from '../api/client';

export const DEFAULT_NEW_BADGE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

interface SiteConfig {
  new_badge_days: number;
}

/** Server runtime config (GET /api/config). Offline/error leaves data undefined,
   so callers fall back to defaults. */
export function useSiteConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: () => get<SiteConfig>('/config'),
    staleTime: 5 * 60 * 1000,
  });
}

/** New badge window in ms — settings.new_badge_days, default 3 days. */
export function useNewBadgeWindowMs(): number {
  const { data } = useSiteConfig();
  return (data?.new_badge_days ?? DEFAULT_NEW_BADGE_DAYS) * DAY_MS;
}

/** Whether an episode/anime was added within the given New window. */
export function hasRecentEpisode(value: string | null | undefined, windowMs: number): boolean {
  if (!value) return false;
  const t = new Date(value).getTime();
  return Number.isFinite(t) && Date.now() - t < windowMs;
}
