/* 시청 진행률 서버 저장 + 구 localStorage(anime_{aid}_{ep}) 마이그레이션.
   - 저장: PUT /api/history/{aid}/{ep} (ms 단위 position/duration)
   - pagehide: fetch keepalive (sendBeacon은 POST만 가능해 PUT 라우트와 맞지 않음)
   - 마이그레이션: 구 키 {currentTime(sec), duration(sec), updatedAt(ms)} → POST /api/history/bulk 후 삭제, 1회만 실행 */

import { API_BASE, get, post, put } from '../api/client';
import type { WatchProgress } from '../api/types';

export const SAVE_THROTTLE_MS = 5000;

const LEGACY_KEY_RE = /^anime_(\d+)_(.+)$/;
const MIGRATION_FLAG = 'anihy_history_migrated_v1';

interface HistoryEntry extends WatchProgress {
  completed: boolean;
}

function historyPath(aid: number, ep: string): string {
  return `/history/${aid}/${encodeURIComponent(ep)}`;
}

/** 서버 진행률 조회. 기록 없음(404) 또는 비로그인(401)이면 null. */
export async function getHistory(aid: number, ep: string): Promise<HistoryEntry | null> {
  try {
    return await get<HistoryEntry>(historyPath(aid, ep));
  } catch {
    return null;
  }
}

export async function saveHistory(
  aid: number,
  ep: string,
  positionMs: number,
  durationMs: number,
): Promise<void> {
  await put(historyPath(aid, ep), {
    position_ms: Math.round(positionMs),
    duration_ms: Math.round(durationMs),
  });
}

/** pagehide/언마운트용 — 응답을 기다리지 않고 최대한 전송만 보장. */
export function saveHistoryKeepalive(
  aid: number,
  ep: string,
  positionMs: number,
  durationMs: number,
): void {
  try {
    void fetch(`${API_BASE}${historyPath(aid, ep)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        position_ms: Math.round(positionMs),
        duration_ms: Math.round(durationMs),
      }),
      credentials: 'same-origin',
      keepalive: true,
    }).catch(() => {});
  } catch {
    // 페이지 언로드 중 예외는 무시
  }
}

interface LegacyProgress {
  currentTime?: number;
  duration?: number;
  updatedAt?: number;
}

/** 구 localStorage 진행률(`anime_{aid}_{ep}`, 초 단위)을 서버로 옮기고 키 삭제.
   로그인 상태에서 1회만 실행 (플래그 키). */
export async function migrateLocalHistory(): Promise<void> {
  if (localStorage.getItem(MIGRATION_FLAG)) return;
  localStorage.setItem(MIGRATION_FLAG, '1');

  const items: {
    anime_id: number;
    episode_number: string;
    position_ms: number;
    duration_ms: number;
    updated_at: number;
  }[] = [];
  const keys: string[] = [];

  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key) continue;
    const m = LEGACY_KEY_RE.exec(key);
    if (!m) continue;
    let parsed: LegacyProgress | null = null;
    try {
      parsed = JSON.parse(localStorage.getItem(key) ?? '') as LegacyProgress;
    } catch {
      parsed = null;
    }
    keys.push(key);
    if (!parsed || typeof parsed.currentTime !== 'number') continue;
    items.push({
      anime_id: Number(m[1]),
      episode_number: m[2],
      position_ms: Math.round(parsed.currentTime * 1000),
      duration_ms: Math.round((parsed.duration ?? 0) * 1000),
      updated_at: parsed.updatedAt ?? Date.now(),
    });
  }

  try {
    if (items.length > 0) {
      await post('/history/bulk', items);
    }
    // 전송 성공(또는 옮길 게 없음)일 때만 구 키 삭제 — 실패 시 다음 로그인 때 재시도
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // 네트워크/401 실패 — 키를 남겨 두고 다음 로그인 때 다시 시도
  }
}
