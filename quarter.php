<?php
require_once __DIR__ . '/inc/auth.php';
require_once __DIR__ . '/inc/access_auth.php';
require_once __DIR__ . '/inc/functions.php';

requireAccessAuth();

$year = filter_input(INPUT_GET, 'year', FILTER_VALIDATE_INT);
$quarter = filter_input(INPUT_GET, 'quarter', FILTER_VALIDATE_INT);
if (!$year || !in_array($quarter, [1, 2, 3, 4], true)) {
    redirect('/anime/?tab=quarter');
}

$days = ['월', '화', '수', '목', '금', '토', '일'];
$dayFilter = $_GET['day'] ?? '';
if ($dayFilter !== '' && $dayFilter !== '기타' && !in_array($dayFilter, $days, true)) {
    $dayFilter = '';
}

$stmt = $pdo->prepare("SELECT DISTINCT a.* FROM animes a JOIN anime_broadcasts ab ON ab.anime_id = a.id WHERE ab.broadcast_year = ? AND ab.broadcast_quarter = ? ORDER BY a.title ASC");
$stmt->execute([$year, $quarter]);
$animes = $stmt->fetchAll();

$broadcastMap = fetchBroadcastMap($pdo);

// 요일별 그룹핑 (미설정은 '기타')
$byDay = [];
foreach ($animes as $a) {
    $d = $a['broadcast_day'] ?? '';
    if (!in_array($d, $days, true)) $d = '기타';
    if ($dayFilter !== '' && $d !== $dayFilter) continue;
    $byDay[$d][] = $a;
}

// 요일 순서(월~일, 기타)로 정렬
$dayOrder = array_merge($days, ['기타']);
uksort($byDay, fn($a, $b) => array_search($a, $dayOrder, true) <=> array_search($b, $dayOrder, true));

// 전체 탭에서 요일별 분류 여부 (기본: 꺼짐)
$groupByDay = $dayFilter === '' && ($_GET['group'] ?? '') === '1';

$filterTabs = array_merge(['전체'], $days, ['기타']);
?>
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= $year ?>년 <?= $quarter ?>분기 - AniHy</title>
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

    <main class="container quarter-page">
        <div class="page-header">
            <h1 class="page-title"><?= $year ?>년 <?= $quarter ?>분기</h1>
            <a href="/anime/?tab=quarter" class="btn btn-sm">&larr; 분기 목록</a>
        </div>

        <div class="day-filter-tabs">
            <?php foreach ($filterTabs as $d): ?>
                <?php $isActive = ($d === '전체' && $dayFilter === '') || $dayFilter === $d; ?>
                <a href="/anime/quarter.php?year=<?= $year ?>&quarter=<?= $quarter ?><?= $d === '전체' ? '' : '&day=' . rawurlencode($d) ?>"
                   class="day-tab <?= $isActive ? 'active' : '' ?>"><?= $d ?></a>
            <?php endforeach; ?>
        </div>

        <?php if ($dayFilter === ''): ?>
            <a class="group-toggle <?= $groupByDay ? 'on' : '' ?>"
               href="/anime/quarter.php?year=<?= $year ?>&quarter=<?= $quarter ?><?= $groupByDay ? '' : '&group=1' ?>">
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
                요일별 분류
            </a>
        <?php endif; ?>

        <?php if (empty($byDay)): ?>
            <div class="empty-state">
                해당하는 애니가 없습니다.
            </div>
        <?php elseif (!$groupByDay): ?>
            <div class="card-grid compact">
                <?php foreach ($animes as $anime): ?>
                    <?php if ($dayFilter !== ''): ?>
                        <?php
                        $ad = $anime['broadcast_day'] ?? '';
                        if (!in_array($ad, $days, true)) $ad = '기타';
                        if ($ad !== $dayFilter) continue;
                        ?>
                    <?php endif; ?>
                    <div class="card" data-href="/anime/anime.php?aid=<?= $anime['id'] ?>">
                        <?php if (isAdmin()): ?>
                            <div class="card-actions">
                                <button class="btn btn-sm card-edit edit-anime-btn"
                                        data-id="<?= $anime['id'] ?>"
                                        data-title="<?= htmlspecialchars($anime['title'], ENT_QUOTES) ?>"
                                        data-description="<?= htmlspecialchars($anime['description'] ?? '', ENT_QUOTES) ?>"
                                        data-season-id="<?= htmlspecialchars($anime['season_id'] ?? '', ENT_QUOTES) ?>"
                                        data-is-hidive="<?= !empty($anime['is_hidive']) ? '1' : '0' ?>"
                                        data-broadcasts="<?= htmlspecialchars(json_encode($broadcastMap[(int)$anime['id']] ?? []), ENT_QUOTES) ?>"
                                        data-day="<?= htmlspecialchars($anime['broadcast_day'] ?? '', ENT_QUOTES) ?>"
                                        data-download-url="<?= htmlspecialchars($anime['download_url'] ?? '', ENT_QUOTES) ?>"
                                        data-namuwiki-url="<?= htmlspecialchars($anime['namuwiki_url'] ?? '', ENT_QUOTES) ?>"
                                        data-cover="<?= coverUrl($anime['cover_image']) ?>"
                                        title="수정">✎</button>
                                <button class="btn btn-danger btn-sm delete-anime-btn" data-id="<?= $anime['id'] ?>" title="삭제">×</button>
                            </div>
                        <?php endif; ?>
                        <div class="card-poster">
                            <img src="<?= coverUrl($anime['cover_image']) ?>" alt="<?= htmlspecialchars($anime['title']) ?>" loading="lazy">
                        </div>
                        <div class="card-body">
                            <h3 class="card-title"><?= htmlspecialchars($anime['title']) ?></h3>
                        </div>
                    </div>
                <?php endforeach; ?>
            </div>
        <?php else: ?>
            <?php foreach ($byDay as $day => $list): ?>
                <div class="day-section">
                    <h2 class="day-section-title"><?= htmlspecialchars($day === '기타' ? '기타' : $day . '요일') ?></h2>
                    <div class="card-grid compact">
                        <?php foreach ($list as $anime): ?>
                            <div class="card" data-href="/anime/anime.php?aid=<?= $anime['id'] ?>">
                                <?php if (isAdmin()): ?>
                                    <div class="card-actions">
                                        <button class="btn btn-sm card-edit edit-anime-btn"
                                                data-id="<?= $anime['id'] ?>"
                                                data-title="<?= htmlspecialchars($anime['title'], ENT_QUOTES) ?>"
                                                data-description="<?= htmlspecialchars($anime['description'] ?? '', ENT_QUOTES) ?>"
                                                data-season-id="<?= htmlspecialchars($anime['season_id'] ?? '', ENT_QUOTES) ?>"
                                                data-is-hidive="<?= !empty($anime['is_hidive']) ? '1' : '0' ?>"
                                                data-broadcasts="<?= htmlspecialchars(json_encode($broadcastMap[(int)$anime['id']] ?? []), ENT_QUOTES) ?>"
                                                data-day="<?= htmlspecialchars($anime['broadcast_day'] ?? '', ENT_QUOTES) ?>"
                                                data-download-url="<?= htmlspecialchars($anime['download_url'] ?? '', ENT_QUOTES) ?>"
                                                data-namuwiki-url="<?= htmlspecialchars($anime['namuwiki_url'] ?? '', ENT_QUOTES) ?>"
                                                data-cover="<?= coverUrl($anime['cover_image']) ?>"
                                                title="수정">✎</button>
                                        <button class="btn btn-danger btn-sm delete-anime-btn" data-id="<?= $anime['id'] ?>" title="삭제">×</button>
                                    </div>
                                <?php endif; ?>
                                <div class="card-poster">
                                    <img src="<?= coverUrl($anime['cover_image']) ?>" alt="<?= htmlspecialchars($anime['title']) ?>" loading="lazy">
                                </div>
                                <div class="card-body">
                                    <h3 class="card-title"><?= htmlspecialchars($anime['title']) ?></h3>
                                </div>
                            </div>
                        <?php endforeach; ?>
                    </div>
                </div>
            <?php endforeach; ?>
        <?php endif; ?>
    </main>

    <?php if (isAdmin()): ?>
        <?php include __DIR__ . '/inc/queue_modal.php'; ?>
        <?php include __DIR__ . '/inc/settings_float.php'; ?>
        <?php include __DIR__ . '/inc/edit_anime_modal.php'; ?>
    <?php endif; ?>

    <?php include __DIR__ . '/inc/alert_modal.php'; ?>
    <script src="<?= assetUrl('js/app.js') ?>"></script>
</body>
</html>
