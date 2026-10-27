"""seed new_badge_days setting

Legacy settings 테이블에 키-값 행만 추가하는 데이터 시드 (스키마 변경 없음).
기존 행이 있으면 값을 덮어쓰지 않는다 (ON DUPLICATE KEY UPDATE value=value).

Revision ID: 0002_new_badge_days_setting
Revises: 0001_new_user_tables
Create Date: 2026-10-27
"""
from alembic import op

revision = "0002_new_badge_days_setting"
down_revision = "0001_new_user_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "INSERT INTO settings (`key`, `value`) VALUES ('new_badge_days', '3') "
        "ON DUPLICATE KEY UPDATE `value` = `value`"
    )


def downgrade() -> None:
    op.execute("DELETE FROM settings WHERE `key` = 'new_badge_days'")
