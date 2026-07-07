<?php
require_once __DIR__ . '/inc/auth.php';
require_once __DIR__ . '/inc/access_auth.php';
require_once __DIR__ . '/inc/functions.php';

requireAccessAuth();

$aid = filter_input(INPUT_GET, 'aid', FILTER_VALIDATE_INT);
$epNum = filter_input(INPUT_GET, 'ep', FILTER_VALIDATE_INT);

if (!$aid || !$epNum) {
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

$stmt = $pdo->prepare("SELECT * FROM episodes WHERE anime_id = ? ORDER BY episode_number ASC");
$stmt->execute([$aid]);
$episodes = $stmt->fetchAll();

$videoUrl = animeVideoUrl($aid, $epNum);
$enSubtitlePath = __DIR__ . '/subtitles/' . $aid . '/' . $epNum . '_en.ass';
$hasEnSubtitle = file_exists($enSubtitlePath) && filesize($enSubtitlePath) > 0;
?>
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= htmlspecialchars($anime['title']) ?> <?= $epNum ?>회 - AniHy</title>
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
                    <a href="/anime/admin/login.php">관리자 로그인</a>
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
                        playsinline>
                        <source src="<?= $videoUrl ?>" type="video/mp4">
                        <p class="vjs-no-js">
                            JavaScript를 활성화하거나 HTML5 video를 지원하는 브라우저를 사용하세요.
                        </p>
                    </video>
                </div>

                <div class="watch-info">
                    <div class="watch-title-row">
                        <div>
                            <h1 class="watch-episode-title"><?= $epNum ?>회 <?= htmlspecialchars($currentEp['title'] ? '| ' . $currentEp['title'] : '') ?></h1>
                            <a href="/anime/anime.php?aid=<?= $aid ?>" class="watch-anime-title"><?= htmlspecialchars($anime['title']) ?></a>
                        </div>
                    </div>
                    <?php if ($hasEnSubtitle): ?>
                        <div class="watch-actions">
                            <a href="/anime/subtitles/<?= $aid ?>/<?= $epNum ?>_en.ass" download class="btn btn-sm">영어 자막 다운로드</a>
                        </div>
                    <?php endif; ?>
                </div>
            </div>

            <aside class="sidebar">
                <h3>회차 목록</h3>
                <div class="episode-list" style="margin:0">
                    <?php foreach ($episodes as $ep): ?>
                        <div class="episode-item <?= $ep['episode_number'] == $epNum ? 'active' : '' ?>"
                             onclick="location.href='/anime/watch.php?aid=<?= $aid ?>&ep=<?= $ep['episode_number'] ?>'">
                            <div class="episode-meta">
                                <span class="episode-number"><?= $ep['episode_number'] ?></span>
                                <span class="episode-title"><?= htmlspecialchars($ep['title'] ?: ($ep['episode_number'] . '회')) ?></span>
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
    <script src="<?= assetUrl('js/app.js') ?>"></script>
    <script>
        document.addEventListener('DOMContentLoaded', () => {
            videojs('anime-player', {
                language: 'ko',
                fluid: true,
                responsive: true,
                playbackRates: [0.5, 1, 1.25, 1.5, 2],
                userActions: {
                    doubleClick: false
                }
            });
        });
    </script>
</body>
</html>
