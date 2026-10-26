# AniHy Web (React SPA)

React 18 + Vite + TypeScript 프론트엔드. 서버는 `server/`(FastAPI).

## 개발 / 빌드

전제: 저장소 클론 후 **`git submodule update --init`** — 플레이어(`@player` alias)가
repo 루트의 `assets/player` 서브모듈을 가리키므로 없으면 빌드가 실패한다.
개발 서버는 FastAPI(`server/`, uvicorn, port 8000)가 떠 있어야 한다.

```bash
cd web
pnpm install          # 최초 1회 (esbuild 빌드 승인은 pnpm-workspace.yaml에 있음)
pnpm dev              # 개발 서버 http://localhost:5173
pnpm build            # tsc --noEmit + vite build → dist/
pnpm typecheck        # 타입 체크만
```

개발 서버 프록시(`vite.config.ts`): `/api`는 그대로, `/anime-test/api`와 `/anime/api`는
프리픽스를 벗겨서(rewrite) `localhost:8000`으로 전달. 인증(게이트/세션)은 쿠키 기반이라
프록시 경유로 same-origin처럼 동작한다.

## 구조

```
src/
├── api/        client.ts(fetch 래퍼 + API_BASE/401 처리), hooks.ts, types.ts
├── components/ 공용(AnimeCard, EpisodeRow, Modal, TopNavbar, BottomTabbar, ...) +
│               화면별 디렉터리(admin/, anime/, home/, library/, player/, quarter/, search/)
├── lib/        motion, history, native(앱 브리지), tabs, viewTransition, scrollLock 등
├── pages/      Home, Quarter, QuarterDetail, Search, Library, Watch, Gate
├── stores/     auth, ui, dialog, downloads, connectivity — zustand
├── styles/     tokens.css(디자인 토큰), global.css(리셋+베이스)
└── App.tsx     라우터 + 앱 셸 + 페이지 전환
```

라우트: `/gate`, `/`, `/quarter`, `/quarter/:year/:q`, `/search`,
`/library?sub=bookmark|history|downloads`, `/watch/:aid/:ep`.
`/anime/:id`는 전체 페이지가 아니라 목록 위에 뜨는 모달 오버레이다.
앱 오프라인 모드는 `/spa` + `#offline=1` (보관함/재생만 렌더하는 OfflineApp 분기).

서브경로 배포(예: `/anime`) 시 프리픽스 감지와 조정 절차는 루트 README의
"URL 프리픽스 설정" 참조.

## 플레이어 (`@player`)

`assets/player`(Hyfata-Media-Player-JS 서브모듈)를 vite alias `@player`로 빌드 타임에
번들한다 (`vite.config.ts`의 alias + commonjsOptions + optimizeDeps 참조).
서브모듈 수정은 원본 저장소에 커밋한 뒤 포인터를 갱신할 것.

## 개발 규약

디자인 토큰, 애니메이션, CSS 규약은 [../CONTRIBUTING.md](../CONTRIBUTING.md) 참조.
