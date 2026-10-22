"""테스트 공용 픽스처 — sqlite 인메모리 + MySQL 전용 타입 shim + FastAPI 클라이언트."""
import os

# 로컬 server/.env(예: PUBLIC_FILES_PREFIX=/anime-test/api/files)가 테스트 결과를
# 좌우하지 않도록 고정 — 환경변수는 .env보다 우선한다.
os.environ["PUBLIC_FILES_PREFIX"] = "/api/files"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.dialects.mysql import INTEGER as MYSQL_INTEGER
from sqlalchemy.dialects.mysql import TINYINT
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from server.core.db import Base, get_db
from server.core.security import Identity, get_current_identity, require_access
from server.main import app
from server.models import Anime, User


# MySQL 전용 타입을 sqlite에서 생성 가능하도록 shim (테스트 전용)
@compiles(TINYINT, "sqlite")
def _tinyint_sqlite(element, compiler, **kw):
    return "INTEGER"


@compiles(MYSQL_INTEGER, "sqlite")
def _mysql_int_sqlite(element, compiler, **kw):
    return "INTEGER"


ALL_TABLES = [t for t in Base.metadata.sorted_tables]


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine, tables=ALL_TABLES)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    yield session
    session.close()


@pytest.fixture()
def seed_animes(db_session):
    rows = [
        Anime(id=1, title="Spy x Family", cover_image="spy.jpg"),
        Anime(id=2, title="스파이 패밀리", cover_image="spyko.jpg"),
        Anime(id=3, title="Re:제로부터 시작하는 이세계 생활", cover_image="rezero.jpg"),
        Anime(id=4, title="진격의 거인", cover_image="titan.jpg"),
    ]
    db_session.add_all(rows)
    db_session.commit()
    return rows


def make_client(db_session, identity: Identity):
    def odb():
        yield db_session

    app.dependency_overrides[get_db] = odb
    app.dependency_overrides[require_access] = lambda: None
    app.dependency_overrides[get_current_identity] = lambda: identity
    client = TestClient(app)
    yield_client = client
    try:
        yield yield_client
    finally:
        app.dependency_overrides.clear()


@pytest.fixture()
def anon_client(db_session):
    yield from make_client(db_session, Identity(user_id=None, is_admin=False))


@pytest.fixture()
def user_client(db_session):
    db_session.add(User(id=1, external_sub="kc-sub-1", display_name="tester", is_admin=0))
    db_session.commit()
    yield from make_client(db_session, Identity(user_id=1, is_admin=False))
