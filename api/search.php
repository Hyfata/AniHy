<?php
require_once __DIR__ . '/../inc/auth.php';
require_once __DIR__ . '/../inc/functions.php';

requireAdmin();

$keyword = trim($_GET['keyword'] ?? '');
$service = trim($_GET['service'] ?? 'crunchy');
if ($keyword === '') {
    header('Content-Type: text/plain; charset=utf-8');
    echo '검색어를 입력하세요.';
    exit;
}

$script = $service === 'hidive' ? './hidn.sh' : './crdn.sh';
$downloaderDir = __DIR__ . '/../downloader';
$cmd = sprintf(
    'cd %s && %s --search %s 2>&1',
    escapeshellarg($downloaderDir),
    $script,
    escapeshellarg($keyword)
);

$output = shell_exec($cmd);

header('Content-Type: text/plain; charset=utf-8');
echo $output !== null ? $output : '검색 중 오류가 발생했습니다.';
