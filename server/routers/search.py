"""검색 API — api/search_titles.php + api/trending_searches.php 대응."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.security import require_access
from ..models import Anime, SearchHit
from ..services import romanize, urls
from .animes import _latest_episode_map, _with_latest_episode

router = APIRouter(prefix="/search", tags=["search"], dependencies=[Depends(require_access)])

_LIMIT = 30


def _rank_key(query: str, title: str):
    """관련도 순: 정확 일치 > 접두사 > 부분, 동률이면 매칭 위치 → 제목 짧은 순 (PHP ORDER BY 이식)."""
    if title == query:
        rank = 0
    elif title.startswith(query):
        rank = 1
    else:
        rank = 2
    idx = title.find(query)  # LOCATE와 달리 0-based — 없으면 -1이지만 LIKE 후변이므로 항상 존재
    return (rank, idx if idx >= 0 else 0, len(title), title)


def _card(a: Anime) -> dict:
    return {"id": a.id, "title": a.title, "cover": urls.cover_url(a.cover_image)}


def _record_search_hit(db: Session, anime_id: int) -> None:
    """상위 1건의 anime_id를 search_hits에 UPSERT. 기록 실패는 검색 자체를 막지 않음."""
    try:
        hit = db.get(SearchHit, anime_id)
        if hit is None:
            db.add(SearchHit(anime_id=anime_id, hit_count=1, last_hit_at=datetime.now()))
        else:
            hit.hit_count += 1
            hit.last_hit_at = datetime.now()
        db.commit()
    except Exception:
        db.rollback()


def _find_candidates(db: Session, query: str) -> tuple[list[Anime], int]:
    """제목 LIKE(관련도 정렬) + 한글 로마자 근사 매칭을 뒤에 붙인 최종 후보 목록.

    반환: (rows, like_total) — like_total은 LIKE 후보 전체 수 (has_more 판별용).
    """
    candidates = db.execute(
        select(Anime).where(Anime.title.like(f"%{query}%"))
    ).scalars().all()
    candidates.sort(key=lambda a: _rank_key(query, a.title))
    rows = candidates[:_LIMIT]
    # 한글 검색어는 로마자 발음 근사 매칭을 LIKE 결과 뒤에 추가
    if romanize.has_hangul(query):
        variants = romanize.search_query_variants(query)
        if variants:
            like_ids = {a.id for a in rows}
            scored = []
            for a in db.execute(select(Anime)).scalars().all():
                if a.id in like_ids:
                    continue
                score = romanize.phonetic_match_score(variants, romanize.normalize_search_text(a.title))
                if score > 0.0:
                    scored.append((score, a))
                    # 충분히 모으면 중단 — 점수 정밀 정렬보다 응답 시간이 중요 (긴 검색어 보호)
                    if len(scored) >= _LIMIT:
                        break
            scored.sort(key=lambda x: x[0], reverse=True)
            rows = rows + [a for _, a in scored[:_LIMIT]]
    return rows, len(candidates)


@router.get("")
def search_titles(q: str = Query(""), db: Session = Depends(get_db)):
    query = q.strip()
    if len(query) > 100:  # PHP의 100자 캡 (mbstring 부재 우회와 달리 문자 단위로 처리 가능)
        query = query[:100]
    if not query:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="검색어를 입력하세요.")

    rows, like_total = _find_candidates(db, query)
    has_more = like_total > _LIMIT

    if rows:
        _record_search_hit(db, rows[0].id)

    latest_map = _latest_episode_map(db, [a.id for a in rows])
    items = [_with_latest_episode(_card(a), latest_map.get(a.id)) for a in rows]
    return {"animes": items, "has_more": has_more, "total": len(items)}


_SUGGEST_LIMIT = 10


@router.get("/suggest")
def search_suggest(q: str = Query(""), db: Session = Depends(get_db)):
    """연관 검색어 — 타이핑 중 제안용 경량 버전. 히트(search_hits) 기록 없음."""
    query = q.strip()[:100]
    if not query:
        return {"suggestions": []}
    rows, _ = _find_candidates(db, query)
    return {"suggestions": [{"id": a.id, "title": a.title} for a in rows[:_SUGGEST_LIMIT]]}


@router.get("/trending")
def trending_searches(db: Session = Depends(get_db)):
    """api/trending_searches.php 대응 — search_hits JOIN animes 상위 10."""
    rows = db.execute(
        select(Anime, SearchHit.hit_count, SearchHit.last_hit_at)
        .join(SearchHit, SearchHit.anime_id == Anime.id)
        .order_by(SearchHit.hit_count.desc(), SearchHit.last_hit_at.desc())
        .limit(10)
    ).all()
    return {
        "trending": [
            {**_card(a), "hit_count": cnt, "last_hit_at": last.isoformat() if last else None}
            for a, cnt, last in rows
        ]
    }
