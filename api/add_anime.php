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

$stmt = $pdo->prepare("INSERT INTO animes (title, cover_image, description, season_id) VALUES (?, ?, ?, ?)");
$stmt->execute([$title, $filename, $description, $seasonId ?: null]);

jsonResponse(true, ['id' => $pdo->lastInsertId()], '애니가 추가되었습니다.');
