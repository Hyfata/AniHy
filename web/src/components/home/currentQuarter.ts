import type { QuarterGroup } from '../../api/types';

export interface CurrentQuarter {
  group: QuarterGroup;
  isCurrent: boolean;
}

/** Pick the current quarter; falls back to the most recent past quarter, then the first group. */
export function pickCurrentQuarter(quarters: QuarterGroup[] | undefined): CurrentQuarter | null {
  if (!quarters?.length) return null;
  const now = new Date();
  const nowYear = now.getFullYear();
  const nowQuarter = Math.floor(now.getMonth() / 3) + 1;

  let best: QuarterGroup | null = null;
  for (const g of quarters) {
    const isPast = g.year < nowYear || (g.year === nowYear && g.quarter <= nowQuarter);
    if (!isPast) continue;
    if (!best || g.year > best.year || (g.year === best.year && g.quarter > best.quarter)) {
      best = g;
    }
  }
  const group = best ?? quarters[0];
  return { group, isCurrent: group.year === nowYear && group.quarter === nowQuarter };
}
