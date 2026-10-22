"""검색 API — api/search_titles.php + api/trending_searches.php 대응."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.security import require_access
from ..models import Anime, SearchHit
from ..services import romanize, urls

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


@router.get("")
def search_titles(q: str = Query(""), db: Session = Depends(get_db)):
    query = q.strip()
    if len(query) > 100:  # PHP의 100자 캡 (mbstring 부재 우회와 달리 문자 단위로 처리 가능)
        query = query[:100]
    if not query:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="검색어를 입력하세요.")

    candidates = db.execute(
        select(Anime).where(Anime.title.like(f"%{query}%"))
    ).scalars().all()
    candidates.sort(key=lambda a: _rank_key(query, a.title))
    has_more = len(candidates) > _LIMIT
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
            rows.extend(a for _, a in scored[:_LIMIT])

    if rows:
        _record_search_hit(db, rows[0].id)

    items = [_card(a) for a in rows]
    return {"animes": items, "has_more": has_more, "total": len(items)}


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
