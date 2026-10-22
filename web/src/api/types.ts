/* 서버 응답 타입 — server/routers/*.py의 응답 shape을 미러링한다.
   서버가 바뀌면 여기도 같이 바꿀 것. */

/** GET /api/animes, GET /api/search 의 카드 아이템 */
export interface Anime {
  id: number;
  title: string;
  cover: string | null;
  /** 관리자 전용 추가 필드 (GET /api/animes에서만) */
  description?: string;
  season_id?: string;
  is_hidive?: string;
  broadcasts?: [number, number][];
  broadcast_day?: string;
  download_url?: string;
  namuwiki_url?: string;
}

export interface AnimeListResponse {
  animes: Anime[];
  has_more: boolean;
  total: number;
  is_admin?: boolean;
}

export interface WatchProgress {
  position_ms: number;
  duration_ms: number;
  /** 0~1 */
  ratio: number;
}

export interface Episode {
  episode_number: string;
  title: string;
  duration_ms: number | null;
  duration_text: string;
  has_subtitle: boolean;
  en_subtitle_url: string | null;
  video_url: string;
  thumb_url: string | null;
  chapters_url: string | null;
  /** 로그인 사용자에게만 포함 */
  watch_progress?: WatchProgress;
}

/** GET /api/animes/{id} */
export interface AnimeDetail {
  id: number;
  title: string;
  cover: string | null;
  description: string | null;
  season_id: string | null;
  is_hidive: boolean;
  broadcast_year: number | null;
  broadcast_quarter: number | null;
  broadcast_day: string | null;
  download_url: string | null;
  namuwiki_url: string | null;
  broadcasts: [number, number][];
  episodes: Episode[];
  is_bookmarked: boolean;
  is_admin: boolean;
  logged_in: boolean;
}

/** GET /api/quarters 아이템 */
export interface QuarterGroup {
  year: number;
  quarter: number;
  count: number;
  covers: string[];
}

/** GET /api/quarters/{year}/{q} */
export interface QuarterDetailResponse {
  year: number;
  quarter: number;
  days: string[];
  animes: (Anime & { broadcast_day: string })[];
}

/** GET /api/search/trending 아이템 */
export interface TrendingItem extends Anime {
  hit_count: number;
  last_hit_at: string | null;
}

/** GET /api/history 아이템 */
export interface HistoryItem {
  anime_id: number;
  episode_number: string;
  position_ms: number;
  duration_ms: number;
  completed: boolean;
  ratio: number;
  updated_at: string | null;
  title: string;
  cover: string | null;
  episode_title: string | null;
  episode_duration_ms: number | null;
}

/** GET /api/bookmarks 아이템 */
export interface Bookmark {
  id: number;
  title: string;
  cover: string | null;
  bookmarked_at: string | null;
}

/** GET /api/jobs — 대기열 모달의 활성 잡 (애니별 그룹의 episodes 아이템) */
export interface QueueJob {
  job_id: number;
  episode_number: string;
  episode_title: string;
  status: string;
  progress: number;
  message: string;
  updated_at: string | null;
  worker_pid: number | null;
}

/** GET /api/jobs — 활성 잡 그룹 (애니 단위) */
export interface QueueGroup {
  anime_id: number;
  title: string;
  season_id: string | null;
  total: number;
  completed: number;
  episodes: QueueJob[];
}

/** GET /api/jobs — 최근 완료/실패 잡 */
export interface QueueCompletedJob extends QueueJob {
  anime_title: string;
}

export interface QueueStatusResponse {
  groups: QueueGroup[];
  completed: QueueCompletedJob[];
}

/** GET /api/jobs/{id}/progress */
export interface JobProgress {
  job_id: number;
  status: string;
  progress: number;
  message: string;
  encoder: string | null;
  source_type: string | null;
  source_name: string | null;
  trim_seconds: number;
  subtitle_offset: number;
}

/** GET /api/jobs/{id}/log */
export interface JobLogResponse {
  content: string;
  offset: number;
  size: number;
  message?: string;
}

/** GET /api/auth/me */
export interface Identity {
  user_id: number | null;
  is_admin: boolean;
  logged_in: boolean;
}

/** GET /api/server-files 아이템 (admin) */
export interface ServerFileItem {
  path: string;
  name: string;
  dir: string;
  relative_dir: string;
}

/** GET /api/server-files/subtitles 아이템 */
export interface SubtitleStream {
  index: number;
  stream_index: number;
  codec: string;
  language: string;
  title: string;
  label: string;
  kind: 'text' | 'bitmap';
  format: string;
}

/** GET /api/server-files/audio 아이템 */
export interface AudioStream {
  index: number;
  codec: string;
  language: string;
}

/** GET /api/downloads/bundle/{id}/progress 의 job */
export interface ZipJob {
  status: 'running' | 'done' | 'failed' | string;
  percent?: number;
  message?: string;
  alive?: boolean;
}

/** POST /api/jobs 응답 */
export interface AddJobResponse {
  ok: boolean;
  job_id: number;
  anime_id: number;
  message: string;
}
