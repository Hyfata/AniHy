"""URL/포맷 헬퍼 — inc/functions.php + inc/chapters.php 포팅.

URL 규약 (downloads 라우터와 합의 필요 — 현재 합의된 매핑):
- 커버:        /api/files/covers/{filename}                  (기존 /anime/covers/…)
- 영상:        /api/files/animes/{aid}/{safeEp}.mp4          (기존 /anime/animes/…)
- 회차 썸네일: /api/files/animes/{aid}/{safeEp}.jpg
- 챕터 VTT:    /api/files/animes/{aid}/{safeEp}.chapters.vtt
- 자막:        /api/files/{path}  (DB의 subtitles/… 상대경로 그대로, 기존 /anime/{path})

safeEp = sanitizeFilename(episode_number) 후 rawurlencode (기존 animeVideoUrl 규약 —
특수문자 회차 404 방지). 실제 파일 경로는 BASE_DIR 아래 동일한 상대 구조.
"""
import re
from urllib.parse import quote

# 사이트가 /anime 같은 서브경로에 배포되면 외부 URL은 /anime/api/files — .env의
# PUBLIC_FILES_PREFIX로 바꾼다(Apache ProxyPass /anime/api → /api 매핑과 합을 맞출 것).
def _files_prefix() -> str:
    from ..core.config import get_settings

    return get_settings().public_files_prefix


def sanitize_filename(filename: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]", "_", filename)


def _enc(path_segment: str) -> str:
    return quote(path_segment, safe="")


def cover_url(filename: str) -> str:
    return f"{_files_prefix()}/covers/{_enc(filename)}"


def anime_video_url(anime_id: int, episode_number: str) -> str:
    return f"{_files_prefix()}/animes/{anime_id}/{_enc(sanitize_filename(episode_number))}.mp4"


def episode_thumb_url(anime_id: int, safe_episode: str) -> str:
    return f"{_files_prefix()}/animes/{anime_id}/{_enc(safe_episode)}.jpg"


def chapter_vtt_url(anime_id: int, safe_episode: str) -> str:
    return f"{_files_prefix()}/animes/{anime_id}/{_enc(safe_episode)}.chapters.vtt"


def subtitle_url(path: str) -> str:
    """DB episodes.subtitle_file / en_subtitle_file 등 상대경로(subtitles/…)를 URL로."""
    return f"{_files_prefix()}/{path.lstrip('/')}"


# ---------- 파일 시스템 경로 (BASE_DIR 기준 상대) ----------


def episode_thumb_rel(anime_id: int, safe_episode: str) -> str:
    return f"animes/{anime_id}/{safe_episode}.jpg"


def chapter_vtt_rel(anime_id: int, safe_episode: str) -> str:
    return f"animes/{anime_id}/{safe_episode}.chapters.vtt"


# ---------- 포맷 ----------


def format_bytes(size: int | float) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    b = max(0.0, float(size))
    i = 0
    while b >= 1024 and i < len(units) - 1:
        b /= 1024
        i += 1
    num = str(int(b)) if i == 0 else f"{b:.1f}"
    return f"{num} {units[i]}"


def format_playtime(ms: int | None) -> str:
    if not ms or ms <= 0:
        return ""
    s = ms // 1000
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return f"{h}:{m:02d}:{sec:02d}" if h > 0 else f"{m}:{sec:02d}"
