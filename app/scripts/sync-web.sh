#!/usr/bin/env bash
# web/ React SPA를 빌드해 app/ui/spa/에 복사한다 (오프라인 모드 번들).
# `pnpm tauri build|dev` 전에 실행 — frontendDist(ui/)에 포함되어 앱에 번들된다.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

cd "$ROOT/web"
pnpm build

rm -rf "$ROOT/app/ui/spa"
mkdir -p "$ROOT/app/ui/spa"
cp -r dist/. "$ROOT/app/ui/spa/"
echo "synced web/dist -> app/ui/spa"
