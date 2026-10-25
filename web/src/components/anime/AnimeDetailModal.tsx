import { motion } from 'framer-motion';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import type { Location } from 'react-router-dom';
import { springPop } from '../../lib/motion';
import { lockScroll, unlockScroll } from '../../lib/scrollLock';
import { VT_BACKDROP, VT_PANEL, closeAnimeModalVt, vtEnabled } from '../../lib/viewTransition';
import { useUiStore } from '../../stores/ui';
import { AnimeDetailView } from './AnimeDetailView';
import styles from './AnimeDetailModal.module.css';

/** /anime/:id 라우트 모달 — 목록 페이지 위에 덮는다 (location.state.background 패턴).

   전환은 View Transitions API (lib/viewTransition.ts, global.css의 anime-vt-* 규칙):
   열기는 openAnimeModalVt가 카드를 태그하고, 이 모달의 히어로 포스터/제목이 같은 이름을
   갖는다 (AnimeDetailView). 닫기는 closeAnimeModalVt가 카드에 이름을 돌려주며 언마운트.
   VT 미지원/reduced motion이면 VT 없이 일반 팝인 + 즉시 언마운트.

   닫기(백드롭/X/Esc)는 navigate(-1)이 아니라 **배경 위치로 명시적 push 이동**:
   push로 닫아야 닫기 → 뒤로가기 시 모달이 되살아남 (정상 동작). */
export function AnimeDetailModal({
  animeId,
  background,
}: {
  animeId: number;
  background: Location | undefined;
}) {
  const navigate = useNavigate();
  const vt = vtEnabled();
  const [hasOrigin] = useState(
    () => typeof document !== 'undefined' && !!document.querySelector(`[data-anime-id="${animeId}"]`),
  );
  const useVt = vt && hasOrigin;
  const panelRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);

  // 스크롤 잠금 — overflow:hidden은 WebKit이 scrollY를 0으로 리셋하므로 fixed-body 락 사용
  useLayoutEffect(() => {
    lockScroll();
    return () => {
      unlockScroll();
      // Restore the origin card poster when the modal unmounts via other navigation
      if (useUiStore.getState().animeModalOriginId === animeId) {
        useUiStore.getState().setAnimeModalOrigin(null);
      }
    };
  }, [animeId]);

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    const target = background
      ? `${background.pathname}${background.search ?? ''}${background.hash ?? ''}`
      : '/';
    if (useVt) {
      closeAnimeModalVt(animeId, target, navigate);
    } else {
      navigate(target);
    }
  }, [animeId, background, navigate, useVt]);

  // Esc — 중첩 모달(관리자 수정/추가 등)이 위에 열려 있으면 최상단만 닫힘
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const dialogs = document.querySelectorAll('[role="dialog"]');
      const top = dialogs[dialogs.length - 1];
      if (top && panelRef.current && top !== panelRef.current) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

  return createPortal(
    <>
      <motion.div
        className={styles.backdrop}
        data-vt-backdrop
        style={useVt ? { viewTransitionName: VT_BACKDROP } : undefined}
        initial={useVt ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={useVt ? undefined : { opacity: 0 }}
        transition={{ duration: 0.2 }}
      />
      <div
        className={styles.overlay}
        data-vt-overlay
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <motion.div
          ref={panelRef}
          className={styles.panel}
          data-vt-panel
          role="dialog"
          aria-modal="true"
          style={useVt ? { viewTransitionName: VT_PANEL } : undefined}
          initial={useVt ? false : { opacity: 0, y: 18, scale: 0.97 }}
          animate={useVt ? {} : { opacity: 1, y: 0, scale: 1 }}
          exit={useVt ? undefined : { opacity: 0, y: 12, scale: 0.96 }}
          transition={springPop}
        >
          <button
            type="button"
            className={styles.close}
            onClick={close}
            aria-label="닫기"
          >
            ×
          </button>
          <div className={styles.scroll}>
            {/* VT 전환 중엔 라이브 문서가 스냅샷 아래 숨으므로 히어로 자체 애니메이션은 항상 끈다.
                콘텐츠는 모핑 직후 살짝 지연 fade */}
            <AnimeDetailView animeId={animeId} contentDelay={useVt ? 0.15 : 0} heroStatic />
          </div>
        </motion.div>
      </div>
    </>,
    document.body,
  );
}
