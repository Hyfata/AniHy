<?php
session_start();

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin1234';

function isAdmin(): bool {
    return isset($_SESSION['admin']) && $_SESSION['admin'] === true;
}

function requireAdmin(): void {
    if (!isAdmin()) {
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['success' => false, 'message' => '관리자 권한이 필요합니다.']);
        exit;
    }
}

function loginAdmin(string $username, string $password): bool {
    if ($username === ADMIN_USERNAME && $password === ADMIN_PASSWORD) {
        $_SESSION['admin'] = true;
        return true;
    }
    return false;
}

function logoutAdmin(): void {
    unset($_SESSION['admin']);
}
