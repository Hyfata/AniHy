<?php
require_once __DIR__ . '/../inc/auth.php';
require_once __DIR__ . '/../inc/access_auth.php';
require_once __DIR__ . '/../inc/functions.php';
require_once __DIR__ . '/../inc/romanize.php';

requireAccessAuth();

// 읽기 전용이므로 세션 잠금 즉시 해제
session_write_close();

// 웹 PHP에 mbstring이 없으므로 바이트/regex 기반으로 길이 제한
$query = trim((string)($_GET['q'] ?? ''));
if (strlen($query) > 300) {
    preg_match_all('/./us', $query, $m);
    $query = implode('', array_slice($m[0], 0, 100));
}
if ($query === '') {
    jsonResponse(false, [], '검색어를 입력하세요.');
}

$limit = 30;

// 관련도 순: 정확 일치 > 접두사 일치 > 부분 일치, 동률이면 매칭 위치 빠른 순 → 제목 짧은 순
$stmt = $pdo->prepare(
    "SELECT id, title, cover_image FROM animes
     WHERE title LIKE :q
     ORDER BY
         CASE WHEN title = :exact THEN 0 WHEN title LIKE :prefix THEN 1 ELSE 2 END,
         LOCATE(:needle, title),
         LENGTH(title),
         title
     LIMIT " . ($limit + 1)
);
$stmt->execute([
    ':q' => '%' . $query . '%',
    ':exact' => $query,
    ':prefix' => $query . '%',
    ':needle' => $query,
]);
$rows = $stmt->fetchAll();
$hasMore = count($rows) > $limit;
$rows = array_slice($rows, 0, $limit);

// 한글 검색어는 로마자 발음 근사 매칭을 추가 (예: "스파이" → "Spy x Family"). LIKE 결과 뒤에 붙임
$hasHangul = preg_match('/[\x{AC00}-\x{D7A3}]/u', $query) === 1;
if ($hasHangul) {
    $variants = searchQueryVariants($query);
    if ($variants) {
        $likeIds = array_map(fn($r) => (int)$r['id'], $rows);
        $scored = [];
        foreach ($pdo->query("SELECT id, title, cover_image FROM animes") as $a) {
            if (in_array((int)$a['id'], $likeIds, true)) continue;
            $score = phoneticMatchScore($variants, normalizeSearchText($a['title']));
            if ($score > 0.0) $scored[] = ['row' => $a, 'score' => $score];
        }
        usort($scored, fn($x, $y) => $y['score'] <=> $x['score']);
        foreach (array_slice($scored, 0, $limit) as $s) $rows[] = $s['row'];
    }
}

// 인기 검색어 기록: 상위 1건의 anime_id만 UPSERT (search_hits 테이블 필요)
if ($rows) {
    try {
        $pdo->prepare(
            "INSERT INTO search_hits (anime_id, hit_count, last_hit_at) VALUES (?, 1, NOW())
             ON DUPLICATE KEY UPDATE hit_count = hit_count + 1, last_hit_at = NOW()"
        )->execute([(int)$rows[0]['id']]);
    } catch (PDOException $e) {
        // 마이그레이션 미적용 등 기록 실패는 검색 자체를 막지 않음
    }
}

$items = [];
foreach ($rows as $a) {
    $id = (int)$a['id'];
    $items[] = [
        'id' => $id,
        'title' => $a['title'],
        'cover' => coverUrl($a['cover_image']),
        'href' => '/anime/anime.php?aid=' . $id,
    ];
}

jsonResponse(true, [
    'animes' => $items,
    'has_more' => $hasMore,
    'total' => count($items),
]);
