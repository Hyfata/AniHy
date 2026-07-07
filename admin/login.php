<?php
require_once __DIR__ . '/../inc/auth.php';
require_once __DIR__ . '/../inc/access_auth.php';
require_once __DIR__ . '/../inc/functions.php';

requireAccessAuth();

$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = trim($_POST['username'] ?? '');
    $password = trim($_POST['password'] ?? '');

    if (loginAdmin($username, $password)) {
        redirect('/anime/');
    } else {
        $error = '아이디 또는 비밀번호가 올바르지 않습니다.';
    }
}
?>
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>관리자 로그인 - AniHy</title>
    <link rel="stylesheet" href="<?= assetUrl('css/style.css') ?>">
</head>
<body>
    <main class="container">
        <div class="login-box">
            <h1>관리자 로그인</h1>
            <?php if ($error): ?>
                <p style="color:var(--danger);text-align:center;font-size:0.9rem"><?= htmlspecialchars($error) ?></p>
            <?php endif; ?>
            <form method="POST" action="">
                <div class="form-group">
                    <label for="username">아이디</label>
                    <input type="text" id="username" name="username" required autofocus>
                </div>
                <div class="form-group">
                    <label for="password">비밀번호</label>
                    <input type="password" id="password" name="password" required>
                </div>
                <button type="submit" class="btn btn-primary" style="width:100%">로그인</button>
            </form>
            <p style="text-align:center;margin-top:16px;font-size:0.85rem;color:var(--text-muted)">
                <a href="/anime/">홈으로 돌아가기</a>
            </p>
        </div>
    </main>
</body>
</html>
