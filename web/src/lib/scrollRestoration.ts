import { useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/** 페이지 이동 시 항상 맨 위로 (SPA는 브라우저가 스크롤을 리셋하지 않음).
   예외:
   - 모달 열기(state.background 있음): 배경 페이지 스크롤 유지
   - 모달 닫기(직전이 모달이고 그 배경 경로로 돌아옴): 유지 — 닫기 비행 클론이
     카드 위치로 날아가야 하므로 배경이 움직이면 안 됨
   - 같은 pathname+search 내부 변화: 유지 */
export function useScrollRestoration() {
  const location = useLocation();
  const prevRef = useRef(location);

  // useLayoutEffect: 페인트 전에 스크롤을 리셋해야 sticky 탭바가 점프하면서
  // framer 인디케이터(layoutId) 측정이 어긋나 지연/누락되지 않는다
  useLayoutEffect(() => {
    const prev = prevRef.current;
    prevRef.current = location;

    const st = location.state as { background?: { pathname?: string } } | null;
    if (st?.background) return; // 모달 열기

    const prevBg = (prev.state as { background?: { pathname?: string } } | null)?.background;
    if (prevBg && prevBg.pathname === location.pathname) return; // 모달 닫기

    if (prev.pathname === location.pathname && prev.search === location.search) return;

    window.scrollTo(0, 0);
  }, [location]);
}
