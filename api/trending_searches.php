<?php
require_once __DIR__ . '/../inc/auth.php';
require_once __DIR__ . '/../inc/access_auth.php';
require_once __DIR__ . '/../inc/functions.php';

requireAccessAuth();

// 읽기 전용이므로 세션 잠금 즉시 해제
session_write_close();

// animes와 JOIN해 현재 존재하는 작품 제목만 반환
try {
    $rows = $pdo->query(
        "SELECT a.title FROM search_hits sh
         JOIN animes a ON a.id = sh.anime_id
         ORDER BY sh.hit_count DESC, sh.last_hit_at DESC
         LIMIT 10"
    )->fetchAll();
} catch (PDOException $e) {
    // 마이그레이션 미적용 시 빈 목록
    $rows = [];
}

jsonResponse(true, ['trending' => array_column($rows, 'title')]);
