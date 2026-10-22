/* Hyfata-Media-Player-JS (assets/player/video-player.js, 바닐라 UMD) 최소 타입 shim.
   실제 API: new VideoPlayer(el|selector, opts), player.video, play/pause/seekTo/toggleFullscreen/destroy,
   컨테이너에서 버블링되는 'vp:fullscreenchange' CustomEvent. */

export interface VideoPlayerOptions {
  src: string;
  chaptersUrl?: string | null;
  lang?: string;
  preload?: string;
  autoplay?: boolean;
  /** 'auto' = 네이티브 전체화면 우선, 'css' = 플레이어 자체 CSS 전체화면 (네이티브 앱용) */
  fullscreenMode?: 'auto' | 'css';
  onFullscreenChange?: (isFullscreen: boolean, player: VideoPlayerInstance) => void;
}

export interface VideoPlayerInstance {
  video: HTMLVideoElement;
  container: HTMLElement;
  play(): void;
  pause(): void;
  seekTo(sec: number): void;
  seekBy(sec: number, silent?: boolean): void;
  toggleFullscreen(): void;
  destroy(): void;
}

export interface VideoPlayerConstructor {
  new (el: string | HTMLElement, options: VideoPlayerOptions): VideoPlayerInstance;
}
