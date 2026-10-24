import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import '@player/video-player.css';
// @ts-expect-error 바닐라 UMD 서브모듈 — 옆의 video-player.d.ts shim으로 타이핑
import playerModule from '@player/video-player.js';
import type {
  VideoPlayerConstructor,
  VideoPlayerInstance,
  VideoPlayerOptions,
} from './video-player.d';

const { VideoPlayer } = playerModule as { VideoPlayer: VideoPlayerConstructor };

export interface PlayerWrapperProps {
  src: string;
  chaptersUrl?: string | null;
  /** 네이티브 앱에서 'css' (기본 undefined = 플레이어 기본 'auto') */
  fullscreenMode?: VideoPlayerOptions['fullscreenMode'];
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onEnded?: () => void;
  onPause?: (currentTime: number, duration: number) => void;
  /** 실제 재생이 시작된 첫 시점 (시청기록은 이 이벤트 이후에만 저장) */
  onPlay?: () => void;
  onLoadedMetadata?: (duration: number) => void;
  onFullscreenChange?: (isFullscreen: boolean) => void;
  /** 부모가 player.pause() 등을 호출할 수 있도록 인스턴스를 노출 */
  playerRef?: MutableRefObject<VideoPlayerInstance | null>;
}

/** 바닐라 VideoPlayer의 React 래퍼. src/chaptersUrl이 바뀌면 부모가 key로 리마운트할 것. */
export function PlayerWrapper({
  src,
  chaptersUrl,
  fullscreenMode,
  onTimeUpdate,
  onEnded,
  onPause,
  onPlay,
  onLoadedMetadata,
  onFullscreenChange,
  playerRef,
}: PlayerWrapperProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // 콜백은 최신 ref로만 참조 — 플레이어를 매 렌더 재생성하지 않기 위함
  const callbacks = useRef({ onTimeUpdate, onEnded, onPause, onPlay, onLoadedMetadata });
  callbacks.current = { onTimeUpdate, onEnded, onPause, onPlay, onLoadedMetadata };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const player = new VideoPlayer(el, {
      src,
      chaptersUrl: chaptersUrl ?? undefined,
      lang: 'ko',
      preload: 'auto',
      ...(fullscreenMode !== undefined ? { fullscreenMode } : {}),
      ...(onFullscreenChange ? { onFullscreenChange } : {}),
    });
    if (playerRef) playerRef.current = player;

    const video = player.video;
    const handleTimeUpdate = () => callbacks.current.onTimeUpdate?.(video.currentTime, video.duration);
    const handleEnded = () => callbacks.current.onEnded?.();
    const handlePause = () => callbacks.current.onPause?.(video.currentTime, video.duration);
    const handlePlay = () => callbacks.current.onPlay?.();
    const handleMeta = () => callbacks.current.onLoadedMetadata?.(video.duration);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('pause', handlePause);
    video.addEventListener('play', handlePlay);
    video.addEventListener('loadedmetadata', handleMeta);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('loadedmetadata', handleMeta);
      player.destroy();
      if (playerRef) playerRef.current = null;
    };
    // 콜백 변경이 아니라 소스 변경 시에만 재생성 (부모는 key로 리마운트)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, chaptersUrl, fullscreenMode]);

  return <div ref={containerRef} />;
}
