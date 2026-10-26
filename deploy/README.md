# AniHy deploy — 프로덕션 배포 키트

신 스택(`server/` + `web/`)의 **프로덕션 배포**용 파일 모음.

> ⚠️ 아직 실제 배포에 사용된 적 없는 미검증 키트다 — 첫 배포는 절차 검증을 겸한다.
> 개발 환경(vite dev 서버 + 수동 실행 uvicorn) 구축에는 사용하지 않는다.

## 구성

| 파일 | 역할 |
|------|------|
| `deploy.sh` | 배포/업데이트 런북 (멱등 — 몇 번 실행해도 같은 상태로 수렴) |
| `apache/anihy.conf` | Apache conf — SPA 정적 서빙 + API 리버스 프록시 (예시 프리픽스 `/anime`) |
| `systemd/anihy-server.service` | uvicorn 상주 유닛 (**workers=1 필수**, 사유는 파일 주석 참조) |

개발 모드와 배포 모드의 차이, URL 프리픽스 지정 방법은 루트 [README](../README.md) 참조.

## deploy.sh가 하는 일

1. `git pull --ff-only`
2. `web/` 빌드 (`pnpm install --frozen-lockfile && pnpm build` → `web/dist`)
3. `server/.venv` 생성 + Python 의존성 설치
4. `server/.env` 없으면 템플릿에서 생성 (시크릿 대화형 입력)
5. `alembic upgrade head` (신규 3개 테이블만 — 레거시 테이블은 `sql/`이 담당)
6. systemd 유닛 설치/갱신 + `anihy-server` 재시작
7. Apache conf를 `conf-available/anihy.conf`로 설치 (**활성화는 하지 않음**)
8. 스모크 체크 (`curl 127.0.0.1:8000/api/health`)

실패하면 중간에서 멈추고, 다시 실행하면 이어서 진행된다.

## 사전 준비 (수동)

1. `server/.env` 값 — `server/README.md`의 설정 표 참조. 서브경로 배포면
   `PUBLIC_FILES_PREFIX`를 `<prefix>/api/files`로 (예: `/anime/api/files`)
2. DB 스키마: 신규 DB면 `mysql < sql/init.sql` (레거시 전체 테이블 포함)
3. 쓰기 권한: `animes/ covers/ subtitles/ logs/ downloader/videos/` — www-data
4. 외부 바이너리: `downloader/aniDL`, `smi2ass/smi2ass`, ffmpeg (+ 하드웨어 인코더 드라이버)
5. 폰트: `assets/fonts/`에 `fonts.conf`(example 참조)와 폰트 파일 배치

## 사용법

```bash
sudo bash deploy/deploy.sh                 # 전체
sudo bash deploy/deploy.sh --skip-web      # 서버만 갱신 (웹 빌드 생략)
sudo ANIHY_REPO_DIR=/path/to/checkout bash deploy/deploy.sh   # 체크아웃 경로 지정
```

`ANIHY_REPO_DIR`(기본 `/var/www/html/anime`)은 배포할 git 체크아웃 경로.
systemd 유닛과 Apache conf 안의 기본 경로도 설치 시점에 이 값으로 치환된다.

Apache conf 활성화는 수동이다 — 활성화하는 순간 해당 프리픽스의 라이브 서빙이
신 스택으로 바뀐다:

```bash
sudo a2enconf anihy && sudo systemctl reload apache2
curl -fsS https://<도메인>/anime/api/health
```

첫 활성화 전에 같은 프리픽스를 서빙하는 기존 Alias/conf가 있으면 먼저 제거할 것.

## Apache 운영 주의점

conf 주석에 상세가 있지만 요약하면:

- **에러 응답(4xx/5xx)과 접두사 리다이렉트에 `Cache-Control: no-store`** — iOS Safari가
  헤더 없는 에러 응답을 휴리스틱 캐시하는 사고 방지
- SSE 엔드포인트는 `flushpackets=on` + no-gzip 필수 (회차 조회 스트림, 잡 로그)
- ZIP 전체 다운로드 등 장기 요청 때문에 `ProxyTimeout 1800`
- uvicorn은 **workers=1 고정** — 병렬 인코딩 수는 `.env`의 `MAX_WORKERS`로만 조절

## 배포 후 검증

`server/README.md`의 "프로덕션 수동 E2E 체크리스트" 전부 통과할 것.
모바일 앱은 `app/README.md`의 빌드 머신 검증 사항도 함께.
