#!/usr/bin/env bash
# Hyfata 플레이어 파일을 웹 서브모듈에서 오프라인 번들로 복사.
# 오프라인 페이지는 네트워크 없이 동작해야 하므로 원격 참조가 아닌 로컬 복제본을 사용한다.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/../../assets/player"
DST="$HERE/../www/vendor"
mkdir -p "$DST"
cp -f "$SRC/video-player.js" "$DST/video-player.js"
cp -f "$SRC/video-player.css" "$DST/video-player.css"
cp -f "$HERE/../../assets/js/fullscreen.js" "$DST/fullscreen.js"
echo "vendor synced: $DST"
