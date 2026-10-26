import { usePrefsStore } from '../stores/prefs';
import type { Theme } from '../stores/prefs';

const QUERY = '(prefers-color-scheme: dark)';
const DARK_BG = '#0b0c0f';
const LIGHT_BG = '#f4f5f7';

/** Apply the theme to <html data-theme> + theme-color meta. */
export function applyTheme(theme: Theme): void {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia(QUERY).matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? DARK_BG : LIGHT_BG);
}

// Store ↔ DOM wiring (imported for side effects by main.tsx)
applyTheme(usePrefsStore.getState().theme);
usePrefsStore.subscribe((state, prev) => {
  if (state.theme !== prev.theme) applyTheme(state.theme);
});
window.matchMedia(QUERY).addEventListener('change', () => {
  if (usePrefsStore.getState().theme === 'system') applyTheme('system');
});
