"""routers/jobs.py — 에피소드 추가 검증, 진행률/로그, 재시도/중지."""
import os
import pytest
from fastapi.testclient import TestClient

from conftest import make_client
from server.core.config import Settings, get_settings
from server.core.db import get_db
from server.core.security import Identity
from server.main import app
from server.models import Anime, Job, User
from server.worker import manager


@pytest.fixture()
def admin_client(db_session, tmp_path, monkeypatch):
    for d in ("logs", "subtitles", "covers", "downloader/videos", "animes"):
        (tmp_path / d).mkdir(parents=True, exist_ok=True)
    settings = Settings(
        base_dir=tmp_path, db_url="sqlite://",
        anidown_server_files_root=tmp_path / "srv",
    )
    (tmp_path / "srv").mkdir()
    db_session.add(User(id=1, external_sub="admin", is_admin=1))
    db_session.commit()
    monkeypatch.setattr(manager, "ensure_queue_running", lambda *a, **k: True)
    for client in make_client(db_session, Identity(user_id=1, is_admin=True)):
        app.dependency_overrides[get_settings] = lambda: settings
        yield client, settings


def _seed_anime(db_session, **kw):
    db_session.add(Anime(id=1, title="테스트", cover_image="t.jpg", **kw))
    db_session.commit()


def _post_job(client, **fields):
    base = {"anime_id": "1", "episode_number": "1"}
    base.update({k: v for k, v in fields.items() if not isinstance(v, tuple)})
    files = {k: v for k, v in fields.items() if isinstance(v, tuple)}
    return client.post("/api/jobs", data=base, files=files)


# ---------- 추가 검증 ----------


def test_add_job_requires_admin(anon_client, db_session):
    _seed_anime(db_session)
    resp = anon_client.post("/api/jobs", data={"anime_id": "1", "episode_number": "1", "season_id": "s"})
    assert resp.status_code == 403


def test_add_job_stream_source(admin_client, db_session):
    client, settings = admin_client
    _seed_anime(db_session, season_id="G123")
    resp = _post_job(client)
    assert resp.status_code == 200
    job_id = resp.json()["job_id"]
    job = db_session.get(Job, job_id)
    assert job.source_type == "download"
    assert job.season_id == "G123"  # 애니의 season_id 폴리백
    assert job.status == "pending"


def test_add_job_no_season_no_source_400(admin_client, db_session):
    client, _ = admin_client
    _seed_anime(db_session)
    assert _post_job(client).status_code == 400


def test_add_job_unknown_anime_404(admin_client, db_session):
    client, _ = admin_client
    assert _post_job(client).status_code == 404


def test_add_job_episode_number_sanitized(admin_client, db_session):
    client, _ = admin_client
    _seed_anime(db_session, season_id="s")
    resp = _post_job(client, episode_number="1화!!!")  # PHP와 동일: 특수문자는 _로 치환
    assert resp.status_code == 200
    job = db_session.get(Job, resp.json()["job_id"])
    assert job.episode_number == "1____"  # '1' + '화!!!' 4글자 치환


def test_add_job_duplicate_active_409(admin_client, db_session):
    client, _ = admin_client
    _seed_anime(db_session, season_id="s")
    assert _post_job(client).status_code == 200
    assert _post_job(client).status_code == 409
    # failed면 재등록 가능
    job = db_session.query(Job).one()
    job.status = "failed"
    db_session.commit()
    assert _post_job(client).status_code == 200


def test_add_job_bad_subtitle_ext(admin_client, db_session):
    client, _ = admin_client
    _seed_anime(db_session, season_id="s")
    resp = _post_job(client, subtitle=("sub.txt", b"hello", "text/plain"))
    assert resp.status_code == 400


def test_add_job_bad_video_ext(admin_client, db_session):
    client, _ = admin_client
    _seed_anime(db_session, season_id="s")
    resp = _post_job(client, source_video=("v.txt", b"x", "text/plain"))
    assert resp.status_code == 400
    assert db_session.query(Job).count() == 0  # INSERT 전 검증 (PHP의 고아 잡 버그 개선)


def test_add_job_upload_flow(admin_client, db_session):
    client, settings = admin_client
    _seed_anime(db_session, season_id="s")
    resp = _post_job(
        client,
        source_video=("원본 영상.mkv", b"fakevideo", "video/x-matroska"),
        subtitle=("자막.smi", b"<SAMI>", "application/octet-stream"),
        trim_seconds="1.5", subtitle_offset="-0.5", is_test="1", episode_title="특별편",
    )
    assert resp.status_code == 200
    job = db_session.get(Job, resp.json()["job_id"])
    assert job.source_type == "upload"
    assert job.source_name == "원본 영상.mkv"
    assert job.source_file == f"downloader/videos/raw_{job.id}.mkv"
    assert (settings.base_dir / job.source_file).is_file()
    assert float(job.trim_seconds) == 1.5
    assert float(job.subtitle_offset) == -0.5
    assert job.is_test == 1
    assert job.subtitle_file.startswith("sub_") and job.subtitle_file.endswith(".smi")
    assert (settings.base_dir / "subtitles" / job.subtitle_file).is_file()


def test_add_job_server_source(admin_client, db_session):
    client, settings = admin_client
    _seed_anime(db_session, season_id="s")
    srv = settings.anidown_server_files_root
    (srv / "ep1.mkv").write_bytes(b"v")
    resp = _post_job(client, server_video_path=str(srv / "ep1.mkv"))
    assert resp.status_code == 200
    job = db_session.get(Job, resp.json()["job_id"])
    assert job.source_type == "server"
    assert job.source_name == "ep1.mkv"


def test_add_job_server_path_escape_rejected(admin_client, db_session):
    client, settings = admin_client
    _seed_anime(db_session, season_id="s")
    outside = settings.base_dir / "outside.mkv"
    outside.write_bytes(b"v")
    # 루트 밖 경로 → 서버 소스로 인정 안 됨 → 시즌 ID로 다운로드 잡이 됨
    resp = _post_job(client, server_video_path=str(outside))
    job = db_session.get(Job, resp.json()["job_id"])
    assert job.source_type == "download"


# ---------- 진행률/로그 ----------


def _make_job(db_session, **kw):
    defaults = dict(id=1, anime_id=1, episode_number="1", season_id="s", status="encoding",
                    progress=42, message="인코딩 중", duration_ms=100_000)
    defaults.update(kw)
    db_session.add(Anime(id=1, title="테스트", cover_image="t.jpg"))
    db_session.add(Job(**defaults))
    db_session.commit()
    return defaults["id"]


def test_progress(admin_client, db_session):
    client, _ = admin_client
    jid = _make_job(db_session)
    body = client.get(f"/api/jobs/{jid}/progress").json()
    assert body["status"] == "encoding" and body["progress"] == 42
    assert client.get("/api/jobs/999/progress").status_code == 404


def test_encode_progress_parses_log(admin_client, db_session):
    client, settings = admin_client
    jid = _make_job(db_session)
    log = settings.base_dir / "logs" / f"job_{jid}.log"
    log.write_text("blah\nout_time_ms=50000000\nmore\nout_time_ms=80000000\n")  # μs → 50s, 80s
    assert client.get(f"/api/jobs/{jid}/encode-progress").json()["encode_progress"] == 80


def test_encode_progress_zero_without_duration(admin_client, db_session):
    client, settings = admin_client
    jid = _make_job(db_session, duration_ms=None)
    (settings.base_dir / "logs" / f"job_{jid}.log").write_text("out_time_ms=999999999\n")
    assert client.get(f"/api/jobs/{jid}/encode-progress").json()["encode_progress"] == 0


def test_log_incremental_read(admin_client, db_session):
    client, settings = admin_client
    jid = _make_job(db_session)
    log = settings.base_dir / "logs" / f"job_{jid}.log"
    log.write_text("first\n")
    r1 = client.get(f"/api/jobs/{jid}/log").json()
    assert r1["content"] == "first\n" and r1["offset"] == len("first\n")
    log.write_text("first\nsecond\n")
    r2 = client.get(f"/api/jobs/{jid}/log", params={"offset": r1["offset"]}).json()
    assert r2["content"] == "second\n"
    assert client.get(f"/api/jobs/{jid}/log", params={"offset": 99999}).json()["offset"] == r2["size"]


def test_queue_endpoint_groups_and_reaps_dead(admin_client, db_session):
    client, _ = admin_client
    db_session.add(Anime(id=1, title="A", cover_image="a.jpg", season_id="s1"))
    db_session.add_all([
        Job(id=1, anime_id=1, episode_number="1", season_id="s1", status="pending", progress=0),
        Job(id=2, anime_id=1, episode_number="2", season_id="s1", status="encoding",
            progress=50, worker_pid=999_999_999),  # 죽은 PID → 실패 보정
        Job(id=3, anime_id=1, episode_number="3", season_id="s1", status="completed", progress=100),
    ])
    db_session.commit()
    body = client.get("/api/jobs").json()
    assert len(body["groups"]) == 1
    g = body["groups"][0]
    assert g["title"] == "A" and g["total"] == 3 and g["completed"] == 1
    assert [e["episode_number"] for e in g["episodes"]] == ["1"]  # 2번은 failed로 보정됨
    completed = {c["episode_number"]: c["status"] for c in body["completed"]}
    assert completed == {"2": "failed", "3": "completed"}
    assert db_session.get(Job, 2).message == "워커 프로세스가 종료되어 실패 처리되었습니다."


# ---------- 재시도/중지 ----------


def test_retry_failed_only(admin_client, db_session):
    client, _ = admin_client
    _make_job(db_session, status="completed")
    assert client.post("/api/jobs/1/retry").status_code == 400


def test_retry_restores_preserved_smi(admin_client, db_session, monkeypatch):
    client, settings = admin_client
    _make_job(db_session, status="failed", subtitle_file="sub_x.ass")
    failed_dir = settings.base_dir / "subtitles" / "failed"
    failed_dir.mkdir()
    (failed_dir / "job_1_sub_x.ass").write_text("smi 원본")
    resp = client.post("/api/jobs/1/retry")
    assert resp.status_code == 200
    job = db_session.get(Job, 1)
    assert job.status == "pending" and job.worker_pid is None
    assert (settings.base_dir / "subtitles" / "sub_x.ass").read_text() == "smi 원본"
    assert not (failed_dir / "job_1_sub_x.ass").exists()


def test_stop_marks_failed(admin_client, db_session):
    client, _ = admin_client
    _make_job(db_session, status="encoding", worker_pid=os.getpid())
    resp = client.post("/api/jobs/1/stop")
    assert resp.status_code == 200
    job = db_session.get(Job, 1)
    assert job.status == "failed" and "중지" in job.message and job.worker_pid is None
    # 완료된 작업은 중지 불가
    assert client.post("/api/jobs/1/stop").status_code == 400
