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

$videoUrl = animeVideoUrl($aid, $epNum);
// Chrome/Firefox는 MP4 내장 챕터를 노출하지 않으므로 VTT 사이드카 사용 (Safari는 네이티브 폴백)
$safeEp = sanitizeFilename($epNum);
$chapterVttFile = __DIR__ . '/animes/' . $aid . '/' . $safeEp . '.chapters.vtt';
$hasChapterVtt = is_file($chapterVttFile) && filesize($chapterVttFile) > 0;
$enSubtitlePath = __DIR__ . '/subtitles/' . $aid . '/' . $epNum . '_en.ass';
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
?>
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= htmlspecialchars($anime['title']) ?> <?= htmlspecialchars($epNum) ?>화 - AniHy</title>
    <link href="https://vjs.zencdn.net/8.10.0/video-js.css?v=2" rel="stylesheet">
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
                    <video
                        id="anime-player"
                        class="video-js vjs-theme-anime vjs-big-play-centered"
                        controls
                        preload="auto"
                        playsinline
                        data-aid="<?= $aid ?>"
                        data-ep="<?= htmlspecialchars($epNum) ?>"
                        data-from="<?= htmlspecialchars($validFrom) ?>"
                        data-ly="<?= $lyParam !== '' ? (int)$ly : '' ?>"
                        data-next-ep="<?= $nextEp !== null ? htmlspecialchars($nextEp) : '' ?>">
                        <source src="<?= $videoUrl ?>" type="video/mp4">
                        <?php if ($hasChapterVtt): ?>
                            <track kind="chapters" src="<?= htmlspecialchars(chapterVttUrl($aid, $safeEp)) ?>" srclang="ko" label="챕터" default>
                        <?php endif; ?>
                        <p class="vjs-no-js">
                            JavaScript를 활성화하거나 HTML5 video를 지원하는 브라우저를 사용하세요.
                        </p>
                    </video>
                </div>

                <div class="watch-info">
                    <div class="watch-title-row">
                        <div>
                            <h1 class="watch-episode-title"><?= htmlspecialchars($epNum) ?>화 <?= htmlspecialchars($currentEp['title'] ? '| ' . $currentEp['title'] : '') ?></h1>
                            <a href="<?= htmlspecialchars($backUrl) ?>" class="watch-anime-title"><?= htmlspecialchars($anime['title']) ?></a>
                        </div>
                    </div>
                    <div class="watch-actions">
                        <button type="button" id="skip-intro-ending-btn" class="btn btn-sm btn-secondary">오프닝/엔딩 스킵: 꺼짐</button>
                        <?php if ($hasEnSubtitle): ?>
                            <a href="/anime/subtitles/<?= $aid ?>/<?= rawurlencode($epNum) ?>_en.ass" download class="btn btn-sm">영어 자막 다운로드</a>
                        <?php endif; ?>
                    </div>
                </div>
            </div>

            <aside class="sidebar">
                <h3>회차 목록</h3>
                <div class="episode-list" style="margin:0">
                    <?php foreach ($episodes as $ep): ?>
                        <div class="episode-item <?= $ep['episode_number'] === $epNum ? 'active' : '' ?>"
                             onclick="location.href='/anime/watch.php?aid=<?= $aid ?>&ep=<?= rawurlencode($ep['episode_number']) ?><?= $fromParam ?>'">
                            <div class="episode-meta">
                                <span class="episode-number"><?= htmlspecialchars($ep['episode_number']) ?></span>
                                <span class="episode-title"><?= htmlspecialchars($ep['title'] ?: ($ep['episode_number'] . '화')) ?></span>
                            </div>
                        </div>
                    <?php endforeach; ?>
                </div>
            </aside>
        </div>
    </main>

    <?php if (isAdmin()): ?>
        <?php include __DIR__ . '/inc/queue_modal.php'; ?>
        <?php include __DIR__ . '/inc/settings_float.php'; ?>
    <?php endif; ?>

    <script src="https://vjs.zencdn.net/8.10.0/video.min.js?v=2"></script>
    <script src="<?= assetUrl('js/videojs-ko.js') ?>"></script>
    <?php include __DIR__ . '/inc/alert_modal.php'; ?>
    <script src="<?= assetUrl('js/app.js') ?>"></script>
    <script>
        document.addEventListener('DOMContentLoaded', () => {
            window.animePlayer = videojs('anime-player', {
                language: 'ko',
                fluid: true,
                responsive: true,
                playbackRates: [0.5, 1, 1.25, 1.5, 2],
                userActions: {
                    doubleClick: false
                }
            });
            if (typeof window.initWatchProgress === 'function') {
                window.initWatchProgress(window.animePlayer);
            }
        });
    </script>
</body>
</html>
