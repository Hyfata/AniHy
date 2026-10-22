/* 네이티브(Tauri) 연동 — 오프라인 다운로드/재생/시청기록은 네이티브 앱 전용.
   웹(브라우저)에서는 네이티브 전용 함수가 전부 "네이티브 앱에서만 지원됩니다"를 throw한다.
   탭바 연동은 별도 모듈(tabs.ts). 구현체는 app/src-tauri/src/downloads.rs. */

const NOT_NATIVE_MESSAGE = '네이티브 앱에서만 지원됩니다';

/** Tauri 런타임 감지 (Tauri 2 webview에 주입되는 전역 키). */
export function isNative(): boolean {
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.__TAURI_INTERNALS__ ?? w.__TAURI__);
}

/** 오프라인 모드 — 부트스트랩(app/ui/index.html)이 서버 연결 실패 시
   번들 SPA를 `#offline=1` 해시로 연다. App.tsx가 제한 라우트만 렌더한다. */
export function isOfflineMode(): boolean {
  return window.location.hash.includes('offline=1');
}

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/** @tauri-apps/api를 동적 로드 — 웹 번들에는 코드 스플릿되어 로드되지 않는다. */
async function tauriInvoke(): Promise<InvokeFn> {
  if (!isNative()) throw new Error(NOT_NATIVE_MESSAGE);
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke as InvokeFn;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const invoke = await tauriInvoke();
  // HttpOnly 쿠키는 Rust가 webview 쿠키 저장소에서 읽고, 비HttpOnly는 JS에서 보조 전달
  // (Android는 cookies_for_url 미지원이라 이 폴팩이 필수 — app/README.md 참고)
  return invoke<T>(cmd, { cookieHeader: document.cookie, ...args });
}

/** 커스텀 프로토콜 오리진 — Android/Windows는 http://{scheme}.localhost 형태 (tauri 규약). */
function anihyOrigin(): string {
  const ua = navigator.userAgent;
  return /android|windows/i.test(ua) ? 'http://anihy.localhost' : 'anihy://localhost';
}

// ---------- 타입 ----------

export interface DownloadedEpisode {
  animeId: number;
  episodeNumber: string;
  title: string;
  sizeBytes: number;
  downloadedAt: number;
  chapters: boolean;
}

export interface DownloadedAnime {
  animeId: number;
  title: string;
  /** anihy:// 로컬 커버 URL (없으면 null) */
  cover: string | null;
  totalSize: number;
  episodes: DownloadedEpisode[];
}

export type DownloadStatus = 'started' | 'progress' | 'completed' | 'failed' | 'cancelled';

export interface DownloadProgress {
  aid: number;
  ep: string;
  pct: number;
  bytesPerSec: number;
  status: DownloadStatus;
  message?: string;
}

export interface LocalHistoryEntry {
  positionMs: number;
  durationMs: number;
  updatedAt: number;
}

// ---------- 다운로드 ----------

export async function downloadEpisode(
  aid: number,
  ep: string,
  title: string,
  animeTitle: string,
  options: { chaptersUrl?: string | null; coverUrl?: string | null } = {},
): Promise<void> {
  await call('download_episode', {
    aid,
    ep,
    title,
    animeTitle,
    chaptersUrl: options.chaptersUrl ?? null,
    coverUrl: options.coverUrl ?? null,
  });
}

export async function downloadAll(
  aid: number,
  animeTitle: string,
  episodes: Array<{ episodeNumber: string; title: string }>,
  coverUrl?: string | null,
): Promise<void> {
  await call('download_all', {
    aid,
    animeTitle,
    episodes: episodes.map((e) => ({ episodeNumber: e.episodeNumber, title: e.title })),
    coverUrl: coverUrl ?? null,
  });
}

/** aid+ep 지정 시 해당 회차만, aid만 지정 시 해당 애니 전부(전체 다운로드 포함), 둘 다 없으면 전체 취소. */
export async function cancelDownload(aid?: number, ep?: string): Promise<void> {
  await call('cancel_download', { aid: aid ?? null, ep: ep ?? null });
}

export async function deleteDownload(aid: number, ep: string): Promise<void> {
  await call('delete_episode', { aid, ep });
}

export async function deleteAnimeDownloads(aid: number): Promise<void> {
  await call('delete_anime', { aid });
}

export async function deleteAllDownloads(): Promise<void> {
  await call('delete_all_downloads');
}

export async function listDownloads(): Promise<DownloadedAnime[]> {
  return await call<DownloadedAnime[]>('list_downloads');
}

/** 진행률 이벤트 구독. 반환값은 구독 해제 함수. */
export async function onDownloadProgress(
  cb: (p: DownloadProgress) => void,
): Promise<() => void> {
  if (!isNative()) throw new Error(NOT_NATIVE_MESSAGE);
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<DownloadProgress>('download-progress', (e) => cb(e.payload));
  return unlisten;
}

// ---------- 로컬 재생 URL ----------

export function localVideoUrl(aid: number, ep: string): string {
  return `${anihyOrigin()}/video/${aid}/${encodeURIComponent(ep)}`;
}

export function localChaptersUrl(aid: number, ep: string): string {
  return `${anihyOrigin()}/chapters/${aid}/${encodeURIComponent(ep)}`;
}

export function localCoverUrl(aid: number): string {
  return `${anihyOrigin()}/cover/${aid}`;
}

// ---------- 오프라인 시청기록 ----------

export async function recordLocalHistory(
  aid: number,
  ep: string,
  positionMs: number,
  durationMs: number,
): Promise<void> {
  await call('record_local_history', {
    aid,
    ep,
    positionMs: Math.round(positionMs),
    durationMs: Math.round(durationMs),
  });
}

export async function getLocalHistory(aid: number, ep: string): Promise<LocalHistoryEntry | null> {
  return await call<LocalHistoryEntry | null>('get_local_history', { aid, ep });
}

/** 미동기화 오프라인 시청기록을 서버로 업로드. 반환값은 전송 건수. */
export async function syncHistory(): Promise<number> {
  return await call<number>('sync_history');
}

export async function pendingHistoryCount(): Promise<number> {
  return await call<number>('pending_history_count');
}
