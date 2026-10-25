const NEW_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/** Whether an episode/anime was added within the New window (3 days). */
export function hasRecentEpisode(value?: string | null): boolean {
  if (!value) return false;
  const t = new Date(value).getTime();
  return Number.isFinite(t) && Date.now() - t < NEW_WINDOW_MS;
}
