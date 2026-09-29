<?php
require_once __DIR__ . '/../inc/auth.php';
require_once __DIR__ . '/../inc/functions.php';

requireAdmin();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonResponse(false, [], '잘못된 요청입니다.');
}

$jobId = filter_input(INPUT_POST, 'job_id', FILTER_VALIDATE_INT);
if (!$jobId) {
    jsonResponse(false, [], '잘못된 작업 ID입니다.');
}

$stmt = $pdo->prepare("SELECT status, subtitle_file FROM jobs WHERE id = ?");
$stmt->execute([$jobId]);
$job = $stmt->fetch();

if (!$job) {
    jsonResponse(false, [], '작업을 찾을 수 없습니다.');
}

if ($job['status'] !== 'failed') {
    jsonResponse(false, [], '실패한 작업만 재시도할 수 있습니다.');
}

// convert.php가 smi2ass 실패 시 원본을 subtitles/failed/job_{id}_{파일명}로 옮겨두므로,
// 재시도 전에 원래 위치로 복구한다 (없으면 자막 없이 진행됨)
$subtitleFile = $job['subtitle_file'];
if ($subtitleFile) {
    $subtitlesDir = __DIR__ . '/../subtitles';
    $origPath = "$subtitlesDir/$subtitleFile";
    if (!file_exists($origPath)) {
        $keptPath = "$subtitlesDir/failed/job_{$jobId}_" . basename($subtitleFile);
        if (file_exists($keptPath)) {
            @rename($keptPath, $origPath);
        }
        // 원본이 없어도 subtitles/{aid}/{ep}.ass 재사용 로직이 있으므로 재시도는 진행
    }
}

$stmt = $pdo->prepare("UPDATE jobs SET status = 'pending', progress = 0, message = '재시도 대기 중', worker_pid = NULL, updated_at = NOW() WHERE id = ?");
$stmt->execute([$jobId]);

// 큐 매니저가 죽어 있으면 기동 (add_episode.php와 동일한 lock 검사)
$lockFile = __DIR__ . '/../logs/queue.lock';
$startQueue = true;
if (file_exists($lockFile)) {
    $pid = (int)trim((string)file_get_contents($lockFile));
    if ($pid > 0 && function_exists('posix_kill') && posix_kill($pid, 0)) {
        $startQueue = false;
    }
}
if ($startQueue) {
    $queueWorker = __DIR__ . '/../worker/queue.php';
    $queueLog = __DIR__ . '/../logs/queue.log';

    $phpBinary = (defined('PHP_BINARY') && PHP_BINARY !== '' && PHP_BINARY !== '-')
        ? PHP_BINARY
        : PHP_BINDIR . '/php';
    if (!file_exists($phpBinary)) {
        $phpBinary = 'php';
    }

    $cmd = sprintf(
        'nohup %s %s > %s 2>&1 &',
        escapeshellarg($phpBinary),
        escapeshellarg($queueWorker),
        escapeshellarg($queueLog)
    );
    exec($cmd);
}

jsonResponse(true, ['job_id' => $jobId], '작업을 다시 대기열에 올렸습니다.');
