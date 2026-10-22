"""인코딩 백엔드 설정 + ffmpeg 인자 빌더 — inc/encoding.php 포팅.

PHP와 달리 putenv 전역 상태를 쓰지 않고, 서브프로세스에 넘길 env dict를 만든다
(applyEncodingEnv → encoding_env_overrides).
"""
from dataclasses import dataclass

from ..core.config import Encoder, Settings

ENCODING_BACKENDS = ("software", "intel", "radeon", "nvidia")


@dataclass(frozen=True)
class EncodingConfig:
    encoder: str = "intel"
    max_workers: int = 1
    vaapi_device: str = "/dev/dri/renderD128"
    quality: int = 23


def load_encoding_config(settings: Settings) -> EncodingConfig:
    """Settings → 검증/기본값 보정된 EncodingConfig (loadEncodingConfig 포팅)."""
    encoder = settings.encoder.value if isinstance(settings.encoder, Encoder) else str(settings.encoder)
    if encoder not in ENCODING_BACKENDS:
        encoder = "intel"
    return EncodingConfig(
        encoder=encoder,
        max_workers=max(1, int(settings.max_workers)),
        vaapi_device=settings.vaapi_device.strip() or "/dev/dri/renderD128",
        quality=min(51, max(0, int(settings.quality))),
    )


def encoding_env_overrides(cfg: EncodingConfig) -> dict[str, str]:
    """백엔드별 LibVA 드라이버 env (applyEncodingEnv 포팅).

    반환 dict의 값이 None이면 해당 변수를 제거한다는 뜻 (VA-API 미사용 백엔드).
    """
    if cfg.encoder == "intel":
        return {"LIBVA_DRIVER_NAME": "iHD"}
    if cfg.encoder == "radeon":
        return {"LIBVA_DRIVER_NAME": "radeonsi"}
    return {"LIBVA_DRIVER_NAME": None}


def ffmpeg_encode_args(cfg: EncodingConfig, ass_path: str, test: bool = False) -> dict:
    """자막 burn-in용 ffmpeg 인자 조각 (ffmpegEncodeArgs 포팅).

    test=True: 자막 싱크 검증용 360p 다운스케일 + quality +12(최대 51) + 최고속 프리셋.
    (-t 600은 convert.py가 별도로 추가)
    """
    q = str(min(51, cfg.quality + 12) if test else cfg.quality)
    scale = "scale=-2:360," if test else ""
    if cfg.encoder == "software":
        return {
            "pre_input": [],
            "vf": f"{scale}ass={ass_path},format=yuv420p",
            "codec": ["-c:v", "libx264", "-preset", "ultrafast" if test else "veryfast", "-crf", q],
        }
    if cfg.encoder == "nvidia":
        return {
            "pre_input": [],
            "vf": f"{scale}ass={ass_path},format=yuv420p",
            "codec": ["-c:v", "h264_nvenc", "-preset", "p1" if test else "p4", "-cq", q],
        }
    # intel / radeon (VA-API)
    return {
        "pre_input": ["-vaapi_device", cfg.vaapi_device],
        "vf": f"{scale}ass={ass_path},format=nv12,hwupload",
        "codec": ["-c:v", "h264_vaapi", "-qp", q],
    }
