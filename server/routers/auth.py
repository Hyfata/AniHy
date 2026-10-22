"""인증 라우터: 접근 게이트 + Keycloak OIDC 로그인 플로우."""
import secrets
from urllib.parse import urlsplit

import httpx
from authlib.jose import jwt as jose_jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import Settings, get_settings
from ..core.db import get_db
from ..core.security import (
    Identity,
    clear_session_cookie,
    fetch_oidc_metadata,
    get_current_identity,
    issue_access_cookie,
    issue_session_cookie,
    oidc_client,
    verify_access_code,
    extract_is_admin,
    _cookie_secret,
)
from ..models import User

router = APIRouter(prefix="/auth", tags=["auth"])

# OIDC state/nonce/code_verifier를 담는 단기 서명 쿠키 (스테이트리스)
OIDC_STATE_COOKIE = "anihy_oidc_state"


class GateBody(BaseModel):
    code: str


@router.post("/gate")
def gate(
    body: GateBody,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """접근 코드 검증 후 anihy_access 쿠키 발급 (기존 auth_gate.php)."""
    if not verify_access_code(body.code, db, settings):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="접근 코드가 올바르지 않습니다")
    secret = _cookie_secret(settings, db)
    issue_access_cookie(response, secret)
    return {"ok": True}


@router.get("/login")
async def login(request: Request, settings: Settings = Depends(get_settings)):
    """Keycloak authorize URL로 리다이렉트 (Authorization Code + PKCE)."""
    if not settings.keycloak_configured:
        return JSONResponse(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            content={
                "detail": "Keycloak이 아직 설정되지 않았습니다. "
                "server/.env의 KEYCLOAK_ISSUER/CLIENT_ID/CLIENT_SECRET을 입력하세요."
            },
        )
    meta = await fetch_oidc_metadata(settings)
    client = oidc_client(settings)
    state = secrets.token_urlsafe(16)
    nonce = secrets.token_urlsafe(16)
    # authlib 1.9+: code_verifier를 명시적으로 넘겨야 S256 챌린지가 생성됨
    code_verifier = secrets.token_urlsafe(64)
    auth_result = client.create_authorization_url(
        meta["authorization_endpoint"],
        state=state,
        nonce=nonce,
        code_verifier=code_verifier,
    )
    # authlib은 (authorization_url, state)를 반환 — code_verifier는 위에서 생성한 값 사용
    if isinstance(auth_result, tuple):
        auth_url = auth_result[0]
    else:
        auth_url = auth_result["url"]
    resp = RedirectResponse(auth_url, status_code=status.HTTP_302_FOUND)
    resp.set_cookie(
        OIDC_STATE_COOKIE,
        f"{state}|{nonce}|{code_verifier}",
        max_age=600,
        path="/",
        httponly=True,
        samesite="lax",
    )
    return resp


@router.get("/callback")
async def callback(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """code 교환 → users JIT 프로비저닝 → anihy_session 발급 → / 리다이렉트."""
    if not settings.keycloak_configured:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Keycloak 미설정")

    state_cookie = request.cookies.get(OIDC_STATE_COOKIE)
    if not state_cookie:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OIDC state 누락")
    try:
        state, nonce, code_verifier = state_cookie.split("|", 2)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OIDC state 형식 오류")
    if request.query_params.get("state") != state:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OIDC state 불일치")

    meta = await fetch_oidc_metadata(settings)
    client = oidc_client(settings)
    token = await client.fetch_token(
        meta["token_endpoint"],
        authorization_response=str(request.url),
        code_verifier=code_verifier or None,
        state=state,
    )

    # ID 토큰 검증 (JWKS) — authlib가 서명/iss/aud 검증, validate()가 exp 등 검증
    async with httpx.AsyncClient(timeout=10) as http:
        jwks_resp = await http.get(meta["jwks_uri"])
        jwks_resp.raise_for_status()
    claims = jose_jwt.decode(
        token["id_token"],
        jwks_resp.json(),
        claims_options={
            "iss": {"essential": True, "value": meta["issuer"]},
            "aud": {"essential": True, "value": settings.keycloak_client_id},
        },
    )
    claims.validate()
    if nonce and claims.get("nonce") not in (None, nonce):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OIDC nonce 불일치")

    sub = claims.get("sub")
    if not sub:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ID 토큰에 sub 없음")

    is_admin = extract_is_admin(claims)
    # Keycloak은 realm_access(role)를 보통 액세스 토큰에만 넣는다 — ID 토큰에 없으면 액세스 토큰 확인
    if not is_admin and token.get("access_token"):
        try:
            access_claims = jose_jwt.decode(
                token["access_token"],
                jwks_resp.json(),
                claims_options={"iss": {"essential": True, "value": meta["issuer"]}},
            )
            access_claims.validate()
            is_admin = extract_is_admin(access_claims)
        except Exception:
            pass
    display_name = claims.get("preferred_username") or claims.get("name") or claims.get("email")

    # JIT 프로비저닝
    user = db.execute(select(User).where(User.external_sub == sub)).scalar_one_or_none()
    if user is None:
        user = User(external_sub=sub, display_name=display_name, is_admin=is_admin)
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        changed = False
        if user.is_admin != is_admin:
            user.is_admin = is_admin
            changed = True
        if display_name and user.display_name != display_name:
            user.display_name = display_name
            changed = True
        if changed:
            db.commit()

    secret = _cookie_secret(settings, db)
    # 콜백 후 SPA 기본 경로로 복귀 (서브경로 배포 대응: REDIRECT_URI에서 /api/auth/callback 제거)
    base_path = urlsplit(settings.keycloak_redirect_uri).path
    for suffix in ("/api/auth/callback",):
        if base_path.endswith(suffix):
            base_path = base_path[: -len(suffix)]
            break
    else:
        base_path = ""
    resp = RedirectResponse(base_path + "/", status_code=status.HTTP_302_FOUND)
    issue_session_cookie(resp, secret, user.id, is_admin)
    resp.delete_cookie(OIDC_STATE_COOKIE, path="/")
    return resp


@router.post("/logout")
def logout(response: Response):
    clear_session_cookie(response)
    return {"ok": True}


@router.get("/me")
def me(identity: Identity = Depends(get_current_identity)):
    return {"user_id": identity.user_id, "is_admin": identity.is_admin, "logged_in": identity.logged_in}
