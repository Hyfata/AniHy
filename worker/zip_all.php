<?php
// CLI worker: 애니의 모든 에피소드 MP4를 ZIP으로 압축하며 진행률을 logs/zip_{aid}.json에 기록
if (PHP_SAPI !== 'cli') {
    exit(1);
}

$animeId = isset($argv[1]) ? (int)$argv[1] : 0;
if (!$animeId) {
    exit(1);
}

$baseDir = '/var/www/html/anime';
require_once $baseDir . '/inc/db.php';

$progressFile = "$baseDir/logs/zip_$animeId.json";
$zipPath = "$baseDir/downloader/videos/bundle_$animeId.zip";

$writeProgress = function (array $data) use ($progressFile): void {
    $data['pid'] = getmypid();
    $data['updated_at'] = time();
    file_put_contents($progressFile, json_encode($data, JSON_UNESCAPED_UNICODE));
};

$stmt = $pdo->prepare("SELECT episode_number, file_path FROM episodes WHERE anime_id = ? ORDER BY episode_number ASC");
$stmt->execute([$animeId]);

$files = [];
foreach ($stmt->fetchAll() as $row) {
    if (empty($row['file_path'])) {
        continue;
    }
    $path = "$baseDir/" . $row['file_path'];
    if (is_file($path) && filesize($path) > 0) {
        $files[basename($row['file_path'])] = $path;
    }
}

$total = count($files);
if ($total === 0) {
    $writeProgress(['status' => 'failed', 'percent' => 0, 'total' => 0, 'message' => '압축할 에피소드 파일이 없습니다.']);
    exit(1);
}

$writeProgress(['status' => 'running', 'percent' => 0, 'total' => $total]);

$zip = new ZipArchive();
if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
    $writeProgress(['status' => 'failed', 'percent' => 0, 'total' => $total, 'message' => '압축 파일 생성 실패']);
    exit(1);
}

$lastWrite = 0.0;
$zip->registerProgressCallback(0.02, function (float $rate) use ($writeProgress, &$lastWrite, $total): void {
    $now = microtime(true);
    if ($rate < 1 && $now - $lastWrite < 0.5) {
        return;
    }
    $lastWrite = $now;
    $writeProgress(['status' => 'running', 'percent' => round($rate * 100, 1), 'total' => $total]);
});

foreach ($files as $name => $path) {
    $zip->addFile($path, $name);
    $zip->setCompressionName($name, ZipArchive::CM_STORE); // MP4는 무압축 저장
}

$ok = $zip->close();

if ($ok) {
    $writeProgress(['status' => 'done', 'percent' => 100, 'total' => $total]);
    exit(0);
}

@unlink($zipPath);
$writeProgress(['status' => 'failed', 'percent' => 0, 'total' => $total, 'message' => '압축 실패']);
exit(1);
