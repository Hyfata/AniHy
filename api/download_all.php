<?php
require_once __DIR__ . '/../inc/auth.php';
require_once __DIR__ . '/../inc/access_auth.php';
require_once __DIR__ . '/../inc/functions.php';

requireAccessAuth();

// 대용량 전송 중 세션 잠금으로 다른 요청이 멈추지 않도록 즉시 해제
session_write_close();
set_time_limit(0);

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

    $size = filesize($zipPath);
    $start = 0;
    $end = $size - 1;

    // iOS 다운로드 데몬 등이 끊긴 전송을 Range로 재개/재요청하므로 부분 전송을 지원한다
    $rangeHeader = trim((string)($_SERVER['HTTP_RANGE'] ?? ''));
    if ($rangeHeader !== '' && preg_match('/^bytes=(\d*)-(\d*)$/', $rangeHeader, $m)) {
        if ($m[1] !== '') {
            $start = (int)$m[1];
            if ($m[2] !== '') {
                $end = min((int)$m[2], $size - 1);
            }
        } elseif ($m[2] !== '' && (int)$m[2] > 0) {
            $start = max(0, $size - (int)$m[2]);
        }
        if ($start > $end || $start >= $size) {
            http_response_code(416);
            header('Content-Range: bytes */' . $size);
            exit;
        }
    }
    $isPartial = $start > 0 || $end < $size - 1;
    $length = $end - $start + 1;

    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="' . $asciiName . '"; filename*=UTF-8\'\'' . rawurlencode($downloadName));
    header('Cache-Control: no-cache, must-revalidate');
    header('Accept-Ranges: bytes');
    header('Content-Length: ' . $length);
    if ($isPartial) {
        http_response_code(206);
        header('Content-Range: bytes ' . $start . '-' . $end . '/' . $size);
    }

    $fp = fopen($zipPath, 'rb');
    fseek($fp, $start);
    $remaining = $length;
    while ($remaining > 0 && !feof($fp)) {
        if (connection_aborted()) {
            break;
        }
        $chunk = fread($fp, min(131072, $remaining));
        if ($chunk === false) {
            break;
        }
        echo $chunk;
        $remaining -= strlen($chunk);
        flush();
    }
    fclose($fp);
    // ZIP과 진행 파일은 재개/재요청을 위해 유지하고, 다음 압축 시작 시 TTL 경과분을 정리한다
    exit;
}

// 압축 작업 시작
// 전송 후 즉시 삭제하지 않으므로, 이전에 남은 오래된 ZIP/진행 파일(24시간 경과)을 여기서 정리
foreach (glob("$baseDir/downloader/videos/bundle_*.zip") ?: [] as $oldZip) {
    if (filemtime($oldZip) < time() - 86400) {
        @unlink($oldZip);
    }
}
foreach (glob("$baseDir/logs/zip_*.json") ?: [] as $oldProgress) {
    if (filemtime($oldProgress) < time() - 86400) {
        @unlink($oldProgress);
    }
}

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
