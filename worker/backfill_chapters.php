<?php
// 기존 라이브러리(animes/*/*.mp4)의 내장 챕터를 WebVTT 사이드카로 일괄 생성하는
// 일회성 백필 스크립트. (신규 인코딩은 worker/convert.php에서 자동 생성)
// 사용: php worker/backfill_chapters.php
require_once __DIR__ . '/../inc/chapters.php';

if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}

$baseDir = '/var/www/html/anime';
$animesDir = "$baseDir/animes";

$files = glob("$animesDir/*/*.mp4") ?: [];
$made = 0;
$skipped = 0;
foreach ($files as $mp4) {
    $vtt = substr($mp4, 0, -strlen('.mp4')) . '.chapters.vtt';
    if (exportChaptersVtt($mp4, $vtt)) {
        $made++;
        echo "OK $mp4\n";
    } else {
        $skipped++;
        @unlink($vtt);
    }
}
echo "done: total=" . count($files) . " vtt=$made skipped=$skipped\n";
