"""기존 6개 테이블(sql/init.sql)을 정확히 미러링한 모델 + 신규 users/watch_history/bookmarks.

기존 테이블은 sql/init.sql이 관리하므로 Alembic 마이그레이션 대상이 아님(메타 미러링만).
신규 3개 테이블만 alembic이 생성한다.
"""
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    TIMESTAMP,
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.mysql import INTEGER as MYSQL_INTEGER
from sqlalchemy.dialects.mysql import TINYINT
from sqlalchemy.orm import Mapped, mapped_column

from .core.db import Base


class Anime(Base):
    __tablename__ = "animes"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(255))
    cover_image: Mapped[str] = mapped_column(String(500))
    description: Mapped[str | None] = mapped_column(Text)
    season_id: Mapped[str | None] = mapped_column(String(100))
    is_hidive: Mapped[bool] = mapped_column(Boolean, default=False)
    broadcast_year: Mapped[int | None] = mapped_column(Integer)
    broadcast_quarter: Mapped[int | None] = mapped_column(TINYINT)
    broadcast_day: Mapped[str | None] = mapped_column(String(10))
    download_url: Mapped[str | None] = mapped_column(String(500))
    namuwiki_url: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=func.now())


class AnimeBroadcast(Base):
    __tablename__ = "anime_broadcasts"
    __table_args__ = (
        UniqueConstraint("anime_id", "broadcast_year", "broadcast_quarter", name="unique_broadcast"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    anime_id: Mapped[int] = mapped_column(ForeignKey("animes.id", ondelete="CASCADE"))
    broadcast_year: Mapped[int] = mapped_column(Integer)
    broadcast_quarter: Mapped[int] = mapped_column(TINYINT)


class Episode(Base):
    __tablename__ = "episodes"
    __table_args__ = (
        UniqueConstraint("anime_id", "episode_number", name="unique_episode"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    anime_id: Mapped[int] = mapped_column(ForeignKey("animes.id", ondelete="CASCADE"))
    episode_number: Mapped[str] = mapped_column(String(50))  # '0.5', 'OVA' 허용
    title: Mapped[str | None] = mapped_column(String(255))
    file_path: Mapped[str] = mapped_column(String(500))
    duration_ms: Mapped[int | None] = mapped_column(MYSQL_INTEGER(unsigned=True))
    has_subtitle: Mapped[bool] = mapped_column(Boolean, default=False)
    en_subtitle_file: Mapped[str | None] = mapped_column(String(500))
    subtitle_file: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=func.now())


JOB_STATUSES = (
    "pending", "downloading", "downloading_subs", "preparing",
    "encoding", "remuxing", "subtitling", "completed", "failed",
)
JOB_SOURCE_TYPES = ("download", "upload", "server")


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    anime_id: Mapped[int] = mapped_column(ForeignKey("animes.id", ondelete="CASCADE"))
    episode_number: Mapped[str] = mapped_column(String(50))
    season_id: Mapped[str] = mapped_column(String(100))
    episode_title: Mapped[str | None] = mapped_column(String(255))
    subtitle_file: Mapped[str | None] = mapped_column(String(500))
    trim_seconds: Mapped[Decimal] = mapped_column(Numeric(10, 3), default=0)
    subtitle_offset: Mapped[Decimal] = mapped_column(Numeric(10, 3), default=0)
    is_test: Mapped[bool] = mapped_column(TINYINT(1), default=0)
    source_type: Mapped[str] = mapped_column(
        Enum(*JOB_SOURCE_TYPES, name="source_type"), default="download"
    )
    source_file: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(Enum(*JOB_STATUSES, name="status"), default="pending")
    message: Mapped[str | None] = mapped_column(Text)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    worker_pid: Mapped[int | None] = mapped_column(Integer)
    encoder: Mapped[str | None] = mapped_column(String(20))
    source_name: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP, server_default=func.now(), onupdate=func.now()
    )


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP, server_default=func.now(), onupdate=func.now()
    )


class SearchHit(Base):
    __tablename__ = "search_hits"

    anime_id: Mapped[int] = mapped_column(
        ForeignKey("animes.id", ondelete="CASCADE"), primary_key=True
    )
    hit_count: Mapped[int] = mapped_column(Integer, default=1)
    last_hit_at: Mapped[datetime] = mapped_column(DateTime)


# ---------- 신규 테이블 (Alembic 마이그레이션 대상) ----------


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    external_sub: Mapped[str] = mapped_column(String(255), unique=True)  # Keycloak sub
    display_name: Mapped[str | None] = mapped_column(String(255))
    is_admin: Mapped[bool] = mapped_column(TINYINT, default=0)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=func.now())


class WatchHistory(Base):
    __tablename__ = "watch_history"
    __table_args__ = (
        UniqueConstraint("user_id", "anime_id", "episode_number", name="uq_history_user_ep"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    anime_id: Mapped[int] = mapped_column(ForeignKey("animes.id", ondelete="CASCADE"))
    episode_number: Mapped[str] = mapped_column(String(50))
    position_ms: Mapped[int] = mapped_column(BigInteger, default=0)
    duration_ms: Mapped[int] = mapped_column(BigInteger, default=0)
    completed: Mapped[bool] = mapped_column(TINYINT, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP, server_default=func.now(), onupdate=func.now()
    )


class Bookmark(Base):
    __tablename__ = "bookmarks"
    __table_args__ = (
        UniqueConstraint("user_id", "anime_id", name="uq_bookmark_user_anime"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    anime_id: Mapped[int] = mapped_column(ForeignKey("animes.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=func.now())
