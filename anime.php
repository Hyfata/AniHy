<?php
require_once __DIR__ . '/inc/auth.php';
require_once __DIR__ . '/inc/access_auth.php';
require_once __DIR__ . '/inc/functions.php';
require_once __DIR__ . '/inc/chapters.php';

requireAccessAuth();

// 세션은 isAdmin() 읽기용으로만 쓰므로 잠금을 즉시 해제 (모달 iframe 등 동시 요청 블로킹 방지, $_SESSION 읽기는 유지됨)
session_write_close();

$aid = filter_input(INPUT_GET, 'aid', FILTER_VALIDATE_INT);
if (!$aid) {
    redirect('/anime/');
}
// 모달 iframe용 임베드 모드: 네브바 없이 본문만 렌더
$embed = ($_GET['embed'] ?? '') === '1';

$stmt = $pdo->prepare("SELECT * FROM animes WHERE id = ?");
$stmt->execute([$aid]);
$anime = $stmt->fetch();

if (!$anime) {
    redirect('/anime/');
}

$stmt = $pdo->prepare("SELECT broadcast_year, broadcast_quarter FROM anime_broadcasts WHERE anime_id = ? ORDER BY broadcast_year, broadcast_quarter");
$stmt->execute([$aid]);
$broadcastMap = [$aid => array_map(fn($r) => [(int)$r['broadcast_year'], (int)$r['broadcast_quarter']], $stmt->fetchAll())];

$stmt = $pdo->prepare("SELECT * FROM episodes WHERE anime_id = ? ORDER BY (episode_number LIKE 'S%') DESC, CASE WHEN episode_number LIKE 'S%' THEN CAST(SUBSTRING(episode_number, 2) AS DECIMAL(20,6)) ELSE NULL END ASC, CASE WHEN episode_number REGEXP '^[0-9]+(\\.[0-9]+)?$' THEN 0 ELSE 1 END ASC, CASE WHEN episode_number REGEXP '^[0-9]+(\\.[0-9]+)?$' THEN CAST(episode_number AS DECIMAL(20,6)) ELSE NULL END ASC, episode_number ASC");
$stmt->execute([$aid]);
$episodes = $stmt->fetchAll();

foreach ($episodes as &$ep) {
    $ep['has_file'] = !empty($ep['file_path']) && is_file(__DIR__ . '/' . $ep['file_path']) && filesize(__DIR__ . '/' . $ep['file_path']) > 0;
    $ep['file_size'] = $ep['has_file'] ? filesize(__DIR__ . '/' . $ep['file_path']) : 0;
    $safeEp = sanitizeFilename($ep['episode_number']);
    $thumbPath = episodeThumbPath($aid, $safeEp);
    $ep['thumb_url'] = is_file($thumbPath) ? episodeThumbUrl($aid, $safeEp) . '?v=' . filemtime($thumbPath) : coverUrl($anime['cover_image']);
}
unset($ep);
$downloadableCount = count(array_filter($episodes, fn($e) => $e['has_file']));
$totalDownloadSize = array_sum(array_map(fn($e) => $e['file_size'], $episodes));
?>
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title><?= htmlspecialchars($anime['title']) ?> - AniHy</title>
    <link rel="stylesheet" href="<?= assetUrl('css/style.css') ?>">
</head>
<body<?= $embed ? ' class="embed"' : '' ?>>
    <?php if (!$embed): ?>
    <nav class="navbar">
        <div class="container">
            <a href="/anime/" class="logo">AniHy</a>
            <div class="nav-links">
                <?php if (isAdmin()): ?>
                    <button class="btn btn-primary btn-sm" onclick="openModal('add-episode-modal')">에피소드 추가</button>
                    <button class="btn btn-primary btn-sm" onclick="openModal('bulk-add-modal')">일괄 추가</button>
                    <button class="btn btn-sm" onclick="openQueueModal()">대기열</button>
                <?php else: ?>
                    <a href="/anime/admin/login.php?redirect=<?= urlencode($_SERVER['REQUEST_URI'] ?? '/anime/') ?>">관리자 로그인</a>
                <?php endif; ?>
            </div>
        </div>
    </nav>
    <?php endif; ?>

    <main class="container anime-page<?= $embed ? ' embed-page' : '' ?>">
        <div class="anime-detail">
            <?php $hasDesc = trim($anime['description'] ?? '') !== ''; ?>
            <div class="poster-col">
                <div class="anime-poster">
                    <img src="<?= coverUrl($anime['cover_image']) ?>" alt="<?= htmlspecialchars($anime['title']) ?>">
                </div>
                <div class="poster-actions">
                    <?php if ($hasDesc): ?>
                        <button type="button" class="poster-action synopsis-action" onclick="openModal('synopsis-modal')">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>
                            <span>줄거리</span>
                        </button>
                    <?php endif; ?>
                    <?php if (!empty($anime['namuwiki_url'])): ?>
                        <a class="poster-action" href="<?= htmlspecialchars($anime['namuwiki_url']) ?>" target="_blank" rel="noopener noreferrer">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5a2 2 0 0 1 2-2h7v18H4a2 2 0 0 1-2-2z"/><path d="M22 5a2 2 0 0 0-2-2h-7v18h7a2 2 0 0 0 2-2z"/></svg>
                            <span>나무위키</span>
                        </a>
                    <?php endif; ?>
                    <?php if ($downloadableCount > 0): ?>
                        <button type="button" class="poster-action" id="download-all-btn" data-aid="<?= $aid ?>" data-anime="<?= htmlspecialchars($anime['title'], ENT_QUOTES) ?>" data-count="<?= $downloadableCount ?>" data-size="<?= htmlspecialchars(formatBytes($totalDownloadSize)) ?>">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m6 11 6 6 6-6"/><path d="M4 21h16"/></svg>
                            <span>전체 다운로드</span>
                        </button>
                    <?php endif; ?>
                </div>
            </div>
            <div class="anime-info" id="anime-info">
                <div class="anime-title-row">
                    <h1><?= htmlspecialchars($anime['title']) ?></h1>
                    <?php if (isAdmin()): ?>
                        <div class="anime-admin-actions">
                            <?php if (!empty($anime['download_url'])): ?>
                                <a class="admin-icon-btn" href="<?= htmlspecialchars($anime['download_url']) ?>" target="_blank" rel="noopener noreferrer" title="다운로드 주소 열기">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m6 11 6 6 6-6"/><path d="M4 21h16"/></svg>
                                </a>
                            <?php endif; ?>
                            <button type="button" class="admin-icon-btn edit-anime-btn"
                                    data-id="<?= $anime['id'] ?>"
                                    data-title="<?= htmlspecialchars($anime['title'], ENT_QUOTES) ?>"
                                    data-description="<?= htmlspecialchars($anime['description'] ?? '', ENT_QUOTES) ?>"
                                    data-season-id="<?= htmlspecialchars($anime['season_id'] ?? '', ENT_QUOTES) ?>"
                                    data-is-hidive="<?= !empty($anime['is_hidive']) ? '1' : '0' ?>"
                                    data-broadcasts="<?= htmlspecialchars(json_encode($broadcastMap[$aid] ?? []), ENT_QUOTES) ?>"
                                    data-day="<?= htmlspecialchars($anime['broadcast_day'] ?? '', ENT_QUOTES) ?>"
                                    data-download-url="<?= htmlspecialchars($anime['download_url'] ?? '', ENT_QUOTES) ?>"
                                    data-namuwiki-url="<?= htmlspecialchars($anime['namuwiki_url'] ?? '', ENT_QUOTES) ?>"
                                    data-cover="<?= coverUrl($anime['cover_image']) ?>"
                                    title="수정">✎</button>
                            <button type="button" class="admin-icon-btn admin-icon-danger delete-anime-btn" data-id="<?= $anime['id'] ?>" title="삭제">×</button>
                        </div>
                    <?php endif; ?>
                </div>
                <?php
                $badges = [];
                foreach ($broadcastMap[$aid] ?? [] as [$by, $bq]) {
                    $badges[] = $by . '년 ' . $bq . '분기';
                }
                if (!empty($anime['broadcast_day'])) {
                    $badges[] = $anime['broadcast_day'] . '요일';
                }
                ?>
                <?php if ($badges): ?>
                    <div class="anime-meta-row">
                        <?php foreach ($badges as $b): ?>
                            <span class="anime-badge"><?= htmlspecialchars($b) ?></span>
                        <?php endforeach; ?>
                    </div>
                <?php endif; ?>
            </div>
            <?php if ($hasDesc): ?>
                <div class="anime-desc-box">
                    <div class="anime-desc-wrap">
                        <p class="anime-desc" id="anime-desc"><?= nl2br(htmlspecialchars($anime['description'] ?? '')) ?></p>
                    </div>
                    <button type="button" class="btn btn-sm desc-more-btn hidden" id="desc-more-btn">더보기</button>
                </div>
            <?php endif; ?>
        </div>

        <div class="page-header">
            <h2 class="page-title">에피소드</h2>
            <div class="page-header-actions">
                <?php if (!empty($episodes)): ?>
                    <button type="button" id="episode-sort-btn" class="btn btn-sm">최신화부터</button>
                <?php endif; ?>
                <?php if ($embed && isAdmin()): ?>
                    <button class="btn btn-primary btn-sm" onclick="openModal('add-episode-modal')">에피소드 추가</button>
                    <button class="btn btn-primary btn-sm" onclick="openModal('bulk-add-modal')">일괄 추가</button>
                <?php endif; ?>
            </div>
        </div>

        <?php if (empty($episodes)): ?>
            <div class="empty-state">
                등록된 에피소드가 없습니다.
            </div>
        <?php else: ?>
            <div class="episode-list" id="episode-list">
                <?php foreach ($episodes as $ep): ?>
                    <?php
                    $watchUrl = '/anime/watch.php?aid=' . $aid . '&ep=' . rawurlencode($ep['episode_number']);
                    $watchOnclick = $embed
                        ? 'goWatchEmbed(' . $aid . ', ' . json_encode($ep['episode_number']) . ')'
                        : 'location.href=' . json_encode($watchUrl);
                    ?>
                    <div class="episode-item" data-aid="<?= $aid ?>" data-ep="<?= htmlspecialchars($ep['episode_number']) ?>" onclick="<?= htmlspecialchars($watchOnclick, ENT_QUOTES) ?>">
                        <div class="episode-thumb">
                            <img loading="lazy" src="<?= htmlspecialchars($ep['thumb_url']) ?>" alt="">
                            <span class="episode-thumb-badge"><?= htmlspecialchars($ep['episode_number']) ?></span>
                        </div>
                        <div class="episode-text">
                            <span class="episode-title"><?= htmlspecialchars($ep['title'] ?: ($ep['episode_number'] . '화')) ?></span>
                            <?php if (!empty($ep['duration_ms'])): ?>
                                <span class="episode-submeta"><?= formatPlaytime((int)$ep['duration_ms']) ?></span>
                            <?php endif; ?>
                        </div>
                        <div class="episode-actions">
                            <?php if ($ep['has_file']): ?>
                                <?php
                                $dlChaptersFile = __DIR__ . '/animes/' . $aid . '/' . $safeEp . '.chapters.vtt';
                                $dlHasChapters = is_file($dlChaptersFile) && filesize($dlChaptersFile) > 0;
                                ?>
                                <a class="episode-dl-btn" href="/anime/api/download_episode.php?aid=<?= $aid ?>&ep=<?= rawurlencode($ep['episode_number']) ?>" title="다운로드" data-aid="<?= $aid ?>" data-ep="<?= htmlspecialchars($ep['episode_number'], ENT_QUOTES) ?>" data-anime="<?= htmlspecialchars($anime['title'], ENT_QUOTES) ?>" data-title="<?= htmlspecialchars($ep['episode_number'] . '화' . (!empty($ep['title']) ? ': ' . $ep['title'] : ''), ENT_QUOTES) ?>" data-size="<?= htmlspecialchars(formatBytes($ep['file_size'])) ?>"<?= $dlHasChapters ? (' data-chapters="' . htmlspecialchars(chapterVttUrl($aid, $safeEp), ENT_QUOTES) . '"') : '' ?> onclick="event.stopPropagation()">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m6 11 6 6 6-6"/><path d="M4 21h16"/></svg>
                                </a>
                            <?php endif; ?>
                            <?php if (isAdmin()): ?>
                                <button class="btn btn-sm edit-episode-btn" data-id="<?= $ep['id'] ?>" data-title="<?= htmlspecialchars($ep['title'] ?? '') ?>" title="제목 수정">수정</button>
                                <button class="btn btn-danger btn-sm delete-episode-btn" data-id="<?= $ep['id'] ?>" title="삭제">삭제</button>
                            <?php endif; ?>
                        </div>
                        <div class="episode-progress-bar">
                            <div class="episode-progress-fill"></div>
                        </div>
                    </div>
                <?php endforeach; ?>
            </div>
        <?php endif; ?>
    </main>

    <?php if (isAdmin()): ?>
        <?php include __DIR__ . '/inc/queue_modal.php'; ?>
        <?php if (!$embed) include __DIR__ . '/inc/settings_float.php'; ?>
        <?php include __DIR__ . '/inc/edit_anime_modal.php'; ?>

        <div class="modal-overlay" id="edit-episode-modal">
            <div class="modal">
                <div class="modal-header">
                    <h2>에피소드 제목 수정</h2>
                    <button class="modal-close" onclick="closeModal('edit-episode-modal')">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="edit-episode-form">
                        <input type="hidden" id="edit_episode_id" name="id">
                        <div class="form-group">
                            <label for="edit_episode_title">에피소드 제목</label>
                            <input type="text" id="edit_episode_title" name="title" placeholder="비워두면 회차 번호로 표시됩니다">
                        </div>
                        <button type="submit" class="btn btn-primary" style="width:100%">저장</button>
                    </form>
                </div>
            </div>
        </div>

        <div class="modal-overlay" id="add-episode-modal" data-season-id="<?= htmlspecialchars($anime['season_id'] ?? '') ?>" data-is-hidive="<?= !empty($anime['is_hidive']) ? '1' : '0' ?>">
            <div class="modal">
                <div class="modal-header">
                    <h2>에피소드 추가</h2>
                    <button class="modal-close" onclick="closeModal('add-episode-modal')">&times;</button>
                </div>
                <div class="modal-body">
                    <div id="add-episode-form-view">
                        <form id="episode-form" enctype="multipart/form-data">
                            <input type="hidden" name="anime_id" value="<?= $aid ?>">

                            <div class="form-group">
                                <label for="episode_number">에피소드 번호</label>
                                <input type="text" id="episode_number" name="episode_number" placeholder="예: 1, 0, 0.5, OVA" required>
                            </div>

                            <div class="form-group">
                                <label for="episode_title">에피소드 제목 (선택)</label>
                                <input type="text" id="episode_title" name="episode_title">
                            </div>

                            <div class="form-group">
                                <label for="subtitle">자막 파일 (ass/smi, 선택)</label>
                                <input type="file" id="subtitle" name="subtitle" accept="*">
                            </div>

                            <div class="form-group">
                                <label for="source_video">원본 영상 파일 (mkv/mp4/mov/avi/webm, 선택)</label>
                                <input type="file" id="source_video" name="source_video" accept="video/*">
                            </div>

                            <div class="form-group">
                                <input type="hidden" id="server_video_path" name="server_video_path">
                                <button type="button" id="select-server-file-btn" class="btn btn-secondary" style="width:100%">서버 파일 선택</button>
                                <div id="server-file-list" class="server-file-list hidden"></div>
                                <div id="selected-server-file" class="selected-server-file hidden"></div>
                                <button type="button" id="extract-subtitle-btn" class="btn btn-secondary hidden" style="width:100%;margin-top:6px">자막 다운로드</button>
                                <button type="button" id="extract-audio-btn" class="btn btn-secondary hidden" style="width:100%;margin-top:6px">오디오 추출</button>
                            </div>

                            <div class="form-group trim-group">
                                <label class="checkbox-label">
                                    <input type="checkbox" id="trim_enabled" name="trim_enabled">
                                    앞부분 자르기
                                </label>
                                <input type="number" id="trim_seconds" name="trim_seconds" value="7.5" step="0.1" min="0" disabled>
                            </div>

                            <div class="form-group trim-group">
                                <label class="checkbox-label">
                                    <input type="checkbox" id="sync_enabled" name="sync_enabled">
                                    자막 싱크 조절 (초)
                                </label>
                                <input type="number" id="subtitle_offset" name="subtitle_offset" value="0" step="any" min="-86400" disabled>
                            </div>

                            <div class="form-group">
                                <label class="checkbox-label">
                                    <input type="checkbox" id="is_test" name="is_test">
                                    테스트 인코딩 (낮은 비트레이트·빠름, 자막 싱크 검증용)
                                </label>
                            </div>

                            <div class="form-group">
                                <button type="button" id="download-en-subtitle-btn" class="btn btn-secondary" style="width:100%">영어 자막 다운로드</button>
                            </div>

                            <div class="form-group">
                                <button type="button" id="lookup-episodes-btn" class="btn btn-secondary" style="width:100%">에피소드 조회</button>
                            </div>

                            <button type="submit" class="btn btn-primary" style="width:100%">다운로드 및 변환</button>

                            <div class="progress-box hidden" id="progress-box">
                                <div class="progress-bar">
                                    <div class="progress-fill" id="progress-fill"></div>
                                </div>
                                <div class="progress-text" id="progress-text">준비 중...</div>
                                <div class="log-box hidden" id="log-box"></div>
                            </div>
                        </form>
                    </div>

                    <div id="add-episode-lookup-view" class="hidden">
                        <div class="queue-back">
                            <button type="button" class="btn btn-sm" id="lookup-back-to-form">&larr; 뒤로가기</button>
                        </div>
                        <h3 class="queue-anime-title" id="lookup-title">에피소드 조회</h3>
                        <div class="log-box" id="lookup-log-box"></div>
                    </div>
                </div>
            </div>
        </div>
        <div class="modal-overlay" id="bulk-add-modal" data-anime-id="<?= $aid ?>">
            <div class="modal">
                <div class="modal-header">
                    <h2>에피소드 일괄 추가</h2>
                    <button class="modal-close" onclick="closeModal('bulk-add-modal')">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="queue-tabs">
                        <button type="button" class="queue-tab active" id="bulk-tab-stream">스트리밍</button>
                        <button type="button" class="queue-tab" id="bulk-tab-server">서버 파일</button>
                        <button type="button" class="queue-tab" id="bulk-tab-upload">업로드</button>
                    </div>

                    <div id="bulk-panel-stream">
                        <div class="form-group bulk-range-group">
                            <label>회차 범위</label>
                            <div class="bulk-range-inputs">
                                <input type="number" id="bulk_stream_start" min="0" step="1" value="1">
                                <span>~</span>
                                <input type="number" id="bulk_stream_end" min="0" step="1" value="12">
                            </div>
                        </div>
                    </div>

                    <div id="bulk-panel-server" class="hidden">
                        <div class="form-group">
                            <button type="button" id="bulk-server-load-btn" class="btn btn-secondary" style="width:100%">서버 파일 선택</button>
                        </div>
                        <div id="bulk-server-toolbar" class="bulk-server-toolbar hidden">
                            <button type="button" id="bulk-range-mode-btn" class="btn btn-sm">범위 선택</button>
                            <span id="bulk-server-count">0개 선택됨</span>
                        </div>
                        <div id="bulk-server-list" class="server-file-list hidden"></div>
                        <div class="form-group">
                            <label for="bulk_server_subtitles">자막 파일들 (ass/smi, 선택, 이름순으로 영상과 매핑)</label>
                            <input type="file" id="bulk_server_subtitles" accept="*" multiple>
                        </div>
                        <div id="bulk-server-sub-warning" class="bulk-warning hidden"></div>
                    </div>

                    <div id="bulk-panel-upload" class="hidden">
                        <div class="form-group">
                            <label for="bulk_videos">원본 영상 파일들 (이름순 정렬됨)</label>
                            <input type="file" id="bulk_videos" accept="video/*" multiple>
                        </div>
                        <div class="form-group">
                            <label for="bulk_subtitles">자막 파일들 (ass/smi, 선택, 이름순으로 영상과 매핑)</label>
                            <input type="file" id="bulk_subtitles" accept="*" multiple>
                        </div>
                        <div id="bulk-sub-warning" class="bulk-warning hidden"></div>
                    </div>

                    <div class="form-group" id="bulk-start-group">
                        <label for="bulk_start_number">시작 회차 번호</label>
                        <input type="number" id="bulk_start_number" min="0" step="1" value="1">
                    </div>

                    <div class="form-group trim-group">
                        <label class="checkbox-label">
                            <input type="checkbox" id="bulk_trim_enabled">
                            앞부분 자르기 (전체 적용)
                        </label>
                        <input type="number" id="bulk_trim_seconds" value="7.5" step="0.1" min="0" disabled>
                    </div>

                    <div class="form-group trim-group">
                        <label class="checkbox-label">
                            <input type="checkbox" id="bulk_sync_enabled">
                            자막 싱크 조절 (초, 전체 적용)
                        </label>
                        <input type="number" id="bulk_subtitle_offset" value="0" step="any" disabled>
                    </div>

                    <button type="button" id="bulk-preview-btn" class="btn btn-secondary" style="width:100%">매핑 확인</button>

                    <div id="bulk-mapping-view" class="hidden">
                        <div id="bulk-mapping-list" class="bulk-mapping-list"></div>
                        <button type="button" id="bulk-submit-btn" class="btn btn-primary" style="width:100%;margin-top:10px">추가</button>
                        <div class="progress-text hidden" id="bulk-progress-text"></div>
                    </div>
                </div>
            </div>
        </div>
        <div class="modal-overlay" id="bulk-info-modal">
            <div class="modal">
                <div class="modal-header">
                    <h2>파일 정보</h2>
                    <button class="modal-close" onclick="closeModal('bulk-info-modal')">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="bulk-info-row">
                        <div class="bulk-info-label">원본</div>
                        <div class="bulk-info-value" id="bulk-info-source"></div>
                    </div>
                    <div class="bulk-info-row">
                        <div class="bulk-info-label">자막</div>
                        <div class="bulk-info-value" id="bulk-info-sub"></div>
                    </div>
                </div>
            </div>
        </div>
    <?php endif; ?>

    <?php if ($hasDesc): ?>
        <div class="modal-overlay" id="synopsis-modal">
            <div class="modal">
                <div class="modal-header">
                    <h2>줄거리</h2>
                    <button class="modal-close" onclick="closeModal('synopsis-modal')">&times;</button>
                </div>
                <div class="modal-body">
                    <p class="synopsis-text"><?= nl2br(htmlspecialchars($anime['description'] ?? '')) ?></p>
                </div>
            </div>
        </div>
    <?php endif; ?>

    <?php include __DIR__ . '/inc/alert_modal.php'; ?>
    <script src="<?= assetUrl('js/app.js') ?>"></script>
    <script src="<?= assetUrl('js/native-bridge.js') ?>"></script>
    <script>
        document.addEventListener('DOMContentLoaded', () => {
            // 회차 정렬: 기본 내림차순(최신화부터), localStorage에 저장된 설정으로 항상 복원
            const list = document.getElementById('episode-list');
            const btn = document.getElementById('episode-sort-btn');
            if (!list || !btn) return;
            const KEY = 'anihy_ep_sort';
            const original = Array.from(list.children); // 서버 렌더(오름차순) 기준
            const apply = (order) => {
                const items = order === 'desc' ? [...original].reverse() : original;
                items.forEach(el => list.appendChild(el));
                btn.textContent = order === 'desc' ? '최신화부터' : '1화부터';
            };
            let order = localStorage.getItem(KEY) === 'asc' ? 'asc' : 'desc';
            apply(order);
            btn.addEventListener('click', () => {
                order = order === 'desc' ? 'asc' : 'desc';
                localStorage.setItem(KEY, order);
                apply(order);
            });
        });
    </script>
</body>
</html>
