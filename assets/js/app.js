document.addEventListener('DOMContentLoaded', () => {
    // Modal helpers
    window.openModal = (id) => {
        document.getElementById(id).classList.add('active');
    };

    window.closeModal = (id) => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.remove('active');
            el.dispatchEvent(new CustomEvent('modal-closed', { bubbles: false }));
        }
    };

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', e => {
            if (e.target === overlay) closeModal(overlay.id);
        });
    });

    // Generic confirm delete
    window.confirmDelete = (message) => confirm(message || '정말 삭제하시겠습니까?');

    // Anime description more/less toggle
    const animeInfo = document.getElementById('anime-info');
    const animeDesc = document.getElementById('anime-desc');
    const descMoreBtn = document.getElementById('desc-more-btn');
    if (animeInfo && animeDesc && descMoreBtn) {
        if (animeDesc.scrollHeight > animeDesc.clientHeight) {
            descMoreBtn.classList.remove('hidden');
        }
        descMoreBtn.addEventListener('click', () => {
            animeInfo.classList.toggle('expanded');
            descMoreBtn.textContent = animeInfo.classList.contains('expanded') ? '접기' : '더보기';
        });
    }

    // Anime add form
    const animeForm = document.getElementById('anime-form');
    if (animeForm) {
        animeForm.addEventListener('submit', async e => {
            e.preventDefault();
            const formData = new FormData(animeForm);
            try {
                const res = await fetch('/anime/api/add_anime.php', { method: 'POST', body: formData });
                const data = await res.json();
                if (data.success) {
                    window.location.reload();
                } else {
                    alert(data.message || '애니 추가에 실패했습니다.');
                }
            } catch (err) {
                alert('오류: ' + err.message);
            }
        });
    }

    // Anime edit form
    const editAnimeForm = document.getElementById('edit-anime-form');
    if (editAnimeForm) {
        document.querySelectorAll('.edit-anime-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                document.getElementById('edit-id').value = btn.dataset.id;
                document.getElementById('edit-title').value = btn.dataset.title;
                document.getElementById('edit-description').value = btn.dataset.description;
                document.getElementById('edit-season-id').value = btn.dataset.seasonId || '';
                document.getElementById('edit-cover-preview').src = btn.dataset.cover;
                openModal('edit-anime-modal');
            });
        });

        editAnimeForm.addEventListener('submit', async e => {
            e.preventDefault();
            const formData = new FormData(editAnimeForm);
            try {
                const res = await fetch('/anime/api/update_anime.php', { method: 'POST', body: formData });
                const data = await res.json();
                if (data.success) {
                    window.location.reload();
                } else {
                    alert(data.message || '애니 수정에 실패했습니다.');
                }
            } catch (err) {
                alert('오류: ' + err.message);
            }
        });
    }

    // Season search helpers
    function setupSearch(btnId, inputId, resultId) {
        const searchBtn = document.getElementById(btnId);
        const searchInput = document.getElementById(inputId);
        const searchResult = document.getElementById(resultId);

        if (searchBtn && searchInput && searchResult) {
            searchBtn.addEventListener('click', async () => {
                const keyword = searchInput.value.trim();
                if (!keyword) return;
                searchResult.textContent = '검색 중...';
                try {
                    const res = await fetch('/anime/api/search.php?keyword=' + encodeURIComponent(keyword));
                    const text = await res.text();
                    searchResult.textContent = text;
                } catch (err) {
                    searchResult.textContent = '검색 오류: ' + err.message;
                }
            });
        }
    }

    setupSearch('search-btn', 'search-keyword', 'search-result');
    setupSearch('edit-search-btn', 'edit-search-keyword', 'edit-search-result');

    // English subtitle download button
    const downloadEnBtn = document.getElementById('download-en-subtitle-btn');
    if (downloadEnBtn) {
        downloadEnBtn.addEventListener('click', async () => {
            const animeId = document.querySelector('input[name="anime_id"]')?.value;
            const episodeNumber = document.getElementById('episode_number')?.value;
            if (!animeId || !episodeNumber) {
                alert('에피소드 번호를 입력하세요.');
                return;
            }

            downloadEnBtn.disabled = true;
            downloadEnBtn.textContent = '영어 자막 다운로드 중...';

            try {
                const res = await fetch('/anime/api/download_en_subtitle.php?aid=' + encodeURIComponent(animeId) + '&ep=' + encodeURIComponent(episodeNumber));
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    throw new Error(data.message || '다운로드 실패 (HTTP ' + res.status + ')');
                }

                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = episodeNumber + '_en.ass';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
            } catch (err) {
                alert('오류: ' + err.message);
            } finally {
                downloadEnBtn.disabled = false;
                downloadEnBtn.textContent = '영어 자막 다운로드';
            }
        });
    }

    // Episode add form
    const episodeForm = document.getElementById('episode-form');
    const progressBox = document.getElementById('progress-box');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    const logBox = document.getElementById('log-box');

    if (episodeForm) {
        episodeForm.addEventListener('submit', async e => {
            e.preventDefault();
            const formData = new FormData(episodeForm);
            const submitBtn = episodeForm.querySelector('button[type="submit"]');
            const originalText = submitBtn.textContent;
            submitBtn.disabled = true;
            submitBtn.textContent = '추가 중...';

            try {
                const res = await fetch('/anime/api/add_episode.php', { method: 'POST', body: formData });
                const data = await res.json();
                if (data.success) {
                    episodeForm.reset();
                    alert(data.message || '대기열에 추가되었습니다.');
                } else {
                    alert(data.message || '추가 실패');
                }
            } catch (err) {
                alert('오류: ' + err.message);
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
            }
        });
    }

    async function pollProgress(jobId, animeId) {
        const interval = setInterval(async () => {
            try {
                const res = await fetch('/anime/api/progress.php?job_id=' + jobId);
                const data = await res.json();
                if (data.success) {
                    progressFill.style.width = data.progress + '%';
                    progressText.textContent = `[${data.status}] ${data.message || ''}`;
                    if (data.status === 'completed') {
                        clearInterval(interval);
                        window.location.href = '/anime/anime.php?aid=' + animeId;
                    } else if (data.status === 'failed') {
                        clearInterval(interval);
                        document.querySelector('#episode-form button[type="submit"]').disabled = false;
                    }
                }
            } catch (err) {
                console.error(err);
            }
        }, 3000);
    }

    async function pollLog(jobId) {
        if (!logBox) return;
        let offset = 0;
        const interval = setInterval(async () => {
            try {
                const res = await fetch('/anime/api/log.php?job_id=' + jobId + '&offset=' + offset);
                const data = await res.json();
                if (data.success && data.content) {
                    logBox.textContent += data.content;
                    logBox.scrollTop = logBox.scrollHeight;
                    offset = data.offset;
                }
                if (progressText.textContent.includes('완료') || progressText.textContent.includes('실패')) {
                    clearInterval(interval);
                }
            } catch (err) {
                console.error(err);
            }
        }, 2000);
    }

    // Queue modal
    const queueModal = document.getElementById('queue-modal');
    const queueGroupsView = document.getElementById('queue-groups-view');
    const queueEpisodesView = document.getElementById('queue-episodes-view');
    const queueLogView = document.getElementById('queue-log-view');
    const queueGroupsList = document.getElementById('queue-groups-list');
    const queueEpisodesList = document.getElementById('queue-episodes-list');
    const queueEmpty = document.getElementById('queue-empty');
    const queueEpisodesTitle = document.getElementById('queue-episodes-title');
    const queueLogTitle = document.getElementById('queue-log-title');
    const queueLogProgress = document.getElementById('queue-log-progress');
    const queueLogEncodeProgress = document.getElementById('queue-log-encode-progress');
    const queueLogStatus = document.getElementById('queue-log-status');
    const queueLogBox = document.getElementById('queue-log-box');
    const backToGroups = document.getElementById('queue-back-to-groups');
    const backToEpisodes = document.getElementById('queue-back-to-episodes');

    let queueGroups = [];
    let selectedGroup = null;
    let selectedEpisode = null;
    let queuePollInterval = null;
    let queueLogInterval = null;
    let queueEncodeInterval = null;
    let queueProgressInterval = null;
    let queueLogOffset = 0;

    const statusMap = {
        pending: { text: '대기 중', class: 'status-pending' },
        downloading: { text: '다운로드 중', class: 'status-downloading' },
        downloading_subs: { text: '자막 다운로드 중', class: 'status-downloading' },
        preparing: { text: '자막 준비 중', class: 'status-preparing' },
        encoding: { text: '인코딩 중', class: 'status-encoding' },
        remuxing: { text: '변환 중', class: 'status-encoding' },
        subtitling: { text: '자막 입히는 중', class: 'status-encoding' },
        completed: { text: '완료', class: 'status-completed' },
        failed: { text: '실패', class: 'status-failed' }
    };

    function getStatusInfo(status) {
        return statusMap[status] || { text: status, class: 'status-pending' };
    }

    function hideQueueViews() {
        queueGroupsView.classList.add('hidden');
        queueEpisodesView.classList.add('hidden');
        queueLogView.classList.add('hidden');
    }

    function renderGroups(groups) {
        queueGroupsList.innerHTML = '';
        if (groups.length === 0) {
            queueEmpty.classList.remove('hidden');
            return;
        }
        queueEmpty.classList.add('hidden');

        groups.forEach(group => {
            const card = document.createElement('div');
            card.className = 'queue-card queue-group-card';
            const info = getStatusInfo(group.episodes[0]?.status || 'pending');
            card.innerHTML = `
                <div class="queue-card-header">
                    <h4 class="queue-card-title">${escapeHtml(group.title)}</h4>
                    <span class="status-badge ${info.class}">${info.text}</span>
                </div>
                <div class="queue-card-meta">${group.completed}/${group.total}개 처리 완료 · ${group.episodes.length}개 진행 중</div>
            `;
            card.addEventListener('click', () => showEpisodes(group));
            queueGroupsList.appendChild(card);
        });
    }

    function showEpisodes(group) {
        selectedGroup = group;
        hideQueueViews();
        queueEpisodesView.classList.remove('hidden');
        queueEpisodesTitle.textContent = group.title;
        renderEpisodes(group.episodes);
    }

    function createEpisodeCard(ep) {
        const info = getStatusInfo(ep.status);
        const card = document.createElement('div');
        card.className = 'queue-card queue-episode-card';
        card.dataset.jobId = ep.job_id;
        card.innerHTML = `
            <div class="queue-card-header">
                <h4 class="queue-card-title">${ep.episode_number}회 ${escapeHtml(ep.episode_title !== ep.episode_number + '회' ? ' · ' + ep.episode_title : '')}</h4>
                <div class="queue-card-actions">
                    <button type="button" class="btn btn-danger btn-xs queue-stop-btn" data-job-id="${ep.job_id}">중지</button>
                    <span class="status-badge ${info.class}">${info.text}</span>
                </div>
            </div>
            <div class="queue-card-message">${escapeHtml(ep.message || '')}</div>
            <div class="progress-bar">
                <div class="progress-fill" style="width:${ep.progress}%"></div>
            </div>
        `;
        card.addEventListener('click', () => showLog(ep));
        card.querySelector('.queue-stop-btn').addEventListener('click', e => {
            e.stopPropagation();
            stopJob(ep.job_id);
        });
        return card;
    }

    function renderEpisodes(episodes) {
        queueEpisodesList.innerHTML = '';
        if (episodes.length === 0) {
            queueEpisodesList.innerHTML = '<div class="queue-empty">처리 중인 에피소드가 없습니다.</div>';
            return;
        }
        episodes.forEach(ep => queueEpisodesList.appendChild(createEpisodeCard(ep)));
    }

    function updateEpisodeCards(episodes) {
        const existing = new Map();
        queueEpisodesList.querySelectorAll('.queue-episode-card').forEach(card => {
            existing.set(parseInt(card.dataset.jobId, 10), card);
        });

        if (episodes.length === 0 && existing.size === 0) {
            queueEpisodesList.innerHTML = '<div class="queue-empty">처리 중인 에피소드가 없습니다.</div>';
            return;
        }

        episodes.forEach(ep => {
            let card = existing.get(ep.job_id);
            if (!card) {
                card = createEpisodeCard(ep);
                queueEpisodesList.appendChild(card);
            } else {
                const info = getStatusInfo(ep.status);
                const badge = card.querySelector('.status-badge');
                badge.className = 'status-badge ' + info.class;
                badge.textContent = info.text;
                card.querySelector('.queue-card-message').textContent = ep.message || '';
                card.querySelector('.progress-fill').style.width = ep.progress + '%';
            }
            existing.delete(ep.job_id);
        });

        existing.forEach(card => card.remove());
    }

    async function stopJob(jobId) {
        if (!confirmDelete('이 작업을 중지하시겠습니까?')) return;
        try {
            const res = await fetch('/anime/api/stop_job.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'job_id=' + encodeURIComponent(jobId)
            });
            const data = await res.json();
            if (data.success) {
                loadQueue();
            } else {
                alert(data.message || '중지 실패');
            }
        } catch (err) {
            alert('오류: ' + err.message);
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function showLog(episode) {
        selectedEpisode = episode;
        hideQueueViews();
        queueLogView.classList.remove('hidden');
        queueLogTitle.textContent = selectedGroup.title + ' · ' + episode.episode_number + '회';
        queueLogBox.textContent = '';
        queueLogOffset = 0;
        updateLogProgress(episode.progress, episode.status, episode.message);

        clearInterval(queueLogInterval);
        clearInterval(queueEncodeInterval);
        clearInterval(queueProgressInterval);

        queueLogInterval = setInterval(() => fetchLog(episode.job_id), 2000);
        queueEncodeInterval = setInterval(() => fetchEncodeProgress(episode.job_id), 3000);
        queueProgressInterval = setInterval(() => fetchJobProgress(episode.job_id), 3000);

        fetchLog(episode.job_id);
        fetchEncodeProgress(episode.job_id);
    }

    function updateLogProgress(progress, status, message) {
        queueLogProgress.style.width = progress + '%';
        const info = getStatusInfo(status);
        queueLogStatus.innerHTML = `<span class="status-badge ${info.class}">${info.text}</span> ${escapeHtml(message || '')}`;
    }

    async function fetchLog(jobId) {
        try {
            const res = await fetch('/anime/api/log.php?job_id=' + jobId + '&offset=' + queueLogOffset);
            const data = await res.json();
            if (data.success && data.content) {
                queueLogBox.textContent += data.content;
                queueLogBox.scrollTop = queueLogBox.scrollHeight;
                queueLogOffset = data.offset;
            }
        } catch (err) {
            console.error(err);
        }
    }

    async function fetchEncodeProgress(jobId) {
        try {
            const res = await fetch('/anime/api/encode_progress.php?job_id=' + jobId);
            const data = await res.json();
            if (data.success) {
                queueLogEncodeProgress.style.width = data.encode_progress + '%';
            }
        } catch (err) {
            console.error(err);
        }
    }

    async function fetchJobProgress(jobId) {
        try {
            const res = await fetch('/anime/api/progress.php?job_id=' + jobId);
            const data = await res.json();
            if (data.success) {
                updateLogProgress(data.progress, data.status, data.message);
                if (data.status === 'completed' || data.status === 'failed') {
                    clearInterval(queueLogInterval);
                    clearInterval(queueEncodeInterval);
                    clearInterval(queueProgressInterval);
                }
            }
        } catch (err) {
            console.error(err);
        }
    }

    async function loadQueue() {
        try {
            const res = await fetch('/anime/api/queue.php');
            const data = await res.json();
            if (!data.success) return;
            queueGroups = data.groups || [];

            if (!queueEpisodesView.classList.contains('hidden')) {
                const group = queueGroups.find(g => g.anime_id === selectedGroup?.anime_id);
                if (group) {
                    selectedGroup = group;
                    updateEpisodeCards(group.episodes);
                } else {
                    backToGroups.click();
                }
            } else if (!queueLogView.classList.contains('hidden')) {
                // 로그 화면에서는 별도 폴리로 업데이트
            } else {
                renderGroups(queueGroups);
            }
        } catch (err) {
            console.error(err);
        }
    }

    window.openQueueModal = () => {
        openModal('queue-modal');
        loadQueue();
        if (!queuePollInterval) {
            queuePollInterval = setInterval(loadQueue, 3000);
        }
    };

    if (queueModal) {
        queueModal.addEventListener('modal-closed', () => {
            clearInterval(queuePollInterval);
            clearInterval(queueLogInterval);
            clearInterval(queueEncodeInterval);
            clearInterval(queueProgressInterval);
            queuePollInterval = null;
            hideQueueViews();
            queueGroupsView.classList.remove('hidden');
        });
    }

    if (backToGroups) {
        backToGroups.addEventListener('click', () => {
            hideQueueViews();
            queueGroupsView.classList.remove('hidden');
            selectedGroup = null;
        });
    }

    if (backToEpisodes) {
        backToEpisodes.addEventListener('click', () => {
            clearInterval(queueLogInterval);
            clearInterval(queueEncodeInterval);
            clearInterval(queueProgressInterval);
            hideQueueViews();
            queueEpisodesView.classList.remove('hidden');
            if (selectedGroup) renderEpisodes(selectedGroup.episodes);
        });
    }

    // Delete anime
    document.querySelectorAll('.delete-anime-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            if (!confirmDelete('이 애니와 모든 에피소드를 삭제하시겠습니까?')) return;
            const id = btn.dataset.id;
            try {
                const res = await fetch('/anime/api/delete_anime.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: 'id=' + encodeURIComponent(id)
                });
                const data = await res.json();
                if (data.success) {
                    btn.closest('.card').remove();
                } else {
                    alert(data.message || '삭제 실패');
                }
            } catch (err) {
                alert('오류: ' + err.message);
            }
        });
    });

    // Delete episode
    document.querySelectorAll('.delete-episode-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            if (!confirmDelete('이 에피소드를 삭제하시겠습니까?')) return;
            const id = btn.dataset.id;
            try {
                const res = await fetch('/anime/api/delete_episode.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: 'id=' + encodeURIComponent(id)
                });
                const data = await res.json();
                if (data.success) {
                    window.location.reload();
                } else {
                    alert(data.message || '삭제 실패');
                }
            } catch (err) {
                alert('오류: ' + err.message);
            }
        });
    });
});
