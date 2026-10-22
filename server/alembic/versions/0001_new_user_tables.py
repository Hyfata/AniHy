"""create users, watch_history, bookmarks

신규 3개 테이블만 생성. 기존 6개 테이블은 레거시 sql/이 관리하므로 여기서 만들지 않는다.

Revision ID: 0001_new_user_tables
Revises:
Create Date: 2026-10-21
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

revision = "0001_new_user_tables"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer, autoincrement=True, primary_key=True),
        sa.Column("external_sub", sa.String(255), nullable=False, unique=True),
        sa.Column("display_name", sa.String(255), nullable=True),
        sa.Column("is_admin", mysql.TINYINT, nullable=False, server_default="0"),
        sa.Column("created_at", mysql.TIMESTAMP, server_default=sa.func.now()),
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
    )
    op.create_table(
        "watch_history",
        sa.Column("id", sa.Integer, autoincrement=True, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("anime_id", sa.Integer, sa.ForeignKey("animes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("episode_number", sa.String(50), nullable=False),
        sa.Column("position_ms", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("duration_ms", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("completed", mysql.TINYINT, nullable=False, server_default="0"),
        sa.Column("updated_at", mysql.TIMESTAMP, server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.UniqueConstraint("user_id", "anime_id", "episode_number", name="uq_history_user_ep"),
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
    )
    op.create_table(
        "bookmarks",
        sa.Column("id", sa.Integer, autoincrement=True, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("anime_id", sa.Integer, sa.ForeignKey("animes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", mysql.TIMESTAMP, server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "anime_id", name="uq_bookmark_user_anime"),
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
    )


def downgrade() -> None:
    op.drop_table("bookmarks")
    op.drop_table("watch_history")
    op.drop_table("users")
