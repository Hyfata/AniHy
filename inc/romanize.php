<?php
// 한글 검색어 → 알파벳 근사 변환 (웹 PHP에 mbstring이 없으므로 바이트 기반 UTF-8 디코딩)

function romanizeHangul(string $text): string {
    static $cho = ['g','kk','n','d','tt','r','m','b','pp','s','ss','','j','jj','ch','k','t','p','h'];
    static $jung = ['a','ae','ya','yae','eo','e','yeo','ye','o','wa','wae','oe','yo','u','wo','we','wi','yu','eu','ui','i'];
    static $jong = ['','k','k','','n','','','t','l','','','','','','','m','p','','t','','ng','t','','k','t','p','','h'];
    $out = '';
    $len = strlen($text);
    for ($i = 0; $i < $len;) {
        $b = ord($text[$i]);
        if ($b < 0x80) {
            $out .= $text[$i];
            $i++;
            continue;
        }
        if ($b >= 0xE0 && $b <= 0xEF && $i + 2 < $len) {
            $cp = (($b & 0x0F) << 12) | ((ord($text[$i + 1]) & 0x3F) << 6) | (ord($text[$i + 2]) & 0x3F);
            $i += 3;
            if ($cp >= 0xAC00 && $cp <= 0xD7A3) {
                $s = $cp - 0xAC00;
                $out .= $cho[intdiv($s, 588)] . $jung[intdiv($s % 588, 28)] . $jong[$s % 28];
            }
            continue;
        }
        $i += ($b >= 0xF0) ? 4 : 2;
    }
    return $out;
}

// 검색 비교용 정규화: 소문자 + 한글 로마자화 + 영숫자 외 제거
function normalizeSearchText(string $text): string {
    return preg_replace('/[^a-z0-9]/', '', romanizeHangul(strtolower($text)));
}

// 한글 검색어의 비교 변형들: 음절별 발음 근사를 조합 생성 (ㄹ→r/l, ㅣ→i/e, ㅡ→eu/생략 등) + 흔한 외래어 사전 치환
function searchQueryVariants(string $query): array {
    static $loanwords = [
        '시즌' => 'season', '스파이' => 'spy', '패밀리' => 'family',
        '제로' => 'zero', '레벨' => 'level', '에이티' => 'eighty', '식스' => 'six',
    ];
    $queries = [strtolower($query)];
    $replaced = strtr(strtolower($query), $loanwords);
    if ($replaced !== strtolower($query)) $queries[] = $replaced;

    $variants = [];
    foreach ($queries as $q) {
        foreach (expandPronunciationVariants($q) as $v) {
            $v = preg_replace('/[^a-z0-9]/', '', $v);
            if (strlen($v) >= 2) $variants[] = $v;
        }
    }
    return array_values(array_unique($variants));
}

// 음절별 대체 발음의 조합 곱 (최대 64개). 예: 리제로 → rijero, rejero, lijero, lejero, ...
function expandPronunciationVariants(string $text): array {
    static $choAlts = [5 => ['r', 'l']]; // ㄹ
    static $jungAlts = [18 => ['eu', ''], 20 => ['i', 'e'], 1 => ['e', 'ae']]; // ㅡ, ㅣ, ㅐ
    static $jongAlts = [8 => ['l', 'r']]; // ㄹ 받침
    $cho = ['g','kk','n','d','tt','r','m','b','pp','s','ss','','j','jj','ch','k','t','p','h'];
    $jung = ['a','ae','ya','yae','eo','e','yeo','ye','o','wa','wae','oe','yo','u','wo','we','wi','yu','eu','ui','i'];
    $jong = ['','k','k','','n','','','t','l','','','','','','','m','p','','t','','ng','t','','k','t','p','','h'];

    $variants = [''];
    $len = strlen($text);
    for ($i = 0; $i < $len;) {
        $b = ord($text[$i]);
        $alts = null;
        if ($b < 0x80) {
            $alts = [$text[$i]];
            $i++;
        } elseif ($b >= 0xE0 && $b <= 0xEF && $i + 2 < $len) {
            $cp = (($b & 0x0F) << 12) | ((ord($text[$i + 1]) & 0x3F) << 6) | (ord($text[$i + 2]) & 0x3F);
            $i += 3;
            if ($cp >= 0xAC00 && $cp <= 0xD7A3) {
                $s = $cp - 0xAC00;
                $ci = intdiv($s, 588); $vi = intdiv($s % 588, 28); $fi = $s % 28;
                $cs = $choAlts[$ci] ?? [$cho[$ci]];
                $vs = $jungAlts[$vi] ?? [$jung[$vi]];
                $fs = $jongAlts[$fi] ?? [$jong[$fi]];
                $alts = [];
                foreach ($cs as $c) foreach ($vs as $v) foreach ($fs as $f) $alts[] = $c . $v . $f;
            }
        } else {
            $i += ($b >= 0xF0) ? 4 : 2;
        }
        if ($alts === null) continue;
        if (count($variants) * count($alts) > 64) $alts = array_slice($alts, 0, 1);
        $next = [];
        foreach ($variants as $prefix) foreach ($alts as $a) $next[] = $prefix . $a;
        $variants = $next;
    }
    return $variants;
}

// needle을 haystack의 모든 윈도우(길이 ±2)와 비교한 최고 유사도 (0~1)
function windowSimilarity(string $needle, string $haystack): float {
    $nl = strlen($needle);
    $hl = strlen($haystack);
    if ($nl === 0 || $hl === 0) return 0.0;
    $best = 0.0;
    for ($wl = max(2, $nl - 2); $wl <= min($hl, $nl + 2); $wl++) {
        for ($i = 0; $i + $wl <= $hl; $i++) {
            $d = levenshtein($needle, substr($haystack, $i, $wl));
            $sim = 1 - $d / max($nl, $wl);
            if ($sim > $best) $best = $sim;
        }
    }
    return $best;
}

// 발음 근사 매칭 점수: 부분문자열 1.0, 아니면 윈도우 유사도 (임계값 미만이면 0)
function phoneticMatchScore(array $variants, string $normalizedTitle): float {
    $best = 0.0;
    foreach ($variants as $v) {
        if (str_contains($normalizedTitle, $v)) return 1.0;
        $sim = windowSimilarity($v, $normalizedTitle);
        if ($sim > $best) $best = $sim;
    }
    return $best >= 0.85 ? $best * 0.9 : 0.0;
}
