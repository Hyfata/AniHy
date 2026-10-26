"""AniHy FastAPI 엔트리.

실행: server/.venv/bin/uvicorn server.main:app --reload (프로젝트 루트에서)
"""
from fastapi import APIRouter, Depends, FastAPI

from .core.security import require_access
from .routers import auth

app = FastAPI(title="AniHy API", docs_url="/api/docs", openapi_url="/api/openapi.json")


@app.middleware("http")
async def no_store_api(request, call_next):
    """JSON API 응답은 캐시 금지 — iOS Safari가 Cache-Control 없는 응답(특히 302)을
    휴리스틱 디스크 캐시에 저장해 이후 요청을 네트워크 없이 오래된 HTML로 응답하는 사고 방지.
    미디어(/api/files/*)는 예외 — 커버/영상은 캐시돼야 한다."""
    response = await call_next(request)
    if request.url.path.startswith("/api") and not request.url.path.startswith("/api/files"):
        response.headers["Cache-Control"] = "no-store"
    return response

api = APIRouter(prefix="/api")
api.include_router(auth.router)

# 읽기/라이브러리 라우터 (animes/search/history/bookmarks) — downloads 라우터는 별도 에이전트가 등록
from .routers import animes, bookmarks, downloads, history, search, users  # noqa: E402

api.include_router(animes.router)
api.include_router(search.router)
api.include_router(history.router)
api.include_router(bookmarks.router)
api.include_router(users.router)
api.include_router(downloads.router)

# 잡 파이프라인/관리자 라우터 (jobs/admin)
from .routers import admin, jobs  # noqa: E402

api.include_router(jobs.router)
api.include_router(admin.router)


@api.get("/health")
def health():
    return {"ok": True}


# 게이트 통과 확인용 예시 (이후 라우터들도 dependencies=[Depends(require_access)]로 보호)
@api.get("/gate-check", dependencies=[Depends(require_access)])
def gate_check():
    return {"ok": True}


app.include_router(api)
