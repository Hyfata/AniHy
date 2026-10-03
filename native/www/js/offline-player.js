/* 오프라인 재생 페이지 로직 (앱 번들, 네트워크 불필요).
 * - ?aid=&ep=&back= 파싱 → Preferences 메타 → Filesystem 로컬 파일 재생
 * - Hyfata 플레이어 그대로 사용, 전체화면은 플레이어 CSS 모드(fullscreenMode: 'css', iOS 자체 UI 유지)
 * - 같은 애니의 저장 회차 목록 + 자동 다음화 + 이어보기 지원 (watch.php 대응 기능)
 */
(function () {
    'use strict';

    var META_KEY = 'anihy_downloads_v1';

    function cap() {
        return (typeof window.Capacitor !== 'undefined') ? window.Capacitor : null;
    }

    function plugins() {
        var c = cap();
        return (c && c.Plugins) ? c.Plugins : {};
    }

    function params() {
        var q = new URLSearchParams(window.location.search);
        return {
            aid: q.get('aid') || '',
            ep: q.get('ep') || '',
            back: q.get('back') || ''
        };
    }

    function sanitize(name) {
        return String(name).replace(/[^a-zA-Z0-9._-]/g, '_');
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
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

    function epSort(a, b) {
        var num = function (v) {
            var m = /^(\d+(?:\.\d+)?)/.exec(String(v));
            return m ? parseFloat(m[1]) : NaN;
        };
        var na = num(a.ep), nb = num(b.ep);
        if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
        return String(a.ep).localeCompare(String(b.ep), 'ko', { numeric: true });
    }

    function progressKey(aid, ep) {
        return 'anihy_off_progress_' + aid + '_' + sanitize(ep);
    }

    document.addEventListener('DOMContentLoaded', async function () {
        var q = params();
        var titleEl = document.getElementById('off-title');
        var subEl = document.getElementById('off-subtitle');
        var backBtn = document.getElementById('off-back');
        var autoBtn = document.getElementById('off-autonext');
        var listEl = document.getElementById('offline-ep-list');

        backBtn.addEventListener('click', function () {
            if (window.history.length > 1) {
                window.history.back();
            } else if (q.back) {
                window.location.href = q.back;
            }
        });

        var autoNext = (localStorage.getItem('anihy_off_autonext') || 'on') === 'on';
        var paintAuto = function () {
            autoBtn.textContent = '자동 다음화: ' + (autoNext ? '켜짐' : '꺼짐');
            autoBtn.classList.toggle('on', autoNext);
        };
        autoBtn.addEventListener('click', function () {
            autoNext = !autoNext;
            try { localStorage.setItem('anihy_off_autonext', autoNext ? 'on' : 'off'); } catch (e) { /* ignore */ }
            paintAuto();
        });
        paintAuto();

        var c = cap();
        var fs = plugins().Filesystem;
        if (!c || !c.convertFileSrc || !fs) {
            titleEl.textContent = '재생할 수 없습니다';
            subEl.textContent = '네이티브 저장소 플러그인을 사용할 수 없습니다.';
            return;
        }

        var items = await loadItems();
        var mine = items.filter(function (it) { return String(it.aid) === String(q.aid); }).sort(epSort);
        var cur = null;
        for (var i = 0; i < mine.length; i++) {
            if (String(mine[i].ep) === String(q.ep)) { cur = mine[i]; break; }
        }
        if (!cur) {
            titleEl.textContent = '저장본을 찾을 수 없습니다';
            subEl.textContent = '보관함 > 다운로드에서 저장된 회차를 확인해 주세요.';
            return;
        }

        titleEl.textContent = cur.title || (cur.ep + '화');
        subEl.textContent = cur.anime || '';

        var src = null;
        var chaptersUrl = null;
        try {
            var uri = await fs.getUri({ path: 'downloads/' + cur.aid + '/' + sanitize(cur.ep) + '.mp4', directory: 'DATA' });
            src = c.convertFileSrc(uri.uri);
            if (cur.hasChapters) {
                try {
                    var vtt = await fs.getUri({ path: 'downloads/' + cur.aid + '/' + sanitize(cur.ep) + '.chapters.vtt', directory: 'DATA' });
                    chaptersUrl = c.convertFileSrc(vtt.uri);
                } catch (e) { chaptersUrl = null; }
            }
        } catch (e) {
            titleEl.textContent = '파일을 열 수 없습니다';
            subEl.textContent = String((e && e.message) || e);
            return;
        }

        var opts = { src: src, lang: 'ko', preload: 'auto', fullscreenMode: 'css' };
        if (chaptersUrl) opts.chaptersUrl = chaptersUrl;
        var player = new window.VideoPlayer('#offline-player', opts);

        // 이어보기 저장/복원
        var key = progressKey(cur.aid, cur.ep);
        var savedAt = 0;
        try { savedAt = parseFloat(localStorage.getItem(key) || '0') || 0; } catch (e) { /* ignore */ }
        if (savedAt > 5) {
            try {
                player.video.addEventListener('loadedmetadata', function handler() {
                    player.video.removeEventListener('loadedmetadata', handler);
                    if (isFinite(player.video.duration) && savedAt < player.video.duration - 10) {
                        if (typeof player.seekTo === 'function') player.seekTo(savedAt);
                        else player.video.currentTime = savedAt;
                    }
                });
            } catch (e) { /* ignore */ }
        }
        var saveTick = 0;
        var save = function () {
            try {
                if (player.video && isFinite(player.video.currentTime) && player.video.currentTime > 0) {
                    localStorage.setItem(key, String(player.video.currentTime));
                }
            } catch (e) { /* ignore */ }
        };
        player.video.addEventListener('timeupdate', function () {
            if (++saveTick % 10 === 0) save();
        });
        player.video.addEventListener('pause', save);

        // 저장된 회차 목록 + 자동 다음화
        var curIdx = -1;
        var html = '';
        mine.forEach(function (it, idx) {
            if (String(it.ep) === String(cur.ep)) curIdx = idx;
            html += '<button type="button" class="off-ep-item' + (String(it.ep) === String(cur.ep) ? ' active' : '') + '" data-ep="' + esc(it.ep) + '">'
                + '<span class="off-ep-badge">' + esc(it.ep) + '</span>'
                + '<span class="off-ep-title">' + esc(it.title || (it.ep + '화')) + '</span>'
                + '</button>';
        });
        listEl.innerHTML = html || '<div class="off-empty">저장된 회차가 없습니다.</div>';
        listEl.querySelectorAll('.off-ep-item').forEach(function (btn) {
            btn.addEventListener('click', function () {
                save();
                var url = new URL(window.location.href);
                url.searchParams.set('ep', btn.getAttribute('data-ep'));
                window.location.href = url.toString();
            });
        });

        player.video.addEventListener('ended', function () {
            save();
            try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
            if (!autoNext) return;
            if (curIdx >= 0 && mine[curIdx + 1]) {
                var url = new URL(window.location.href);
                url.searchParams.set('ep', String(mine[curIdx + 1].ep));
                window.location.href = url.toString();
            }
        });
    });
})();
