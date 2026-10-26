"""검색 랭킹 + search_hits UPSERT + 트렌딩 (sqlite)."""
from server.models import SearchHit


def test_search_empty_query(user_client):
    assert user_client.get("/api/search").status_code == 400
    assert user_client.get("/api/search", params={"q": "  "}).status_code == 400


def test_search_exact_prefix_substring_ranking(user_client, seed_animes):
    resp = user_client.get("/api/search", params={"q": "스파이"})
    assert resp.status_code == 200
    animes = resp.json()["animes"]
    titles = [a["title"] for a in animes]
    # 정확/접두사 LIKE 결과 "스파이 패밀리"가 먼저, 발음 근사로 "Spy x Family"가 뒤에
    assert titles[0] == "스파이 패밀리"
    assert "Spy x Family" in titles


def test_search_prefix_beats_substring(user_client, db_session):
    from server.models import Anime

    db_session.add_all([
        Anime(id=10, title="나의 히어로 아침", cover_image="a.jpg"),
        Anime(id=11, title="아침", cover_image="b.jpg"),
        Anime(id=12, title="아침드라마 모음", cover_image="c.jpg"),
    ])
    db_session.commit()
    resp = user_client.get("/api/search", params={"q": "아침"})
    titles = [a["title"] for a in resp.json()["animes"]]
    # 정확 일치(아침) > 접두사(아침드라마…) > 부분(나의 … 아침)
    assert titles == ["아침", "아침드라마 모음", "나의 히어로 아침"]


def test_search_records_top_hit(user_client, db_session, seed_animes):
    user_client.get("/api/search", params={"q": "스파이"})
    hit = db_session.get(SearchHit, 2)
    assert hit is not None and hit.hit_count == 1
    user_client.get("/api/search", params={"q": "스파이"})
    db_session.expire_all()
    assert db_session.get(SearchHit, 2).hit_count == 2


def test_search_no_results_no_hit(user_client, db_session, seed_animes):
    resp = user_client.get("/api/search", params={"q": "존재하지않는제목"})
    assert resp.json()["animes"] == []
    assert db_session.query(SearchHit).count() == 0


def test_suggest_returns_titles_without_recording_hits(user_client, db_session, seed_animes):
    resp = user_client.get("/api/search/suggest", params={"q": "스파이"})
    assert resp.status_code == 200
    suggestions = resp.json()["suggestions"]
    assert suggestions[0]["title"] == "스파이 패밀리"
    assert {"id", "title"} >= set(suggestions[0])  # 경량 shape (커버/히트 없음)
    assert db_session.query(SearchHit).count() == 0  # 제안은 히트 기록 안 함


def test_suggest_empty_query(user_client, db_session, seed_animes):
    resp = user_client.get("/api/search/suggest", params={"q": "  "})
    assert resp.status_code == 200
    assert resp.json() == {"suggestions": []}
    assert db_session.query(SearchHit).count() == 0


def test_search_romanized_fuzzy_match(user_client, seed_animes):
    resp = user_client.get("/api/search", params={"q": "제로"})
    titles = [a["title"] for a in resp.json()["animes"]]
    assert "Re:제로부터 시작하는 이세계 생활" in titles  # LIKE 매칭
    # 한글 검색어 발음 근사 — '제로' → 'zero' 사전 치환으로 영문 제목에도 점수가 붙는지
    resp2 = user_client.get("/api/search", params={"q": "스파이"})
    assert "Spy x Family" in [a["title"] for a in resp2.json()["animes"]]


def test_trending(user_client, db_session, seed_animes):
    from datetime import datetime

    db_session.add_all([
        SearchHit(anime_id=1, hit_count=5, last_hit_at=datetime.now()),
        SearchHit(anime_id=4, hit_count=9, last_hit_at=datetime.now()),
    ])
    db_session.commit()
    resp = user_client.get("/api/search/trending")
    assert resp.status_code == 200
    trending = resp.json()["trending"]
    assert [t["id"] for t in trending] == [4, 1]  # hit_count 내림차순
    assert trending[0]["hit_count"] == 9


def test_search_long_hangul_query_performance(user_client, seed_animes):
    """회귀: 긴 한글 검색어(인기검색어 클릭 등 전체 제목)가 퍼지 매칭에서 멈추지 않아야 한다.
    순수 파이썬 레벤슈타인 전체 행렬 계산으로 수십 초가 걸렸던 버그."""
    import time

    start = time.monotonic()
    resp = user_client.get(
        "/api/search",
        params={"q": "무직전생 ~이세계에 갔으면 최선을 다한다~ (파트 9) 완전판"},
    )
    elapsed = time.monotonic() - start
    assert resp.status_code == 200
    assert elapsed < 2.0, f"검색이 {elapsed:.1f}초 걸림 — 퍼지 매칭 성능 회귀"
