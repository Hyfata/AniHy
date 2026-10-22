"""파일 서빙/다운로드 서비스 (기존 api/download_*.php, api/extract_*.php, worker/zip_all.php 포팅).

하드 규약 (plan §6):
- ZIP 번들은 전송 후 삭제하지 않고 24h TTL 유지 (iOS Range 재개)
- 추출 다운로드 파일명은 100자 캡 (Brave iOS 127자 초과 실패)
- /var/lib/transmission-daemon/downloads realpath 탈출 검사
- ffprobe/ffmpeg/다운로더 호출은 shell 없이 인자 리스트로
"""
from __future__ import annotations

import asyncio
import json
import mimetypes
import os
import re
import tempfile
import threading
import time
import zipfile
from collections.abc import Iterable
from pathlib import Path

# inc/functions.php: sanitizeFilename — 허용 문자 외 전부 '_' 치환 (ASCII만 남음)
_SANITIZE_RE = re.compile(r"[^a-zA-Z0-9._-]")

VIDEO_EXTS = {"mkv", "mp4", "mov", "avi", "webm"}

# Brave iOS는 파일명이 127자를 넘으면 다운로드 실패 (과거 성공 최대 121자) → 100자 캡
DOWNLOAD_NAME_CAP = 100

BUNDLE_TTL_SECONDS = 86400  # 24h


def sanitize_filename(filename: str) -> str:
    return _SANITIZE_RE.sub("_", filename)


def cap_download_name(name: str, limit: int = DOWNLOAD_NAME_CAP) -> str:
    """sanitizeFilename 결과(ASCII) 기준 바이트=글자 수라 단순 슬라이스."""
    return name[:limit] if len(name) > limit else name


def resolve_under(root: Path, candidate: Path | str, *, must_exist: bool = True) -> Path:
    """candidate를 realpath 기준으로 root 아래에 있는지 검증 후 반환.

    탈출/미존재 시 ValueError.
    """
    root_real = root.resolve()
    real = Path(candidate).resolve()
    if real != root_real and root_real not in real.parents:
        raise ValueError("허용되지 않는 파일 경로입니다.")
    if must_exist and not real.is_file():
        raise ValueError("파일을 찾을 수 없습니다.")
    return real


# ---------- 서버 파일 목록 (api/list_server_files.php) ----------


def list_server_videos(root: Path, sub_path: str | None = None) -> list[dict]:
    """root(또는 그 아래 sub_path)를 재귀 순회하며 영상 파일 목록을 반환.

    심볼릭 링크 제외, realpath 탈출 검사, 경로 문자열 정렬.
    """
    root_real = root.resolve()
    if not root_real.is_dir():
        raise ValueError("서버 파일 루트를 찾을 수 없습니다.")
    base = resolve_under(root_real, sub_path) if sub_path else root_real
    if not base.is_dir():
        raise ValueError("디렉터리를 찾을 수 없습니다.")

    files: list[dict] = []
    for dirpath, _dirnames, filenames in os.walk(base, followlinks=False):
        for name in filenames:
            path = Path(dirpath) / name
            if path.is_symlink() or not path.is_file():
                continue
            real = path.resolve()
            if real != root_real and root_real not in real.parents:
                continue
            if real.suffix.lower().lstrip(".") not in VIDEO_EXTS:
                continue
            files.append(
                {
                    "path": str(real),
                    "name": name,
                    "dir": str(real.parent),
                    "relative_dir": str(real.parent.relative_to(root_real))
                    if real.parent != root_real
                    else "",
                }
            )
    files.sort(key=lambda f: f["path"])
    return files


# ---------- ZIP 번들 (api/download_all.php + worker/zip_all.php) ----------


def zip_bundle_path(base_dir: Path, anime_id: int) -> Path:
    return base_dir / "downloader" / "videos" / f"bundle_{anime_id}.zip"


def zip_progress_path(base_dir: Path, anime_id: int) -> Path:
    return base_dir / "logs" / f"zip_{anime_id}.json"


def cleanup_old_bundles(base_dir: Path, ttl: int = BUNDLE_TTL_SECONDS) -> None:
    """새 압축 시작 시 24h 경과한 bundle_*.zip / zip_*.json 정리."""
    cutoff = time.time() - ttl
    for pattern_dir, pattern in (
        (base_dir / "downloader" / "videos", "bundle_*.zip"),
        (base_dir / "logs", "zip_*.json"),
    ):
        if not pattern_dir.is_dir():
            continue
        for old in pattern_dir.glob(pattern):
            try:
                if old.stat().st_mtime < cutoff:
                    old.unlink()
            except OSError:
                pass


def _write_progress(progress_file: Path, data: dict) -> None:
    data["pid"] = os.getpid()
    data["updated_at"] = int(time.time())
    progress_file.write_text(json.dumps(data, ensure_ascii=False))


def run_zip_job(
    files: Iterable[tuple[str, Path]],
    zip_path: Path,
    progress_file: Path,
) -> bool:
    """worker/zip_all.php 포팅 — MP4를 ZIP_STORED(무압축)으로 저장하며 진행률 기록.

    files: (아카이브 내 이름, 실제 경로) 쌍. 동기 함수 — 스레드에서 실행.
    """
    file_list = list(files)
    total = len(file_list)
    progress_file.parent.mkdir(parents=True, exist_ok=True)
    if total == 0:
        _write_progress(
            progress_file,
            {"status": "failed", "percent": 0, "total": 0, "message": "압축할 에피소드 파일이 없습니다."},
        )
        return False

    zip_path.parent.mkdir(parents=True, exist_ok=True)
    _write_progress(progress_file, {"status": "running", "percent": 0, "total": total})

    sizes: list[int] = []
    for _name, path in file_list:
        try:
            sizes.append(max(path.stat().st_size, 0))
        except OSError:
            sizes.append(0)
    total_bytes = sum(sizes) or 1

    written_bytes = 0
    last_write = 0.0
    try:
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_STORED) as zf:
            for (arcname, path), size in zip(file_list, sizes):
                with path.open("rb") as src, zf.open(arcname, "w") as dst:
                    while chunk := src.read(131072):
                        dst.write(chunk)
                        written_bytes += len(chunk)
                        now = time.monotonic()
                        if now - last_write >= 0.5:
                            last_write = now
                            _write_progress(
                                progress_file,
                                {
                                    "status": "running",
                                    "percent": round(written_bytes / total_bytes * 100, 1),
                                    "total": total,
                                },
                            )
        _write_progress(progress_file, {"status": "done", "percent": 100, "total": total})
        return True
    except OSError:
        zip_path.unlink(missing_ok=True)
        _write_progress(
            progress_file,
            {"status": "failed", "percent": 0, "total": total, "message": "압축 실패"},
        )
        return False


# 진행 중 ZIP 스레드 (프로세스 내 추적 — api/download_all.php의 /proc/{pid} 검사 대응)
_zip_threads: dict[int, threading.Thread] = {}


def start_zip_job(anime_id: int, files: list[tuple[str, Path]], zip_path: Path, progress_file: Path) -> bool:
    """이미 실행 중이면 False, 새로 시작하면 True."""
    existing = _zip_threads.get(anime_id)
    if existing is not None and existing.is_alive():
        return False
    zip_path.unlink(missing_ok=True)
    progress_file.unlink(missing_ok=True)
    thread = threading.Thread(
        target=run_zip_job, args=(files, zip_path, progress_file), daemon=True
    )
    _zip_threads[anime_id] = thread
    thread.start()
    return True


def read_zip_progress(base_dir: Path, anime_id: int) -> dict | None:
    """진행 JSON 읽기. running인데 스레드가 죽었으면 failed로 보정 (응답만, 파일은 유지)."""
    progress_file = zip_progress_path(base_dir, anime_id)
    if not progress_file.is_file():
        return None
    try:
        job = json.loads(progress_file.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    thread = _zip_threads.get(anime_id)
    alive = thread is not None and thread.is_alive()
    if job.get("status") == "running" and not alive:
        job["status"] = "failed"
        job["message"] = "압축 프로세스가 종료되었습니다."
    job["alive"] = alive
    return job


# ---------- ffprobe/ffmpeg 추출 (api/extract_subtitle.php, extract_audio.php) ----------


def subtitle_export_format(codec: str) -> dict:
    """코덱별 내보내기 방식(ASS 변환 or 원본 복사)을 결정."""
    codec = codec.lower()
    if codec == "hdmv_pgs_subtitle":
        return {"kind": "bitmap", "format": "sup", "ext": "sup"}
    if codec in {"dvd_subtitle", "dvdsub", "dvb_subtitle", "dvb_teletext", "xsub"}:
        return {"kind": "bitmap", "format": "mks", "ext": "mks"}
    return {"kind": "text", "format": "ass", "ext": "ass"}


async def _run_json(cmd: list[str]) -> dict | None:
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
    )
    out, _ = await proc.communicate()
    try:
        return json.loads(out.decode("utf-8", errors="replace"))
    except json.JSONDecodeError:
        return None


async def _run_cmd(cmd: list[str]) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
    )
    out, _ = await proc.communicate()
    return proc.returncode or 0, out.decode("utf-8", errors="replace")


async def probe_subtitle_streams(video_path: Path) -> list[dict]:
    data = await _run_json(
        [
            "ffprobe", "-v", "error", "-select_streams", "s",
            "-show_entries", "stream=index,codec_name:stream_tags=language,title",
            "-of", "json", str(video_path),
        ]
    )
    streams = []
    raw = (data or {}).get("streams") or []
    for i, s in enumerate(raw):
        tags = s.get("tags") or {}
        lang = (tags.get("language") or "").strip()
        title = (tags.get("title") or "").strip()
        codec = (s.get("codec_name") or "").strip() or "unknown"
        fmt = subtitle_export_format(codec)
        label = f"#{i + 1} ({codec}{', 이미지' if fmt['kind'] == 'bitmap' else ''})"
        if lang:
            label += f" [{lang}]"
        if title:
            label += f" {title[:40]}{'…' if len(title) > 40 else ''}"
        streams.append(
            {
                "index": i,
                "stream_index": int(s.get("index", i)),
                "codec": codec,
                "language": lang,
                "title": title,
                "label": label,
                "kind": fmt["kind"],
                "format": fmt["ext"],
            }
        )
    return streams


async def extract_subtitle(
    video_path: Path, track_index: int, codec: str, base_name: str, suffix: str
) -> tuple[Path, str, str]:
    """선택 자막 트랙을 임시 파일로 추출. (출력 경로, 다운로드 파일명, 실패 메시지) 반환.

    실패 시 경로는 존재하지 않을 수 있음 — 호출자가 확인.
    """
    fmt = subtitle_export_format(codec)
    ext = fmt["ext"]
    download_name = cap_download_name(sanitize_filename(base_name + suffix)) + "." + ext
    out_path = Path(tempfile.gettempdir()) / f"sub_extract_{os.getpid()}_{time.time_ns()}.{ext}"

    cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(video_path), "-map", f"0:s:{track_index}"]
    if fmt["format"] == "ass":
        cmd += ["-c:s", "ass", str(out_path)]
    elif fmt["format"] == "sup":
        # PGS 이미지 자막: 텍스트 변환 불가, 스트림 복사
        cmd += ["-c:s", "copy", str(out_path)]
    else:
        # 기타 이미지 자막(dvd/dvb 등): matroska 컨테이너에 복사
        cmd += ["-c:s", "copy", "-f", "matroska", str(out_path)]

    _code, output = await _run_cmd(cmd)
    return out_path, download_name, output.strip()


AUDIO_CODEC_MAP = {
    "mp3": ("mp3", "audio/mpeg"),
    "aac": ("m4a", "audio/mp4"),
    "opus": ("opus", "audio/ogg"),
    "vorbis": ("ogg", "audio/ogg"),
    "flac": ("flac", "audio/flac"),
    "ac3": ("ac3", "audio/ac3"),
    "eac3": ("eac3", "audio/eac3"),
    "dts": ("dts", "audio/vnd.dts"),
    "truehd": ("thd", "audio/truehd"),
    "pcm_s16le": ("wav", "audio/wav"),
    "pcm_s24le": ("wav", "audio/wav"),
}


async def probe_audio_streams(video_path: Path) -> list[dict]:
    data = await _run_json(
        [
            "ffprobe", "-v", "error", "-select_streams", "a",
            "-show_entries", "stream=index,codec_name:stream_tags=language",
            "-of", "json", str(video_path),
        ]
    )
    streams = []
    for i, s in enumerate((data or {}).get("streams") or []):
        tags = s.get("tags") or {}
        streams.append(
            {
                "index": i,
                "codec": (s.get("codec_name") or "").strip(),
                "language": (tags.get("language") or "").strip().lower(),
            }
        )
    return streams


def pick_jpn_audio_index(streams: list[dict]) -> int:
    """worker/convert.php와 동일: 일본어 우선, 없으면 첫 번째."""
    for s in streams:
        if s["language"] in ("jpn", "ja"):
            return s["index"]
    return 0


async def extract_audio(
    video_path: Path, audio_index: int, codec: str, base_name: str, suffix: str
) -> tuple[Path, str, str, str]:
    """선택 오디오 스트림을 재인코딩 없이 copy 추출. (경로, 파일명, MIME, 실패 메시지)."""
    ext, mime = AUDIO_CODEC_MAP.get(codec, ("mka", "audio/x-matroska"))
    download_name = cap_download_name(sanitize_filename(base_name + suffix)) + "." + ext
    out_path = Path(tempfile.gettempdir()) / f"audio_extract_{os.getpid()}_{time.time_ns()}.{ext}"
    cmd = [
        "ffmpeg", "-y", "-v", "error", "-i", str(video_path),
        "-map", f"0:a:{audio_index}", "-vn", "-c:a", "copy", str(out_path),
    ]
    _code, output = await _run_cmd(cmd)
    return out_path, download_name, mime, output.strip()


def stream_suffix(index: int, language: str, prefix: str, stream_count: int) -> str:
    """다중 스트림일 때 .s0.jpn / .a1 같은 접미사 (extract_*.php 규약)."""
    if stream_count <= 1:
        return ""
    lang = re.sub(r"[^a-zA-Z0-9-]", "", language)
    return f".{prefix}{index}" + (f".{lang}" if lang else "")


# ---------- 다운로드 응답 헤더 ----------


def guess_media_type(path: Path, default: str = "application/octet-stream") -> str:
    return mimetypes.guess_type(path.name)[0] or default
