<?php
require_once __DIR__ . '/db.php';

function baseUrl(): string {
    $protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    return $protocol . '://' . $_SERVER['HTTP_HOST'] . '/anime';
}

function assetUrl(string $path): string {
    return '/anime/assets/' . ltrim($path, '/') . '?v=8';
}

function coverUrl(string $filename): string {
    return '/anime/covers/' . $filename;
}

function subtitleUrl(string $path): string {
    return '/anime/' . ltrim($path, '/');
}

function animeVideoUrl(int $animeId, int $episodeNumber): string {
    return "/anime/animes/$animeId/$episodeNumber.mp4";
}

function redirect(string $url): void {
    header("Location: $url");
    exit;
}

function jsonResponse(bool $success, array $data = [], string $message = ''): void {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array_merge(['success' => $success, 'message' => $message], $data));
    exit;
}

function sanitizeFilename(string $filename): string {
    return preg_replace('/[^a-zA-Z0-9._-]/', '_', $filename);
}

function allowedImageExt(string $ext): bool {
    return in_array(strtolower($ext), ['jpg', 'jpeg', 'png', 'webp', 'gif'], true);
}

function allowedSubtitleExt(string $ext): bool {
    return in_array(strtolower($ext), ['ass', 'smi'], true);
}
