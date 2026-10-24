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

/* --- 최소 WebVTT 파서 (플레이어 내부 parseVTT는 비공개라 소스 스왑 시 여기서 파싱해
      player._applyChapters에 주입) --- */
function vttTime(t: string): number {
  const parts = t.trim().split(':');
  let sec = 0;
  for (const p of parts) sec = sec * 60 + parseFloat(p);
  return Number.isFinite(sec) ? sec : 0;
}

function parseVtt(text: string): { start: number; end: number; title: string }[] {
  const cues: { start: number; end: number; title: string }[] = [];
  for (const block of text.replace(/\r/g, '').split('\n\n')) {
    const lines = block.trim().split('\n');
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [s, e] = lines[ti].split('-->');
    cues.push({
      start: vttTime(s),
      end: vttTime(e),
      title: lines.slice(ti + 1).join(' ').trim(),
    });
  }
  return cues;
}

/** 바닐라 VideoPlayer의 React 래퍼.
   플레이어는 마운트 시 1회 생성하고, src/chaptersUrl 변경은 **인스턴스 유지한 채 소스만 교체**
   (SPA 자동 다음화 — 비디오 엘리먼트가 파괴되지 않아 배터리/깜빡임/버퍼 리셋 방지). */
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
  const instanceRef = useRef<VideoPlayerInstance | null>(null);
  const lastSrcRef = useRef<string | null>(null);
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
    instanceRef.current = player;
    lastSrcRef.current = src;
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
      instanceRef.current = null;
      lastSrcRef.current = null;
      if (playerRef) playerRef.current = null;
    };
    // 생성은 마운트 시 1회 — 소스 변경은 아래 스왑 이펙트가 처리
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 소스/챕터 교체: 플레이어 재생성 없이 video.src만 교체.
  // 'emptied' 핸들러가 다른 소스를 감지해 pending seek/skip 상태를 초기화한다.
  useEffect(() => {
    const player = instanceRef.current;
    if (!player || lastSrcRef.current === src) return;
    lastSrcRef.current = src;

    // 이전 회차 챕터 제거 후 새 VTT 로드 (없으면 내장 챕터만 tryEmbedded가 처리)
    const p = player as unknown as {
      chapters: unknown[];
      chaptersSource: string | null;
      options: { chaptersUrl?: string };
      _renderSections: () => void;
      _updateSkipButton: () => void;
      _applyChapters: (cues: { start: number; end: number; title: string }[], source: string) => void;
    };
    p.chapters = [];
    p.chaptersSource = null;
    p.options.chaptersUrl = chaptersUrl ?? undefined;
    p._renderSections();
    p._updateSkipButton();

    player.video.src = src;
    player.video.load();

    if (chaptersUrl) {
      fetch(chaptersUrl)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.text();
        })
        .then((text) => {
          const cues = parseVtt(text);
          // 스왑 후 또 다른 스왑이 있었으면 폐기
          if (cues.length && lastSrcRef.current === src) p._applyChapters(cues, 'vtt');
        })
        .catch(() => {});
    }
  }, [src, chaptersUrl]);

  return <div ref={containerRef} />;
}
