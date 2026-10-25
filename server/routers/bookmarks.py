"""북마크 API — 보관함 북마크 탭. 로그인 필수, 계정 단위."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.security import Identity, require_access
from ..models import Anime, Bookmark
from ..services import urls
from .animes import _latest_episode_map
from .history import require_login

router = APIRouter(prefix="/bookmarks", tags=["bookmarks"], dependencies=[Depends(require_access)])


@router.post("/{anime_id}")
def add_bookmark(
    anime_id: int,
    db: Session = Depends(get_db),
    identity: Identity = Depends(require_login),
):
    if db.get(Anime, anime_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="애니를 찾을 수 없습니다")
    exists = db.execute(
        select(func.count()).select_from(Bookmark).where(
            Bookmark.user_id == identity.user_id, Bookmark.anime_id == anime_id
        )
    ).scalar() > 0
    if not exists:
        db.add(Bookmark(user_id=identity.user_id, anime_id=anime_id))
        db.commit()
    return {"ok": True, "bookmarked": True}


@router.delete("/{anime_id}")
def remove_bookmark(
    anime_id: int,
    db: Session = Depends(get_db),
    identity: Identity = Depends(require_login),
):
    db.execute(
        delete(Bookmark).where(Bookmark.user_id == identity.user_id, Bookmark.anime_id == anime_id)
    )
    db.commit()
    return {"ok": True, "bookmarked": False}


@router.get("")
def list_bookmarks(
    db: Session = Depends(get_db),
    identity: Identity = Depends(require_login),
):
    rows = db.execute(
        select(Anime, Bookmark.created_at)
        .join(Bookmark, Bookmark.anime_id == Anime.id)
        .where(Bookmark.user_id == identity.user_id)
        .order_by(Bookmark.created_at.desc())
    ).all()
    latest_map = _latest_episode_map(db, [a.id for a, _ in rows])
    return {
        "bookmarks": [
            {
                "id": a.id,
                "title": a.title,
                "cover": urls.cover_url(a.cover_image),
                "bookmarked_at": ts.isoformat() if ts else None,
                "latest_episode_at": latest_map[a.id].isoformat() if latest_map.get(a.id) else None,
            }
            for a, ts in rows
        ]
    }
