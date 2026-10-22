import { useEffect } from 'react';
import type { RefObject } from 'react';

const SWIPE_MIN_PX = 70;
/** 수직 우세 조건: |dy| >= |dx| * DOMINANCE */
const DOMINANCE = 1.5;

/** fullscreen.js 스와이프 포팅: 플레이어 위에서 위로 쓸기 → 전체화면,
   전체화면 중 아래로 쓸기 → 해제. 70px+ 수직 우세일 때만 인식하고,
   인식 시 capture 단계에서 탭(재생 토글)을 차단한다.
   진입·해제 모두 플레이어의 FS 버튼 click 경로를 재사용. */
export function usePlayerSwipe(containerRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    let gesture: { x: number; y: number; vp: HTMLElement } | null = null;

    const onTouchStart = (e: TouchEvent) => {
      gesture = null;
      if (e.touches.length !== 1) return;
      const t = e.target as HTMLElement | null;
      if (!t || typeof t.closest !== 'function') return;
      const vp = t.closest('.vp') as HTMLElement | null;
      if (!vp || !root.contains(vp)) return;
      // 컨트롤/버튼/설정 시트 위에서 시작한 제스처는 무시
      if (t.closest('.vp__controls, .vp__menu, .vp__menu-backdrop, .vp__btn, input, select')) return;
      gesture = { x: e.touches[0].clientX, y: e.touches[0].clientY, vp };
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!gesture) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - gesture.x;
      const dy = t.clientY - gesture.y;
      const vp = gesture.vp;
      gesture = null;
      if (Math.abs(dy) < SWIPE_MIN_PX || Math.abs(dy) < Math.abs(dx) * DOMINANCE) return;
      // 재생 토글 탭으로 오인되지 않게 차단
      e.stopImmediatePropagation();
      e.preventDefault();
      // vp--fullscreen 클래스는 네이티브/CSS 전체화면 모두에서 플레이어가 토글
      const inFs = vp.classList.contains('vp--fullscreen');
      if (dy < 0 ? inFs : !inFs) return; // 위: 이미 전체화면이면 무시 / 아래: 전체화면 아니면 무시
      const btn = vp.querySelector<HTMLElement>('.vp__btn--fullscreen');
      btn?.click();
    };

    document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    document.addEventListener('touchend', onTouchEnd, { capture: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart, { capture: true });
      document.removeEventListener('touchend', onTouchEnd, { capture: true });
    };
  }, [containerRef]);
}
