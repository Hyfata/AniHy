"""Profile API (GET /api/users/me) — anonymous 401 + watch-stats sums (sqlite)."""
from server.models import WatchHistory


def test_users_me_requires_login(anon_client):
    assert anon_client.get("/api/users/me").status_code == 401


def test_users_me_profile_and_stats(user_client, db_session, seed_animes):
    db_session.add_all([
        WatchHistory(user_id=1, anime_id=1, episode_number="1", position_ms=600_000, duration_ms=1_200_000, completed=0),
        WatchHistory(user_id=1, anime_id=1, episode_number="2", position_ms=1_200_000, duration_ms=1_200_000, completed=1),
        WatchHistory(user_id=1, anime_id=2, episode_number="1", position_ms=300_000, duration_ms=1_200_000, completed=0),
    ])
    db_session.commit()
    resp = user_client.get("/api/users/me")
    assert resp.status_code == 200
    data = resp.json()
    assert data["display_name"] == "tester"
    assert data["created_at"] is not None
    assert data["total_watch_ms"] == 2_100_000
    assert data["watched_episodes"] == 3
    assert data["completed_episodes"] == 1
