<?php
require_once __DIR__ . '/../inc/auth.php';
require_once __DIR__ . '/../inc/functions.php';

requireAdmin();

// 죽은 워커 프로세스가 남긴 작업을 실패로 정리
$stmt = $pdo->query("SELECT id, worker_pid FROM jobs WHERE status NOT IN ('completed', 'failed') AND worker_pid IS NOT NULL");
foreach ($stmt->fetchAll() as $job) {
    $pid = (int)$job['worker_pid'];
    if ($pid <= 0 || !function_exists('posix_kill') || !posix_kill($pid, 0)) {
        $upd = $pdo->prepare("UPDATE jobs SET status = 'failed', progress = 0, message = '워커 프로세스가 종료되어 실패 처리되었습니다.', worker_pid = NULL, updated_at = NOW() WHERE id = ?");
        $upd->execute([$job['id']]);
    }
}

// 최근 24시간 내 작업만 대기열에 표시(과거 completed/failed 누적으로 n/m이 이상해지는 것 방지)
$recentWindow = "DATE_SUB(NOW(), INTERVAL 24 HOUR)";

$stmt = $pdo->query("
    SELECT j.id AS job_id, j.anime_id, j.episode_number, j.episode_title,
           j.status, j.progress, j.message, j.updated_at, j.worker_pid,
           a.title AS anime_title, a.season_id
    FROM jobs j
    JOIN animes a ON a.id = j.anime_id
    WHERE j.status NOT IN ('completed', 'failed')
      AND j.created_at >= $recentWindow
    ORDER BY a.id ASC, j.episode_number ASC
");
$activeJobs = $stmt->fetchAll();

$groups = [];
$animeIds = [];
foreach ($activeJobs as $job) {
    $aid = (int)$job['anime_id'];
    if (!isset($groups[$aid])) {
        $groups[$aid] = [
            'anime_id' => $aid,
            'title' => $job['anime_title'],
            'season_id' => $job['season_id'],
            'total' => 0,
            'completed' => 0,
            'episodes' => [],
        ];
        $animeIds[] = $aid;
    }
    $groups[$aid]['episodes'][] = [
        'job_id' => (int)$job['job_id'],
        'episode_number' => (string)$job['episode_number'],
        'episode_title' => $job['episode_title'] ?: ($job['episode_number'] . '회'),
        'status' => $job['status'],
        'progress' => (int)$job['progress'],
        'message' => $job['message'] ?: '',
        'updated_at' => $job['updated_at'],
        'worker_pid' => isset($job['worker_pid']) ? (int)$job['worker_pid'] : null,
    ];
}

// Fill total/completed counts for groups that have active jobs
if (!empty($animeIds)) {
    $placeholders = implode(',', array_fill(0, count($animeIds), '?'));
    $stmt = $pdo->prepare("
        SELECT anime_id,
               COUNT(*) AS total,
               SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
        FROM jobs
        WHERE anime_id IN ($placeholders)
          AND created_at >= $recentWindow
        GROUP BY anime_id
    ");
    $stmt->execute($animeIds);
    foreach ($stmt->fetchAll() as $row) {
        $aid = (int)$row['anime_id'];
        if (isset($groups[$aid])) {
            $groups[$aid]['total'] = (int)$row['total'];
            $groups[$aid]['completed'] = (int)$row['completed'];
        }
    }
}

jsonResponse(true, ['groups' => array_values($groups)]);
