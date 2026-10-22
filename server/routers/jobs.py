"""잡(에피소드 추가/대기열) 관리 API — api/add_episode.php, queue.php, progress.php,
encode_progress.php, log.php, retry_job.php, stop_job.php 포팅.

전부 관리자 전용. add/retry는 큐 매니저를 이벤트 루프 위에서 기동해야 하므로 async def.
"""
import os
import re
import uuid
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import (
    APIRouter, Depends, Form, HTTPException, Query, UploadFile, status,
)
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import Settings, get_settings
from ..core.db import SessionLocal, get_db
from ..core.security import require_access, require_admin
from ..models import Anime, Job
from ..services import files as fs
from ..worker import manager

router = APIRouter(prefix="/jobs", tags=["jobs"], dependencies=[Depends(require_access), Depends(require_admin)])

ALLOWED_SUBTITLE_EXTS = {"ass", "smi"}
_RECENT_WINDOW = timedelta(hours=24)

_EP_NUM_RE = re.compile(r"^\d+(\.\d+)?$")


def _ep_sort_key(ep: str):
    """anime.php의 회차 정렬 (S프리픽스 우선 → 숫자 → 기타)."""
    is_special = ep.upper().startswith("S")
    try:
        special_num = float(ep[1:]) if is_special else 0.0
    except ValueError:
        special_num = 0.0
    numeric = bool(_EP_NUM_RE.match(ep))
    return (0 if is_special else 1, special_num, 0 if numeric else 1,
            float(ep) if numeric else 0.0, ep)


def _job_public(j: Job) -> dict:
    return {
        "job_id": j.id,
        "episode_number": j.episode_number,
        "episode_title": j.episode_title or f"{j.episode_number}화",
        "status": j.status,
        "progress": j.progress,
        "message": j.message or "",
        "updated_at": j.updated_at.isoformat() if j.updated_at else None,
        "worker_pid": j.worker_pid,
    }


# ---------- POST /api/jobs (에피소드 추가) ----------


@router.post("")
async def add_job(
    anime_id: int = Form(...),
    episode_number: str = Form(...),
    season_id: str = Form(""),
    episode_title: str = Form(""),
    trim_seconds: float = Form(0.0),
    subtitle_offset: float = Form(0.0),
    is_test: str = Form(""),
    server_video_path: str = Form(""),
    source_video: UploadFile | None = None,
    subtitle: UploadFile | None = None,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    episode_number = fs.sanitize_filename(episode_number.strip())
    if not episode_number:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "유효하지 않은 에피소드 번호입니다.")
    trim_seconds = max(0.0, round(trim_seconds, 3))
    subtitle_offset = round(subtitle_offset, 3)
    test_flag = 1 if is_test else 0

    anime = db.get(Anime, anime_id)
    if anime is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "애니를 찾을 수 없습니다.")
    if not season_id.strip() and anime.season_id:
        season_id = anime.season_id
    season_id = season_id.strip()

    # 소스 판별: 업로드 / 서버 파일 / 스트리밍 다운로드
    has_upload = source_video is not None and source_video.filename
    server_real: Path | None = None
    if server_video_path.strip():
        try:
            server_real = fs.resolve_under(settings.anidown_server_files_root, server_video_path.strip())
        except ValueError:
            server_real = None
        if server_real is None or server_real.suffix.lower().lstrip(".") not in fs.VIDEO_EXTS:
            server_real = None

    if not has_upload and server_real is None and not season_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "시즌 ID가 없습니다. 애니 정보에서 시즌 ID를 입력하세요.")

    # 업로드 영상 확장자는 job INSERT 전에 검증 (PHP는 INSERT 후 검증해 고아 job이 남았음)
    upload_ext = ""
    if has_upload:
        upload_ext = source_video.filename.rsplit(".", 1)[-1].lower() if "." in source_video.filename else ""
        if upload_ext not in fs.VIDEO_EXTS:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "지원하지 않는 영상 형식입니다. (mkv/mp4/mov/avi/webm)")

    # 같은 anime+episode에 활성 잡이 있으면 거부
    dup = db.execute(
        select(Job.id).where(
            Job.anime_id == anime_id,
            Job.episode_number == episode_number,
            Job.status.notin_(("completed", "failed")),
        )
    ).first()
    if dup:
        raise HTTPException(status.HTTP_409_CONFLICT, "이미 대기열에 있거나 처리 중인 에피소드입니다.")

    # 자막 업로드 저장 (sub_{uniqid}.{ext})
    subtitle_file = None
    if subtitle is not None and subtitle.filename:
        ext = subtitle.filename.rsplit(".", 1)[-1].lower() if "." in subtitle.filename else ""
        if ext not in ALLOWED_SUBTITLE_EXTS:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "지원하지 않는 자막 형식입니다. (ass/smi)")
        subtitle_file = f"sub_{uuid.uuid4().hex[:13]}.{ext}"
        dest = settings.base_dir / "subtitles" / subtitle_file
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(await subtitle.read())

    manager.cleanup_temp_subtitles(db, settings.base_dir)

    job = Job(
        anime_id=anime_id, episode_number=episode_number, season_id=season_id,
        episode_title=episode_title.strip() or None, subtitle_file=subtitle_file,
        trim_seconds=trim_seconds, subtitle_offset=subtitle_offset, is_test=test_flag,
        source_type="download", source_file=None, status="pending", progress=0, message="대기 중",
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    if has_upload:
        source_rel = f"downloader/videos/raw_{job.id}.{upload_ext}"
        dest = settings.base_dir / source_rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(await source_video.read())
        job.source_type = "upload"
        job.source_file = source_rel
        job.source_name = source_video.filename
    elif server_real is not None:
        job.source_type = "server"
        job.source_file = str(server_real)
        job.source_name = server_real.name
    db.commit()

    manager.ensure_queue_running(SessionLocal, settings)
    return {"ok": True, "job_id": job.id, "anime_id": anime_id, "message": "대기열에 추가되었습니다."}


# ---------- GET /api/jobs (대기열 모달 데이터) ----------


@router.get("")
def queue_status(db: Session = Depends(get_db)):
    # 죽은 워커가 남긴 활성 잡을 failed로 정리 (api/queue.php 선례)
    active_with_pid = db.execute(
        select(Job).where(Job.status.notin_(("completed", "failed")), Job.worker_pid.isnot(None))
    ).scalars().all()
    for j in active_with_pid:
        pid = j.worker_pid or 0
        if pid != os.getpid() and not manager._pid_alive(pid):
            manager.mark_job_failed(db, j.id, "워커 프로세스가 종료되어 실패 처리되었습니다.")

    since = datetime.now() - _RECENT_WINDOW
    active = db.execute(
        select(Job, Anime.title.label("anime_title"), Anime.season_id.label("anime_season_id"))
        .join(Anime, Anime.id == Job.anime_id)
        .where(Job.status.notin_(("completed", "failed")), Job.created_at >= since)
    ).all()
    active.sort(key=lambda r: (r[0].anime_id, _ep_sort_key(str(r[0].episode_number))))

    groups: dict[int, dict] = {}
    for j, anime_title, season_id in active:
        g = groups.setdefault(j.anime_id, {
            "anime_id": j.anime_id, "title": anime_title, "season_id": season_id,
            "total": 0, "completed": 0, "episodes": [],
        })
        g["episodes"].append(_job_public(j))

    if groups:
        counts = db.execute(
            select(
                Job.anime_id,
                Job.id,
                Job.status,
            ).where(Job.anime_id.in_(list(groups)), Job.created_at >= since)
        ).all()
        for aid, _jid, st in counts:
            groups[aid]["total"] += 1
            if st == "completed":
                groups[aid]["completed"] += 1

    recent = db.execute(
        select(Job, Anime.title.label("anime_title"))
        .join(Anime, Anime.id == Job.anime_id)
        .where(Job.status.in_(("completed", "failed")), Job.created_at >= since)
        .order_by(Job.updated_at.desc())
    ).all()
    completed = [
        {**_job_public(j), "anime_title": anime_title} for j, anime_title in recent
    ]
    return {"groups": list(groups.values()), "completed": completed}


# ---------- 진행률/로그 ----------


def _get_job_or_404(db: Session, job_id: int) -> Job:
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "작업을 찾을 수 없습니다.")
    return job


@router.get("/{job_id}/progress")
def job_progress(job_id: int, db: Session = Depends(get_db)):
    j = _get_job_or_404(db, job_id)
    return {
        "job_id": j.id,
        "status": j.status,
        "progress": j.progress,
        "message": j.message,
        "encoder": j.encoder,
        "source_type": j.source_type,
        "source_name": j.source_name,
        "trim_seconds": float(j.trim_seconds or 0),
        "subtitle_offset": float(j.subtitle_offset or 0),
    }


_OUT_TIME_RE = re.compile(r"^out_time_ms=(\d+)$")


def parse_encode_progress(log_path: Path, duration_ms: int) -> int:
    """api/encode_progress.php 포팅 — 로그의 마지막 out_time_ms(μs)를 duration 대비 %로."""
    if duration_ms <= 0 or not log_path.is_file():
        return 0
    last_ms = 0
    with log_path.open("r", encoding="utf-8", errors="replace") as f:
        for line in f:
            m = _OUT_TIME_RE.match(line.strip())
            if m:
                last_ms = int(m.group(1)) // 1000
    return int(min(100, max(0, round(last_ms / duration_ms * 100))))


@router.get("/{job_id}/encode-progress")
def encode_progress(job_id: int, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    j = _get_job_or_404(db, job_id)
    pct = parse_encode_progress(settings.base_dir / "logs" / f"job_{job_id}.log", j.duration_ms or 0)
    return {"encode_progress": pct}


@router.get("/{job_id}/log")
def job_log(
    job_id: int,
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    _get_job_or_404(db, job_id)
    log_path = settings.base_dir / "logs" / f"job_{job_id}.log"
    if not log_path.is_file():
        return {"content": "", "offset": 0, "size": 0, "message": "로그 파일이 아직 생성되지 않았습니다."}
    size = log_path.stat().st_size
    if offset > size:
        offset = size
    with log_path.open("rb") as f:
        f.seek(offset)
        content = f.read().decode("utf-8", errors="replace")
        new_offset = f.tell()
    return {"content": content, "offset": new_offset, "size": size}


# ---------- 재시도/중지 ----------


@router.post("/{job_id}/retry")
async def retry_job(job_id: int, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    j = _get_job_or_404(db, job_id)
    if j.status != "failed":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "실패한 작업만 재시도할 수 있습니다.")

    # smi2ass 실패 시 보존필 원본(subtitles/failed/job_{id}_{파일명})을 원위치 복구
    if j.subtitle_file:
        subtitles_dir = settings.base_dir / "subtitles"
        orig = subtitles_dir / j.subtitle_file
        if not orig.is_file():
            kept = subtitles_dir / "failed" / f"job_{job_id}_{Path(j.subtitle_file).name}"
            if kept.is_file():
                orig.parent.mkdir(parents=True, exist_ok=True)
                kept.rename(orig)

    j.status = "pending"
    j.progress = 0
    j.message = "재시도 대기 중"
    j.worker_pid = None
    j.updated_at = datetime.now()
    db.commit()

    manager.ensure_queue_running(SessionLocal, settings)
    return {"ok": True, "job_id": job_id, "message": "작업을 다시 대기열에 올렸습니다."}


@router.post("/{job_id}/stop")
def stop_job(job_id: int, db: Session = Depends(get_db)):
    j = _get_job_or_404(db, job_id)
    if j.status in ("completed", "failed"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "이미 완료되거나 실패한 작업입니다.")

    cancelled = manager.cancel_job(job_id)
    if not cancelled:
        # 매니저 소유 태스크가 아니고 외부 PID(구 프로세스 잔재)일 때만 시그널
        pid = j.worker_pid or 0
        if pid > 0 and pid != os.getpid():
            import signal, time

            try:
                os.kill(pid, signal.SIGTERM)
                time.sleep(0.2)
                if manager._pid_alive(pid):
                    os.kill(pid, signal.SIGKILL)
            except OSError:
                pass

    manager.mark_job_failed(db, job_id, "사용자가 작업을 중지했습니다.")
    return {"ok": True, "message": "작업을 중지했습니다."}
