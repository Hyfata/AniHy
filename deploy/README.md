# AniHy deploy — 신규 스택(server/ + web/) 배포 & 컷오버

구 PHP SSR 스택(루트 *.php, api/, inc/, worker/)을 FastAPI(`server/`) + React SPA(`web/`)
스택으로 교체하는 절차. **구 PHP 파일과 native/는 프로덕션 E2E 검증이 끝날 때까지
삭제하지 않는다** — 롤백 경로이므로 컷오버 후에도 검증 완료까지 그대로 둔다.

## 아키텍처 / 경로 매핑 (핵심 결정)

```
브라우저
  ├─ /anime/...        → Apache Alias → web/dist (React SPA 정적, BrowserRouter basename /anime)
  └─ /anime/api/...    → Apache ProxyPass → http://127.0.0.1:8000/api/... (FastAPI, uvicorn)
```

- FastAPI 라우터는 전부 `/api` 프리픽스(server/main.py). Apache가 `/anime` 접두사만 떼고 넘긴다
  (`deploy/apache/anihy.conf`의 `ProxyPass /anime/api http://127.0.0.1:8000/api`).
- 미디어(영상/커버/썸네일/챕터/자막)는 정적 노출 없이 전부 FastAPI `/api/files/*` 경유
  (서버가 접근 쿠키를 검사). 외부 URL 프리픽스는 `server/.env`의
  `PUBLIC_FILES_PREFIX=/anime/api/files`로 맞춘다 (services/urls.py).
- 웹의 API 호출 베이스는 `web/src/api/client.ts: API_BASE`가 `/anime` 접두사를 감지해
  자동으로 `/anime/api`를 쓴다.
- uvicorn은 **workers=1 고정** — 잡 큐 매니저가 인프로세스 asyncio 큐라 워커를 늘리면
  큐가 중복 기동된다 (deploy/systemd/anihy-server.service 주석 참조). 병렬 인코딩 수는
  `.env`의 `MAX_WORKERS`로 조절(매 루프 hot-reload).

## 사전 준비 (수동)

1. `server/.env` 작성 (`cp server/.env.example server/.env`):
   - `DB_URL` — 기존 MariaDB `anime_site` 그대로.
   - `COOKIE_SECRET` — 랜덤 값 (migrate.sh가 자동 생성).
   - **Keycloak 값**: `KEYCLOAK_ISSUER/CLIENT_ID/CLIENT_SECRET` +
     `KEYCLOAK_REDIRECT_URI=https://<도메인>/anime/api/auth/callback`.
     Keycloak 클라이언트에도 동일 redirect URI 등록, realm role `admin` 생성.
     비워 두면 `/api/auth/login`이 501 — 로그인 없이는 북마크/시청기록/관리자 기능 불가.
   - `PUBLIC_FILES_PREFIX=/anime/api/files`
   - `ENCODER/MAX_WORKERS/QUALITY/VAAPI_DEVICE` — 기존 inc/configuration.php 값 이관.
2. DB 스키마: 기존 운영 DB는 레거시 마이그레이션까지 적용돼 있음. 신규 DB면
   `sql/init.sql` + `sql/migrations/*.sql` 순서 적용 후 `alembic upgrade head`
   (Alembic은 신규 3개 테이블 users/watch_history/bookmarks만 관리).
3. 쓰기 권한: `animes/ covers/ subtitles/ logs/ downloader/videos/` — www-data.
4. 외부 바이너리: `downloader/aniDL`, `smi2ass/smi2ass`, ffmpeg (+ 하드웨어 인코더 드라이버).
5. DNS/URL: 사이트는 기존과 같은 `https://<도메인>/anime` 경로 유지 — 북마크/공유 링크 무효화 없음.

## 배포 절차

1. `sudo bash deploy/migrate.sh` — pull, web 빌드, venv/의존성, alembic, systemd 설치+기동,
   Apache conf 복사(비활성) + 스모크(`curl http://127.0.0.1:8000/api/health`). 멱등.
2. 스테이징 검증 (권장): 컷오버 전에 Apache에 임시 경로로 먼저 띄운다.
   `deploy/apache/anihy.conf`를 복사해 `/anime` → `/anime-new`로 바꾼 버전을 만들고
   (Alias/ProxyPass/RewriteBase/LocationMatch 전부), 이 경우 웹이 `/anime-new`를 감지하지
   못하므로(API_BASE 판별이 `/anime` 고정) 스테이징에서는 `:8000` 직접 접속 + vite dev보다는
   **별도 vhost/포트에서 루트(/) 서빙**을 권장한다 — basename `/` + `/api` 직결은
   코드 수정 없이 동작한다.
3. **프로덕션 E2E 체크리스트 전부 통과** — `server/README.md` "프로덕션 수동 E2E
   체크리스트" 11개 항목(스트리밍/업로드+SMI/smi2ass 실패/서버 파일/동시성 hot-reload/
   is_test/중지·재시도/싱크·트림/챕터·썸네일/aniDL SSE/idle 종료). 모바일은
   `app/README.md`의 빌드 머신 검증 사항도 함께.
4. 컷오버:
   ```bash
   sudo a2disconf anihy              # 구 PHP conf (쿠키 게이트 + 디렉터리 차단)
   # 구 사이트의 "Alias /anime /var/www/html/anime" 지시자도 제거/주석 (vhost 쪽)
   sudo a2enconf anihy-new           # deploy/migrate.sh가 복사해 둔 신 conf
   sudo systemctl reload apache2
   curl -fsS https://<도메인>/anime/api/health
   ```
5. 롤백: `a2disconf anihy-new && a2enconf anihy && systemctl reload apache2` +
   `systemctl stop anihy-server`. 구 파일이 그대로라 즉시 복귀 가능.

## PHP/native 삭제 기준 (컷오버 후)

구 PHP 스택(루트 *.php, admin/, api/, inc/, worker/)은 **삭제 완료(2026-10)** —
사용자 지시로 체크리스트 완료 전에 삭제됨(구 브랜치에 분리 보존). 아래 체크리스트는
프로덕션 컷오버 확정용으로 계속 유효:

- [ ] server/README.md의 프로덕션 E2E 11개 항목 통과
- [ ] 최소 1주간 실사용에서 인코딩 잡/다운로드/인증 장애 없음
- [ ] Keycloak 로그인 + admin 판정 실계정 확인
- [ ] 모바일 앱(app/) 실기기 체크리스트(app/README.md) 통과 — 앱이 서버 신규 API에 의존
- [ ] 롤백 없이 운영 확정 → 그 때 native/ 삭제 + sql/은 DB 덤프 후 보관

`deploy/apache/anihy.conf`의 디렉터리 차단 블록에서 삭제된 inc/, worker/는 정리됨 —
단 `downloader/`(aniDL, config, videos), `logs/`, `smi2ass/`는 신규 스택도 쓰므로 지우면 안 된다.
