<?php
require_once __DIR__ . '/db.php';

const ACCESS_COOKIE_NAME = 'anihy_access';
const ACCESS_COOKIE_PATH = '/anime/';

function getSetting(string $key): ?string {
    global $pdo;
    $stmt = $pdo->prepare("SELECT value FROM settings WHERE `key` = ?");
    $stmt->execute([$key]);
    $row = $stmt->fetch();
    return $row['value'] ?? null;
}

function generateUuid(): string {
    $data = random_bytes(16);
    $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
    $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

function signAccessToken(string $uuid, string $secret): string {
    return hash_hmac('sha256', $uuid, $secret);
}

function issueAccessCookie(): void {
    $secret = getSetting('cookie_secret');
    if (!$secret) {
        throw new RuntimeException('cookie_secret is not configured in settings table');
    }

    $uuid = generateUuid();
    $signature = signAccessToken($uuid, $secret);
    $value = $uuid . '.' . $signature;

    $isSecure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');

    setcookie(ACCESS_COOKIE_NAME, $value, [
        'expires' => time() + 60 * 60 * 24 * 30,
        'path' => ACCESS_COOKIE_PATH,
        'domain' => '',
        'secure' => $isSecure,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    $_COOKIE[ACCESS_COOKIE_NAME] = $value;
}

function clearAccessCookie(): void {
    setcookie(ACCESS_COOKIE_NAME, '', [
        'expires' => time() - 3600,
        'path' => ACCESS_COOKIE_PATH,
        'domain' => '',
        'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    unset($_COOKIE[ACCESS_COOKIE_NAME]);
}

function validateAccessCookie(): bool {
    if (empty($_COOKIE[ACCESS_COOKIE_NAME])) {
        return false;
    }

    $parts = explode('.', $_COOKIE[ACCESS_COOKIE_NAME]);
    if (count($parts) !== 2) {
        return false;
    }

    [$uuid, $signature] = $parts;

    if (!preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i', $uuid)) {
        return false;
    }

    if (!preg_match('/^[a-f0-9]{64}$/i', $signature)) {
        return false;
    }

    $secret = getSetting('cookie_secret');
    if (!$secret) {
        return false;
    }

    return hash_equals(signAccessToken($uuid, $secret), $signature);
}

function isAccessAuthenticated(): bool {
    return validateAccessCookie();
}

function requireAccessAuth(): void {
    if (!isAccessAuthenticated()) {
        $redirect = $_SERVER['REQUEST_URI'] ?? '/anime/';
        redirect('/anime/auth_gate.php?redirect=' . urlencode($redirect));
    }
}

function verifyAccessCode(string $code): bool {
    $expected = getSetting('access_code');
    if (!$expected) {
        return false;
    }
    return hash_equals($expected, $code);
}
