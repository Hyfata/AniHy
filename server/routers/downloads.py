"""다운로드/파일 서빙 라우터 — 기존 api/download_episode.php, download_all.php,
list_server_files.php, extract_subtitle.php, extract_audio.php, download_en_subtitle.php 포팅.

하드 규약 (plan §6):
- 인증 실패는 302가 아니라 **401** (core/security.py 상단 주석 참조)
- ZIP 번들은 전송 후 삭제하지 않고 24h TTL 유지 + Range 지원 (iOS 재개)
- 추출 다운로드 파일명 100자 캡 (Brave iOS)
- 서버 파일 루트 realpath 탈출 검사
"""
import asyncio
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import Settings, get_settings
from ..core.db import get_db
from ..core.security import require_access, require_admin
from ..models import Anime, Episode
from ..services import files as fs

router = APIRouter(tags=["downloads"])


def _not_found_text(detail: str = "파일을 찾을 수 없습니다.") -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


def _resolve_or_404(root: Path, candidate: Path | str) -> Path:
    try:
        return fs.resolve_under(root, candidate)
    except ValueError as e:
        raise _not_found_text(str(e)) from e


# ---------- 정적 미디어 파일 (require_access) ----------
# URL 매핑은 services/urls.py와 합의: /api/files/covers|animes|subtitles/…


@router.get("/files/video/{anime_id}/{episode_number}", dependencies=[Depends(require_access)])
def video_download(
    anime_id: int,
    episode_number: str,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """api/download_episode.php — episodes.file_path를 첨부 다운로드로 전송 (Range 지원).

    인증 실패 시 require_access가 401을 반환 (302 금지).
    """
    row = db.execute(
        select(Anime.title, Episode.file_path)
        .join(Episode, Episode.anime_id == Anime.id)
        .where(Episode.anime_id == anime_id, Episode.episode_number == episode_number)
    ).first()
    if not row or not row.file_path:
        raise _not_found_text()
    path = _resolve_or_404(settings.base_dir, settings.base_dir / row.file_path)
    if path.stat().st_size == 0:
        raise _not_found_text()
    download_name = f"{row.title} {episode_number}화.mp4"
    return FileResponse(path, media_type="application/octet-stream", filename=download_name)


@router.get("/files/covers/{filename}", dependencies=[Depends(require_access)])
def cover_file(filename: str, settings: Settings = Depends(get_settings)):
    path = _resolve_or_404(settings.base_dir / "covers", settings.base_dir / "covers" / filename)
    return FileResponse(path, media_type=fs.guess_media_type(path))


@router.get("/files/animes/{anime_id}/{filename}", dependencies=[Depends(require_access)])
def anime_file(anime_id: int, filename: str, settings: Settings = Depends(get_settings)):
    """animes/{aid}/ 아래 mp4/jpg/chapters.vtt — 파일명은 sanitize된 것만 허용."""
    if filename != fs.sanitize_filename(filename):
        raise _not_found_text()
    base = settings.base_dir / "animes" / str(anime_id)
    path = _resolve_or_404(base, base / filename)
    media_type = "text/vtt" if path.suffix == ".vtt" else fs.guess_media_type(path)
    return FileResponse(path, media_type=media_type)


@router.get("/files/subtitles/{path:path}", dependencies=[Depends(require_access)])
def subtitle_file(path: str, settings: Settings = Depends(get_settings)):
    base = settings.base_dir / "subtitles"
    real = _resolve_or_404(base, base / path)
    return FileResponse(real, media_type=fs.guess_media_type(real))


# ---------- ZIP 전체 다운로드 (api/download_all.php + worker/zip_all.php) ----------


@router.post("/downloads/bundle/{anime_id}", dependencies=[Depends(require_access)])
def start_bundle(
    anime_id: int,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """압축 시작. 진행 중이면 재시작하지 않고 running만 반환 (PHP 동일)."""
    base_dir = settings.base_dir
    fs.cleanup_old_bundles(base_dir)

    job = fs.read_zip_progress(base_dir, anime_id)
    running = bool(job and job.get("status") == "running" and job.get("alive"))
    if not running:
        rows = db.execute(
            select(Episode.file_path)
            .where(Episode.anime_id == anime_id)
            .order_by(Episode.episode_number.asc())
        ).scalars().all()
        zip_files: list[tuple[str, Path]] = []
        seen: set[str] = set()
        for rel in rows:
            if not rel:
                continue
            try:
                path = fs.resolve_under(base_dir, base_dir / rel)
            except ValueError:
                continue
            if path.stat().st_size == 0:
                continue
            name = path.name
            if name in seen:  # PHP: basename 키 배열이라 동일명 덮어씀
                continue
            seen.add(name)
            zip_files.append((name, path))
        fs.start_zip_job(anime_id, zip_files, fs.zip_bundle_path(base_dir, anime_id),
                         fs.zip_progress_path(base_dir, anime_id))
    return {"ok": True, "running": True}


@router.get("/downloads/bundle/{anime_id}/progress", dependencies=[Depends(require_access)])
def bundle_progress(anime_id: int, settings: Settings = Depends(get_settings)):
    job = fs.read_zip_progress(settings.base_dir, anime_id)
    if job is None:
        return {"ok": False, "detail": "진행 정보가 없습니다."}
    return {"ok": True, "job": job}


@router.get("/downloads/bundle/{anime_id}/file", dependencies=[Depends(require_access)])
def bundle_file(
    anime_id: int,
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """완성된 ZIP 전송. Range + Accept-Ranges 지원, **전송 후 삭제하지 않음** (iOS 재개 규약)."""
    zip_path = fs.zip_bundle_path(settings.base_dir, anime_id)
    if not zip_path.is_file():
        raise _not_found_text()
    title = db.execute(select(Anime.title).where(Anime.id == anime_id)).scalar()
    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=f"{title or 'episodes'}.zip",
        headers={"Cache-Control": "no-cache, must-revalidate"},
    )


# ---------- 서버 파일 소스 (admin) ----------


@router.get("/server-files")
def list_server_files(
    path: str | None = Query(default=None),
    _admin=Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    """api/list_server_files.php — 루트(또는 하위 경로) 재귀 영상 목록, realpath 탈출 검사."""
    try:
        file_list = fs.list_server_videos(settings.anidown_server_files_root, path)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    return {"ok": True, "files": file_list}


def _resolve_server_video(path: str, settings: Settings) -> Path:
    if not path:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="영상 경로가 필요합니다.")
    try:
        return fs.resolve_under(settings.anidown_server_files_root, path)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e


def _extraction_response(out_path: Path, download_name: str, media_type: str, fail_detail: str):
    if not out_path.is_file() or out_path.stat().st_size == 0:
        out_path.unlink(missing_ok=True)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=fail_detail)
    # 임시 추출물은 전송 후 삭제 (BackgroundTask로 FileResponse 전송 완료 뒤 정리)
    from starlette.background import BackgroundTask

    return FileResponse(
        out_path,
        media_type=media_type,
        filename=download_name,
        background=BackgroundTask(out_path.unlink, missing_ok=True),
    )


@router.get("/server-files/subtitles")
async def list_subtitle_streams(
    path: str = Query(...),
    _admin=Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    real = _resolve_server_video(path, settings)
    streams = await fs.probe_subtitle_streams(real)
    if not streams:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="영상에 자막 스트림이 없습니다.")
    return {"ok": True, "streams": streams, "count": len(streams)}


@router.get("/server-files/subtitles/extract")
async def extract_subtitle_track(
    path: str = Query(...),
    index: int = Query(default=0),
    fmt: str | None = Query(default=None, pattern="^(ass|smi)$"),
    _admin=Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    """자막 트랙 추출. fmt는 호환용 — 실제 출력 포맷은 코덱이 결정 (텍스트→ASS, 비트맵→복사)."""
    real = _resolve_server_video(path, settings)
    streams = await fs.probe_subtitle_streams(real)
    if not streams:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="영상에 자막 스트림이 없습니다.")
    if index < 0 or index >= len(streams):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="선택한 자막 트랙이 없습니다.")
    sel = streams[index]
    suffix = fs.stream_suffix(index, sel["language"], "s", len(streams))
    out_path, download_name, output = await fs.extract_subtitle(
        real, index, sel["codec"], real.stem, suffix
    )
    return _extraction_response(out_path, download_name, "application/octet-stream",
                                f"자막 추출 실패: {output}")


@router.get("/server-files/audio")
async def list_audio_streams(
    path: str = Query(...),
    _admin=Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    real = _resolve_server_video(path, settings)
    streams = await fs.probe_audio_streams(real)
    if not streams:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="영상에 오디오 스트림이 없습니다.")
    return {"ok": True, "streams": streams, "count": len(streams),
            "selected": fs.pick_jpn_audio_index(streams)}


@router.get("/server-files/audio/extract")
async def extract_audio_track(
    path: str = Query(...),
    index: int | None = Query(default=None),
    _admin=Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    """오디오 추출. index 생략 시 jpn 우선 자동 선택 (extract_audio.php 동일)."""
    real = _resolve_server_video(path, settings)
    streams = await fs.probe_audio_streams(real)
    if not streams:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="영상에 오디오 스트림이 없습니다.")
    audio_index = fs.pick_jpn_audio_index(streams) if index is None else index
    if audio_index < 0 or audio_index >= len(streams):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="선택한 오디오 트랙이 없습니다.")
    codec = streams[audio_index]["codec"]
    if not codec:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="영상에 오디오 스트림이 없습니다.")
    suffix = fs.stream_suffix(audio_index, streams[audio_index]["language"], "a", len(streams))
    out_path, download_name, mime, output = await fs.extract_audio(
        real, audio_index, codec, real.stem, suffix
    )
    return _extraction_response(out_path, download_name, mime, f"오디오 추출 실패: {output}")


# ---------- 영어 자막 다운로드 (api/download_en_subtitle.php, admin) ----------


@router.post("/downloads/en-subtitle")
async def download_en_subtitle(
    aid: int = Query(...),
    ep: str = Query(...),
    _admin=Depends(require_admin),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """crdn.sh/hidn.sh로 영어 자막을 받아 subtitles/{aid}/{safeEp}_en.ass에 저장 후 전송."""
    safe_ep = fs.sanitize_filename(ep)
    anime = db.execute(
        select(Anime.season_id, Anime.is_hidive).where(Anime.id == aid)
    ).first()
    if not anime or not anime.season_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="애니 또는 시즌 ID를 찾을 수 없습니다.")

    base_dir = settings.base_dir
    downloader_dir = base_dir / "downloader"
    videos_dir = downloader_dir / "videos"
    ass_dir = base_dir / "subtitles" / str(aid)
    target = ass_dir / f"{safe_ep}_en.ass"

    if target.is_file() and target.stat().st_size > 0:
        return FileResponse(target, media_type="application/octet-stream",
                            filename=f"{safe_ep}_en.ass")

    ass_dir.mkdir(parents=True, exist_ok=True)
    before = set(videos_dir.glob("*.ass")) if videos_dir.is_dir() else set()

    script = "./hidn.sh" if anime.is_hidive else "./crdn.sh"
    proc = await asyncio.create_subprocess_exec(
        script, "-s", anime.season_id, "-e", ep,
        "--dlsubs", "en", "--noASSConv", "--novids", "--noaudio",
        cwd=downloader_dir,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
    )
    await proc.communicate()

    after = set(videos_dir.glob("*.ass")) if videos_dir.is_dir() else set()
    new_files = sorted(after - before)
    if not new_files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="영어 자막 다운로드 실패: 파일을 찾을 수 없습니다.")

    downloaded = new_files[0]
    try:
        shutil.copyfile(downloaded, target)
    except OSError as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="자막 파일 저장 실패") from e

    relative = f"subtitles/{aid}/{safe_ep}_en.ass"
    episode = db.execute(
        select(Episode).where(Episode.anime_id == aid, Episode.episode_number == ep)
    ).scalar_one_or_none()
    if episode is not None:
        episode.en_subtitle_file = relative
        db.commit()
    downloaded.unlink(missing_ok=True)

    return FileResponse(target, media_type="application/octet-stream",
                        filename=f"{safe_ep}_en.ass")
