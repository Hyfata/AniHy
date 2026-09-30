<?php
require_once __DIR__ . '/../inc/functions.php';
require_once __DIR__ . '/../inc/chapters.php';
require_once __DIR__ . '/../inc/encoding.php';

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

// 인코딩 백엔드 설정 (inc/configuration.php, 없으면 intel/1 기본값)
$encCfg = loadEncodingConfig();
applyEncodingEnv($encCfg);

// smi2ass는 frozen Python이라 Apache의 LANG=C를 물려받으면
// non-ASCII(한글/BOM)가 든 경고 출력 중 UnicodeEncodeError로 죽는다. UTF-8 강제.
putenv('LC_ALL=C.UTF-8');
putenv('LANG=C.UTF-8');
putenv('PYTHONUTF8=1');
putenv('PYTHONIOENCODING=utf-8');

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
$episodeTitle = $job['episode_title'] ?: ($episodeNumber . '화');
$subtitleFile = $job['subtitle_file'];
$trimSeconds = (float)($job['trim_seconds'] ?? 0);
$sourceType = $job['source_type'] ?? 'download';
$sourceFile = $job['source_file'] ?? null;
if ($trimSeconds < 0) {
    $trimSeconds = 0;
}
$subtitleOffset = (float)($job['subtitle_offset'] ?? 0);
$isTest = !empty($job['is_test']);

$stmt = $pdo->prepare("SELECT is_hidive FROM animes WHERE id = ?");
$stmt->execute([$animeId]);
$anime = $stmt->fetch();
$isHidive = !empty($anime['is_hidive']);
$script = $isHidive ? './hidn.sh' : './crdn.sh';
$serviceName = $isHidive ? 'Hidive' : 'Crunchyroll';

logMsg("Starting job $jobId: anime=$animeId ep=$episodeNumber season=$seasonId source=$sourceType service=$serviceName trim=$trimSeconds sync=$subtitleOffset encoder={$encCfg['encoder']} quality={$encCfg['quality']} test=" . ($isTest ? '1' : '0'));

$stmt = $pdo->prepare("UPDATE jobs SET encoder = ? WHERE id = ?");
$stmt->execute([$encCfg['encoder'] . ($isTest ? ' (테스트)' : ''), $jobId]);

$mkvPath = "$videosDir/{$seasonId}_{$safeEpisode}.mkv";

if (($sourceType === 'upload' || $sourceType === 'server') && !empty($sourceFile)) {
    $sourcePath = $sourceType === 'server' ? $sourceFile : ($baseDir . '/' . $sourceFile);
    if (!file_exists($sourcePath)) {
        $failMsg = $sourceType === 'server' ? '서버 원본 영상을 찾을 수 없습니다.' : '업로드된 원본 영상을 찾을 수 없습니다.';
        updateJob($pdo, $jobId, 'failed', 0, $failMsg);
        logMsg("Local source not found: $sourcePath");
        exit;
    }
    $mkvPath = $sourcePath;
    $prepareMsg = $sourceType === 'server' ? '서버 파일 처리 중...' : '업로드된 영상 처리 중...';
    updateJob($pdo, $jobId, 'preparing', 10, $prepareMsg);
    logMsg("Using local source: $mkvPath");
} else {
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

    if (!file_exists($mkvPath)) {
        updateJob($pdo, $jobId, 'failed', 0, '다운로드 실패: MKV 파일을 찾을 수 없습니다.');
        logMsg("MKV not found");
        exit;
    }

    logMsg("MKV found: $mkvPath");
}

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
        // 확장자는 .smi인데 실제 내용이 ASS인 파일(잘못된 확장자)은 변환 없이 그대로 사용
        $smiHead = ltrim((string)file_get_contents($subtitlePath, false, null, 0, 64), "\xEF\xBB\xBF \t\r\n");
        if (str_starts_with($smiHead, '[Script Info]')) {
            logMsg("Subtitle labelled .smi is actually ASS, using as-is");
            $subtitleExt = 'ass';
        }
    }
    if ($subtitleExt === 'smi') {
        // 전처리: <P Class=...> 없는 SYNC 블록에 최다 클래스 부여.
        // smi2ass가 클래스 추출에 실패하면 "UNKNOWNCC"라는 가짜 제2 언어로 오인해
        // 다중 언어 모드의 출력 경로 버그(NotADirectoryError)로 크래시한다.
        $smiRaw = (string)file_get_contents($subtitlePath);
        $smiEncoding = null;
        if (str_starts_with($smiRaw, "\xFF\xFE")) {
            $smiEncoding = 'UTF-16LE';
        } elseif (str_starts_with($smiRaw, "\xFE\xFF")) {
            $smiEncoding = 'UTF-16BE';
        }
        $smiText = $smiEncoding !== null
            ? (string)iconv($smiEncoding, 'UTF-8', substr($smiRaw, 2))
            : $smiRaw;
        if (preg_match_all('/<P\s+Class\s*=\s*"?([A-Za-z0-9_]+)"?/i', $smiText, $cm) && $cm[1]) {
            $classCounts = array_count_values(array_map('strtoupper', $cm[1]));
            arsort($classCounts);
            $smiDefaultClass = (string)array_key_first($classCounts);
            $smiBlocks = preg_split('/(?=<SYNC\b)/i', $smiText);
            $smiPatched = 0;
            foreach ($smiBlocks as $bi => $block) {
                if (!preg_match('/^<SYNC\b[^>]*>/i', $block, $sm)) {
                    continue;
                }
                if (preg_match('/<P\s+Class\s*=/i', $block)) {
                    continue;
                }
                $smiBlocks[$bi] = $sm[0] . '<P Class=' . $smiDefaultClass . '>' . substr($block, strlen($sm[0]));
                $smiPatched++;
            }
            if ($smiPatched > 0) {
                $smiFixed = implode('', $smiBlocks);
                $smiOut = $smiEncoding !== null
                    ? substr($smiRaw, 0, 2) . iconv('UTF-8', $smiEncoding, $smiFixed)
                    : $smiFixed;
                file_put_contents($subtitlePath, $smiOut);
                logMsg("Patched $smiPatched SYNC block(s) without P Class as Class=$smiDefaultClass");
            }
        }
        $smiFilename = basename($subtitlePath);
        $smiBasename = pathinfo($subtitlePath, PATHINFO_FILENAME);
        $smi2assCmd = sprintf(
            'cd %s && %s %s -o %s 2>&1',
            escapeshellarg($subtitlesDir),
            escapeshellarg($baseDir . '/smi2ass/smi2ass'),
            escapeshellarg($smiFilename),
            escapeshellarg($assDir)
        );
        $smi2assLog = shellExecLogged($smi2assCmd);
        // 단일 언어면 {basename}.ass, 복수 언어면 {basename}-{LANG}.ass 생성됨.
        // 단, Traceback이 있으면 변환이 중간에 죽은 것(부분 .ass가 남을 수 있음)으로 간주.
        $cleanConvert = !str_contains($smi2assLog, 'Traceback');
        $smi2assCandidates = glob("$assDir/{$smiBasename}*.ass") ?: [];
        $smi2assOutput = null;
        foreach ($smi2assCandidates as $candidate) {
            if (str_ends_with($candidate, '-KOR.ass')) {
                $smi2assOutput = $candidate;
                break;
            }
            $smi2assOutput ??= $candidate;
        }
        if ($cleanConvert && $smi2assOutput && file_exists($smi2assOutput) && filesize($smi2assOutput) > 0) {
            foreach ($smi2assCandidates as $candidate) {
                if ($candidate !== $smi2assOutput) {
                    @unlink($candidate);
                }
            }
            $sourceAssPath = $smi2assOutput;
            @unlink($subtitlePath);
        } else {
            // 변환 실패: 원본 SMI 보존 후 job 실패. 조용한 무자막 완성 방지.
            $failedDir = "$subtitlesDir/failed";
            if (!is_dir($failedDir)) {
                mkdir($failedDir, 0777, true);
            }
            $keptPath = "$failedDir/job_{$jobId}_{$smiFilename}";
            @rename($subtitlePath, $keptPath);
            foreach ($smi2assCandidates as $candidate) {
                @unlink($candidate); // 부분 변환 산출물 제거
            }
            $failMsg = "자막 변환 실패 (SMI→ASS). 원본은 {$keptPath}에 보존됨. logs/job_{$jobId}.log의 smi2ass Traceback 확인 후 SMI를 고쳐 다시 등록하세요.";
            updateJob($pdo, $jobId, 'failed', 0, $failMsg);
            logMsg($failMsg);
            exit;
        }
    } else {
        copy($subtitlePath, $assPath);
        $sourceAssPath = $assPath;
        @unlink($subtitlePath);
    }
} elseif (file_exists($assPath) && filesize($assPath) > 0) {
    // 이전 시도에서 이미 변환된 ASS가 있으면 재사용 (재시도/재등록 시 덮어쓰지 않음)
    logMsg("Reusing existing ASS subtitle: $assPath");
} else {
    // 자막 자동 선택: 텍스트 자막(ASS 우선) 사용. PGS 같은 이미지 자막은
    // ASS로 변환 불가라 burn-in이 안 됨. 무조건 0:s:0이면 PGS가 첫 트랙인
    // 파일에서 변환 실패 → 무자막 인코딩되므로 텍스트 트랙을 찾아서 사용.
    $subProbeCmd = sprintf(
        'ffprobe -v error -select_streams s -show_entries stream=codec_name -of json %s 2>&1',
        escapeshellarg($mkvPath)
    );
    $subProbe = json_decode(shellExecLogged($subProbeCmd), true);
    $subCodecs = [];
    if (is_array($subProbe) && isset($subProbe['streams']) && is_array($subProbe['streams'])) {
        foreach (array_values($subProbe['streams']) as $s) {
            $subCodecs[] = strtolower(trim((string)($s['codec_name'] ?? '')));
        }
    }
    $bitmapCodecs = ['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvdsub', 'dvb_subtitle', 'dvb_teletext', 'xsub'];
    $subStreamIndex = null;
    foreach ($subCodecs as $i => $c) {
        if ($c === 'ass' || $c === 'ssa') {
            $subStreamIndex = $i;
            break;
        }
    }
    if ($subStreamIndex === null) {
        foreach ($subCodecs as $i => $c) {
            if (!in_array($c, $bitmapCodecs, true)) {
                $subStreamIndex = $i;
                break;
            }
        }
    }
    if ($subStreamIndex === null) {
        logMsg("No text subtitle stream found (all bitmap or none), will encode without burn-in");
    } else {
        logMsg("Subtitle stream selected: 0:s:{$subStreamIndex} (codec: " . ($subCodecs[$subStreamIndex] !== '' ? $subCodecs[$subStreamIndex] : 'unknown') . ")");
        $extractCmd = sprintf(
            'ffmpeg -y -i %s -map 0:s:%d -c:s ass %s 2>&1',
            escapeshellarg($mkvPath),
            $subStreamIndex,
            escapeshellarg($assPath)
        );
        shellExecLogged($extractCmd);
        $sourceAssPath = $assPath;
    }
}

// Move prepared ASS to final path
if ($sourceAssPath && file_exists($sourceAssPath) && filesize($sourceAssPath) > 0) {
    if ($sourceAssPath !== $assPath) {
        @unlink($assPath);
        rename($sourceAssPath, $assPath);
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

// Apply subtitle sync offset: ffmpeg로 자막만 먼저 변환해 타임스탬프를 시프트
if ($hasSubtitle && $subtitleOffset != 0.0) {
    $shiftedPath = "$assDir/{$safeEpisode}_synced.ass";
    $shiftCmd = sprintf(
        'ffmpeg -y -itsoffset %s -i %s -c:s ass %s 2>&1',
        escapeshellarg((string)$subtitleOffset),
        escapeshellarg($assPath),
        escapeshellarg($shiftedPath)
    );
    shellExecLogged($shiftCmd);
    if (file_exists($shiftedPath) && filesize($shiftedPath) > 0) {
        rename($shiftedPath, $assPath);
        logMsg("Subtitle sync offset applied via ffmpeg: {$subtitleOffset}s");
    } else {
        logMsg("WARNING: subtitle sync shift failed, using original ASS");
        @unlink($shiftedPath);
    }
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
    if ($isTest && $durationMs > 600000) {
        $durationMs = 600000;
        logMsg("Test mode: duration capped to 600s");
    }
    updateJobDuration($pdo, $jobId, (int)$durationMs);
    logMsg("Duration: " . round($durationMs / 1000, 2) . "s");
}

// Select audio stream: prefer Japanese audio, fallback to first
$audioStreamIndex = 0;
$audioProbeCmd = sprintf(
    'ffprobe -v error -select_streams a -show_entries stream=index,codec_name:stream_tags=language -of json %s 2>&1',
    escapeshellarg($mkvPath)
);
$audioProbeOutput = shellExecLogged($audioProbeCmd);
$audioProbe = json_decode($audioProbeOutput, true);
$audioCodec = '';
if (is_array($audioProbe) && !empty($audioProbe['streams']) && is_array($audioProbe['streams'])) {
    foreach (array_values($audioProbe['streams']) as $i => $stream) {
        $lang = strtolower($stream['tags']['language'] ?? '');
        if ($lang === 'jpn' || $lang === 'ja') {
            $audioStreamIndex = $i;
            break;
        }
    }
    $audioCodec = strtolower(trim((string)($audioProbe['streams'][$audioStreamIndex]['codec_name'] ?? '')));
    logMsg("Audio stream selected: 0:a:{$audioStreamIndex} (language: " . strtolower($audioProbe['streams'][$audioStreamIndex]['tags']['language'] ?? 'unknown') . ", codec: " . ($audioCodec !== '' ? $audioCodec : 'unknown') . ")");
} else {
    logMsg("WARNING: audio probe failed, falling back to first audio stream (0:a:0)");
}

// Non-AAC audio (or unknown) is transcoded to AAC 192k for browser compatibility
$audioArgs = ['-c:a', 'copy'];
if ($audioCodec !== 'aac') {
    $audioArgs = ['-c:a', 'aac', '-b:a', '192k'];
    logMsg("Audio codec is not AAC, transcoding to AAC 192k");
}

// Encode / burn-in
$encodeMessage = $hasSubtitle ? '자막을 영상에 입히는 중...' : 'MP4로 변환 중...';
$encodeBaseProgress = 15;
updateJob($pdo, $jobId, 'encoding', $encodeBaseProgress, $encodeMessage);
$outputPath = "$videosDir/job_{$jobId}_result.mp4";

// 테스트 모드: 앞 10분만 인코딩 (자막 싱크 검증용)
$testLimitArgs = $isTest ? ['-t', '600'] : [];

if ($hasSubtitle) {
    $encArgs = ffmpegEncodeArgs($encCfg, $assPath, $isTest);
    $cmdParts = [
        'ffmpeg',
        '-y',
    ];
    if ($trimSeconds > 0) {
        $cmdParts[] = '-ss';
        $cmdParts[] = (string)$trimSeconds;
    }
    $cmdParts = array_merge($cmdParts, $encArgs['pre_input'], [
        '-i', $mkvPath,
        '-map', '0:v:0',
        '-map', '0:a:' . $audioStreamIndex,
        '-vf', $encArgs['vf'],
    ], $testLimitArgs, $audioArgs, [
        '-sn',
    ], $encArgs['codec'], [
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
        '-map', '0:v:0',
        '-map', '0:a:' . $audioStreamIndex,
        '-c:v', 'copy',
    ], $testLimitArgs, $audioArgs, [
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

// Chapters sidecar for browsers without native MP4 chapter support (best-effort)
$vttPath = "$targetDir/" . chapterVttFilename($safeEpisode);
if (exportChaptersVtt($targetPath, $vttPath)) {
    logMsg("Chapters VTT written: $vttPath");
} else {
    // 챕터가 없으면(또는 추출 실패) 구 영상 기준의 stale VTT가 남지 않도록 제거
    @unlink($vttPath);
    logMsg("No chapters found, skipped VTT export");
}

// 회차 썸네일 추출 (best-effort): 전체 길이의 50% 지점, 480px 폭 JPEG
$thumbPath = "$targetDir/" . episodeThumbFilename($safeEpisode);
$thumbSeek = $durationMs > 0 ? max(1, (int)round($durationMs / 1000 * 0.5)) : 60;
$thumbCmd = sprintf(
    'ffmpeg -y -ss %d -i %s -frames:v 1 -vf scale=480:-2 -q:v 4 %s 2>&1',
    $thumbSeek,
    escapeshellarg($targetPath),
    escapeshellarg($thumbPath)
);
shellExecLogged($thumbCmd);
if (is_file($thumbPath) && filesize($thumbPath) > 0) {
    logMsg("Thumbnail written: $thumbPath");
} else {
    @unlink($thumbPath);
    logMsg("WARNING: thumbnail extraction failed");
}

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
    $stmt = $pdo->prepare("UPDATE episodes SET title = ?, file_path = ?, duration_ms = ?, has_subtitle = ?, en_subtitle_file = ?, subtitle_file = ? WHERE id = ?");
    $stmt->execute([$episodeTitle, $relativePath, (int)$durationMs, $subFlag, $enSubtitleRelativePath, $subtitleRelativePath, $existing['id']]);
} else {
    $stmt = $pdo->prepare("INSERT INTO episodes (anime_id, episode_number, title, file_path, duration_ms, has_subtitle, en_subtitle_file, subtitle_file) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    $stmt->execute([$animeId, $safeEpisode, $episodeTitle, $relativePath, (int)$durationMs, $subFlag, $enSubtitleRelativePath, $subtitleRelativePath]);
}

updateJob($pdo, $jobId, 'completed', 100, '완료');
logMsg("Job completed");
