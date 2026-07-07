document.addEventListener('DOMContentLoaded', () => {
    // Modal helpers
    window.openModal = (id) => {
        document.getElementById(id).classList.add('active');
    };

    window.closeModal = (id) => {
        document.getElementById(id).classList.remove('active');
    };

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', e => {
            if (e.target === overlay) overlay.classList.remove('active');
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
            submitBtn.disabled = true;
            progressBox.classList.remove('hidden');
            if (logBox) logBox.classList.remove('hidden');
            progressText.textContent = '작업을 시작합니다...';
            if (logBox) logBox.textContent = '';

            try {
                const res = await fetch('/anime/api/add_episode.php', { method: 'POST', body: formData });
                const data = await res.json();
                if (data.success && data.job_id) {
                    pollProgress(data.job_id, data.anime_id);
                    pollLog(data.job_id);
                } else {
                    progressText.textContent = data.message || '실패';
                    submitBtn.disabled = false;
                }
            } catch (err) {
                progressText.textContent = '오류: ' + err.message;
                submitBtn.disabled = false;
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
