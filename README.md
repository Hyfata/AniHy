# AniHy

Crunchyroll이나 Hidive에서 애니메이션을 다운로드하고 자막과 합성하여 웹에서 스트리밍할 수 있는 개인용 애니 스트리밍 사이트입니다.

## 개요

- **서비스 언어**: 한국어
- **진입점**: `/anime/` (Apache 서브 디렉터리로 동작)
- 관리자 로그인 후 애니메이션과 에피소드를 등록·수정·삭제할 수 있습니다.
- 에피소드 등록 시 Crunchyroll/Hidive 시즌 ID를 입력하면 백그라운드에서 다운로드 → 복호화 → 자막 처리 → MP4 변환이 진행됩니다.
- 로컬 파일 업로드나 서버에 이미 있는 파일(예: Transmission 다운로드 폴더)을 선택해 변환할 수도 있고, **일괄 추가**로 여러 회차를 한 번에 등록할 수도 있습니다.
- 제목 검색(한글 로마자 근사 매칭 포함), 인기 검색어, 방영 분기별 필터를 제공합니다.

## 기술 스택

| 구성 요소 | 사용 기술 |
|-----------|-----------|
| 백엔드 | FastAPI (Python 3.12, SQLAlchemy, Alembic) — `server/` |
| 프론트엔드 | React SPA (TanStack Query, zustand, Vite) — `web/` |
| 모바일 앱 | Tauri 2 (Android/iOS) — `app/` |
| 데이터베이스 | MariaDB / MySQL |
| 웹 서버 | Apache (정적 서빙 + `/anime/api` 리버스 프록시) |
| 플레이어 | [Hyfata-Media-Player-JS](https://github.com/Hyfata/Hyfata-Media-Player-JS) (`assets/player` 서브모듈) |
| 미디어 처리 | ffmpeg 6.x, Bento4(mp4decrypt), 인코딩 백엔드 선택 가능(CPU libx264 / Intel VA-API / AMD VA-API / NVIDIA NVENC) |
| 다운로더 | [multi-downloader-nx](https://github.com/anidl/multi-downloader-nx) (Crunchyroll/Hidive 지원) — `downloader/` |
| 자막 변환 | [smi2ass](https://github.com/najoan125/smi2ass) (SMI → ASS) |

## 디렉터리 구조

```
anime/
├── server/             # FastAPI 백엔드 (API + 인코딩 잡 파이프라인)
├── web/                # React SPA (vite build → web/dist)
├── app/                # Tauri 2 모바일 앱
├── deploy/             # 배포 런북(migrate.sh) + Apache/systemd 설정
├── animes/             # 최종 변환된 에피소드 MP4 저장소
├── assets/             # 폰트, Hyfata-Media-Player-JS(서브모듈)
├── covers/             # 애니 커버 이미지
├── downloader/         # aniDL 바이너리 및 설정, 다운로드 임시본(videos/)
├── logs/               # 서버/잡 로그
├── smi2ass/            # SMI → ASS 변환 바이너리
├── sql/                # DB 초기화(init.sql) + migrations/
└── subtitles/          # 변환된 ASS 자막 저장소 ({anime_id}/{회차}.ass)
```

구 PHP 스택(루트 *.php, admin/, api/, inc/, worker/)은 2026-10에 삭제되었습니다. Git 히스토리/구 브랜치에서 확인할 수 있습니다.

## 설치 및 실행

각 컴포넌트의 README를 따릅니다.

- 백엔드: [server/README.md](server/README.md) (venv, .env, Alembic, uvicorn)
- 프론트엔드: [web/README.md](web/README.md) (pnpm, vite)
- 모바일 앱: [app/README.md](app/README.md) (Tauri 빌드 머신)
- 배포/컷오버: [deploy/README.md](deploy/README.md) (`deploy/migrate.sh` 런북)

## 개발

### downloader 설정

`downloader/` 폴더에는 [multi-downloader-nx](https://github.com/anidl/multi-downloader-nx) 저장소의 파일들을 주입해야 합니다. 해당 프로젝트를 클론 또는 빌드한 뒤, 바이너리 및 `config/` 파일들을 `downloader/` 아래에 배치하세요. 스트리밍 다운로드/영어 자막 다운로드는 서버가 `downloader/crdn.sh`(Crunchyroll) 또는 `downloader/hidn.sh`(Hidive)를 실행해 처리합니다.

### 인코딩 설정

`server/.env`에서 인코딩 하드웨어와 동시 인코딩 수를 설정합니다.

| 항목 | 값 | 설명 |
|------|-----|------|
| `ENCODER` | `software` \| `intel` \| `radeon` \| `nvidia` | CPU libx264 / Intel VA-API / AMD VA-API / NVIDIA NVENC |
| `MAX_WORKERS` | 1 이상 | 동시에 돌릴 인코딩 수. VA-API 1, NVENC 2~4 권장 |
| `VAAPI_DEVICE` | 경로 | VA-API 렌더 노드 (intel/radeon만 사용, 기본 `/dev/dri/renderD128`) |
| `QUALITY` | 0~51 | 낮을수록 고화질 (intel/radeon `-qp`, software `-crf`, nvidia `-cq`) |

큐 매니저가 매 루프 `.env`를 다시 읽으므로 값 변경은 다음 job부터 반영됩니다.

## 보안 주의사항

- 접근 인증번호와 쿠키 서명용 비밀키는 DB의 `settings` 테이블에, Keycloak/DB 접속 정보 등은 `server/.env`에 저장됩니다. 이 프로젝트가 오픈소스이므로 이러한 값을 소스 코드에 하드코딩하지 않도록 주의하세요.
- `downloader/`, `logs/`, `sql/`, `server/` 등 내부 디렉터리는 `deploy/apache/anihy.conf`를 통해 웹에서 직접 접근할 수 없습니다.
- 미디어 파일은 정적 노출 없이 FastAPI `/api/files/*` 경유로만 서빙되며, 서버가 접근 쿠키를 검사합니다.
- 접근 인증 쿠키는 `HttpOnly`, `Secure`(HTTPS 환경), `SameSite=Lax`, 10년 만료로 설정됩니다. 외부 사이트에서의 직접 링크 클릭 시에도 쿠키가 전달되도록 `Lax`를 사용합니다.
- 파일 업로드는 확장자만 검증합니다. 필요 시 MIME/type 검사를 추가하세요.
- 다운로더를 사용할 때는 Crunchyroll/Hidive 이용약관 및 관련 법규를 준수하세요.

## 라이선스

이 프로젝트는 개인적인 학습 및 비상업적 용도로만 사용하세요. 다운로드한 콘텐츠의 재배포는 금지됩니다.
