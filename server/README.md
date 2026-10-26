# AniHy server (FastAPI)

FastAPI 백엔드 — 인증(접근 게이트 + Keycloak OIDC), 전체 API 라우터, 인코딩 잡 파이프라인(`worker/`).

## Setup

```bash
python3.12 -m venv server/.venv
server/.venv/bin/pip install -e 'server'  # 또는 pyproject 의존성을 직접 설치
```

pyproject에 패키지 빌드 설정이 없으면 위 editable install 대신 수동 설치:

```bash
server/.venv/bin/pip install fastapi 'uvicorn[standard]' 'sqlalchemy>=2' alembic pymysql cryptography pydantic-settings itsdangerous authlib httpx python-multipart pytest
```

1. `cp server/.env.example server/.env` 후 실제 값 입력 (아래 설정 표 참조).
2. DB 스키마: 신규 DB면 `mysql < sql/init.sql` (레거시 전체 테이블 포함, 기존 DB면 이미 적용됨). **Alembic은 신규 3개 테이블(users, watch_history, bookmarks)만 관리**한다 — 기존 테이블을 마이그레이션으로 재생성하지 않음.
3. 신규 테이블 적용:

```bash
cd server && .venv/bin/alembic upgrade head
```

## DB 스키마

레거시 6개 테이블은 `sql/init.sql`, 신규 3개 테이블(users, watch_history, bookmarks)은
Alembic(`server/alembic/versions/0001_new_user_tables.py`)이 관리한다.

| 테이블 | 용도 | 주요 컬럼 / 제약 |
|--------|------|------------------|
| `animes` | 애니 메타 | `title`, `cover_image`, `season_id`(스트리밍 시즌 ID), `is_hidive`, `broadcast_year/quarter/day`, `description` 등 |
| `anime_broadcasts` | 방영 분기 (복수) | UNIQUE(`anime_id`, `broadcast_year`, `broadcast_quarter`), FK → animes (CASCADE) |
| `episodes` | 회차 | `episode_number VARCHAR(50)`, `file_path`, `duration_ms`(UNSIGNED), 자막 파일들, UNIQUE(`anime_id`, `episode_number`), FK → animes (CASCADE) |
| `jobs` | 인코딩 잡 | `status` ENUM(pending/downloading/downloading_subs/preparing/encoding/remuxing/subtitling/completed/failed), `source_type` ENUM(download/upload/server), `is_test`, `trim_seconds`, `subtitle_offset`, `encoder`, `source_name`, `worker_pid` |
| `settings` | 키-값 설정 | `access_code`, `cookie_secret` 등 (`key` PK) |
| `search_hits` | 인기 검색어 집계 | `anime_id` PK, `hit_count`, `last_hit_at`, FK → animes (CASCADE) |
| `users` | 로그인 사용자 (Alembic) | `external_sub`(Keycloak sub, UNIQUE), `display_name`, `is_admin` |
| `watch_history` | 시청 기록 (Alembic) | `position_ms`/`duration_ms`, `completed`, UNIQUE(`user_id`, `anime_id`, `episode_number`), FK → users/animes (CASCADE) |
| `bookmarks` | 북마크 (Alembic) | UNIQUE(`user_id`, `anime_id`), FK → users/animes (CASCADE) |

주요 규약:

- `episode_number`는 `VARCHAR(50)` — `'0.5'`, `'OVA'` 같은 비정수 회차를 허용한다.
- 방영 분기는 `anime_broadcasts`(복수)가 정본이고, `animes.broadcast_year/quarter`는 첫 분기 미러다 — 미러 컬럼을 직접 UPDATE하지 말고 서버의 저장 로직을 거친다.
- `jobs`는 같은 `anime_id + episode_number`에 진행 중(completed/failed 아님) 잡이 있으면 추가를 거부한다.
- `watch_history.completed`는 `position_ms / duration_ms`가 일정 비율(COMPLETED_RATIO) 이상일 때. bulk 동기화는 `updated_at` 최신 우선.

## Run

```bash
server/.venv/bin/uvicorn server.main:app --reload   # 프로젝트 루트에서
# http://127.0.0.1:8000/api/health, /api/docs
```

⚠️ 프로덕션(systemd 유닛 포함)에서는 **uvicorn workers=1 필수** — 잡 큐 매니저가
uvicorn 프로세스 안의 인프로세스 asyncio 큐라서 워커를 2개 이상 띄우면 큐가 중복 기동되고
`logs/queue.lock`이 상호 충돌한다. 병렬 인코딩 수는 `.env`의 `MAX_WORKERS`로만 조절.

## Test

```bash
server/.venv/bin/python -m pytest server/tests -q
```

MySQL 없이 sqlite 인메모리로 self-contained.

## 설정 (.env)

`server/.env.example`에 전체 목록과 주석이 있다. `core/config.py`의 `Settings`가 읽는다.

| 변수 | 용도 | 기본값 |
|------|------|--------|
| `DB_URL` | MariaDB 접속 (SQLAlchemy URL) | `mysql+pymysql://...@127.0.0.1:3306/anime_site` |
| `COOKIE_SECRET` | 서명 쿠키 시크릿 (랜덤 필수) | — |
| `ACCESS_CODE_FALLBACK` | 접근 코드 폴리백 (DB `settings.access_code`가 우선) | 빈 값 |
| `BASE_DIR` | `animes/ covers/ subtitles/ logs/ assets/fonts`의 부모 디렉터리 | repo 루트 |
| `KEYCLOAK_ISSUER/CLIENT_ID/CLIENT_SECRET/REDIRECT_URI` | Keycloak OIDC — 비어 있으면 `/api/auth/login`이 501 | 빈 값 |
| `ENCODER` | `software` \| `intel` \| `radeon` \| `nvidia` | `software` |
| `MAX_WORKERS` | 동시 인코딩 수 (**매 루프 hot-reload**) | 1 |
| `VAAPI_DEVICE` | VA-API 렌더 노드 (intel/radeon만) | `/dev/dri/renderD128` |
| `QUALITY` | 0~51, 낮을수록 고화질 | 23 |
| `ANIDOWN_SERVER_FILES_ROOT` | 서버 파일 소스 루트 (realpath 탈출 검사) | `/var/lib/transmission-daemon/downloads` |
| `PUBLIC_FILES_PREFIX` | 서버가 생성하는 미디어 URL의 외부 프리픽스. 서브경로 배포 시 `<prefix>/api/files`로 반드시 맞출 것 | `/api/files` |

`MAX_WORKERS` 외 인코딩 값(`ENCODER`/`QUALITY` 등)은 실행 중인 큐 매니저에 즉시 반영되지
않지만, 매니저가 30초 idle 후 자동 종료되고 다음 잡에서 다시 뜨므로 재시작 없이 다음 잡부터 적용된다.

## 런타임 외부 의존 (모두 `BASE_DIR` 기준)

- `assets/fonts/fonts.conf` + 폰트 파일 — 자막 burn-in 시 `FONTCONFIG_FILE`로 주입. gitignore 대상이라 `assets/fonts/fonts.conf.example`을 복사해 만들 것
- `downloader/aniDL` + `config/` — 스트리밍 다운로드/영어 자막 (루트 README "downloader 설정" 참조)
- `smi2ass/smi2ass` — SMI → ASS 변환 바이너리
- ffmpeg (+ 하드웨어 인코더 드라이버)

## Keycloak (OIDC) 설정

`.env`의 `KEYCLOAK_ISSUER/CLIENT_ID/CLIENT_SECRET`이 비어 있으면 `GET /api/auth/login`은 501과 안내 메시지를 반환한다. 실제 Keycloak 접속 정보를 채우면 된다 — 코드는 이미 실제 Authorization Code + PKCE 플로우로 작성됨.

로컬 개발용 Keycloak 컨테이너 예시:

```bash
docker run -p 8080:8080 -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
  quay.io/keycloak/keycloak:latest start-dev
# realm 생성 후 client 등록(redirect: http://localhost:8000/api/auth/callback), realm role 'admin' 생성
# KEYCLOAK_ISSUER=http://localhost:8080/realms/<realm>
```

관리자 판정은 토큰의 `realm_access.roles`에 `admin` 포함 여부 (클레임 부재 시 일반 사용자).

## 인증 구조 (요약)

1. 접근 코드 게이트: `POST /api/auth/gate` → `anihy_access` 서명 쿠키 (10년).
2. Keycloak 로그인: `/api/auth/login` → `/api/auth/callback` → `anihy_session` 서명 쿠키 (user_id + is_admin). `GET /api/auth/me`로 확인.

인증 실패는 리다이렉트가 아니라 **401** — fetch/다운로드 클라이언트가 로그인 HTML을
파일로 저장하는 사고 방지. 모든 라우터 공통.

## 잡 파이프라인 (worker/, 요약)

에피소드 추가 → `jobs` 테이블 INSERT(`pending`) → 인프로세스 큐 매니저(`worker/manager.py`,
`logs/queue.lock` PID 락, 30초 idle 종료)가 `worker/convert.py` 파이프라인(다운로드 →
복호화 → 자막 처리 → ffmpeg 인코딩)을 asyncio 태스크로 실행. 잡 로그는 `logs/job_{id}.log`,
큐 로그는 `logs/queue.log`. 파이프라인 규약 상세는 두 파일의 헤더 주석 참조.

## 프로덕션 수동 E2E 체크리스트 (dev 머신에서는 ffmpeg/aniDL/smi2ass/MariaDB 실구동 불가)

1. **스트리밍 소스 1화**: 관리자로 에피소드 추가(시즌 ID) → 대기열 모달에서 downloading→preparing→encoding→completed 상태 전이와 진행률 % 확인 → `logs/job_{id}.log`에 다운로드/smi2ass/Encode cmd 기록 확인 → 재생.
2. **업로드 소스 + SMI 자막**: mkv + .smi 업로드로 추가 → smi2ass 변환 로그, 클래스 전처리 패치 로그(`Patched N SYNC block(s)`), 완성본에 한글 자막 burn-in 확인.
3. **smi2ass 실패 경로**: 깨진 SMI 업로드 → job failed, 메시지에 보존 경로 표시, `subtitles/failed/job_{id}_*.smi` 존재, `재시도` 시 원본이 원위치 복구되는지 확인.
4. **서버 파일 소스**: `GET /api/server-files` 목록 → 선택 추가 → `source_type=server`, `source_name` 기록 확인.
5. **동시성/hot-reload**: `MAX_WORKERS=2`로 2개 동시 인코딩 확인, 실행 중 .env의 MAX_WORKERS 변경이 다음 잡부터 반영되는지 `logs/queue.log`의 `max_workers changed`로 확인.
6. **is_test**: 체크 후 추가 → `jobs.encoder`에 ` (테스트)` 접미사, 360p/10분 캡 결과물.
7. **중지/재시도**: 인코딩 중 중지 → failed + "사용자가 작업을 중지했습니다."; 실패 잡 재시도 → pending 복귀 + 큐 기동.
8. **싱크/트림**: subtitle_offset ±값, trim_seconds 적용 결과물 확인.
9. **챕터/썸네일**: 완료 후 `animes/{aid}/{ep}.chapters.vtt`와 `{ep}.jpg`(50% 지점 480px) 생성 확인.
10. **aniDL 검색/SSE**: `GET /api/anidown/search?keyword=...` plain text, `GET /api/anidown/episodes?season_id=...` SSE 스트림 확인.
11. **idle 종료/재기동**: 잡 완료 30초 후 큐 매니저 종료(`Idle timeout, exiting`), 새 잡 추가 시 재기동 확인.
