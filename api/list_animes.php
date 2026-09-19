<?php
require_once __DIR__ . '/../inc/auth.php';
require_once __DIR__ . '/../inc/access_auth.php';
require_once __DIR__ . '/../inc/functions.php';

requireAccessAuth();

// 읽기 전용이므로 세션 잠금 즉시 해제 (스크롤 폴링이 다른 요청을 막지 않도록)
session_write_close();

$offset = filter_input(INPUT_GET, 'offset', FILTER_VALIDATE_INT);
$limit = filter_input(INPUT_GET, 'limit', FILTER_VALIDATE_INT);
if ($offset === false || $offset === null || $offset < 0) {
    $offset = 0;
}
if ($limit === false || $limit === null || $limit < 1 || $limit > 60) {
    $limit = 30;
}

$isAdmin = isAdmin();

$stmt = $pdo->query("SELECT COUNT(*) AS cnt FROM animes");
$total = (int)$stmt->fetch()['cnt'];

// 다음 페이지 존재 여부는 LIMIT+1로 판별
$stmt = $pdo->query(
    "SELECT * FROM animes ORDER BY created_at DESC LIMIT " . ($limit + 1) . " OFFSET " . $offset
);
$rows = $stmt->fetchAll();
$hasMore = count($rows) > $limit;
$rows = array_slice($rows, 0, $limit);

$broadcastMap = $isAdmin ? fetchBroadcastMap($pdo) : [];

$items = [];
foreach ($rows as $a) {
    $id = (int)$a['id'];
    $item = [
        'id' => $id,
        'title' => $a['title'],
        'cover' => coverUrl($a['cover_image']),
        'href' => '/anime/anime.php?aid=' . $id,
    ];
    if ($isAdmin) {
        // 카드 수정 버튼 data-* 복원에 필요한 필드
        $item['description'] = $a['description'] ?? '';
        $item['season_id'] = $a['season_id'] ?? '';
        $item['is_hidive'] = !empty($a['is_hidive']) ? '1' : '0';
        $item['broadcasts'] = $broadcastMap[$id] ?? [];
        $item['broadcast_day'] = $a['broadcast_day'] ?? '';
        $item['download_url'] = $a['download_url'] ?? '';
        $item['namuwiki_url'] = $a['namuwiki_url'] ?? '';
    }
    $items[] = $item;
}

jsonResponse(true, [
    'animes' => $items,
    'has_more' => $hasMore,
    'total' => $total,
    'is_admin' => $isAdmin,
]);
