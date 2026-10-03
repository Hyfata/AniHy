/* CSS 전체화면 + 스와이프 제스처.
 * - iOS WKWebView는 요소 Fullscreen API 미지원 → 네이티브 앱에서는 CSS 전체화면으로 대체 (커스텀 UI 유지)
 * - Hyfata VideoPlayer의 toggleFullscreen을 오버라이드 (assets/player는 서브모듈이라 직접 수정 금지)
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
        var inCssFs = c.classList.contains('vp-css-fullscreen');
        var inNativeFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
        if (dy < 0) {
            // 위로 쓸기 → 전체화면 진입 (플레이어의 FS 버튼 경로를 그대로 사용)
            if (inCssFs || inNativeFs) return;
            var btn = c.querySelector('.vp__btn--fullscreen');
            if (btn) btn.click();
        } else {
            // 아래로 쓸기 → 전체화면 해제
            if (inCssFs && window.AnihyFullscreen) window.AnihyFullscreen.exitAll();
            else if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen();
            else if (document.webkitFullscreenElement && document.webkitExitFullscreen) document.webkitExitFullscreen();
        }
    }, { capture: true });

    if (!isNative()) return;

    var ICON_FS = '<svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>';
    var ICON_FS_EXIT = '<svg viewBox="0 0 24 24"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>';

    var activePlayer = null;
    var savedScrollY = 0;

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

    function setFsButtonIcon(container, on) {
        try {
            var btn = container.querySelector('.vp__btn--fullscreen');
            if (btn) {
                btn.innerHTML = on ? ICON_FS_EXIT : ICON_FS;
                btn.setAttribute('aria-label', on ? '전체화면 해제' : '전체화면');
            }
        } catch (e) { /* ignore */ }
    }

    function lockOrientation() {
        try {
            if (screen.orientation && typeof screen.orientation.lock === 'function') {
                var p = screen.orientation.lock('landscape');
                if (p && typeof p.catch === 'function') p.catch(function () { /* ignore */ });
            }
        } catch (e) { /* ignore */ }
    }

    function unlockOrientation() {
        try {
            if (screen.orientation && typeof screen.orientation.unlock === 'function') {
                screen.orientation.unlock();
            }
        } catch (e) { /* ignore */ }
    }

    function enterCssFullscreen(player) {
        if (activePlayer && activePlayer !== player) exitCssFullscreen(activePlayer);
        if (activePlayer === player) return;
        activePlayer = player;

        var c = player.container;
        savedScrollY = window.scrollY || window.pageYOffset || 0;

        // 전역 상태(html/body overflow, 상단바 display 등)는 절대 건드리지 않는다.
        // WebKit은 root overflow 토글 시 fixed 요소가 깨지고, fixed 요소의 display
        // 토글 시 재합성 상태가 망가지는 버그가 있어 한 번 전체화면을 다녀오면
        // 상단바가 들썩이는 원인이 된다. 전체화면 레이어가 불투명 검정으로 화면을
        // 전부 덮으므로 뒤 페이지는 잠글 필요가 없다.
        c.classList.add('vp-css-fullscreen');
        c.classList.add('vp--fullscreen');
        setFsButtonIcon(c, true);

        if (player.isTouch) {
            if (player.refs.menu) c.appendChild(player.refs.menu);
            if (player.refs.backdrop) c.appendChild(player.refs.backdrop);
        }

        lockOrientation();
        callStatusBar('hide');
        if (player._poke) player._poke();
    }

    function exitCssFullscreen(player) {
        player = player || activePlayer;
        if (!player) return;
        if (activePlayer === player) activePlayer = null;

        var c = player.container;

        if (player.isTouch) {
            if (player.refs.menu) document.body.appendChild(player.refs.menu);
            if (player.refs.backdrop) document.body.appendChild(player.refs.backdrop);
        }

        c.classList.remove('vp-css-fullscreen');
        c.classList.remove('vp--fullscreen');
        setFsButtonIcon(c, false);

        // 배경 페이지가 러버밴드 등으로 스크롤됐을 수 있으니 best-effort 복원
        window.scrollTo(0, savedScrollY);

        unlockOrientation();
        requestAnimationFrame(function () { callStatusBar('show'); });
        if (player._poke) player._poke();
    }

    var proto = window.VideoPlayer && window.VideoPlayer.prototype;
    if (!proto || proto.__anihyCssFs) return;
    proto.__anihyCssFs = true;

    var origToggleFullscreen = proto.toggleFullscreen;

    proto.toggleFullscreen = function () {
        var c = this.container;
        // 네이티브 앱에서는 항상 CSS 전체화면 — iOS 26+ WKWebView는 fullscreenEnabled=true를
        // 보고하지만 네이티브 요소 전체화면 경로 자체가 뷰포트 고착 버그(capacitor#8231)를 유발
        if (!isNative() && document.fullscreenEnabled && c.requestFullscreen) {
            return origToggleFullscreen.call(this);
        }
        if (c.classList.contains('vp-css-fullscreen')) {
            exitCssFullscreen(this);
        } else {
            enterCssFullscreen(this);
        }
    };

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') exitCssFullscreen();
    });

    window.addEventListener('pagehide', function () {
        exitCssFullscreen();
    });

    // 전체화면 중 회전/리사이즈 시 플레이어 레이아웃 재계산
    window.addEventListener('resize', function () {
        if (activePlayer && activePlayer._poke) activePlayer._poke();
    });

    window.AnihyFullscreen = {
        active: function () { return !!activePlayer; },
        exitAll: function () { exitCssFullscreen(); }
    };

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
            dbg.textContent = 'fsEnabled=' + document.fullscreenEnabled
                + ' patched=' + !!(window.VideoPlayer && window.VideoPlayer.prototype.__anihyCssFs)
                + ' active=' + !!activePlayer
                + ' setInsets=' + (typeof window.__anihySetInsets) + '\n'
                + 'VAR t=' + cs.getPropertyValue('--anihy-sat') + ' r=' + cs.getPropertyValue('--anihy-sar')
                + ' b=' + cs.getPropertyValue('--anihy-sab') + ' l=' + cs.getPropertyValue('--anihy-sal') + '\n'
                + 'ENV t=' + ps.paddingTop + ' r=' + ps.paddingRight + ' b=' + ps.paddingBottom + ' l=' + ps.paddingLeft + '\n'
                + 'win=' + window.innerWidth + 'x' + window.innerHeight
                + ' visVP@' + (window.visualViewport ? Math.round(window.visualViewport.offsetTop) + ',' + Math.round(window.visualViewport.offsetLeft) : 'n/a')
                + ' scrollY=' + Math.round(window.scrollY) + '\n'
                + lines.join('\n');
        }
        var _enter = enterCssFullscreen, _exit = exitCssFullscreen;
        enterCssFullscreen = function (p) { render('ENTER'); _enter(p); };
        exitCssFullscreen = function (p) { render('EXIT'); _exit(p); };
        window.addEventListener('resize', function () { render('resize'); });
        window.addEventListener('orientationchange', function () { render('orient ' + (screen.orientation ? screen.orientation.type : '?')); });
        window.addEventListener('error', function (e) { render('ERR ' + e.message); });
        setInterval(function () { render(); }, 700);
        render('init native=' + isNative());
    }
})();
