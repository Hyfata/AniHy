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

# 오프라인 번들 HTML의 로컬 자산 참조(?v=)를 콘텐츠 해시로 갱신.
# WKWebView가 이전 앱 버전의 JS/CSS를 캐시에서 재사용해 신구 파일이 섞여
# 로드되는 사고 방지 (vendor만 새 파일이고 페이지 JS가 구버전이면
# fullscreenMode 등 신기능이 적용 안 된 채 네이티브 경로로 빠졌던 사례)
WWW="$HERE/../www"
STAMP=$(cat "$DST/video-player.js" "$DST/video-player.css" "$DST/fullscreen.js" \
  "$WWW/css/offline-player.css" "$WWW/css/offline-library.css" \
  "$WWW/js/offline-player.js" "$WWW/js/offline-library.js" | shasum -a 256 | cut -c1-10)
for HTML in "$WWW/offline-player.html" "$WWW/offline-library.html"; do
  perl -pi -e "s{\\.(js|css)\\?v=[0-9a-f]+}{.\$1?v=$STAMP}g" "$HTML"
done

echo "vendor synced: $DST (stamp $STAMP)"
