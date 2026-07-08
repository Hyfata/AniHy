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

$stmt = $pdo->prepare("SELECT status, worker_pid FROM jobs WHERE id = ?");
$stmt->execute([$jobId]);
$job = $stmt->fetch();

if (!$job) {
    jsonResponse(false, [], '작업을 찾을 수 없습니다.');
}

if (in_array($job['status'], ['completed', 'failed'], true)) {
    jsonResponse(false, [], '이미 완료되거나 실패한 작업입니다.');
}

$pid = isset($job['worker_pid']) ? (int)$job['worker_pid'] : 0;
if ($pid > 0 && function_exists('posix_kill')) {
    // 웹 SAPI에서는 SIGTERM/SIGKILL 상수가 없을 수 있으므로 정수값 사용
    posix_kill($pid, 15); // SIGTERM
    usleep(200000); // 0.2초 대기
    if (posix_kill($pid, 0)) {
        posix_kill($pid, 9); // SIGKILL
    }
}

$stmt = $pdo->prepare("UPDATE jobs SET status = 'failed', progress = 0, message = '사용자가 작업을 중지했습니다.', worker_pid = NULL, updated_at = NOW() WHERE id = ?");
$stmt->execute([$jobId]);

jsonResponse(true, [], '작업을 중지했습니다.');
