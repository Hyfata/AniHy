"""북마크 토글/목록 + 로그인 필수 검증."""
from datetime import datetime, timedelta

from server.models import Bookmark, Episode


def test_bookmarks_require_login(anon_client):
    assert anon_client.post("/api/bookmarks/1").status_code == 401
    assert anon_client.delete("/api/bookmarks/1").status_code == 401
    assert anon_client.get("/api/bookmarks").status_code == 401


def test_bookmark_add_list_remove(user_client, db_session, seed_animes):
    resp = user_client.post("/api/bookmarks/1")
    assert resp.json() == {"ok": True, "bookmarked": True}

    items = user_client.get("/api/bookmarks").json()["bookmarks"]
    assert len(items) == 1
    assert items[0]["id"] == 1
    assert items[0]["title"] == "Spy x Family"
    assert items[0]["cover"] == "/api/files/covers/spy.jpg"

    resp = user_client.delete("/api/bookmarks/1")
    assert resp.json() == {"ok": True, "bookmarked": False}
    assert user_client.get("/api/bookmarks").json()["bookmarks"] == []


def test_bookmarks_latest_episode_at(user_client, db_session, seed_animes):
    latest = datetime.now() - timedelta(days=2)
    db_session.add(Episode(id=1, anime_id=1, episode_number="1", file_path="animes/1/1.mp4", created_at=latest))
    db_session.commit()
    user_client.post("/api/bookmarks/1")
    items = user_client.get("/api/bookmarks").json()["bookmarks"]
    assert items[0]["latest_episode_at"] == latest.isoformat()


def test_bookmark_add_idempotent(user_client, db_session, seed_animes):
    user_client.post("/api/bookmarks/2")
    user_client.post("/api/bookmarks/2")
    assert db_session.query(Bookmark).count() == 1


def test_bookmark_unknown_anime_404(user_client, seed_animes):
    assert user_client.post("/api/bookmarks/999").status_code == 404
    # 존재하지 않는 애니 삭제는 멱등 성공
    assert user_client.delete("/api/bookmarks/999").json()["bookmarked"] is False


def test_anime_detail_is_bookmarked(user_client, db_session, seed_animes):
    user_client.post("/api/bookmarks/3")
    detail = user_client.get("/api/animes/3").json()
    assert detail["is_bookmarked"] is True
    detail = user_client.get("/api/animes/1").json()
    assert detail["is_bookmarked"] is False
