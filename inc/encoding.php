<?php
// Encoding backend config loader + ffmpeg args builder.
// DB 의존성 없음 (worker/queue.php, worker/convert.php, 웹 모두에서 사용 가능).
// 실제 값은 inc/configuration.php (gitignore, .inc 템플릿을 복사해 생성).

const ENCODING_BACKENDS = ['software', 'intel', 'radeon', 'nvidia'];

function loadEncodingConfig(): array {
    $defaults = [
        'encoder' => 'intel',
        'max_workers' => 1,
        'vaapi_device' => '/dev/dri/renderD128',
        'quality' => 23,
    ];
    $file = __DIR__ . '/configuration.php';
    if (is_file($file)) {
        $cfg = require $file;
        if (is_array($cfg)) {
            $defaults = array_merge($defaults, $cfg);
        }
    }
    if (!in_array($defaults['encoder'], ENCODING_BACKENDS, true)) {
        $defaults['encoder'] = 'intel';
    }
    $defaults['max_workers'] = max(1, (int)$defaults['max_workers']);
    $defaults['quality'] = min(51, max(0, (int)$defaults['quality']));
    $defaults['vaapi_device'] = trim((string)$defaults['vaapi_device']) !== ''
        ? (string)$defaults['vaapi_device']
        : '/dev/dri/renderD128';
    return $defaults;
}

// 백엔드별 LibVA 드라이버 Env 적용 (히스토리·전역 상태 없음, putenv만)
function applyEncodingEnv(array $cfg): void {
    if ($cfg['encoder'] === 'intel') {
        putenv('LIBVA_DRIVER_NAME=iHD');
    } elseif ($cfg['encoder'] === 'radeon') {
        putenv('LIBVA_DRIVER_NAME=radeonsi');
    } else {
        putenv('LIBVA_DRIVER_NAME'); // VA-API 미사용 백엔드: 강제값 제거
    }
}

// 자막 burn-in용 ffmpeg 인자 조각 반환.
// ['pre_input' => [...ffmpeg -i 앞...], 'input' => [mkv], 'vf' => '...', 'codec' => [...]]
function ffmpegEncodeArgs(array $cfg, string $assPath): array {
    $q = (string)$cfg['quality'];
    switch ($cfg['encoder']) {
        case 'software':
            return [
                'pre_input' => [],
                'vf' => 'ass=' . $assPath . ',format=yuv420p',
                'codec' => ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', $q],
            ];
        case 'nvidia':
            return [
                'pre_input' => [],
                'vf' => 'ass=' . $assPath . ',format=yuv420p',
                'codec' => ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', $q],
            ];
        case 'radeon':
        case 'intel':
        default:
            return [
                'pre_input' => ['-vaapi_device', $cfg['vaapi_device']],
                'vf' => 'ass=' . $assPath . ',format=nv12,hwupload',
                'codec' => ['-c:v', 'h264_vaapi', '-qp', $q],
            ];
    }
}
