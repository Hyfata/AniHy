<?php
require_once __DIR__ . '/inc/access_auth.php';
require_once __DIR__ . '/inc/functions.php';

$redirect = '/anime/';
if (!empty($_COOKIE['anihy_redirect'])) {
    $decoded = urldecode($_COOKIE['anihy_redirect']);
    if (str_starts_with($decoded, '/anime/')) {
        $redirect = $decoded;
    }
    // Consume the redirect cookie immediately
    setcookie('anihy_redirect', '', [
        'expires' => time() - 3600,
        'path' => '/anime/',
        'domain' => $_SERVER['HTTP_HOST'] ?? '',
        'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

if (isAccessAuthenticated()) {
    redirect($redirect);
}

$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $code = trim($_POST['code'] ?? '');

    if (verifyAccessCode($code)) {
        issueAccessCookie();
        header("Location: $redirect", true, 303);
        exit;
    } else {
        usleep(random_int(100000, 300000));
        $error = '인증번호가 올바르지 않습니다.';
    }
}
?>
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>접근 인증 - AniHy</title>
    <style>
        * { box-sizing: border-box; }
        body {
            margin: 0;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #0f0f13;
            color: #e8e8f0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        }
        .gate-box {
            width: 100%;
            max-width: 360px;
            padding: 32px;
            background: #1a1a23;
            border: 1px solid #2a2a35;
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        }
        .gate-box h1 {
            margin: 0 0 8px;
            font-size: 1.5rem;
            text-align: center;
        }
        .gate-box p {
            margin: 0 0 24px;
            text-align: center;
            color: #9ca3af;
            font-size: 0.9rem;
        }
        .form-group {
            margin-bottom: 16px;
        }
        label {
            display: block;
            margin-bottom: 6px;
            font-size: 0.85rem;
            color: #b0b0c0;
        }
        input[type="text"] {
            width: 100%;
            padding: 12px 14px;
            background: #0f0f13;
            border: 1px solid #2a2a35;
            border-radius: 8px;
            color: #e8e8f0;
            font-size: 1rem;
            outline: none;
        }
        input[type="text"]:focus {
            border-color: #6366f1;
        }
        button {
            width: 100%;
            padding: 12px;
            background: #6366f1;
            border: none;
            border-radius: 8px;
            color: #fff;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
        }
        button:hover { background: #4f46e5; }
        .error {
            margin-bottom: 16px;
            padding: 10px 12px;
            background: rgba(239,68,68,0.15);
            border: 1px solid rgba(239,68,68,0.3);
            border-radius: 8px;
            color: #fca5a5;
            font-size: 0.85rem;
            text-align: center;
        }
    </style>
</head>
<body>
    <main class="gate-box">
        <h1>AniHy</h1>
        <p>인증번호를 입력해주세요.</p>
        <?php if ($error): ?>
            <div class="error"><?= htmlspecialchars($error) ?></div>
        <?php endif; ?>
        <form method="POST" action="">
            <input type="hidden" name="redirect" value="<?= htmlspecialchars($redirect) ?>">
            <div class="form-group">
                <label for="code">인증번호</label>
                <input type="text" id="code" name="code" required autofocus autocomplete="off" inputmode="numeric">
            </div>
            <button type="submit">확인</button>
        </form>
    </main>
</body>
</html>
