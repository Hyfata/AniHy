<?php
require_once __DIR__ . '/../inc/db.php';
require_once __DIR__ . '/../inc/functions.php';

if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}

$baseDir = '/var/www/html/anime';
$worker = __DIR__ . '/convert.php';
$lockFile = "$baseDir/logs/queue.lock";
$queueLog = "$baseDir/logs/queue.log";

const MAX_WORKERS = 1; // VAAPI는 순차 처리. NVIDIA GPU 추가 시 2~4로 조정.
const IDLE_EXIT_SECONDS = 30;
const LOOP_SLEEP_MS = 1500;

function logQueue(string $msg): void {
    global $queueLog;
    file_put_contents($queueLog, date('[Y-m-d H:i:s] ') . $msg . PHP_EOL, FILE_APPEND);
}

function isProcessAlive(?int $pid): bool {
    return $pid !== null && $pid > 0 && function_exists('posix_kill') && posix_kill($pid, 0);
}

function acquireLockOrExit(string $lockFile): void {
    if (file_exists($lockFile)) {
        $pid = (int)trim((string)file_get_contents($lockFile));
        if (isProcessAlive($pid)) {
            exit; // 이미 실행 중인 매니저가 있음
        }
        @unlink($lockFile);
    }
    file_put_contents($lockFile, getmypid());
}

function releaseLock(string $lockFile): void {
    @unlink($lockFile);
}

function updateJobStatus(PDO $pdo, int $id, string $status, int $progress, string $message): void {
    $stmt = $pdo->prepare("UPDATE jobs SET status = ?, progress = ?, message = ?, updated_at = NOW() WHERE id = ?");
    $stmt->execute([$status, $progress, $message, $id]);
}

function updateJobWorkerPid(PDO $pdo, int $id, ?int $pid): void {
    $stmt = $pdo->prepare("UPDATE jobs SET worker_pid = ? WHERE id = ?");
    $stmt->execute([$pid, $id]);
}

function markJobFailed(PDO $pdo, int $jobId, string $reason): void {
    updateJobStatus($pdo, $jobId, 'failed', 0, $reason);
    updateJobWorkerPid($pdo, $jobId, null);
}

function fetchPendingJobs(PDO $pdo): array {
    $stmt = $pdo->query("SELECT * FROM jobs WHERE status = 'pending' ORDER BY id ASC");
    return $stmt->fetchAll();
}

function reapWorkers(array &$running, PDO $pdo): void {
    foreach ($running as $jobId => $info) {
        $pid = $info['pid'] ?? null;
        $process = $info['process'] ?? null;
        $alive = false;

        if (is_resource($process)) {
            $status = proc_get_status($process);
            if ($status === false) {
                continue;
            }
            $alive = $status['running'];
            if (!$alive) {
                proc_close($process);
            }
        } elseif ($pid) {
            $alive = isProcessAlive($pid);
        }

        if ($alive) {
            continue;
        }

        unset($running[$jobId]);

        // convert.php가 정상 종료/실패를 DB에 기록하지 못한 경우 보정
        $stmt = $pdo->prepare("SELECT status FROM jobs WHERE id = ?");
        $stmt->execute([$jobId]);
        $job = $stmt->fetch();
        if ($job && !in_array($job['status'], ['completed', 'failed'], true)) {
            markJobFailed($pdo, $jobId, '작업 프로세스가 비정상 종료되었습니다.');
            logQueue("Job $jobId process died unexpectedly");
        } else {
            updateJobWorkerPid($pdo, $jobId, null);
            logQueue("Job $jobId finished with status " . ($job['status'] ?? 'unknown'));
        }
    }
}

function cleanupOrphanWorkers(PDO $pdo): array {
    $running = [];
    $stmt = $pdo->query("SELECT id, status, worker_pid FROM jobs WHERE status NOT IN ('completed', 'failed')");
    foreach ($stmt->fetchAll() as $job) {
        $jobId = (int)$job['id'];
        $pid = isset($job['worker_pid']) ? (int)$job['worker_pid'] : 0;

        // 아직 워커에 배정되지 않은 pending 작업은 그대로 둔다
        if ($job['status'] === 'pending') {
            continue;
        }

        if ($pid > 0 && isProcessAlive($pid)) {
            $running[$jobId] = ['process' => null, 'pid' => $pid];
            logQueue("Adopted orphan worker for job $jobId (pid $pid)");
        } else {
            markJobFailed($pdo, $jobId, '이전 매니저가 종료되어 작업을 실패로 처리했습니다.');
            logQueue("Marked orphan job $jobId as failed");
        }
    }
    return $running;
}

function getBusyKeys(array $running, PDO $pdo): array {
    if (empty($running)) {
        return [];
    }
    $ids = array_keys($running);
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $stmt = $pdo->prepare("SELECT anime_id, episode_number FROM jobs WHERE id IN ($placeholders)");
    $stmt->execute($ids);
    $keys = [];
    foreach ($stmt->fetchAll() as $row) {
        $keys[$row['anime_id'] . ':' . $row['episode_number']] = true;
    }
    return $keys;
}

acquireLockOrExit($lockFile);
register_shutdown_function(static function () use ($lockFile) {
    releaseLock($lockFile);
});

logQueue('Queue manager started (MAX_WORKERS=' . MAX_WORKERS . ')');

$running = cleanupOrphanWorkers($pdo);
$idleSince = null;

while (true) {
    reapWorkers($running, $pdo);

    $started = 0;
    $busyKeys = getBusyKeys($running, $pdo);

    while (count($running) < MAX_WORKERS) {
        $pending = fetchPendingJobs($pdo);
        if (empty($pending)) {
            break;
        }

        $candidate = null;
        foreach ($pending as $job) {
            $key = $job['anime_id'] . ':' . $job['episode_number'];
            if (isset($busyKeys[$key])) {
                continue;
            }
            $candidate = $job;
            break;
        }

        if (!$candidate) {
            break;
        }

        $jobId = (int)$candidate['id'];
        updateJobStatus($pdo, $jobId, 'downloading', 0, 'Crunchyroll에서 다운로드 중...');

        $descriptors = [
            0 => ['file', '/dev/null', 'r'],
            1 => ['file', '/dev/null', 'w'],
            2 => ['file', '/dev/null', 'w'],
        ];
        $process = proc_open([PHP_BINARY, $worker, (string)$jobId], $descriptors, $pipes, $baseDir);

        if (!is_resource($process)) {
            markJobFailed($pdo, $jobId, '워커 프로세스 시작 실패');
            logQueue("Failed to start worker for job $jobId");
            break;
        }

        $status = proc_get_status($process);
        $workerPid = $status['pid'] ?? null;
        updateJobWorkerPid($pdo, $jobId, $workerPid);

        $running[$jobId] = ['process' => $process, 'pid' => $workerPid];
        $busyKeys[$candidate['anime_id'] . ':' . $candidate['episode_number']] = true;
        $started++;
        logQueue("Started worker for job $jobId (pid $workerPid)");
    }

    if (empty($running) && $started === 0) {
        if ($idleSince === null) {
            $idleSince = time();
        } elseif (time() - $idleSince >= IDLE_EXIT_SECONDS) {
            logQueue('Idle timeout, exiting');
            break;
        }
    } else {
        $idleSince = null;
    }

    usleep(LOOP_SLEEP_MS * 1000);
}

releaseLock($lockFile);
logQueue('Queue manager stopped');
