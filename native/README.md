# AniHy Native (Capacitor)

iOS/Android 네이티브 앱 래퍼. 웹 로직은 서버(`<private>/anime`) 그대로 사용하고,
앱에서는 `assets/js/native-bridge.js`가 다운로드/오프라인 재생/CSS 전체화면을 담당합니다.

> ⚠️ 운영 URL이 코드에 들어가므로 **`capacitor.config.ts`는 절대 커밋하지 않습니다.**
> (루트 `.gitignore`에 등록됨. 이 README에는 URL을 적지 마세요.)

## 구조

```
native/
  capacitor.config.example.ts  # 복사해서 capacitor.config.ts 생성 (gitignore)
  package.json
  www/
    index.html                 # 서버 연결 실패 시 표시되는 폴백 (server.url 빌드에서는 미사용)
    offline-player.html        # 오프라인 재생 전용 로컬 페이지 (번들, 네트워크 불필요)
    js/offline-player.js
    css/offline-player.css
    vendor/                    # sync-vendor.sh가 assets/player에서 복사 (gitignore)
  scripts/sync-vendor.sh
  ios/                         # iOS 프로젝트 (커밋됨 — 커스텀 SceneDelegate 포함.
                               #   단 sync 산출물 capacitor.config.json(실서버 URL)·public/은 gitignore)
  android/                     # `npx cap add`로 생성 (gitignore, 각자 생성)
```

## 최초 설정 (Mac, Capacitor 8 — Xcode 26+ 필요)

```bash
cd native
cp capacitor.config.example.ts capacitor.config.ts
# capacitor.config.ts의 url / allowNavigation을 실제 운영 주소로 교체

npm install
npm run vendor:sync     # assets/player → www/vendor 복사
# ios/는 레포에 커밋돼 있으므로 clone 후 그대로 사용 (커스텀 SceneDelegate 포함)
npx cap add android
npx cap sync            # capacitor.config.json / public/ 재생성 (gitignore라 clone에 없음)
```

## 실행/빌드

```bash
npx cap open ios        # Xcode에서 실행/아카이브
npx cap open android    # Android Studio에서 실행/APK·AAB 빌드
```

웹 수정 후에는 스토어 재배포 없이 서버만 반영되면 앱에 즉시 적용됩니다.
단, `www/offline-player.html`·플러그인 변경은 `npx cap sync` + 재빌드가 필요합니다.

## 동작 규약 (웹 ↔ 앱)

- 온라인: `server.url`의 원격 웹 로드. 보관함 탭(`?tab=library`) 2뎁스 =
  북마크 / 시청기록 / 다운로드(앱에서만 표시, 웹에서는 숨김).
  북마크·시청기록은 아직 미구현(플레이스홀더).
- 다운로드: 에피소드별 저장 버튼·전체 다운로드·watch 저장 버튼을 가로채
  앱 내부 저장소(`Directory.Data/downloads/{aid}/{ep}.mp4` + 챕터 VTT)에 저장.
  메타데이터는 Preferences(`anihy_downloads_v1`)에 보관.
- 보관함 > 다운로드: 애니별 분류, 그룹 탭 시 애니 모달을 **저장된 회차만**으로
  필터해 표시. 회차 탭 시 온라인이면 watch.php, 오프라인이면 로컬
  오프라인 플레이어로 재생 (Hyfata UI + 저장 회차 목록 + 자동 다음화 + 이어보기).
- 전체화면: 네이티브 전체화면(`webkitEnterFullscreen` 등)을 쓰지 않고
  CSS 전체화면(`.vp-css-fullscreen`)으로 강제 → iOS 전체화면에서도 자체 UI 유지.

## 오프라인 확인 체크리스트

1. 비행기 모드 OFF에서 회차 1개 저장 → 보관함 > 다운로드에 애니별 표시 확인
2. 비행기 모드 ON에서 앱 재실행 → 저장 회차 탭 → 오프라인 UI + 재생 확인
3. 전체화면 진입 → Hyfata 컨트롤(재생바/스킵/설정) 표시 확인 (iOS 포함)
4. 자동 다음화 ON에서 끝나면 다음 저장 회차로 이동 확인

## iOS 참고 (Xcode 26+)

- 최소 iOS 15.0. 구형 iOS 크래시는 Capacitor 메이저 지원 범위를 먼저 확인할 것
  (Capacitor 7은 구형이라 최신 iOS에서 네이티브층이 깨질 수 있음 → 8로 업그레이드).
- 오프라인 저장은 앱 샌드박스(`Directory.Data`)라 별도 권한 불필요.
- 앱 아이콘/스플래시는 `npx cap asset` 또는 Xcode Asset Catalog에서 교체.
- 푸시 등 추가 플러그인 도입 시 `npx cap sync` 후 Pod 재설치.

## Android 참고

- `http://localhost` 스킴에서 로컬 오프라인 페이지 로드.
- cleartext 비활성화 유지 (운영 서버는 https).
