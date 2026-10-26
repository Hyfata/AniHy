# AniHy App (Tauri 2 Mobile)

Tauri 2 기반 iOS/Android 앱. (구 Capacitor 앱 `native/`는 삭제됨 — Git 히스토리 참조)
웹 콘텐츠는 **원격 AniHy 서버**를 webview로 로드하고(기존 Capacitor `server.url`과 동일한 개념),
하단 탭바만 네이티브(직접 구현한 `tauri-plugin-anihy-tabs`)로 처리한다.

## 구조

```
app/
  package.json                    # @tauri-apps/cli 래퍼 (pnpm tauri ...)
  ui/index.html                   # 번들 부트스트랩: 서버 연결 → 원격 로드, 실패 → 오프라인 화면
  src-tauri/
    tauri.conf.json               # identifier kr.hyfata.anime, productName AniHy
    build.rs                      # ANIHY_SERVER_URL env를 바이너리에 고정
    src/lib.rs                    # 플러그인 등록 + get_server_url 커맨드
    capabilities/default.json
  plugins/anihy-tabs/             # 네이티브 탭바 플러그인 (Rust + Swift + Kotlin + guest-js)
    src/                          #   Rust: set_tabs/select_tab/get_insets/watch_* 커맨드
    ios/                          #   Swift: UITabBar 오버레이 (iOS 15+)
    android/                      #   Kotlin: BottomNavigationView 오버레이
    guest-js/                     #   JS 바인딩 tauri-plugin-anihy-tabs-api (web이 file: 의존)
```

## 원격 서버 URL 설정

Capacitor의 `server.url`과 달리 Tauri는 원격 URL 로드를 설정 파일로 지원하지 않는다.
대신 **번들된 `ui/index.html` 부트스트랩**이 시작 화면이 되고:

1. Rust 커맨드 `get_server_url`로 URL을 읽는다 — 값은 **빌드 시점 환경변수 `ANIHY_SERVER_URL`**로
   고정된다(`src-tauri/build.rs`). 미설정 시 플레이스홀더 `https://anime.hyfata.kr`.
2. 서버에 연결되면 `location.replace(url)`로 원격 React SPA를 로드.
3. 연결 실패(오프라인) 시 번들된 오프라인 화면 표시(다시 시도 버튼 + online 이벤트 자동 재시도).
   step 8에서 이 화면이 오프라인 보관함(저장본 목록/재생)으로 확장된다.

```bash
ANIHY_SERVER_URL=https://<실서버> ./scripts/sync-web.sh && pnpm tauri build        # 릴리스
ANIHY_SERVER_URL=http://10.0.2.2:8000 ./scripts/sync-web.sh && pnpm tauri android dev  # 개발(Android 에뮬레이터)
```

(오프라인 모드를 쓰지 않는 개발 사이클이면 sync-web.sh 생략 가능 — 부트스트랩이 SPA 미번들 시
정적 오프라인 화면으로 폴팩한다.)

⚠️ 운영 URL이 바이너리에 들어간다. 공개 CI/공유 머신에서 빌드할 때 env 주입에 주의
(기존 Capacitor의 `capacitor.config.ts` gitignore 규약과 같은 고려).

## 개발 환경 설정 (빌드 머신)

공통:

```bash
# Rust (rustup)
curl https://sh.rustup.rs -sSf | sh -s -- -y
cd app && pnpm install
```

### 데스크톱 (개발 확인용, Linux)

```bash
# Debian/Ubuntu webview 의존성
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
pnpm tauri dev
```

### Android

- Android Studio + SDK(API 34+), NDK, `ANDROID_HOME`/`NDK_HOME` 환경변수.
- `rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android`
- `pnpm tauri android init` → `src-tauri/gen/android` 생성(gitignore, 각자 생성)
- `pnpm tauri android dev` / `pnpm tauri android build`

### iOS (macOS + Xcode 필수)

- Xcode 15+, iOS 15.0+ 타깃.
- `rustup target add aarch64-apple-ios aarch64-apple-ios-sim`
- `pnpm tauri ios init` → `src-tauri/gen/apple` 생성(gitignore)
- `pnpm tauri ios dev` / Xcode에서 아카이브

### 아이콘

`src-tauri/icons/`에는 자동 생성된 **플레이스홀더** 아이콘이 들어 있다
(다크 배경 + accent 원). 실제 아이콘으로 교체:

```bash
pnpm tauri icon app-icon-1024.png   # app/ 루트의 원본 아이콘 사용
```

### 의존성 핀

- `Cargo.lock`에서 `rust-ini`를 **0.21.1로 핀**해 두다 — 0.21.3이 `ParseOption`에 필드를
  추가하면서 `tauri-plugin-deep-link 2.6.2`의 struct literal 초기화가 깨진다.
  deep-link 업데이트로 해결되면 핀 해제.
- CLI는 `cargo`가 PATH에 있어야 한다: `export PATH="$HOME/.cargo/bin:$PATH"`.

## 네이티브 탭바 플러그인 (`plugins/anihy-tabs`)

- JS → 네이티브: `setTabs(tabs)`, `setActiveTab(id)`, `getInsets()`
- 네이티브 → JS: `onTabSelected(cb)`(탭 선택), `onInsets(cb)`(safe-area + 탭바 높이 합산 inset)
- inset은 CSS 변수 `--anihy-sat/sar/sab/sal`로 주입된다(web `src/lib/tabs.ts`).
  **bottom은 OS safe-area + 네이티브 탭바 높이 합산** — 웹은 이 값으로 하단 패딩을 잡는다.
- 네이티브에서는 웹 `BottomTabbar`가 렌더되지 않는다(`isNative()` 분기).
- 아이콘 키는 SF Symbol 이름 기준(`house/calendar/magnifyingglass/square.stack`),
  Android는 플러그인 내 매핑표로 내장 드로어블에 대응(material 아이콘으로 교체 가능).

### ⚠️ 빌드 머신에서 검증해야 할 것 (이 환경에서 컴파일 불가)

Swift/Kotlin 파일은 Tauri 2 모바일 플러그인 관례에 맞춰 작성했지만 실기기/시뮬레이터
컴파일 검증이 안 된 상태다. `tauri ios init` / `tauri android init` 후:

- [ ] `ios/Package.swift`의 `Tauri` SPM 패키지 경로(`../.tauri/tauri-api`)가
      gen/apple 산출물과 맞는지 확인, 다륩면 수정
- [ ] Swift `Channel` 전송 API(`channel.send(...)`) 시그니처 확인 — 버전에 따라
      `sendChannelData` 등일 수 있음 (AnihyTabsPlugin.swift의 TODO 주석)
- [ ] `manager.viewController` 접근 경로 확인 (Tauri iOS Plugin API)
- [ ] `android/build.gradle.kts`의 `app.tauri:api` 버전을 gen/android와 통일
- [ ] Kotlin `Channel.send(JSObject)` 시그니처 확인
- [ ] iOS inset 푸시를 orientation 알림 근사 대신 `safeAreaInsets` KVO로 교체 검토
- [ ] 탭바 오버레이가 WKWebView 제스처(하단 스와이프)와 충돌하지 않는지 실기기 확인

## OIDC 로그인 딥링크 스캐폴드 (step 3.2a)

`tauri-plugin-deep-link` 의존성은 이미 추가돼 있다. 모바일 로그인은 webview 내
Keycloak 페이지 대신 **시스템 브라우저**(iOS ASWebAuthenticationSession / Android
Custom Tabs)로 authorize 플로우를 열고 커스텀 스킴으로 복귀하는 방식(계획 §3.2a).

남은 작업(빌드 머신):

- iOS: `tauri ios init` 후 gen/apple 프로젝트의 Info.plist에 URL scheme
  `kr.hyfata.anime` 등록(딥링크 플러그인 문서의 iOS 설정 절차). HTTPS universal link를
  쓸 경우 Associated Domains(`applinks:<도메인>`) + 서버 측 apple-app-site-association.
- Android: `tauri android init` 후 AndroidManifest에 intent-filter
  (`android:scheme="kr.hyfata.anime"`, host `auth`, pathPrefix `/callback`) 추가
  — deep-link 플러그인의 `tauri android` 설정 절차 따름.
- 콜백 수신: `tauri-plugin-deep-link`의 `on_open_url`로 `kr.hyfata.anime://auth/callback?...`
  를 받아 서버 `/api/auth/callback` 완료 후 세션 쿠키를 webview 저장소와 공유(step 3.2a 본구현).

## step 8 구현 현황 (Rust 다운로더 + 오프라인 모드)

구현 완료:

- **Rust 다운로더** (`src-tauri/src/downloads.rs`): reqwest(rustls) + tokio 스트리밍 저장
  (`.part` → 완료 시 rename), `download-progress` 이벤트(pct/bytes_per_sec/status) 푸시,
  개별/전체(순차)/취소/개별·애니·전체 삭제/목록 조회.
- **저장**: `{app_data_dir}/downloads/{aid}/{safe_ep}.mp4` (+ `.chapters.vtt`, `cover.{ext}`),
  메타는 rusqlite 자체 커넥션의 SQLite(`meta.db`, WAL) — downloads / local_history 테이블.
- **오프라인 재생**: 커스텀 프로토콜 `anihy://localhost/{video,chapters,cover}/...` —
  Range 지원(응답은 8 MiB 캡으로 잘라 206, 브라우저가 이어서 요청).
  Android/Windows는 `http://anihy.localhost/...` 오리진(web `lib/native.ts anihyOrigin()`이 분기).
- **오프라인 시청기록**: `record_local_history` UPSERT(synced=0) → `sync_history`가
  미동기화분을 `/api/history/bulk`로 POST(쿠키 첨부, 서버의 updated_at 최신 우선 규칙 활용)
  후 synced=1. 웹은 online 이벤트에서 `syncHistory()` 호출(WatchPage).
- **오프라인 SPA 번들**: `app/scripts/sync-web.sh`가 web 빌드 산출물을 `app/ui/spa/`에 복사
  (gitignore). 부트스트랩은 서버 probe 실패 시 `spa/index.html#offline=1`로 전환하고,
  SPA는 `#offline=1`이면 보관함(다운로드)/watch만 렌더하는 OfflineApp 분기로 진입한다.
  (vite `base: './'` + BrowserRouter basename `/spa` 처리. 주의: 오프라인 모드에서
  `/spa/library` 등 딥링크 새로고침은 정적 서빙이라 404 — 앱 내 네비게이션만 유효.)
- **인증 쿠키**: Rust가 `webview.cookies_for_url()`로 HttpOnly 포함 게이트/세션 쿠키를 읽어
  다운로드/동기화 요청에 첨부. JS는 `document.cookie`(비HttpOnly)를 보조로 전달.

### ⚠️ 모바일 빌드 머신 검증 사항 (step 8)

- [ ] **Android 쿠키**: tauri의 `cookies_for_url`은 Android 미지원(빈 Vec 반환) — 게이트/세션
      쿠키가 HttpOnly면 Android 다운로드가 401로 실패할 수 있다. 실기기에서 확인하고,
      실패 시 ① 서버가 비HttpOnly로도 발급하도록 조정하거나 ② 딥링크 로그인(step 3.2a)에서
      토큰을 앱 측 저장소에 보관해 Authorization 헤더로 전환하는 방안 검토.
- [ ] **iOS/Android 커스텀 프로토콜**: `anihy://` 스킴이 video 태그 src에서 Range 요청과
      함께 정상 동작하는지 실기기 확인 (WKWebView/안드로이드 WebView 모두).
- [ ] 오프라인 모드 진입: 비행기 모드에서 앱 실행 → 부트스트랩 → 오프라인 SPA →
      저장본 목록/로컬 재생/이어보기 → 온라인 복귀 시 시청기록 동기화 확인.
- [ ] 다운로드 중 앱 백그라운드 전환 시 태스크 생존/재개 동작 확인.

## step 9+에서 남은 것

- OIDC 딥링크 로그인 본구현 (§3.2a — 위 스캐폴드 참고)
- 다운로드 실패 재개(resume) — 현재는 `.part`를 이어받지 않고 처음부터 다시 받음
- 보관함 다운로드 탭의 오프라인 외 UI 다듬기 (선택 삭제 모드 등 구 native-bridge의 세부 UX)

