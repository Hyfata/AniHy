# AniHy server (FastAPI)

기존 PHP 백엔드(`api/`, `inc/`, `worker/`)를 대체하는 FastAPI 서버. 현재는 스캐폴드 단계 — 인증(접근 게이트 + Keycloak OIDC), 설정, DB 모델, 헬스체크만 구현됨. 잡 파이프라인과 대부분의 라우터는 미구현.

## Setup

```bash
python3.12 -m venv server/.venv
server/.venv/bin/pip install -e 'server'  # 또는 pyproject 의존성을 직접 설치
```

pyproject에 패키지 빌드 설정이 없으면 위 editable install 대신 수동 설치:

```bash
server/.venv/bin/pip install fastapi 'uvicorn[standard]' 'sqlalchemy>=2' alembic pymysql cryptography pydantic-settings itsdangerous authlib httpx python-multipart pytest
```

1. `cp server/.env.example server/.env` 후 `DB_URL`, `COOKIE_SECRET` 실제 값 입력.
2. DB 스키마: 기존 6개 테이블은 레거시 `sql/init.sql` + `sql/migrations/*.sql`로 먼저 적용(기존 DB면 이미 적용됨). **Alembic은 신규 3개 테이블(users, watch_history, bookmarks)만 관리**한다 — 기존 테이블을 마이그레이션으로 재생성하지 않음.
3. 신규 테이블 적용:

```bash
cd server && ../.venv/bin/alembic upgrade head
```

## Run

```bash
server/.venv/bin/uvicorn server.main:app --reload   # 프로젝트 루트에서
# http://127.0.0.1:8000/api/health, /api/docs
```

## Test

```bash
server/.venv/bin/python -m pytest server/tests -q
```

MySQL 없이 sqlite 인메모리로 self-contained.

## Keycloak (OIDC) 플레이스홀더

`.env`의 `KEYCLOAK_ISSUER/CLIENT_ID/CLIENT_SECRET`이 비어 있으면 `GET /api/auth/login`은 501과 안내 메시지를 반환한다. 실제 Keycloak 접속 정보를 받으면 값을 채우면 된다 — 코드는 이미 실제 Authorization Code + PKCE 플로우로 작성됨.

로컬 개발용 Keycloak 컨테이너 예시:

```bash
docker run -p 8080:8080 -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
  quay.io/keycloak/keycloak:latest start-dev
# realm 생성 후 client 등록(redirect: http://localhost:8000/api/auth/callback), realm role 'admin' 생성
# KEYCLOAK_ISSUER=http://localhost:8080/realms/<realm>
```

관리자 판정은 토큰의 `realm_access.roles`에 `admin` 포함 여부 (클레임 부재 시 일반 사용자).

## 인증 2층 구조

1. 접근 코드 게이트: `POST /api/auth/gate` → `anihy_access` 서명 쿠키 (기존 `inc/access_auth.php` 포팅, 10년).
2. Keycloak 로그인: `/api/auth/login` → `/api/auth/callback` → `anihy_session` 서명 쿠키 (user_id + is_admin). `GET /api/auth/me`로 확인.

**하드 규약**: 인증 실패는 302 리다이렉트가 아니라 **401** (`core/security.py` 상단 주석 참조 — 다운로드 라우터 추가 시에도 동일).

## 잡 파이프라인 (worker/)

- `worker/manager.py` — asyncio 인프로세스 큐 매니저 (`worker/queue.php` 포팅): `logs/queue.lock` PID 락, 1.5초 폴, `max_workers` 매 루프 hot-reload(.env 재읽기), 죽은 태스크 reap + failed 보정, 30초 idle 종료, 시작 시 임시 자막 GC. convert는 별도 프로세스가 아니라 asyncio 태스크 — `jobs.worker_pid`에는 서버 PID를 기록(best-effort)하며, 외부 프로세스가 남긴 orphan은 PID 감시로 adopt.
- `worker/convert.py` — `worker/convert.php` 포팅 전체 파이프라인. 하드 규약 전부 이식: smi2ass UTF-8 env 강제, SMI 최다 클래스 전처리, UTF-16 BOM 라운드트립, ASS-in-.smi 감지, `-KOR` 우선, Traceback/무산출물 → 실패 + SMI `subtitles/failed/` 보존, jpn 우선 오디오 AAC 규칙, is_test(360p + quality+12 + 최고속 프리셋 + `-t 600`), FONTCONFIG_FILE 유지.
- `worker/encoders.py` — `inc/encoding.php` 포팅. putenv 대신 서브프로세스 env dict 반환.

## 프로덕션 수동 E2E 체크리스트 (dev 머신에서는 ffmpeg/aniDL/smi2ass/MariaDB 실구동 불가)

1. **스트리밍 소스 1화**: 관리자로 에피소드 추가(시즌 ID) → 대기열 모달에서 downloading→preparing→encoding→completed 상태 전이와 진행률 % 확인 → `logs/job_{id}.log`에 다운로드/smi2ass/Encode cmd 기록 확인 → 재생.
2. **업로드 소스 + SMI 자막**: mkv + .smi 업로드로 추가 → smi2ass 변환 로그, 클래스 전처리 패치 로그(`Patched N SYNC block(s)`), 완성본에 한글 자막 burn-in 확인.
3. **smi2ass 실패 경로**: 깨진 SMI 업로드 → job failed, 메시지에 보존 경로 표시, `subtitles/failed/job_{id}_*.smi` 존재, `재시도` 시 원본이 원위치 복구되는지 확인.
4. **서버 파일 소스**: `GET /api/server-files` 목록 → 선택 추가 → `source_type=server`, `source_name` 기록 확인.
5. **동시성/hot-reload**: `max_workers=2`로 2개 동시 인코딩 확인, 실행 중 .env의 MAX_WORKERS 변경이 다음 잡부터 반영되는지 `logs/queue.log`의 `max_workers changed`로 확인.
6. **is_test**: 체크 후 추가 → `jobs.encoder`에 ` (테스트)` 접미사, 360p/10분 캡 결과물.
7. **중지/재시도**: 인코딩 중 중지 → failed + "사용자가 작업을 중지했습니다."; 실패 잡 재시도 → pending 복귀 + 큐 기동.
8. **싱크/트림**: subtitle_offset ±값, trim_seconds 적용 결과물 확인.
9. **챕터/썸네일**: 완료 후 `animes/{aid}/{ep}.chapters.vtt`와 `{ep}.jpg`(50% 지점 480px) 생성 확인.
10. **aniDL 검색/SSE**: `GET /api/anidown/search?keyword=...` plain text, `GET /api/anidown/episodes?season_id=...` SSE 스트림 확인.
11. **idle 종료/재기동**: 잡 완료 30초 후 큐 매니저 종료(`Idle timeout, exiting`), 새 잡 추가 시 재기동 확인.
