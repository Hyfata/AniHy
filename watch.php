<?php
require_once __DIR__ . '/inc/auth.php';
require_once __DIR__ . '/inc/access_auth.php';
require_once __DIR__ . '/inc/functions.php';
require_once __DIR__ . '/inc/chapters.php';

requireAccessAuth();

// 세션은 isAdmin() 읽기용으로만 쓰므로 잠금을 즉시 해제 (모달 iframe 등 동시 요청 블로킹 방지, $_SESSION 읽기는 유지됨)
session_write_close();

$aid = filter_input(INPUT_GET, 'aid', FILTER_VALIDATE_INT);
$epNum = isset($_GET['ep']) ? trim((string)$_GET['ep']) : '';

if (!$aid || $epNum === '') {
    redirect('/anime/');
}

$stmt = $pdo->prepare("SELECT * FROM animes WHERE id = ?");
$stmt->execute([$aid]);
$anime = $stmt->fetch();

if (!$anime) {
    redirect('/anime/');
}

$stmt = $pdo->prepare("SELECT * FROM episodes WHERE anime_id = ? AND episode_number = ?");
$stmt->execute([$aid, $epNum]);
$currentEp = $stmt->fetch();

if (!$currentEp) {
    redirect('/anime/anime.php?aid=' . $aid);
}

$stmt = $pdo->prepare("SELECT * FROM episodes WHERE anime_id = ? ORDER BY (episode_number LIKE 'S%') DESC, CASE WHEN episode_number LIKE 'S%' THEN CAST(SUBSTRING(episode_number, 2) AS DECIMAL(20,6)) ELSE NULL END ASC, CASE WHEN episode_number REGEXP '^[0-9]+(\\.[0-9]+)?$' THEN 0 ELSE 1 END ASC, CASE WHEN episode_number REGEXP '^[0-9]+(\\.[0-9]+)?$' THEN CAST(episode_number AS DECIMAL(20,6)) ELSE NULL END ASC, episode_number ASC");
$stmt->execute([$aid]);
$episodes = $stmt->fetchAll();

foreach ($episodes as &$ep) {
    $safeEpName = sanitizeFilename($ep['episode_number']);
    $thumbPath = episodeThumbPath($aid, $safeEpName);
    $ep['thumb_url'] = is_file($thumbPath) ? episodeThumbUrl($aid, $safeEpName) . '?v=' . filemtime($thumbPath) : coverUrl($anime['cover_image']);
}
unset($ep);

$videoUrl = animeVideoUrl($aid, $epNum);
// Chrome/Firefox는 MP4 내장 챕터를 노출하지 않으므로 VTT 사이드카 사용 (Safari는 네이티브 폴백)
$safeEp = sanitizeFilename($epNum);
$chapterVttFile = __DIR__ . '/animes/' . $aid . '/' . $safeEp . '.chapters.vtt';
$hasChapterVtt = is_file($chapterVttFile) && filesize($chapterVttFile) > 0;
$enSubtitlePath = __DIR__ . '/subtitles/' . $aid . '/' . $safeEp . '_en.ass';
$hasEnSubtitle = file_exists($enSubtitlePath) && filesize($enSubtitlePath) > 0;

$nextEp = null;
foreach ($episodes as $idx => $ep) {
    if ($ep['episode_number'] === $epNum && isset($episodes[$idx + 1])) {
        $nextEp = $episodes[$idx + 1]['episode_number'];
        break;
    }
}

// 모달에서 넘어온 경우 복귀 URL (오픈 리다이렉트 방지: /anime 내부 + watch.php 제외)
$from = isset($_GET['from']) ? trim((string)$_GET['from']) : '';
$validFrom = ($from !== '' && str_starts_with($from, '/anime') && !str_starts_with($from, '//') && strpos($from, 'watch.php') === false) ? $from : '';
$backUrl = $validFrom !== '' ? $validFrom : '/anime/anime.php?aid=' . $aid;
$fromParam = $validFrom !== '' ? '&from=' . urlencode($validFrom) : '';
// 목록 스크롤 위치 전달 (?ly=, 복귀 링크 + 회차 이동 링크에 유지)
$ly = filter_input(INPUT_GET, 'ly', FILTER_VALIDATE_INT);
$lyParam = '';
if ($validFrom !== '' && is_int($ly) && $ly > 0) {
    $backUrl .= (strpos($backUrl, '?') === false ? '?' : '&') . 'ly=' . $ly;
    $lyParam = '&ly=' . $ly;
    $fromParam .= $lyParam;
}
// 회차 목록 HTML (사이드바/모바일 모달 공용)
function renderEpisodeList(array $episodes, string $epNum, int $aid, string $fromParam): string {
    ob_start();
    foreach ($episodes as $ep): ?>
        <div class="episode-item <?= $ep['episode_number'] === $epNum ? 'active' : '' ?>" data-aid="<?= $aid ?>" data-ep="<?= htmlspecialchars($ep['episode_number']) ?>"
             onclick="location.href='/anime/watch.php?aid=<?= $aid ?>&ep=<?= rawurlencode($ep['episode_number']) ?><?= $fromParam ?>'">
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
            <div class="episode-progress-bar">
                <div class="episode-progress-fill"></div>
            </div>
        </div>
    <?php endforeach;
    return ob_get_clean();
}
?>
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title><?= htmlspecialchars($anime['title']) ?> <?= htmlspecialchars($epNum) ?>화 - AniHy</title>
    <link rel="stylesheet" href="<?= assetUrl('player/video-player.css') ?>">
    <link rel="stylesheet" href="<?= assetUrl('css/style.css') ?>">
</head>
<body>
    <nav class="navbar">
        <div class="container">
            <a href="/anime/" class="logo">AniHy</a>
            <div class="nav-links">
                <?php if (isAdmin()): ?>
                    <button class="btn btn-sm" onclick="openQueueModal()">대기열</button>
                <?php else: ?>
                    <a href="/anime/admin/login.php?redirect=<?= urlencode($_SERVER['REQUEST_URI'] ?? '/anime/') ?>">관리자 로그인</a>
                <?php endif; ?>
            </div>
        </div>
    </nav>

    <main class="container">
        <div class="watch-layout">
            <div class="watch-main">
                <div class="player-wrapper" id="player-wrapper">
                    <div
                        id="anime-player"
                        data-aid="<?= $aid ?>"
                        data-ep="<?= htmlspecialchars($epNum) ?>"
                        data-from="<?= htmlspecialchars($validFrom) ?>"
                        data-ly="<?= $lyParam !== '' ? (int)$ly : '' ?>"
                        data-next-ep="<?= $nextEp !== null ? htmlspecialchars($nextEp) : '' ?>"></div>
                </div>

                <div class="watch-info">
                    <div class="watch-title-row">
                        <div>
                            <h1 class="watch-episode-title"><?= htmlspecialchars($epNum) ?>화 <?= htmlspecialchars($currentEp['title'] ? '| ' . $currentEp['title'] : '') ?></h1>
                            <a href="<?= htmlspecialchars($backUrl) ?>" class="watch-anime-title"><?= htmlspecialchars($anime['title']) ?></a>
                        </div>
                    </div>
                    <div class="watch-actions">
                        <button type="button" id="episode-list-open-btn" class="btn btn-sm btn-secondary">회차 목록</button>
                        <button type="button" id="auto-next-btn" class="btn btn-sm btn-secondary" style="visibility:hidden">자동 다음화: 켜짐</button>
                        <?php if ($hasEnSubtitle): ?>
                            <a href="/anime/subtitles/<?= $aid ?>/<?= rawurlencode($safeEp) ?>_en.ass" download class="btn btn-sm">영어 자막 다운로드</a>
                        <?php endif; ?>
                    </div>
                </div>
            </div>

            <aside class="sidebar">
                <h3>회차 목록</h3>
                <div class="episode-list" style="margin:0">
                    <?= renderEpisodeList($episodes, $epNum, $aid, $fromParam) ?>
                </div>
            </aside>
        </div>
    </main>

    <div class="modal-overlay" id="episode-list-modal">
        <div class="modal">
            <div class="modal-header">
                <h2>회차 목록</h2>
                <button class="modal-close" onclick="closeModal('episode-list-modal')">×</button>
            </div>
            <div class="modal-body">
                <div class="episode-list" style="margin:0">
                    <?= renderEpisodeList($episodes, $epNum, $aid, $fromParam) ?>
                </div>
            </div>
        </div>
    </div>

    <?php if (isAdmin()): ?>
        <?php include __DIR__ . '/inc/queue_modal.php'; ?>
        <?php include __DIR__ . '/inc/settings_float.php'; ?>
    <?php endif; ?>

    <script src="<?= assetUrl('player/video-player.js') ?>"></script>
    <script src="<?= assetUrl('js/fullscreen.js') ?>"></script>
    <?php include __DIR__ . '/inc/alert_modal.php'; ?>
    <script src="<?= assetUrl('js/app.js') ?>"></script>
    <script src="<?= assetUrl('js/native-bridge.js') ?>"></script>
    <script>
        document.addEventListener('DOMContentLoaded', () => {
            // README 빠른 시작: new VideoPlayer('#player', { src, chaptersUrl })
            // 오프닝/엔딩 스킵은 플레이어 내장(스킵 버튼 + 자동 스킵 설정) 사용
            window.animePlayer = new VideoPlayer('#anime-player', Object.assign({
                src: <?= json_encode($videoUrl, JSON_UNESCAPED_SLASHES) ?>,
                <?= $hasChapterVtt ? ("chaptersUrl: " . json_encode(chapterVttUrl($aid, $safeEp), JSON_UNESCAPED_SLASHES) . ",\n                ") : '' ?>lang: 'ko',
                preload: 'auto'
            }, window.AnihyVideoPlayerDefaults));
            if (typeof window.initWatchProgress === 'function') {
                window.initWatchProgress(window.animePlayer);
            }

            // 회차 목록: 현재 회차가 상단에 오도록 자동 스크롤 (PC 사이드바 + 모바일 모달)
            // offsetTop 기준으로 계산해 모달 팝인 애니메이션 중에도 위치가 정확함
            const scrollActiveEpToTop = (container) => {
                if (!container) return;
                const active = container.querySelector('.episode-item.active');
                if (!active) return;
                container.scrollTop = active.offsetTop - container.offsetTop - 8;
            };
            scrollActiveEpToTop(document.querySelector('.sidebar'));
            const epListBtn = document.getElementById('episode-list-open-btn');
            if (epListBtn) {
                epListBtn.addEventListener('click', () => {
                    if (window.animePlayer && typeof window.animePlayer.pause === 'function') {
                        window.animePlayer.pause();
                    }
                    openModal('episode-list-modal');
                    requestAnimationFrame(() => scrollActiveEpToTop(document.querySelector('#episode-list-modal .modal-body')));
                });
            }
        });
    </script>
</body>
</html>
