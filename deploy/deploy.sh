#!/usr/bin/env bash
# AniHy production deploy/update runbook (server/ + web/ stack).
#
# Idempotent: git pull -> web build -> server deps/DB schema -> systemd/Apache
# install -> service restart -> smoke check. Safe to re-run; a failed run can
# simply be repeated to continue.
#
# Targets a production-style deployment (built web/dist served by Apache,
# uvicorn under systemd). For a dev setup (vite dev server + manually run
# uvicorn) this script is not needed. See deploy/README.md.
#
# Usage:
#   sudo bash deploy/deploy.sh                 # full deploy
#   sudo bash deploy/deploy.sh --skip-web      # server only (skip web build)
#   sudo ANIHY_REPO_DIR=/path/to/checkout bash deploy/deploy.sh
#
# ANIHY_REPO_DIR is the git checkout to deploy (default below is an example
# production path). The systemd unit and Apache conf templates use that same
# default; this script rewrites it to ANIHY_REPO_DIR at install time.

set -euo pipefail

# ── Path constants ────────────────────────────────────────────────
REPO_DIR="${ANIHY_REPO_DIR:-/var/www/html/anime}"  # git checkout = project root
WEB_DIR="$REPO_DIR/web"
SERVER_DIR="$REPO_DIR/server"
VENV="$SERVER_DIR/.venv"
UNIT_SRC="$REPO_DIR/deploy/systemd/anihy-server.service"
UNIT_DST="/etc/systemd/system/anihy-server.service"
APACHE_SRC="$REPO_DIR/deploy/apache/anihy.conf"
APACHE_DST="/etc/apache2/conf-available/anihy.conf"
DEFAULT_REPO_DIR="/var/www/html/anime"

SKIP_WEB=0
[ "${1:-}" = "--skip-web" ] && SKIP_WEB=1

log() { printf '\n=== %s ===\n' "$*"; }

# render <src> <dst>: substitute the default repo path with $REPO_DIR and
# install only when changed (keeps the run idempotent).
render() {
    local src="$1" dst="$2" tmp
    tmp="$(mktemp)"
    sed "s|$DEFAULT_REPO_DIR|$REPO_DIR|g" "$src" > "$tmp"
    if ! cmp -s "$tmp" "$dst" 2>/dev/null; then
        cp "$tmp" "$dst"
        rm -f "$tmp"
        return 0
    fi
    rm -f "$tmp"
    return 1
}

# ── 1. Update the repo ────────────────────────────────────────────
# Adjust the branch if the deploy branch is not the current one.
log "git pull"
git -C "$REPO_DIR" pull --ff-only

# ── 2. Web build (produces web/dist) ──────────────────────────────
# If pnpm is missing: corepack enable && corepack prepare pnpm@latest --activate
if [ "$SKIP_WEB" -eq 0 ]; then
    log "web build (pnpm)"
    (cd "$WEB_DIR" && pnpm install --frozen-lockfile && pnpm build)
    # Make the vite output readable by Apache
    chown -R root:www-data "$WEB_DIR/dist"
    chmod -R o+rX "$WEB_DIR/dist"
else
    log "web build skipped"
fi

# ── 3. Python venv + dependencies ─────────────────────────────────
log "server deps"
if [ ! -x "$VENV/bin/python" ]; then
    python3.12 -m venv "$VENV"
fi
# Fall back to a manual package list if the editable install is not usable
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet -e "$REPO_DIR" || \
"$VENV/bin/pip" install --quiet \
    fastapi 'uvicorn[standard]' 'sqlalchemy>=2' alembic pymysql cryptography \
    pydantic-settings itsdangerous authlib httpx python-multipart

# ── 4. server/.env ────────────────────────────────────────────────
# Created from the template on first run (asks for secrets interactively).
# Left untouched when it already exists.
if [ ! -f "$SERVER_DIR/.env" ]; then
    log "create server/.env (secrets required)"
    cp "$SERVER_DIR/.env.example" "$SERVER_DIR/.env"
    SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    sed -i "s/^COOKIE_SECRET=.*/COOKIE_SECRET=$SECRET/" "$SERVER_DIR/.env"
    echo "COOKIE_SECRET was generated randomly. Fill in these values now:"
    echo "  - DB_URL (MariaDB anime_site account)"
    echo "  - KEYCLOAK_ISSUER / KEYCLOAK_CLIENT_ID / KEYCLOAK_CLIENT_SECRET"
    echo "  - KEYCLOAK_REDIRECT_URI=https://<domain><prefix>/api/auth/callback"
    echo "  - PUBLIC_FILES_PREFIX (when serving under a subpath, e.g. /anime/api/files)"
    echo "  - ENCODER / MAX_WORKERS / QUALITY"
    read -r -p "Edit $SERVER_DIR/.env now? [Y/n] " ans
    if [ "${ans:-Y}" != "n" ]; then
        "${EDITOR:-vi}" "$SERVER_DIR/.env"
    fi
    chmod 640 "$SERVER_DIR/.env"
    chown root:www-data "$SERVER_DIR/.env"
fi

# ── 5. DB schema ──────────────────────────────────────────────────
# The legacy tables (animes/episodes/jobs/...) come from sql/init.sql +
# sql/migrations/*.sql and are assumed to exist. For a fresh database run:
#   mysql anime_site < sql/init.sql
#   for f in sql/migrations/*.sql; do mysql anime_site < "$f"; done
# Alembic manages only the 3 new tables (users, watch_history, bookmarks).
log "alembic upgrade head"
(cd "$SERVER_DIR" && "$VENV/bin/alembic" upgrade head)

# ── 6. systemd unit install/update ────────────────────────────────
log "systemd unit"
if render "$UNIT_SRC" "$UNIT_DST"; then
    systemctl daemon-reload
fi
systemctl enable anihy-server
systemctl restart anihy-server

# ── 7. Apache conf install (activation stays manual) ──────────────
# The conf is only copied to conf-available; enabling it (a2enconf anihy)
# switches the live site, so it is done manually when ready.
log "apache conf (installed, not enabled)"
render "$APACHE_SRC" "$APACHE_DST" || true
a2enmod proxy proxy_http rewrite headers >/dev/null

# ── 8. Smoke checks ───────────────────────────────────────────────
log "smoke checks"
sleep 2
# 8-1. Direct uvicorn (backend itself, before going through Apache)
curl -fsS http://127.0.0.1:8000/api/health && echo
# 8-2. Through Apache, once the conf is enabled:
#   curl -fsS "https://<domain><prefix>/api/health"
# 8-3. Warn about a possibly stale queue manager lock
if [ -f "$REPO_DIR/logs/queue.lock" ]; then
    echo "note: logs/queue.lock exists — may be stale if no job is running"
fi

log "done"
echo "Next: enable the Apache conf when ready (a2enconf anihy && systemctl reload apache2)."
echo "See deploy/README.md for the full checklist."
