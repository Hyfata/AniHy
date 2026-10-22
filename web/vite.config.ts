import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 오프라인 번들(app/ui/spa)에서도 상대 경로로 에셋을 찾도록
  base: './',
  resolve: {
    alias: {
      // Hyfata-Media-Player-JS 서브모듈 (repo 루트의 assets/player)
      '@player': new URL('../assets/player', import.meta.url).pathname,
    },
  },
  server: {
    // @player alias가 web/ 루트 밖(../assets/player)을 가리키므로 dev 서빙 허용
    fs: { allow: ['..'] },
    port: 5173,
    allowedHosts: ['hyfata.kr', 'www.hyfata.kr', 'anime.hyfata.kr'],
    proxy: {
      // FastAPI dev server (server/, uvicorn)
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      // 서브경로 배포(/anime-test, /anime) 시 web 클라이언트가 붙이는 prefix 벗겨서 전달
      '/anime-test/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/anime-test/, ''),
      },
      '/anime/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/anime/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    // @player는 web/ 밖의 CJS(UMD)라 commonjs 변환 대상에 명시적으로 포함
    commonjsOptions: { include: [/assets\/player/, /node_modules/] },
  },
  optimizeDeps: {
    include: ['@player/video-player.js'],
  },
});
