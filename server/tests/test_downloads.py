"""다운로드/파일 서빙 라우터 테스트 (sqlite 인메모리 + tmp_path, MySQL 불필요)."""
import json
import os
import shutil
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from server.core.config import Settings, get_settings
from server.core.db import get_db
from server.core.security import (
    ACCESS_COOKIE_NAME,
    SESSION_COOKIE_NAME,
    issue_access_cookie,
    issue_session_cookie,
)
from server.models import Anime, Episode
from server.routers import downloads
from server.services import files as fs

TEST_SECRET = "test-secret-for-pytest-only"


@pytest.fixture()
def base_dir(tmp_path):
    for d in ("animes/1", "covers", "subtitles/1", "downloader/videos", "logs"):
        (tmp_path / d).mkdir(parents=True, exist_ok=True)
    return tmp_path


@pytest.fixture()
def settings(base_dir, tmp_path):
    server_root = tmp_path / "server_files"
    server_root.mkdir()
    return Settings(
        cookie_secret=TEST_SECRET,
        db_url="sqlite://",
        base_dir=base_dir,
        anidown_server_files_root=server_root,
    )


@pytest.fixture()
def client(db_session, settings):
    app = FastAPI()
    app.include_router(downloads.router, prefix="/api")

    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_settings] = lambda: settings
    return TestClient(app)


@pytest.fixture()
def access_cookie():
    response_cookie = issue_access_cookie(_DummyResponse(), TEST_SECRET)
    return {ACCESS_COOKIE_NAME: response_cookie}


class _DummyResponse:
    def set_cookie(self, *args, **kwargs):
        pass


def _admin_cookie():
    value = issue_session_cookie(_DummyResponse(), TEST_SECRET, 1, True)
    return {SESSION_COOKIE_NAME: value}


def _seed_episode(db_session, base_dir, ep="1", title="테스트 애니"):
    anime = Anime(id=1, title=title, cover_image="c.jpg")
    episode = Episode(
        id=1, anime_id=1, episode_number=ep,
        file_path=f"animes/1/{fs.sanitize_filename(ep)}.mp4",
    )
    db_session.add_all([anime, episode])
    db_session.commit()
    payload = b"\x00" * 1000 + b"FAKEMP4DATA"
    (base_dir / "animes" / "1" / f"{fs.sanitize_filename(ep)}.mp4").write_bytes(payload)
    return payload


# ---------- 순수 함수 ----------


def test_sanitize_filename():
    assert fs.sanitize_filename("0.5") == "0.5"
    assert fs.sanitize_filename("OVA 2") == "OVA_2"
    assert fs.sanitize_filename("../etc/passwd") == ".._etc_passwd"
    assert fs.sanitize_filename("한글 회차") == "_____"


def test_cap_download_name():
    assert fs.cap_download_name("a" * 100) == "a" * 100
    assert len(fs.cap_download_name("b" * 150)) == 100


def test_resolve_under_rejects_traversal(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    (root / "ok.txt").write_text("x")
    outside = tmp_path / "secret.txt"
    outside.write_text("y")
    assert fs.resolve_under(root, root / "ok.txt").name == "ok.txt"
    with pytest.raises(ValueError):
        fs.resolve_under(root, root / ".." / "secret.txt")
    with pytest.raises(ValueError):
        fs.resolve_under(root, outside)
    with pytest.raises(ValueError):
        fs.resolve_under(root, root / "missing.txt")


def test_list_server_videos_filters_and_sorts(tmp_path):
    root = tmp_path / "dl"
    (root / "sub").mkdir(parents=True)
    (root / "b.mkv").write_text("v")
    (root / "a.txt").write_text("nope")
    (root / "sub" / "c.MP4").write_text("v")
    (root / "link.avi").symlink_to(tmp_path)  # 링크 제외
    files = fs.list_server_videos(root)
    names = [f["name"] for f in files]
    assert names == ["b.mkv", "c.MP4"]  # 경로 문자열 정렬
    assert all(f["relative_dir"] in ("", "sub") for f in files)


# ---------- 회차 영상 다운로드 + Range ----------


def test_video_requires_access_401_not_redirect(client):
    resp = client.get("/api/files/video/1/1", follow_redirects=False)
    assert resp.status_code == 401  # 302 금지 규약


def test_video_download_full_and_range(client, db_session, base_dir, access_cookie):
    payload = _seed_episode(db_session, base_dir)
    resp = client.get("/api/files/video/1/1", cookies=access_cookie)
    assert resp.status_code == 200
    assert resp.content == payload
    assert "attachment" in resp.headers["content-disposition"]

    resp = client.get(
        "/api/files/video/1/1", cookies=access_cookie, headers={"Range": "bytes=0-9"}
    )
    assert resp.status_code == 206
    assert resp.content == payload[:10]
    assert resp.headers["content-range"] == f"bytes 0-9/{len(payload)}"

    resp = client.get(
        "/api/files/video/1/1", cookies=access_cookie, headers={"Range": "bytes=999999-"}
    )
    assert resp.status_code == 416


def test_video_404_for_missing(client, access_cookie):
    assert client.get("/api/files/video/1/9", cookies=access_cookie).status_code == 404


def test_cover_traversal_rejected(client, base_dir, access_cookie):
    (base_dir / "secret.mp4").write_bytes(b"x")
    resp = client.get("/api/files/covers/..%2Fsecret.mp4", cookies=access_cookie)
    assert resp.status_code == 404


def test_cover_and_anime_file_served(client, base_dir, access_cookie):
    (base_dir / "covers" / "c.jpg").write_bytes(b"JPEG")
    (base_dir / "animes" / "1" / "1.chapters.vtt").write_text("WEBVTT")
    assert client.get("/api/files/covers/c.jpg", cookies=access_cookie).status_code == 200
    resp = client.get("/api/files/animes/1/1.chapters.vtt", cookies=access_cookie)
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/vtt")


# ---------- ZIP 번들 ----------


def test_bundle_flow(client, db_session, base_dir, access_cookie):
    _seed_episode(db_session, base_dir)

    resp = client.post("/api/downloads/bundle/1", cookies=access_cookie)
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "running": True}

    # 스레드 완료 대기
    zip_path = fs.zip_bundle_path(base_dir, 1)
    for _ in range(100):
        job = fs.read_zip_progress(base_dir, 1)
        if job and job["status"] == "done":
            break
        time.sleep(0.05)
    assert job["status"] == "done"
    assert zip_path.is_file()

    resp = client.get("/api/downloads/bundle/1/progress", cookies=access_cookie)
    assert resp.json()["job"]["status"] == "done"

    # 전체 + Range 다운로드, 전송 후 파일 유지
    resp = client.get("/api/downloads/bundle/1/file", cookies=access_cookie)
    assert resp.status_code == 200
    assert resp.headers.get("accept-ranges") == "bytes"
    total = len(resp.content)

    resp = client.get(
        "/api/downloads/bundle/1/file", cookies=access_cookie,
        headers={"Range": f"bytes={total - 10}-"},
    )
    assert resp.status_code == 206
    assert zip_path.is_file()  # 삭제 금지 규약


def test_bundle_progress_missing(client, access_cookie):
    resp = client.get("/api/downloads/bundle/99/progress", cookies=access_cookie)
    assert resp.json()["ok"] is False


def test_run_zip_job_no_files(tmp_path):
    progress = tmp_path / "logs" / "zip_1.json"
    ok = fs.run_zip_job([], tmp_path / "bundle.zip", progress)
    assert not ok
    job = json.loads(progress.read_text())
    assert job["status"] == "failed"


def test_cleanup_old_bundles(base_dir):
    old_zip = fs.zip_bundle_path(base_dir, 5)
    old_zip.write_bytes(b"z")
    old_progress = fs.zip_progress_path(base_dir, 5)
    old_progress.write_text("{}")
    old = time.time() - 90000
    os.utime(old_zip, (old, old))
    os.utime(old_progress, (old, old))
    fs.cleanup_old_bundles(base_dir)
    assert not old_zip.exists()
    assert not old_progress.exists()


# ---------- 서버 파일 / 추출 (admin) ----------


def test_server_files_requires_admin(client, settings, access_cookie):
    assert client.get("/api/server-files", cookies=access_cookie).status_code == 403
    cookies = {**access_cookie, **_admin_cookie()}
    resp = client.get("/api/server-files", cookies=cookies)
    assert resp.status_code == 200
    assert resp.json()["files"] == []


def test_server_files_traversal_blocked(client, settings, access_cookie):
    cookies = {**access_cookie, **_admin_cookie()}
    outside = str(settings.anidown_server_files_root / ".." / ".." / "etc")
    resp = client.get("/api/server-files", params={"path": outside}, cookies=cookies)
    assert resp.status_code == 400


def test_subtitle_streams_reject_outside_root(client, settings, access_cookie, tmp_path):
    cookies = {**access_cookie, **_admin_cookie()}
    resp = client.get(
        "/api/server-files/subtitles", params={"path": "/etc/passwd"}, cookies=cookies
    )
    assert resp.status_code == 400


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg 필요")
def test_extract_subtitle_and_audio(tmp_path):
    """ffmpeg으로 자막+오디오가 있는 무성 mkv를 만들어 추출 검증."""
    import subprocess

    video = tmp_path / "in.mkv"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=duration=1:size=64x64:rate=1",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
         "-f", "ass", "-i", _make_ass(tmp_path),
         "-c:v", "libx264", "-c:a", "aac", "-c:s", "ass", str(video)],
        check=True,
    )
    import asyncio

    subs = asyncio.run(fs.probe_subtitle_streams(video))
    assert len(subs) == 1 and subs[0]["format"] == "ass"
    out, name, _err = asyncio.run(fs.extract_subtitle(video, 0, subs[0]["codec"], video.stem, ""))
    assert out.is_file() and out.stat().st_size > 0
    assert name.endswith(".ass")
    out.unlink()

    auds = asyncio.run(fs.probe_audio_streams(video))
    assert len(auds) == 1
    out, name, mime, _err = asyncio.run(fs.extract_audio(video, 0, auds[0]["codec"], video.stem, ""))
    assert out.is_file() and name.endswith(".m4a") and mime == "audio/mp4"
    out.unlink()


def _make_ass(tmp_path):
    ass = tmp_path / "t.ass"
    ass.write_text(
        "[Script Info]\nTitle: t\nScriptType: v4.00+\n\n"
        "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
        "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, "
        "Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, "
        "Encoding\nStyle: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,"
        "0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1\n\n"
        "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, "
        "Effect, Text\nDialogue: 0,0:00:00.00,0:00:00.90,Default,,0,0,0,,hello\n"
    )
    return str(ass)


# ---------- 영어 자막 ----------


def test_en_subtitle_requires_admin(client, access_cookie):
    resp = client.post("/api/downloads/en-subtitle", params={"aid": 1, "ep": "1"},
                       cookies=access_cookie)
    assert resp.status_code == 403
