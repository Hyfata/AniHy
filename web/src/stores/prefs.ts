import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'system' | 'dark' | 'light';

interface PrefsState {
  theme: Theme;
  /** Auto-play the next episode (WatchPage) */
  autoNext: boolean;
  /** New-episode notification — stored only; no delivery channel yet */
  notifyNewEpisodes: boolean;
  setTheme: (theme: Theme) => void;
  setAutoNext: (autoNext: boolean) => void;
  setNotifyNewEpisodes: (notifyNewEpisodes: boolean) => void;
}

// One-time migration of the pre-prefs auto-next key written by WatchPage
function migrateLegacyAutoNext(): boolean {
  const legacy = localStorage.getItem('anihy_auto_next');
  if (legacy === null) return true;
  localStorage.removeItem('anihy_auto_next');
  return legacy !== '0';
}

/** Device-local UI preferences (theme/playback/notification toggles). */
export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      theme: 'system',
      autoNext: migrateLegacyAutoNext(),
      notifyNewEpisodes: false,
      setTheme: (theme) => set({ theme }),
      setAutoNext: (autoNext) => set({ autoNext }),
      setNotifyNewEpisodes: (notifyNewEpisodes) => set({ notifyNewEpisodes }),
    }),
    { name: 'anihy_prefs' },
  ),
);
