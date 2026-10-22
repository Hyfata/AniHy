"""worker/encoders.py — inc/encoding.php 포팅 검증 (4백엔드 × normal/test)."""
import pytest

from server.core.config import Settings
from server.worker.encoders import (
    encoding_env_overrides,
    ffmpeg_encode_args,
    load_encoding_config,
)


def _cfg(**kw):
    base = {"db_url": "sqlite://", "encoder": "software", "max_workers": 1,
            "vaapi_device": "/dev/dri/renderD128", "quality": 23}
    base.update(kw)
    return load_encoding_config(Settings(**base))


def test_load_config_validation():
    cfg = _cfg(encoder="nvidia", max_workers=0, quality=99, vaapi_device="  ")
    assert cfg.encoder == "nvidia"
    assert cfg.max_workers == 1          # 최소 1
    assert cfg.quality == 51             # 최대 51 클램프
    assert cfg.vaapi_device == "/dev/dri/renderD128"  # 빈 값 폴리백


def test_env_overrides():
    assert encoding_env_overrides(_cfg(encoder="intel")) == {"LIBVA_DRIVER_NAME": "iHD"}
    assert encoding_env_overrides(_cfg(encoder="radeon")) == {"LIBVA_DRIVER_NAME": "radeonsi"}
    assert encoding_env_overrides(_cfg(encoder="software")) == {"LIBVA_DRIVER_NAME": None}
    assert encoding_env_overrides(_cfg(encoder="nvidia")) == {"LIBVA_DRIVER_NAME": None}


@pytest.mark.parametrize("encoder,expected_codec,expected_qflag,preset_normal,preset_test", [
    ("software", "libx264", "-crf", "veryfast", "ultrafast"),
    ("nvidia", "h264_nvenc", "-cq", "p4", "p1"),
])
def test_args_software_nvidia(encoder, expected_codec, expected_qflag, preset_normal, preset_test):
    cfg = _cfg(encoder=encoder, quality=23)
    args = ffmpeg_encode_args(cfg, "/tmp/a.ass")
    assert args["pre_input"] == []
    assert args["vf"] == "ass=/tmp/a.ass,format=yuv420p"
    assert expected_codec in args["codec"] and expected_qflag in args["codec"]
    assert args["codec"][-1] == "23"
    assert preset_normal in args["codec"]

    targs = ffmpeg_encode_args(cfg, "/tmp/a.ass", test=True)
    assert targs["vf"] == "scale=-2:360,ass=/tmp/a.ass,format=yuv420p"
    assert targs["codec"][-1] == "35"  # 23 + 12
    assert preset_test in targs["codec"]


@pytest.mark.parametrize("encoder", ["intel", "radeon"])
def test_args_vaapi(encoder):
    cfg = _cfg(encoder=encoder, quality=20)
    args = ffmpeg_encode_args(cfg, "/s.ass")
    assert args["pre_input"] == ["-vaapi_device", "/dev/dri/renderD128"]
    assert args["vf"] == "ass=/s.ass,format=nv12,hwupload"
    assert args["codec"] == ["-c:v", "h264_vaapi", "-qp", "20"]
    targs = ffmpeg_encode_args(cfg, "/s.ass", test=True)
    assert targs["vf"] == "scale=-2:360,ass=/s.ass,format=nv12,hwupload"
    assert targs["codec"][-1] == "32"


def test_quality_plus_12_capped_at_51():
    cfg = _cfg(encoder="software", quality=45)
    assert ffmpeg_encode_args(cfg, "/a.ass", test=True)["codec"][-1] == "51"
