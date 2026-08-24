document.addEventListener('DOMContentLoaded', () => {
    // Modal helpers
    window.openModal = (id) => {
        const el = document.getElementById(id);
        el.classList.remove('closing');
        el.classList.add('active');
    };

    window.closeModal = (id) => {
        const el = document.getElementById(id);
        if (!el || el.classList.contains('closing') || !el.classList.contains('active')) return;
        el.classList.add('closing');
        el.classList.remove('active');
        setTimeout(() => {
            el.classList.remove('closing');
            el.dispatchEvent(new CustomEvent('modal-closed', { bubbles: false }));
        }, 180);
    };

    // System alert/confirm modal (always on top of other modals)
    const alertModalOverlay = document.getElementById('alert-modal-overlay');
    const alertModalTitle = document.getElementById('alert-modal-title');
    const alertModalMessage = document.getElementById('alert-modal-message');
    const alertModalOk = document.getElementById('alert-modal-ok');
    const alertModalCancel = document.getElementById('alert-modal-cancel');

    function openAlertModal(title, message, showCancel) {
        if (alertModalTitle) alertModalTitle.textContent = title;
        if (alertModalMessage) alertModalMessage.textContent = message;
        if (alertModalCancel) alertModalCancel.classList.toggle('hidden', !showCancel);
        if (alertModalOverlay) {
            alertModalOverlay.classList.remove('closing');
            alertModalOverlay.classList.add('active');
        }
    }

    function closeAlertModal() {
        if (!alertModalOverlay || alertModalOverlay.classList.contains('closing')) return;
        alertModalOverlay.classList.add('closing');
        alertModalOverlay.classList.remove('active');
        setTimeout(() => alertModalOverlay.classList.remove('closing'), 180);
    }

    window.modalAlert = (message) => {
        return new Promise((resolve) => {
            openAlertModal('알림', message, false);
            const okHandler = () => {
                closeAlertModal();
                cleanup();
                resolve();
            };
            const cancelHandler = () => {
                closeAlertModal();
                cleanup();
                resolve();
            };
            function cleanup() {
                alertModalOk.removeEventListener('click', okHandler);
                alertModalCancel.removeEventListener('click', cancelHandler);
            }
            alertModalOk.addEventListener('click', okHandler);
            alertModalCancel.addEventListener('click', cancelHandler);
        });
    };

    window.modalConfirm = (message) => {
        return new Promise((resolve) => {
            openAlertModal('확인', message, true);
            const okHandler = () => {
                closeAlertModal();
                cleanup();
                resolve(true);
            };
            const cancelHandler = () => {
                closeAlertModal();
                cleanup();
                resolve(false);
            };
            function cleanup() {
                alertModalOk.removeEventListener('click', okHandler);
                alertModalCancel.removeEventListener('click', cancelHandler);
            }
            alertModalOk.addEventListener('click', okHandler);
            alertModalCancel.addEventListener('click', cancelHandler);
        });
    };

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', e => {
            if (e.target === overlay) closeModal(overlay.id);
        });
    });

    // Home card click: 다른 카드가 사라지는 전환 애니메이션 후 이동
    document.querySelectorAll('.card-grid .card[data-href]').forEach(card => {
        card.addEventListener('click', () => {
            const grid = card.closest('.card-grid');
            if (!grid || grid.classList.contains('leaving')) return;
            grid.classList.add('leaving');
            card.classList.add('card-leave-target');
            setTimeout(() => {
                window.location.href = card.dataset.href;
            }, 320);
        });
    });

    // Generic confirm delete
    window.confirmDelete = (message) => modalConfirm(message || '정말 삭제하시겠습니까?');

    // Anime description more/less toggle
    const animeInfo = document.getElementById('anime-info');
    const animeDesc = document.getElementById('anime-desc');
    const descMoreBtn = document.getElementById('desc-more-btn');
    if (animeInfo && animeDesc && descMoreBtn) {
        const updateDescMoreVisibility = () => {
            const overflowing = animeDesc.scrollHeight > animeDesc.clientHeight;
            descMoreBtn.classList.toggle('hidden', !overflowing && !animeInfo.classList.contains('expanded'));
        };
        updateDescMoreVisibility();
        window.addEventListener('resize', updateDescMoreVisibility);
        let descAnimating = false;
        descMoreBtn.addEventListener('click', () => {
            const descWrap = animeDesc.closest('.anime-desc-wrap');
            const collapsing = animeInfo.classList.contains('expanded');
            if (descAnimating) return;

            const doToggle = () => {
                if (!descWrap) {
                    animeInfo.classList.toggle('expanded');
                    descMoreBtn.textContent = animeInfo.classList.contains('expanded') ? '접기' : '더보기';
                    return;
                }
                descAnimating = true;
                // 이전 상태의 인라인 높이가 남아있을 수 있으므로 초기화 후 측정
                descWrap.style.height = '';
                const willExpand = !animeInfo.classList.contains('expanded');
                const startH = descWrap.offsetHeight;
                animeInfo.classList.toggle('expanded', willExpand);
                const endH = descWrap.offsetHeight;
                if (!willExpand) {
                    // 접힘: 애니메이션이 끝날 때까지 전체 텍스트를 유지하고 높이만 줄임
                    animeInfo.classList.add('expanded');
                }
                descWrap.style.height = startH + 'px';
                requestAnimationFrame(() => {
                    descWrap.style.height = endH + 'px';
                });
                // transitionend 미발생(높이 동일, 중단 등)에 대비해 타이머로 정리
                setTimeout(() => {
                    if (!willExpand) animeInfo.classList.remove('expanded');
                    descWrap.style.height = '';
                    descAnimating = false;
                }, 350);
                descMoreBtn.textContent = willExpand ? '접기' : '더보기';
            };

            // 접을 때 설명 영역이 화면 위로 벗어나 있으면, 먼저 부드럽게 스크롤한 뒤 접기
            // (동시에 진행하면 문서 높이 감소로 브라우저가 스크롤을 즉시 클램프해 점프가 발생)
            if (collapsing) {
                const top = animeInfo.getBoundingClientRect().top;
                const navOffset = 80;
                if (top < navOffset) {
                    const target = Math.max(0, window.scrollY + top - navOffset);
                    descAnimating = true; // 스크롤 중 재클릭 방지
                    const startedAt = Date.now();
                    let lastY = -1;
                    const waitSettle = () => {
                        const y = window.scrollY;
                        const settled = Math.abs(y - target) <= 2 || (y === lastY && Date.now() - startedAt > 400);
                        if (settled || Date.now() - startedAt > 2500) {
                            descAnimating = false;
                            doToggle();
                        } else {
                            lastY = y;
                            setTimeout(waitSettle, 100);
                        }
                    };
                    window.scrollTo({ top: target, behavior: 'smooth' });
                    setTimeout(waitSettle, 100);
                    return;
                }
            }
            doToggle();
        });
    }

    // Broadcast (year/quarter) repeatable rows
    function createBroadcastRow(year = '', quarter = '') {
        const row = document.createElement('div');
        row.className = 'broadcast-row';
        row.innerHTML = `
            <input type="number" name="broadcast_year[]" min="1900" max="2100" placeholder="년도" value="${year}">
            <select name="broadcast_quarter[]">
                <option value="">분기</option>
                <option value="1">1분기</option>
                <option value="2">2분기</option>
                <option value="3">3분기</option>
                <option value="4">4분기</option>
            </select>
            <button type="button" class="btn btn-danger btn-sm broadcast-remove-btn" title="삭제">×</button>
        `;
        if (quarter !== '') row.querySelector('select').value = String(quarter);
        row.querySelector('.broadcast-remove-btn').addEventListener('click', () => row.remove());
        return row;
    }

    function setBroadcastRows(listId, pairs) {
        const list = document.getElementById(listId);
        if (!list) return;
        list.innerHTML = '';
        (pairs && pairs.length ? pairs : [['', '']]).forEach(([y, q]) => {
            list.appendChild(createBroadcastRow(y, q));
        });
    }

    document.querySelectorAll('.add-broadcast-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const list = document.getElementById(btn.dataset.target);
            if (list) list.appendChild(createBroadcastRow());
        });
    });

    setBroadcastRows('broadcast-list', null);

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
                    await modalAlert(data.message || '애니 추가에 실패했습니다.');
                }
            } catch (err) {
                await modalAlert('오류: ' + err.message);
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
                document.getElementById('edit-is-hidive').value = btn.dataset.isHidive === '1' ? '1' : '0';
                let broadcasts = [];
                try { broadcasts = JSON.parse(btn.dataset.broadcasts || '[]'); } catch (err) { broadcasts = []; }
                setBroadcastRows('edit-broadcast-list', broadcasts);
                document.getElementById('edit-broadcast-day').value = btn.dataset.day || '';
                document.getElementById('edit-download-url').value = btn.dataset.downloadUrl || '';
                document.getElementById('edit-namuwiki-url').value = btn.dataset.namuwikiUrl || '';
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
                    await modalAlert(data.message || '애니 수정에 실패했습니다.');
                }
            } catch (err) {
                await modalAlert('오류: ' + err.message);
            }
        });
    }

    // Season search helpers
    function setupSearch(btnId, inputId, resultId, serviceSelectId) {
        const searchBtn = document.getElementById(btnId);
        const searchInput = document.getElementById(inputId);
        const searchResult = document.getElementById(resultId);
        const serviceSelect = serviceSelectId ? document.getElementById(serviceSelectId) : null;

        if (searchBtn && searchInput && searchResult) {
            searchBtn.addEventListener('click', async () => {
                const keyword = searchInput.value.trim();
                if (!keyword) return;
                const service = serviceSelect ? (serviceSelect.value === '1' ? 'hidive' : 'crunchy') : 'crunchy';
                searchResult.textContent = '검색 중...';
                try {
                    const res = await fetch('/anime/api/search.php?keyword=' + encodeURIComponent(keyword) + '&service=' + encodeURIComponent(service));
                    const text = await res.text();
                    searchResult.textContent = text;
                } catch (err) {
                    searchResult.textContent = '검색 오류: ' + err.message;
                }
            });
        }
    }

    setupSearch('search-btn', 'search-keyword', 'search-result', 'is_hidive');
    setupSearch('edit-search-btn', 'edit-search-keyword', 'edit-search-result', 'edit-is-hidive');

    // English subtitle download button
    const downloadEnBtn = document.getElementById('download-en-subtitle-btn');
    if (downloadEnBtn) {
        downloadEnBtn.addEventListener('click', async () => {
            const animeId = document.querySelector('input[name="anime_id"]')?.value;
            const episodeNumber = document.getElementById('episode_number')?.value;
            if (!animeId || !episodeNumber) {
                await modalAlert('에피소드 번호를 입력하세요.');
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
                await modalAlert('오류: ' + err.message);
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

    const trimEnabled = document.getElementById('trim_enabled');
    const trimSeconds = document.getElementById('trim_seconds');

    if (trimEnabled && trimSeconds) {
        trimEnabled.addEventListener('change', () => {
            if (trimEnabled.checked) {
                trimSeconds.value = '7.8';
                trimSeconds.disabled = false;
            } else {
                trimSeconds.disabled = true;
            }
        });
    }

    const syncEnabled = document.getElementById('sync_enabled');
    const subtitleOffset = document.getElementById('subtitle_offset');

    if (syncEnabled && subtitleOffset) {
        syncEnabled.addEventListener('change', () => {
            subtitleOffset.disabled = !syncEnabled.checked;
        });
    }

    const sourceVideoInput = document.getElementById('source_video');
    const serverVideoPathInput = document.getElementById('server_video_path');
    const selectServerFileBtn = document.getElementById('select-server-file-btn');
    const serverFileList = document.getElementById('server-file-list');
    const selectedServerFile = document.getElementById('selected-server-file');
    const extractSubtitleBtn = document.getElementById('extract-subtitle-btn');
    const extractAudioBtn = document.getElementById('extract-audio-btn');
    const episodeSubmitBtn = episodeForm ? episodeForm.querySelector('button[type="submit"]') : null;
    const episodeSubmitDefaultText = episodeSubmitBtn ? episodeSubmitBtn.textContent : '다운로드 및 변환';

    function setLocalSourceMode(isUpload, isServerFile) {
        const isLocal = isUpload || isServerFile;
        if (downloadEnBtn) downloadEnBtn.classList.toggle('hidden', isLocal);
        if (lookupBtn) lookupBtn.classList.toggle('hidden', isLocal);
        if (extractSubtitleBtn) extractSubtitleBtn.classList.toggle('hidden', !isServerFile);
        if (extractAudioBtn) extractAudioBtn.classList.toggle('hidden', !isServerFile);
        if (episodeSubmitBtn) {
            if (isUpload) {
                episodeSubmitBtn.textContent = '업로드 및 변환';
            } else if (isServerFile) {
                episodeSubmitBtn.textContent = '서버 파일 변환';
            } else {
                episodeSubmitBtn.textContent = episodeSubmitDefaultText;
            }
        }
    }

    function clearServerFileSelection() {
        if (serverVideoPathInput) serverVideoPathInput.value = '';
        if (selectedServerFile) {
            selectedServerFile.classList.add('hidden');
            selectedServerFile.innerHTML = '';
        }
    }

    function renderServerFileList(files) {
        if (!serverFileList) return;
        serverFileList.innerHTML = '';
        if (files.length === 0) {
            serverFileList.textContent = '사용 가능한 서버 파일이 없습니다.';
            return;
        }
        files.forEach(file => {
            const item = document.createElement('div');
            item.className = 'server-file-item';
            item.innerHTML = `<div class="server-file-name">${escapeHtml(file.name)}</div><div class="server-file-dir">${escapeHtml(file.relative_dir)}</div>`;
            item.addEventListener('click', () => {
                if (serverVideoPathInput) serverVideoPathInput.value = file.path;
                if (sourceVideoInput) sourceVideoInput.value = '';
                setLocalSourceMode(false, true);
                if (serverFileList) serverFileList.classList.add('hidden');
                if (selectedServerFile) {
                    selectedServerFile.classList.remove('hidden');
                    selectedServerFile.innerHTML = '선택됨: <strong>' + escapeHtml(file.name) + '</strong> <button type="button" class="btn btn-danger btn-xs" id="clear-server-file-btn">취소</button>';
                    const clearBtn = document.getElementById('clear-server-file-btn');
                    if (clearBtn) {
                        clearBtn.addEventListener('click', () => {
                            clearServerFileSelection();
                            setLocalSourceMode(false, false);
                        });
                    }
                }
            });
            serverFileList.appendChild(item);
        });
    }

    if (selectServerFileBtn) {
        selectServerFileBtn.addEventListener('click', async () => {
            if (!serverFileList) return;
            const isHidden = serverFileList.classList.contains('hidden');
            if (!isHidden) {
                serverFileList.classList.add('hidden');
                return;
            }
            serverFileList.classList.remove('hidden');
            serverFileList.textContent = '불러오는 중...';
            try {
                const res = await fetch('/anime/api/list_server_files.php');
                const data = await res.json();
                if (!data.success) {
                    throw new Error(data.message || '목록을 불러올 수 없습니다.');
                }
                renderServerFileList(data.files || []);
            } catch (err) {
                serverFileList.textContent = '오류: ' + err.message;
            }
        });
    }

    if (extractSubtitleBtn) {
        extractSubtitleBtn.addEventListener('click', async () => {
            const videoPath = serverVideoPathInput ? serverVideoPathInput.value : '';
            if (!videoPath) {
                await modalAlert('서버 파일을 먼저 선택하세요.');
                return;
            }
            extractSubtitleBtn.disabled = true;
            const originalText = extractSubtitleBtn.textContent;
            extractSubtitleBtn.textContent = '자막 추출 중...';
            try {
                const res = await fetch('/anime/api/extract_subtitle.php?path=' + encodeURIComponent(videoPath));
                const contentType = res.headers.get('Content-Type') || '';
                if (!res.ok || contentType.includes('application/json')) {
                    const data = await res.json().catch(() => null);
                    throw new Error((data && data.message) || '자막 추출에 실패했습니다.');
                }
                const blob = await res.blob();
                const disposition = res.headers.get('Content-Disposition') || '';
                const match = disposition.match(/filename="?([^";]+)"?/);
                const filename = match ? match[1] : 'subtitle.ass';
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
            } catch (err) {
                await modalAlert('오류: ' + err.message);
            } finally {
                extractSubtitleBtn.disabled = false;
                extractSubtitleBtn.textContent = originalText;
            }
        });
    }

    if (extractAudioBtn) {
        extractAudioBtn.addEventListener('click', async () => {
            const videoPath = serverVideoPathInput ? serverVideoPathInput.value : '';
            if (!videoPath) {
                await modalAlert('서버 파일을 먼저 선택하세요.');
                return;
            }
            extractAudioBtn.disabled = true;
            const originalText = extractAudioBtn.textContent;
            extractAudioBtn.textContent = '오디오 추출 중...';
            try {
                const res = await fetch('/anime/api/extract_audio.php?path=' + encodeURIComponent(videoPath));
                const contentType = res.headers.get('Content-Type') || '';
                if (!res.ok || contentType.includes('application/json')) {
                    const data = await res.json().catch(() => null);
                    throw new Error((data && data.message) || '오디오 추출에 실패했습니다.');
                }
                const blob = await res.blob();
                const disposition = res.headers.get('Content-Disposition') || '';
                const match = disposition.match(/filename="?([^";]+)"?/);
                const filename = match ? match[1] : 'audio.mka';
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
            } catch (err) {
                await modalAlert('오류: ' + err.message);
            } finally {
                extractAudioBtn.disabled = false;
                extractAudioBtn.textContent = originalText;
            }
        });
    }

    if (sourceVideoInput) {
        sourceVideoInput.addEventListener('change', () => {
            const hasFile = sourceVideoInput.files && sourceVideoInput.files.length > 0;
            if (hasFile) {
                clearServerFileSelection();
            }
            setLocalSourceMode(hasFile, false);
        });
    }

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
                    if (trimEnabled) trimEnabled.checked = false;
                    if (trimSeconds) trimSeconds.disabled = true;
                    clearServerFileSelection();
                    setLocalSourceMode(false, false);
                    await modalAlert(data.message || '대기열에 추가되었습니다.');
                } else {
                    await modalAlert(data.message || '추가 실패');
                }
            } catch (err) {
                await modalAlert('오류: ' + err.message);
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
            }
        });
    }

    // Episode lookup
    const addEpisodeModal = document.getElementById('add-episode-modal');
    const lookupBtn = document.getElementById('lookup-episodes-btn');
    const formView = document.getElementById('add-episode-form-view');
    const lookupView = document.getElementById('add-episode-lookup-view');
    const lookupBackBtn = document.getElementById('lookup-back-to-form');
    const lookupLogBox = document.getElementById('lookup-log-box');
    const lookupTitle = document.getElementById('lookup-title');
    let lookupEventSource = null;

    function showLookupView() {
        if (formView) formView.classList.add('hidden');
        if (lookupView) lookupView.classList.remove('hidden');
    }

    function hideLookupView() {
        if (lookupView) lookupView.classList.add('hidden');
        if (formView) formView.classList.remove('hidden');
    }

    function stopLookup() {
        if (lookupEventSource) {
            lookupEventSource.close();
            lookupEventSource = null;
        }
    }

    function startLookup(seasonId, isHidive) {
        stopLookup();
        if (lookupLogBox) {
            lookupLogBox.textContent = '에피소드 목록을 조회하는 중...\n';
        }
        if (lookupTitle) lookupTitle.textContent = '에피소드 조회';

        const service = isHidive ? 'hidive' : 'crunchy';
        const url = '/anime/api/episode_lookup_stream.php?season_id=' + encodeURIComponent(seasonId) + '&service=' + encodeURIComponent(service);
        lookupEventSource = new EventSource(url);

        lookupEventSource.onopen = () => {
            if (lookupLogBox) {
                lookupLogBox.textContent += '서버에 연결되었습니다.\n';
                lookupLogBox.scrollTop = lookupLogBox.scrollHeight;
            }
        };

        lookupEventSource.onmessage = (e) => {
            if (lookupLogBox) {
                lookupLogBox.textContent += e.data + '\n';
                lookupLogBox.scrollTop = lookupLogBox.scrollHeight;
            }
        };

        lookupEventSource.addEventListener('done', () => {
            if (lookupLogBox) {
                lookupLogBox.textContent += '\n조회가 완료되었습니다.\n';
                lookupLogBox.scrollTop = lookupLogBox.scrollHeight;
            }
            stopLookup();
        });

        lookupEventSource.onerror = () => {
            if (lookupLogBox) {
                lookupLogBox.textContent += '\n연결 중 오류가 발생했습니다. 관리자 권한이 있는지 확인하세요.\n';
                lookupLogBox.scrollTop = lookupLogBox.scrollHeight;
            }
            stopLookup();
        };
    }

    if (lookupBtn && addEpisodeModal) {
        lookupBtn.addEventListener('click', async () => {
            const seasonId = (addEpisodeModal.dataset.seasonId || '').trim();
            const isHidive = addEpisodeModal.dataset.isHidive === '1';
            if (!seasonId) {
                await modalAlert('애니에 등록된 시즌 ID가 없습니다.');
                return;
            }
            showLookupView();
            startLookup(seasonId, isHidive);
        });
    }

    if (lookupBackBtn) {
        lookupBackBtn.addEventListener('click', () => {
            stopLookup();
            hideLookupView();
        });
    }

    if (addEpisodeModal) {
        addEpisodeModal.addEventListener('modal-closed', () => {
            stopLookup();
            hideLookupView();
            if (sourceVideoInput) sourceVideoInput.value = '';
            clearServerFileSelection();
            if (serverFileList) serverFileList.classList.add('hidden');
            setLocalSourceMode(false, false);
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
    const queueTabActive = document.getElementById('queue-tab-active');
    const queueTabCompleted = document.getElementById('queue-tab-completed');
    const queueActivePanel = document.getElementById('queue-active-panel');
    const queueCompletedPanel = document.getElementById('queue-completed-panel');
    const queueCompletedList = document.getElementById('queue-completed-list');
    const queueCompletedEmpty = document.getElementById('queue-completed-empty');

    let queueGroups = [];
    let queueCompleted = [];
    let lastGroupsJson = '';
    let lastCompletedJson = '';
    let selectedGroup = null;
    let selectedEpisode = null;
    let logFromCompleted = false;
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

    function switchQueueTab(tab) {
        const isActive = tab === 'active';
        queueTabActive.classList.toggle('active', isActive);
        queueTabCompleted.classList.toggle('active', !isActive);
        queueActivePanel.classList.toggle('hidden', !isActive);
        queueCompletedPanel.classList.toggle('hidden', isActive);
    }

    if (queueTabActive && queueTabCompleted) {
        queueTabActive.addEventListener('click', () => switchQueueTab('active'));
        queueTabCompleted.addEventListener('click', () => switchQueueTab('completed'));
    }

    function renderCompleted(jobs) {
        queueCompletedList.innerHTML = '';
        if (jobs.length === 0) {
            queueCompletedEmpty.classList.remove('hidden');
            return;
        }
        queueCompletedEmpty.classList.add('hidden');

        jobs.forEach(job => {
            const info = getStatusInfo(job.status);
            const card = document.createElement('div');
            card.className = 'queue-card queue-completed-card';
            card.innerHTML = `
                <div class="queue-card-header">
                    <h4 class="queue-card-title">${escapeHtml(job.anime_title)} · ${job.episode_number}회</h4>
                    <span class="status-badge ${info.class}">${info.text}</span>
                </div>
                <div class="queue-card-meta">${escapeHtml(job.updated_at || '')}</div>
                <div class="queue-card-message">${escapeHtml(job.message || '')}</div>
            `;
            card.addEventListener('click', () => showLog(job, job.anime_title, true));
            queueCompletedList.appendChild(card);
        });
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
        if (!(await confirmDelete('이 작업을 중지하시겠습니까?'))) return;
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
                await modalAlert(data.message || '중지 실패');
            }
        } catch (err) {
            await modalAlert('오류: ' + err.message);
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function showLog(episode, title = null, fromCompleted = false) {
        selectedEpisode = episode;
        logFromCompleted = fromCompleted;
        hideQueueViews();
        queueLogView.classList.remove('hidden');
        queueLogTitle.textContent = (title || selectedGroup?.title || '') + ' · ' + episode.episode_number + '회';
        queueLogBox.textContent = '';
        queueLogOffset = 0;
        updateLogProgress(episode.progress, episode.status, episode.message);

        clearInterval(queueLogInterval);
        clearInterval(queueEncodeInterval);
        clearInterval(queueProgressInterval);

        const done = episode.status === 'completed' || episode.status === 'failed';
        if (!done) {
            queueLogInterval = setInterval(() => fetchLog(episode.job_id), 2000);
            queueEncodeInterval = setInterval(() => fetchEncodeProgress(episode.job_id), 3000);
            queueProgressInterval = setInterval(() => fetchJobProgress(episode.job_id), 3000);
        }

        fetchLog(episode.job_id);
        if (!done) {
            fetchEncodeProgress(episode.job_id);
        } else {
            queueLogEncodeProgress.style.width = (episode.status === 'completed' ? 100 : 0) + '%';
        }
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
            queueCompleted = data.completed || [];

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
                // 데이터가 바뀐 경우에만 다시 렌더링(진입 애니메이션 재생 방지)
                const groupsJson = JSON.stringify(queueGroups);
                const completedJson = JSON.stringify(queueCompleted);
                if (groupsJson !== lastGroupsJson) {
                    lastGroupsJson = groupsJson;
                    renderGroups(queueGroups);
                }
                if (completedJson !== lastCompletedJson) {
                    lastCompletedJson = completedJson;
                    renderCompleted(queueCompleted);
                }
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
            switchQueueTab('active');
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
            if (logFromCompleted) {
                queueGroupsView.classList.remove('hidden');
                switchQueueTab('completed');
                renderCompleted(queueCompleted);
            } else {
                queueEpisodesView.classList.remove('hidden');
                if (selectedGroup) renderEpisodes(selectedGroup.episodes);
            }
        });
    }

    // Delete anime
    document.querySelectorAll('.delete-anime-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            if (!(await confirmDelete('이 애니와 모든 에피소드를 삭제하시겠습니까?'))) return;
            const id = btn.dataset.id;
            try {
                const res = await fetch('/anime/api/delete_anime.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: 'id=' + encodeURIComponent(id)
                });
                const data = await res.json();
                if (data.success) {
                    const card = btn.closest('.card');
                    if (card) {
                        card.remove();
                    } else {
                        window.location.href = '/anime/';
                    }
                } else {
                    await modalAlert(data.message || '삭제 실패');
                }
            } catch (err) {
                await modalAlert('오류: ' + err.message);
            }
        });
    });

    // Delete episode
    document.querySelectorAll('.delete-episode-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            if (!(await confirmDelete('이 에피소드를 삭제하시겠습니까?'))) return;
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
                    await modalAlert(data.message || '삭제 실패');
                }
            } catch (err) {
                await modalAlert('오류: ' + err.message);
            }
        });
    });

    // Edit episode title
    const editEpisodeForm = document.getElementById('edit-episode-form');
    document.querySelectorAll('.edit-episode-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            document.getElementById('edit_episode_id').value = btn.dataset.id;
            document.getElementById('edit_episode_title').value = btn.dataset.title || '';
            openModal('edit-episode-modal');
        });
    });

    if (editEpisodeForm) {
        editEpisodeForm.addEventListener('submit', async e => {
            e.preventDefault();
            const id = document.getElementById('edit_episode_id').value;
            const title = document.getElementById('edit_episode_title').value;
            try {
                const res = await fetch('/anime/api/update_episode.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: 'id=' + encodeURIComponent(id) + '&title=' + encodeURIComponent(title)
                });
                const data = await res.json();
                if (data.success) {
                    window.location.reload();
                } else {
                    await modalAlert(data.message || '수정 실패');
                }
            } catch (err) {
                await modalAlert('오류: ' + err.message);
            }
        });
    }

    // Download all episodes as ZIP with ring progress
    const downloadAllBtn = document.getElementById('download-all-btn');
    if (downloadAllBtn) {
        const zipAid = downloadAllBtn.dataset.aid;
        const iconEl = () => downloadAllBtn.querySelector('svg');
        const labelEl = downloadAllBtn.querySelector('span');
        const origIcon = iconEl().outerHTML;
        const origLabel = labelEl.textContent;
        const RING_LEN = 56.55;
        let zipPollTimer = null;

        const showZipProgress = pct => {
            const offset = (RING_LEN * (1 - Math.min(100, Math.max(0, pct)) / 100)).toFixed(2);
            iconEl().outerHTML =
                '<svg viewBox="0 0 24 24" class="zip-ring">' +
                '<circle class="zip-ring-bg" cx="12" cy="12" r="9"/>' +
                '<circle class="zip-ring-fg" cx="12" cy="12" r="9" style="stroke-dashoffset:' + offset + '"/>' +
                '</svg>';
            labelEl.textContent = Math.round(pct) + '%';
        };

        const resetZipButton = () => {
            iconEl().outerHTML = origIcon;
            labelEl.textContent = origLabel;
            downloadAllBtn.disabled = false;
        };

        const stopZipPolling = () => {
            if (zipPollTimer) {
                clearInterval(zipPollTimer);
                zipPollTimer = null;
            }
        };

        const pollZipProgress = async () => {
            try {
                const res = await fetch('/anime/api/download_all.php?aid=' + encodeURIComponent(zipAid) + '&progress=1');
                const data = await res.json();
                const job = data.job || {};
                if (job.status === 'done') {
                    stopZipPolling();
                    showZipProgress(100);
                    window.location.href = '/anime/api/download_all.php?aid=' + encodeURIComponent(zipAid) + '&file=1';
                    setTimeout(resetZipButton, 1500);
                } else if (job.status === 'failed') {
                    stopZipPolling();
                    resetZipButton();
                    await modalAlert(job.message || '압축에 실패했습니다.');
                } else {
                    showZipProgress(parseFloat(job.percent) || 0);
                }
            } catch (err) {
                // 일시적 네트워크 오류는 다음 폴에서 재시도
            }
        };

        downloadAllBtn.addEventListener('click', async () => {
            if (zipPollTimer) return;
            downloadAllBtn.disabled = true;
            showZipProgress(0);
            try {
                const res = await fetch('/anime/api/download_all.php?aid=' + encodeURIComponent(zipAid), { method: 'POST' });
                const data = await res.json();
                if (!data.success) {
                    resetZipButton();
                    await modalAlert(data.message || '압축을 시작할 수 없습니다.');
                    return;
                }
                zipPollTimer = setInterval(pollZipProgress, 1000);
                pollZipProgress();
            } catch (err) {
                resetZipButton();
                await modalAlert('오류: ' + err.message);
            }
        });
    }

    // Watch progress helpers
    function getWatchKey(aid, epNum) {
        return 'anime_' + aid + '_' + epNum;
    }

    function loadWatchProgress(aid, epNum) {
        try {
            const raw = localStorage.getItem(getWatchKey(aid, epNum));
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (data && typeof data.currentTime === 'number') {
                return data;
            }
        } catch (e) {
            console.error('loadWatchProgress error', e);
        }
        return null;
    }

    function saveWatchProgress(aid, epNum, currentTime, duration) {
        try {
            const data = {
                currentTime: parseFloat(currentTime) || 0,
                duration: parseFloat(duration) || 0,
                updatedAt: Date.now()
            };
            localStorage.setItem(getWatchKey(aid, epNum), JSON.stringify(data));
        } catch (e) {
            console.error('saveWatchProgress error', e);
        }
    }

    function getProgressPercent(currentTime, duration) {
        if (!duration || duration <= 0) return 0;
        const pct = (currentTime / duration) * 100;
        return Math.min(100, Math.max(0, pct));
    }

    // Render watch progress bars on anime.php episode list
    function renderEpisodeProgressBars() {
        document.querySelectorAll('.episode-item[data-aid][data-ep]').forEach(item => {
            const aid = item.dataset.aid;
            const epNum = item.dataset.ep;
            const fill = item.querySelector('.episode-progress-fill');
            if (!aid || !epNum || !fill) return;

            const progress = loadWatchProgress(aid, epNum);
            if (progress && progress.duration > 0) {
                fill.style.width = getProgressPercent(progress.currentTime, progress.duration) + '%';
            } else {
                fill.style.width = '0%';
            }
        });
    }

    renderEpisodeProgressBars();

    // Save watch progress on watch.php
    window.initWatchProgress = function(player) {
        const playerEl = document.getElementById('anime-player');
        if (!playerEl || typeof videojs === 'undefined') return;

        const aid = playerEl.dataset.aid;
        const epNum = playerEl.dataset.ep;
        if (!aid || !epNum) return;

        if (!player) player = videojs.getPlayer('anime-player');
        if (!player) return;

        let isSeeking = false;
        let lastSavedTime = 0;
        let lastSaveAt = 0;

        const saved = loadWatchProgress(aid, epNum);
        if (saved && saved.currentTime > 0 && saved.duration > 0) {
            const progressRatio = saved.currentTime / saved.duration;
            if (progressRatio < 0.95) {
                player.one('loadedmetadata', () => {
                    isSeeking = true;
                    player.currentTime(saved.currentTime);
                });
            }
        }

        player.on('seeking', () => {
            isSeeking = true;
        });

        player.on('seeked', () => {
            isSeeking = false;
        });

        player.on('timeupdate', () => {
            if (isSeeking) return;
            const currentTime = player.currentTime();
            const duration = player.duration();
            const now = Date.now();
            if (Math.abs(currentTime - lastSavedTime) >= 5 || now - lastSaveAt >= 5000) {
                saveWatchProgress(aid, epNum, currentTime, duration);
                lastSavedTime = currentTime;
                lastSaveAt = now;
            }
        });

        player.on('ended', () => {
            const duration = player.duration();
            saveWatchProgress(aid, epNum, duration, duration);

            const nextEp = playerEl.dataset.nextEp;
            if (nextEp) {
                window.location.href = '/anime/watch.php?aid=' + encodeURIComponent(aid) + '&ep=' + encodeURIComponent(nextEp);
            }
        });

        initChapterSkip(player);
    };

    function initChapterSkip(player) {
        if (!player || typeof videojs === 'undefined') return;

        const skipBtn = document.getElementById('skip-intro-ending-btn');
        if (!skipBtn) return;

        const STORAGE_KEY = 'anihy_skip_intro_ending';
        let autoSkipEnabled = false;
        try {
            autoSkipEnabled = localStorage.getItem(STORAGE_KEY) === '1';
        } catch (e) {
            // localStorage unavailable
        }

        const skippedCueStarts = new Set();
        let chaptersTrack = null;

        function normalizeChapterTitle(text) {
            return (text || '').toLowerCase().trim();
        }

        function isIntroCue(title) {
            return title === 'intro' || title === 'opening';
        }

        function isCreditsCue(title) {
            return title === 'credits' || title === 'ending';
        }

        function isEpisodeCue(title) {
            return title === 'episode';
        }

        function getChaptersTrack() {
            const tracks = player.textTracks ? player.textTracks() : [];
            for (let i = 0; i < tracks.length; i++) {
                if (tracks[i].kind === 'chapters') return tracks[i];
            }
            return null;
        }

        function waitForChaptersTrack(callback) {
            const track = getChaptersTrack();
            if (track) {
                callback(track);
                return;
            }
            const tracks = player.textTracks();
            function onAddTrack() {
                const t = getChaptersTrack();
                if (t) {
                    tracks.removeEventListener('addtrack', onAddTrack);
                    callback(t);
                }
            }
            tracks.addEventListener('addtrack', onAddTrack);
        }

        function waitForCues(track, callback) {
            if (track.cues && track.cues.length > 0) {
                callback(track);
                return;
            }
            track.mode = 'hidden';
            function onLoad() {
                track.removeEventListener('load', onLoad);
                callback(track);
            }
            track.addEventListener('load', onLoad);
        }

        function updateButton() {
            skipBtn.textContent = autoSkipEnabled
                ? '오프닝/엔딩 스킵: 켜짐'
                : '오프닝/엔딩 스킵: 꺼짐';
            skipBtn.classList.toggle('active', autoSkipEnabled);
        }

        skipBtn.addEventListener('click', () => {
            autoSkipEnabled = !autoSkipEnabled;
            updateButton();
            try {
                localStorage.setItem(STORAGE_KEY, autoSkipEnabled ? '1' : '0');
            } catch (e) {
                // ignore
            }
        });

        updateButton();

        waitForChaptersTrack((track) => {
            chaptersTrack = track;
            waitForCues(track, () => {
                // 챕터 데이터 준비 완료; 별도 UI 변화 없음
            });
        });

        player.on('timeupdate', () => {
            if (!autoSkipEnabled || !chaptersTrack || !chaptersTrack.cues) return;

            const activeCues = chaptersTrack.activeCues;
            const cue = activeCues && activeCues.length > 0 ? activeCues[0] : null;
            if (!cue || !cue.text) return;

            const title = normalizeChapterTitle(cue.text);
            const isIntro = isIntroCue(title);
            const isCredits = isCreditsCue(title);
            if (!isIntro && !isCredits) return;

            if (skippedCueStarts.has(cue.startTime)) return;

            let targetTime = null;
            const cues = chaptersTrack.cues;
            for (let i = 0; i < cues.length; i++) {
                const other = cues[i];
                if (other.startTime > cue.startTime && isEpisodeCue(normalizeChapterTitle(other.text))) {
                    targetTime = other.startTime;
                    break;
                }
            }

            if (targetTime !== null) {
                player.currentTime(targetTime);
            } else if (isCredits) {
                const duration = player.duration();
                if (duration && isFinite(duration)) {
                    player.currentTime(duration);
                }
            }

            skippedCueStarts.add(cue.startTime);
        });
    }
});
