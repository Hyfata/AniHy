import type { CapacitorConfig } from '@capacitor/cli';

/**
 * AniHy Capacitor 설정 예시.
 *
 * 사용법:
 *   1) 이 파일을 `capacitor.config.ts`로 복사
 *   2) 아래 `url`과 `allowNavigation`을 실제 운영 주소로 교체
 *   3) `capacitor.config.ts`는 .gitignore 처리되어 절대 커밋되지 않음
 *      (운영 URL이 외부에 공유되면 안 되기 때문)
 */
const config: CapacitorConfig = {
  appId: 'kr.hyfata.anime',
  appName: 'AniHy',
  webDir: 'www',
  backgroundColor: '#0b0c0f',
  server: {
    // ⚠️ 실제 운영 URL로 교체할 것 (예: https://<private-host>/anime)
    url: 'https://your-private-host.example/anime',
    cleartext: false,
    // WebView에서 외부 이동을 허용할 호스트 (운영 도메인만)
    allowNavigation: ['your-private-host.example'],
  },
  ios: {
    // 'never' 필수: 페이지가 viewport-fit=cover + env(safe-area-inset-*)로
    // safe area를 직접 처리하므로 WebView가 인셋을 또 넣으면 스크롤 시
    // 상단 바/사이드바가 safe area 밖으로 밀려남
    contentInset: 'never',
    allowsLinkPreview: false,
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    CapacitorHttp: { enabled: false },
  },
};

export default config;
