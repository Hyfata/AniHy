"""worker/manager.py — 큐 동시성, busy-key 중복 방지, reap 보정, orphan, GC, idle 종료."""
import asyncio
import os
import time
from datetime import datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from server.core.config import Settings
from server.core.db import Base
from server.models import Anime, Job
from server.worker import manager
from server.worker.manager import QueueManager, cleanup_temp_subtitles


@pytest.fixture()
def sf():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)


@pytest.fixture()
def settings(tmp_path):
    (tmp_path / "logs").mkdir()
    (tmp_path / "subtitles").mkdir()
    return Settings(base_dir=tmp_path, db_url="sqlite://", max_workers=2)


def _add_job(sf, job_id, aid=1, ep="1", status="pending", **kw):
    with sf() as db:
        if db.get(Anime, aid) is None:
            db.add(Anime(id=aid, title="t", cover_image="c.jpg"))
        db.add(Job(id=job_id, anime_id=aid, episode_number=ep, season_id="s",
                   status=status, **kw))
        db.commit()


def _make_manager(sf, settings, **kw):
    kw.setdefault("poll_seconds", 0.02)
    return QueueManager(sf, settings, reload_settings=lambda: settings, **kw)


def test_concurrency_limit(sf, settings, monkeypatch):
    started = []

    async def fake_convert(job_id, session_factory, st):
        started.append(job_id)
        await asyncio.sleep(0.05)

    monkeypatch.setattr(manager, "convert_job", fake_convert)
    for i in range(1, 4):
        _add_job(sf, i, aid=1, ep=str(i))
    mgr = _make_manager(sf, settings)

    async def scenario():
        n = mgr.run_once()
        assert n == 2  # max_workers=2
        await asyncio.gather(*mgr.running.values())
        assert sorted(started) == [1, 2]
    asyncio.run(scenario())


def test_duplicate_busy_key_not_started(sf, settings, monkeypatch):
    started = []

    async def fake_convert(job_id, session_factory, st):
        started.append(job_id)
        await asyncio.sleep(0.05)

    monkeypatch.setattr(manager, "convert_job", fake_convert)
    _add_job(sf, 1, aid=1, ep="1")
    _add_job(sf, 2, aid=1, ep="1")  # 같은 anime+episode
    mgr = _make_manager(sf, settings)

    async def scenario():
        assert mgr.run_once() == 1
        await asyncio.gather(*mgr.running.values())
        assert started == [1]
    asyncio.run(scenario())


def test_reap_marks_crashed_job_failed(sf, settings, monkeypatch):
    async def crash(job_id, session_factory, st):
        raise RuntimeError("boom")

    monkeypatch.setattr(manager, "convert_job", crash)
    _add_job(sf, 1)
    mgr = _make_manager(sf, settings)

    async def scenario():
        mgr.run_once()
        await asyncio.sleep(0.05)  # 태스크 예외 완료 대기
        mgr.run_once()  # reap
    asyncio.run(scenario())

    with sf() as db:
        job = db.get(Job, 1)
        assert job.status == "failed"
        assert "비정상 종료" in job.message
        assert job.worker_pid is None


def test_reap_clears_pid_on_clean_finish(sf, settings, monkeypatch):
    async def ok(job_id, session_factory, st):
        with session_factory() as db:
            manager.mark_job_failed(db, job_id, "done-as-failed")

    monkeypatch.setattr(manager, "convert_job", ok)
    _add_job(sf, 1)
    mgr = _make_manager(sf, settings)

    async def scenario():
        mgr.run_once()
        await asyncio.sleep(0.05)
        mgr.run_once()
    asyncio.run(scenario())
    with sf() as db:
        assert db.get(Job, 1).worker_pid is None


def test_adopt_orphans_dead_pid_fails_job(sf, settings):
    _add_job(sf, 1, status="encoding", worker_pid=999_999_999)  # 죽은 PID
    mgr = _make_manager(sf, settings)
    mgr._adopt_orphans()
    with sf() as db:
        job = db.get(Job, 1)
        assert job.status == "failed"
        assert "이전 매니저" in job.message


def test_adopt_orphans_pending_untouched(sf, settings):
    _add_job(sf, 1, status="pending")
    mgr = _make_manager(sf, settings)
    mgr._adopt_orphans()
    with sf() as db:
        assert db.get(Job, 1).status == "pending"


def test_lock_acquire_release(sf, settings):
    mgr = _make_manager(sf, settings)
    assert mgr.acquire_lock() is True
    # 살아있는 PID(자기 자신)가 적힌 lock은 다른 매니저가 못 가져감
    mgr2 = _make_manager(sf, settings)
    assert mgr2.acquire_lock() is False
    mgr.release_lock()
    assert not mgr.lock_file.exists()


def test_idle_exit(sf, settings):
    mgr = _make_manager(sf, settings, idle_exit_seconds=0.05)
    asyncio.run(mgr.run())
    assert not mgr.lock_file.exists()  # 종료 시 lock 해제


def test_cancel_job(sf, settings, monkeypatch):
    started = asyncio.Event() if hasattr(asyncio, "Event") else None

    async def slow(job_id, session_factory, st):
        await asyncio.sleep(10)

    monkeypatch.setattr(manager, "convert_job", slow)
    _add_job(sf, 1)
    mgr = _make_manager(sf, settings)

    async def scenario():
        mgr.run_once()
        assert mgr.cancel_job(1) is True
        await asyncio.sleep(0.02)
        assert mgr.cancel_job(1) is False  # 이미 취소됨
        mgr.run_once()  # reap: 취소된 태스크
    asyncio.run(scenario())
    with sf() as db:
        assert db.get(Job, 1).status == "failed"


# ---------- cleanupTempSubtitles ----------


def test_cleanup_temp_subtitles(sf, settings):
    subs = settings.base_dir / "subtitles"
    old = datetime.now() - timedelta(hours=25)

    # failed job 참조 + 24h 경과 → 삭제 + subtitle_file NULL
    _add_job(sf, 1, status="failed", subtitle_file="sub_a.ass", created_at=old)
    (subs / "sub_a.ass").write_text("x")
    # failed job이지만 24h 미만 → 유지
    _add_job(sf, 2, status="failed", subtitle_file="sub_b.ass", created_at=datetime.now())
    (subs / "sub_b.ass").write_text("x")
    # 활성 job 참조 → 유지
    _add_job(sf, 3, status="encoding", subtitle_file="sub_c.ass", created_at=old)
    (subs / "sub_c.ass").write_text("x")
    # failed/ 보존 원본 (24h 경과 job) → 삭제
    (subs / "failed").mkdir()
    (subs / "failed" / "job_1_sub_a.ass").write_text("x")

    with sf() as db:
        cleanup_temp_subtitles(db, settings.base_dir)

    assert not (subs / "sub_a.ass").exists()
    assert (subs / "sub_b.ass").exists()
    assert (subs / "sub_c.ass").exists()
    assert not (subs / "failed" / "job_1_sub_a.ass").exists()
    with sf() as db:
        assert db.get(Job, 1).subtitle_file is None
        assert db.get(Job, 2).subtitle_file == "sub_b.ass"

    # 스로틀: stamp가 있으면 즉시 리턴
    (subs / "sub_late.ass").write_text("x")
    with sf() as db:
        cleanup_temp_subtitles(db, settings.base_dir)
    assert (subs / "sub_late.ass").exists()  # 스로틀되어 미삭제
