/* 오프라인 보관함 페이지 로직 (앱 번들, 네트워크 불필요).
 * - Preferences의 다운로드 메타(anihy_downloads_v1)로 애니 카드 → 저장 회차 목록 렌더
 * - 회차 탭 → offline-player.html로 재생 / 선택 삭제 / 전체 삭제 지원
 * - 네트워크 복구 시(online 이벤트 또는 다시 시도 버튼) Preferences에 저장된 서버 URL로 복귀
 */
(function () {
    'use strict';

    var META_KEY = 'anihy_downloads_v1';
    var SERVER_URL_KEY = 'anihy_server_url';

    var state = { aid: null, select: false };

    function cap() {
        return (typeof window.Capacitor !== 'undefined') ? window.Capacitor : null;
    }

    function plugins() {
        var c = cap();
        return (c && c.Plugins) ? c.Plugins : {};
    }

    function sanitize(name) {
        return String(name).replace(/[^a-zA-Z0-9._-]/g, '_');
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function fmtBytes(n) {
        n = Number(n) || 0;
        if (n <= 0) return '';
        var units = ['B', 'KB', 'MB', 'GB'];
        var i = 0;
        while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
        return (i === 0 ? String(Math.round(n)) : n.toFixed(1)) + ' ' + units[i];
    }

    function epSort(a, b) {
        var num = function (v) {
            var m = /^(\d+(?:\.\d+)?)/.exec(String(v));
            return m ? parseFloat(m[1]) : NaN;
        };
        var na = num(a.ep), nb = num(b.ep);
        if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
        return String(a.ep).localeCompare(String(b.ep), 'ko', { numeric: true });
    }

    async function loadItems() {
        try {
            var p = plugins().Preferences;
            if (p) {
                var r = await p.get({ key: META_KEY });
                if (r && r.value) return JSON.parse(r.value) || [];
            }
        } catch (e) { /* ignore */ }
        try {
            return JSON.parse(localStorage.getItem(META_KEY) || '[]') || [];
        } catch (e) {
            return [];
        }
    }

    async function saveItems(items) {
        var raw = JSON.stringify(items);
        try {
            var p = plugins().Preferences;
            if (p) {
                await p.set({ key: META_KEY, value: raw });
                return;
            }
        } catch (e) { /* ignore */ }
        try { localStorage.setItem(META_KEY, raw); } catch (e) { /* ignore */ }
    }

    async function deleteFile(relPath) {
        var f = plugins().Filesystem;
        if (!f) return;
        try { await f.deleteFile({ path: relPath, directory: 'DATA' }); } catch (e) { /* ignore */ }
    }

    async function resolveCoverSrc(it) {
        if (it.coverLocal) {
            try {
                var f = plugins().Filesystem;
                var c = cap();
                if (f && c && c.convertFileSrc) {
                    var uri = await f.getUri({ path: it.coverLocal, directory: 'DATA' });
                    if (uri && uri.uri) return c.convertFileSrc(uri.uri);
                }
            } catch (e) { /* fallback */ }
        }
        return it.cover || '';
    }

    async function retryOnline() {
        var url = '';
        try {
            var p = plugins().Preferences;
            if (p) {
                var r = await p.get({ key: SERVER_URL_KEY });
                url = (r && r.value) || '';
            }
        } catch (e) { /* ignore */ }
        if (!url) {
            try { url = localStorage.getItem(SERVER_URL_KEY) || ''; } catch (e) { /* ignore */ }
        }
        if (url) {
            window.location.href = url;
        } else {
            var sub = document.getElementById('lib-subtitle');
            if (sub) sub.textContent = '서버 주소를 알 수 없습니다. 네트워크 연결 후 앱을 다시 실행해 주세요.';
        }
    }

    async function render() {
        var listEl = document.getElementById('lib-list');
        var titleEl = document.getElementById('lib-title');
        var subEl = document.getElementById('lib-subtitle');
        var backBtn = document.getElementById('lib-back');
        var actions = document.getElementById('lib-actions');
        var items = await loadItems();

        if (!items.length) {
            state.aid = null;
            titleEl.textContent = '오프라인 보관함';
            subEl.textContent = '저장된 영상이 없습니다';
            backBtn.style.display = 'none';
            actions.style.display = 'none';
            listEl.innerHTML = '<div class="off-empty">저장된 영상이 없습니다.<br>온라인에서 회차를 저장하면 오프라인에서 볼 수 있습니다.</div>';
            return;
        }

        if (!state.aid) {
            // 애니 카드 목록
            titleEl.textContent = '오프라인 보관함';
            subEl.textContent = '네트워크 없이 저장된 영상을 재생할 수 있습니다';
            backBtn.style.display = 'none';
            actions.style.display = 'flex';
            document.getElementById('lib-select').style.display = 'none';
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
                html += '<button type="button" class="lib-card" data-aid="' + esc(g.aid) + '">'
                    + '<img class="lib-cover" alt="" style="display:none">'
                    + '<span class="lib-card-meta"><span class="lib-card-title">' + esc(g.anime) + '</span>'
                    + '<span class="lib-card-sub">' + g.eps.length + '개 저장됨' + (total ? ' · ' + esc(fmtBytes(total)) : '') + '</span></span>'
                    + '<span class="lib-arrow">›</span></button>';
            });
            listEl.innerHTML = html;
            order.forEach(function (k) {
                var g = groups[k];
                if (!g.coverItem) return;
                var img = listEl.querySelector('.lib-card[data-aid="' + esc(g.aid) + '"] .lib-cover');
                resolveCoverSrc(g.coverItem).then(function (src) {
                    if (src && img) { img.src = src; img.style.display = ''; }
                });
            });
            listEl.querySelectorAll('.lib-card').forEach(function (card) {
                card.addEventListener('click', function () {
                    state.aid = card.getAttribute('data-aid');
                    state.select = false;
                    render();
                });
            });
            return;
        }

        // 애니 상세 (저장 회차 목록)
        var mine = items.filter(function (it) { return String(it.aid) === String(state.aid); }).sort(epSort);
        if (!mine.length) {
            state.aid = null;
            state.select = false;
            render();
            return;
        }
        titleEl.textContent = mine[0].anime || ('애니 #' + state.aid);
        subEl.textContent = mine.length + '개 저장됨';
        backBtn.style.display = '';
        actions.style.display = 'flex';
        var selBtn = document.getElementById('lib-select');
        selBtn.style.display = '';
        var paintSel = function () {
            var n = listEl.querySelectorAll('.lib-ep.selected').length;
            selBtn.textContent = state.select ? '선택 삭제 (' + n + ')' : '선택 삭제';
            selBtn.classList.toggle('active', state.select);
        };
        paintSel();

        var html = '';
        mine.forEach(function (it) {
            html += '<button type="button" class="off-ep-item lib-ep" data-ep="' + esc(it.ep) + '">'
                + '<span class="off-ep-badge">' + esc(it.ep) + '</span>'
                + '<span class="off-ep-title">' + esc(it.title || (it.ep + '화'))
                + '<br><span class="lib-ep-sub">' + esc([fmtBytes(it.size), it.createdAt ? new Date(it.createdAt).toLocaleDateString() : ''].filter(Boolean).join(' · ')) + '</span></span>'
                + '</button>';
        });
        listEl.innerHTML = html;
        listEl.querySelectorAll('.lib-ep').forEach(function (row) {
            row.addEventListener('click', function () {
                var ep = row.getAttribute('data-ep');
                if (state.select) {
                    row.classList.toggle('selected');
                    paintSel();
                    return;
                }
                window.location.href = 'offline-player.html?aid=' + encodeURIComponent(state.aid)
                    + '&ep=' + encodeURIComponent(ep)
                    + '&back=' + encodeURIComponent('offline-library.html');
            });
        });

        selBtn.onclick = async function () {
            if (!state.select) {
                state.select = true;
                paintSel();
                return;
            }
            var rows = Array.prototype.slice.call(listEl.querySelectorAll('.lib-ep.selected'));
            if (!rows.length) {
                state.select = false;
                paintSel();
                return;
            }
            if (!window.confirm('선택한 ' + rows.length + '개 회차의 저장본을 삭제하시겠습니까?')) return;
            var all = await loadItems();
            for (var i = 0; i < rows.length; i++) {
                var ep = rows[i].getAttribute('data-ep');
                await deleteFile('downloads/' + state.aid + '/' + sanitize(ep) + '.mp4');
                await deleteFile('downloads/' + state.aid + '/' + sanitize(ep) + '.chapters.vtt');
                all = all.filter(function (it) {
                    return !(String(it.aid) === String(state.aid) && String(it.ep) === String(ep));
                });
            }
            // 같은 애니의 마지막 저장본이면 로컬 커버도 정리
            if (!all.some(function (it) { return String(it.aid) === String(state.aid); })) {
                var victim = mine[0];
                if (victim && victim.coverLocal) await deleteFile(victim.coverLocal);
            }
            await saveItems(all);
            state.select = false;
            render();
        };
    }

    document.addEventListener('DOMContentLoaded', function () {
        document.getElementById('lib-back').addEventListener('click', function () {
            state.aid = null;
            state.select = false;
            render();
        });
        document.getElementById('lib-retry').addEventListener('click', retryOnline);
        document.getElementById('lib-delall').addEventListener('click', async function () {
            var items = await loadItems();
            var targets = state.aid == null
                ? items
                : items.filter(function (it) { return String(it.aid) === String(state.aid); });
            if (!targets.length) return;
            var msg = state.aid == null
                ? '저장된 영상 ' + targets.length + '개를 모두 삭제하시겠습니까?'
                : '이 애니의 저장된 영상 ' + targets.length + '개를 모두 삭제하시겠습니까?';
            if (!window.confirm(msg)) return;
            for (var i = 0; i < targets.length; i++) {
                await deleteFile('downloads/' + targets[i].aid + '/' + sanitize(targets[i].ep) + '.mp4');
                await deleteFile('downloads/' + targets[i].aid + '/' + sanitize(targets[i].ep) + '.chapters.vtt');
                if (targets[i].coverLocal) await deleteFile(targets[i].coverLocal);
            }
            var remaining = state.aid == null
                ? []
                : items.filter(function (it) { return String(it.aid) !== String(state.aid); });
            await saveItems(remaining);
            state.aid = null;
            state.select = false;
            render();
        });
        // 네트워크 복구 시 자동으로 서버 페이지로 복귀
        window.addEventListener('online', retryOnline);
        render();
    });
})();
