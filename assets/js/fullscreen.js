/* CSS 전체화면 — Capacitor 네이티브 앱 전용.
 * - iOS WKWebView는 요소 Fullscreen API 미지원 → CSS 전체화면으로 대체 (커스텀 UI 유지)
 * - Hyfata VideoPlayer의 toggleFullscreen을 오버라이드 (assets/player는 서브모듈이라 직접 수정 금지)
 * - 웹(브라우저)에서는 아무것도 하지 않음 — 기존 플레이어 동작 그대로
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
        if (!sb || typeof sb[method] !== 'function') return;
        try {
            var p = sb[method]();
            if (p && typeof p.catch === 'function') p.catch(function () { /* ignore */ });
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

        document.body.style.position = 'fixed';
        document.body.style.top = (-savedScrollY) + 'px';
        document.body.style.width = '100%';

        c.classList.add('vp-css-fullscreen');
        c.classList.add('vp--fullscreen');
        document.documentElement.classList.add('anihy-css-fs');
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
        document.documentElement.classList.remove('anihy-css-fs');
        setFsButtonIcon(c, false);

        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        window.scrollTo(0, savedScrollY);

        unlockOrientation();
        // 상태바 복귀는 레이아웃이 안정된 다음 프레임에 — 즉시 show()하면
        // safe-area-inset-top 변경 애니메이션과 재레이아웃이 겹쳐 상단바가 들썩임
        requestAnimationFrame(function () { callStatusBar('show'); });
        if (player._poke) player._poke();
    }

    var proto = window.VideoPlayer && window.VideoPlayer.prototype;
    if (!proto || proto.__anihyCssFs) return;
    proto.__anihyCssFs = true;

    var origToggleFullscreen = proto.toggleFullscreen;

    proto.toggleFullscreen = function () {
        var c = this.container;
        if (document.fullscreenEnabled && c.requestFullscreen) {
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

    window.AnihyFullscreen = {
        active: function () { return !!activePlayer; },
        exitAll: function () { exitCssFullscreen(); }
    };
})();
