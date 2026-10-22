"""관리자 API — api/add_anime.php, update_anime.php, delete_anime.php,
update_episode.php, delete_episode.php, admin/access_code.php,
api/search.php(aniDL 검색), api/episode_lookup_stream.php(SSE) 포팅.
"""
import asyncio
import uuid
from pathlib import Path

from fastapi import (
    APIRouter, Depends, Form, HTTPException, UploadFile, status,
)
from fastapi.responses import PlainTextResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..core.config import Settings, get_settings
from ..core.db import get_db
from ..core.security import require_access, require_admin, get_setting
from ..models import Anime, AnimeBroadcast, Episode, Setting
from ..services import files as fs

router = APIRouter(tags=["admin"], dependencies=[Depends(require_access), Depends(require_admin)])

ALLOWED_IMAGE_EXTS = {"jpg", "jpeg", "png", "webp", "gif"}
BROADCAST_DAYS = ["월", "화", "수", "목", "금", "토", "일"]


# ---------- 방영 분기 (inc/functions.php parseBroadcastPairs/saveBroadcastPairs 포팅) ----------


def parse_broadcast_pairs(years: list[str], quarters: list[str]) -> list[list[int]]:
    pairs: dict[str, list[int]] = {}
    for i in range(max(len(years), len(quarters))):
        try:
            y = int(years[i]) if i < len(years) else None
            q = int(quarters[i]) if i < len(quarters) else None
        except (ValueError, TypeError):
            continue
        if y is None or not 1900 <= y <= 2100 or q not in (1, 2, 3, 4):
            continue
        pairs[f"{y}-{q}"] = [y, q]
    return sorted(pairs.values())


def save_broadcast_pairs(db: Session, anime_id: int, pairs: list[list[int]]) -> None:
    """anime_broadcasts 교체 저장 + animes.broadcast_year/quarter 첫 분기 미러."""
    db.execute(delete(AnimeBroadcast).where(AnimeBroadcast.anime_id == anime_id))
    for y, q in pairs:
        db.add(AnimeBroadcast(anime_id=anime_id, broadcast_year=y, broadcast_quarter=q))
    anime = db.get(Anime, anime_id)
    first = pairs[0] if pairs else [None, None]
    anime.broadcast_year = first[0]
    anime.broadcast_quarter = first[1]


def _validate_day(day: str) -> str | None:
    return day if day in BROADCAST_DAYS else None


def _save_cover(cover: UploadFile, base_dir: Path, content: bytes) -> str:
    ext = cover.filename.rsplit(".", 1)[-1].lower() if cover.filename and "." in cover.filename else ""
    if ext not in ALLOWED_IMAGE_EXTS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "지원하지 않는 이미지 형식입니다.")
    filename = f"cover_{uuid.uuid4().hex[:13]}.{ext}"
    dest = base_dir / "covers" / filename
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(content)
    return filename


# ---------- 애니 CRUD ----------


@router.post("/admin/animes")
async def create_anime(
    title: str = Form(...),
    description: str = Form(""),
    season_id: str = Form(""),
    is_hidive: str = Form(""),
    broadcast_day: str = Form(""),
    download_url: str = Form(""),
    namuwiki_url: str = Form(""),
    broadcast_year: list[str] = Form([]),
    broadcast_quarter: list[str] = Form([]),
    cover: UploadFile | None = None,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    title = title.strip()
    if not title:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "제목을 입력하세요.")
    if cover is None or not cover.filename:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "커버 이미지를 업로드하세요.")
    filename = _save_cover(cover, settings.base_dir, await cover.read())

    pairs = parse_broadcast_pairs(broadcast_year, broadcast_quarter)
    first = pairs[0] if pairs else [None, None]
    anime = Anime(
        title=title, cover_image=filename, description=description.strip(),
        season_id=season_id.strip() or None, is_hidive=bool(is_hidive),
        broadcast_year=first[0], broadcast_quarter=first[1],
        broadcast_day=_validate_day(broadcast_day.strip()),
        download_url=download_url.strip() or None, namuwiki_url=namuwiki_url.strip() or None,
    )
    db.add(anime)
    db.flush()
    save_broadcast_pairs(db, anime.id, pairs)
    db.commit()
    return {"ok": True, "id": anime.id, "message": "애니가 추가되었습니다."}


@router.put("/admin/animes/{anime_id}")
async def update_anime(
    anime_id: int,
    title: str = Form(...),
    description: str = Form(""),
    season_id: str = Form(""),
    is_hidive: str = Form(""),
    broadcast_day: str = Form(""),
    download_url: str = Form(""),
    namuwiki_url: str = Form(""),
    broadcast_year: list[str] = Form([]),
    broadcast_quarter: list[str] = Form([]),
    cover: UploadFile | None = None,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    anime = db.get(Anime, anime_id)
    if anime is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "애니를 찾을 수 없습니다.")
    title = title.strip()
    if not title:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "필수 항목을 입력하세요.")

    if cover is not None and cover.filename:
        new_name = _save_cover(cover, settings.base_dir, await cover.read())
        old = settings.base_dir / "covers" / anime.cover_image
        old.unlink(missing_ok=True)
        anime.cover_image = new_name

    pairs = parse_broadcast_pairs(broadcast_year, broadcast_quarter)
    first = pairs[0] if pairs else [None, None]
    anime.title = title
    anime.description = description.strip()
    anime.season_id = season_id.strip() or None
    anime.is_hidive = bool(is_hidive)
    anime.broadcast_year = first[0]
    anime.broadcast_quarter = first[1]
    anime.broadcast_day = _validate_day(broadcast_day.strip())
    anime.download_url = download_url.strip() or None
    anime.namuwiki_url = namuwiki_url.strip() or None
    db.flush()
    save_broadcast_pairs(db, anime_id, pairs)
    db.commit()
    return {"ok": True, "id": anime_id, "message": "애니 정보가 수정되었습니다."}


@router.delete("/admin/animes/{anime_id}")
def delete_anime(
    anime_id: int,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    anime = db.get(Anime, anime_id)
    if anime is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "애니를 찾을 수 없습니다.")

    base_dir = settings.base_dir
    episodes = db.execute(
        select(Episode.episode_number).where(Episode.anime_id == anime_id)
    ).scalars().all()
    for ep in episodes:
        (base_dir / "animes" / str(anime_id) / f"{ep}.mp4").unlink(missing_ok=True)
    # 남은 파일(썸네일/VTT 등)이 있으면 디렉터리는 남음 — PHP rmdir 동작과 동일
    try:
        (base_dir / "animes" / str(anime_id)).rmdir()
    except OSError:
        pass
    (base_dir / "covers" / anime.cover_image).unlink(missing_ok=True)

    db.delete(anime)  # FK CASCADE로 episodes/broadcasts 삭제
    db.commit()
    return {"ok": True, "message": "삭제되었습니다."}


# ---------- 에피소드 수정/삭제 ----------


class EpisodeTitleBody(BaseModel):
    title: str = ""


@router.put("/admin/episodes/{episode_id}")
def update_episode(episode_id: int, body: EpisodeTitleBody, db: Session = Depends(get_db)):
    ep = db.get(Episode, episode_id)
    if ep is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "에피소드를 찾을 수 없습니다.")
    ep.title = body.title.strip() or None
    db.commit()
    return {"ok": True, "id": episode_id, "title": body.title.strip(), "message": "에피소드 제목이 수정되었습니다."}


@router.delete("/admin/episodes/{episode_id}")
def delete_episode(
    episode_id: int,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    ep = db.get(Episode, episode_id)
    if ep is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "에피소드를 찾을 수 없습니다.")
    if ep.file_path:
        (settings.base_dir / ep.file_path).unlink(missing_ok=True)
    db.delete(ep)
    db.commit()
    return {"ok": True, "message": "삭제되었습니다."}


# ---------- 접근 코드 변경 ----------


class AccessCodeBody(BaseModel):
    access_code: str


@router.post("/admin/access-code")
def change_access_code(body: AccessCodeBody, db: Session = Depends(get_db)):
    code = body.access_code.strip()
    if not code:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "인증번호를 입력하세요.")
    row = db.get(Setting, "access_code")
    if row is None:
        db.add(Setting(key="access_code", value=code))
    else:
        row.value = code
    db.commit()
    return {"ok": True, "message": "인증번호가 변경되었습니다."}


# ---------- aniDL 연동 (api/search.php, api/episode_lookup_stream.php) ----------


def _anidown_script(service: str) -> str:
    return "./hidn.sh" if service == "hidive" else "./crdn.sh"


@router.get("/anidown/search")
async def anidown_search(
    keyword: str = "",
    service: str = "crunchy",
    settings: Settings = Depends(get_settings),
):
    """api/search.php — aniDL 검색 결과를 plain text 그대로 반환 (인자 리스트라 인젝션 안전)."""
    keyword = keyword.strip()
    if not keyword:
        return PlainTextResponse("검색어를 입력하세요.")
    try:
        proc = await asyncio.create_subprocess_exec(
            _anidown_script(service), "--search", keyword,
            cwd=settings.base_dir / "downloader",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        )
        out, _ = await proc.communicate()
    except OSError:
        return PlainTextResponse("검색 중 오류가 발생했습니다.")
    return PlainTextResponse(out.decode("utf-8", errors="replace"))


@router.get("/anidown/episodes")
async def anidown_episodes(
    season_id: str = "",
    service: str = "crunchy",
    settings: Settings = Depends(get_settings),
):
    """api/episode_lookup_stream.php — aniDL 에피소드 목록을 SSE로 스트리밍."""
    season_id = season_id.strip()
    if not season_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "시즌 ID가 필요합니다.")

    def sse(data: str, event: str = "message") -> str:
        return f"event: {event}\ndata: {data.replace(chr(10), chr(10) + 'data: ')}\n\n"

    async def stream():
        try:
            proc = await asyncio.create_subprocess_exec(
                _anidown_script(service), "-s", season_id,
                cwd=settings.base_dir / "downloader",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
            )
        except OSError:
            yield sse("프로세스를 시작할 수 없습니다.", "error")
            yield sse("", "done")
            return
        assert proc.stdout is not None
        while True:
            line = await proc.stdout.readline()
            if not line:
                break
            text = line.decode("utf-8", errors="replace").rstrip("\r\n")
            if text:
                yield sse(text)
        await proc.wait()
        yield sse("", "done")

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
