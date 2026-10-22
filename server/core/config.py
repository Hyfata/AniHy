"""AniHy 서버 설정 — 기존 inc/db.php.inc + inc/configuration.php.inc + inc/auth.php.inc 통합."""
from enum import StrEnum
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

SERVER_DIR = Path(__file__).resolve().parent.parent
DEFAULT_BASE_DIR = SERVER_DIR.parent


class Encoder(StrEnum):
    software = "software"
    intel = "intel"
    radeon = "radeon"
    nvidia = "nvidia"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=SERVER_DIR / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    # DB (MariaDB anime_site)
    db_url: str = "mysql+pymysql://anime:password@127.0.0.1:3306/anime_site?charset=utf8mb4"

    # 쿠키 서명 시크릿 (settings 테이블 cookie_secret보다 우선)
    cookie_secret: str = "REPLACE_WITH_A_RANDOM_SECRET"
    # 접근 코드 폴리백 (settings.access_code가 없을 때만)
    access_code_fallback: str = ""

    base_dir: Path = DEFAULT_BASE_DIR

    # Keycloak OIDC (플레이스홀더 — 비어 있으면 로그인 501)
    keycloak_issuer: str = ""
    keycloak_client_id: str = ""
    keycloak_client_secret: str = ""
    keycloak_redirect_uri: str = "http://localhost:8000/api/auth/callback"

    # 인코딩 설정 (기존 inc/configuration.php, 잡 파이프라인에서 사용)
    encoder: Encoder = Encoder.software
    max_workers: int = 1
    vaapi_device: str = "/dev/dri/renderD128"
    quality: int = 23

    # 서버 파일 소스 루트 (기존 api/list_server_files.php 하드코딩 이전, realpath 탈출 검사 필수)
    anidown_server_files_root: Path = Path("/var/lib/transmission-daemon/downloads")

    # /api/files URL의 외부 공개 프리픽스 — 서브경로 배포(Apache /anime/api 프록시) 시
    # "/anime/api/files"로 설정. 낮은 레벨 URL 헬퍼(services/urls.py)가 사용.
    public_files_prefix: str = "/api/files"

    @property
    def keycloak_configured(self) -> bool:
        return bool(self.keycloak_issuer and self.keycloak_client_id)


@lru_cache
def get_settings() -> Settings:
    return Settings()
