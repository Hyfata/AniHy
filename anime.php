<?php
require_once __DIR__ . '/inc/auth.php';
require_once __DIR__ . '/inc/access_auth.php';
require_once __DIR__ . '/inc/functions.php';

requireAccessAuth();

$aid = filter_input(INPUT_GET, 'aid', FILTER_VALIDATE_INT);
if (!$aid) {
    redirect('/anime/');
}

$stmt = $pdo->prepare("SELECT * FROM animes WHERE id = ?");
$stmt->execute([$aid]);
$anime = $stmt->fetch();

if (!$anime) {
    redirect('/anime/');
}

$stmt = $pdo->prepare("SELECT * FROM episodes WHERE anime_id = ? ORDER BY (episode_number LIKE 'S%') DESC, CASE WHEN episode_number LIKE 'S%' THEN CAST(SUBSTRING(episode_number, 2) AS DECIMAL(20,6)) ELSE NULL END ASC, CASE WHEN episode_number REGEXP '^[0-9]+(\\.[0-9]+)?$' THEN 0 ELSE 1 END ASC, CASE WHEN episode_number REGEXP '^[0-9]+(\\.[0-9]+)?$' THEN CAST(episode_number AS DECIMAL(20,6)) ELSE NULL END ASC, episode_number ASC");
$stmt->execute([$aid]);
$episodes = $stmt->fetchAll();
?>
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= htmlspecialchars($anime['title']) ?> - AniHy</title>
    <link rel="stylesheet" href="<?= assetUrl('css/style.css') ?>">
</head>
<body>
    <nav class="navbar">
        <div class="container">
            <a href="/anime/" class="logo">AniHy</a>
            <div class="nav-links">
                <?php if (isAdmin()): ?>
                    <button class="btn btn-primary btn-sm" onclick="openModal('add-episode-modal')">에피소드 추가</button>
                    <button class="btn btn-sm" onclick="openQueueModal()">대기열</button>
                <?php else: ?>
                    <a href="/anime/admin/login.php">관리자 로그인</a>
                <?php endif; ?>
            </div>
        </div>
    </nav>

    <main class="container anime-page">
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
                    <?php if (isAdmin() && !empty($anime['download_url'])): ?>
                        <a class="poster-action" href="<?= htmlspecialchars($anime['download_url']) ?>" target="_blank" rel="noopener noreferrer">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m6 11 6 6 6-6"/><path d="M4 21h16"/></svg>
                            <span>다운로드</span>
                        </a>
                    <?php endif; ?>
                </div>
            </div>
            <div class="anime-info" id="anime-info">
                <h1><?= htmlspecialchars($anime['title']) ?></h1>
                <?php
                $badges = [];
                if (!empty($anime['broadcast_year'])) {
                    $label = $anime['broadcast_year'] . '년';
                    if (!empty($anime['broadcast_quarter'])) $label .= ' ' . $anime['broadcast_quarter'] . '분기';
                    $badges[] = $label;
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
        </div>

        <?php if (empty($episodes)): ?>
            <div class="empty-state">
                등록된 에피소드가 없습니다.
            </div>
        <?php else: ?>
            <div class="episode-list">
                <?php foreach ($episodes as $ep): ?>
                    <div class="episode-item" data-aid="<?= $aid ?>" data-ep="<?= htmlspecialchars($ep['episode_number']) ?>" onclick="location.href='/anime/watch.php?aid=<?= $aid ?>&ep=<?= rawurlencode($ep['episode_number']) ?>'">
                        <div class="episode-meta">
                            <span class="episode-number"><?= htmlspecialchars($ep['episode_number']) ?></span>
                            <span class="episode-title"><?= htmlspecialchars($ep['title'] ?: ($ep['episode_number'] . '회')) ?></span>
                        </div>
                        <?php if (isAdmin()): ?>
                            <div class="episode-actions">
                                <button class="btn btn-sm edit-episode-btn" data-id="<?= $ep['id'] ?>" data-title="<?= htmlspecialchars($ep['title'] ?? '') ?>" title="제목 수정">수정</button>
                                <button class="btn btn-danger btn-sm delete-episode-btn" data-id="<?= $ep['id'] ?>" title="삭제">삭제</button>
                            </div>
                        <?php endif; ?>
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
        <?php include __DIR__ . '/inc/settings_float.php'; ?>

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
                            </div>

                            <div class="form-group trim-group">
                                <label class="checkbox-label">
                                    <input type="checkbox" id="trim_enabled" name="trim_enabled">
                                    앞부분 자르기
                                </label>
                                <input type="number" id="trim_seconds" name="trim_seconds" value="7.5" step="0.1" min="0" disabled>
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
</body>
</html>
