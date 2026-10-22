"""asyncio 인프로세스 큐 매니저 — worker/queue.php 포팅.

- logs/queue.lock PID 락 (이미 살아있는 매니저가 있으면 기동하지 않음)
- 1.5초 폴, pending job을 max_workers까지 동시 실행 (매 루프 설정 hot-reload)
- 죽은 태스크/외부 PID는 reap해서 비정상 종료 job을 failed로 보정
- 30초 idle 시 종료, 시작 시 cleanupTempSubtitles 실행
- convert는 별도 프로세스가 아니라 asyncio 태스크 — worker_pid에는 서버 PID를 기록
  (best-effort). 외부 프로세스가 남긴 orphan은 PID 감시로 adopt (PHP 동일).
"""
from __future__ import annotations

import asyncio
import os
import time
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy.orm import Session, sessionmaker

from ..core.config import Settings
from ..models import Job
from .convert import convert_job
from .encoders import load_encoding_config

LOOP_SLEEP_SECONDS = 1.5
IDLE_EXIT_SECONDS = 30
SUB_CLEANUP_THROTTLE = 86400  # 24시간에 1회


def _pid_alive(pid: int | None) -> bool:
    if not pid or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except (ProcessLookupError, PermissionError, OverflowError):
        return False
    except OSError:
        return False
    return True


def _queue_log(base_dir: Path, msg: str) -> None:
    log = base_dir / "logs" / "queue.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open("a", encoding="utf-8") as f:
        f.write(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}\n")


def _set_job(db: Session, job_id: int, **fields) -> None:
    db.execute(Job.__table__.update().where(Job.id == job_id).values(**fields))
    db.commit()
    # Core update는 identity map을 동기화하지 않음 — 이후 ORM 조회가 stale 값을 읽지 않게
    db.expire_all()


def mark_job_failed(db: Session, job_id: int, reason: str) -> None:
    _set_job(db, job_id, status="failed", progress=0, message=reason,
             worker_pid=None, updated_at=datetime.now())


# ---------- 임시 자막 GC (inc/functions.php cleanupTempSubtitles 포팅) ----------


def cleanup_temp_subtitles(db: Session, base_dir: Path) -> None:
    """subtitles/sub_* (failed job 참조 또는 고아, 24h 경과)와 failed/job_* (24h 경과) 삭제.

    스로틀: logs/sub_cleanup.stamp 기준 최대 24시간에 1회.
    삭제된 파일을 참조하던 job의 subtitle_file은 NULL 처리.
    """
    stamp = base_dir / "logs" / "sub_cleanup.stamp"
    try:
        if stamp.is_file() and time.time() - int(stamp.read_text().strip()) < SUB_CLEANUP_THROTTLE:
            return
    except ValueError:
        pass
    stamp.parent.mkdir(parents=True, exist_ok=True)
    stamp.write_text(str(int(time.time())))

    subtitles_dir = base_dir / "subtitles"
    threshold = time.time() - SUB_CLEANUP_THROTTLE

    refs: dict[str, Job] = {
        j.subtitle_file: j
        for j in db.query(Job).filter(Job.subtitle_file.isnot(None)).all()
    }

    for path in subtitles_dir.glob("sub_*"):
        if not path.is_file():
            continue
        job = refs.get(path.name)
        if job is not None:
            done = job.status in ("completed", "failed")
            created_ts = job.created_at.timestamp() if job.created_at else time.time()
            if not done or created_ts > threshold:
                continue
            path.unlink(missing_ok=True)
            _set_job(db, job.id, subtitle_file=None)
        else:
            try:
                if path.stat().st_ctime > threshold:
                    continue
            except OSError:
                continue
            path.unlink(missing_ok=True)

    failed_dir = subtitles_dir / "failed"
    if failed_dir.is_dir():
        for path in failed_dir.glob("job_*"):
            if not path.is_file():
                continue
            ts = None
            import re

            m = re.match(r"job_(\d+)_", path.name)
            if m:
                created = db.query(Job.created_at).filter(Job.id == int(m.group(1))).scalar()
                if created is not None:
                    ts = created.timestamp()
            if ts is None:
                ts = path.stat().st_mtime
            if ts > threshold:
                continue
            path.unlink(missing_ok=True)


# ---------- 큐 매니저 ----------


class QueueManager:
    def __init__(
        self,
        session_factory: sessionmaker[Session],
        settings: Settings,
        *,
        reload_settings=None,          # 매 루프 max_workers hot-reload용 (기본: .env 재읽기)
        poll_seconds: float = LOOP_SLEEP_SECONDS,
        idle_exit_seconds: float = IDLE_EXIT_SECONDS,
        run_subcleanup: bool = True,
    ):
        self.session_factory = session_factory
        self.settings = settings
        self.reload_settings = reload_settings or Settings
        self.poll_seconds = poll_seconds
        self.idle_exit_seconds = idle_exit_seconds
        self.run_subcleanup = run_subcleanup
        self.base_dir = Path(settings.base_dir)
        self.lock_file = self.base_dir / "logs" / "queue.lock"
        self.running: dict[int, asyncio.Task] = {}   # job_id → convert 태스크
        self.orphan_pids: dict[int, int] = {}        # adopt한 외부 워커 job_id → pid
        self._stop = False

    # ----- lock -----

    def acquire_lock(self) -> bool:
        if self.lock_file.is_file():
            try:
                pid = int(self.lock_file.read_text().strip())
            except ValueError:
                pid = 0
            if _pid_alive(pid):
                return False
            self.lock_file.unlink(missing_ok=True)
        self.lock_file.parent.mkdir(parents=True, exist_ok=True)
        self.lock_file.write_text(str(os.getpid()))
        return True

    def release_lock(self) -> None:
        self.lock_file.unlink(missing_ok=True)

    # ----- 한 루프 (테스트에서 직접 호출) -----

    def _reap(self) -> None:
        with self.session_factory() as db:
            for job_id, task in list(self.running.items()):
                if not task.done():
                    continue
                del self.running[job_id]
                status = db.query(Job.status).filter(Job.id == job_id).scalar()
                exc = task.exception() if not task.cancelled() else asyncio.CancelledError()
                if status not in ("completed", "failed"):
                    mark_job_failed(db, job_id, "작업 프로세스가 비정상 종료되었습니다.")
                    _queue_log(self.base_dir, f"Job {job_id} process died unexpectedly: {exc!r}")
                else:
                    _set_job(db, job_id, worker_pid=None)
                    _queue_log(self.base_dir, f"Job {job_id} finished with status {status}")
            for job_id, pid in list(self.orphan_pids.items()):
                if _pid_alive(pid):
                    continue
                del self.orphan_pids[job_id]
                status = db.query(Job.status).filter(Job.id == job_id).scalar()
                if status not in ("completed", "failed"):
                    mark_job_failed(db, job_id, "작업 프로세스가 비정상 종료되었습니다.")
                    _queue_log(self.base_dir, f"Orphan job {job_id} (pid {pid}) died")

    def _adopt_orphans(self) -> None:
        """이전 매니저(다른 프로세스)가 남긴 활성 job 처리 — cleanupOrphanWorkers 포팅."""
        with self.session_factory() as db:
            rows = db.query(Job.id, Job.status, Job.worker_pid).filter(
                Job.status.notin_(("completed", "failed"))
            ).all()
            for job_id, status, pid in rows:
                if status == "pending":
                    continue  # 아직 워커 미배정
                if pid and _pid_alive(pid) and pid != os.getpid():
                    self.orphan_pids[job_id] = pid
                    _queue_log(self.base_dir, f"Adopted orphan worker for job {job_id} (pid {pid})")
                else:
                    mark_job_failed(db, job_id, "이전 매니저가 종료되어 작업을 실패로 처리했습니다.")
                    _queue_log(self.base_dir, f"Marked orphan job {job_id} as failed")

    def _start_pending(self, max_workers: int) -> int:
        started = 0
        with self.session_factory() as db:
            busy = set()
            if self.running or self.orphan_pids:
                ids = list(self.running) + list(self.orphan_pids)
                for aid, ep in db.query(Job.anime_id, Job.episode_number).filter(Job.id.in_(ids)):
                    busy.add(f"{aid}:{ep}")

            while len(self.running) < max_workers:
                pendings = db.query(Job).filter(Job.status == "pending").order_by(Job.id.asc()).all()
                candidate = next((j for j in pendings if f"{j.anime_id}:{j.episode_number}" not in busy), None)
                if candidate is None:
                    break
                source_type = candidate.source_type or "download"
                is_local = source_type in ("upload", "server")
                initial = "preparing" if is_local else "downloading"
                message = ("서버 파일 처리 중..." if source_type == "server"
                           else "업로드된 영상 처리 중..." if is_local
                           else "Crunchyroll에서 다운로드 중...")
                _set_job(db, candidate.id, status=initial, progress=0, message=message,
                         worker_pid=os.getpid(), updated_at=datetime.now())
                task = asyncio.create_task(
                    convert_job(candidate.id, self.session_factory, self.settings),
                    name=f"convert-job-{candidate.id}",
                )
                self.running[candidate.id] = task
                busy.add(f"{candidate.anime_id}:{candidate.episode_number}")
                started += 1
                _queue_log(self.base_dir, f"Started worker for job {candidate.id}")
        return started

    def run_once(self) -> int:
        """한 루프: reap → pending 시작. 시작한 job 수 반환."""
        cfg = load_encoding_config(self.reload_settings())
        self._reap()
        return self._start_pending(cfg.max_workers)

    async def run(self) -> None:
        if not self.acquire_lock():
            return
        try:
            if self.run_subcleanup:
                with self.session_factory() as db:
                    cleanup_temp_subtitles(db, self.base_dir)
            max_workers = load_encoding_config(self.reload_settings()).max_workers
            _queue_log(self.base_dir, f"Queue manager started (max_workers={max_workers})")
            self._adopt_orphans()
            idle_since: float | None = None
            while not self._stop:
                cfg = load_encoding_config(self.reload_settings())
                if cfg.max_workers != max_workers:
                    _queue_log(self.base_dir, f"max_workers changed: {max_workers} -> {cfg.max_workers}")
                    max_workers = cfg.max_workers
                self._reap()
                started = self._start_pending(max_workers)
                if not self.running and not self.orphan_pids and started == 0:
                    if idle_since is None:
                        idle_since = time.monotonic()
                    elif time.monotonic() - idle_since >= self.idle_exit_seconds:
                        _queue_log(self.base_dir, "Idle timeout, exiting")
                        break
                else:
                    idle_since = None
                await asyncio.sleep(self.poll_seconds)
            _queue_log(self.base_dir, "Queue manager stopped")
        finally:
            self.release_lock()

    def stop(self) -> None:
        self._stop = True

    def cancel_job(self, job_id: int) -> bool:
        """stop_job API용 — 실행 중 convert 태스크 취소 (실행 중이 아니면 False)."""
        task = self.running.get(job_id)
        if task is not None and not task.done():
            task.cancel()
            return True
        return False

    @property
    def active(self) -> bool:
        return bool(self.running or self.orphan_pids)


# ---------- 모듈 싱글턴 (라우터에서 사용) ----------

_manager: QueueManager | None = None
_manager_task: asyncio.Task | None = None


def ensure_queue_running(session_factory: sessionmaker[Session], settings: Settings, **kwargs) -> bool:
    """큐 매니저가 안 떠 있으면 기동. 새로 기동했으면 True (add_episode/retry에서 호출)."""
    global _manager, _manager_task
    if _manager_task is not None and not _manager_task.done():
        return False
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return False  # 이벤트 루프 밖(동기 컨텍스트)에서는 기동 불가
    _manager = QueueManager(session_factory, settings, **kwargs)
    _manager_task = loop.create_task(_manager.run(), name="queue-manager")
    return True


def get_manager() -> QueueManager | None:
    return _manager if _manager_task is not None and not _manager_task.done() else None


def cancel_job(job_id: int) -> bool:
    mgr = get_manager()
    return mgr.cancel_job(job_id) if mgr else False
