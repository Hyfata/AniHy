import { flushSync } from 'react-dom';
import type { NavigateFunction } from 'react-router-dom';
import { useUiStore } from '../stores/ui';
import { lockScroll, unlockScroll } from './scrollLock';

/** 카드↔애니 모달 공유 요소 전환 (View Transitions API).
   iOS 폴더 열기 모델: 카드 박스가 모달 패널로 커지고(패널 스냅샷에 translate/scale 곡선),
   포스터만 카드 포스터↔히어로 포스터로 정밀 모핑. 제목은 모핑하지 않고 모달과 함께 나타남
   (텍스트 스냅샷 크로스페이드는 고스팅이 어색함).
   - 패널의 카드→모달 성장은 CSS 변수(--vt-dx/dy/sx/sy)로 전달 — 매 전환마다 카드/패널 rect 측정
   - 이름이 있는 엘리먼트가 스냅샷에 한 번만 있어야 하는 것이 핵심 규약 */

interface ViewTransitionLike {
  finished: Promise<void>;
  skipTransition(): void;
}

type DocWithVt = Document & {
  startViewTransition?: (update: () => void) => ViewTransitionLike;
};

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function vtEnabled(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof (document as DocWithVt).startViewTransition === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export const VT_POSTER = 'anime-vt-poster';
export const VT_PANEL = 'anime-vt-panel';
export const VT_BACKDROP = 'anime-vt-backdrop';

function cardEls(animeId: number) {
  const card = document.querySelector<HTMLElement>(`[data-anime-id="${animeId}"]`);
  if (!card) return null;
  const poster = card.firstElementChild as HTMLElement | null;
  if (!poster) return null;
  return { card, poster };
}

function tagCard(animeId: number) {
  cardEls(animeId)?.poster.style.setProperty('view-transition-name', VT_POSTER);
}

function untagCard(animeId: number) {
  cardEls(animeId)?.poster.style.removeProperty('view-transition-name');
}

/** 패널 스냅샷의 시작(열기)/끝(닫기) 변환 — 측정값을 담은 keyframes를 <style>로 주입.
   CSS 변수를 keyframes 안에서 읽는 방식은 WebKit VT 의사요소가 애니메이션 시작 시점의
   값으로 굳어져(또는 무시돼) 성장이 적용되지 않는 문제가 있었다 — 매 전환마다 구체 값을 주입. */
function setPanelMotion(from: Rect | null, to: Rect | null) {
  let dx = 0, dy = 20, sx = 0.97, sy = 0.97; // 카드 없음(직접 진입 등) — 가벼운 팝 폴백
  if (from && to && to.width > 0 && to.height > 0) {
    dx = from.left - to.left;
    dy = from.top - to.top;
    sx = from.width / to.width;
    sy = from.height / to.height;
  }
  let style = document.getElementById('vt-panel-motion') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'vt-panel-motion';
    document.head.appendChild(style);
  }
  style.textContent = `
@keyframes vtPanelGrow {
  from { opacity: 0.4; transform: translate(${dx}px, ${dy}px) scale(${sx}, ${sy}); }
  to { opacity: 1; transform: none; }
}
@keyframes vtPanelShrink {
  from { opacity: 1; transform: none; }
  to { opacity: 0; transform: translate(${dx}px, ${dy}px) scale(${sx}, ${sy}); }
}`;
}

function rectOf(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

const panelEl = () => document.querySelector<HTMLElement>('[data-vt-panel]');

/** 카드 → 모달. VT 불가/reduced motion이면 일반 navigate (모달이 자체 팝으로 열림). */
export function openAnimeModalVt(
  animeId: number,
  background: { pathname: string; search?: string; hash?: string },
  navigate: NavigateFunction,
): void {
  const go = () => navigate(`/anime/${animeId}`, { state: { background } });
  const doc = document as DocWithVt;
  if (!vtEnabled()) {
    go();
    return;
  }
  const cardRect = cardEls(animeId) ? rectOf(cardEls(animeId)!.card) : null;
  // 스크롤 잠금을 transition "이전"으로 — 콜백 안(모달 마운트)에서 잠그면 old/new 스냅샷 사이에
  // body가 fixed로 리레이아웃돼 iOS에서 스크롤된 상태일수록 배경이 깜빡인다.
  // 모달도 마운트 시 자체 lock을 걸고 언마운트 때 푸니 refcount로 균형이 맞는다.
  lockScroll();
  tagCard(animeId);
  const vt = doc.startViewTransition!(() => {
    flushSync(go);
    untagCard(animeId);
    // 원본 카드 포스터는 새 스냅샷에서 숨김 — 모핑이 끝날 때까지 카드 자리에 남지 않게
    flushSync(() => useUiStore.getState().setAnimeModalOrigin(animeId));
    const panel = panelEl();
    setPanelMotion(cardRect, panel ? rectOf(panel) : null);
  });
  void vt.finished.catch(() => {}).finally(() => unlockScroll());
}

/** 모달 → 카드. 열기와 같은 같은-이름 모핑 경로로 닫는다: 콜백에서 카드에 패널/포스터
   이름을 부여하면 old=모달 패널/히어로 포스터 ↔ new=카드/카드 포스터가 UA 기본 모핑으로 수렴
   (old-only 커스텀 애니메이션은 iOS에서 재생이 불안정했다). */
export function closeAnimeModalVt(
  animeId: number,
  target: string,
  navigate: NavigateFunction,
): void {
  const doc = document as DocWithVt;
  if (!vtEnabled()) {
    navigate(target);
    return;
  }
  // 열기와 대칭: 카드는 움직이지 않는다. old-only 커스텀 애니메이션은 WebKit/iOS에서
  // 렌더되지 않으므로(실측), 검증된 같은-이름 모핑 경로를 쓴다 — 카드 위치에 놓인
  // 투명 플레이스홀더가 패널의 착지 대상. 패널은 그 자리로 수축하며 투명에 크로스페이드.
  // 잠금 해제는 전환 종료 후 — 시작 즉시 풀면 전환 중 스크롤이 가능해져 스냅샷과
  // 라이브가 어긋난다. (끝날 때의 뚝 끊김은 iOS의 fixed→static 리플로우 자체의 문제)
  lockScroll();
  const vt = doc.startViewTransition!(() => {
    // 카드 포스터를 먼저 복구(숨김 상태면 스냅샷에서 제외됨)
    flushSync(() => useUiStore.getState().setAnimeModalOrigin(null));
    tagCard(animeId);
    // 백드롭 페이드아웃도 같은-이름 모핑으로 — 전화면 투명 플레이스홀더가 착지 대상
    // (old-only 커스텀 애니메이션은 WebKit/iOS에서 렌더되지 않음)
    const bph = document.createElement('div');
    bph.id = 'vt-close-backdrop-target';
    bph.style.cssText = `position:fixed;inset:0;view-transition-name:${VT_BACKDROP};pointer-events:none;`;
    document.body.appendChild(bph);
    const card = cardEls(animeId)?.card ?? null;
    if (card) {
      const c = rectOf(card);
      const ph = document.createElement('div');
      ph.id = 'vt-close-target';
      ph.style.cssText =
        `position:fixed;left:${c.left}px;top:${c.top}px;width:${c.width}px;height:${c.height}px;` +
        `view-transition-name:${VT_PANEL};pointer-events:none;`;
      document.body.appendChild(ph);
    }
    // 모달 쪽 이름 제거 — 언마운트 지연(AnimatePresence) 시 새 스냅샷에 이름 중복 방지.
    // overlay/backdrop는 숨겨서 지연 언마운트돼도 새 스냅샷에 모달이 남지 않게 한다.
    document
      .querySelectorAll<HTMLElement>('[data-hero-poster], [data-vt-panel], [data-vt-backdrop], [data-vt-overlay]')
      .forEach((el) => el.style.removeProperty('view-transition-name'));
    document
      .querySelectorAll<HTMLElement>('[data-vt-overlay], [data-vt-backdrop]')
      .forEach((el) => {
        el.style.display = 'none';
      });
    flushSync(() => navigate(target));
  });
  void vt.finished.catch(() => {}).then(() => {
    untagCard(animeId);
    document.getElementById('vt-close-target')?.remove();
    document.getElementById('vt-close-backdrop-target')?.remove();
    unlockScroll();
  });
}
