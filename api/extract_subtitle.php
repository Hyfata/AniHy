<?php
require_once __DIR__ . '/../inc/auth.php';
require_once __DIR__ . '/../inc/functions.php';

requireAdmin();

$videoPath = isset($_GET['path']) ? trim((string)$_GET['path']) : '';

if ($videoPath === '') {
    jsonResponse(false, [], '영상 경로가 필요합니다.');
}

// transmission 다운로드 루트 아래의 파일만 허용
$root = '/var/lib/transmission-daemon/downloads';
$rootReal = realpath($root);
$realPath = realpath($videoPath);

if ($rootReal === false || $realPath === false || strpos($realPath, $rootReal . DIRECTORY_SEPARATOR) !== 0) {
    jsonResponse(false, [], '허용되지 않는 파일 경로입니다.');
}

if (!is_file($realPath)) {
    jsonResponse(false, [], '파일을 찾을 수 없습니다.');
}

// 영상에 자막 스트림이 있는지 확인
$probeCmd = sprintf(
    'ffprobe -v error -select_streams s -show_entries stream=index,codec_name -of csv=p=0 %s 2>&1',
    escapeshellarg($realPath)
);
$probeOutput = trim((string)shell_exec($probeCmd));

if ($probeOutput === '') {
    jsonResponse(false, [], '영상에 자막 스트림이 없습니다.');
}

$tmpDir = sys_get_temp_dir();
$baseName = pathinfo($realPath, PATHINFO_FILENAME);
$downloadName = sanitizeFilename($baseName) . '.ass';
$outPath = $tmpDir . '/sub_extract_' . uniqid() . '.ass';

$cmd = sprintf(
    'ffmpeg -y -v error -i %s -map 0:s:0 -c:s ass %s 2>&1',
    escapeshellarg($realPath),
    escapeshellarg($outPath)
);
$output = shell_exec($cmd);

if (!file_exists($outPath) || filesize($outPath) === 0) {
    @unlink($outPath);
    jsonResponse(false, [], '자막 추출 실패: ' . trim((string)$output));
}

header('Content-Type: application/octet-stream');
header('Content-Disposition: attachment; filename="' . $downloadName . '"');
header('Content-Length: ' . filesize($outPath));
header('Cache-Control: no-cache, must-revalidate');

readfile($outPath);
@unlink($outPath);
exit;
