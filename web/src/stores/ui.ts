import { create } from 'zustand';
import type { ReactNode } from 'react';

export type TabId = 'home' | 'quarter' | 'search' | 'library';

export interface ModalEntry {
  id: string;
  node: ReactNode;
}

interface UiState {
  activeTab: TabId;
  /** 마지막으로 머문 목록 페이지 경로 — watch에서 애니 모달을 열 때 배경으로 사용 */
  lastListPath: string;
  /** 카드→모달 공유 요소 전환 중인 애니 id — 해당 카드는 포스터만 숨겨 이중 렌더를 막는다 (제목은 그대로) */
  animeModalOriginId: number | null;
  /** 모달 스택 — 위에 쌓일수록 나중 엔트리 */
  modalStack: ModalEntry[];
  /** 대기열 포스터 → 애니 상세 모달 진입 직전의 경로 — 모달이 그 경로로 돌아오면 대기열을 다시 연다 */
  queueReopenOrigin: string | null;
  setActiveTab: (tab: TabId) => void;
  setLastListPath: (path: string) => void;
  setAnimeModalOrigin: (id: number | null) => void;
  pushModal: (entry: ModalEntry) => void;
  popModal: (id?: string) => void;
  clearModals: () => void;
  setQueueReopenOrigin: (origin: string | null) => void;
}

let modalSeq = 0;

export const useUiStore = create<UiState>((set) => ({
  activeTab: 'home',
  lastListPath: '/',
  animeModalOriginId: null,
  modalStack: [],
  queueReopenOrigin: null,
  setActiveTab: (tab) => set({ activeTab: tab }),
  setLastListPath: (path) => set({ lastListPath: path }),
  setAnimeModalOrigin: (id) => set({ animeModalOriginId: id }),
  pushModal: (entry) =>
    set((s) => ({ modalStack: [...s.modalStack, { ...entry, id: entry.id || `modal-${++modalSeq}` }] })),
  popModal: (id) =>
    set((s) => ({
      modalStack: id ? s.modalStack.filter((m) => m.id !== id) : s.modalStack.slice(0, -1),
    })),
  clearModals: () => set({ modalStack: [] }),
  setQueueReopenOrigin: (origin) => set({ queueReopenOrigin: origin }),
}));
