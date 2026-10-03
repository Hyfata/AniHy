/* AniHy native bridge — Capacitor 앱과 웹 공용 다운로드/오프라인 재생 브릿지.
 *
 * - 웹(브라우저)에서는 no-op에 가깝게 동작 (보관함>다운로드는 안내 문구만 표시,
 *   다운로드 버튼은 기존 웹 다운로드 흐름 유지).
 * - Capacitor 네이티브 앱에서는:
 *   1) 에피소드/전체 다운로드 가로채기 → 앱 내부 저장소(Directory.Data)에 저장
 *   2) 보관함>다운로드 탭에 애니별 저장 목록 렌더 (재생/삭제)
 *   3) 오프라인에서는 저장된 회차를 로컬 오프라인 플레이어로 재생
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
    // - 하단 탭바: WKWebView는 backdrop-filter 떨림이 없으므로 리퀴드 글래스 강화
    if (isNative()) {
        var nativeStyle = document.createElement('style');
        nativeStyle.id = 'anihy-native-overrides';
        nativeStyle.textContent = [
            '.navbar { backdrop-filter: none; }',
            '/* 애니 모달 본문: iframe 내부 문서에서는 var(--anihy-sat, env(safe-area-inset-top, 0px))이 0이라',
            '   embed 페이지 쪽 패딩은 무의미 — 부모 페이지에서 모달 자체를 아래로 밀어야 함 */',
            '@media (max-width: 640px) {',
            '    .modal.anime-modal { padding-top: var(--anihy-sat, env(safe-area-inset-top, 0px)); }',
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
            '.episode-dl-btn .dl-pct { font-size: 0.7rem; font-weight: 600; }',
            '.episode-dl-btn .dl-speed { font-size: 0.62rem; color: var(--text-muted); margin-left: 1px; }',
            '#download-all-btn .dl-speed { font-size: 0.75rem; color: var(--text-muted); }',
            '/* 저장본 삭제 버튼 (네이티브에서 브릿지가 동적 삽입) */',
            '.dl-delete-all { color: var(--danger); }',
            '.dl-actions-bar { display: flex; justify-content: flex-end; margin-bottom: 10px; }',
            '/* 저장본 전용 모달: 선택 삭제 모드 */',
            '.dl-only-notice { display: flex; align-items: center; justify-content: space-between; gap: 10px; }',
            '.dl-select-toggle.active { color: var(--danger); border-color: var(--danger); }',
            '#episode-list.dl-select-mode .episode-item.dl-selected { border-color: var(--danger); background: rgba(255, 77, 109, 0.10); }',
            '/* 오프라인 모드 네이티브 보관함 오버레이 */',
            '#anihy-offline { position: fixed; inset: 0; z-index: 9000; background: #0b0c0f; color: #e8e8f0; display: flex; flex-direction: column; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }',
            '#anihy-offline .aoff-header { display: flex; align-items: center; gap: 10px; padding: calc(12px + var(--anihy-sat, env(safe-area-inset-top, 0px))) 16px 12px; border-bottom: 1px solid rgba(255,255,255,0.07); }',
            '#anihy-offline .aoff-title { flex: 1; margin: 0; font-size: 1.05rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
            '#anihy-offline .aoff-retry, #anihy-offline .aoff-actions button { padding: 7px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.14); background: #16181d; color: #e8e8f0; font-size: 0.8rem; }',
            '#anihy-offline .aoff-body { flex: 1; overflow-y: auto; padding: 14px 16px calc(24px + var(--anihy-sab, env(safe-area-inset-bottom, 0px))); display: flex; flex-direction: column; gap: 10px; }',
            '#anihy-offline .aoff-card { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.07); background: #16181d; color: #e8e8f0; text-align: left; }',
            '#anihy-offline .aoff-cover { width: 52px; height: 70px; object-fit: cover; border-radius: 8px; flex: none; }',
            '#anihy-offline .aoff-card-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }',
            '#anihy-offline .aoff-card-title { font-size: 0.95rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
            '#anihy-offline .aoff-card-sub, #anihy-offline .aoff-ep-sub { font-size: 0.78rem; color: #8b92a8; }',
            '#anihy-offline .aoff-arrow { color: #8b92a8; font-size: 1.2rem; }',
            '#anihy-offline .aoff-actions { display: flex; gap: 8px; margin-bottom: 4px; }',
            '#anihy-offline .aoff-actions .aoff-danger { color: #ff4d6d; }',
            '#anihy-offline .aoff-sel.active { color: #ff4d6d; border-color: #ff4d6d; }',
            '#anihy-offline .aoff-ep { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.07); background: #16181d; }',
            '#anihy-offline .aoff-ep.aoff-selected { border-color: #ff4d6d; background: rgba(255,77,109,0.12); }',
            '#anihy-offline .aoff-badge { flex: none; min-width: 40px; text-align: center; padding: 6px 8px; border-radius: 8px; background: rgba(255,255,255,0.08); font-weight: 700; font-size: 0.85rem; }',
            '#anihy-offline .aoff-ep-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }',
            '#anihy-offline .aoff-ep-title { font-size: 0.92rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
            '#anihy-offline .aoff-empty { color: #8b92a8; font-size: 0.9rem; padding: 20px 0; text-align: center; }'
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

    function epFileBase(ep) {
        var raw = String(ep);
        if (/^[a-zA-Z0-9._-]+$/.test(raw)) return raw;
        var safe = sanitize(raw);
        var h = 5381;
        for (var i = 0; i < raw.length; i++) {
            h = ((h << 5) + h + raw.charCodeAt(i)) >>> 0;
        }
        return safe + '.' + h.toString(16).padStart(6, '0');
    }

    function mp4RelPath(aid, ep) {
        return DL_DIR + '/' + aid + '/' + epFileBase(ep) + '.mp4';
    }

    function vttRelPath(aid, ep) {
        return DL_DIR + '/' + aid + '/' + epFileBase(ep) + '.chapters.vtt';
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
        var startT = Date.now();
        var speedOf = function () {
            var elapsed = (Date.now() - startT) / 1000;
            return elapsed > 0.05 ? loaded / elapsed : 0;
        };
        if (!reader) {
            // 스트리밍 미지원 환경 폴백 (작은 파일용)
            var buf = new Uint8Array(await res.arrayBuffer());
            if (signal && signal.aborted) throw new Error('aborted');
            await f.writeFile({ path: relPath, directory: 'DATA', data: u8ToB64(buf), recursive: true });
            loaded = buf.byteLength;
            if (onProgress) onProgress(100, speedOf());
            return total || buf.byteLength;
        }
        for (;;) {
            if (signal && signal.aborted) throw new Error('aborted');
            var chunk = await reader.read();
            if (chunk.done) break;
            await f.appendFile({ path: relPath, directory: 'DATA', data: u8ToB64(chunk.value) });
            loaded += chunk.value.byteLength;
            if (onProgress && total > 0) onProgress(Math.min(99, (loaded / total) * 100), speedOf());
        }
        if (onProgress) onProgress(100, speedOf());
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
    var downloadAllActive = false;

    function getActiveDownloadCount() {
        return Object.keys(busy).length;
    }

    function isDownloadAllActive() {
        return downloadAllActive;
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
    function progressHtml(pct, bps) {
        var html = ringSvg(pct) + '<span class="dl-pct">' + Math.round(pct) + '%</span>';
        var spd = bps ? fmtBytes(bps) : '';
        if (spd) html += '<span class="dl-speed">' + spd + '/s</span>';
        return html;
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
        if (downloadsAborted) {
            if (getActiveDownloadCount() > 0) return false;
            downloadsAborted = false;
        }
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
            if (controller && controller.signal.aborted) throw new Error('aborted');
            await upsertItem({
                aid: Number(aid),
                ep: ep,
                anime: opts.anime || '',
                title: opts.title || (ep + '화'),
                size: bytes || 0,
                hasChapters: hasVtt,
                cover: opts.cover || '',
                coverLocal: await cacheCover(aid, opts.cover, controller ? controller.signal : null),
                createdAt: Date.now()
            });
            setProgress(100);
            refreshLibrary();
            // 저장본 삭제 버튼이 숨겨져 있었다면 표시
            var delBtn = document.getElementById('dl-delete-anime-btn');
            if (delBtn && String(delBtn.getAttribute('data-aid')) === String(aid)) delBtn.style.display = '';
            return true;
        } catch (err) {
            await deleteStorageFile(mp4RelPath(aid, ep));
            await deleteStorageFile(vttRelPath(aid, ep));
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
        if (!item) return false;
        if (!(await window.modalConfirm('"' + (item.title || ep + '화') + '" 저장본을 삭제하시겠습니까?'))) return false;
        await deleteStorageFile(mp4RelPath(aid, ep));
        await deleteStorageFile(vttRelPath(aid, ep));
        await removeItem(aid, ep);
        // 같은 애니의 마지막 저장본이면 로컬 커버도 정리
        var left = await store.list();
        var stillThere = left.some(function (it) { return String(it.aid) === String(aid); });
        if (!stillThere && item.coverLocal) await deleteStorageFile(item.coverLocal);
        refreshLibrary();
        // 현재 문서에 보이는 완료 아이콘도 원래 다운로드 아이콘으로 되돌림
        document.querySelectorAll('.episode-dl-btn.is-downloaded').forEach(function (btn) {
            if (String(btn.dataset.aid) !== String(aid) || String(btn.dataset.ep) !== String(ep)) return;
            btn.classList.remove('is-downloaded');
            if (btn.__origHtml) btn.innerHTML = btn.__origHtml;
        });
        return true;
    }

    // 저장본 일괄 삭제: aid 지정 시 해당 애니만, null이면 전체
    async function deleteSavedDownloads(aid) {
        var items = await store.list();
        var targets = aid == null
            ? items
            : items.filter(function (it) { return String(it.aid) === String(aid); });
        if (!targets.length) return false;
        var msg = aid == null
            ? '저장된 영상 ' + targets.length + '개를 모두 삭제하시겠습니까?\n삭제 후에는 복구할 수 없습니다.'
            : '이 애니의 저장된 영상 ' + targets.length + '개를 모두 삭제하시겠습니까?\n삭제 후에는 복구할 수 없습니다.';
        if (!(await window.modalConfirm(msg))) return false;
        for (var i = 0; i < targets.length; i++) {
            await deleteStorageFile(mp4RelPath(targets[i].aid, targets[i].ep));
            await deleteStorageFile(vttRelPath(targets[i].aid, targets[i].ep));
            if (targets[i].coverLocal) await deleteStorageFile(targets[i].coverLocal);
        }
        await store.save(items.filter(function (it) { return aid != null && String(it.aid) !== String(aid); }));
        refreshLibrary();
        // 현재 문서에 보이는 완료 아이콘도 원래 다운로드 아이콘으로 되돌림
        document.querySelectorAll('.episode-dl-btn.is-downloaded').forEach(function (btn) {
            if (aid != null && String(btn.dataset.aid) !== String(aid)) return;
            btn.classList.remove('is-downloaded');
            if (btn.__origHtml) btn.innerHTML = btn.__origHtml;
        });
        return true;
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
        var html = '<div class="dl-actions-bar">'
            + '<button type="button" class="btn btn-sm btn-danger dl-delete-all" data-dl-del-all="1">저장본 전체 삭제</button>'
            + '</div>'
            + '<div class="dl-groups">';
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
                + '</section>';
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

    // 저장 시 커버도 로컬에 캐시 (오프라인 UI에서 사용, best-effort)
    async function cacheCover(aid, coverUrl, signal) {
        if (!coverUrl) return '';
        var m = /\.(jpg|jpeg|png|webp|gif)(?:[?#]|$)/i.exec(coverUrl);
        var rel = DL_DIR + '/' + aid + '/cover' + (m ? '.' + m[1].toLowerCase() : '.jpg');
        try {
            await fetchToFile(coverUrl, rel, null, signal || null);
            return rel;
        } catch (e) {
            return '';
        }
    }

    // 오프라인 UI용 커버 src: 로컬 캐시 우선, 없으면 원격 URL
    // 오프라인인데 로컬 캐시가 없거나 해석 실패 시 깨진 이미지 대신 빈 src
    async function resolveCoverSrc(it) {
        if (it.coverLocal) {
            try {
                var f = fs();
                var c = cap();
                if (f && c && c.convertFileSrc) {
                    var uri = await f.getUri({ path: it.coverLocal, directory: 'DATA' });
                    if (uri && uri.uri) return c.convertFileSrc(uri.uri);
                }
            } catch (e) { /* fallback */ }
        }
        if (navigator.onLine === false) return '';
        return it.cover || '';
    }

    function epSortNative(a, b) {
        var num = function (v) {
            var m = /^(\d+(?:\.\d+)?)/.exec(String(v));
            return m ? parseFloat(m[1]) : NaN;
        };
        var na = num(a.ep), nb = num(b.ep);
        if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
        return String(a.ep).localeCompare(String(b.ep), 'ko', { numeric: true });
    }

    // ---------- 오프라인 모드 (네트워크 단절 시 네이티브 보관함 UI) ----------
    var offOverlay = null;
    var offState = { aid: null, select: false };

    function hideOfflineLibrary() {
        if (offOverlay) { offOverlay.remove(); offOverlay = null; }
    }

    async function renderOfflineBody() {
        if (!offOverlay) return;
        var body = offOverlay.querySelector('.aoff-body');
        var titleEl = offOverlay.querySelector('.aoff-title');
        var items = await store.list();
        if (!items.length) {
            offState.aid = null;
            titleEl.textContent = '오프라인 모드';
            body.innerHTML = '<div class="aoff-empty">저장된 영상이 없습니다.<br>온라인에서 회차를 저장하면 오프라인에서 볼 수 있습니다.</div>';
            return;
        }
        if (!offState.aid) {
            // 애니 카드 목록
            titleEl.textContent = '오프라인 모드';
            var groups = {}, order = [];
            items.forEach(function (it) {
                var k = String(it.aid);
                if (!groups[k]) { groups[k] = { aid: it.aid, anime: it.anime || ('애니 #' + it.aid), eps: [], coverItem: null }; order.push(k); }
                groups[k].eps.push(it);
                if (!groups[k].coverItem && (it.coverLocal || it.cover)) groups[k].coverItem = it;
            });
            var html = '';
            order.forEach(function (k) {
                var g = groups[k];
                var total = g.eps.reduce(function (s, it) { return s + (Number(it.size) || 0); }, 0);
                html += '<button type="button" class="aoff-card" data-aid="' + esc(g.aid) + '">'
                    + '<img class="aoff-cover" alt="" style="display:none">'
                    + '<span class="aoff-card-meta"><span class="aoff-card-title">' + esc(g.anime) + '</span>'
                    + '<span class="aoff-card-sub">' + g.eps.length + '개 저장됨' + (total ? ' · ' + esc(fmtBytes(total)) : '') + '</span></span>'
                    + '<span class="aoff-arrow">›</span></button>';
            });
            body.innerHTML = html;
            order.forEach(function (k) {
                var g = groups[k];
                if (!g.coverItem) return;
                var img = body.querySelector('.aoff-card[data-aid="' + esc(g.aid) + '"] .aoff-cover');
                resolveCoverSrc(g.coverItem).then(function (src) {
                    if (src && img) { img.src = src; img.style.display = ''; }
                });
            });
            body.querySelectorAll('.aoff-card').forEach(function (card) {
                card.addEventListener('click', function () {
                    offState.aid = card.getAttribute('data-aid');
                    offState.select = false;
                    renderOfflineBody();
                });
            });
            return;
        }
        // 애니 상세 (저장 회차 목록)
        var mine = items.filter(function (it) { return String(it.aid) === String(offState.aid); }).sort(epSortNative);
        if (!mine.length) {
            offState.aid = null;
            renderOfflineBody();
            return;
        }
        titleEl.textContent = mine[0].anime || ('애니 #' + offState.aid);
        var html = '<div class="aoff-actions">'
            + '<button type="button" class="aoff-back">‹ 목록</button>'
            + '<button type="button" class="aoff-sel">' + (offState.select ? '선택 삭제 (0)' : '선택 삭제') + '</button>'
            + '<button type="button" class="aoff-danger aoff-delall">전체 삭제</button>'
            + '</div>';
        mine.forEach(function (it) {
            html += '<div class="aoff-ep" data-ep="' + esc(it.ep) + '" role="button">'
                + '<span class="aoff-badge">' + esc(it.ep) + '</span>'
                + '<span class="aoff-ep-meta"><span class="aoff-ep-title">' + esc(it.title || (it.ep + '화')) + '</span>'
                + '<span class="aoff-ep-sub">' + esc([fmtBytes(it.size), it.createdAt ? new Date(it.createdAt).toLocaleDateString() : ''].filter(Boolean).join(' · ')) + '</span></span>'
                + '</div>';
        });
        body.innerHTML = html;
        body.querySelector('.aoff-back').addEventListener('click', function () {
            offState.aid = null;
            offState.select = false;
            renderOfflineBody();
        });
        var selBtn = body.querySelector('.aoff-sel');
        var paintSel = function () {
            var n = body.querySelectorAll('.aoff-ep.aoff-selected').length;
            selBtn.textContent = offState.select ? '선택 삭제 (' + n + ')' : '선택 삭제';
            selBtn.classList.toggle('active', offState.select);
        };
        selBtn.addEventListener('click', function () {
            if (!offState.select) {
                offState.select = true;
                paintSel();
                return;
            }
            var rows = Array.prototype.slice.call(body.querySelectorAll('.aoff-ep.aoff-selected'));
            if (!rows.length) {
                offState.select = false;
                paintSel();
                return;
            }
            (window.modalConfirm
                ? window.modalConfirm('선택한 ' + rows.length + '개 회차의 저장본을 삭제하시겠습니까?')
                : Promise.resolve(true)
            ).then(async function (ok) {
                if (!ok) return;
                for (var i = 0; i < rows.length; i++) {
                    var ep = rows[i].getAttribute('data-ep');
                    await deleteStorageFile(mp4RelPath(offState.aid, ep));
                    await deleteStorageFile(vttRelPath(offState.aid, ep));
                    await removeItem(offState.aid, ep);
                }
                offState.select = false;
                refreshLibrary();
                renderOfflineBody();
            });
        });
        body.querySelector('.aoff-delall').addEventListener('click', function () {
            deleteSavedDownloads(offState.aid).then(function (deleted) {
                if (deleted) {
                    offState.aid = null;
                    offState.select = false;
                    renderOfflineBody();
                }
            });
        });
        body.querySelectorAll('.aoff-ep').forEach(function (row) {
            row.addEventListener('click', function () {
                var ep = row.getAttribute('data-ep');
                if (offState.select) {
                    row.classList.toggle('aoff-selected');
                    paintSel();
                    return;
                }
                openOfflinePlayer(offState.aid, ep);
            });
        });
    }

    function showOfflineLibrary(aid) {
        if (!isNative()) return;
        if (offOverlay) {
            offState.aid = aid || null;
            offState.select = false;
            renderOfflineBody();
            return;
        }
        offOverlay = document.createElement('div');
        offOverlay.id = 'anihy-offline';
        offOverlay.innerHTML = '<div class="aoff-header">'
            + '<h1 class="aoff-title">오프라인 모드</h1>'
            + '<button type="button" class="aoff-retry">다시 시도</button>'
            + '</div>'
            + '<div class="aoff-body"></div>';
        document.body.appendChild(offOverlay);
        offOverlay.querySelector('.aoff-retry').addEventListener('click', function () {
            window.location.reload();
        });
        offState.aid = aid || null;
        offState.select = false;
        renderOfflineBody();
    }

    function bindOfflineMode() {
        if (!isNative()) return;
        // 번들 오프라인 페이지가 복귀할 서버 주소를 Preferences에 저장
        try {
            var p = plugins().Preferences;
            if (p) p.set({ key: 'anihy_server_url', value: window.location.origin + '/anime/' });
        } catch (e) { /* ignore */ }
    }

    // 애니별 그룹 헤더 → 애니 모달을 "저장된 회차만"으로 필터해 오픈
    var pendingDlFilter = null;

    function openDownloadedAnime(aid) {
        // 오프라인에서는 iframe 모달(원격 페이지)을 열 수 없으므로 네이티브 UI로 대체
        if (!navigator.onLine) {
            showOfflineLibrary(String(aid));
            return;
        }
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
        // 저장본 전용 뷰에서는 온라인 전용 액션(전체 다운로드, 나무위키 등) 숨김
        // — 저장본 삭제(#dl-delete-anime-btn)는 유지
        doc.querySelectorAll('.poster-action').forEach(function (el) {
            if (el.id === 'dl-delete-anime-btn') return;
            el.style.display = 'none';
        });
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
        // 저장본 전용 안내 배너 + 선택 삭제 모드 토글
        var banner = doc.getElementById('dl-only-notice');
        if (!banner) {
            banner = doc.createElement('div');
            banner.id = 'dl-only-notice';
            banner.className = 'dl-only-notice';
            list.parentNode.insertBefore(banner, list);
        }
        banner.innerHTML = '<span class="dl-only-text">저장된 ' + shown + '개 회차만 표시됩니다.</span>'
            + (shown > 0 ? '<button type="button" class="btn btn-sm dl-select-toggle">선택 삭제</button>' : '');
        if (shown === 0) {
            var empty = doc.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = '저장된 회차가 없습니다.';
            list.appendChild(empty);
        }
        bindDlSelectMode(doc, list, banner, aid);
    }

    // 저장본 전용 모달의 선택 삭제 모드: 행 탭이 시청 이동 대신 선택 토글이 되도록
    // iframe 문서에 capture 리스너를 걸어 기존 핸들러를 차단
    function bindDlSelectMode(doc, list, banner, aid) {
        if (list.__dlSelectBound) return;
        list.__dlSelectBound = true;
        var selectMode = false;
        var toggleBtn = banner.querySelector('.dl-select-toggle');
        if (!toggleBtn) return;

        var selected = function () {
            return list.querySelectorAll('.episode-item.dl-selected');
        };
        var paintToggle = function () {
            toggleBtn.textContent = selectMode
                ? '선택 삭제 (' + selected().length + ')'
                : '선택 삭제';
            toggleBtn.classList.toggle('active', selectMode);
        };

        // 선택 모드에서는 회차 행 탭 = 선택 토글 (시청 이동 차단)
        list.addEventListener('click', function (e) {
            if (!selectMode) return;
            var row = e.target && e.target.closest ? e.target.closest('.episode-item') : null;
            if (!row) return;
            e.preventDefault();
            e.stopPropagation();
            if (e.stopImmediatePropagation) e.stopImmediatePropagation();
            row.classList.toggle('dl-selected');
            paintToggle();
        }, true);

        toggleBtn.addEventListener('click', function () {
            if (!selectMode) {
                selectMode = true;
                list.classList.add('dl-select-mode');
                paintToggle();
                return;
            }
            var rows = Array.prototype.slice.call(selected());
            if (!rows.length) {
                // 아무것도 선택 안 하고 다시 누르면 모드 해제
                selectMode = false;
                list.classList.remove('dl-select-mode');
                paintToggle();
                return;
            }
            (window.modalConfirm
                ? window.modalConfirm('선택한 ' + rows.length + '개 회차의 저장본을 삭제하시겠습니까?')
                : Promise.resolve(true)
            ).then(async function (ok) {
                if (!ok) return;
                for (var i = 0; i < rows.length; i++) {
                    var a = rows[i].getAttribute('data-aid');
                    var ep = rows[i].getAttribute('data-ep');
                    await deleteStorageFile(mp4RelPath(a, ep));
                    await deleteStorageFile(vttRelPath(a, ep));
                    await removeItem(a, ep);
                    rows[i].remove();
                }
                selectMode = false;
                list.classList.remove('dl-select-mode');
                refreshLibrary();
                var textEl = banner.querySelector('.dl-only-text');
                var left = list.querySelectorAll('.episode-item').length;
                if (textEl) textEl.textContent = '저장된 ' + left + '개 회차만 표시됩니다.';
                if (left === 0) {
                    toggleBtn.remove();
                    var empty = doc.createElement('div');
                    empty.className = 'empty-state';
                    empty.textContent = '저장된 회차가 없습니다.';
                    list.appendChild(empty);
                } else {
                    paintToggle();
                }
            });
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
                // 전체 다운로드 진행 중에는 어떤 회차 버튼을 눌러도 전체 취소 확인
                if (downloadAllActive) {
                    (window.modalConfirm ? window.modalConfirm('전체 다운로드가 진행 중입니다.\n다운로드를 취소하시겠습니까?') : Promise.resolve(true))
                        .then(function (ok) { if (ok) abortAllDownloads(); });
                    return;
                }
                // 다운로드 중 탭 → 취소 여부 확인 후 중단
                if (busy[epKey(d.aid, d.ep)]) {
                    (window.modalConfirm ? window.modalConfirm('다운로드를 취소하시겠습니까?') : Promise.resolve(true))
                        .then(function (ok) { if (ok) abortDownload(d.aid, d.ep); });
                    return;
                }
                // 이미 저장된 회차 탭 → 삭제 여부 확인 후 삭제
                if (btn.classList.contains('is-downloaded')) {
                    deleteDownload(d.aid, d.ep);
                    return;
                }
                downloadsAborted = false;
                downloadEpisode({
                    aid: d.aid, ep: d.ep, anime: d.anime, title: d.title,
                    url: btn.getAttribute('href'),
                    size: d.size, chaptersUrl: d.chapters || null, cover: currentCover(),
                    // 아이콘 자리에 진행률 링+%+속도 표시, 완료 시 체크 아이콘 / 실패·중단 시 원래 아이콘
                    onProgress: function (p, bps) {
                        btn.classList.add('is-downloading');
                        btn.innerHTML = progressHtml(p, bps);
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
                // 진행 중에 전체 다운로드 버튼 탭 → 전체 취소 확인
                if (downloadAllActive) {
                    if (await window.modalConfirm('전체 다운로드를 취소하시겠습니까?')) abortAllDownloads();
                    return;
                }
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
                var setAllProgress = function (idx, pct, bps) {
                    // 전체 진행률 = 완료된 회차 + 현재 회차 진행분
                    var overall = ((idx + pct / 100) / pending.length) * 100;
                    var cur = allBtn.querySelector('svg');
                    if (cur) cur.outerHTML = ringSvg(overall);
                    if (labelEl) {
                        var spd = bps ? fmtBytes(bps) : '';
                        labelEl.textContent = (idx + 1) + '/' + pending.length + ' · ' + Math.round(overall) + '%' + (spd ? ' · ' + spd + '/s' : '');
                    }
                };
                downloadAllActive = true;
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
                            return function (p, bps) {
                                setAllProgress(idx2, p, bps);
                                btn2.innerHTML = progressHtml(p, bps);
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
                downloadAllActive = false;
                await window.modalAlert(ok + '/' + pending.length + '개 저장 완료');
            }, true);
        }

        // 이 애니의 저장본 일괄 삭제 버튼 (네이티브 전용, 저장본이 있을 때만 표시)
        if (allBtn && allBtn.dataset.aid && !document.getElementById('dl-delete-anime-btn')) {
            var delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'poster-action dl-delete-all';
            delBtn.id = 'dl-delete-anime-btn';
            delBtn.setAttribute('data-aid', allBtn.dataset.aid);
            delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'
                + '<span>저장본 삭제</span>';
            delBtn.style.display = 'none';
            delBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
                deleteSavedDownloads(allBtn.dataset.aid).then(function (deleted) {
                    if (deleted) delBtn.style.display = 'none';
                });
            }, true);
            allBtn.parentNode.insertBefore(delBtn, allBtn.nextSibling);
            store.list().then(function (items) {
                var has = items.some(function (it) { return String(it.aid) === String(allBtn.dataset.aid); });
                delBtn.style.display = has ? '' : 'none';
            });
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
            var delAll = e.target && e.target.closest ? e.target.closest('[data-dl-del-all]') : null;
            if (delAll) {
                deleteSavedDownloads(null);
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
        hideDownloadsTabOnWeb();
        patchAnimeModalCloseGuard();
        bindDownloadNavGuard();
        bindDownloadButtons();
        bindLibraryClicks();
        bindOfflineRedirect();
        bindOfflineMode();
        renderLibrary();
    });

    window.AniHyNative = {
        isNative: isNative,
        getPlatform: getPlatform,
        list: store.list,
        find: findItem,
        downloadEpisode: downloadEpisode,
        deleteDownload: deleteDownload,
        deleteSavedDownloads: deleteSavedDownloads,
        playEpisode: playEpisode,
        openOfflinePlayer: openOfflinePlayer,
        openDownloadedAnime: openDownloadedAnime,
        showOfflineLibrary: showOfflineLibrary,
        refreshLibrary: refreshLibrary,
        getActiveDownloadCount: getActiveDownloadCount,
        abortAllDownloads: abortAllDownloads
    };
})();
