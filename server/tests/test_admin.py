"""routers/admin.py — 애니 CRUD, 방영 분기, 에피소드 수정/삭제, 접근코드, aniDL."""
import os
import pytest
from fastapi.testclient import TestClient

from conftest import make_client
from server.core.config import Settings, get_settings
from server.core.security import Identity
from server.main import app
from server.models import Anime, AnimeBroadcast, Episode, Setting, User


@pytest.fixture()
def admin_client(db_session, tmp_path):
    for d in ("covers", "animes", "downloader"):
        (tmp_path / d).mkdir(parents=True, exist_ok=True)
    settings = Settings(base_dir=tmp_path, db_url="sqlite://")
    db_session.add(User(id=1, external_sub="admin", is_admin=1))
    db_session.commit()
    for client in make_client(db_session, Identity(user_id=1, is_admin=True)):
        app.dependency_overrides[get_settings] = lambda: settings
        yield client, settings


def _create_anime(client, **extra):
    data = {"title": "테스트 애니"}
    data.update(extra)
    return client.post("/api/admin/animes", data=data,
                       files={"cover": ("cover.jpg", b"\xff\xd8\xff", "image/jpeg")})


def test_admin_requires_admin(anon_client):
    assert anon_client.post("/api/admin/animes", data={"title": "x"}).status_code == 403


def test_create_anime_with_broadcast_pairs(admin_client, db_session):
    client, settings = admin_client
    resp = _create_anime(
        client, description="설명", season_id="G1", is_hidive="1",
        broadcast_day="월", download_url="https://x", namuwiki_url="https://n",
        broadcast_year=["2024", "2025"], broadcast_quarter=["4", "1"],
    )
    assert resp.status_code == 200
    anime = db_session.get(Anime, resp.json()["id"])
    assert anime.title == "테스트 애니"
    assert anime.is_hidive is True
    # 첫 분기(정렬 후 [2024,4])가 animes에 미러
    assert anime.broadcast_year == 2024 and anime.broadcast_quarter == 4
    pairs = db_session.query(AnimeBroadcast).filter_by(anime_id=anime.id).all()
    assert sorted((p.broadcast_year, p.broadcast_quarter) for p in pairs) == [(2024, 4), (2025, 1)]
    assert (settings.base_dir / "covers" / anime.cover_image).is_file()


def test_create_anime_validation(admin_client, db_session):
    client, _ = admin_client
    assert client.post("/api/admin/animes", data={"title": "   "}).status_code == 400
    assert client.post("/api/admin/animes", data={"title": "x"}).status_code == 400  # 커버 없음
    resp = client.post("/api/admin/animes", data={"title": "x"},
                       files={"cover": ("c.txt", b"x", "text/plain")})
    assert resp.status_code == 400
    # 잘못된 분기 값은 무시됨
    resp = _create_anime(client, broadcast_year=["abc", "2024"], broadcast_quarter=["9", "2"])
    anime = db_session.get(Anime, resp.json()["id"])
    assert anime.broadcast_year == 2024 and anime.broadcast_quarter == 2


def test_update_anime_replaces_pairs_and_cover(admin_client, db_session):
    client, settings = admin_client
    aid = _create_anime(client, broadcast_year=["2024"], broadcast_quarter=["1"]).json()["id"]
    old_cover = db_session.get(Anime, aid).cover_image
    resp = client.put(
        f"/api/admin/animes/{aid}",
        data={"title": "수정됨", "broadcast_year": ["2025"], "broadcast_quarter": ["3"], "broadcast_day": "화"},
        files={"cover": ("new.png", b"\x89PNG", "image/png")},
    )
    assert resp.status_code == 200
    anime = db_session.get(Anime, aid)
    assert anime.title == "수정됨"
    assert anime.cover_image != old_cover
    assert not (settings.base_dir / "covers" / old_cover).exists()  # 구 커버 삭제
    assert anime.broadcast_year == 2025 and anime.broadcast_quarter == 3
    assert db_session.query(AnimeBroadcast).filter_by(anime_id=aid).count() == 1
    assert client.put(f"/api/admin/animes/999", data={"title": "x"}).status_code == 404


def test_delete_anime_removes_files(admin_client, db_session):
    client, settings = admin_client
    aid = _create_anime(client).json()["id"]
    anime_dir = settings.base_dir / "animes" / str(aid)
    anime_dir.mkdir()
    (anime_dir / "1.mp4").write_bytes(b"v")
    db_session.add(Episode(id=1, anime_id=aid, episode_number="1", file_path=f"animes/{aid}/1.mp4"))
    db_session.commit()
    cover = db_session.get(Anime, aid).cover_image

    assert client.delete(f"/api/admin/animes/{aid}").status_code == 200
    assert db_session.get(Anime, aid) is None
    assert not (anime_dir / "1.mp4").exists()
    assert not anime_dir.exists()  # 비어서 rmdir됨
    assert not (settings.base_dir / "covers" / cover).exists()
    assert client.delete(f"/api/admin/animes/{aid}").status_code == 404


def test_episode_update_delete(admin_client, db_session):
    client, settings = admin_client
    db_session.add(Anime(id=1, title="t", cover_image="t.jpg"))
    db_session.add(Episode(id=1, anime_id=1, episode_number="1", file_path="animes/1/1.mp4"))
    db_session.commit()
    video = settings.base_dir / "animes" / "1" / "1.mp4"
    video.parent.mkdir(parents=True)
    video.write_bytes(b"v")

    resp = client.put("/api/admin/episodes/1", json={"title": "새 제목"})
    assert resp.status_code == 200
    assert db_session.get(Episode, 1).title == "새 제목"
    # 빈 제목 → NULL
    client.put("/api/admin/episodes/1", json={"title": ""})
    assert db_session.get(Episode, 1).title is None

    assert client.delete("/api/admin/episodes/1").status_code == 200
    assert db_session.get(Episode, 1) is None
    assert not video.exists()
    assert client.delete("/api/admin/episodes/1").status_code == 404


def test_access_code_change(admin_client, db_session):
    client, _ = admin_client
    assert client.post("/api/admin/access-code", json={"access_code": ""}).status_code == 400
    assert client.post("/api/admin/access-code", json={"access_code": "9876"}).status_code == 200
    assert db_session.get(Setting, "access_code").value == "9876"
    client.post("/api/admin/access-code", json={"access_code": "1111"})
    assert db_session.get(Setting, "access_code").value == "1111"


def test_new_badge_days_change(admin_client, db_session):
    client, _ = admin_client
    for bad in (0, -1, 366):
        assert client.post("/api/admin/new-badge-days", json={"days": bad}).status_code == 400
    resp = client.post("/api/admin/new-badge-days", json={"days": 7})
    assert resp.status_code == 200 and resp.json()["days"] == 7
    assert db_session.get(Setting, "new_badge_days").value == "7"
    client.post("/api/admin/new-badge-days", json={"days": 14})
    assert db_session.get(Setting, "new_badge_days").value == "14"


def test_site_config(anon_client, db_session):
    # 행 없음 → 기본 3일
    assert anon_client.get("/api/config").json()["new_badge_days"] == 3
    db_session.add(Setting(key="new_badge_days", value="14"))
    db_session.commit()
    assert anon_client.get("/api/config").json()["new_badge_days"] == 14
    # 파싱 불가 값 → 기본값 폴백
    db_session.get(Setting, "new_badge_days").value = "abc"
    db_session.commit()
    assert anon_client.get("/api/config").json()["new_badge_days"] == 3


# ---------- aniDL ----------


def _stub_anidl(settings, body='#!/bin/sh\necho "OUT:$@"\n'):
    script = settings.base_dir / "downloader" / "crdn.sh"
    script.write_text(body)
    script.chmod(0o755)


def test_anidown_search(admin_client):
    client, settings = admin_client
    _stub_anidl(settings)
    resp = client.get("/api/anidown/search", params={"keyword": "스파이 패밀리"})
    assert resp.status_code == 200
    assert "OUT:--search 스파이 패밀리" in resp.text
    # 빈 검색어
    assert client.get("/api/anidown/search", params={"keyword": " "}).text == "검색어를 입력하세요."


def test_anidown_episodes_sse(admin_client):
    client, settings = admin_client
    _stub_anidl(settings, body='#!/bin/sh\necho "E1 - 1화"\necho "E2 - 2화"\n')
    resp = client.get("/api/anidown/episodes", params={"season_id": "G123"})
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    assert "data: E1 - 1화" in resp.text
    assert "data: E2 - 2화" in resp.text
    assert "event: done" in resp.text
    assert client.get("/api/anidown/episodes", params={"season_id": ""}).status_code == 400
