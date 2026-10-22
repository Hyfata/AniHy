/* Tauri 네이티브 탭바 연동.
   네이티브(Tauri webview)에서만 로드되며, 웹 하단 탭바를 대신할 네이티브 탭바를
   등록하고 탭 선택 ↔ 라우터를 양방향 동기화한다.
   safe-area inset은 네이티브가 푸시하는 값을 CSS 변수(--anihy-sa*)로 주입한다. */

import { getInsets, onInsets, onTabSelected, setActiveTab, setTabs } from 'tauri-plugin-anihy-tabs-api';
import { isNative } from './native';

export type NativeTabId = 'home' | 'quarter' | 'search' | 'library';

const TABS: Array<{ id: NativeTabId; label: string; icon: string }> = [
  { id: 'home', label: '홈', icon: 'house' },
  { id: 'quarter', label: '분기', icon: 'calendar' },
  { id: 'search', label: '검색', icon: 'magnifyingglass' },
  { id: 'library', label: '보관함', icon: 'square.stack' },
];

const TAB_ROUTES: Record<NativeTabId, string> = {
  home: '/',
  quarter: '/quarter',
  search: '/search',
  library: '/library',
};

export function nativeTabForPath(pathname: string): NativeTabId {
  if (pathname.startsWith('/quarter')) return 'quarter';
  if (pathname.startsWith('/search')) return 'search';
  if (pathname.startsWith('/library')) return 'library';
  return 'home';
}

function applyInsets(insets: { top: number; right: number; bottom: number; left: number }): void {
  const style = document.documentElement.style;
  style.setProperty('--anihy-sat', `${insets.top}px`);
  style.setProperty('--anihy-sar', `${insets.right}px`);
  style.setProperty('--anihy-sab', `${insets.bottom}px`);
  style.setProperty('--anihy-sal', `${insets.left}px`);
}

/**
 * 네이티브 탭바 초기화. 네이티브가 아니면 아무것도 하지 않는다.
 * @param navigate react-router navigate 함수
 * @returns cleanup (언마운트 시 구독 해제)
 */
export async function initNativeTabs(
  navigate: (to: string) => void,
): Promise<(() => void) | null> {
  if (!isNative()) return null;

  // 웹 하단 탭바 숨김 플래그 (BottomTabbar가 isNative()로 null 렌더 + CSS 분기용)
  document.documentElement.dataset.native = '';

  await setTabs(TABS);

  const unbindTab = await onTabSelected((event) => {
    const route = TAB_ROUTES[event.id as NativeTabId];
    if (route) navigate(route);
  });

  // 현재 라우트를 네이티브 탭 선택 상태에 반영
  await setActiveTab(nativeTabForPath(window.location.pathname));

  // safe-area inset: 즉시 1회 + 변화 구독
  applyInsets(await getInsets());
  const unbindInsets = await onInsets(applyInsets);

  return () => {
    unbindTab();
    unbindInsets();
  };
}

/** 라우트 변화 시 네이티브 탭 선택 동기화. */
export async function syncNativeTab(pathname: string): Promise<void> {
  if (!isNative()) return;
  await setActiveTab(nativeTabForPath(pathname));
}
