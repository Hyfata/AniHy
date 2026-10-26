"""User profile API — login required. Identity fields expose login-provisioned values read-only."""
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.security import Identity, require_access, require_login
from ..models import User, WatchHistory

router = APIRouter(prefix="/users", tags=["users"], dependencies=[Depends(require_access)])


@router.get("/me")
def me(
    identity: Identity = Depends(require_login),
    db: Session = Depends(get_db),
):
    """Profile modal payload: display_name, created_at, and watch stats.

    total_watch_ms approximates watch time as the sum of per-episode final
    positions (not cumulative rewatch time).
    """
    user = db.get(User, identity.user_id)
    total_ms, watched, completed = db.execute(
        select(
            func.coalesce(func.sum(WatchHistory.position_ms), 0),
            func.count(),
            func.coalesce(func.sum(WatchHistory.completed), 0),
        ).where(WatchHistory.user_id == identity.user_id)
    ).one()
    return {
        "display_name": user.display_name if user else None,
        "created_at": user.created_at.isoformat() if user and user.created_at else None,
        "total_watch_ms": int(total_ms),
        "watched_episodes": int(watched),
        "completed_episodes": int(completed),
    }
