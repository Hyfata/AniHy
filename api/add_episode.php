<?php
require_once __DIR__ . '/../inc/auth.php';
require_once __DIR__ . '/../inc/functions.php';

requireAdmin();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonResponse(false, [], '잘못된 요청입니다.');
}

$animeId = filter_input(INPUT_POST, 'anime_id', FILTER_VALIDATE_INT);
$episodeNumber = trim($_POST['episode_number'] ?? '');
$seasonId = trim($_POST['season_id'] ?? '');
$episodeTitle = trim($_POST['episode_title'] ?? '');
$trimSeconds = filter_input(INPUT_POST, 'trim_seconds', FILTER_VALIDATE_FLOAT);
if ($trimSeconds === false || $trimSeconds === null || $trimSeconds < 0) {
    $trimSeconds = 0;
}
$trimSeconds = round($trimSeconds, 3);
if (!$animeId || $episodeNumber === '') {
    jsonResponse(false, [], '필수 항목을 입력하세요.');
}

$episodeNumber = sanitizeFilename($episodeNumber);
if ($episodeNumber === '') {
    jsonResponse(false, [], '유효하지 않은 에피소드 번호입니다.');
}

// Use anime's stored season_id if not provided directly
if ($seasonId === '') {
    $stmt = $pdo->prepare("SELECT season_id FROM animes WHERE id = ?");
    $stmt->execute([$animeId]);
    $anime = $stmt->fetch();
    if ($anime && !empty($anime['season_id'])) {
        $seasonId = $anime['season_id'];
    }
}

if ($seasonId === '') {
    jsonResponse(false, [], '시즌 ID가 없습니다. 애니 정보에서 시즌 ID를 입력하세요.');
}

// Validate anime exists
$stmt = $pdo->prepare("SELECT id FROM animes WHERE id = ?");
$stmt->execute([$animeId]);
if (!$stmt->fetch()) {
    jsonResponse(false, [], '애니를 찾을 수 없습니다.');
}

// Prevent duplicate active/pending job for same anime + episode
$stmt = $pdo->prepare("SELECT id FROM jobs WHERE anime_id = ? AND episode_number = ? AND status NOT IN ('completed', 'failed')");
$stmt->execute([$animeId, $episodeNumber]);
if ($stmt->fetch()) {
    jsonResponse(false, [], '이미 대기열에 있거나 처리 중인 에피소드입니다.');
}

$subtitleFile = null;
if (isset($_FILES['subtitle']) && $_FILES['subtitle']['error'] === UPLOAD_ERR_OK) {
    $ext = strtolower(pathinfo($_FILES['subtitle']['name'], PATHINFO_EXTENSION));
    if (!allowedSubtitleExt($ext)) {
        jsonResponse(false, [], '지원하지 않는 자막 형식입니다. (ass/smi)');
    }
    $subtitleFile = uniqid('sub_') . '.' . $ext;
    $dest = __DIR__ . '/../subtitles/' . $subtitleFile;
    if (!move_uploaded_file($_FILES['subtitle']['tmp_name'], $dest)) {
        jsonResponse(false, [], '자막 파일 저장 실패');
    }
}

// Create job record
try {
    $stmt = $pdo->prepare(
        "INSERT INTO jobs (anime_id, episode_number, season_id, episode_title, subtitle_file, trim_seconds, status, progress, message)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, '대기 중')"
    );
    $stmt->execute([$animeId, $episodeNumber, $seasonId, $episodeTitle, $subtitleFile, $trimSeconds]);
    $jobId = (int)$pdo->lastInsertId();
} catch (PDOException $e) {
    $msg = $e->getMessage();
    if (str_contains($msg, 'trim_seconds') || $e->getCode() == '42S22') {
        jsonResponse(false, [], 'DB에 trim_seconds 컬럼이 없습니다. sql/migrations/001_add_trim_seconds_to_jobs.sql 마이그레이션을 실행하세요.');
    }
    jsonResponse(false, [], 'DB 오류: ' . $msg);
}

// Trigger queue manager if not already running
$lockFile = __DIR__ . '/../logs/queue.lock';
$startQueue = true;
if (file_exists($lockFile)) {
    $pid = (int)trim((string)file_get_contents($lockFile));
    if ($pid > 0 && function_exists('posix_kill') && posix_kill($pid, 0)) {
        $startQueue = false;
    }
}
if ($startQueue) {
    $queueWorker = __DIR__ . '/../worker/queue.php';
    $queueLog = __DIR__ . '/../logs/queue.log';

    // 웹 SAPI에서는 PHP_BINARY가 비어 있을 수 있으므로 PHP_BINDIR/php를 fallback으로 사용
    $phpBinary = (defined('PHP_BINARY') && PHP_BINARY !== '' && PHP_BINARY !== '-')
        ? PHP_BINARY
        : PHP_BINDIR . '/php';
    if (!file_exists($phpBinary)) {
        $phpBinary = 'php';
    }

    $cmd = sprintf(
        'nohup %s %s > %s 2>&1 &',
        escapeshellarg($phpBinary),
        escapeshellarg($queueWorker),
        escapeshellarg($queueLog)
    );
    exec($cmd);
}

jsonResponse(true, ['job_id' => $jobId, 'anime_id' => $animeId], '대기열에 추가되었습니다.');
