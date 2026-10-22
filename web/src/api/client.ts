/* fetch 래퍼: JSON 처리 + 401 처리.
   - 게이트 401 (비로그인 포함, 서버는 둘을 구분하지 않으므로 detail 메시지로 판별):
     '접근 인증이 필요합니다' → /gate로 리다이렉트
   - 로그인 필요 401 ('로그인이 필요합니다') → 호출부에서 로그인 유도 UI 처리
     (auth store의 identity가 logged_in=false로 갱신되도록 이벤트 발행)
   하드 규약: 다운로드 계열 API는 인증 실패 시 302가 아니라 401이 온다 (서버와 동일). */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isGateRequired(): boolean {
    return this.status === 401 && this.message.includes('접근 인증');
  }

  get isLoginRequired(): boolean {
    return this.status === 401;
  }
}

/** 로그인 필요 401 발생 시 auth store가 identity를 갱신하도록 하는 구독 훅 */
let onLoginRequired: (() => void) | null = null;
export function setOnLoginRequired(handler: (() => void) | null): void {
  onLoginRequired = handler;
}

/** 라우터 basename (서브경로 배포 대응) — API_BASE와 동일 판별. */
export const ROUTER_BASE = window.location.pathname.startsWith('/anime-test')
  ? '/anime-test'
  : window.location.pathname.startsWith('/anime')
    ? '/anime'
    : '';

function redirectToGate(): void {
  if (window.location.pathname === `${ROUTER_BASE}/gate`) return;
  const redirect = window.location.pathname + window.location.search;
  window.location.assign(`${ROUTER_BASE}/gate?redirect=${encodeURIComponent(redirect)}`);
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /** FormData 전송 시 (JSON.stringify하지 않음) */
  formData?: FormData;
  signal?: AbortSignal;
}

/** 사이트가 /anime 하위 경로에 배포되면 API도 /anime/api로 간다 (Apache ProxyPass 매핑과 일치).
   개발 서버(루트)와 앱 오프라인 번들(/spa)에서는 /api 그대로. */
export const API_BASE = `${ROUTER_BASE}/api`;

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, formData, signal } = options;

  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (formData) {
    payload = formData;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: payload,
    signal,
    credentials: 'same-origin',
  });

  if (res.status === 204) {
    return undefined as T;
  }

  // 실패 JSON이 HTTP 200으로 오는 케이스 방지 (기존 프론트의 Content-Type 검사 규약 계승)
  const contentType = res.headers.get('Content-Type') ?? '';
  const isJson = contentType.includes('application/json');
  const data: unknown = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const detail =
      data && typeof data === 'object' && 'detail' in data
        ? (data as { detail: unknown }).detail
        : undefined;
    const message = typeof detail === 'string' ? detail : `API 오류 (${res.status})`;
    const error = new ApiError(res.status, message, detail);
    if (error.isGateRequired) {
      redirectToGate();
    } else if (res.status === 401) {
      onLoginRequired?.();
    }
    throw error;
  }

  if (!isJson) {
    throw new ApiError(res.status, 'JSON이 아닌 응답을 받았습니다');
  }

  return data as T;
}

export const get = <T>(path: string, signal?: AbortSignal) => api<T>(path, { signal });
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
export const put = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });
