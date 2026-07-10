<?php
require_once __DIR__ . '/inc/auth.php';
require_once __DIR__ . '/inc/access_auth.php';
require_once __DIR__ . '/inc/functions.php';

requireAccessAuth();

$stmt = $pdo->query("SELECT * FROM animes ORDER BY created_at DESC");
$animes = $stmt->fetchAll();
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

    <main class="container">
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
                    <div class="card" onclick="location.href='/anime/anime.php?aid=<?= $anime['id'] ?>'">
                        <?php if (isAdmin()): ?>
                            <div class="card-actions">
                                <button class="btn btn-sm card-edit edit-anime-btn"
                                        data-id="<?= $anime['id'] ?>"
                                        data-title="<?= htmlspecialchars($anime['title'], ENT_QUOTES) ?>"
                                        data-description="<?= htmlspecialchars($anime['description'] ?? '', ENT_QUOTES) ?>"
                                        data-season-id="<?= htmlspecialchars($anime['season_id'] ?? '', ENT_QUOTES) ?>"
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
    </main>

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
                            <label for="search-keyword">Crunchyroll 시즌 검색</label>
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
                            <label for="season_id">Crunchyroll 시즌 ID</label>
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
                            <label for="edit-search-keyword">Crunchyroll 시즌 검색</label>
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
                            <label for="edit-season-id">Crunchyroll 시즌 ID</label>
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
