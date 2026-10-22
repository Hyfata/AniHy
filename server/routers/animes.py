"""애니 목록/상세/분기 API — api/list_animes.php, anime.php, index.php?tab=quarter, quarter.php 대응."""
import os
import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.config import Settings, get_settings
from ..core.db import get_db
from ..core.security import Identity, get_current_identity, require_access
from ..models import Anime, AnimeBroadcast, Bookmark, Episode, WatchHistory
from ..services import urls

router = APIRouter(tags=["animes"], dependencies=[Depends(require_access)])

_NUM_EP_RE = re.compile(r"^\d+(\.\d+)?$")


def _episode_sort_key(ep: Episode):
    """anime.php의 회차 정렬 SQL을 Python으로 이식 (S프리픽스 스페셜 우선, 숫자 회차 순)."""
    s = ep.episode_number
    is_special = s.upper().startswith("S")
    try:
        special_num = float(s[1:]) if is_special else 0.0
    except ValueError:
        special_num = 0.0
    numeric = bool(_NUM_EP_RE.match(s))
    return (
        0 if is_special else 1,
        special_num,
        0 if numeric else 1,
        float(s) if numeric else 0.0,
        s,
    )


def _broadcast_map(db: Session, anime_ids: list[int]) -> dict[int, list[list[int]]]:
    """fetchBroadcastMap() 포팅: [anime_id => [[year, quarter], ...]]"""
    if not anime_ids:
        return {}
    rows = db.execute(
        select(AnimeBroadcast.anime_id, AnimeBroadcast.broadcast_year, AnimeBroadcast.broadcast_quarter)
        .where(AnimeBroadcast.anime_id.in_(anime_ids))
        .order_by(AnimeBroadcast.broadcast_year, AnimeBroadcast.broadcast_quarter)
    ).all()
    out: dict[int, list[list[int]]] = {}
    for aid, y, q in rows:
        out.setdefault(aid, []).append([y, q])
    return out


def _anime_card(a: Anime) -> dict:
    return {"id": a.id, "title": a.title, "cover": urls.cover_url(a.cover_image)}


@router.get("/animes")
def list_animes(
    offset: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=60),
    db: Session = Depends(get_db),
    identity: Identity = Depends(get_current_identity),
):
    """api/list_animes.php 대응 — 무한스크롤 페이지네이션 (LIMIT+1로 has_more 판별)."""
    total = db.scalar(select(func.count()).select_from(Anime)) or 0
    rows = db.execute(
        select(Anime).order_by(Anime.created_at.desc(), Anime.id.desc()).limit(limit + 1).offset(offset)
    ).scalars().all()
    has_more = len(rows) > limit
    rows = rows[:limit]

    broadcast_map = _broadcast_map(db, [a.id for a in rows]) if identity.is_admin else {}

    items = []
    for a in rows:
        item = _anime_card(a)
        if identity.is_admin:
            # 카드 수정 버튼 data-* 복원 필드 (PHP와 동일)
            item.update(
                description=a.description or "",
                season_id=a.season_id or "",
                is_hidive="1" if a.is_hidive else "0",
                broadcasts=broadcast_map.get(a.id, []),
                broadcast_day=a.broadcast_day or "",
                download_url=a.download_url or "",
                namuwiki_url=a.namuwiki_url or "",
            )
        items.append(item)

    return {"animes": items, "has_more": has_more, "total": total, "is_admin": identity.is_admin}


@router.get("/animes/{anime_id}")
def anime_detail(
    anime_id: int,
    db: Session = Depends(get_db),
    identity: Identity = Depends(get_current_identity),
    settings: Settings = Depends(get_settings),
):
    """anime.php 데이터 대응 — 상세 + 회차 목록(썸네일/챕터/진행률) + 북마크 여부."""
    a = db.get(Anime, anime_id)
    if a is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="애니를 찾을 수 없습니다")

    episodes = sorted(
        db.execute(select(Episode).where(Episode.anime_id == anime_id)).scalars().all(),
        key=_episode_sort_key,
    )

    # 로그인 사용자: 회차별 시청 진행률 + 북마크
    progress: dict[str, tuple[int, int]] = {}
    is_bookmarked = False
    if identity.logged_in:
        hrows = db.execute(
            select(WatchHistory.episode_number, WatchHistory.position_ms, WatchHistory.duration_ms)
            .where(WatchHistory.user_id == identity.user_id, WatchHistory.anime_id == anime_id)
        ).all()
        progress = {ep: (pos, dur) for ep, pos, dur in hrows}
        is_bookmarked = db.execute(
            select(func.count()).select_from(Bookmark).where(
                Bookmark.user_id == identity.user_id, Bookmark.anime_id == anime_id
            )
        ).scalar() > 0

    base_dir = Path(settings.base_dir)
    ep_items = []
    for ep in episodes:
        safe_ep = urls.sanitize_filename(ep.episode_number)
        thumb_path = base_dir / urls.episode_thumb_rel(anime_id, safe_ep)
        if thumb_path.is_file():
            thumb_url = f"{urls.episode_thumb_url(anime_id, safe_ep)}?v={int(os.path.getmtime(thumb_path))}"
        else:
            thumb_url = urls.cover_url(a.cover_image)
        has_chapters = (base_dir / urls.chapter_vtt_rel(anime_id, safe_ep)).is_file()

        item = {
            "episode_number": ep.episode_number,
            "title": ep.title,
            "duration_ms": ep.duration_ms,
            "duration_text": urls.format_playtime(ep.duration_ms),
            "has_subtitle": bool(ep.has_subtitle),
            "en_subtitle_url": urls.subtitle_url(ep.en_subtitle_file) if ep.en_subtitle_file else None,
            "video_url": urls.anime_video_url(anime_id, ep.episode_number),
            "thumb_url": thumb_url,
            "chapters_url": urls.chapter_vtt_url(anime_id, safe_ep) if has_chapters else None,
        }
        if identity.logged_in and ep.episode_number in progress:
            pos, dur = progress[ep.episode_number]
            item["watch_progress"] = {
                "position_ms": pos,
                "duration_ms": dur,
                "ratio": (pos / dur) if dur > 0 else 0.0,
            }
        ep_items.append(item)

    return {
        "id": a.id,
        "title": a.title,
        "cover": urls.cover_url(a.cover_image),
        "description": a.description,
        "season_id": a.season_id,
        "is_hidive": bool(a.is_hidive),
        "broadcast_year": a.broadcast_year,
        "broadcast_quarter": a.broadcast_quarter,
        "broadcast_day": a.broadcast_day,
        "download_url": a.download_url,
        "namuwiki_url": a.namuwiki_url,
        "broadcasts": _broadcast_map(db, [anime_id]).get(anime_id, []),
        "episodes": ep_items,
        "is_bookmarked": is_bookmarked,
        "is_admin": identity.is_admin,
        "logged_in": identity.logged_in,
    }


@router.get("/quarters")
def list_quarters(db: Session = Depends(get_db)):
    """index.php?tab=quarter 대응 — 연도/분기별 작품 수 + 대표 커버(최대 6)."""
    rows = db.execute(
        select(
            AnimeBroadcast.broadcast_year,
            AnimeBroadcast.broadcast_quarter,
            Anime.id,
            Anime.cover_image,
        ).join(Anime, Anime.id == AnimeBroadcast.anime_id)
    ).all()

    groups: dict[int, dict[int, dict]] = {}
    for y, q, aid, cover in rows:
        g = groups.setdefault(y, {}).setdefault(q, {"count": 0, "covers": []})
        g["count"] += 1
        if cover and len(g["covers"]) < 6:
            g["covers"].append(urls.cover_url(cover))

    return {
        "quarters": [
            {"year": y, "quarter": q, "count": g["count"], "covers": g["covers"]}
            for y in sorted(groups, reverse=True)
            for q, g in sorted(groups[y].items())
        ]
    }


_QUARTER_DAYS = ["월", "화", "수", "목", "금", "토", "일"]


@router.get("/quarters/{year}/{quarter}")
def quarter_detail(
    year: int,
    quarter: int,
    day: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """quarter.php 대응 — 해당 분기 애니 목록 (방영 요일 포함, day 필터)."""
    if quarter not in (1, 2, 3, 4):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="분기는 1~4만 가능합니다")

    animes = db.execute(
        select(Anime)
        .join(AnimeBroadcast, AnimeBroadcast.anime_id == Anime.id)
        .where(
            AnimeBroadcast.broadcast_year == year,
            AnimeBroadcast.broadcast_quarter == quarter,
        )
        .distinct()
        .order_by(Anime.title.asc())
    ).scalars().all()

    if day:
        animes = [a for a in animes if (a.broadcast_day if a.broadcast_day in _QUARTER_DAYS else "기타") == day]

    bmap = _broadcast_map(db, [a.id for a in animes])
    items = []
    for a in animes:
        item = _anime_card(a)
        item["broadcast_day"] = a.broadcast_day if a.broadcast_day in _QUARTER_DAYS else "기타"
        item["broadcasts"] = bmap.get(a.id, [])
        items.append(item)

    return {"year": year, "quarter": quarter, "days": _QUARTER_DAYS + ["기타"], "animes": items}
