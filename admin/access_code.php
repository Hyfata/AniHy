<?php
require_once __DIR__ . '/../inc/auth.php';
require_once __DIR__ . '/../inc/access_auth.php';
require_once __DIR__ . '/../inc/functions.php';

requireAccessAuth();
requireAdmin();

$message = '';
$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $newCode = trim($_POST['access_code'] ?? '');

    if ($newCode === '') {
        $error = '인증번호를 입력하세요.';
    } else {
        $stmt = $pdo->prepare("INSERT INTO settings (`key`, `value`) VALUES ('access_code', ?) ON DUPLICATE KEY UPDATE `value` = ?");
        $stmt->execute([$newCode, $newCode]);
        $message = '인증번호가 변경되었습니다.';
    }
}

$currentCode = getSetting('access_code') ?: '';
?>
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>접근 인증번호 관리 - AniHy</title>
    <link rel="stylesheet" href="<?= assetUrl('css/style.css') ?>">
</head>
<body>
    <nav class="navbar">
        <div class="container">
            <a href="/anime/" class="logo">AniHy</a>
            <div class="nav-links">
                <a href="/anime/">홈</a>
                <a href="/anime/admin/logout.php">로그아웃</a>
            </div>
        </div>
    </nav>

    <main class="container">
        <div class="login-box">
            <h1>접근 인증번호 관리</h1>
            <?php if ($message): ?>
                <p style="color:var(--success,#22c55e);text-align:center;font-size:0.9rem"><?= htmlspecialchars($message) ?></p>
            <?php endif; ?>
            <?php if ($error): ?>
                <p style="color:var(--danger);text-align:center;font-size:0.9rem"><?= htmlspecialchars($error) ?></p>
            <?php endif; ?>
            <form method="POST" action="">
                <div class="form-group">
                    <label for="access_code">인증번호</label>
                    <input type="text" id="access_code" name="access_code" value="<?= htmlspecialchars($currentCode) ?>" required autofocus>
                </div>
                <button type="submit" class="btn btn-primary" style="width:100%">변경</button>
            </form>
            <p style="text-align:center;margin-top:16px;font-size:0.85rem;color:var(--text-muted)">
                인증번호를 변경하면 기존 사용자의 쿠키는 여전히 유효합니다.<br>
                완전히 차단하려면 관리자 메뉴에서 쿠키를 발급한 브라우저를 개별적으로 처리해야 합니다.
            </p>
        </div>
    </main>
</body>
</html>
