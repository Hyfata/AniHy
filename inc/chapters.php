<?php
// MP4 내장 챕터를 WebVTT 사이드카로 추출하는 헬퍼.
// Safari는 내장 챕터를 chapters 텍스트 트랙으로 노출하지만 Chrome/Firefox는
// 지원하지 않으므로, 크로스브라우저 챕터 스킵을 위해 외부 VTT를 사용한다.
// DB 의존성 없음.

function chapterVttFilename(string $safeEpisode): string {
    return $safeEpisode . '.chapters.vtt';
}

function chapterVttPath(int $animeId, string $safeEpisode, ?string $baseDir = null): string {
    $baseDir ??= dirname(__DIR__);
    return $baseDir . "/animes/$animeId/" . chapterVttFilename($safeEpisode);
}

function chapterVttUrl(int $animeId, string $safeEpisode): string {
    return '/anime/animes/' . $animeId . '/' . rawurlencode(chapterVttFilename($safeEpisode));
}

function formatVttTimestamp(float $seconds): string {
    $seconds = max(0, $seconds);
    $totalMs = (int)round($seconds * 1000);
    $ms = $totalMs % 1000;
    $s = intdiv($totalMs, 1000);
    return sprintf('%02d:%02d:%02d.%03d', intdiv($s, 3600), intdiv($s % 3600, 60), $s % 60, $ms);
}

// 내장 챕터를 읽어 WebVTT 파일로 저장한다.
// 유효한 챕터가 없으면 파일을 만들지 않고 false를 반환한다.
function exportChaptersVtt(string $mp4Path, string $vttPath): bool {
    if (!is_file($mp4Path)) {
        return false;
    }
    $cmd = sprintf('ffprobe -v error -show_chapters -of json %s 2>&1', escapeshellarg($mp4Path));
    $raw = shell_exec($cmd);
    if (!is_string($raw) || $raw === '') {
        return false;
    }
    $data = json_decode($raw, true);
    $chapters = $data['chapters'] ?? [];
    if (!is_array($chapters) || count($chapters) === 0) {
        return false;
    }

    $out = "WEBVTT\n";
    foreach ($chapters as $ch) {
        if (!isset($ch['start_time'], $ch['end_time'])) {
            continue;
        }
        $start = (float)$ch['start_time'];
        $end = (float)$ch['end_time'];
        if (!is_finite($start) || !is_finite($end) || $end <= $start) {
            continue;
        }
        $title = preg_replace('/\s+/', ' ', trim((string)($ch['tags']['title'] ?? '')));
        if ($title === '') {
            $title = 'Chapter';
        }
        // cue 페이로드에 '-->'가 들어가면 VTT 파싱이 깨지므로 치환
        $title = str_replace('-->', '->', $title);
        $out .= "\n" . formatVttTimestamp($start) . ' --> ' . formatVttTimestamp($end) . "\n" . $title . "\n";
    }
    if ($out === "WEBVTT\n") {
        return false;
    }
    $dir = dirname($vttPath);
    if (!is_dir($dir) && !mkdir($dir, 0777, true)) {
        return false;
    }
    return file_put_contents($vttPath, $out) !== false;
}
