<?php
require_once __DIR__ . '/../inc/auth.php';
require_once __DIR__ . '/../inc/functions.php';

requireAdmin();

$jobId = filter_input(INPUT_GET, 'job_id', FILTER_VALIDATE_INT);
if (!$jobId) {
    jsonResponse(false, [], '잘못된 작업 ID입니다.');
}

$stmt = $pdo->prepare("SELECT duration_ms FROM jobs WHERE id = ?");
$stmt->execute([$jobId]);
$job = $stmt->fetch();
$durationMs = isset($job['duration_ms']) ? (int)$job['duration_ms'] : 0;

$progress = 0;
$logFile = __DIR__ . '/../logs/job_' . $jobId . '.log';
if ($durationMs > 0 && file_exists($logFile)) {
    $handle = fopen($logFile, 'r');
    if ($handle) {
        $lastMs = 0;
        while (($line = fgets($handle)) !== false) {
            $line = trim($line);
            if (preg_match('/^out_time_ms=(\d+)$/', $line, $m)) {
                // ffmpeg의 out_time_ms는 이름과 달리 마이크로초 단위다
                $lastMs = (int)($m[1] / 1000);
            }
        }
        fclose($handle);
        $progress = (int)min(100, max(0, round($lastMs / $durationMs * 100)));
    }
}

jsonResponse(true, ['encode_progress' => $progress]);
