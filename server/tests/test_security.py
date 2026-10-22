"""접근코드 쿠키 + Identity 의존성 테스트 (MySQL 없이 sqlite 인메모리로 self-contained)."""
import uuid

import pytest
from fastapi import Depends, FastAPI, Response
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from server.core.config import Settings
from server.core.db import Base, get_db
from server.core.security import (
    ACCESS_COOKIE_NAME,
    SESSION_COOKIE_NAME,
    Identity,
    get_current_identity,
    get_setting,
    issue_access_cookie,
    issue_session_cookie,
    read_session_cookie,
    require_access,
    sign_access_token,
    validate_access_cookie,
    verify_access_code,
    extract_is_admin,
)
from server.models import Setting

TEST_SECRET = "test-secret-for-pytest-only"


@pytest.fixture()
def db_session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine, tables=[Setting.__table__])
    session_factory = sessionmaker(bind=engine, expire_on_commit=False, class_=Session)
    session = session_factory()
    session.add_all([
        Setting(key="access_code", value="1234"),
        Setting(key="cookie_secret", value=TEST_SECRET),
    ])
    session.commit()
    yield session
    session.close()


@pytest.fixture()
def settings():
    return Settings(cookie_secret=TEST_SECRET, db_url="sqlite://")


# ---------- 순수 함수 테스트 ----------


def test_access_cookie_issue_and_validate_roundtrip():
    response = Response()
    value = issue_access_cookie(response, TEST_SECRET)
    token_uuid, signature = value.split(".")
    # PHP 규약과 동일: v4 UUID + 64자 hex HMAC-SHA256
    assert uuid.UUID(token_uuid).version == 4
    assert len(signature) == 64
    assert validate_access_cookie(value, TEST_SECRET)


def test_access_cookie_wrong_secret_rejected():
    response = Response()
    value = issue_access_cookie(response, TEST_SECRET)
    assert not validate_access_cookie(value, "other-secret")


@pytest.mark.parametrize("bad", [
    "",
    "not-a-token",
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa." + "0" * 63,  # 서명 길이 오류
    "zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz." + "0" * 64,  # UUID 형식 오류
])
def test_access_cookie_malformed_rejected(bad):
    assert not validate_access_cookie(bad, TEST_SECRET)


def test_sign_access_token_is_hmac_sha256():
    import hashlib
    import hmac

    expected = hmac.new(b"s", b"u", hashlib.sha256).hexdigest()
    assert sign_access_token("u", "s") == expected


def test_verify_access_code_against_db(db_session, settings):
    assert verify_access_code("1234", db_session, settings)
    assert not verify_access_code("0000", db_session, settings)


def test_verify_access_code_fallback_when_db_missing(db_session):
    # DB에 access_code가 없으면 폴리백 사용
    no_code_settings = Settings(
        cookie_secret=TEST_SECRET, db_url="sqlite://", access_code_fallback="9999"
    )
    db_session.query(Setting).filter(Setting.key == "access_code").delete()
    db_session.commit()
    assert verify_access_code("9999", db_session, no_code_settings)
    assert not verify_access_code("1234", db_session, no_code_settings)


def test_get_setting(db_session):
    assert get_setting(db_session, "access_code") == "1234"
    assert get_setting(db_session, "no-such-key") is None


# ---------- 세션 / Identity ----------


def test_session_cookie_roundtrip():
    response = Response()
    value = issue_session_cookie(response, TEST_SECRET, user_id=42, is_admin=True)
    identity = read_session_cookie(value, TEST_SECRET)
    assert identity == Identity(user_id=42, is_admin=True)
    assert identity.logged_in


def test_session_cookie_tampered_or_missing():
    assert read_session_cookie(None, TEST_SECRET) == Identity(user_id=None, is_admin=False)
    assert read_session_cookie("garbage.value", TEST_SECRET) == Identity(user_id=None, is_admin=False)
    response = Response()
    value = issue_session_cookie(response, TEST_SECRET, 1, False)
    assert read_session_cookie(value, "wrong-secret") == Identity(user_id=None, is_admin=False)


def test_extract_is_admin_graceful():
    assert extract_is_admin({"realm_access": {"roles": ["admin", "user"]}})
    assert not extract_is_admin({"realm_access": {"roles": ["user"]}})
    assert not extract_is_admin({"realm_access": {}})
    assert not extract_is_admin({})


# ---------- FastAPI 의존성 통합 ----------


@pytest.fixture()
def client(db_session, settings):
    from server.core.config import get_settings

    app = FastAPI()

    @app.get("/protected", dependencies=[Depends(require_access)])
    def protected():
        return {"ok": True}

    @app.get("/identity")
    def identity(identity: Identity = Depends(get_current_identity)):
        return {"user_id": identity.user_id, "is_admin": identity.is_admin}

    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_settings] = lambda: settings
    return TestClient(app)


def test_require_access_rejects_without_cookie(client):
    resp = client.get("/protected")
    assert resp.status_code == 401  # 302 금지 규약


def test_require_access_accepts_valid_cookie(client):
    response = Response()
    value = issue_access_cookie(response, TEST_SECRET)
    resp = client.get("/protected", cookies={ACCESS_COOKIE_NAME: value})
    assert resp.status_code == 200


def test_identity_dependency_anonymous(client):
    resp = client.get("/identity")
    assert resp.json() == {"user_id": None, "is_admin": False}


def test_identity_dependency_logged_in(client):
    response = Response()
    value = issue_session_cookie(response, TEST_SECRET, 7, True)
    resp = client.get("/identity", cookies={SESSION_COOKIE_NAME: value})
    assert resp.json() == {"user_id": 7, "is_admin": True}
