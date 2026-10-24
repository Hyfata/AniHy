"""인코딩 워커 — worker/convert.php 포팅 (async, 인프로세스).

파이프라인: 소스 확보(aniDL/업로드/서버파일) → 자막 준비(SMI→ASS) → 싱크 시프트
→ 길이/오디오 프로브 → ffmpeg burn-in(-itsoffset 대신 ASS 자체를 시프트) → chapters VTT
+ 50% 480px 썸네일 → episodes UPSERT.

하드 규약 (AGENTS.md / plan §6):
- smi2ass 실행 env에 UTF-8 강제 (LC_ALL/LANG=C.UTF-8, PYTHONUTF8=1) — 삭제 금지
- FONTCONFIG_FILE=assets/fonts/fonts.conf (번들 한글 폰트) — 삭제 금지
- SMI 전처리(최다 클래스 부여), UTF-16 BOM iconv 라운드트립, ASS-in-.smi 감지,
  -KOR 우선 선택, Traceback/산출물 없음 → 실패 + 원본 SMI subtitles/failed/ 보존
- 오디오: jpn 우선 선택, AAC면 copy 아니면 AAC 192k 트랜스코드
- is_test: 360p + quality+12 + 최고속 프리셋 + -t 600 + duration 600s 캡
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import time
import traceback
from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session, sessionmaker

from ..core.config import Settings
from ..models import Anime, Episode, Job
from ..services import files as fs
from .encoders import encoding_env_overrides, ffmpeg_encode_args, load_encoding_config

ENCODE_BASE_PROGRESS = 15
BITMAP_SUBTITLE_CODECS = {"hdmv_pgs_subtitle", "dvd_subtitle", "dvdsub", "dvb_subtitle", "dvb_teletext", "xsub"}


# ---------- 로그/DB 헬퍼 ----------


def _log(log_file: Path, msg: str) -> None:
    log_file.parent.mkdir(parents=True, exist_ok=True)
    with log_file.open("a", encoding="utf-8") as f:
        f.write(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}\n")


def _update_job(sf: sessionmaker[Session], job_id: int, status: str, progress: int, message: str) -> None:
    with sf() as db:
        db.execute(
            Job.__table__.update()
            .where(Job.id == job_id)
            .values(status=status, progress=progress, message=message, updated_at=datetime.now())
        )
        db.commit()


def _set_job_fields(sf: sessionmaker[Session], job_id: int, **fields) -> None:
    with sf() as db:
        db.execute(Job.__table__.update().where(Job.id == job_id).values(**fields))
        db.commit()


# ---------- 서브프로세스 헬퍼 ----------


async def _run_logged(cmd: list[str], log_file: Path, cwd: Path | None = None, env: dict | None = None) -> tuple[int, str]:
    _log(log_file, "Execute: " + " ".join(cmd))
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=cwd,
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    out, _ = await proc.communicate()
    text = out.decode("utf-8", errors="replace")
    _log(log_file, f"Output:\n{text}")
    return proc.returncode or 0, text


# ---------- SMI 전처리 (순수 함수 — 테스트 대상) ----------


def detect_smi_encoding(raw: bytes) -> str | None:
    """UTF-16 BOM 감지 → 'utf-16-le' / 'utf-16-be' / None."""
    if raw.startswith(b"\xff\xfe"):
        return "utf-16-le"
    if raw.startswith(b"\xfe\xff"):
        return "utf-16-be"
    return None


def is_ass_in_smi(raw_head: bytes) -> bool:
    """확장자는 .smi인데 내용이 ASS인 파일 감지 (BOM/공백 제거 후 [Script Info])."""
    head = raw_head.decode("utf-8", errors="replace").lstrip("﻿ \t\r\n")
    return head.startswith("[Script Info]")


_P_CLASS_RE = re.compile(r'<P\s+Class\s*=\s*"?([A-Za-z0-9_]+)"?', re.IGNORECASE)
_SYNC_BLOCK_RE = re.compile(r"(?=<SYNC\b)", re.IGNORECASE)
_SYNC_TAG_RE = re.compile(r"^<SYNC\b[^>]*>", re.IGNORECASE)
_HAS_P_CLASS_RE = re.compile(r"<P\s+Class\s*=", re.IGNORECASE)


def patch_smi_classes(text: str) -> tuple[str, int, str | None]:
    """<P Class=> 없는 SYNC 블록에 파일 내 최다 클래스 부여.

    smi2ass가 클래스 없는 빈 블록을 "UNKNOWNCC" 가짜 언어로 오인해 다중 언어 모드의
    NotADirectoryError를 터뜨리는 것을 방지. (patched_text, 패치 블록 수, 기본 클래스)
    """
    classes = [m.upper() for m in _P_CLASS_RE.findall(text)]
    if not classes:
        return text, 0, None
    counts: dict[str, int] = {}
    for c in classes:
        counts[c] = counts.get(c, 0) + 1
    default_class = max(counts, key=lambda c: (counts[c], -classes.index(c)))

    blocks = _SYNC_BLOCK_RE.split(text)
    patched = 0
    for i, block in enumerate(blocks):
        m = _SYNC_TAG_RE.match(block)
        if not m or _HAS_P_CLASS_RE.search(block):
            continue
        blocks[i] = m.group(0) + f"<P Class={default_class}>" + block[m.end():]
        patched += 1
    return "".join(blocks), patched, default_class


def patch_smi_file(path: Path, log_file: Path) -> None:
    """UTF-16 BOM이면 디코드→패치→원 인코딩으로 되돌려 저장 (iconv 라운드트립 포팅)."""
    raw = path.read_bytes()
    encoding = detect_smi_encoding(raw)
    text = raw[2:].decode(encoding, errors="replace") if encoding else raw.decode("utf-8", errors="replace")
    fixed, patched, default_class = patch_smi_classes(text)
    if patched > 0:
        out = raw[:2] + fixed.encode(encoding) if encoding else fixed.encode("utf-8")
        path.write_bytes(out)
        _log(log_file, f"Patched {patched} SYNC block(s) without P Class as Class={default_class}")


# ---------- smi2ass 실행 + 산출물 선택 ----------


def pick_smi2ass_output(candidates: list[Path]) -> Path | None:
    """단일 언어 {base}.ass / 복수 언어 {base}-{LANG}.ass 중 -KOR 우선 선택."""
    chosen = None
    for c in candidates:
        if c.name.endswith("-KOR.ass"):
            return c
        if chosen is None:
            chosen = c
    return chosen


async def convert_smi_to_ass(
    subtitle_path: Path,
    ass_dir: Path,
    smi2ass_bin: Path,
    log_file: Path,
    env: dict,
) -> Path | None:
    """SMI→ASS 변환. 성공 시 ASS 경로, 실패 시 None (원본 SMI는 호출자가 보존)."""
    patch_smi_file(subtitle_path, log_file)
    cmd = [str(smi2ass_bin), subtitle_path.name, "-o", str(ass_dir)]
    _rc, output = await _run_logged(cmd, log_file, cwd=subtitle_path.parent, env=env)

    clean = "Traceback" not in output
    basename = subtitle_path.stem
    candidates = sorted(ass_dir.glob(f"{basename}*.ass"))
    chosen = pick_smi2ass_output(candidates)
    if clean and chosen is not None and chosen.is_file() and chosen.stat().st_size > 0:
        for c in candidates:
            if c != chosen:
                c.unlink(missing_ok=True)
        return chosen
    # 부분 변환 산출물 제거
    for c in candidates:
        c.unlink(missing_ok=True)
    return None


# ---------- 자막 스트림 자동 선택 (convert.php 로직) ----------


def pick_text_subtitle_index(codecs: list[str]) -> int | None:
    """텍스트 자막 선택: ass/ssa 우선, 아니면 비트맵이 아닌 첫 트랙, 없으면 None."""
    for i, c in enumerate(codecs):
        if c in ("ass", "ssa"):
            return i
    for i, c in enumerate(codecs):
        if c not in BITMAP_SUBTITLE_CODECS:
            return i
    return None


# ---------- chapters VTT (inc/chapters.php exportChaptersVtt 포팅) ----------


def format_vtt_timestamp(seconds: float) -> str:
    total_ms = max(0, round(seconds * 1000))
    ms = total_ms % 1000
    s = total_ms // 1000
    return f"{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}.{ms:03d}"


def chapters_to_vtt(data: dict) -> str | None:
    chapters = data.get("chapters") or []
    out = "WEBVTT\n"
    for ch in chapters:
        try:
            start = float(ch["start_time"])
            end = float(ch["end_time"])
        except (KeyError, TypeError, ValueError):
            continue
        if end <= start:
            continue
        title = re.sub(r"\s+", " ", str((ch.get("tags") or {}).get("title") or "")).strip() or "Chapter"
        title = title.replace("-->", "->")  # cue 페이로드의 '-->'는 VTT 파싱을 깸
        out += f"\n{format_vtt_timestamp(start)} --> {format_vtt_timestamp(end)}\n{title}\n"
    return out if out != "WEBVTT\n" else None


async def export_chapters_vtt(mp4_path: Path, vtt_path: Path, log_file: Path) -> bool:
    _rc, raw = await _run_logged(
        ["ffprobe", "-v", "error", "-show_chapters", "-of", "json", str(mp4_path)], log_file
    )
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return False
    vtt = chapters_to_vtt(data)
    if vtt is None:
        return False
    vtt_path.parent.mkdir(parents=True, exist_ok=True)
    vtt_path.write_text(vtt, encoding="utf-8")
    return True


# ---------- 메인 파이프라인 ----------


async def convert_job(job_id: int, session_factory: sessionmaker[Session], settings: Settings) -> None:
    base_dir = Path(settings.base_dir)
    downloader_dir = base_dir / "downloader"
    videos_dir = downloader_dir / "videos"
    animes_dir = base_dir / "animes"
    subtitles_dir = base_dir / "subtitles"
    log_file = base_dir / "logs" / f"job_{job_id}.log"

    enc_cfg = load_encoding_config(settings)

    # 자식 프로세스 env: 번들 폰트 + UTF-8 강제(smi2ass UnicodeEncodeError 방지) + 백엔드 LibVA
    env = dict(os.environ)
    env["FONTCONFIG_FILE"] = str(base_dir / "assets" / "fonts" / "fonts.conf")
    env.update({"LC_ALL": "C.UTF-8", "LANG": "C.UTF-8", "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"})
    for k, v in encoding_env_overrides(enc_cfg).items():
        if v is None:
            env.pop(k, None)
        else:
            env[k] = v

    try:
        await _convert_job_inner(job_id, session_factory, settings, enc_cfg, env, log_file)
    except asyncio.CancelledError:
        _log(log_file, "Job cancelled")
        raise
    except Exception:
        msg = f"워커 처리 중 예외 발생: {traceback.format_exc(limit=3)}"
        _log(log_file, msg)
        try:
            _update_job(session_factory, job_id, "failed", 0, "워커 처리 중 오류가 발생했습니다. 로그를 확인하세요.")
        except Exception:
            pass


async def _convert_job_inner(job_id, session_factory, settings, enc_cfg, env, log_file) -> None:
    base_dir = Path(settings.base_dir)
    downloader_dir = base_dir / "downloader"
    videos_dir = downloader_dir / "videos"
    animes_dir = base_dir / "animes"
    subtitles_dir = base_dir / "subtitles"

    sf = session_factory
    with sf() as db:
        job = db.get(Job, job_id)
        if job is None:
            _log(log_file, f"Job not found: {job_id}")
            return
        anime_id = job.anime_id
        episode_number = str(job.episode_number)
        season_id = job.season_id
        episode_title = job.episode_title or f"{episode_number}화"
        subtitle_file = job.subtitle_file
        trim_seconds = max(0.0, float(job.trim_seconds or 0))
        subtitle_offset = float(job.subtitle_offset or 0)
        source_type = job.source_type or "download"
        source_file = job.source_file
        is_test = bool(job.is_test)
        anime = db.get(Anime, anime_id)
        is_hidive = bool(anime.is_hidive) if anime else False

    safe_episode = fs.sanitize_filename(episode_number)
    script = "./hidn.sh" if is_hidive else "./crdn.sh"
    service_name = "Hidive" if is_hidive else "Crunchyroll"

    _log(log_file, f"Starting job {job_id}: anime={anime_id} ep={episode_number} season={season_id} "
                   f"source={source_type} service={service_name} trim={trim_seconds} sync={subtitle_offset} "
                   f"encoder={enc_cfg.encoder} quality={enc_cfg.quality} test={'1' if is_test else '0'}")
    _set_job_fields(sf, job_id, encoder=enc_cfg.encoder + (" (테스트)" if is_test else ""))

    # ---------- 소스 확보 ----------
    mkv_path = videos_dir / f"{season_id}_{safe_episode}.mkv"
    if source_type in ("upload", "server") and source_file:
        source_path = Path(source_file) if source_type == "server" else base_dir / source_file
        if not source_path.is_file():
            fail = "서버 원본 영상을 찾을 수 없습니다." if source_type == "server" else "업로드된 원본 영상을 찾을 수 없습니다."
            _update_job(sf, job_id, "failed", 0, fail)
            _log(log_file, f"Local source not found: {source_path}")
            return
        mkv_path = source_path
        msg = "서버 파일 처리 중..." if source_type == "server" else "업로드된 영상 처리 중..."
        _update_job(sf, job_id, "preparing", 10, msg)
        _log(log_file, f"Using local source: {mkv_path}")
    else:
        _update_job(sf, job_id, "downloading", 5, f"{service_name}에서 다운로드 중...")
        await _run_logged(
            [script, "-s", season_id, "-e", episode_number, "--fileName", f"{season_id}_{safe_episode}"],
            log_file, cwd=downloader_dir, env=env,
        )
        if not mkv_path.is_file():
            _update_job(sf, job_id, "failed", 0, "다운로드 실패: MKV 파일을 찾을 수 없습니다.")
            _log(log_file, "MKV not found")
            return
        _log(log_file, f"MKV found: {mkv_path}")

    # ---------- 자막 준비 ----------
    ass_dir = subtitles_dir / str(anime_id)
    ass_dir.mkdir(parents=True, exist_ok=True)
    ass_path = ass_dir / f"{safe_episode}.ass"
    subtitle_relative = f"subtitles/{anime_id}/{safe_episode}.ass"
    has_subtitle = False
    source_ass: Path | None = None

    _update_job(sf, job_id, "preparing", 10, "자막 준비 중...")

    uploaded = subtitles_dir / subtitle_file if subtitle_file else None
    if uploaded is not None and uploaded.is_file():
        ext = uploaded.suffix.lower().lstrip(".")
        if ext == "smi" and is_ass_in_smi(uploaded.read_bytes()[:64]):
            _log(log_file, "Subtitle labelled .smi is actually ASS, using as-is")
            ext = "ass"
        if ext == "smi":
            converted = await convert_smi_to_ass(
                uploaded, ass_dir, base_dir / "smi2ass" / "smi2ass", log_file, env
            )
            if converted is None:
                # 변환 실패: 원본 SMI 보존 후 실패 (조용한 무자막 완성 방지)
                failed_dir = subtitles_dir / "failed"
                failed_dir.mkdir(parents=True, exist_ok=True)
                kept = failed_dir / f"job_{job_id}_{uploaded.name}"
                shutil.move(str(uploaded), str(kept))
                fail = (f"자막 변환 실패 (SMI→ASS). 원본은 {kept}에 보존. "
                        f"logs/job_{job_id}.log의 smi2ass Traceback 확인 후 SMI를 고쳐 다시 등록하세요.")
                _update_job(sf, job_id, "failed", 0, fail)
                _log(log_file, fail)
                return
            source_ass = converted
            uploaded.unlink(missing_ok=True)
        else:
            shutil.copyfile(uploaded, ass_path)
            source_ass = ass_path
            uploaded.unlink(missing_ok=True)
    elif ass_path.is_file() and ass_path.stat().st_size > 0:
        # 이전 시도의 변환본 재사용 (재시도/재등록 시 덮어쓰지 않음)
        _log(log_file, f"Reusing existing ASS subtitle: {ass_path}")
    else:
        # MKV 내장 텍스트 자막 추출 (이미지 자막은 burn-in 불가라 스킵)
        _rc, raw = await _run_logged(
            ["ffprobe", "-v", "error", "-select_streams", "s", "-show_entries", "stream=codec_name",
             "-of", "json", str(mkv_path)], log_file
        )
        codecs = []
        try:
            for s in (json.loads(raw).get("streams") or []):
                codecs.append(str(s.get("codec_name") or "").strip().lower())
        except json.JSONDecodeError:
            pass
        sub_index = pick_text_subtitle_index(codecs)
        if sub_index is None:
            _log(log_file, "No text subtitle stream found (all bitmap or none), will encode without burn-in")
        else:
            _log(log_file, f"Subtitle stream selected: 0:s:{sub_index} (codec: {codecs[sub_index] or 'unknown'})")
            await _run_logged(
                ["ffmpeg", "-y", "-i", str(mkv_path), "-map", f"0:s:{sub_index}", "-c:s", "ass", str(ass_path)],
                log_file, env=env,
            )
            source_ass = ass_path

    if source_ass is not None and source_ass.is_file() and source_ass.stat().st_size > 0:
        if source_ass != ass_path:
            ass_path.unlink(missing_ok=True)
            shutil.move(str(source_ass), str(ass_path))

    if ass_path.is_file() and ass_path.stat().st_size > 0:
        has_subtitle = True
        _log(log_file, f"ASS subtitle ready: {ass_path}")
    else:
        _log(log_file, "No subtitle available, will encode without burn-in")
        ass_path.unlink(missing_ok=True)
        subtitle_relative = None

    # 자막 싱크 오프셋: ffmpeg -itsoffset으로 자막만 시프트
    if has_subtitle and subtitle_offset != 0.0:
        shifted = ass_dir / f"{safe_episode}_synced.ass"
        await _run_logged(
            ["ffmpeg", "-y", "-itsoffset", str(subtitle_offset), "-i", str(ass_path),
             "-c:s", "ass", str(shifted)], log_file, env=env,
        )
        if shifted.is_file() and shifted.stat().st_size > 0:
            shutil.move(str(shifted), str(ass_path))
            _log(log_file, f"Subtitle sync offset applied via ffmpeg: {subtitle_offset}s")
        else:
            _log(log_file, "WARNING: subtitle sync shift failed, using original ASS")
            shifted.unlink(missing_ok=True)

    # ---------- 길이 프로브 (진행률 계산용) ----------
    duration_ms = 0
    _rc, dur_out = await _run_logged(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(mkv_path)], log_file
    )
    try:
        seconds = float(dur_out.strip())
    except ValueError:
        seconds = 0.0
    if seconds > 0:
        duration_ms = seconds * 1000
        if trim_seconds > 0:
            duration_ms = max(0.0, duration_ms - trim_seconds * 1000)
            _log(log_file, f"Adjusted duration (after {trim_seconds}s trim): {duration_ms / 1000:.2f}s")
        if is_test and duration_ms > 600_000:
            duration_ms = 600_000
            _log(log_file, "Test mode: duration capped to 600s")
        _set_job_fields(sf, job_id, duration_ms=int(duration_ms))
        _log(log_file, f"Duration: {duration_ms / 1000:.2f}s")

    # ---------- 오디오 선택: jpn 우선, AAC copy 아니면 AAC 192k ----------
    audio_streams = await fs.probe_audio_streams(mkv_path)
    audio_index = fs.pick_jpn_audio_index(audio_streams) if audio_streams else 0
    audio_codec = ""
    if audio_streams:
        audio_codec = audio_streams[audio_index]["codec"].lower()
        _log(log_file, f"Audio stream selected: 0:a:{audio_index} "
                       f"(language: {audio_streams[audio_index]['language'] or 'unknown'}, codec: {audio_codec or 'unknown'})")
    else:
        _log(log_file, "WARNING: audio probe failed, falling back to first audio stream (0:a:0)")
    audio_args = ["-c:a", "copy"] if audio_codec == "aac" else ["-c:a", "aac", "-b:a", "192k"]
    if audio_codec != "aac":
        _log(log_file, "Audio codec is not AAC, transcoding to AAC 192k")

    # ---------- 인코드 ----------
    encode_message = "자막을 영상에 입히는 중..." if has_subtitle else "MP4로 변환 중..."
    _update_job(sf, job_id, "encoding", ENCODE_BASE_PROGRESS, encode_message)
    output_path = videos_dir / f"job_{job_id}_result.mp4"
    test_limit = ["-t", "600"] if is_test else []

    cmd = ["ffmpeg", "-y"]
    if trim_seconds > 0:
        cmd += ["-ss", str(trim_seconds)]
    if has_subtitle:
        enc_args = ffmpeg_encode_args(enc_cfg, str(ass_path), is_test)
        cmd += enc_args["pre_input"] + [
            "-i", str(mkv_path), "-map", "0:v:0", "-map", f"0:a:{audio_index}",
            "-vf", enc_args["vf"],
        ] + test_limit + audio_args + ["-sn"] + enc_args["codec"]
    else:
        # 무자막: 리먹스 (is_test면 -t 600만 적용)
        cmd += [
            "-i", str(mkv_path), "-map", "0:v:0", "-map", f"0:a:{audio_index}", "-c:v", "copy",
        ] + test_limit + audio_args + ["-sn"]
    cmd += ["-movflags", "+faststart", "-progress", "pipe:2", "-nostats", str(output_path)]
    _log(log_file, "Encode cmd: " + " ".join(cmd))

    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE, env=env, cwd=base_dir
    )
    last_progress = 0
    last_update = 0.0
    buf = b""
    assert proc.stderr is not None
    while True:
        chunk = await proc.stderr.read(8192)
        if not chunk:
            break
        with log_file.open("ab") as f:
            f.write(chunk)
        buf += chunk
        while b"\n" in buf:
            line_b, buf = buf.split(b"\n", 1)
            line = line_b.decode("utf-8", errors="replace").strip()
            m = re.fullmatch(r"out_time_ms=(\d+)", line)
            if m and duration_ms > 0:
                # ffmpeg의 out_time_ms는 이름과 달리 마이크로초 단위
                ms = int(m.group(1)) // 1000
                pct = int(min(99, max(ENCODE_BASE_PROGRESS,
                                       round(ms / duration_ms * (99 - ENCODE_BASE_PROGRESS)) + ENCODE_BASE_PROGRESS)))
                now = time.monotonic()
                if pct != last_progress and now - last_update >= 1:
                    label = f"자막 입히는 중... {pct}%" if has_subtitle else f"변환 중... {pct}%"
                    _update_job(sf, job_id, "encoding", pct, label)
                    last_progress = pct
                    last_update = now
    rc = await proc.wait()

    if rc != 0 or not output_path.is_file() or output_path.stat().st_size == 0:
        _update_job(sf, job_id, "failed", 0, f"인코딩 실패 (exit code: {rc})")
        _log(log_file, f"Encoding failed with exit code {rc}")
        return
    _log(log_file, f"Encoding completed: {output_path}")

    # ---------- 최종 이동 ----------
    target_dir = animes_dir / str(anime_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / f"{safe_episode}.mp4"
    try:
        shutil.move(str(output_path), str(target_path))
    except OSError:
        _update_job(sf, job_id, "failed", 0, "최종 파일 이동 실패")
        _log(log_file, f"Failed to move output to {target_path}")
        return
    _log(log_file, f"Moved to: {target_path}")

    # 챕터 VTT (없으면 stale 파일 제거)
    vtt_path = target_dir / f"{safe_episode}.chapters.vtt"
    if await export_chapters_vtt(target_path, vtt_path, log_file):
        _log(log_file, f"Chapters VTT written: {vtt_path}")
    else:
        vtt_path.unlink(missing_ok=True)
        _log(log_file, "No chapters found, skipped VTT export")

    # 썸네일: 전체 길이 50% 지점, 480px JPEG (best-effort)
    thumb_path = target_dir / f"{safe_episode}.jpg"
    thumb_seek = max(1, round(duration_ms / 1000 * 0.5)) if duration_ms > 0 else 60
    await _run_logged(
        ["ffmpeg", "-y", "-ss", str(thumb_seek), "-i", str(target_path),
         "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", str(thumb_path)],
        log_file, env=env,
    )
    if thumb_path.is_file() and thumb_path.stat().st_size > 0:
        _log(log_file, f"Thumbnail written: {thumb_path}")
    else:
        thumb_path.unlink(missing_ok=True)
        _log(log_file, "WARNING: thumbnail extraction failed")

    # 정리 — 서버 파일 소스는 사용자 원본이므로 절대 삭제하지 않는다
    # (다운로드/업로드는 임시본이라 삭제). 구 PHP는 무조건 unlink했으나 요구사항 변경.
    if not (source_type == "server" and source_file and mkv_path == Path(source_file)):
        mkv_path.unlink(missing_ok=True)
    output_path.unlink(missing_ok=True)

    # ---------- episodes UPSERT ----------
    relative_path = f"animes/{anime_id}/{safe_episode}.mp4"
    en_relative = None
    en_path = subtitles_dir / str(anime_id) / f"{safe_episode}_en.ass"
    if en_path.is_file() and en_path.stat().st_size > 0:
        en_relative = f"subtitles/{anime_id}/{safe_episode}_en.ass"

    with sf() as db:
        ep = db.query(Episode).filter(
            Episode.anime_id == anime_id, Episode.episode_number == safe_episode
        ).one_or_none()
        if ep is None:
            db.add(Episode(
                anime_id=anime_id, episode_number=safe_episode, title=episode_title,
                file_path=relative_path, duration_ms=int(duration_ms), has_subtitle=has_subtitle,
                en_subtitle_file=en_relative, subtitle_file=subtitle_relative,
            ))
        else:
            ep.title = episode_title
            ep.file_path = relative_path
            ep.duration_ms = int(duration_ms)
            ep.has_subtitle = has_subtitle
            ep.en_subtitle_file = en_relative
            ep.subtitle_file = subtitle_relative
        db.commit()

    _update_job(sf, job_id, "completed", 100, "완료")
    _log(log_file, "Job completed")
