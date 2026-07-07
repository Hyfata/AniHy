<?php
require_once __DIR__ . '/../inc/auth.php';
require_once __DIR__ . '/../inc/functions.php';

requireAdmin();

$animeId = filter_input(INPUT_GET, 'aid', FILTER_VALIDATE_INT);
$episodeNumber = filter_input(INPUT_GET, 'ep', FILTER_VALIDATE_INT);

if (!$animeId || !$episodeNumber) {
    jsonResponse(false, [], '필수 항목을 입력하세요.');
}

$stmt = $pdo->prepare("SELECT season_id, title FROM animes WHERE id = ?");
$stmt->execute([$animeId]);
$anime = $stmt->fetch();

if (!$anime || empty($anime['season_id'])) {
    jsonResponse(false, [], '애니 또는 시즌 ID를 찾을 수 없습니다.');
}

$baseDir = '/var/www/html/anime';
$downloaderDir = "$baseDir/downloader";
$videosDir = "$downloaderDir/videos";
$subtitlesDir = "$baseDir/subtitles";
$assDir = "$subtitlesDir/$animeId";
$targetPath = "$assDir/{$episodeNumber}_en.ass";
$relativePath = "subtitles/$animeId/{$episodeNumber}_en.ass";

// Return cached file if exists
if (file_exists($targetPath) && filesize($targetPath) > 0) {
    serveAssDownload($targetPath, $episodeNumber . '_en.ass');
}

if (!is_dir($assDir)) {
    mkdir($assDir, 0777, true);
}

// Download English subtitle
$before = glob($videosDir . '/*.ass');
$cmd = sprintf(
    'cd %s && ./crdn.sh -s %s -e %d --dlsubs en --noASSConv --novids --noaudio 2>&1',
    escapeshellarg($downloaderDir),
    escapeshellarg($anime['season_id']),
    $episodeNumber
);
$output = shell_exec($cmd);

$after = glob($videosDir . '/*.ass');
$newFiles = array_values(array_diff($after, $before));

if (empty($newFiles)) {
    jsonResponse(false, [], '영어 자막 다운로드 실패: 파일을 찾을 수 없습니다.');
}

$downloadedPath = $newFiles[0];
if (!copy($downloadedPath, $targetPath)) {
    jsonResponse(false, [], '자막 파일 저장 실패');
}

// Update episodes.en_subtitle_file if episode exists
$stmt = $pdo->prepare("UPDATE episodes SET en_subtitle_file = ? WHERE anime_id = ? AND episode_number = ?");
$stmt->execute([$relativePath, $animeId, $episodeNumber]);

// Clean up downloaded file from videos dir
@unlink($downloadedPath);

serveAssDownload($targetPath, $episodeNumber . '_en.ass');

function serveAssDownload(string $filePath, string $downloadName): void {
    if (!file_exists($filePath)) {
        http_response_code(404);
        exit;
    }

    header('Content-Type: application/octet-stream');
    header('Content-Disposition: attachment; filename="' . $downloadName . '"');
    header('Content-Length: ' . filesize($filePath));
    header('Cache-Control: no-cache, must-revalidate');

    readfile($filePath);
    exit;
}
