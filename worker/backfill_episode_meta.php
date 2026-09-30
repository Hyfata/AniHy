<?php
// 기존 에피소드의 duration_ms(episodes)와 회차 썸네일(animes/{aid}/{ep}.jpg)을
// 일괄 채우는 백필 스크립트. (신규 인코딩은 worker/convert.php에서 자동 생성)
// 사용: php worker/backfill_episode_meta.php
require_once __DIR__ . '/../inc/functions.php';
require_once __DIR__ . '/../inc/chapters.php';

if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}

$baseDir = '/var/www/html/anime';

$rows = $pdo->query("SELECT id, anime_id, episode_number, file_path, duration_ms FROM episodes WHERE file_path IS NOT NULL AND file_path != ''");
$durFilled = 0;
$thumbMade = 0;
$skipped = 0;
foreach ($rows as $ep) {
    $mp4 = "$baseDir/" . $ep['file_path'];
    if (!is_file($mp4)) {
        $skipped++;
        continue;
    }
    $safeEpisode = sanitizeFilename($ep['episode_number']);

    if ($ep['duration_ms'] === null) {
        $out = trim((string)shell_exec(sprintf(
            'ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 %s 2>&1',
            escapeshellarg($mp4)
        )));
        if (is_numeric($out) && (float)$out > 0) {
            $pdo->prepare("UPDATE episodes SET duration_ms = ? WHERE id = ?")
                ->execute([(int)round((float)$out * 1000), $ep['id']]);
            $durFilled++;
        }
    }

    $thumb = episodeThumbPath((int)$ep['anime_id'], $safeEpisode, $baseDir);
    if (!is_file($thumb) || filesize($thumb) === 0) {
        $seek = $ep['duration_ms'] !== null ? max(1, (int)round(((int)$ep['duration_ms']) / 1000 * 0.5)) : 60;
        shell_exec(sprintf(
            'ffmpeg -y -ss %d -i %s -frames:v 1 -vf scale=480:-2 -q:v 4 %s 2>&1',
            $seek,
            escapeshellarg($mp4),
            escapeshellarg($thumb)
        ));
        if (is_file($thumb) && filesize($thumb) > 0) {
            $thumbMade++;
            echo "OK $thumb\n";
        } else {
            @unlink($thumb);
        }
    }
}
echo "done: duration=$durFilled thumb=$thumbMade skipped=$skipped\n";
