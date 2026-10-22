import { create } from 'zustand';
import { API_BASE, get, post, setOnLoginRequired } from '../api/client';
import type { Identity } from '../api/types';

interface AuthState {
  /** GET /api/auth/me 결과. null = 아직 로드 전 */
  identity: Identity | null;
  loading: boolean;
  fetchIdentity: () => Promise<void>;
  login: () => void;
  logout: () => Promise<void>;
  /** 401(로그인 필요) 응답 시 클라이언트 상태를 로그아웃으로 동기화 */
  markLoggedOut: () => void;
}

export const useAuthStore = create<AuthState>((set, getState) => ({
  identity: null,
  loading: false,

  fetchIdentity: async () => {
    if (getState().loading) return;
    set({ loading: true });
    try {
      const identity = await get<Identity>('/auth/me');
      set({ identity, loading: false });
    } catch {
      // 게이트 401이면 client.ts가 /gate로 리다이렉트함 — 여기선 조용히 실패
      set({ loading: false });
    }
  },

  login: () => {
    // Keycloak authorize 플로우는 서버가 302로 시작 — 전체 페이지 이동
    window.location.assign(`${API_BASE}/auth/login`);
  },

  logout: async () => {
    await post('/auth/logout');
    set({ identity: { user_id: null, is_admin: false, logged_in: false } });
  },

  markLoggedOut: () => {
    const { identity } = getState();
    if (identity?.logged_in) {
      set({ identity: { ...identity, logged_in: false } });
    }
  },
}));

// API 클라이언트에서 로그인 필요 401이 오면 스토어를 동기화
setOnLoginRequired(() => useAuthStore.getState().markLoggedOut());
