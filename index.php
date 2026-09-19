<?php
require_once __DIR__ . '/inc/auth.php';
require_once __DIR__ . '/inc/access_auth.php';
require_once __DIR__ . '/inc/functions.php';

requireAccessAuth();

// 세션은 isAdmin() 읽기용으로만 쓰므로 잠금을 즉시 해제 (모달 iframe 등 동시 요청 블로킹 방지, $_SESSION 읽기는 유지됨)
session_write_close();

$tab = ($_GET['tab'] ?? 'home') === 'quarter' ? 'quarter' : 'home';

// 분기 탭은 집계용으로 전체가 필요, 홈 탭은 무한스크롤이라 첫 페이지만 (LIMIT+1로 다음 페이지 존재 판별)
$homePageSize = 30;
if ($tab === 'quarter') {
    $stmt = $pdo->query("SELECT * FROM animes ORDER BY created_at DESC");
    $animes = $stmt->fetchAll();
    $homeHasMore = false;
} else {
    $stmt = $pdo->query("SELECT * FROM animes ORDER BY created_at DESC LIMIT " . ($homePageSize + 1));
    $rows = $stmt->fetchAll();
    $homeHasMore = count($rows) > $homePageSize;
    $animes = array_slice($rows, 0, $homePageSize);
}

$broadcastMap = fetchBroadcastMap($pdo);

// 분기별 애니 그룹핑 (년도/분기가 설정된 애니만, 분기가 여러 개면 각각 집계)
$quarterGroups = [];
$quarterCovers = [];
$quarterMonths = [1 => '1–3월', 2 => '4–6월', 3 => '7–9월', 4 => '10–12월'];
if ($tab === 'quarter') {
    foreach ($animes as $a) {
        foreach ($broadcastMap[(int)$a['id']] ?? [] as [$y, $q]) {
            $quarterGroups[$y][$q] = ($quarterGroups[$y][$q] ?? 0) + 1;
            // PC 카드 포스터 스트립용 커버 최대 6장 ($animes는 created_at DESC라 최신순, 4장째부터 호버 슬라이드로 공개)
            if (!empty($a['cover_image']) && count($quarterCovers[$y][$q] ?? []) < 6) {
                $quarterCovers[$y][$q][] = $a['cover_image'];
            }
        }
    }
    krsort($quarterGroups);
    foreach ($quarterGroups as &$quarters) {
        ksort($quarters);
    }
    unset($quarters);
}
?>
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AniHy</title>
    <link rel="stylesheet" href="<?= assetUrl('css/style.css') ?>">
</head>
<body>
    <nav class="navbar">
        <div class="container">
            <a href="/anime/" class="logo">AniHy</a>
            <div class="nav-links">
                <?php if (isAdmin()): ?>
                    <button class="btn btn-primary btn-sm" onclick="openModal('add-anime-modal')">애니 추가</button>
                    <button class="btn btn-sm" onclick="openQueueModal()">대기열</button>
                <?php else: ?>
                    <a href="/anime/admin/login.php?redirect=<?= urlencode($_SERVER['REQUEST_URI'] ?? '/anime/') ?>">관리자 로그인</a>
                <?php endif; ?>
            </div>
        </div>
    </nav>

    <main class="container has-tabbar<?= $tab === 'quarter' ? ' quarter-index' : ' wide' ?>">
        <?php if ($tab === 'quarter'): ?>
            <?php
            $archiveYears = array_keys($quarterGroups);
            $archiveTotal = 0;
            foreach ($animes as $a) {
                if (!empty($broadcastMap[(int)$a['id']])) $archiveTotal++;
            }
            $nowY = (int)date('Y');
            $nowQ = (int)ceil(((int)date('n')) / 3);
            ?>
            <div class="page-header">
                <div>
                    <h1 class="page-title">분기별 애니</h1>
                    <?php if (!empty($archiveYears)): ?>
                        <p class="page-subtitle"><?= min($archiveYears) ?>–<?= max($archiveYears) ?> · 총 <?= $archiveTotal ?>개 작품</p>
                    <?php endif; ?>
                </div>
            </div>

            <?php if (empty($quarterGroups)): ?>
                <div class="empty-state">
                    방영 년도/분기가 설정된 애니가 없습니다.
                </div>
            <?php else: ?>
                <?php foreach ($quarterGroups as $year => $quarters): ?>
                    <?php $yearTotal = array_sum($quarters); ?>
                    <div class="quarter-year-section">
                        <div class="quarter-year-head">
                            <h2 class="quarter-year-title"><?= $year ?><span>년</span></h2>
                            <span class="quarter-year-total"><?= $yearTotal ?>개 작품</span>
                        </div>
                        <div class="quarter-card-grid">
                            <?php for ($q = 1; $q <= 4; $q++): ?>
                                <?php if (isset($quarters[$q])): ?>
                                    <a class="quarter-card<?= ($year === $nowY && $q === $nowQ) ? ' current' : '' ?>" href="/anime/quarter.php?year=<?= $year ?>&quarter=<?= $q ?>">
                                        <?php if (!empty($quarterCovers[$year][$q])): ?>
                                            <span class="quarter-card-glow" aria-hidden="true">
                                                <?php foreach (array_slice($quarterCovers[$year][$q], 0, 3) as $cover): ?>
                                                    <img src="<?= coverUrl($cover) ?>" alt="" loading="lazy">
                                                <?php endforeach; ?>
                                            </span>
                                        <?php endif; ?>
                                        <span class="quarter-card-text">
                                            <span class="quarter-card-title"><?= $q ?>분기<?php if ($year === $nowY && $q === $nowQ): ?> <span class="quarter-now" title="이번 분기">이번 분기</span><?php endif; ?></span>
                                            <span class="quarter-card-months"><?= $quarterMonths[$q] ?></span>
                                            <span class="quarter-card-count"><span class="quarter-card-num"><?= $quarters[$q] ?></span>개 작품</span>
                                            <?php if (!empty($quarterCovers[$year][$q])): ?>
                                                <?php $coverCount = count($quarterCovers[$year][$q]); ?>
                                                <span class="quarter-card-thumbs" aria-hidden="true" style="--x: <?= max(0, $coverCount - 3) ?>">
                                                    <span class="quarter-card-thumbs-track">
                                                        <?php foreach ($quarterCovers[$year][$q] as $i => $cover): ?>
                                                            <span class="quarter-card-thumb">
                                                                <img src="<?= coverUrl($cover) ?>" alt="" loading="lazy">
                                                                <?php if ($i === 5 && $quarters[$q] > 6): ?>
                                                                    <span class="quarter-card-thumb-more">+<?= $quarters[$q] - 6 ?></span>
                                                                <?php endif; ?>
                                                            </span>
                                                        <?php endforeach; ?>
                                                    </span>
                                                </span>
                                            <?php endif; ?>
                                        </span>
                                        <span class="quarter-card-arrow" aria-hidden="true">→</span>
                                    </a>
                                <?php else: ?>
                                    <span class="quarter-card empty" aria-hidden="true">
                                        <span class="quarter-card-text">
                                            <span class="quarter-card-title"><?= $q ?>분기</span>
                                            <span class="quarter-card-months"><?= $quarterMonths[$q] ?></span>
                                            <span class="quarter-card-count">작품 없음</span>
                                        </span>
                                    </span>
                                <?php endif; ?>
                            <?php endfor; ?>
                        </div>
                    </div>
                <?php endforeach; ?>
            <?php endif; ?>
        <?php else: ?>
        <div class="page-header">
            <h1 class="page-title">전체 애니</h1>
        </div>

        <?php if (empty($animes)): ?>
            <div class="empty-state">
                등록된 애니가 없습니다. 관리자 로그인 후 추가해 보세요.
            </div>
        <?php else: ?>
            <div class="card-grid" id="home-card-grid" data-page-size="<?= $homePageSize ?>" data-has-more="<?= $homeHasMore ? '1' : '0' ?>">
                <?php foreach ($animes as $anime): ?>
                    <div class="card" data-aid="<?= $anime['id'] ?>" data-href="/anime/anime.php?aid=<?= $anime['id'] ?>">
                        <?php if (isAdmin()): ?>
                            <div class="card-actions">
                                <button class="btn btn-sm card-edit edit-anime-btn"
                                        data-id="<?= $anime['id'] ?>"
                                        data-title="<?= htmlspecialchars($anime['title'], ENT_QUOTES) ?>"
                                        data-description="<?= htmlspecialchars($anime['description'] ?? '', ENT_QUOTES) ?>"
                                        data-season-id="<?= htmlspecialchars($anime['season_id'] ?? '', ENT_QUOTES) ?>"
                                        data-is-hidive="<?= !empty($anime['is_hidive']) ? '1' : '0' ?>"
                                        data-broadcasts="<?= htmlspecialchars(json_encode($broadcastMap[(int)$anime['id']] ?? []), ENT_QUOTES) ?>"
                                        data-day="<?= htmlspecialchars($anime['broadcast_day'] ?? '', ENT_QUOTES) ?>"
                                        data-download-url="<?= htmlspecialchars($anime['download_url'] ?? '', ENT_QUOTES) ?>"
                                        data-namuwiki-url="<?= htmlspecialchars($anime['namuwiki_url'] ?? '', ENT_QUOTES) ?>"
                                        data-cover="<?= coverUrl($anime['cover_image']) ?>"
                                        title="수정">✎</button>
                                <button class="btn btn-danger btn-sm delete-anime-btn" data-id="<?= $anime['id'] ?>" title="삭제">×</button>
                            </div>
                        <?php endif; ?>
                        <div class="card-poster">
                            <img src="<?= coverUrl($anime['cover_image']) ?>" alt="<?= htmlspecialchars($anime['title']) ?>" loading="lazy">
                        </div>
                        <div class="card-body">
                            <h3 class="card-title"><?= htmlspecialchars($anime['title']) ?></h3>
                        </div>
                    </div>
                <?php endforeach; ?>
            </div>
            <?php if ($homeHasMore): ?>
                <div class="home-grid-loader hidden" id="home-grid-loader">
                    <div class="home-grid-spinner"></div>
                </div>
                <div id="home-grid-sentinel"></div>
                <div class="home-grid-end hidden" id="home-grid-end"></div>
            <?php endif; ?>
        <?php endif; ?>
        <?php endif; ?>
    </main>

    <nav class="bottom-tabbar">
        <a href="/anime/" class="tab-item <?= $tab === 'home' ? 'active' : '' ?>">
            <span class="tab-pill">
                <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-6h6v6"/></svg>
                <span>홈</span>
            </span>
        </a>
        <a href="/anime/?tab=quarter" class="tab-item <?= $tab === 'quarter' ? 'active' : '' ?>">
            <span class="tab-pill">
                <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18"/><path d="M8 2v4M16 2v4"/></svg>
                <span>분기별 애니</span>
            </span>
        </a>
    </nav>

    <?php if (isAdmin()): ?>
        <?php include __DIR__ . '/inc/queue_modal.php'; ?>
        <?php include __DIR__ . '/inc/settings_float.php'; ?>

        <div class="modal-overlay" id="add-anime-modal">
            <div class="modal">
                <div class="modal-header">
                    <h2>애니 추가</h2>
                    <button class="modal-close" onclick="closeModal('add-anime-modal')">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="anime-form" enctype="multipart/form-data">
                        <div class="form-group">
                            <label for="title">애니 제목</label>
                            <input type="text" id="title" name="title" required>
                        </div>
                        <div class="form-group">
                            <label for="cover">커버 이미지 (세로 포스터 권장)</label>
                            <input type="file" id="cover" name="cover" accept="image/*" required>
                        </div>
                        <div class="form-group">
                            <label for="description">설명</label>
                            <textarea id="description" name="description"></textarea>
                        </div>
                        <div class="form-group">
                            <label for="is_hidive">서비스</label>
                            <select id="is_hidive" name="is_hidive">
                                <option value="0">Crunchyroll</option>
                                <option value="1">Hidive</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <label>방영 분기</label>
                            <div class="broadcast-list" id="broadcast-list"></div>
                            <button type="button" class="btn btn-secondary btn-sm add-broadcast-btn" data-target="broadcast-list">분기 추가</button>
                        </div>
                        <div class="form-group">
                            <label for="broadcast_day">방영 요일</label>
                            <select id="broadcast_day" name="broadcast_day">
                                <option value="">선택 안 함</option>
                                <option>월</option>
                                <option>화</option>
                                <option>수</option>
                                <option>목</option>
                                <option>금</option>
                                <option>토</option>
                                <option>일</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="download_url">애니 다운로드 주소</label>
                            <input type="url" id="download_url" name="download_url" placeholder="https://...">
                        </div>
                        <div class="form-group">
                            <label for="namuwiki_url">나무위키 주소</label>
                            <input type="url" id="namuwiki_url" name="namuwiki_url" placeholder="https://namu.wiki/...">
                        </div>

                        <div class="form-group">
                            <label for="search-keyword">시즌 검색</label>
                            <div style="display:flex;gap:8px">
                                <input type="text" id="search-keyword" name="keyword" placeholder="예: one piece" style="flex:1">
                                <button type="button" id="search-btn" class="btn btn-primary">검색</button>
                            </div>
                        </div>

                        <div class="form-group">
                            <label>검색 결과</label>
                            <div class="search-result" id="search-result">검색 결과가 여기에 표시됩니다.</div>
                        </div>

                        <div class="form-group">
                            <label for="season_id">시즌 ID</label>
                            <input type="text" id="season_id" name="season_id" placeholder="예: GS0012345678">
                        </div>
                        <button type="submit" class="btn btn-primary" style="width:100%">추가</button>
                    </form>
                </div>
            </div>
        </div>

        <?php include __DIR__ . '/inc/edit_anime_modal.php'; ?>

    <?php endif; ?>

    <?php include __DIR__ . '/inc/anime_modal.php'; ?>
    <?php include __DIR__ . '/inc/alert_modal.php'; ?>
    <script src="<?= assetUrl('js/app.js') ?>"></script>
</body>
</html>
