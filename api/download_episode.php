<?php
require_once __DIR__ . '/../inc/auth.php';
require_once __DIR__ . '/../inc/access_auth.php';
require_once __DIR__ . '/../inc/functions.php';

requireAccessAuth();

// 대용량 전송 중 세션 잠금으로 다른 요청이 멈추지 않도록 즉시 해제
session_write_close();
set_time_limit(0);

$animeId = filter_input(INPUT_GET, 'aid', FILTER_VALIDATE_INT);
$episodeNumber = isset($_GET['ep']) ? trim((string)$_GET['ep']) : '';

if (!$animeId || $episodeNumber === '') {
    http_response_code(400);
    exit;
}

$stmt = $pdo->prepare("SELECT a.title AS anime_title, e.episode_number, e.file_path FROM episodes e JOIN animes a ON a.id = e.anime_id WHERE e.anime_id = ? AND e.episode_number = ?");
$stmt->execute([$animeId, $episodeNumber]);
$ep = $stmt->fetch();

$filePath = $ep && !empty($ep['file_path']) ? __DIR__ . '/../' . $ep['file_path'] : '';
if (!$ep || !is_file($filePath) || filesize($filePath) === 0) {
    http_response_code(404);
    exit;
}

$downloadName = $ep['anime_title'] . ' ' . $ep['episode_number'] . '화.mp4';
$asciiName = 'episode_' . sanitizeFilename($ep['episode_number']) . '.mp4';

header('Content-Type: application/octet-stream');
header('Content-Disposition: attachment; filename="' . $asciiName . '"; filename*=UTF-8\'\'' . rawurlencode($downloadName));
header('Content-Length: ' . filesize($filePath));
header('Cache-Control: no-cache, must-revalidate');

readfile($filePath);
exit;
