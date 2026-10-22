/* 온라인/오프라인 연결 상태 (navigator.onLine + online/offline 이벤트). */

import { create } from 'zustand';

interface ConnectivityState {
  online: boolean;
  init: () => void;
}

let bound = false;

export const useConnectivityStore = create<ConnectivityState>((set) => ({
  online: navigator.onLine,
  init: () => {
    if (bound) return;
    bound = true;
    const update = () => set({ online: navigator.onLine });
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
  },
}));
