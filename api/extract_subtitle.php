<?php
require_once __DIR__ . '/../inc/auth.php';
require_once __DIR__ . '/../inc/functions.php';

requireAdmin();

$videoPath = isset($_GET['path']) ? trim((string)$_GET['path']) : '';
$action = isset($_GET['action']) ? trim((string)$_GET['action']) : 'download';

if ($videoPath === '') {
    jsonResponse(false, [], '영상 경로가 필요합니다.');
}

// transmission 다운로드 루트 아래의 파일만 허용
$root = '/var/lib/transmission-daemon/downloads';
$rootReal = realpath($root);
$realPath = realpath($videoPath);

if ($rootReal === false || $realPath === false || strpos($realPath, $rootReal . DIRECTORY_SEPARATOR) !== 0) {
    jsonResponse(false, [], '허용되지 않는 파일 경로입니다.');
}

if (!is_file($realPath)) {
    jsonResponse(false, [], '파일을 찾을 수 없습니다.');
}

// mbstring 없이 동작하는 UTF-8 안전 자르기 (Apache PHP에 mbstring 미설치)
function utf8Truncate(string $s, int $maxChars, string $ellipsis = '…'): string {
    $chars = preg_split('//u', $s, -1, PREG_SPLIT_NO_EMPTY);
    if ($chars === false) return substr($s, 0, $maxChars * 4);
    if (count($chars) <= $maxChars) return $s;
    return implode('', array_slice($chars, 0, $maxChars)) . $ellipsis;
}

// 코덱별 내보내기 방식: 텍스트는 ASS로 변환, 비트맵(PGS 등)은 변환 불가라 원본 복사.
// ffmpeg는 bitmap→text 변환을 지원하지 않음
// ("Subtitle encoding currently only possible from text to text or bitmap to bitmap")
function subtitleExportFormat(string $codec): array {
    $codec = strtolower($codec);
    if ($codec === 'hdmv_pgs_subtitle') {
        return ['kind' => 'bitmap', 'format' => 'sup', 'ext' => 'sup'];
    }
    $bitmapCopy = ['dvd_subtitle', 'dvdsub', 'dvb_subtitle', 'dvb_teletext', 'xsub'];
    if (in_array($codec, $bitmapCopy, true)) {
        return ['kind' => 'bitmap', 'format' => 'mks', 'ext' => 'mks'];
    }
    return ['kind' => 'text', 'format' => 'ass', 'ext' => 'ass'];
}

// 자막 스트림 목록 조회 (ffprobe JSON)
function probeSubtitleStreams(string $realPath): array {
    $probeCmd = sprintf(
        'ffprobe -v error -select_streams s -show_entries stream=index,codec_name:stream_tags=language,title -of json %s 2>&1',
        escapeshellarg($realPath)
    );
    $raw = (string)shell_exec($probeCmd);
    $data = json_decode($raw, true);
    $streams = [];
    if (is_array($data) && isset($data['streams']) && is_array($data['streams'])) {
        foreach (array_values($data['streams']) as $i => $s) {
            $tags = (isset($s['tags']) && is_array($s['tags'])) ? $s['tags'] : [];
            $lang = isset($tags['language']) ? trim((string)$tags['language']) : '';
            $title = isset($tags['title']) ? trim((string)$tags['title']) : '';
            $codec = isset($s['codec_name']) ? trim((string)$s['codec_name']) : 'unknown';
            if ($codec === '') $codec = 'unknown';
            $fmt = subtitleExportFormat($codec);
            $label = '#' . ($i + 1) . ' (' . $codec . ($fmt['kind'] === 'bitmap' ? ', 이미지' : '') . ')';
            if ($lang !== '') $label .= ' [' . $lang . ']';
            if ($title !== '') $label .= ' ' . utf8Truncate($title, 40);
            $streams[] = [
                'index' => $i,
                'stream_index' => isset($s['index']) ? (int)$s['index'] : $i,
                'codec' => $codec,
                'language' => $lang,
                'title' => $title,
                'label' => $label,
                'kind' => $fmt['kind'],
                'format' => $fmt['ext'],
            ];
        }
    }
    return $streams;
}

$streams = probeSubtitleStreams($realPath);

if ($streams === []) {
    jsonResponse(false, [], '영상에 자막 스트림이 없습니다.');
}

// 목록 조회 모드: 다운로드 전에 트랙 선택용으로 사용
if ($action === 'list') {
    jsonResponse(true, ['streams' => $streams, 'count' => count($streams)]);
}

$trackIndex = filter_input(INPUT_GET, 'index', FILTER_VALIDATE_INT);
if ($trackIndex === false || $trackIndex === null) {
    $trackIndex = 0;
}
if ($trackIndex < 0 || $trackIndex >= count($streams)) {
    jsonResponse(false, [], '선택한 자막 트랙이 없습니다.');
}

$sel = $streams[$trackIndex];
$fmt = subtitleExportFormat((string)($sel['codec'] ?? ''));
$ext = $fmt['ext'];

$tmpDir = sys_get_temp_dir();
$baseName = pathinfo($realPath, PATHINFO_FILENAME);
$suffix = '';
if (count($streams) > 1) {
    $suffix = '.s' . $trackIndex;
    $lang = preg_replace('/[^a-zA-Z0-9-]/', '', (string)($sel['language'] ?? ''));
    if ($lang !== '') $suffix .= '.' . $lang;
}
$downloadName = sanitizeFilename($baseName . $suffix) . '.' . $ext;
$outPath = $tmpDir . '/sub_extract_' . uniqid() . '.' . $ext;

if ($fmt['format'] === 'ass') {
    $cmd = sprintf(
        'ffmpeg -y -v error -i %s -map 0:s:%d -c:s ass %s 2>&1',
        escapeshellarg($realPath),
        $trackIndex,
        escapeshellarg($outPath)
    );
} elseif ($fmt['format'] === 'sup') {
    // PGS 이미지 자막: 텍스트 변환 불가, 스트림 복사
    $cmd = sprintf(
        'ffmpeg -y -v error -i %s -map 0:s:%d -c:s copy %s 2>&1',
        escapeshellarg($realPath),
        $trackIndex,
        escapeshellarg($outPath)
    );
} else {
    // 기타 이미지 자막(dvd/dvb 등): matroska 컨테이너에 복사
    $cmd = sprintf(
        'ffmpeg -y -v error -i %s -map 0:s:%d -c:s copy -f matroska %s 2>&1',
        escapeshellarg($realPath),
        $trackIndex,
        escapeshellarg($outPath)
    );
}
$output = shell_exec($cmd);

if (!file_exists($outPath) || filesize($outPath) === 0) {
    @unlink($outPath);
    jsonResponse(false, [], '자막 추출 실패: ' . trim((string)$output));
}

header('Content-Type: application/octet-stream');
header('Content-Disposition: attachment; filename="' . $downloadName . '"');
header('Content-Length: ' . filesize($outPath));
header('Cache-Control: no-cache, must-revalidate');

readfile($outPath);
@unlink($outPath);
exit;
