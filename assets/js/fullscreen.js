/* CSS 전체화면 + iOS 26+ 전체화면 뷰포트 버그 우회.
 * - iOS WKWebView는 요소 Fullscreen API 미지원 → 네이티브 앱에서는 CSS 전체화면으로 대체 (커스텀 UI 유지)
 * - Hyfata VideoPlayer의 toggleFullscreen을 오버라이드 (assets/player는 서브모듈이라 직접 수정 금지)
 * - iOS 26+는 전체화면(네이티브/CSS 무관) 해제 후 safe-area/뷰포트 재계산을 못 해
 *   상단에 빈 영역이 생기는 OS 버그가 있음(WebKit 297779, capacitor#8231)
 *   → 해제 시 viewport 메타를 흔들어 재계산 강제. 이 우회는 웹/앱 모두에 적용
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

    // iOS 26+: 전체화면 해제 후 뷰포트가 inset 상태로 고착되는 버그 우회.
    // viewport 메타의 initial-scale을 살짝 바꿨다 되돌려 WebKit에 재계산을 강제
    function nudgeViewport() {
        var meta = document.querySelector('meta[name="viewport"]');
        if (!meta) return;
        var orig = meta.getAttribute('content') || '';
        meta.setAttribute('content', orig.replace(/initial-scale=[\d.]+/, 'initial-scale=1.001'));
        setTimeout(function () { meta.setAttribute('content', orig); }, 150);
        setTimeout(function () { meta.setAttribute('content', orig); }, 400);
    }

    // 웹(네이티브 Fullscreen API 경로)에서도 해제 시 동일 우회
    document.addEventListener('fullscreenchange', function () {
        if (!document.fullscreenElement) nudgeViewport();
    });
    document.addEventListener('webkitfullscreenchange', function () {
        if (!document.webkitFullscreenElement) nudgeViewport();
    });

    // 회전 시에도 env(safe-area-inset-*) 갱신 강제 — 가로로 전체화면 해제 후
    // 세로로 돌릴 때(= 해제 시점 이후의 회전) inset이 갱신되지 않아
    // 상단바가 OS 상태바와 겹치는 시나리오 대응. 앱/웹 무관하게 항상 설치
    window.addEventListener('orientationchange', function () {
        setTimeout(nudgeViewport, 300);
        setTimeout(nudgeViewport, 900);
    });

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
        // 진입 시점에도 env(safe-area-inset-*)이 낡은 값일 수 있어 재계산 강제 —
        // 안 하면 첫 전체화면에서 컨트롤이 노치/상태바에 겹쳐 있다가 한참 뒤에야 적용됨
        setTimeout(nudgeViewport, 200);
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
        // iOS 26+ 뷰포트 고착 버그 우회 — 상태바 복귀 후 재계산 강제
        setTimeout(nudgeViewport, 200);
        setTimeout(nudgeViewport, 800);
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

    // 임시 진단 HUD: 네이티브 앱에서는 자동 활성(원격 진단용), 웹은 ?fsdebug=1
    if (isNative() || /[?&]fsdebug=1/.test(location.search)) {
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
