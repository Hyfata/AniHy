"""애니 목록/상세/분기 엔드포인트 검증."""
import pytest
from fastapi.testclient import TestClient

from conftest import make_client
from server.core.security import Identity
from server.models import Anime, AnimeBroadcast, Episode, User, WatchHistory


@pytest.fixture()
def seed_detail(db_session):
    db_session.add_all([
        Anime(id=1, title="A애니", cover_image="a.jpg", broadcast_day="월", description="d", season_id="sid"),
        Anime(id=2, title="B애니", cover_image="b.jpg", broadcast_day="기타"),
        AnimeBroadcast(id=1, anime_id=1, broadcast_year=2025, broadcast_quarter=4),
        Episode(id=1, anime_id=1, episode_number="1", title="1화", file_path="animes/1/1.mp4",
                duration_ms=1_420_000, has_subtitle=True),
        Episode(id=2, anime_id=1, episode_number="OVA", file_path="animes/1/OVA.mp4"),
        Episode(id=3, anime_id=1, episode_number="S1", file_path="animes/1/S1.mp4"),
        Episode(id=4, anime_id=1, episode_number="2", file_path="animes/1/2.mp4"),
    ])
    db_session.commit()


def test_list_animes_pagination_and_admin_fields(db_session, seed_detail):
    for client in make_client(db_session, Identity(user_id=None, is_admin=False)):
        r = client.get("/api/animes", params={"limit": 1}).json()
        assert r["total"] == 2 and r["has_more"] is True and r["is_admin"] is False
        assert "broadcasts" not in r["animes"][0]
        assert r["animes"][0]["cover"].startswith("/api/files/covers/")
    for client in make_client(db_session, Identity(user_id=1, is_admin=True)):
        r = client.get("/api/animes").json()
        assert r["has_more"] is False and r["is_admin"] is True
        first = next(a for a in r["animes"] if a["id"] == 1)
        assert first["broadcasts"] == [[2025, 4]]
        assert first["season_id"] == "sid"


def test_anime_detail_episode_order_and_urls(user_client, db_session, seed_detail):
    d = user_client.get("/api/animes/1").json()
    # anime.php 정렬: S프리픽스 우선 → 숫자 → 기타
    assert [e["episode_number"] for e in d["episodes"]] == ["S1", "1", "2", "OVA"]
    ep1 = next(e for e in d["episodes"] if e["episode_number"] == "1")
    assert ep1["video_url"] == "/api/files/animes/1/1.mp4"
    assert ep1["duration_text"] == "23:40"
    assert ep1["has_subtitle"] is True
    # 썸네일 파일이 없으면 커버 폭백 (AGENTS.md 규약)
    assert ep1["thumb_url"] == "/api/files/covers/a.jpg"


def test_anime_detail_watch_progress(user_client, db_session, seed_detail):
    db_session.add(User(id=1, external_sub="x", is_admin=0)) if db_session.get(User, 1) is None else None
    db_session.add(WatchHistory(user_id=1, anime_id=1, episode_number="1",
                                position_ms=600_000, duration_ms=1_200_000))
    db_session.commit()
    d = user_client.get("/api/animes/1").json()
    ep1 = next(e for e in d["episodes"] if e["episode_number"] == "1")
    assert ep1["watch_progress"]["ratio"] == 0.5
    ep2 = next(e for e in d["episodes"] if e["episode_number"] == "2")
    assert "watch_progress" not in ep2


def test_anime_detail_anonymous_has_no_progress(db_session, seed_detail):
    db_session.add(WatchHistory(user_id=1, anime_id=1, episode_number="1",
                                position_ms=1, duration_ms=2))
    db_session.commit()
    for client in make_client(db_session, Identity(user_id=None, is_admin=False)):
        d = client.get("/api/animes/1").json()
        assert d["logged_in"] is False
        assert "watch_progress" not in d["episodes"][0]
        assert d["is_bookmarked"] is False


def test_anime_detail_404(user_client, seed_detail):
    assert user_client.get("/api/animes/99").status_code == 404


def test_quarters(user_client, seed_detail):
    q = user_client.get("/api/quarters").json()["quarters"]
    assert q == [{"year": 2025, "quarter": 4, "count": 1, "covers": ["/api/files/covers/a.jpg"]}]


def test_quarter_detail_and_day_filter(user_client, seed_detail):
    db = user_client.get("/api/quarters/2025/4").json()
    assert [a["title"] for a in db["animes"]] == ["A애니"]
    assert db["animes"][0]["broadcast_day"] == "월"
    assert db["animes"][0]["broadcasts"] == [[2025, 4]]
    assert len(user_client.get("/api/quarters/2025/4", params={"day": "월"}).json()["animes"]) == 1
    assert len(user_client.get("/api/quarters/2025/4", params={"day": "화"}).json()["animes"]) == 0
    assert user_client.get("/api/quarters/2025/9").status_code == 404
