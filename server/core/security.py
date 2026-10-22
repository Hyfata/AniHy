"""인증 2층 구조 (기존 inc/access_auth.php + 관리자 세션 포팅).

1층: 접근 코드 게이트 — anihy_access 서명 쿠키 (UUID + HMAC-SHA256, 10년)
2층: Keycloak OIDC 로그인 — anihy_session 서명 쿠키 (user_id + is_admin)

하드 규약 (plan §6): 다운로드 API 인증 실패 시 302 리다이렉트가 아니라 **401**을 반환해야 한다
(302로 별낼 경우 fetch 클라이언트가 로그인 HTML을 mp4로 저장하는 사고 방지 — api/download_episode.php 선례).
이 모듈의 require_* 의존성은 전부 401을 던진다. 다운로드/스트리밍 라우터에서도 동일 규약 유지할 것.
"""
import hashlib
import hmac
import uuid
from dataclasses import dataclass

import httpx
from authlib.integrations.httpx_client import AsyncOAuth2Client
from fastapi import Depends, HTTPException, Request, Response, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import Settings, get_settings
from .db import get_db
from ..models import Setting

ACCESS_COOKIE_NAME = "anihy_access"
SESSION_COOKIE_NAME = "anihy_session"
COOKIE_PATH = "/"
ACCESS_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 10  # 10년 (PHP 동일)
SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 30  # 30일

_session_serializer: URLSafeTimedSerializer | None = None


def _serializer(secret: str) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(secret, salt="anihy-session")


# ---------- settings 테이블 헬퍼 (inc/access_auth.php: getSetting) ----------


def get_setting(db: Session, key: str) -> str | None:
    row = db.execute(select(Setting.value).where(Setting.key == key)).first()
    return row[0] if row else None


def _cookie_secret(settings: Settings, db: Session | None) -> str:
    # .env 우선, 플레이스홀더면 settings 테이블 cookie_secret 폴리백
    if settings.cookie_secret and settings.cookie_secret != "REPLACE_WITH_A_RANDOM_SECRET":
        return settings.cookie_secret
    if db is not None:
        db_secret = get_setting(db, "cookie_secret")
        if db_secret and db_secret != "REPLACE_WITH_A_RANDOM_SECRET":
            return db_secret
    return settings.cookie_secret


# ---------- 1층: 접근 코드 게이트 ----------


def verify_access_code(code: str, db: Session, settings: Settings) -> bool:
    expected = get_setting(db, "access_code") or settings.access_code_fallback
    if not expected:
        return False
    return hmac.compare_digest(expected, code)


def sign_access_token(value: str, secret: str) -> str:
    return hmac.new(secret.encode(), value.encode(), hashlib.sha256).hexdigest()


def issue_access_cookie(response: Response, secret: str, secure: bool = False) -> str:
    token_uuid = str(uuid.uuid4())
    value = f"{token_uuid}.{sign_access_token(token_uuid, secret)}"
    response.set_cookie(
        ACCESS_COOKIE_NAME,
        value,
        max_age=ACCESS_COOKIE_MAX_AGE,
        path=COOKIE_PATH,
        secure=secure,
        httponly=True,
        samesite="lax",
    )
    return value


def validate_access_cookie(cookie_value: str | None, secret: str) -> bool:
    if not cookie_value:
        return False
    parts = cookie_value.split(".")
    if len(parts) != 2:
        return False
    token_uuid, signature = parts
    try:
        parsed = uuid.UUID(token_uuid)
    except ValueError:
        return False
    if parsed.version != 4:
        return False
    if len(signature) != 64:
        return False
    return hmac.compare_digest(sign_access_token(token_uuid, secret), signature)


def clear_access_cookie(response: Response) -> None:
    response.delete_cookie(ACCESS_COOKIE_NAME, path=COOKIE_PATH)


# ---------- 2층: 세션 쿠키 / Identity ----------


@dataclass(frozen=True)
class Identity:
    user_id: int | None
    is_admin: bool

    @property
    def logged_in(self) -> bool:
        return self.user_id is not None


def issue_session_cookie(
    response: Response, secret: str, user_id: int, is_admin: bool, secure: bool = False
) -> str:
    value = _serializer(secret).dumps({"uid": user_id, "adm": bool(is_admin)})
    response.set_cookie(
        SESSION_COOKIE_NAME,
        value,
        max_age=SESSION_COOKIE_MAX_AGE,
        path=COOKIE_PATH,
        secure=secure,
        httponly=True,
        samesite="lax",
    )
    return value


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE_NAME, path=COOKIE_PATH)


def read_session_cookie(cookie_value: str | None, secret: str) -> Identity:
    if not cookie_value:
        return Identity(user_id=None, is_admin=False)
    try:
        data = _serializer(secret).loads(cookie_value, max_age=SESSION_COOKIE_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return Identity(user_id=None, is_admin=False)
    uid = data.get("uid")
    if not isinstance(uid, int):
        return Identity(user_id=None, is_admin=False)
    return Identity(user_id=uid, is_admin=bool(data.get("adm")))


# ---------- FastAPI 의존성 ----------


def require_access(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> None:
    """접근 게이트. 실패 시 401 (302 금지 — 상단 하드 규약 참조)."""
    secret = _cookie_secret(settings, db)
    if not validate_access_cookie(request.cookies.get(ACCESS_COOKIE_NAME), secret):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="접근 인증이 필요합니다")


def get_current_identity(request: Request, settings: Settings = Depends(get_settings)) -> Identity:
    secret = _cookie_secret(settings, None)
    return read_session_cookie(request.cookies.get(SESSION_COOKIE_NAME), secret)


def require_admin(identity: Identity = Depends(get_current_identity)) -> Identity:
    if not identity.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="관리자 권한이 필요합니다")
    return identity


# ---------- OIDC (Keycloak, authlib) ----------


def extract_is_admin(claims: dict) -> bool:
    """Keycloak realm role 'admin' 판정. 클레임 부재 시 graceful하게 False."""
    realm_access = claims.get("realm_access")
    if not isinstance(realm_access, dict):
        return False
    roles = realm_access.get("roles")
    if not isinstance(roles, list):
        return False
    return "admin" in roles


def oidc_client(settings: Settings) -> AsyncOAuth2Client:
    """Authorization Code Flow + PKCE용 authlib 클라이언트."""
    client = AsyncOAuth2Client(
        client_id=settings.keycloak_client_id,
        client_secret=settings.keycloak_client_secret or None,
        redirect_uri=settings.keycloak_redirect_uri,
        scope="openid profile email",
    )
    client.code_challenge_method = "S256"
    return client


_oidc_meta_cache: dict | None = None


async def fetch_oidc_metadata(settings: Settings) -> dict:
    """issuer의 .well-known/openid-configuration 조회 (간단 캐시)."""
    global _oidc_meta_cache
    if _oidc_meta_cache is not None:
        return _oidc_meta_cache
    url = settings.keycloak_issuer.rstrip("/") + "/.well-known/openid-configuration"
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        _oidc_meta_cache = resp.json()
    return _oidc_meta_cache
