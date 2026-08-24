<?php
require_once __DIR__ . '/db.php';

function baseUrl(): string {
    $protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    return $protocol . '://' . $_SERVER['HTTP_HOST'] . '/anime';
}

function assetUrl(string $path): string {
    return '/anime/assets/' . ltrim($path, '/') . '?v=92';
}

function coverUrl(string $filename): string {
    return '/anime/covers/' . $filename;
}

function subtitleUrl(string $path): string {
    return '/anime/' . ltrim($path, '/');
}

function animeVideoUrl(int $animeId, string $episodeNumber): string {
    return "/anime/animes/$animeId/" . rawurlencode($episodeNumber) . ".mp4";
}

function redirect(string $url): void {
    header("Location: $url");
    exit;
}

function jsonResponse(bool $success, array $data = [], string $message = ''): void {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array_merge(['success' => $success, 'message' => $message], $data));
    exit;
}

function sanitizeFilename(string $filename): string {
    return preg_replace('/[^a-zA-Z0-9._-]/', '_', $filename);
}

// 바이트 크기를 사람이 읽기 좋은 문자열로 변환
function formatBytes(int|float $bytes): string {
    $units = ['B', 'KB', 'MB', 'GB', 'TB'];
    $bytes = max(0, (float)$bytes);
    $i = 0;
    while ($bytes >= 1024 && $i < count($units) - 1) {
        $bytes /= 1024;
        $i++;
    }
    return ($i === 0 ? (string)(int)$bytes : number_format($bytes, 1)) . ' ' . $units[$i];
}

function allowedImageExt(string $ext): bool {
    return in_array(strtolower($ext), ['jpg', 'jpeg', 'png', 'webp', 'gif'], true);
}

function allowedSubtitleExt(string $ext): bool {
    return in_array(strtolower($ext), ['ass', 'smi'], true);
}

function allowedVideoExt(string $ext): bool {
    return in_array(strtolower($ext), ['mkv', 'mp4', 'mov', 'avi', 'webm'], true);
}

// POST된 방영 년도/분기 배열을 검증·중복 제거·정렬해 [[year, quarter], ...]로 반환
function parseBroadcastPairs(array $years, array $quarters): array {
    $pairs = [];
    $count = max(count($years), count($quarters));
    for ($i = 0; $i < $count; $i++) {
        $y = filter_var($years[$i] ?? null, FILTER_VALIDATE_INT);
        $q = filter_var($quarters[$i] ?? null, FILTER_VALIDATE_INT);
        if ($y === false || $y < 1900 || $y > 2100) continue;
        if (!in_array($q, [1, 2, 3, 4], true)) continue;
        $pairs[$y . '-' . $q] = [$y, $q];
    }
    $pairs = array_values($pairs);
    usort($pairs, fn($a, $b) => ($a[0] <=> $b[0]) ?: ($a[1] <=> $b[1]));
    return $pairs;
}

// anime_broadcasts를 교체 저장하고, 하위 호환용 animes.broadcast_year/quarter는 첫 번째 분기로 동기화
function saveBroadcastPairs(PDO $pdo, int $animeId, array $pairs): void {
    $pdo->prepare("DELETE FROM anime_broadcasts WHERE anime_id = ?")->execute([$animeId]);
    $stmt = $pdo->prepare("INSERT INTO anime_broadcasts (anime_id, broadcast_year, broadcast_quarter) VALUES (?, ?, ?)");
    foreach ($pairs as [$y, $q]) {
        $stmt->execute([$animeId, $y, $q]);
    }
    $first = $pairs[0] ?? [null, null];
    $pdo->prepare("UPDATE animes SET broadcast_year = ?, broadcast_quarter = ? WHERE id = ?")
        ->execute([$first[0], $first[1], $animeId]);
}

// 애니별 방영 분기 목록 맵: [anime_id => [[year, quarter], ...]]
function fetchBroadcastMap(PDO $pdo): array {
    $map = [];
    $rows = $pdo->query("SELECT anime_id, broadcast_year, broadcast_quarter FROM anime_broadcasts ORDER BY broadcast_year, broadcast_quarter");
    foreach ($rows as $row) {
        $map[(int)$row['anime_id']][] = [(int)$row['broadcast_year'], (int)$row['broadcast_quarter']];
    }
    return $map;
}

