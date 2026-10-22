import { motion, useAnimationControls } from 'framer-motion';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import type { Location } from 'react-router-dom';
import { springPop, useReducedMotion } from '../../lib/motion';
import { useUiStore } from '../../stores/ui';
import { AnimeDetailView } from './AnimeDetailView';
import styles from './AnimeDetailModal.module.css';

/** 패널 확장용 스프링 (진입). 클론은 CSS transition — 아래 FLIGHT_* 상수 참조 */
const expandSpring = { type: 'spring', stiffness: 260, damping: 30 } as const;

/** 퇴장(패널 수축)은 완료를 기다려 navigate하므로 스프링 정착 대신 고정시간 tween —
   스프링 정확 정착은 1초+ 걸려 닫기가 느려 보인다 */
const exitTween = { type: 'tween', duration: 0.28, ease: [0.3, 0, 0.4, 1] } as const;

/** 클론 비행: framer가 font-size를 보간하지 못해 CSS transition으로 구동.
   지속시간은 진입 패널 스프링의 체감과 맞춤 */
const FLIGHT_DURATION_MS = 400;
const FLIGHT_TRANSITION = `left ${FLIGHT_DURATION_MS}ms cubic-bezier(0.22, 0.9, 0.28, 1), top ${FLIGHT_DURATION_MS}ms cubic-bezier(0.22, 0.9, 0.28, 1), width ${FLIGHT_DURATION_MS}ms cubic-bezier(0.22, 0.9, 0.28, 1), height ${FLIGHT_DURATION_MS}ms cubic-bezier(0.22, 0.9, 0.28, 1), font-size ${FLIGHT_DURATION_MS}ms cubic-bezier(0.22, 0.9, 0.28, 1), line-height ${FLIGHT_DURATION_MS}ms cubic-bezier(0.22, 0.9, 0.28, 1)`;

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Flight {
  posterSrc: string | null;
  posterFrom: Rect;
  posterTo: Rect;
  titleText: string;
  titleFrom: Rect;
  titleTo: Rect;
  titleFromFont: number;
  titleToFont: number;
  /** px 라인하이트 보간 (글자 크기만 커지고 줄간격이 안 맞으면 착지 때 튐) */
  titleFromLh: number;
  titleToLh: number;
}

/** 최종 패널 rect — AnimeDetailModal.module.css 미러링 (≤640px 풀스크린, 아니면 960px/86vh 중앙).
   첫 렌더에서 패널 변환을 계산하기 위해 필요. 패널 CSS를 바꾸면 여기도 같이 바꿀 것. */
function finalPanelRect(): Rect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const mobile = vw <= 640;
  const w = mobile ? vw : Math.min(960, vw - 32);
  const h = mobile ? vh : vh * 0.86;
  return { left: mobile ? 0 : (vw - w) / 2, top: mobile ? 0 : (vh - h) / 2, width: w, height: h };
}

function toRect(r: DOMRect): Rect {
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/** transform 무시 레이아웃 좌표 (offsetParent 체인 합산).
   getBoundingClientRect는 패널의 비행 transform을 포함해 측정이 오염되므로
   마운트 측정은 전부 이 함수로 한다. */
function layoutRect(el: HTMLElement): Rect {
  let left = 0;
  let top = 0;
  let cur: HTMLElement | null = el;
  while (cur) {
    left += cur.offsetLeft;
    top += cur.offsetTop;
    cur = cur.offsetParent as HTMLElement | null;
  }
  return { left, top, width: el.offsetWidth, height: el.offsetHeight };
}

/** 카드의 포스터/제목 rect와 텍스트/폰트 (AnimeCard 마크업 계약: 첫째 자식=포스터 div, h3=제목) */
function cardParts(animeId: number) {
  const cardEl = document.querySelector(`[data-anime-id="${animeId}"]`);
  if (!cardEl) return null;
  const posterEl = cardEl.firstElementChild;
  const titleEl = cardEl.querySelector('h3');
  if (!posterEl || !titleEl) return null;
  const posterRect = toRect(posterEl.getBoundingClientRect());
  if (posterRect.width === 0) return null;
  return {
    cardRect: toRect(cardEl.getBoundingClientRect()),
    posterRect,
    posterSrc: posterEl.querySelector('img')?.currentSrc ?? null,
    titleRect: toRect(titleEl.getBoundingClientRect()),
    titleText: titleEl.textContent ?? '',
    titleFont: parseFloat(getComputedStyle(titleEl).fontSize),
    titleLh: parseFloat(getComputedStyle(titleEl).lineHeight),
  };
}

interface HeroParts {
  posterRect: Rect;
  titleRect: Rect;
  titleFont: number;
  titleLh: number;
}

function heroPartsBase(
  panel: HTMLElement | null,
  measure: (el: HTMLElement) => Rect,
): HeroParts | null {
  const posterEl = panel?.querySelector('[data-hero-poster]');
  const titleEl = panel?.querySelector('[data-hero-title]');
  if (!posterEl || !titleEl) return null;
  const posterRect = measure(posterEl as HTMLElement);
  const titleRect = measure(titleEl as HTMLElement);
  if (posterRect.width === 0 || titleRect.width === 0) return null;
  return {
    posterRect,
    titleRect,
    titleFont: parseFloat(getComputedStyle(titleEl).fontSize),
    titleLh: parseFloat(getComputedStyle(titleEl).lineHeight),
  };
}

/** 진입 측정용 — transform 무시 레이아웃 좌표 (패널이 카드 변환 상태라도 정확) */
function heroLayoutParts(panel: HTMLElement | null): HeroParts | null {
  return heroPartsBase(panel, layoutRect);
}

/** 퇴장 측정용 — 시각 좌표 (패널은 identity, 모달 스크롤 가능) */
function heroVisualParts(panel: HTMLElement | null): HeroParts | null {
  return heroPartsBase(panel, (el) => toRect(el.getBoundingClientRect()));
}

/** /anime/:id 라우트 모달 — 목록 페이지 위에 덮는다 (location.state.background 패턴).

   수동 FLIP, 전 구간 결정적:
   - 패널 초기 변환은 첫 렌더에서 계산해 initial prop으로 (마운트 후 controls.set은
     Safari가 한 프레임 늦게 적용해 완성 모달이 번쩍인다).
   - 히어로/패널 측정은 layoutRect(offset 체인, transform 무시) — 미리 시작된 애니메이션이
     없으므로 정확. finalPanelRect 미러와 실제 레이아웃 차이는 페인트 전 controls.set 교정.
   - 클론(포스터/제목)은 CSS transition — framer는 font-size를 보간하지 못함(실측).
   - 히어로 자체 등장 애니메이션은 heroStatic으로 끈다 (켜져 있으면 측정이 왜곡됨).
   - 닫기: 패널 수축(exitTween) 완료 즉시 navigate. 퇴장 클론은 같은 시각에 시작해
     모달과 함께 언마운트된다 — 카드가 배경 목록에 없으면 열 때 기록한 위치(originCard)가 목표.
   - reduced motion이면 전부 생략하고 일반 fade/pop.

   닫기(백드롭/X/Esc)는 navigate(-1)이 아니라 **배경 위치로 명시적 push 이동**:
   모달 안에서 watch 등으로 갔다 닫으면 history.back은 그 페이지로 튀는 문제가 있고,
   push로 닫아야 닫기 → 뒤로가기 시 모달이 되살아남 (정상 동작). */
export function AnimeDetailModal({
  animeId,
  background,
}: {
  animeId: number;
  background: Location | undefined;
}) {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const setAnimeModalOrigin = useUiStore((s) => s.setAnimeModalOrigin);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelControls = useAnimationControls();
  const backdropControls = useAnimationControls();

  // 카드는 첫 렌더에서 측정 (background 페이지 DOM은 이미 커밋됨).
  // heroStatic 결정에 쓰이므로 레이아웃 이펙트보다 먼저여야 한다.
  const [originCard] = useState(() => (reducedMotion ? null : cardParts(animeId)));

  // 패널의 초기 변환도 첫 렌더에서 계산 — initial prop으로 넣어야 첫 프레임부터 정확한 위치다.
  const [origin] = useState(() => {
    if (!originCard) return null;
    const f = finalPanelRect();
    return {
      x: originCard.cardRect.left - f.left,
      y: originCard.cardRect.top - f.top,
      scaleX: originCard.cardRect.width / f.width,
      scaleY: originCard.cardRect.height / f.height,
      finalRect: f,
    };
  });

  // 'measure': 첫 레이아웃 측정 전 / 'enter': 진입 비행 / 'idle': 정상 표시 / 'exit': 퇴장 비행
  const [phase, setPhase] = useState<'measure' | 'enter' | 'idle' | 'exit'>('measure');
  const [flight, setFlight] = useState<Flight | null>(null);
  const [hideHero, setHideHero] = useState(false);
  const closingRef = useRef(false);
  const originRef = useRef<{ x: number; y: number; scaleX: number; scaleY: number } | null>(null);

  // 스크롤 잠금 — 측정보다 먼저 걸어야 좌표가 안 밀린다 (가장 먼저 선언된 layout effect)
  useLayoutEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const closeTarget = useCallback(() => {
    return background
      ? `${background.pathname}${background.search ?? ''}${background.hash ?? ''}`
      : '/';
  }, [background]);

  // ── 진입: 첫 페인트 전에 측정·시작 ─────────────────────────────
  useLayoutEffect(() => {
    const panelEl = panelRef.current;
    if (!panelEl) return;
    const hero = origin ? heroLayoutParts(panelEl) : null;

    if (origin && originCard && hero) {
      // 실제 패널 레이아웃과 미러(finalPanelRect)의 차이만큼 초기 변환을 교정
      // (스크롤바 거터 등으로 미러가 몇 px 어긋날 수 있음 — 페인트 전이라 안 보임)
      const actual = layoutRect(panelEl);
      const drifted = {
        x: origin.x + (origin.finalRect.left - actual.left),
        y: origin.y + (origin.finalRect.top - actual.top),
        scaleX: origin.scaleX * (origin.finalRect.width / actual.width),
        scaleY: origin.scaleY * (origin.finalRect.height / actual.height),
      };
      if (
        Math.abs(drifted.x - origin.x) > 0.5 ||
        Math.abs(drifted.y - origin.y) > 0.5 ||
        Math.abs(drifted.scaleX - origin.scaleX) > 0.001
      ) {
        panelControls.set({ ...drifted, borderRadius: 14 });
        originRef.current = drifted;
      } else {
        originRef.current = origin;
      }
      setFlight({
        posterSrc: originCard.posterSrc,
        posterFrom: originCard.posterRect,
        posterTo: hero.posterRect,
        titleText: originCard.titleText,
        titleFrom: originCard.titleRect,
        titleTo: hero.titleRect,
        titleFromFont: originCard.titleFont,
        titleToFont: hero.titleFont,
        titleFromLh: originCard.titleLh,
        titleToLh: hero.titleLh,
      });
      setHideHero(true);
      // 원본 카드 숨김은 클론 이미지가 디코드된 뒤에 — 미술 클론이 빈 프레임을 그리면
      // 카드가 먼저 사라져 포스터 자리가 한 프레임 비어 보인다(깜빡임).
      if (!originCard.posterSrc) setAnimeModalOrigin(animeId);
      void panelControls.start({
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        borderRadius: window.innerWidth <= 640 ? 0 : 14,
        transition: expandSpring,
      });
      void backdropControls.start({ opacity: 1, transition: { duration: 0.3 } });
      setPhase('enter');
      return;
    }

    // 폴백: 카드/히어로 측정 불가(직접 진입, reduced motion) — 일반 팝인
    originRef.current = null;
    void panelControls.start({ opacity: 1, y: 0, scale: 1, transition: springPop });
    void backdropControls.start({ opacity: 1, transition: { duration: 0.2 } });
    setPhase('idle');
  }, [animeId, origin, originCard, panelControls, backdropControls, setAnimeModalOrigin]);

  // 진입 클론 착지: 실제 히어로 표시 + 클론 제거
  const onEnterLanded = useCallback(() => {
    setFlight(null);
    setHideHero(false);
    setPhase('idle');
  }, []);

  // ── 닫기: 패널 수축 완료 즉시 navigate (클론은 같은 시각 시작, 별도 대기 없음) ──
  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    const done = () => navigate(closeTarget());

    const origin = originRef.current;
    const panelEl = panelRef.current;
    const hero = origin && !reducedMotion ? heroVisualParts(panelEl ?? null) : null;
    // 카드가 배경 목록에 없을 수도 있다(보관함 시청기록 등 카드가 아닌 행에서 온 플로우) —
    // 그때는 열 때 기록한 카드 위치(originCard)를 목표로 써서 클론이 항상 생성되게 한다.
    const cardNow = origin && !reducedMotion ? cardParts(animeId) : null;
    const cardTarget = cardNow ?? originCard;

    if (origin && hero && panelEl && cardTarget) {
      // 역방향 클론 (히어로→카드, 폰트 크기도 역보간)
      setFlight({
        posterSrc: cardTarget.posterSrc,
        posterFrom: hero.posterRect,
        posterTo: cardTarget.posterRect,
        titleText: cardTarget.titleText,
        titleFrom: hero.titleRect,
        titleTo: cardTarget.titleRect,
        titleFromFont: hero.titleFont,
        titleToFont: cardTarget.titleFont,
        titleFromLh: hero.titleLh,
        titleToLh: cardTarget.titleLh,
      });
      setHideHero(true);
      setPhase('exit');
      void backdropControls.start({ opacity: 0, transition: { duration: 0.22 } });
      void panelControls
        .start({ ...origin, borderRadius: 14, opacity: 0, transition: exitTween })
        .then(done);
      return;
    }

    // 폴백: 페이드아웃 후 이동
    void backdropControls.start({ opacity: 0, transition: { duration: 0.15 } });
    void panelControls
      .start({ opacity: 0, y: 20, scale: 0.97, transition: { duration: 0.18 } })
      .then(done);
  }, [animeId, background, originCard, reducedMotion, navigate, closeTarget, panelControls, backdropControls]);

  // Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 중첩 모달(관리자 수정/추가 등)이 위에 열려 있으면 최상단만 닫힘
      const dialogs = document.querySelectorAll('[role="dialog"]');
      const top = dialogs[dialogs.length - 1];
      if (top && panelRef.current && top !== panelRef.current) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

  // 언마운트(브라우저 뒤로가기 포함) 시 원본 카드 복구
  useEffect(() => {
    return () => setAnimeModalOrigin(null);
  }, [setAnimeModalOrigin]);

  return createPortal(
    <>
      {/* 백드롭은 패널의 형제 — 오버레이를 페이드시키면 패널 퇴장 비행이 같이 지워진다 */}
      <motion.div className={styles.backdrop} animate={backdropControls} initial={{ opacity: 0 }} />
      <div
        className={styles.overlay}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <motion.div
          ref={panelRef}
          className={`${styles.panel}${hideHero ? ` ${styles.panelHeroHidden}` : ''}`}
          role="dialog"
          aria-modal="true"
          style={{ transformOrigin: 'top left' }}
          animate={panelControls}
          initial={
            origin
              ? {
                  x: origin.x,
                  y: origin.y,
                  scaleX: origin.scaleX,
                  scaleY: origin.scaleY,
                  opacity: 1,
                  borderRadius: 14,
                }
              : { opacity: 0, y: 32, scale: 0.97 }
          }
        >
          <motion.button
            type="button"
            className={styles.close}
            onClick={close}
            aria-label="닫기"
            initial={originCard ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            transition={{ delay: originCard ? 0.3 : 0, duration: 0.2 }}
          >
            ×
          </motion.button>
          <div className={styles.scroll}>
            {/* contentDelay는 첫 렌더부터 확정돼야 한다 (phase 기준이면 지연 fade가 안 먹힘) */}
            <AnimeDetailView
              animeId={animeId}
              contentDelay={originCard ? 0.32 : 0}
              heroStatic={originCard !== null}
            />
          </div>
        </motion.div>
      </div>

      {/* FLIP 클론 — CSS transition 구동, 패널 밖 fixed라 중첩 transform 왜곡 없음 */}
      {flight?.posterSrc && (
        <FlightClone
          key={`poster-${phase}`}
          kind="poster"
          flight={flight}
          onLanded={phase === 'enter' ? onEnterLanded : undefined}
          onReady={phase === 'enter' ? () => setAnimeModalOrigin(animeId) : undefined}
        />
      )}
      {flight && flight.titleText && (
        <FlightClone
          key={`title-${phase}`}
          kind="title"
          flight={flight}
          onLanded={phase === 'enter' && !flight.posterSrc ? onEnterLanded : undefined}
        />
      )}
    </>,
    document.body,
  );
}

/** CSS transition으로 움직이는 FLIP 클론 — 마운트 시 from 스타일로 렌더 후
   첫 페인트 직후(rAF)에 to로 전환, transitionend(width/font-size)로 완료 보고 */
function FlightClone({
  kind,
  flight,
  onLanded,
  onReady,
}: {
  kind: 'poster' | 'title';
  flight: Flight;
  onLanded?: () => void;
  /** 포스터: 클론 이미지가 실제로 그릴 준비가 됐을 때 (카드 숨김 시점 결정용) */
  onReady?: () => void;
}) {
  const ref = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (kind === 'poster' && onReady) {
      const img = el as HTMLImageElement;
      if (img.complete && img.naturalWidth > 0) {
        onReady();
      } else {
        img.addEventListener('load', onReady, { once: true });
      }
    }
    const onEnd = (e: TransitionEvent) => {
      if (e.target !== el) return;
      if (e.propertyName === (kind === 'poster' ? 'width' : 'font-size')) {
        land();
      }
    };
    let landed = false;
    const land = () => {
      if (landed) return;
      landed = true;
      onLanded?.();
    };
    const timer = onLanded ? window.setTimeout(land, FLIGHT_DURATION_MS + 120) : undefined;
    // 초기 스타일을 강제 리플로우로 커밋한 뒤 같은 프레임에 목표 설정.
    // (rAF로 하면 WebKit은 첫 페인트 전에 적용해 transition이 시작되지 않고
    // 클론이 최종 위치로 순간이동한다 — Safari 퇴장 클론 무애니메이션 버그)
    void el.offsetWidth;
    const to = kind === 'poster' ? flight.posterTo : flight.titleTo;
    el.style.left = `${to.left}px`;
    el.style.top = `${to.top}px`;
    el.style.width = `${to.width}px`;
    if (kind === 'poster') {
      el.style.height = `${to.height}px`;
    } else {
      el.style.fontSize = `${flight.titleToFont}px`;
      el.style.lineHeight = `${flight.titleToLh}px`;
    }
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      if (onLanded) el.removeEventListener('transitionend', onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (kind === 'poster') {
    return (
      <img
        ref={(el) => {
          ref.current = el;
        }}
        src={flight.posterSrc ?? ''}
        alt=""
        className={styles.clonePoster}
        style={{
          left: flight.posterFrom.left,
          top: flight.posterFrom.top,
          width: flight.posterFrom.width,
          height: flight.posterFrom.height,
          transition: FLIGHT_TRANSITION,
        }}
      />
    );
  }
  return (
    <span
      ref={(el) => {
        ref.current = el;
      }}
      className={styles.cloneTitle}
      style={{
        left: flight.titleFrom.left,
        top: flight.titleFrom.top,
        width: flight.titleFrom.width,
        fontSize: flight.titleFromFont,
        lineHeight: `${flight.titleFromLh}px`,
        transition: FLIGHT_TRANSITION,
      }}
    >
      {flight.titleText}
    </span>
  );
}
