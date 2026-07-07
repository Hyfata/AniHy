<?php
require_once __DIR__ . '/../inc/auth.php';
require_once __DIR__ . '/../inc/functions.php';

requireAdmin();

$jobId = filter_input(INPUT_GET, 'job_id', FILTER_VALIDATE_INT);
if (!$jobId) {
    jsonResponse(false, [], '잘못된 작업 ID입니다.');
}

$stmt = $pdo->prepare("SELECT * FROM jobs WHERE id = ?");
$stmt->execute([$jobId]);
$job = $stmt->fetch();

if (!$job) {
    jsonResponse(false, [], '작업을 찾을 수 없습니다.');
}

jsonResponse(true, [
    'job_id' => $job['id'],
    'status' => $job['status'],
    'progress' => (int)$job['progress'],
    'message' => $job['message']
]);
