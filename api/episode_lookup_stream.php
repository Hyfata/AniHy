<?php
require_once __DIR__ . '/../inc/auth.php';
require_once __DIR__ . '/../inc/functions.php';

requireAdmin();

$seasonId = trim($_GET['season_id'] ?? '');
$service = trim($_GET['service'] ?? 'crunchy');
if ($seasonId === '') {
    http_response_code(400);
    jsonResponse(false, [], '시즌 ID가 필요합니다.');
}

header('Content-Type: text/event-stream; charset=utf-8');
header('Cache-Control: no-cache');
header('Connection: keep-alive');

if (function_exists('set_time_limit')) {
    set_time_limit(0);
}

while (ob_get_level() > 0) {
    ob_end_flush();
}
ob_implicit_flush(true);

function sendSse(string $data, string $event = 'message'): void {
    echo "event: $event\n";
    echo 'data: ' . str_replace("\n", "\ndata: ", $data) . "\n\n";
    flush();
}

$script = $service === 'hidive' ? './hidn.sh' : './crdn.sh';
$downloaderDir = __DIR__ . '/../downloader';
$cmd = sprintf(
    'cd %s && %s -s %s 2>&1',
    escapeshellarg($downloaderDir),
    $script,
    escapeshellarg($seasonId)
);

$process = proc_open($cmd, [
    1 => ['pipe', 'w'],
    2 => ['pipe', 'w'],
], $pipes);

if (!is_resource($process)) {
    sendSse('프로세스를 시작할 수 없습니다.', 'error');
    sendSse('', 'done');
    exit;
}

stream_set_blocking($pipes[1], false);
stream_set_blocking($pipes[2], false);

$running = true;
while ($running) {
    $status = proc_get_status($process);
    $running = $status['running'];

    foreach ([$pipes[1], $pipes[2]] as $pipe) {
        while (($line = fgets($pipe)) !== false) {
            $line = rtrim($line, "\r\n");
            if ($line !== '') {
                sendSse($line);
            }
        }
    }

    if ($running) {
        usleep(100000);
    }
}

fclose($pipes[1]);
fclose($pipes[2]);
proc_close($process);

sendSse('', 'done');
