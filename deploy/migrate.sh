#!/usr/bin/env bash
# AniHy 신규 스택(server/ + web/) 마이그레이션 런북 스크립트.
#
# 목적: 레포 pull → web 빌드 → server 의존성/DB → systemd/Apache 설치 →
#       서비스 재시작 → 스모크 체크까지를 멱등(idempotent)하게 수행.
#       몇 번을 실행해도 같은 상태로 수렴한다. 실패 시 중간에서 멈추고
#       다시 실행하면 이어서 진행된다.
#
# ⚠️ 컷오버 전제: 구 PHP 사이트는 그대로 둔다(삭제 금지).
#   이 스크립트는 신규 스택을 "설치"만 하고, /anime 컷오버(구 conf 제거 →
#   신 conf 활성화)는 수행하지 않는다. 컷오버는 deploy/README.md 체크리스트에
#   따라 수동으로 진행. 권장 순서:
#     1) 이 스크립트로 신규 스택 설치 + :8000 직접 스모크
#     2) Apache 스테이징 경로(/anime-new)로 브라우저 E2E (deploy/README.md §스테이징)
#     3) server/README.md의 프로덕션 E2E 11개 항목 전부 통과
#     4) 컷오버 + 롤백 준비(구 conf 즉시 복구 가능 상태 유지)
#
# 사용: sudo bash deploy/migrate.sh            # 전체
#       sudo bash deploy/migrate.sh --skip-web # 서버만 갱신(웹 빌드 생략)

set -euo pipefail

# ── 경로 상수 (프로덕션 레이아웃) ─────────────────────────────────
REPO_DIR="/var/www/html/anime"          # git 체크아웃 = 프로젝트 루트
WEB_DIR="$REPO_DIR/web"
SERVER_DIR="$REPO_DIR/server"
VENV="$SERVER_DIR/.venv"
UNIT_SRC="$REPO_DIR/deploy/systemd/anihy-server.service"
UNIT_DST="/etc/systemd/system/anihy-server.service"
APACHE_SRC="$REPO_DIR/deploy/apache/anihy.conf"
APACHE_DST="/etc/apache2/conf-available/anihy-new.conf"  # 구 anihy.conf와 공존용 이름

SKIP_WEB=0
[ "${1:-}" = "--skip-web" ] && SKIP_WEB=1

log() { printf '\n=== %s ===\n' "$*"; }

# ── 1. 레포 갱신 ─────────────────────────────────────────────────
# 배포 브랜치가 main이 아니면 환경에 맞게 수정.
log "git pull"
git -C "$REPO_DIR" pull --ff-only

# ── 2. 웹 빌드 (web/dist 산출) ──────────────────────────────────
# pnpm이 없으면: corepack enable && corepack prepare pnpm@latest --activate
if [ "$SKIP_WEB" -eq 0 ]; then
    log "web build (pnpm)"
    (cd "$WEB_DIR" && pnpm install --frozen-lockfile && pnpm build)
    # vite 산출물을 Apache가 읽을 수 있게
    chown -R root:www-data "$WEB_DIR/dist"
    chmod -R o+rX "$WEB_DIR/dist"
else
    log "web build skipped"
fi

# ── 3. Python venv + 의존성 ──────────────────────────────────────
log "server deps"
if [ ! -x "$VENV/bin/python" ]; then
    python3.12 -m venv "$VENV"
fi
# pyproject editable install이 안 되는 구성이면 requirements 방식으로 교체
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet -e "$REPO_DIR" || \
"$VENV/bin/pip" install --quiet \
    fastapi 'uvicorn[standard]' 'sqlalchemy>=2' alembic pymysql cryptography \
    pydantic-settings itsdangerous authlib httpx python-multipart

# ── 4. server/.env ───────────────────────────────────────────────
# 없으면 템플릿에서 만들고 시크릿 입력을 요구한다(대화형).
# 이미 있으면 건드리지 않는다 — 멱등성의 핵심.
if [ ! -f "$SERVER_DIR/.env" ]; then
    log "server/.env 생성 (시크릿 입력 필요)"
    cp "$SERVER_DIR/.env.example" "$SERVER_DIR/.env"
    SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    sed -i "s/^COOKIE_SECRET=.*/COOKIE_SECRET=$SECRET/" "$SERVER_DIR/.env"
    echo "COOKIE_SECRET은 랜덤 생성됨. 아래 값은 지금 편집할 것:"
    echo "  - DB_URL (MariaDB anime_site 계정)"
    echo "  - KEYCLOAK_ISSUER / KEYCLOAK_CLIENT_ID / KEYCLOAK_CLIENT_SECRET"
    echo "  - KEYCLOAK_REDIRECT_URI=https://<도메인>/anime/api/auth/callback"
    echo "  - ENCODER / MAX_WORKERS / QUALITY"
    read -r -p "지금 $SERVER_DIR/.env 를 편집하시겠습니까? [Y/n] " ans
    if [ "${ans:-Y}" != "n" ]; then
        "${EDITOR:-vi}" "$SERVER_DIR/.env"
    fi
    chmod 640 "$SERVER_DIR/.env"
    chown root:www-data "$SERVER_DIR/.env"
fi

# ── 5. DB 스키마 ────────────────────────────────────────────────
# 레거시 6개 테이블(animes/episodes/jobs/...)은 이미 sql/init.sql +
# sql/migrations/*.sql로 적용돼 있다고 가정(기존 운영 DB).
# 신규 DB라면 먼저:
#   mysql anime_site < sql/init.sql
#   for f in sql/migrations/*.sql; do mysql anime_site < "$f"; done
# Alembic은 신규 3개 테이블(users, watch_history, bookmarks)만 관리한다.
log "alembic upgrade head"
(cd "$SERVER_DIR" && "$VENV/bin/alembic" upgrade head)

# ── 6. systemd 유닛 설치/갱신 ────────────────────────────────────
log "systemd unit"
if ! cmp -s "$UNIT_SRC" "$UNIT_DST" 2>/dev/null; then
    cp "$UNIT_SRC" "$UNIT_DST"
    systemctl daemon-reload
fi
systemctl enable anihy-server
systemctl restart anihy-server

# ── 7. Apache conf 설치 (활성화는 컷오버 시 수동) ────────────────
# 구 anihy.conf와 충돌하지 않도록 anihy-new.conf로만 복사해 둔다.
# a2enconf는 하지 않는다 — 컷오버 절차(deploy/README.md)에서 수행.
log "apache conf (설치만, 비활성)"
if ! cmp -s "$APACHE_SRC" "$APACHE_DST" 2>/dev/null; then
    cp "$APACHE_SRC" "$APACHE_DST"
fi
a2enmod proxy proxy_http rewrite headers >/dev/null

# ── 8. 스모크 체크 ───────────────────────────────────────────────
log "smoke checks"
sleep 2
# 8-1. uvicorn 직접 (Apache 경유 전 백엔드 자체 확인)
curl -fsS http://127.0.0.1:8000/api/health && echo
# 8-2. Apache 경유는 conf가 활성화된 뒤에만 가능:
#   curl -fsS "https://<도메인>/anime/api/health"
# 8-3. 큐 매니저 락 파일이 stale 상태로 남아 있으면 제거 안내
if [ -f "$REPO_DIR/logs/queue.lock" ]; then
    echo "note: logs/queue.lock 존재 — 실행 중 잡이 없다면 stale일 수 있음"
fi

log "done"
echo "다음 단계: deploy/README.md 컷오버 체크리스트"
echo "롤백 메모: 구 PHP 사이트 파일과 구 Apache conf는 그대로 있으므로,"
echo "  a2disconf anihy-new && a2enconf anihy && systemctl reload apache2"
echo "  + systemctl stop anihy-server 로 언제든 구 스택으로 복귀 가능."
