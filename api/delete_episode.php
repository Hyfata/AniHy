<?php
require_once __DIR__ . '/../inc/auth.php';
require_once __DIR__ . '/../inc/functions.php';

requireAdmin();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonResponse(false, [], '잘못된 요청입니다.');
}

$id = filter_input(INPUT_POST, 'id', FILTER_VALIDATE_INT);
if (!$id) {
    jsonResponse(false, [], '잘못된 ID입니다.');
}

$stmt = $pdo->prepare("SELECT * FROM episodes WHERE id = ?");
$stmt->execute([$id]);
$episode = $stmt->fetch();

if (!$episode) {
    jsonResponse(false, [], '에피소드를 찾을 수 없습니다.');
}

$videoPath = __DIR__ . '/../' . $episode['file_path'];
if (file_exists($videoPath)) {
    unlink($videoPath);
}

$stmt = $pdo->prepare("DELETE FROM episodes WHERE id = ?");
$stmt->execute([$id]);

jsonResponse(true, [], '삭제되었습니다.');
