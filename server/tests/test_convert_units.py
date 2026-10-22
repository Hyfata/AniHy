"""worker/convert.py 순수 로직 — SMI 전처리, smi2ass 산출물 선택, 자막/챕터 헬퍼."""
import asyncio
from pathlib import Path

import pytest

from server.worker.convert import (
    chapters_to_vtt,
    convert_smi_to_ass,
    detect_smi_encoding,
    format_vtt_timestamp,
    is_ass_in_smi,
    patch_smi_classes,
    patch_smi_file,
    pick_smi2ass_output,
    pick_text_subtitle_index,
)


# ---------- BOM/인코딩 ----------


def test_detect_smi_encoding():
    assert detect_smi_encoding(b"\xff\xfe<S") == "utf-16-le"
    assert detect_smi_encoding(b"\xfe\xff\x00<") == "utf-16-be"
    assert detect_smi_encoding(b"\xef\xbb\xbf<S") is None
    assert detect_smi_encoding(b"<SYNC") is None


def test_is_ass_in_smi():
    assert is_ass_in_smi(b"[Script Info]\nTitle: x")
    assert is_ass_in_smi(b"\xef\xbb\xbf  [Script Info]")
    assert not is_ass_in_smi(b"<SAMI><HEAD>")


# ---------- 클래스 전처리 ----------


def test_patch_smi_classes():
    text = (
        "<SYNC Start=100><P Class=KRCC>안녕\n"
        "<SYNC Start=200><P Class=KRCC>세상\n"
        "<SYNC Start=300>클class없음\n"
        "<SYNC Start=400><P Class=ENCC>eng\n"
    )
    fixed, patched, default = patch_smi_classes(text)
    assert default == "KRCC"  # 최다 클래스
    assert patched == 1
    assert "<SYNC Start=300><P Class=KRCC>클class없음" in fixed


def test_patch_smi_classes_no_classes():
    text = "<SYNC Start=100>텍스트"
    fixed, patched, default = patch_smi_classes(text)
    assert (fixed, patched, default) == (text, 0, None)


def test_patch_smi_file_utf16_roundtrip(tmp_path):
    text = "<SYNC Start=100><P Class=KRCC>가\n<SYNC Start=200>나\n"
    raw = b"\xff\xfe" + text.encode("utf-16-le")
    p = tmp_path / "sub_t1.smi"
    p.write_bytes(raw)
    log = tmp_path / "job_1.log"
    patch_smi_file(p, log)
    out = p.read_bytes()
    assert out[:2] == b"\xff\xfe"  # BOM 보존
    decoded = out[2:].decode("utf-16-le")
    assert "<SYNC Start=200><P Class=KRCC>나" in decoded
    assert "Patched 1 SYNC" in log.read_text()


# ---------- smi2ass 산출물 선택 ----------


def test_pick_smi2ass_output_kor_preference(tmp_path):
    a = tmp_path / "sub-ENG.ass"; a.write_text("e")
    b = tmp_path / "sub-KOR.ass"; b.write_text("k")
    c = tmp_path / "sub.ass"; c.write_text("d")
    assert pick_smi2ass_output([a, b, c]) == b
    assert pick_smi2ass_output([a, c]) == a
    assert pick_smi2ass_output([]) is None


# ---------- 자막 스트림 선택 ----------


def test_pick_text_subtitle_index():
    assert pick_text_subtitle_index(["hdmv_pgs_subtitle", "ass"]) == 1  # ASS 우선
    assert pick_text_subtitle_index(["subrip", "ass"]) == 1
    assert pick_text_subtitle_index(["subrip", "mov_text"]) == 0  # 비트맵 아닌 첫 트랙
    assert pick_text_subtitle_index(["hdmv_pgs_subtitle", "dvd_subtitle"]) is None  # 전부 이미지
    assert pick_text_subtitle_index([]) is None


# ---------- convert_smi_to_ass (subprocess 모킹) ----------


def _run(coro):
    return asyncio.run(coro)


def test_convert_smi_success_prefers_kor(tmp_path, monkeypatch):
    smi = tmp_path / "ep1.smi"
    smi.write_text("<SYNC Start=100><P Class=KRCC>가")
    ass_dir = tmp_path / "1"
    ass_dir.mkdir()
    (ass_dir / "ep1-ENG.ass").write_text("eng")
    (ass_dir / "ep1-KOR.ass").write_text("kor")

    async def fake_run(cmd, log_file, cwd=None, env=None):
        return 0, "done"

    monkeypatch.setattr("server.worker.convert._run_logged", fake_run)
    out = _run(convert_smi_to_ass(smi, ass_dir, tmp_path / "smi2ass", tmp_path / "j.log", {}))
    assert out == ass_dir / "ep1-KOR.ass"
    assert not (ass_dir / "ep1-ENG.ass").exists()  # 나머지 산출물 정리


def test_convert_smi_traceback_fails_and_cleans(tmp_path, monkeypatch):
    smi = tmp_path / "ep2.smi"
    smi.write_text("<SYNC Start=100><P Class=KRCC>가")
    ass_dir = tmp_path / "2"
    ass_dir.mkdir()
    (ass_dir / "ep2.ass").write_text("partial")  # 부분 산출물

    async def fake_run(cmd, log_file, cwd=None, env=None):
        return 1, "Traceback (most recent call last): ..."

    monkeypatch.setattr("server.worker.convert._run_logged", fake_run)
    out = _run(convert_smi_to_ass(smi, ass_dir, tmp_path / "smi2ass", tmp_path / "j.log", {}))
    assert out is None
    assert not (ass_dir / "ep2.ass").exists()  # 부분 산출물 제거


# ---------- 챕터 VTT ----------


def test_format_vtt_timestamp():
    assert format_vtt_timestamp(0) == "00:00:00.000"
    assert format_vtt_timestamp(83.5) == "00:01:23.500"
    assert format_vtt_timestamp(3661.25) == "01:01:01.250"


def test_chapters_to_vtt():
    data = {"chapters": [
        {"start_time": "0.0", "end_time": "90.0", "tags": {"title": "OP"}},
        {"start_time": "90.0", "end_time": "80.0", "tags": {"title": "bad"}},  # end<=start 스킵
        {"start_time": "90.0", "end_time": "1400.0", "tags": {"title": "본편 --> 각주"}},
    ]}
    vtt = chapters_to_vtt(data)
    assert vtt.startswith("WEBVTT")
    assert "00:00:00.000 --> 00:01:30.000\nOP" in vtt
    assert "--> 각주" not in vtt.split("\n")[-2]  # '-->'는 '->'로 치환
    assert "본편 -> 각주" in vtt
    assert "bad" not in vtt


def test_chapters_to_vtt_empty():
    assert chapters_to_vtt({"chapters": []}) is None
    assert chapters_to_vtt({}) is None
