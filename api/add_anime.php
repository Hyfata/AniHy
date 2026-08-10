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

$broadcastYear = filter_input(INPUT_POST, 'broadcast_year', FILTER_VALIDATE_INT);
$broadcastYear = ($broadcastYear && $broadcastYear >= 1900 && $broadcastYear <= 2100) ? $broadcastYear : null;
$broadcastQuarter = filter_input(INPUT_POST, 'broadcast_quarter', FILTER_VALIDATE_INT);
$broadcastQuarter = in_array($broadcastQuarter, [1, 2, 3, 4], true) ? $broadcastQuarter : null;
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

$stmt = $pdo->prepare("INSERT INTO animes (title, cover_image, description, season_id, is_hidive, broadcast_year, broadcast_quarter, broadcast_day, download_url, namuwiki_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
$stmt->execute([$title, $filename, $description, $seasonId ?: null, $isHidive, $broadcastYear, $broadcastQuarter, $broadcastDay, $downloadUrl ?: null, $namuwikiUrl ?: null]);

jsonResponse(true, ['id' => $pdo->lastInsertId()], '애니가 추가되었습니다.');
