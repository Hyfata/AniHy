import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ApiError } from './api/client';
import './styles/global.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // 인증 오류는 재시도 무의미
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          return false;
        }
        return failureCount < 2;
      },
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  // StrictMode 제거: dev에서 이펙트 이중 실행이 AnimeDetailModal의 명령형
  // FLIP 애니메이션(controls.set/start)을 취소해 패널이 카드 위치에 멈추는 버그 유발.
  // (프로덕션 빌드는 원래 StrictMode 무관)
    <QueryClientProvider client={queryClient}>
      {/* 앱 오프라인 번들(app/ui/spa)에서는 서브디렉터리 아래에서 서빙되고,
          프로덕션은 /anime 하위 경로(Apache Alias) 아래에서 서빙된다 */}
      <BrowserRouter
        basename={
          window.location.pathname.startsWith('/spa')
            ? '/spa'
            : window.location.pathname.startsWith('/anime-test')
              ? '/anime-test'
              : window.location.pathname.startsWith('/anime')
                ? '/anime'
                : '/'
        }
      >
        <App />
      </BrowserRouter>
    </QueryClientProvider>

);
