# AniHy Web (React SPA)

PHP SSR(`index.php`/`anime.php`/`watch.php` 등)을 대체하는 새 프론트엔드. React 18 + Vite + TypeScript, 서버는 `server/`(FastAPI).

## 개발 / 빌드

```bash
cd web
pnpm install          # 최초 1회 (esbuild 빌드 승인은 pnpm-workspace.yaml에 있음)
pnpm dev              # 개발 서버 http://localhost:5173 — /api, /media는 localhost:8000(FastAPI)으로 프록시
pnpm build            # tsc --noEmit + vite build → dist/
pnpm typecheck        # 타입 체크만
```

개발 서버를 쓰려면 FastAPI(`server/`, uvicorn, port 8000)가 떠 있어야 한다. 인증(게이트/세션)은 쿠키 기반이라 프록시 경유로 same-origin처럼 동작.

## 구조

```
src/
├── api/        client.ts(fetch 래퍼 + ApiError + 401 처리), types.ts(서버 응답 미러)
├── components/ TopNavbar, BottomTabbar, Modal, Spinner/Skeleton,
│               AnimeCard, EpisodeRow, ProgressRing (+ CSS Modules)
├── lib/        motion.ts (framer-motion 공통 transition/variants + reduced-motion 헬퍼)
├── pages/      GatePage(완성) + 나머지 플레이스홀더 (화면 구현 단계에서 채움)
├── stores/     auth.ts(identity, GET /api/auth/me), ui.ts(탭/모달 스택) — zustand
├── styles/     tokens.css(디자인 토큰), global.css(리셋+베이스)
└── App.tsx     라우터 + 앱 셸 + 페이지 전환
```

라우트: `/gate`, `/`, `/quarter`, `/quarter/:year/:q`, `/search`, `/library?sub=bookmark|history|downloads`, `/anime/:id`, `/watch/:aid/:ep`.

## 토큰 규약 (`src/styles/tokens.css`)

- **색**: `--color-*` (bg/surface/surface-light/primary/accent/text/text-muted/danger), 테두리는 `--border-subtle|default|strong`. 팔레트는 기존 `assets/css/style.css` 이식.
- **타입 스케일 고정**: `--text-xs`(12) ~ `--text-3xl`(28) 토큰만 사용. 임의의 px/rem font-size 직접 지정 금지. line-height는 `--leading-tight|normal|relaxed`.
- **간격**: 4px 그리드 `--space-1`(4) ~ `--space-10`(40)만 사용.
- **radii**: `--radius-sm`(8), `--radius`(14), `--radius-pill`(999).
- **shadow**: `--shadow-card|card-hover|tabbar|primary`.
- **z-index**: `--z-sticky-header`(50) < `--z-navbar/tabbar`(100) < `--z-modal`(200) < `--z-modal-top`(300) < `--z-alert`(10000). 임의 숫자 금지.
- **safe-area**: `--sat/sar/sab/sal` 토큰 = `var(--anihy-sat, env(safe-area-inset-top, 0px))` 패턴. 네이티브 레이어가 `:root`에 `--anihy-sa*`를 주입하면 자동 우선. **레이아웃에 영향 있는 safe-area 보정은 반드시 정적 CSS에 둘 것 — JS 주입 금지** (첫 페인트 레이스로 겹침 버그 재발, 구 코드베이스의 교훈). `viewport-fit=cover`는 index.html에 있음.
- 폰트: Pretendard Variable (CDN, index.html) + 시스템 폴팩. iOS 입력 필드 자동 줌 방지로 input은 16px 강제(global.css).

## 애니메이션 가이드 (framer-motion, `src/lib/motion.ts`)

- **spring**: 사용자와 상호작용하며 "튀는" 느낌이 필요한 곳 — 모달 진입/퇴장(`springPop`), 탭 인디케이터 슬라이드(`springGentle`), 게이트 카드 진입. 스프링은 duration 대신 stiffness/damping으로 튜닝.
- **tween**: 상태 색/투명도 변화·페이지 전환 등 결정적 타이밍이 필요한 곳 — 페이지 전환(`tweenNormal` 250ms), 백드롭 fade(`tweenFast` 150ms).
- **duration 스케일**: fast 150ms(호버/색 변화) / normal 250ms(전환 기본) / slow 400ms(목록 stagger·강조). 이 범위를 벗어나는 duration은 이유를 코드에 남길 것.
- **페이지 전환**: `AnimatePresence mode="wait"` + `pageVariants`(fade + 12px slide) — App.tsx에 이미 적용, 페이지는 그냥 라우트에 추가하면 됨.
- **prefers-reduced-motion**: 필수 존중. CSS 쪽은 global.css가 묠화, framer-motion 쪽은 `useMotionTransition()` 헬퍼로 transition을 duration 0으로 바꿔서 사용. 새 모션 컴포넌트를 만들 때 반드시 이 헬퍼를 거칠 것.
- 목록 등장은 `AnimeCard`의 `index` prop stagger(40ms × 최대 6)처럼 최대 지연을 캡할 것 — 긴 목록에서 후반 카드가 늦게 뜨는 것 방지.

## CSS 규약

- 컴포넌트 스타일은 CSS Modules(`X.module.css`), 전역 토큰/리셋만 `src/styles/`.
- 기존 구 클래스명 개념 이식: `.episode-thumb-badge`→`EpisodeRow.thumbBadge`, `.episode-submeta`→`submeta`, `.episode-progress-bar`→`progressBar`, `.zip-ring`→`ProgressRing`.
- 하단 탭바는 모바일에서 `position: fixed` 금지 — `sticky` + `#root` flex 컬럼 구조(툴터/safe-area 변동·러버밴드 대응). 데스크톱(≥769px)에서는 좌측 고정 사이드바로 전환.
