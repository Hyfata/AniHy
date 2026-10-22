/* 네이티브 다운로드 진행률/저장본 상태 (zustand).
   앱 전역에서 Rust의 download-progress 이벤트를 1회 구독해 공유한다. */

import { create } from 'zustand';
import {
  isNative,
  listDownloads,
  onDownloadProgress,
} from '../lib/native';
import type { DownloadProgress } from '../lib/native';

export interface ActiveDownload {
  pct: number;
  bytesPerSec: number;
  status: DownloadProgress['status'];
  message?: string;
}

interface DownloadsState {
  /** 초기화 여부 (이벤트 구독 + 저장본 캐시 로드) */
  ready: boolean;
  /** key: `${aid}/${ep}` — 진행 중 다운로드 */
  active: Record<string, ActiveDownload>;
  /** key: `${aid}/${ep}` — 저장 완료 회차 */
  downloaded: Record<string, true>;
  init: () => void;
  refresh: () => Promise<void>;
}

export const dlKey = (aid: number, ep: string) => `${aid}/${ep}`;

export const useDownloadsStore = create<DownloadsState>((set, get) => ({
  ready: false,
  active: {},
  downloaded: {},

  init: () => {
    if (get().ready || !isNative()) return;
    set({ ready: true });
    void get().refresh();
    void onDownloadProgress((p) => {
      set((s) => {
        const key = dlKey(p.aid, p.ep);
        const active = { ...s.active };
        const downloaded = { ...s.downloaded };
        if (p.status === 'completed') {
          delete active[key];
          if (p.ep !== '*') downloaded[key] = true;
        } else if (p.status === 'failed' || p.status === 'cancelled') {
          if (p.ep === '*') {
            // 전체 취소 — 해당 애니의 진행 중 항목 전부 제거
            for (const k of Object.keys(active)) {
              if (k.startsWith(`${p.aid}/`)) delete active[k];
            }
          } else {
            delete active[key];
          }
        } else {
          active[key] = { pct: p.pct, bytesPerSec: p.bytesPerSec, status: p.status };
        }
        return { active, downloaded };
      });
    }).catch(() => {});
  },

  refresh: async () => {
    const items = await listDownloads();
    const downloaded: Record<string, true> = {};
    for (const a of items) {
      for (const e of a.episodes) downloaded[dlKey(a.animeId, e.episodeNumber)] = true;
    }
    set({ downloaded });
  },
}));
