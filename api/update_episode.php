<?php
require_once __DIR__ . '/../inc/auth.php';
require_once __DIR__ . '/../inc/functions.php';

requireAdmin();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonResponse(false, [], '잘못된 요청입니다.');
}

$id = filter_input(INPUT_POST, 'id', FILTER_VALIDATE_INT);
$title = trim($_POST['title'] ?? '');

if (!$id) {
    jsonResponse(false, [], '잘못된 ID입니다.');
}

$stmt = $pdo->prepare("SELECT id FROM episodes WHERE id = ?");
$stmt->execute([$id]);
if (!$stmt->fetch()) {
    jsonResponse(false, [], '에피소드를 찾을 수 없습니다.');
}

$stmt = $pdo->prepare("UPDATE episodes SET title = ? WHERE id = ?");
$stmt->execute([$title !== '' ? $title : null, $id]);

jsonResponse(true, ['id' => $id, 'title' => $title], '에피소드 제목이 수정되었습니다.');
