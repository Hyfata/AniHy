"""시청기록 API — plan §1.6. 로그인(Keycloak 계정) 단위로 완전 분리, 비로그인 401."""
import os
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..core.config import Settings, get_settings
from ..core.db import get_db
from ..core.security import Identity, require_access, require_login
from ..models import Anime, Episode, WatchHistory
from ..services import urls

router = APIRouter(prefix="/history", tags=["history"], dependencies=[Depends(require_access)])

COMPLETED_RATIO = 0.95


class HistoryPut(BaseModel):
    position_ms: int = 0
    duration_ms: int = 0


class HistoryBulkItem(BaseModel):
    anime_id: int
    episode_number: str
    position_ms: int = 0
    duration_ms: int = 0
    updated_at: int  # ms epoch


def _upsert(db: Session, user_id: int, anime_id: int, ep: str, pos: int, dur: int) -> WatchHistory:
    row = db.execute(
        select(WatchHistory).where(
            WatchHistory.user_id == user_id,
            WatchHistory.anime_id == anime_id,
            WatchHistory.episode_number == ep,
        )
    ).scalar_one_or_none()
    completed = dur > 0 and pos / dur >= COMPLETED_RATIO
    if row is None:
        row = WatchHistory(
            user_id=user_id, anime_id=anime_id, episode_number=ep,
            position_ms=pos, duration_ms=dur, completed=completed,
        )
        db.add(row)
    else:
        row.position_ms = pos
        row.duration_ms = dur
        row.completed = completed
        row.updated_at = datetime.now()
    return row


def _entry(row: WatchHistory) -> dict:
    return {
        "anime_id": row.anime_id,
        "episode_number": row.episode_number,
        "position_ms": row.position_ms,
        "duration_ms": row.duration_ms,
        "completed": bool(row.completed),
        "ratio": (row.position_ms / row.duration_ms) if row.duration_ms > 0 else 0.0,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@router.put("/{anime_id}/{episode_number}")
def put_history(
    anime_id: int,
    episode_number: str,
    body: HistoryPut,
    db: Session = Depends(get_db),
    identity: Identity = Depends(require_login),
):
    row = _upsert(db, identity.user_id, anime_id, episode_number, body.position_ms, body.duration_ms)
    db.commit()
    return _entry(row)


@router.get("/{anime_id}/{episode_number}")
def get_history_entry(
    anime_id: int,
    episode_number: str,
    db: Session = Depends(get_db),
    identity: Identity = Depends(require_login),
):
    row = db.execute(
        select(WatchHistory).where(
            WatchHistory.user_id == identity.user_id,
            WatchHistory.anime_id == anime_id,
            WatchHistory.episode_number == episode_number,
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="시청 기록이 없습니다")
    return _entry(row)


@router.get("")
def list_history(
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    identity: Identity = Depends(require_login),
    settings: Settings = Depends(get_settings),
):
    """보관함 시청기록 탭 — updated_at 내림차순, 애니/회차 조인."""
    rows = db.execute(
        select(WatchHistory, Anime, Episode)
        .join(Anime, Anime.id == WatchHistory.anime_id)
        .outerjoin(
            Episode,
            (Episode.anime_id == WatchHistory.anime_id)
            & (Episode.episode_number == WatchHistory.episode_number),
        )
        .where(WatchHistory.user_id == identity.user_id)
        .order_by(WatchHistory.updated_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()

    base_dir = Path(settings.base_dir)
    items = []
    for h, a, ep in rows:
        # 회차 썸네일이 있으면 그것, 없으면 커버 (상세 API와 같은 규약)
        safe_ep = urls.sanitize_filename(h.episode_number)
        thumb_path = base_dir / urls.episode_thumb_rel(a.id, safe_ep)
        if thumb_path.is_file():
            thumb = f"{urls.episode_thumb_url(a.id, safe_ep)}?v={int(os.path.getmtime(thumb_path))}"
        else:
            thumb = urls.cover_url(a.cover_image)
        items.append({
            **_entry(h),
            "title": a.title,
            "cover": urls.cover_url(a.cover_image),
            "thumb_url": thumb,
            "episode_title": ep.title if ep else None,
            "episode_duration_ms": ep.duration_ms if ep else None,
        })
    return {"history": items}


@router.delete("/{anime_id}/{episode_number}")
def delete_history_entry(
    anime_id: int,
    episode_number: str,
    db: Session = Depends(get_db),
    identity: Identity = Depends(require_login),
):
    db.execute(
        delete(WatchHistory).where(
            WatchHistory.user_id == identity.user_id,
            WatchHistory.anime_id == anime_id,
            WatchHistory.episode_number == episode_number,
        )
    )
    db.commit()
    return {"ok": True}


@router.delete("")
def delete_all_history(
    db: Session = Depends(get_db),
    identity: Identity = Depends(require_login),
):
    db.execute(delete(WatchHistory).where(WatchHistory.user_id == identity.user_id))
    db.commit()
    return {"ok": True}


@router.post("/bulk")
def bulk_history(
    items: list[HistoryBulkItem],
    db: Session = Depends(get_db),
    identity: Identity = Depends(require_login),
):
    """localStorage/오프라인 동기화 — 들어온 updated_at이 서버값보다 최신일 때만 반영."""
    applied = 0
    for item in items:
        incoming = datetime.fromtimestamp(item.updated_at / 1000)
        row = db.execute(
            select(WatchHistory).where(
                WatchHistory.user_id == identity.user_id,
                WatchHistory.anime_id == item.anime_id,
                WatchHistory.episode_number == item.episode_number,
            )
        ).scalar_one_or_none()
        if row is not None and row.updated_at is not None and row.updated_at >= incoming:
            continue  # 서버값이 더 최신 — 서버 우선
        completed = item.duration_ms > 0 and item.position_ms / item.duration_ms >= COMPLETED_RATIO
        if row is None:
            row = WatchHistory(
                user_id=identity.user_id, anime_id=item.anime_id,
                episode_number=item.episode_number,
                position_ms=item.position_ms, duration_ms=item.duration_ms,
                completed=completed, updated_at=incoming,
            )
            db.add(row)
        else:
            row.position_ms = item.position_ms
            row.duration_ms = item.duration_ms
            row.completed = completed
            row.updated_at = incoming
        applied += 1
    db.commit()
    return {"ok": True, "applied": applied, "skipped": len(items) - applied}
