"""Alembic env — DB URL은 server/.env(Settings)에서 읽는다.

주의: 기존 6개 테이블(animes, anime_broadcasts, episodes, jobs, settings, search_hits)은
sql/init.sql이 관리하므로 Alembic 마이그레이션 대상이 아니다.
신규 DB에 적용할 때는 sql/init.sql를 먼저 적용한 뒤 `alembic stamp head`가 아니라
정상적으로 `alembic upgrade head`를 실행해 신규 3개 테이블(users, watch_history, bookmarks)을 생성하면 된다.
(레거시 테이블을 이미 갖고 있는 DB에도 upgrade head만 실행하면 된다.)
"""
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

# 프로젝트 루트를 sys.path에 추가해 server 패키지 import 가능하게
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from server.core.config import get_settings  # noqa: E402
from server.core.db import Base  # noqa: E402
from server import models  # noqa: E402,F401 — 메타데이터 등록

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# configparser는 %를 interpolation으로 인식하므로 이스케이프 필요 (비번에 % 포함 시)
config.set_main_option("sqlalchemy.url", get_settings().db_url.replace("%", "%%"))
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
