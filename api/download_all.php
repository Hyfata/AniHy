<?php
require_once __DIR__ . '/../inc/auth.php';
require_once __DIR__ . '/../inc/access_auth.php';
require_once __DIR__ . '/../inc/functions.php';

requireAccessAuth();

$animeId = filter_input(INPUT_GET, 'aid', FILTER_VALIDATE_INT);
if (!$animeId) {
    jsonResponse(false, [], '잘못된 요청입니다.');
}

$baseDir = '/var/www/html/anime';
$progressFile = "$baseDir/logs/zip_$animeId.json";
$zipPath = "$baseDir/downloader/videos/bundle_$animeId.zip";

// 진행률 조회
if (isset($_GET['progress'])) {
    if (!is_file($progressFile)) {
        jsonResponse(false, [], '진행 정보가 없습니다.');
    }
    $job = json_decode((string)file_get_contents($progressFile), true) ?: [];
    $alive = !empty($job['pid']) && file_exists('/proc/' . (int)$job['pid']);
    if (($job['status'] ?? '') === 'running' && !$alive) {
        $job['status'] = 'failed';
        $job['message'] = '압축 프로세스가 종료되었습니다.';
    }
    $job['alive'] = $alive;
    jsonResponse(true, ['job' => $job]);
}

// 완성된 ZIP 다운로드
if (isset($_GET['file'])) {
    if (!is_file($zipPath)) {
        http_response_code(404);
        exit;
    }

    $stmt = $pdo->prepare("SELECT title FROM animes WHERE id = ?");
    $stmt->execute([$animeId]);
    $anime = $stmt->fetch();

    $downloadName = ($anime['title'] ?? 'episodes') . '.zip';
    $asciiName = 'anime_' . $animeId . '.zip';

    ignore_user_abort(true);
    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="' . $asciiName . '"; filename*=UTF-8\'\'' . rawurlencode($downloadName));
    header('Content-Length: ' . filesize($zipPath));
    header('Cache-Control: no-cache, must-revalidate');

    readfile($zipPath);
    @unlink($zipPath);
    @unlink($progressFile);
    exit;
}

// 압축 작업 시작
$running = false;
if (is_file($progressFile)) {
    $job = json_decode((string)file_get_contents($progressFile), true) ?: [];
    if (($job['status'] ?? '') === 'running' && !empty($job['pid']) && file_exists('/proc/' . (int)$job['pid'])) {
        $running = true;
    }
}

if (!$running) {
    @unlink($zipPath);
    @unlink($progressFile);
    $cmd = sprintf(
        'nohup php %s %d > /dev/null 2>&1 &',
        escapeshellarg("$baseDir/worker/zip_all.php"),
        $animeId
    );
    shell_exec($cmd);
}

jsonResponse(true, ['running' => true]);
