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

// 첫 번째 오디오 스트림 코덱 확인
$probeCmd = sprintf(
    'ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of csv=p=0 %s 2>&1',
    escapeshellarg($realPath)
);
$codec = trim((string)shell_exec($probeCmd));

if ($codec === '') {
    jsonResponse(false, [], '영상에 오디오 스트림이 없습니다.');
}

// 코덱에 맞는 확장자와 MIME 결정
$codecMap = [
    'mp3'    => ['mp3', 'audio/mpeg'],
    'aac'    => ['m4a', 'audio/mp4'],
    'opus'   => ['opus', 'audio/ogg'],
    'vorbis' => ['ogg', 'audio/ogg'],
    'flac'   => ['flac', 'audio/flac'],
    'ac3'    => ['ac3', 'audio/ac3'],
    'eac3'   => ['eac3', 'audio/eac3'],
    'dts'    => ['dts', 'audio/vnd.dts'],
    'truehd' => ['thd', 'audio/truehd'],
    'pcm_s16le' => ['wav', 'audio/wav'],
    'pcm_s24le' => ['wav', 'audio/wav'],
];
[$ext, $mime] = $codecMap[$codec] ?? ['mka', 'audio/x-matroska'];

$tmpDir = sys_get_temp_dir();
$baseName = pathinfo($realPath, PATHINFO_FILENAME);
$downloadName = sanitizeFilename($baseName) . '.' . $ext;
$outPath = $tmpDir . '/audio_extract_' . uniqid() . '.' . $ext;

// 재인코딩 없이 오디오 스트림 copy
$cmd = sprintf(
    'ffmpeg -y -v error -i %s -map 0:a:0 -vn -c:a copy %s 2>&1',
    escapeshellarg($realPath),
    escapeshellarg($outPath)
);
$output = shell_exec($cmd);

if (!file_exists($outPath) || filesize($outPath) === 0) {
    @unlink($outPath);
    jsonResponse(false, [], '오디오 추출 실패: ' . trim((string)$output));
}

header('Content-Type: ' . $mime);
header('Content-Disposition: attachment; filename="' . $downloadName . '"');
header('Content-Length: ' . filesize($outPath));
header('Cache-Control: no-cache, must-revalidate');

readfile($outPath);
@unlink($outPath);
exit;
