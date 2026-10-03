/* CSS 전체화면 연동 + 스와이프 제스처.
 * - 네이티브 앱에서는 VideoPlayer를 fullscreenMode: 'css'로 생성 (iOS WKWebView에서 자체 UI 유지)
 *   — 전환 로직·레이아웃은 플레이어(video-player.js/css)가 소유하고,
 *     여기서는 모드 결정(window.AnihyVideoPlayerDefaults) + 네이티브 부가 동작(OS 상태바)만 담당
 * - 스와이프: 플레이어 위에서 위로 쓸기 → 전체화면, 전체화면 중 아래로 쓸기 → 해제
 */
(function () {
    'use strict';

    function isNative() {
        try {
            var c = window.Capacitor;
            return !!(c && typeof c.isNativePlatform === 'function' && c.isNativePlatform());
        } catch (e) {
            return false;
        }
    }

    // VideoPlayer 생성 시 함께 전달할 옵션 (watch.php가 사용).
    // 네이티브(iOS WKWebView)에서는 네이티브 요소 전체화면이 iOS 26+ 뷰포트 고착 버그를
    // 유발하므로 CSS 전체화면 모드를 강제한다.
    window.AnihyVideoPlayerDefaults = { fullscreenMode: isNative() ? 'css' : 'auto' };

    // 스와이프 제스처 (앱/웹 공통): 플레이어 위에서 위로 쓸기 → 전체화면 진입,
    // 전체화면 중 아래로 쓸기 → 해제. 수직 이동 70px 이상 + 수직 우세일 때만 인식해
    // 탭(재생 토글)·진행 바 스크럽과 충돌하지 않게 하고, 인식되면 탭 이벤트를 차단
    var gestureStart = null;
    document.addEventListener('touchstart', function (e) {
        gestureStart = null;
        if (e.touches.length !== 1) return;
        var t = e.target;
        var c = (t && t.closest) ? t.closest('.vp') : null;
        if (!c) return;
        // 컨트롤/버튼/설정 시트 위에서 시작한 제스처는 무시
        if (t.closest('.vp__controls, .vp__menu, .vp__menu-backdrop, .vp__btn, input, select')) return;
        gestureStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, c: c };
    }, { capture: true, passive: true });
    document.addEventListener('touchend', function (e) {
        if (!gestureStart) return;
        var t = e.changedTouches[0];
        var dx = t.clientX - gestureStart.x;
        var dy = t.clientY - gestureStart.y;
        var c = gestureStart.c;
        gestureStart = null;
        if (Math.abs(dy) < 70 || Math.abs(dy) < Math.abs(dx) * 1.5) return;
        e.stopImmediatePropagation(); // 재생 토글 탭으로 오인되지 않게 차단
        if (e.preventDefault) e.preventDefault();
        // vp--fullscreen 클래스는 네이티브/CSS 전체화면 모두에서 플레이어가 토글
        var inFs = c.classList.contains('vp--fullscreen');
        if (dy < 0 ? inFs : !inFs) return; // 위: 이미 전체화면이면 무시 / 아래: 전체화면 아니면 무시
        // 진입·해제 모두 플레이어의 FS 버튼 경로를 그대로 사용
        var btn = c.querySelector('.vp__btn--fullscreen');
        if (btn) btn.click();
    }, { capture: true });

    if (!isNative()) return;

    // 이하 네이티브 전용: OS 상태바를 플레이어 전체화면 상태에 맞춰 hide/show
    function statusBar() {
        try {
            return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StatusBar) || null;
        } catch (e) {
            return null;
        }
    }

    function callStatusBar(method) {
        var sb = statusBar();
        if (sb && typeof sb[method] === 'function') {
            try {
                var p = sb[method]();
                if (p && typeof p.catch === 'function') p.catch(function () { /* ignore */ });
            } catch (e) { /* ignore */ }
        }
        // 플러그인 미등록 빌드 대비 네이티브 직접 채널 (SceneDelegate의 anihyStatusBar 핸들러)
        try {
            var h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.anihyStatusBar;
            if (h) h.postMessage(method);
        } catch (e) { /* ignore */ }
    }

    document.addEventListener('vp:fullscreenchange', function (e) {
        callStatusBar(e.detail && e.detail.fullscreen ? 'hide' : 'show');
    });

    // 진단 HUD: watch.php?...&fsdebug=1 일 때만 표시
    if (/[?&]fsdebug=1/.test(location.search)) {
        var dbg = document.createElement('div');
        dbg.style.cssText = 'position:fixed;left:4px;top:4px;z-index:999999;background:rgba(0,0,0,.85);color:#0f0;font:10px/1.4 monospace;padding:6px;border-radius:6px;max-width:95vw;white-space:pre-wrap;pointer-events:none';
        document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(dbg); });
        if (document.body) document.body.appendChild(dbg);
        // env(safe-area-inset-*) 실제 계산값을 읽기 위한 프로브
        var probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;'
            + 'padding-top:env(safe-area-inset-top,0px);padding-right:env(safe-area-inset-right,0px);'
            + 'padding-bottom:env(safe-area-inset-bottom,0px);padding-left:env(safe-area-inset-left,0px)';
        document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(probe); });
        if (document.body) document.body.appendChild(probe);
        var lines = [];
        function render(msg) {
            if (msg) { lines.push(msg); if (lines.length > 8) lines.shift(); }
            var cs = getComputedStyle(document.documentElement);
            var ps = getComputedStyle(probe);
            dbg.textContent = 'cssfs=' + !!document.querySelector('.vp-css-fullscreen')
                + ' nativeFs=' + !!(document.fullscreenElement || document.webkitFullscreenElement)
                + ' setInsets=' + (typeof window.__anihySetInsets) + '\n'
                + 'VAR t=' + cs.getPropertyValue('--anihy-sat') + ' r=' + cs.getPropertyValue('--anihy-sar')
                + ' b=' + cs.getPropertyValue('--anihy-sab') + ' l=' + cs.getPropertyValue('--anihy-sal') + '\n'
                + 'ENV t=' + ps.paddingTop + ' r=' + ps.paddingRight + ' b=' + ps.paddingBottom + ' l=' + ps.paddingLeft + '\n'
                + 'win=' + window.innerWidth + 'x' + window.innerHeight
                + ' visVP@' + (window.visualViewport ? Math.round(window.visualViewport.offsetTop) + ',' + Math.round(window.visualViewport.offsetLeft) : 'n/a')
                + ' scrollY=' + Math.round(window.scrollY) + '\n'
                + lines.join('\n');
        }
        document.addEventListener('vp:fullscreenchange', function (e) { render('FS ' + !!(e.detail && e.detail.fullscreen)); });
        window.addEventListener('resize', function () { render('resize'); });
        window.addEventListener('orientationchange', function () { render('orient ' + (screen.orientation ? screen.orientation.type : '?')); });
        window.addEventListener('error', function (e) { render('ERR ' + e.message); });
        setInterval(function () { render(); }, 700);
        render('init native=' + isNative());
    }
})();
