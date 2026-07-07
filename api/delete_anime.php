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

// Get cover and episodes before deletion
$stmt = $pdo->prepare("SELECT cover_image FROM animes WHERE id = ?");
$stmt->execute([$id]);
$anime = $stmt->fetch();

if (!$anime) {
    jsonResponse(false, [], '애니를 찾을 수 없습니다.');
}

$stmt = $pdo->prepare("SELECT episode_number FROM episodes WHERE anime_id = ?");
$stmt->execute([$id]);
$episodes = $stmt->fetchAll();

$baseDir = __DIR__ . '/..';

// Delete episode videos
foreach ($episodes as $ep) {
    $videoPath = "$baseDir/animes/$id/{$ep['episode_number']}.mp4";
    if (file_exists($videoPath)) {
        unlink($videoPath);
    }
}

// Remove anime directory if empty
@rmdir("$baseDir/animes/$id");

// Delete cover image
$coverPath = "$baseDir/covers/{$anime['cover_image']}";
if (file_exists($coverPath)) {
    unlink($coverPath);
}

// Delete from DB (cascade deletes episodes)
$stmt = $pdo->prepare("DELETE FROM animes WHERE id = ?");
$stmt->execute([$id]);

jsonResponse(true, [], '삭제되었습니다.');
