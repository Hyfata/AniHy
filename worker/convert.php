<?php
require_once __DIR__ . '/../inc/functions.php';

if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}

$jobId = isset($argv[1]) ? (int)$argv[1] : 0;
if (!$jobId) {
    exit('job_id required');
}

$baseDir = '/var/www/html/anime';
$downloaderDir = "$baseDir/downloader";
$videosDir = "$downloaderDir/videos";
$animesDir = "$baseDir/animes";
$subtitlesDir = "$baseDir/subtitles";
$logFile = "$baseDir/logs/job_{$jobId}.log";

// Use bundled Korean fonts for libass burn-in
putenv('FONTCONFIG_FILE=' . $baseDir . '/assets/fonts/fonts.conf');

// Enable Intel VA-API driver for hardware acceleration
putenv('LIBVA_DRIVER_NAME=iHD');

function logMsg(string $msg): void {
    global $logFile;
    file_put_contents($logFile, date('[Y-m-d H:i:s] ') . $msg . PHP_EOL, FILE_APPEND);
}

function updateJob(PDO $pdo, int $id, string $status, int $progress, string $message): void {
    $stmt = $pdo->prepare("UPDATE jobs SET status = ?, progress = ?, message = ?, updated_at = NOW() WHERE id = ?");
    $stmt->execute([$status, $progress, $message, $id]);
}

function updateJobDuration(PDO $pdo, int $id, int $durationMs): void {
    $stmt = $pdo->prepare("UPDATE jobs SET duration_ms = ? WHERE id = ?");
    $stmt->execute([$durationMs, $id]);
}

function shellExecLogged(string $cmd): string {
    logMsg("Execute: $cmd");
    $output = shell_exec($cmd);
    logMsg("Output:\n$output");
    return (string)$output;
}

$stmt = $pdo->prepare("SELECT * FROM jobs WHERE id = ?");
$stmt->execute([$jobId]);
$job = $stmt->fetch();

if (!$job) {
    logMsg("Job not found: $jobId");
    exit('Job not found');
}

$animeId = (int)$job['anime_id'];
$episodeNumber = (string)$job['episode_number'];
$safeEpisode = sanitizeFilename($episodeNumber);
$seasonId = $job['season_id'];
$episodeTitle = $job['episode_title'] ?: ($episodeNumber . '회');
$subtitleFile = $job['subtitle_file'];
$trimSeconds = (float)($job['trim_seconds'] ?? 0);
if ($trimSeconds < 0) {
    $trimSeconds = 0;
}

$stmt = $pdo->prepare("SELECT is_hidive FROM animes WHERE id = ?");
$stmt->execute([$animeId]);
$anime = $stmt->fetch();
$isHidive = !empty($anime['is_hidive']);
$script = $isHidive ? './hidn.sh' : './crdn.sh';
$serviceName = $isHidive ? 'Hidive' : 'Crunchyroll';

logMsg("Starting job $jobId: anime=$animeId ep=$episodeNumber season=$seasonId service=$serviceName trim=$trimSeconds");
updateJob($pdo, $jobId, 'downloading', 5, "$serviceName에서 다운로드 중...");

// Download
$cmd = sprintf(
    "cd %s && %s -s %s -e %s --fileName %s 2>&1",
    escapeshellarg($downloaderDir),
    $script,
    escapeshellarg($seasonId),
    escapeshellarg($episodeNumber),
    escapeshellarg("{$seasonId}_{$safeEpisode}")
);
$output = shellExecLogged($cmd);

$mkvPath = "$videosDir/{$seasonId}_{$safeEpisode}.mkv";

if (!file_exists($mkvPath)) {
    updateJob($pdo, $jobId, 'failed', 0, '다운로드 실패: MKV 파일을 찾을 수 없습니다.');
    logMsg("MKV not found");
    exit;
}

logMsg("MKV found: $mkvPath");

// Prepare subtitle (ASS)
$assDir = "$subtitlesDir/$animeId";
if (!is_dir($assDir)) {
    mkdir($assDir, 0777, true);
}
$assPath = "$assDir/$safeEpisode.ass";
$subtitleRelativePath = "subtitles/$animeId/$safeEpisode.ass";

$hasSubtitle = false;
$sourceAssPath = null;

updateJob($pdo, $jobId, 'preparing', 10, '자막 준비 중...');

if ($subtitleFile && file_exists("$subtitlesDir/$subtitleFile")) {
    $subtitlePath = "$subtitlesDir/$subtitleFile";
    $subtitleExt = strtolower(pathinfo($subtitlePath, PATHINFO_EXTENSION));
    if ($subtitleExt === 'smi') {
        $smiFilename = basename($subtitlePath);
        $dockerCmd = sprintf(
            'docker run --rm -i -v %s:/subtitles seconv:1.0 %s ass 2>&1',
            escapeshellarg($subtitlesDir . '/'),
            escapeshellarg($smiFilename)
        );
        shellExecLogged($dockerCmd);
        $smiBasename = pathinfo($subtitlePath, PATHINFO_FILENAME);
        $seconvOutput = "$subtitlesDir/{$smiBasename}.ass";
        if (file_exists($seconvOutput)) {
            $sourceAssPath = $seconvOutput;
        }
    } else {
        copy($subtitlePath, $assPath);
        $sourceAssPath = $assPath;
    }
    @unlink($subtitlePath);
} else {
    // Extract first subtitle stream from MKV
    $extractCmd = sprintf(
        'ffmpeg -y -i %s -map 0:s:0 %s 2>&1',
        escapeshellarg($mkvPath),
        escapeshellarg($assPath)
    );
    shellExecLogged($extractCmd);
    $sourceAssPath = $assPath;
}

// Fix ruby tags for converted/extracted ASS
if ($sourceAssPath && file_exists($sourceAssPath) && filesize($sourceAssPath) > 0) {
    $fixCmd = sprintf(
        'python3 %s %s 2>&1',
        escapeshellarg($baseDir . '/ass_ruby_fix.py'),
        escapeshellarg($sourceAssPath)
    );
    shellExecLogged($fixCmd);
    $sourceBasename = pathinfo($sourceAssPath, PATHINFO_FILENAME);
    $fixedPath = "$subtitlesDir/{$sourceBasename}_fixed.ass";
    if (file_exists($fixedPath)) {
        if ($fixedPath !== $assPath) {
            @unlink($assPath);
            rename($fixedPath, $assPath);
        }
        if ($sourceAssPath !== $assPath && file_exists($sourceAssPath)) {
            @unlink($sourceAssPath);
        }
    }
}

if (file_exists($assPath) && filesize($assPath) > 0) {
    $hasSubtitle = true;
    logMsg("ASS subtitle ready: $assPath");
} else {
    logMsg("No subtitle available, will encode without burn-in");
    @unlink($assPath);
    $subtitleRelativePath = null;
}

// Get duration for progress calculation
$durationMs = 0;
$durationCmd = sprintf(
    'ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 %s 2>&1',
    escapeshellarg($mkvPath)
);
$durationOutput = trim(shellExecLogged($durationCmd));
if (is_numeric($durationOutput) && (float)$durationOutput > 0) {
    $durationMs = (float)$durationOutput * 1000;
    if ($trimSeconds > 0) {
        $trimMs = (int)round($trimSeconds * 1000);
        $durationMs = max(0, $durationMs - $trimMs);
        logMsg("Adjusted duration (after {$trimSeconds}s trim): " . round($durationMs / 1000, 2) . "s");
    }
    updateJobDuration($pdo, $jobId, (int)$durationMs);
    logMsg("Duration: " . round($durationMs / 1000, 2) . "s");
}

// Encode / burn-in
$encodeMessage = $hasSubtitle ? '자막을 영상에 입히는 중...' : 'MP4로 변환 중...';
$encodeBaseProgress = 15;
updateJob($pdo, $jobId, 'encoding', $encodeBaseProgress, $encodeMessage);
$outputPath = "$videosDir/job_{$jobId}_result.mp4";

if ($hasSubtitle) {
    $cmdParts = [
        'ffmpeg',
        '-y',
    ];
    if ($trimSeconds > 0) {
        $cmdParts[] = '-ss';
        $cmdParts[] = (string)$trimSeconds;
    }
    $cmdParts = array_merge($cmdParts, [
        '-vaapi_device', '/dev/dri/renderD128',
        '-i', $mkvPath,
        '-vf', 'ass=' . $assPath . ',format=nv12,hwupload',
        '-c:a', 'copy',
        '-sn',
        '-c:v', 'h264_vaapi',
        '-qp', '23',
        '-movflags', '+faststart',
        '-progress', 'pipe:2',
        '-nostats',
        $outputPath
    ]);
} else {
    // No subtitle: just remux to MP4 quickly
    $cmdParts = [
        'ffmpeg',
        '-y',
    ];
    if ($trimSeconds > 0) {
        $cmdParts[] = '-ss';
        $cmdParts[] = (string)$trimSeconds;
    }
    $cmdParts = array_merge($cmdParts, [
        '-i', $mkvPath,
        '-c:v', 'copy',
        '-c:a', 'copy',
        '-sn',
        '-movflags', '+faststart',
        '-progress', 'pipe:2',
        '-nostats',
        $outputPath
    ]);
}
$cmd = implode(' ', array_map('escapeshellarg', $cmdParts));
logMsg("Encode cmd: $cmd");

$descriptors = [
    0 => ['pipe', 'r'],
    1 => ['pipe', 'w'],
    2 => ['pipe', 'w'],
];
$process = proc_open($cmd, $descriptors, $pipes, $baseDir);

if (!is_resource($process)) {
    updateJob($pdo, $jobId, 'failed', 0, '인코딩 프로세스 시작 실패');
    logMsg("Failed to start ffmpeg process");
    exit;
}

fclose($pipes[0]);
$lastProgress = 0;
$lastUpdate = 0;
$buffer = '';

while (!feof($pipes[2])) {
    $chunk = fread($pipes[2], 8192);
    if ($chunk === false || $chunk === '') {
        break;
    }
    file_put_contents($logFile, $chunk, FILE_APPEND);
    $buffer .= $chunk;

    while (($pos = strpos($buffer, "\n")) !== false) {
        $line = substr($buffer, 0, $pos);
        $buffer = substr($buffer, $pos + 1);
        $line = trim($line);

        if (preg_match('/^out_time_ms=(\d+)$/', $line, $m)) {
            // ffmpeg의 out_time_ms는 이름과 달리 마이크로초 단위다
            $ms = (int)($m[1] / 1000);
            if ($durationMs > 0) {
                $range = 99 - $encodeBaseProgress;
                $pct = (int)min(99, max($encodeBaseProgress, round($ms / $durationMs * $range) + $encodeBaseProgress));
            } else {
                $pct = $lastProgress;
            }
            if ($pct !== $lastProgress && (time() - $lastUpdate >= 1)) {
                $msg = $hasSubtitle ? "자막 입히는 중... {$pct}%" : "변환 중... {$pct}%";
                updateJob($pdo, $jobId, 'encoding', $pct, $msg);
                $lastProgress = $pct;
                $lastUpdate = time();
            }
        }
    }
}

fclose($pipes[1]);
fclose($pipes[2]);
$exitCode = proc_close($process);

if ($exitCode !== 0 || !file_exists($outputPath) || filesize($outputPath) === 0) {
    updateJob($pdo, $jobId, 'failed', 0, '인코딩 실패 (exit code: ' . $exitCode . ')');
    logMsg("Encoding failed with exit code $exitCode");
    exit;
}

logMsg("Encoding completed: $outputPath");

// Move to final destination
$targetDir = "$animesDir/$animeId";
if (!is_dir($targetDir)) {
    mkdir($targetDir, 0777, true);
}
$targetPath = "$targetDir/$safeEpisode.mp4";
if (!rename($outputPath, $targetPath)) {
    updateJob($pdo, $jobId, 'failed', 0, '최종 파일 이동 실패');
    logMsg("Failed to move output to $targetPath");
    exit;
}
logMsg("Moved to: $targetPath");

// Cleanup
@unlink($mkvPath);
@unlink($outputPath);

// Update episodes table
$relativePath = "animes/$animeId/$safeEpisode.mp4";
$subFlag = $hasSubtitle ? 1 : 0;
$enSubtitleRelativePath = null;
$enSubtitlePath = "$subtitlesDir/$animeId/{$safeEpisode}_en.ass";
if (file_exists($enSubtitlePath) && filesize($enSubtitlePath) > 0) {
    $enSubtitleRelativePath = "subtitles/$animeId/{$safeEpisode}_en.ass";
}

$stmt = $pdo->prepare("SELECT id FROM episodes WHERE anime_id = ? AND episode_number = ?");
$stmt->execute([$animeId, $safeEpisode]);
$existing = $stmt->fetch();

if ($existing) {
    $stmt = $pdo->prepare("UPDATE episodes SET title = ?, file_path = ?, has_subtitle = ?, en_subtitle_file = ?, subtitle_file = ? WHERE id = ?");
    $stmt->execute([$episodeTitle, $relativePath, $subFlag, $enSubtitleRelativePath, $subtitleRelativePath, $existing['id']]);
} else {
    $stmt = $pdo->prepare("INSERT INTO episodes (anime_id, episode_number, title, file_path, has_subtitle, en_subtitle_file, subtitle_file) VALUES (?, ?, ?, ?, ?, ?, ?)");
    $stmt->execute([$animeId, $safeEpisode, $episodeTitle, $relativePath, $subFlag, $enSubtitleRelativePath, $subtitleRelativePath]);
}

updateJob($pdo, $jobId, 'completed', 100, '완료');
logMsg("Job completed");
