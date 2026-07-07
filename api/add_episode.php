<?php
require_once __DIR__ . '/../inc/auth.php';
require_once __DIR__ . '/../inc/functions.php';

requireAdmin();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonResponse(false, [], '잘못된 요청입니다.');
}

$animeId = filter_input(INPUT_POST, 'anime_id', FILTER_VALIDATE_INT);
$episodeNumber = filter_input(INPUT_POST, 'episode_number', FILTER_VALIDATE_INT);
$seasonId = trim($_POST['season_id'] ?? '');
$episodeTitle = trim($_POST['episode_title'] ?? '');
if (!$animeId || !$episodeNumber) {
    jsonResponse(false, [], '필수 항목을 입력하세요.');
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
$stmt = $pdo->prepare(
    "INSERT INTO jobs (anime_id, episode_number, season_id, episode_title, subtitle_file, status, progress, message)
     VALUES (?, ?, ?, ?, ?, 'pending', 0, '대기 중')"
);
$stmt->execute([$animeId, $episodeNumber, $seasonId, $episodeTitle, $subtitleFile]);
$jobId = (int)$pdo->lastInsertId();

// Start background worker
$worker = __DIR__ . '/../worker/convert.php';
$logFile = __DIR__ . '/../logs/job_' . $jobId . '.log';
$cmd = sprintf(
    'nohup php %s %d > %s 2>&1 &',
    escapeshellarg($worker),
    $jobId,
    escapeshellarg($logFile)
);
exec($cmd);

jsonResponse(true, ['job_id' => $jobId, 'anime_id' => $animeId], '작업이 시작되었습니다.');
