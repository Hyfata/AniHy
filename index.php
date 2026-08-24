<?php
require_once __DIR__ . '/inc/auth.php';
require_once __DIR__ . '/inc/access_auth.php';
require_once __DIR__ . '/inc/functions.php';

requireAccessAuth();

$stmt = $pdo->query("SELECT * FROM animes ORDER BY created_at DESC");
$animes = $stmt->fetchAll();

$broadcastMap = fetchBroadcastMap($pdo);

$tab = ($_GET['tab'] ?? 'home') === 'quarter' ? 'quarter' : 'home';

// 분기별 애니 그룹핑 (년도/분기가 설정된 애니만, 분기가 여러 개면 각각 집계)
$quarterGroups = [];
if ($tab === 'quarter') {
    foreach ($animes as $a) {
        foreach ($broadcastMap[(int)$a['id']] ?? [] as [$y, $q]) {
            $quarterGroups[$y][$q] = ($quarterGroups[$y][$q] ?? 0) + 1;
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
                    <a href="/anime/admin/login.php">관리자 로그인</a>
                <?php endif; ?>
            </div>
        </div>
    </nav>

    <main class="container has-tabbar">
        <?php if ($tab === 'quarter'): ?>
            <div class="page-header">
                <h1 class="page-title">분기별 애니</h1>
            </div>

            <?php if (empty($quarterGroups)): ?>
                <div class="empty-state">
                    방영 년도/분기가 설정된 애니가 없습니다.
                </div>
            <?php else: ?>
                <?php foreach ($quarterGroups as $year => $quarters): ?>
                    <div class="quarter-year-section">
                        <h2 class="quarter-year-title"><?= $year ?>년</h2>
                        <div class="quarter-card-grid">
                            <?php foreach ($quarters as $q => $count): ?>
                                <a class="quarter-card" href="/anime/quarter.php?year=<?= $year ?>&quarter=<?= $q ?>">
                                    <span class="quarter-card-title"><?= $q ?>분기</span>
                                    <span class="quarter-card-count"><?= $count ?>개 작품</span>
                                </a>
                            <?php endforeach; ?>
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
            <div class="card-grid">
                <?php foreach ($animes as $anime): ?>
                    <div class="card" data-href="/anime/anime.php?aid=<?= $anime['id'] ?>">
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

        <div class="modal-overlay" id="edit-anime-modal">
            <div class="modal">
                <div class="modal-header">
                    <h2>애니 정보 수정</h2>
                    <button class="modal-close" onclick="closeModal('edit-anime-modal')">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="edit-anime-form" enctype="multipart/form-data">
                        <input type="hidden" id="edit-id" name="id">
                        <div class="form-group">
                            <label>현재 커버</label>
                            <img id="edit-cover-preview" src="" alt="" style="width:120px;border-radius:8px;">
                        </div>
                        <div class="form-group">
                            <label for="edit-title">애니 제목</label>
                            <input type="text" id="edit-title" name="title" required>
                        </div>
                        <div class="form-group">
                            <label for="edit-cover">새 커버 이미지 (변경 시에만 선택)</label>
                            <input type="file" id="edit-cover" name="cover" accept="image/*">
                        </div>
                        <div class="form-group">
                            <label for="edit-description">설명</label>
                            <textarea id="edit-description" name="description"></textarea>
                        </div>
                        <div class="form-group">
                            <label for="edit-is-hidive">서비스</label>
                            <select id="edit-is-hidive" name="is_hidive">
                                <option value="0">Crunchyroll</option>
                                <option value="1">Hidive</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <label>방영 분기</label>
                            <div class="broadcast-list" id="edit-broadcast-list"></div>
                            <button type="button" class="btn btn-secondary btn-sm add-broadcast-btn" data-target="edit-broadcast-list">분기 추가</button>
                        </div>
                        <div class="form-group">
                            <label for="edit-broadcast-day">방영 요일</label>
                            <select id="edit-broadcast-day" name="broadcast_day">
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
                            <label for="edit-download-url">애니 다운로드 주소</label>
                            <input type="url" id="edit-download-url" name="download_url" placeholder="https://...">
                        </div>
                        <div class="form-group">
                            <label for="edit-namuwiki-url">나무위키 주소</label>
                            <input type="url" id="edit-namuwiki-url" name="namuwiki_url" placeholder="https://namu.wiki/...">
                        </div>

                        <div class="form-group">
                            <label for="edit-search-keyword">시즌 검색</label>
                            <div style="display:flex;gap:8px">
                                <input type="text" id="edit-search-keyword" name="keyword" placeholder="예: one piece" style="flex:1">
                                <button type="button" id="edit-search-btn" class="btn btn-primary">검색</button>
                            </div>
                        </div>

                        <div class="form-group">
                            <label>검색 결과</label>
                            <div class="search-result" id="edit-search-result">검색 결과가 여기에 표시됩니다.</div>
                        </div>

                        <div class="form-group">
                            <label for="edit-season-id">시즌 ID</label>
                            <input type="text" id="edit-season-id" name="season_id" placeholder="예: GS0012345678">
                        </div>
                        <button type="submit" class="btn btn-primary" style="width:100%">수정</button>
                    </form>
                </div>
            </div>
        </div>
    <?php endif; ?>

    <?php include __DIR__ . '/inc/alert_modal.php'; ?>
    <script src="<?= assetUrl('js/app.js') ?>"></script>
</body>
</html>
