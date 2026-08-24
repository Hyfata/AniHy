<?php
require_once __DIR__ . '/../inc/auth.php';
require_once __DIR__ . '/../inc/functions.php';

requireAdmin();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonResponse(false, [], '잘못된 요청입니다.');
}

$title = trim($_POST['title'] ?? '');
$description = trim($_POST['description'] ?? '');
$seasonId = trim($_POST['season_id'] ?? '');
$isHidive = filter_input(INPUT_POST, 'is_hidive', FILTER_VALIDATE_INT) ?: 0;
$isHidive = $isHidive ? 1 : 0;

$broadcastPairs = parseBroadcastPairs(
    (array)($_POST['broadcast_year'] ?? []),
    (array)($_POST['broadcast_quarter'] ?? [])
);
$broadcastDay = trim($_POST['broadcast_day'] ?? '');
$broadcastDay = in_array($broadcastDay, ['월', '화', '수', '목', '금', '토', '일'], true) ? $broadcastDay : null;
$downloadUrl = trim($_POST['download_url'] ?? '');
$namuwikiUrl = trim($_POST['namuwiki_url'] ?? '');

if ($title === '') {
    jsonResponse(false, [], '제목을 입력하세요.');
}

if (!isset($_FILES['cover']) || $_FILES['cover']['error'] !== UPLOAD_ERR_OK) {
    jsonResponse(false, [], '커버 이미지를 업로드하세요.');
}

$ext = strtolower(pathinfo($_FILES['cover']['name'], PATHINFO_EXTENSION));
if (!allowedImageExt($ext)) {
    jsonResponse(false, [], '지원하지 않는 이미지 형식입니다.');
}

$filename = uniqid('cover_') . '.' . $ext;
$dest = __DIR__ . '/../covers/' . $filename;

if (!move_uploaded_file($_FILES['cover']['tmp_name'], $dest)) {
    jsonResponse(false, [], '이미지 저장에 실패했습니다.');
}

$firstPair = $broadcastPairs[0] ?? [null, null];
$stmt = $pdo->prepare("INSERT INTO animes (title, cover_image, description, season_id, is_hidive, broadcast_year, broadcast_quarter, broadcast_day, download_url, namuwiki_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
$stmt->execute([$title, $filename, $description, $seasonId ?: null, $isHidive, $firstPair[0], $firstPair[1], $broadcastDay, $downloadUrl ?: null, $namuwikiUrl ?: null]);

$animeId = (int)$pdo->lastInsertId();
saveBroadcastPairs($pdo, $animeId, $broadcastPairs);

jsonResponse(true, ['id' => $animeId], '애니가 추가되었습니다.');
