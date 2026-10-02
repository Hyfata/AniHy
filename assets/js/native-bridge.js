/* AniHy native bridge — Capacitor 앱과 웹 공용 다운로드/오프라인 재생 브릿지.
 *
 * - 웹(브라우저)에서는 no-op에 가깝게 동작 (보관함>다운로드는 안내 문구만 표시,
 *   다운로드 버튼은 기존 웹 다운로드 흐름 유지).
 * - Capacitor 네이티브 앱에서는:
 *   1) 에피소드/전체 다운로드 가로채기 → 앱 내부 저장소(Directory.Data)에 저장
 *   2) 보관함>다운로드 탭에 애니별 저장 목록 렌더 (재생/삭제)
 *   3) 오프라인에서는 저장된 회차를 로컬 오프라인 플레이어로 재생
 *   4) 전체화면을 네이티브가 아닌 CSS 방식으로 강제해 Hyfata 자체 UI 유지
 *      (iOS WKWebView의 video.webkitEnterFullscreen은 애플 기본 UI로 바뀌므로 사용 금지)
 */
(function () {
    'use strict';

    var META_KEY = 'anihy_downloads_v1';
    var DL_DIR = 'downloads';

    function cap() {
        if (typeof window.Capacitor !== 'undefined') return window.Capacitor;
        // Capacitor iOS는 JS 브릿지를 forMainFrameOnly로 주입 — 애니 모달 같은
        // same-origin iframe 안에서는 window.Capacitor가 없으므로 부모 프레임 것을 사용
        try {
            if (window.parent && window.parent !== window && window.parent.Capacitor) {
                return window.parent.Capacitor;
            }
        } catch (e) { /* cross-origin */ }
        return null;
    }

    function isNative() {
        var c = cap();
        return !!(c && typeof c.isNativePlatform === 'function' && c.isNativePlatform());
    }

    function plugins() {
        var c = cap();
        return (c && c.Plugins) ? c.Plugins : {};
    }

    function getPlatform() {
        var c = cap();
        if (c && typeof c.getPlatform === 'function') {
            try { return c.getPlatform(); } catch (e) { /* ignore */ }
        }
        return 'web';
    }

    // ---------- 네이티브 전용 CSS 오버라이드 (웹 브라우저에는 적용하지 않음) ----------
    // - .navbar blur 제거: 배경이 불투명이라 시각 효과 없이 리페인트 떨림만 유발
    // - top 64px 하드코딩 보정: viewport-fit=cover 이후 navbar 높이가
    //   64 + safe-area-inset-top 이라 태블릿(사이드바 모드)에서 겹침
    // - 하단 탭바: WKWebView는 backdrop-filter 떨림이 없으므로 리퀴드 글래스 강화
    if (isNative()) {
        var nativeStyle = document.createElement('style');
        nativeStyle.id = 'anihy-native-overrides';
        nativeStyle.textContent = [
            '.navbar { backdrop-filter: none; }',
            '@media (min-width: 769px) {',
            '    .bottom-tabbar { top: calc(64px + env(safe-area-inset-top, 0px)); }',
            '}',
            '.quarter-sticky-header { top: calc(64px + env(safe-area-inset-top, 0px)); }',
            '/* 모바일 전체화면 애니 모달 닫기 버튼이 상태바 아래로 들어가지 않게 */',
            '.anime-modal-close { top: calc(10px + env(safe-area-inset-top, 0px)); }',
            '/* 애니 모달 본문: iframe 내부 문서에서는 env(safe-area-inset-top)이 0이라',
            '   embed 페이지 쪽 패딩은 무의미 — 부모 페이지에서 모달 자체를 아래로 밀어야 함 */',
            '@media (max-width: 640px) {',
            '    .modal.anime-modal { padding-top: env(safe-area-inset-top, 0px); }',
            '}',
            '.bottom-tabbar {',
            '    background: rgba(21, 23, 28, 0.55);',
            '    backdrop-filter: blur(24px) saturate(1.8);',
            '    -webkit-backdrop-filter: blur(24px) saturate(1.8);',
            '    border-color: rgba(255, 255, 255, 0.14);',
            '    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.08);',
            '}',
            '@media (min-width: 769px) {',
            '    .bottom-tabbar { background: transparent; backdrop-filter: none; -webkit-backdrop-filter: none; border: none; box-shadow: none; }',
            '}',
            '/* 저장 완료된 회차의 다운로드 버튼은 체크 아이콘(accent) */',
            '.episode-dl-btn.is-downloaded { color: var(--accent); }',
            '/* 다운로드 중 버튼: 링 + % 텍스트가 들어가도록 pill 형태로 확장 */',
            '.episode-dl-btn.is-downloading { width: auto; padding: 0 9px; border-radius: 999px; gap: 4px; color: var(--primary); }',
            '.episode-dl-btn .dl-pct { font-size: 0.7rem; font-weight: 600; }'
        ].join('\n');
        document.head.appendChild(nativeStyle);
    }

    // ---------- 메타데이터 저장소 (Preferences 우선, 없으면 localStorage) ----------
    var store = {
        async list() {
            try {
                var p = plugins().Preferences;
                if (p) {
                    var r = await p.get({ key: META_KEY });
                    return r && r.value ? (JSON.parse(r.value) || []) : [];
                }
            } catch (e) { /* fallback below */ }
            try {
                return JSON.parse(localStorage.getItem(META_KEY) || '[]') || [];
            } catch (e) {
                return [];
            }
        },
        async save(items) {
            var raw = JSON.stringify(items);
            try {
                var p = plugins().Preferences;
                if (p) {
                    await p.set({ key: META_KEY, value: raw });
                    return;
                }
            } catch (e) { /* fallback below */ }
            try { localStorage.setItem(META_KEY, raw); } catch (e) { /* ignore */ }
        }
    };

    function epKey(aid, ep) {
        return String(aid) + '::' + String(ep);
    }

    async function findItem(aid, ep) {
        var items = await store.list();
        var k = epKey(aid, ep);
        for (var i = 0; i < items.length; i++) {
            if (epKey(items[i].aid, items[i].ep) === k) return items[i];
        }
        return null;
    }

    async function upsertItem(entry) {
        var items = await store.list();
        var k = epKey(entry.aid, entry.ep);
        var done = false;
        for (var i = 0; i < items.length; i++) {
            if (epKey(items[i].aid, items[i].ep) === k) {
                items[i] = entry;
                done = true;
                break;
            }
        }
        if (!done) items.push(entry);
        // 최신 저장순으로 정렬
        items.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
        await store.save(items);
    }

    async function removeItem(aid, ep) {
        var items = await store.list();
        var k = epKey(aid, ep);
        await store.save(items.filter(function (it) { return epKey(it.aid, it.ep) !== k; }));
    }

    // ---------- 파일 경로 ----------
    function sanitize(name) {
        return String(name).replace(/[^a-zA-Z0-9._-]/g, '_');
    }

    function mp4RelPath(aid, ep) {
        return DL_DIR + '/' + aid + '/' + sanitize(ep) + '.mp4';
    }

    function vttRelPath(aid, ep) {
        return DL_DIR + '/' + aid + '/' + sanitize(ep) + '.chapters.vtt';
    }

    function fs() {
        return plugins().Filesystem || null;
    }

    async function ensureDir(path) {
        var f = fs();
        if (!f) return;
        try {
            await f.mkdir({ path: path, directory: 'DATA', recursive: true });
        } catch (e) {
            // 이미 존재하면 무시 (EEXIST 계열)
        }
    }

    function u8ToB64(u8) {
        var s = '';
        for (var i = 0; i < u8.length; i += 0x8000) {
            s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        }
        return btoa(s);
    }

    // WebView fetch(쿠키 포함) → Filesystem에 청크 append. 대용량 mp4도 메모리 안전.
    async function fetchToFile(url, relPath, onProgress, signal) {
        var f = fs();
        if (!f) throw new Error('Filesystem 플러그인을 사용할 수 없습니다.');
        var res = await fetch(url, { credentials: 'include', signal: signal || null });
        if (!res.ok) throw new Error('다운로드 실패 (HTTP ' + res.status + ')');
        var total = parseInt(res.headers.get('Content-Length') || '0', 10) || 0;
        var reader = res.body && res.body.getReader ? res.body.getReader() : null;
        var dir = relPath.split('/').slice(0, -1).join('/');
        await ensureDir(dir);
        try { await f.deleteFile({ path: relPath, directory: 'DATA' }); } catch (e) { /* ignore */ }
        await f.writeFile({ path: relPath, directory: 'DATA', data: '', recursive: true });
        var loaded = 0;
        if (!reader) {
            // 스트리밍 미지원 환경 폴백 (작은 파일용)
            var buf = new Uint8Array(await res.arrayBuffer());
            if (signal && signal.aborted) throw new Error('aborted');
            await f.writeFile({ path: relPath, directory: 'DATA', data: u8ToB64(buf), recursive: true });
            if (onProgress) onProgress(100);
            return total || buf.byteLength;
        }
        for (;;) {
            if (signal && signal.aborted) throw new Error('aborted');
            var chunk = await reader.read();
            if (chunk.done) break;
            await f.appendFile({ path: relPath, directory: 'DATA', data: u8ToB64(chunk.value) });
            loaded += chunk.value.byteLength;
            if (onProgress && total > 0) onProgress(Math.min(99, (loaded / total) * 100));
        }
        if (onProgress) onProgress(100);
        return total || loaded;
    }

    async function fetchTextToFile(url, relPath) {
        var f = fs();
        if (!f) return false;
        try {
            var res = await fetch(url, { credentials: 'include' });
            if (!res.ok) return false;
            var text = await res.text();
            if (!text || text.length < 10) return false;
            var dir = relPath.split('/').slice(0, -1).join('/');
            await ensureDir(dir);
            await f.writeFile({ path: relPath, directory: 'DATA', data: btoa(unescape(encodeURIComponent(text))), recursive: true });
            return true;
        } catch (e) {
            return false;
        }
    }

    async function deleteStorageFile(relPath) {
        var f = fs();
        if (!f) return;
        try { await f.deleteFile({ path: relPath, directory: 'DATA' }); } catch (e) { /* ignore */ }
    }

    // ---------- 오프라인 플레이어 URL (앱 번들 로컬 페이지) ----------
    function offlinePlayerBase() {
        var p = getPlatform();
        if (p === 'ios') return 'capacitor://localhost/offline-player.html';
        if (p === 'android') return 'http://localhost/offline-player.html';
        return 'offline-player.html';
    }

    function openOfflinePlayer(aid, ep) {
        var url = offlinePlayerBase()
            + '?aid=' + encodeURIComponent(aid)
            + '&ep=' + encodeURIComponent(ep)
            + '&back=' + encodeURIComponent(window.location.href);
        // iframe(애니 모달) 안에서 호출될 수 있으므로 최상위 프레임을 이동
        (window.top || window).location.href = url;
    }

    // ---------- 다운로드 실행 ----------
    // busy[k] = AbortController (진행 중 다운로드 추적 + 모달 닫기 시 중단용)
    var busy = {};
    var downloadsAborted = false;

    function getActiveDownloadCount() {
        return Object.keys(busy).length;
    }

    function abortAllDownloads() {
        downloadsAborted = true;
        Object.keys(busy).forEach(function (k) {
            var b = busy[k];
            if (b && typeof b.abort === 'function') b.abort();
        });
    }

    // 개별 회차 다운로드만 중단 (전체 중단 플래그는 세우지 않음)
    function abortDownload(aid, ep) {
        var b = busy[epKey(aid, ep)];
        if (b && typeof b.abort === 'function') b.abort();
    }

    // 진행률 링 + % 텍스트 (style.css의 .zip-ring 재사용, dasharray 56.55)
    var RING_LEN = 56.55;
    function ringSvg(pct) {
        var offset = (RING_LEN * (1 - Math.min(100, Math.max(0, pct)) / 100)).toFixed(2);
        return '<svg viewBox="0 0 24 24" class="zip-ring">'
            + '<circle class="zip-ring-bg" cx="12" cy="12" r="9"/>'
            + '<circle class="zip-ring-fg" cx="12" cy="12" r="9" style="stroke-dashoffset:' + offset + '"/>'
            + '</svg>';
    }
    function progressHtml(pct) {
        return ringSvg(pct) + '<span class="dl-pct">' + Math.round(pct) + '%</span>';
    }

    // 저장 완료된 회차 버튼 아이콘 (체크)
    var DONE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/></svg>';
    function markDownloaded(btn) {
        btn.innerHTML = DONE_SVG;
        btn.classList.add('is-downloaded');
    }

    async function downloadEpisode(opts) {
        var aid = opts.aid;
        var ep = String(opts.ep);
        var k = epKey(aid, ep);
        if (busy[k]) return false;
        if (downloadsAborted) return false;
        if (await findItem(aid, ep)) {
            await window.modalAlert('이미 저장된 회차입니다.\n보관함 > 다운로드에서 재생하거나 삭제할 수 있습니다.');
            return false;
        }
        var label = (opts.anime ? opts.anime + ' ' : '') + ep + '화';
        if (!opts.skipConfirm) {
            if (!(await window.modalConfirm('"' + (opts.title || label) + '"을(를) 앱에 저장하시겠습니까?' + (opts.size ? '\n예상 용량: ' + opts.size : '')))) {
                return false;
            }
        }
        var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        busy[k] = controller || true;
        var setProgress = opts.onProgress || function () { /* ignore */ };
        try {
            setProgress(0);
            var rel = mp4RelPath(aid, ep);
            var bytes = await fetchToFile(opts.url, rel, setProgress, controller ? controller.signal : null);
            var hasVtt = false;
            if (opts.chaptersUrl) {
                if (controller && controller.signal.aborted) throw new Error('aborted');
                var abs = new URL(opts.chaptersUrl, window.location.origin).toString();
                hasVtt = await fetchTextToFile(abs, vttRelPath(aid, ep));
            }
            await upsertItem({
                aid: Number(aid),
                ep: ep,
                anime: opts.anime || '',
                title: opts.title || (ep + '화'),
                size: bytes || 0,
                hasChapters: hasVtt,
                cover: opts.cover || '',
                createdAt: Date.now()
            });
            setProgress(100);
            refreshLibrary();
            return true;
        } catch (err) {
            await deleteStorageFile(mp4RelPath(aid, ep));
            // 사용자가 중단(모달 닫기)한 경우는 조용히 정리만
            if (!(controller && controller.signal.aborted)) {
                await window.modalAlert('저장에 실패했습니다: ' + (err && err.message ? err.message : err));
            }
            return false;
        } finally {
            delete busy[k];
            if (opts.onDone) opts.onDone();
        }
    }

    async function deleteDownload(aid, ep) {
        var item = await findItem(aid, ep);
        if (!item) return;
        if (!(await window.modalConfirm('"' + (item.title || ep + '화') + '" 저장본을 삭제하시겠습니까?'))) return;
        await deleteStorageFile(mp4RelPath(aid, ep));
        await deleteStorageFile(vttRelPath(aid, ep));
        await removeItem(aid, ep);
        refreshLibrary();
    }

    // ---------- 재생 (온라인=watch.php, 오프라인 저장본=로컬 플레이어) ----------
    async function playEpisode(aid, ep) {
        var item = await findItem(aid, ep);
        if (item && !navigator.onLine) {
            openOfflinePlayer(aid, ep);
            return;
        }
        var url = '/anime/watch.php?aid=' + encodeURIComponent(aid) + '&ep=' + encodeURIComponent(ep);
        window.location.href = url;
    }

    // ---------- 보관함 > 다운로드 렌더 ----------
    function fmtBytes(n) {
        n = Number(n) || 0;
        if (n <= 0) return '';
        var units = ['B', 'KB', 'MB', 'GB'];
        var i = 0;
        while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
        return (i === 0 ? String(Math.round(n)) : n.toFixed(1)) + ' ' + units[i];
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    async function renderLibrary() {
        var box = document.getElementById('library-downloads');
        if (!box) return;
        if (!isNative()) {
            box.innerHTML = '<div class="empty-state">다운로드는 앱에서 이용할 수 있습니다.<br>앱에서 에피소드를 저장하면 이 목록에 표시됩니다.</div>';
            return;
        }
        if (!fs()) {
            box.innerHTML = '<div class="empty-state">저장소 플러그인을 사용할 수 없습니다.<br>앱을 최신 버전으로 업데이트해 주세요.</div>';
            return;
        }
        var items = await store.list();
        if (!items.length) {
            box.innerHTML = '<div class="empty-state">저장된 영상이 없습니다.<br>에피소드에서 다운로드를 눌러 저장해 보세요.</div>';
            return;
        }
        // 애니별 분류
        var groups = {};
        var order = [];
        items.forEach(function (it) {
            var k = String(it.aid);
            if (!groups[k]) {
                groups[k] = { aid: it.aid, anime: it.anime || ('애니 #' + it.aid), cover: it.cover || '', eps: [] };
                order.push(k);
            }
            groups[k].eps.push(it);
            if (it.cover && !groups[k].cover) groups[k].cover = it.cover;
        });
        var html = '<div class="dl-groups">';
        order.forEach(function (k) {
            var g = groups[k];
            var total = g.eps.reduce(function (s, it) { return s + (Number(it.size) || 0); }, 0);
            html += '<section class="dl-group" data-aid="' + esc(g.aid) + '">'
                + '<button type="button" class="dl-group-head" data-dl-anime="' + esc(g.aid) + '">'
                + (g.cover ? '<img class="dl-group-cover" src="' + esc(g.cover) + '" alt="" loading="lazy" onerror="this.remove()">' : '')
                + '<span class="dl-group-meta"><span class="dl-group-title">' + esc(g.anime) + '</span>'
                + '<span class="dl-group-sub">' + g.eps.length + '개 저장됨' + (total ? ' · ' + esc(fmtBytes(total)) : '') + '</span></span>'
                + '<span class="dl-group-arrow" aria-hidden="true">›</span>'
                + '</button>'
                + '<div class="dl-items">';
            g.eps.forEach(function (it) {
                html += '<div class="dl-item" data-aid="' + esc(it.aid) + '" data-ep="' + esc(it.ep) + '">'
                    + '<button type="button" class="dl-item-main" data-dl-play="' + esc(it.aid) + '|' + esc(it.ep) + '">'
                    + '<span class="dl-item-badge">' + esc(it.ep) + '</span>'
                    + '<span class="dl-item-meta"><span class="dl-item-title">' + esc(it.title || (it.ep + '화')) + '</span>'
                    + '<span class="dl-item-sub">' + esc([fmtBytes(it.size), it.createdAt ? new Date(it.createdAt).toLocaleDateString() : ''].filter(Boolean).join(' · ')) + '</span></span>'
                    + '</button>'
                    + '<button type="button" class="btn btn-sm btn-danger" data-dl-del="' + esc(it.aid) + '|' + esc(it.ep) + '">삭제</button>'
                    + '</div>';
            });
            html += '</div></section>';
        });
        html += '</div>';
        box.innerHTML = html;
    }

    function refreshLibrary() {
        // 다운로드 목록 화면에서만 의미 있음 (실패해도 무시)
        try {
            var r = renderLibrary();
            if (r && r.catch) r.catch(function () { /* ignore */ });
        } catch (e) { /* ignore */ }
    }

    // 애니별 그룹 헤더 → 애니 모달을 "저장된 회차만"으로 필터해 오픈
    var pendingDlFilter = null;

    function openDownloadedAnime(aid) {
        pendingDlFilter = String(aid);
        if (typeof window.openAnimeModal === 'function') {
            window.openAnimeModal(aid);
        } else {
            window.location.href = '/anime/anime.php?aid=' + encodeURIComponent(aid);
        }
    }

    async function applyDownloadedFilter(frame, aid) {
        var items = await store.list();
        var saved = {};
        items.forEach(function (it) {
            if (String(it.aid) === String(aid)) saved[String(it.ep)] = true;
        });
        var doc;
        try { doc = frame.contentDocument; } catch (e) { return; }
        if (!doc) return;
        var list = doc.getElementById('episode-list');
        if (!list) return;
        var rows = list.querySelectorAll('.episode-item');
        var shown = 0;
        rows.forEach(function (row) {
            if (saved[row.getAttribute('data-ep')]) {
                shown++;
            } else {
                row.remove();
            }
        });
        // 저장본 전용 안내 배너
        if (!doc.getElementById('dl-only-notice')) {
            var banner = doc.createElement('div');
            banner.id = 'dl-only-notice';
            banner.className = 'dl-only-notice';
            banner.textContent = '저장된 ' + shown + '개 회차만 표시됩니다.';
            list.parentNode.insertBefore(banner, list);
        }
        if (shown === 0) {
            var empty = doc.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = '저장된 회차가 없습니다.';
            list.appendChild(empty);
        }
    }

    // ---------- CSS 전체화면 (네이티브에서 Hyfata 자체 UI 유지) ----------
    var ICON_FS = '<svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>';
    var ICON_FS_EXIT = '<svg viewBox="0 0 24 24"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>';

    function useCssFullscreen() {
        // 네이티브 앱에서는 항상 CSS 전체화면 (iOS 네이티브 전체화면은 애플 기본 UI로 대체됨)
        return isNative();
    }

    function patchPlayerFullscreen() {
        if (!useCssFullscreen()) return;
        if (!window.VideoPlayer || !window.VideoPlayer.prototype || window.VideoPlayer.prototype.__anihyCssFs) return;
        var proto = window.VideoPlayer.prototype;
        proto.__anihyCssFs = true;
        proto.toggleFullscreen = function () {
            var c = this.container;
            var on = c.classList.toggle('vp-css-fullscreen');
            document.documentElement.classList.toggle('anihy-css-fs', on);
            c.classList.toggle('vp--fullscreen', on);
            try {
                var btn = c.querySelector('.vp__btn--fullscreen');
                if (btn) btn.innerHTML = on ? ICON_FS_EXIT : ICON_FS;
            } catch (e) { /* ignore */ }
            if (this._poke) this._poke();
        };
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                document.querySelectorAll('.vp-css-fullscreen').forEach(function (c) {
                    c.classList.remove('vp-css-fullscreen');
                    c.classList.remove('vp--fullscreen');
                });
                document.documentElement.classList.remove('anihy-css-fs');
            }
        });
    }

    // ---------- 이벤트 바인딩 ----------
    function currentCover() {
        var img = document.querySelector('.anime-poster img');
        return img && img.src ? img.src : '';
    }

    function bindDownloadButtons() {
        // watch.php 저장 버튼 (웹/앱 공용 진입점)
        var watchBtn = document.getElementById('native-download-btn');
        if (watchBtn && !watchBtn.__anihyBound) {
            watchBtn.__anihyBound = true;
            watchBtn.addEventListener('click', function () {
                var d = watchBtn.dataset;
                if (isNative()) {
                    downloadEpisode({
                        aid: d.aid, ep: d.ep, anime: d.anime, title: d.title,
                        url: d.src || ('/anime/api/download_episode.php?aid=' + encodeURIComponent(d.aid) + '&ep=' + encodeURIComponent(d.ep)),
                        size: d.size, chaptersUrl: d.chapters || null, cover: currentCover()
                    });
                } else {
                    window.location.href = '/anime/api/download_episode.php?aid=' + encodeURIComponent(d.aid) + '&ep=' + encodeURIComponent(d.ep);
                }
            });
        }

        if (!isNative()) return;

        // anime.php 개별 다운로드 가로채기 (app.js 핸들러보다 먼저: capture 단계)
        document.querySelectorAll('.episode-dl-btn').forEach(function (btn) {
            if (btn.__anihyBound) return;
            btn.__anihyBound = true;
            btn.__origHtml = btn.innerHTML;
            // 이미 저장된 회차는 완료 아이콘으로 표시
            (function (b) {
                findItem(b.dataset.aid, b.dataset.ep).then(function (it) {
                    if (it) markDownloaded(b);
                });
            })(btn);
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
                var d = btn.dataset;
                // 다운로드 중 탭 → 취소 여부 확인 후 중단
                if (busy[epKey(d.aid, d.ep)]) {
                    (window.modalConfirm ? window.modalConfirm('다운로드를 취소하시겠습니까?') : Promise.resolve(true))
                        .then(function (ok) { if (ok) abortDownload(d.aid, d.ep); });
                    return;
                }
                downloadsAborted = false;
                downloadEpisode({
                    aid: d.aid, ep: d.ep, anime: d.anime, title: d.title,
                    url: btn.getAttribute('href'),
                    size: d.size, chaptersUrl: d.chapters || null, cover: currentCover(),
                    // 아이콘 자리에 진행률 링+% 표시, 완료 시 체크 아이콘 / 실패·중단 시 원래 아이콘
                    onProgress: function (p) {
                        btn.classList.add('is-downloading');
                        btn.innerHTML = progressHtml(p);
                    }
                }).then(function (ok2) {
                    btn.classList.remove('is-downloading');
                    if (ok2) { markDownloaded(btn); return; }
                    // 실패/취소라도 저장본이 이미 있으면(기존 저장 회차 탭 등) 체크 아이콘 유지
                    findItem(d.aid, d.ep).then(function (it) {
                        if (it) markDownloaded(btn);
                        else btn.innerHTML = btn.__origHtml;
                    });
                });
            }, true);
        });

        // anime.php 전체 다운로드 → 회차별 순차 저장 (ZIP은 오프라인 재생 불가)
        var allBtn = document.getElementById('download-all-btn');
        if (allBtn && !allBtn.__anihyBound) {
            allBtn.__anihyBound = true;
            allBtn.addEventListener('click', async function (e) {
                // app.js의 웹용 ZIP 다운로드 핸들러 차단 — 같이 실행되면 ZIP 완성 시
                // location 이동이 발생해 진행 중인 회차 저장이 끊김 (첫 회차 실패 버그)
                e.preventDefault();
                e.stopPropagation();
                if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
                downloadsAborted = false;
                var btns = Array.prototype.slice.call(document.querySelectorAll('.episode-dl-btn'));
                if (!btns.length) {
                    await window.modalAlert('저장할 수 있는 회차가 없습니다.');
                    return;
                }
                var pending = [];
                for (var i = 0; i < btns.length; i++) {
                    var d = btns[i].dataset;
                    if (await findItem(d.aid, d.ep)) continue;
                    pending.push(btns[i]);
                }
                if (!pending.length) {
                    await window.modalAlert('모든 회차가 이미 저장되어 있습니다.');
                    return;
                }
                if (!(await window.modalConfirm('총 ' + pending.length + '개 회차를 앱에 저장하시겠습니까?\n저장 중에는 화면을 닫지 마세요.'))) return;
                var labelEl = allBtn.querySelector('span');
                var iconEl0 = allBtn.querySelector('svg');
                var orig = labelEl ? labelEl.textContent : '';
                var origIcon = iconEl0 ? iconEl0.outerHTML : '';
                var setAllProgress = function (idx, pct) {
                    // 전체 진행률 = 완료된 회차 + 현재 회차 진행분
                    var overall = ((idx + pct / 100) / pending.length) * 100;
                    var cur = allBtn.querySelector('svg');
                    if (cur) cur.outerHTML = ringSvg(overall);
                    if (labelEl) labelEl.textContent = (idx + 1) + '/' + pending.length + ' · ' + Math.round(overall) + '%';
                };
                // 대상 회차 버튼 전부 진행률 표시(0%)로 전환
                pending.forEach(function (b) {
                    b.classList.add('is-downloading');
                    b.innerHTML = progressHtml(0);
                });
                var ok = 0;
                for (var j = 0; j < pending.length; j++) {
                    var bd = pending[j].dataset;
                    setAllProgress(j, 0);
                    var r = await downloadEpisode({
                        aid: bd.aid, ep: bd.ep, anime: bd.anime || allBtn.dataset.anime || '', title: bd.title,
                        url: pending[j].getAttribute('href'),
                        size: bd.size, chaptersUrl: bd.chapters || null, cover: currentCover(),
                        skipConfirm: true, quiet: true,
                        onProgress: (function (btn2, idx2) {
                            return function (p) {
                                setAllProgress(idx2, p);
                                btn2.innerHTML = progressHtml(p);
                            };
                        })(pending[j], j)
                    });
                    if (r) {
                        ok++;
                        pending[j].classList.remove('is-downloading');
                        markDownloaded(pending[j]);
                    }
                    // 모달 닫기로 전체 중단된 경우 나머지 회차는 시작하지 않음
                    if (downloadsAborted) break;
                }
                // 저장되지 못한 채 진행률 표시로 남은 버튼은 원래 아이콘으로 복원
                pending.forEach(function (b) {
                    if (b.classList.contains('is-downloaded')) return;
                    b.classList.remove('is-downloading');
                    b.innerHTML = b.__origHtml || b.innerHTML;
                });
                if (labelEl) labelEl.textContent = orig;
                var curIcon = allBtn.querySelector('svg');
                if (curIcon && origIcon) curIcon.outerHTML = origIcon;
                await window.modalAlert(ok + '/' + pending.length + '개 저장 완료');
            }, true);
        }
    }

    function bindLibraryClicks() {
        document.addEventListener('click', function (e) {
            var play = e.target && e.target.closest ? e.target.closest('[data-dl-play]') : null;
            if (play) {
                var parts = play.getAttribute('data-dl-play').split('|');
                playEpisode(parts[0], parts.slice(1).join('|'));
                return;
            }
            var del = e.target && e.target.closest ? e.target.closest('[data-dl-del]') : null;
            if (del) {
                var dp = del.getAttribute('data-dl-del').split('|');
                deleteDownload(dp[0], dp.slice(1).join('|'));
                return;
            }
            var head = e.target && e.target.closest ? e.target.closest('[data-dl-anime]') : null;
            if (head) {
                openDownloadedAnime(head.getAttribute('data-dl-anime'));
            }
        });
    }

    function bindOfflineRedirect() {
        if (!isNative()) return;
        // 오프라인에서 저장된 회차로 가는 링크는 로컬 플레이어로 전환
        document.addEventListener('click', function (e) {
            if (navigator.onLine) return;
            var link = e.target && e.target.closest ? e.target.closest('a[href*="watch.php"]') : null;
            var aid = null, ep = null;
            if (link) {
                try {
                    var u = new URL(link.getAttribute('href'), window.location.origin);
                    aid = u.searchParams.get('aid');
                    ep = u.searchParams.get('ep');
                } catch (err) { /* ignore */ }
            } else {
                var row = e.target && e.target.closest ? e.target.closest('.episode-item[data-aid][data-ep]') : null;
                if (row && !e.target.closest('a,button')) {
                    aid = row.getAttribute('data-aid');
                    ep = row.getAttribute('data-ep');
                }
            }
            if (!aid || !ep) return;
            e.preventDefault();
            if (e.stopImmediatePropagation) e.stopImmediatePropagation();
            findItem(aid, ep).then(function (item) {
                if (item) {
                    openOfflinePlayer(aid, ep);
                } else if (window.modalAlert) {
                    window.modalAlert('오프라인 상태입니다.\n저장된 회차만 재생할 수 있습니다.');
                }
            });
        }, true);

        // 애니 모달 저장본 필터 (동일 출처 iframe이므로 DOM 직접 조작 가능)
        var frame = document.getElementById('anime-modal-frame');
        if (frame && !frame.__anihyBound) {
            frame.__anihyBound = true;
            frame.addEventListener('load', function () {
                if (!pendingDlFilter) return;
                var aid = pendingDlFilter;
                pendingDlFilter = null;
                // embed 내부 스크립트 실행 후 적용되도록 1틱 지연
                setTimeout(function () { applyDownloadedFilter(frame, aid); }, 60);
            });
        }
    }

    function hideDownloadsTabOnWeb() {
        if (isNative()) return;
        document.querySelectorAll('[data-library-sub="downloads"]').forEach(function (el) {
            el.style.display = 'none';
        });
        // 웹에서 직접 진입한 경우 안내 문구는 renderLibrary가 처리
    }

    // 애니 모달 닫기 가드: iframe(모달) 안에서 진행 중인 다운로드가 있으면 경고 후 중단
    // (모달이 닫히면 iframe 문서가 파괴돼 다운로드가 자연 소멸 — 부분 파일은 abort 경로에서 삭제)
    function patchAnimeModalCloseGuard() {
        if (!isNative()) return;
        if (typeof window.closeAnimeModal !== 'function') return;
        if (window.closeAnimeModal.__anihyGuarded) return;
        var orig = window.closeAnimeModal;
        var guarded = async function () {
            var nb = null;
            try {
                var frame = document.getElementById('anime-modal-frame');
                nb = frame && frame.contentWindow ? frame.contentWindow.AniHyNative : null;
            } catch (e) { nb = null; }
            var n = (nb && nb.getActiveDownloadCount) ? nb.getActiveDownloadCount() : 0;
            if (n > 0) {
                var ok = window.modalConfirm
                    ? await window.modalConfirm('다운로드 ' + n + '건이 진행 중입니다.\n모달을 닫으면 다운로드가 중단됩니다. 닫으시겠습니까?')
                    : true;
                if (!ok) return;
                try { nb.abortAllDownloads(); } catch (e) { /* ignore */ }
            }
            orig();
        };
        guarded.__anihyGuarded = true;
        window.closeAnimeModal = guarded;
    }

    // 다운로드 중 회차 행 탭(watch 이동) 가드: 페이지를 떠나면 iframe/문서가 파괴돼
    // 다운로드가 끊기므로 확인 후 중단하고 이동 (embed 모달이면 goWatchEmbed로 top 이동)
    function bindDownloadNavGuard() {
        if (!isNative()) return;
        document.addEventListener('click', function (e) {
            if (getActiveDownloadCount() === 0) return;
            if (e.target && e.target.closest && e.target.closest('.episode-dl-btn')) return;
            var row = e.target && e.target.closest ? e.target.closest('.episode-item[data-aid][data-ep]') : null;
            if (!row) return;
            e.preventDefault();
            e.stopPropagation();
            if (e.stopImmediatePropagation) e.stopImmediatePropagation();
            var aid = row.getAttribute('data-aid');
            var ep = row.getAttribute('data-ep');
            var go = function () {
                if (typeof window.goWatchEmbed === 'function') window.goWatchEmbed(aid, ep);
                else window.location.href = '/anime/watch.php?aid=' + encodeURIComponent(aid) + '&ep=' + encodeURIComponent(ep);
            };
            (window.modalConfirm
                ? window.modalConfirm('다운로드가 진행 중입니다.\n페이지를 이동하면 다운로드가 중단됩니다. 이동하시겠습니까?')
                : Promise.resolve(true)
            ).then(function (ok) {
                if (!ok) return;
                abortAllDownloads();
                go();
            });
        }, true);
    }

    document.addEventListener('DOMContentLoaded', function () {
        if (isNative()) {
            document.documentElement.classList.add('is-native');
        }
        patchPlayerFullscreen();
        hideDownloadsTabOnWeb();
        patchAnimeModalCloseGuard();
        bindDownloadNavGuard();
        bindDownloadButtons();
        bindLibraryClicks();
        bindOfflineRedirect();
        renderLibrary();
    });

    window.AniHyNative = {
        isNative: isNative,
        getPlatform: getPlatform,
        list: store.list,
        find: findItem,
        downloadEpisode: downloadEpisode,
        deleteDownload: deleteDownload,
        playEpisode: playEpisode,
        openOfflinePlayer: openOfflinePlayer,
        openDownloadedAnime: openDownloadedAnime,
        refreshLibrary: refreshLibrary,
        getActiveDownloadCount: getActiveDownloadCount,
        abortAllDownloads: abortAllDownloads
    };
})();
