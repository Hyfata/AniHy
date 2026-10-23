/* 관리자 폼 공용 헬퍼 — 구 assets/js/app.js의 동작 규약 계승 */
import { API_BASE } from '../../api/client';

/** 일괄 추가 매핑용 파일명 정렬 (app.js의 localeCompare(ko, numeric) 규약) */
export const nameSort = (a: File, b: File): number =>
  a.name.localeCompare(b.name, 'ko', { numeric: true });

/** blob 파일 저장 — click 직후 즉시 revoke하면 Safari/WebKit이 읽기 전에 취소하므로 60초 지연 */
export function saveBlobAs(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function extractError(res: Response): Promise<never> {
  const ct = res.headers.get('Content-Type') ?? '';
  if (ct.includes('application/json')) {
    const data: unknown = await res.json().catch(() => null);
    const detail =
      data && typeof data === 'object' && 'detail' in data
        ? (data as { detail: unknown }).detail
        : undefined;
    if (typeof detail === 'string') throw new Error(detail);
  }
  throw new Error(`API 오류 (${res.status})`);
}

/** plain text 응답 GET (aniDL 검색 등) */
export async function fetchText(path: string): Promise<string> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'same-origin' });
  if (!res.ok) await extractError(res);
  return res.text();
}

/** 파일(blob) 응답 GET/POST — 실패 JSON이 200으로 오는 케이스도 검사 (구 프론트 규약) */
export async function fetchBlob(
  path: string,
  options: { method?: 'GET' | 'POST' } = {},
): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'same-origin',
    method: options.method ?? 'GET',
  });
  const ct = res.headers.get('Content-Type') ?? '';
  if (!res.ok || ct.includes('application/json')) {
    await extractError(res);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i);
  const filename = match ? decodeURIComponent(match[1]) : 'download';
  return { blob, filename };
}
