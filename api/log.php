<?php
require_once __DIR__ . '/../inc/auth.php';
require_once __DIR__ . '/../inc/functions.php';

requireAdmin();

$jobId = filter_input(INPUT_GET, 'job_id', FILTER_VALIDATE_INT);
$offset = filter_input(INPUT_GET, 'offset', FILTER_VALIDATE_INT) ?: 0;

if (!$jobId) {
    jsonResponse(false, [], '잘못된 작업 ID입니다.');
}

$logFile = __DIR__ . '/../logs/job_' . $jobId . '.log';
if (!file_exists($logFile)) {
    jsonResponse(true, ['content' => '', 'offset' => 0, 'size' => 0], '로그 파일이 아직 생성되지 않았습니다.');
}

$size = filesize($logFile);
if ($offset > $size) {
    $offset = $size;
}

$handle = fopen($logFile, 'r');
if (!$handle) {
    jsonResponse(false, [], '로그 파일을 열 수 없습니다.');
}

fseek($handle, $offset);
$content = '';
while (!feof($handle)) {
    $content .= fread($handle, 8192);
}
$newOffset = ftell($handle);
fclose($handle);

jsonResponse(true, [
    'content' => $content,
    'offset' => $newOffset,
    'size' => $size
]);
