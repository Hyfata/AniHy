# CONTRIBUTING.md — AniHy 개발 규약

웹 프론트엔드(`web/`)의 개발 규약 모음. 설치/실행/설정은 각 README를 참조.

## 문서 유지 규칙

기능/규약/설정/경로가 바뀌는 수정이라면 **관련 Markdown 문서를 같은 작업에서 함께 갱신**할 것:

| 문서 | 역할 |
|------|------|
| `README.md`, `server/README.md`, `web/README.md`, `app/README.md`, `deploy/README.md` | 운영 문서 — 설치/실행/설정/구조/배포 |
| `CONTRIBUTING.md` (이 파일) | 개발 규약 — 토큰/애니메이션/CSS |

문서가 코드와 어긋나는 상태를 두지 않는다.

## 디자인 토큰 규약 (`web/src/styles/tokens.css`)

- **색**: `--color-*` (bg/surface/surface-light/primary/accent/text/text-muted/danger 등), 테두리는 `--border-subtle|default|strong`.
- **타입 스케일 고정**: `--text-xs`(12) ~ `--text-3xl`(28) 토큰만 사용. 임의의 px/rem font-size 직접 지정 금지. line-height는 `--leading-tight|normal|relaxed`, weight는 `--font-weight-*`.
- **간격**: 4px 그리드 `--space-1`(4) ~ `--space-10`(40)만 사용.
- **radii**: `--radius-sm`(8), `--radius`(14), `--radius-pill`(999).
- **shadow**: `--shadow-card|card-hover|tabbar|primary`.
- **z-index**: `--z-sticky-header`(50) < `--z-navbar/tabbar`(100) < `--z-modal`(200) < `--z-modal-top`(300) < `--z-alert`(10000). 임의 숫자 금지.
- **레이아웃**: `--navbar-height`(64), `--container-max`(1200), `--sidebar-w`(200, 데스크톱 사이드바).
- **safe-area**: `--sat/sar/sab/sal` 토큰 = `var(--anihy-sat, env(safe-area-inset-top, 0px))` 패턴. 네이티브 레이어가 `:root`에 `--anihy-sa*`를 주입하면 자동 우선. **레이아웃에 영향 있는 safe-area 보정은 반드시 정적 CSS에 둘 것 — JS 주입 금지** (첫 페인트 레이스). `viewport-fit=cover`는 index.html에 있음.
- **모션**: duration은 `--duration-fast|normal|slow` 토큰과 아래 애니메이션 가이드의 스케일을 따른다.
- 폰트: Pretendard Variable (CDN, index.html) + 시스템 폴팩. iOS 입력 필드 자동 줌 방지로 input은 16px 강제(global.css).

## 애니메이션 가이드 (framer-motion, `web/src/lib/motion.ts`)

- **spring**: 사용자와 상호작용하며 "튀는" 느낌이 필요한 곳 — 모달 진입/퇴장(`springPop`), 게이트 카드 진입. 스프링은 duration 대신 stiffness/damping으로 튜닝.
- **tween**: 상태 색/투명도 변화·페이지 전환 등 결정적 타이밍이 필요한 곳 — 페이지 전환(`tweenNormal` 250ms), 백드롭 fade(`tweenFast` 150ms).
- **탭 인디케이터처럼 형제 사이를 이동하는 강조 요소**: framer `layoutId`가 아니라 측정 기반 단일 요소의 CSS transition(BottomTabbar 패턴 — offset 측정 후 left/width transition, 0.38s cubic-bezier(0.25,0.9,0.28,1))으로 구현. `layoutId`는 페이지 스크롤 리셋과 결합하면 측정이 어긋나 애니메이션이 지연/누락된다.
- **duration 스케일**: fast 150ms(호버/색 변화) / normal 250ms(전환 기본) / slow 400ms(목록 stagger·강조). 이 범위를 벗어나는 duration은 이유를 코드에 남길 것.
- **페이지 전환**: `AnimatePresence mode="wait"` + `pageVariants`(fade + 12px slide) — App.tsx에 이미 적용, 페이지는 그냥 라우트에 추가하면 됨.
- **prefers-reduced-motion**: 필수 존중. CSS 쪽은 global.css가 묠화, framer-motion 쪽은 `useMotionTransition()` 헬퍼로 transition을 duration 0으로 바꿔서 사용. 새 모션 컴포넌트를 만들 때 반드시 이 헬퍼를 거칠 것.
- 목록 등장은 `AnimeCard`의 `index` prop stagger(40ms × 최대 6)처럼 최대 지연을 캡할 것 — 긴 목록에서 후반 카드가 늦게 뜨는 것 방지.
- UI 전환/애니메이션은 Safari + PC/모바일 모두 정상 동작해야 한다.

## CSS 규약

- 컴포넌트 스타일은 CSS Modules(`X.module.css`), 전역 토큰/리셋만 `web/src/styles/`.
- 기존 구 클래스명 개념 이식: `.episode-thumb-badge`→`EpisodeRow.thumbBadge`, `.episode-submeta`→`submeta`, `.episode-progress-bar`→`progressBar`, `.zip-ring`→`ProgressRing`.
- 모든 `:hover` 규칙은 `@media (hover: hover)` 안에 둘 것 (터치 디바이스 sticky hover 방지). 터치 피드백은 `:active`를 고려.
- 하단 탭바(BottomTabbar)는 모바일에서 `position: fixed` — sticky는 iOS 러버밴드 스크롤에서 본문과 같이 튄다. 가려지는 본문 하단 여백은 global.css `.appMain`의 모바일 `padding-bottom: calc(88px + var(--sab))`이 담당. 데스크톱(≥769px)에서는 좌측 고정 사이드바로 전환되고 본문 오프셋은 `.appMain`의 `padding-left: var(--sidebar-w)`.
