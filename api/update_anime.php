<?php
require_once __DIR__ . '/../inc/auth.php';
require_once __DIR__ . '/../inc/functions.php';

requireAdmin();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonResponse(false, [], '잘못된 요청입니다.');
}

$id = filter_input(INPUT_POST, 'id', FILTER_VALIDATE_INT);
$title = trim($_POST['title'] ?? '');
$description = trim($_POST['description'] ?? '');
$seasonId = trim($_POST['season_id'] ?? '');
$isHidive = filter_input(INPUT_POST, 'is_hidive', FILTER_VALIDATE_INT) ?: 0;
$isHidive = $isHidive ? 1 : 0;

if (!$id || $title === '') {
    jsonResponse(false, [], '필수 항목을 입력하세요.');
}

$stmt = $pdo->prepare("SELECT * FROM animes WHERE id = ?");
$stmt->execute([$id]);
$anime = $stmt->fetch();

if (!$anime) {
    jsonResponse(false, [], '애니를 찾을 수 없습니다.');
}

$coverImage = $anime['cover_image'];

// Handle new cover image
if (isset($_FILES['cover']) && $_FILES['cover']['error'] === UPLOAD_ERR_OK) {
    $ext = strtolower(pathinfo($_FILES['cover']['name'], PATHINFO_EXTENSION));
    if (!allowedImageExt($ext)) {
        jsonResponse(false, [], '지원하지 않는 이미지 형식입니다.');
    }

    $newFilename = uniqid('cover_') . '.' . $ext;
    $dest = __DIR__ . '/../covers/' . $newFilename;

    if (!move_uploaded_file($_FILES['cover']['tmp_name'], $dest)) {
        jsonResponse(false, [], '이미지 저장에 실패했습니다.');
    }

    // Delete old cover
    $oldCoverPath = __DIR__ . '/../covers/' . $coverImage;
    if (file_exists($oldCoverPath)) {
        unlink($oldCoverPath);
    }

    $coverImage = $newFilename;
}

$stmt = $pdo->prepare("UPDATE animes SET title = ?, cover_image = ?, description = ?, season_id = ?, is_hidive = ? WHERE id = ?");
$stmt->execute([$title, $coverImage, $description, $seasonId ?: null, $isHidive, $id]);

jsonResponse(true, ['id' => $id], '애니 정보가 수정되었습니다.');
