<?php
require_once __DIR__ . '/../inc/auth.php';
require_once __DIR__ . '/../inc/functions.php';

requireAdmin();

$root = '/var/lib/transmission-daemon/downloads';
$rootReal = realpath($root);
if ($rootReal === false) {
    jsonResponse(false, [], '서버 파일 루트를 찾을 수 없습니다.');
}

$files = [];
$iterator = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($root, RecursiveDirectoryIterator::SKIP_DOTS),
    RecursiveIteratorIterator::LEAVES_ONLY
);

foreach ($iterator as $file) {
    if (!$file->isFile() || $file->isLink()) {
        continue;
    }

    $path = $file->getPathname();
    $realPath = realpath($path);
    if ($realPath === false) {
        continue;
    }

    // realpath 기준으로 루트 아래에 있는지 다시 확인
    if (strpos($realPath, $rootReal . DIRECTORY_SEPARATOR) !== 0) {
        continue;
    }

    $ext = strtolower(pathinfo($realPath, PATHINFO_EXTENSION));
    if (!allowedVideoExt($ext)) {
        continue;
    }

    $dir = dirname($realPath);
    $relativeDir = ltrim(str_replace($rootReal, '', $dir), DIRECTORY_SEPARATOR);

    $files[] = [
        'path' => $realPath,
        'name' => $file->getFilename(),
        'dir' => $dir,
        'relative_dir' => $relativeDir,
    ];
}

usort($files, fn($a, $b) => strcmp($a['path'], $b['path']));
jsonResponse(true, ['files' => $files]);
