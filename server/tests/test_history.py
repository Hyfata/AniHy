"""시청기록 upsert/completed/bulk 최신우선 + 로그인 필수 검증."""
import time

from server.models import Anime, Episode, WatchHistory


def _seed_episode(db_session):
    db_session.add_all([
        Anime(id=1, title="테스트 애니", cover_image="t.jpg"),
        Episode(id=1, anime_id=1, episode_number="1", title="1화", file_path="animes/1/1.mp4", duration_ms=1_420_000),
    ])
    db_session.commit()


def test_history_requires_login(anon_client):
    assert anon_client.put("/api/history/1/1", json={"position_ms": 0, "duration_ms": 0}).status_code == 401
    assert anon_client.get("/api/history").status_code == 401
    assert anon_client.get("/api/history/1/1").status_code == 401
    assert anon_client.delete("/api/history").status_code == 401


def test_put_and_get_history(user_client, db_session):
    _seed_episode(db_session)
    resp = user_client.put("/api/history/1/1", json={"position_ms": 600_000, "duration_ms": 1_200_000})
    assert resp.status_code == 200
    body = resp.json()
    assert body["position_ms"] == 600_000
    assert body["ratio"] == 0.5
    assert body["completed"] is False

    got = user_client.get("/api/history/1/1").json()
    assert got["position_ms"] == 600_000


def test_put_upsert_overwrites(user_client, db_session):
    _seed_episode(db_session)
    user_client.put("/api/history/1/1", json={"position_ms": 100_000, "duration_ms": 1_000_000})
    user_client.put("/api/history/1/1", json={"position_ms": 200_000, "duration_ms": 1_000_000})
    assert db_session.query(WatchHistory).count() == 1
    assert db_session.query(WatchHistory).one().position_ms == 200_000


def test_completed_at_95_percent(user_client, db_session):
    _seed_episode(db_session)
    body = user_client.put(
        "/api/history/1/1", json={"position_ms": 950_000, "duration_ms": 1_000_000}
    ).json()
    assert body["completed"] is True
    body = user_client.put(
        "/api/history/1/1", json={"position_ms": 949_999, "duration_ms": 1_000_000}
    ).json()
    assert body["completed"] is False


def test_history_list_joined(user_client, db_session):
    _seed_episode(db_session)
    user_client.put("/api/history/1/1", json={"position_ms": 600_000, "duration_ms": 1_200_000})
    items = user_client.get("/api/history").json()["history"]
    assert len(items) == 1
    assert items[0]["title"] == "테스트 애니"
    assert items[0]["cover"] == "/api/files/covers/t.jpg"
    assert items[0]["episode_title"] == "1화"
    assert items[0]["episode_duration_ms"] == 1_420_000


def test_delete_history(user_client, db_session):
    _seed_episode(db_session)
    user_client.put("/api/history/1/1", json={"position_ms": 1, "duration_ms": 2})
    user_client.put("/api/history/1/2", json={"position_ms": 1, "duration_ms": 2})
    assert user_client.delete("/api/history/1/1").json()["ok"] is True
    assert db_session.query(WatchHistory).count() == 1
    assert user_client.delete("/api/history").json()["ok"] is True
    assert db_session.query(WatchHistory).count() == 0


def test_get_missing_history_404(user_client, db_session):
    _seed_episode(db_session)
    assert user_client.get("/api/history/1/9").status_code == 404


def test_bulk_newer_wins(user_client, db_session):
    _seed_episode(db_session)
    now_ms = int(time.time() * 1000)
    # 서버에 최신 기록 저장
    resp = user_client.post("/api/history/bulk", json=[
        {"anime_id": 1, "episode_number": "1", "position_ms": 900_000,
         "duration_ms": 1_000_000, "updated_at": now_ms},
    ])
    assert resp.json()["applied"] == 1
    # 더 오래된 값은 거부
    resp = user_client.post("/api/history/bulk", json=[
        {"anime_id": 1, "episode_number": "1", "position_ms": 100_000,
         "duration_ms": 1_000_000, "updated_at": now_ms - 60_000},
    ])
    assert resp.json() == {"ok": True, "applied": 0, "skipped": 1}
    assert db_session.query(WatchHistory).one().position_ms == 900_000
    # 더 최신 값은 반영
    resp = user_client.post("/api/history/bulk", json=[
        {"anime_id": 1, "episode_number": "1", "position_ms": 500_000,
         "duration_ms": 1_000_000, "updated_at": now_ms + 60_000},
    ])
    assert resp.json()["applied"] == 1
    assert db_session.query(WatchHistory).one().position_ms == 500_000


def test_history_isolated_per_user(db_session, seed_animes):
    from conftest import make_client
    from server.core.security import Identity
    from server.models import User

    db_session.add_all([
        User(id=1, external_sub="u1", is_admin=0),
        User(id=2, external_sub="u2", is_admin=0),
        Episode(id=1, anime_id=1, episode_number="1", file_path="x.mp4"),
    ])
    db_session.commit()
    for client in make_client(db_session, Identity(user_id=1, is_admin=False)):
        client.put("/api/history/1/1", json={"position_ms": 111, "duration_ms": 1000})
    for client in make_client(db_session, Identity(user_id=2, is_admin=False)):
        assert client.get("/api/history").json()["history"] == []
        assert client.get("/api/history/1/1").status_code == 404
