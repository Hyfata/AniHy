"""한글 검색어 → 알파벳 근사 변환/퍼지 매칭 — inc/romanize.php 포팅.

PHP와 달리 Python은 유니코드가 기본이라 바이트 디코딩 루프 대신 str 순회로 단순화.
변환표·변형 규칙·임계값은 PHP와 동일하게 유지.
"""
import re

_CHO = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"]
_JUNG = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"]
_JONG = ["", "k", "k", "", "n", "", "", "t", "l", "", "", "", "", "", "", "m", "p", "", "t", "", "ng", "t", "", "k", "t", "p", "", "h"]

_HANGUL_RE = re.compile(r"[가-힣]")
_NON_ALNUM_RE = re.compile(r"[^a-z0-9]")

_LOANWORDS = {
    "시즌": "season", "스파이": "spy", "패밀리": "family",
    "제로": "zero", "레벨": "level", "에이티": "eighty", "식스": "six",
}

# 음절별 대체 발음 (ㄹ→r/l, ㅡ→eu/생략, ㅣ→i/e, ㅐ→e/ae, ㄹ 받침→l/r)
_CHO_ALTS = {5: ["r", "l"]}
_JUNG_ALTS = {18: ["eu", ""], 20: ["i", "e"], 1: ["e", "ae"]}
_JONG_ALTS = {8: ["l", "r"]}

MAX_VARIANTS = 64
SIMILARITY_THRESHOLD = 0.85


def romanize_hangul(text: str) -> str:
    out = []
    for ch in text:
        cp = ord(ch)
        if 0xAC00 <= cp <= 0xD7A3:
            s = cp - 0xAC00
            out.append(_CHO[s // 588] + _JUNG[(s % 588) // 28] + _JONG[s % 28])
        else:
            out.append(ch)
    return "".join(out)


def normalize_search_text(text: str) -> str:
    """검색 비교용 정규화: 소문자 + 한글 로마자화 + 영숫자 외 제거."""
    return _NON_ALNUM_RE.sub("", romanize_hangul(text.lower()))


def has_hangul(text: str) -> bool:
    return bool(_HANGUL_RE.search(text))


def expand_pronunciation_variants(text: str) -> list[str]:
    """음절별 대체 발음의 조합 곱 (최대 64개)."""
    variants = [""]
    for ch in text:
        cp = ord(ch)
        if 0xAC00 <= cp <= 0xD7A3:
            s = cp - 0xAC00
            ci, vi, fi = s // 588, (s % 588) // 28, s % 28
            cs = _CHO_ALTS.get(ci, [_CHO[ci]])
            vs = _JUNG_ALTS.get(vi, [_JUNG[vi]])
            fs = _JONG_ALTS.get(fi, [_JONG[fi]])
            alts = [c + v + f for c in cs for v in vs for f in fs]
        else:
            alts = [ch]
        if len(variants) * len(alts) > MAX_VARIANTS:
            alts = alts[:1]
        variants = [p + a for p in variants for a in alts]
    return variants


def search_query_variants(query: str) -> list[str]:
    """한글 검색어의 비교 변형들: 발음 근사 조합 + 흔한 외래어 사전 치환."""
    lowered = query.lower()
    queries = [lowered]
    replaced = lowered
    for k, v in _LOANWORDS.items():
        replaced = replaced.replace(k, v)
    if replaced != lowered:
        queries.append(replaced)

    variants: list[str] = []
    for q in queries:
        for v in expand_pronunciation_variants(q):
            v = _NON_ALNUM_RE.sub("", v)
            if len(v) >= 2 and v not in variants:
                variants.append(v)
    return variants


def _levenshtein(a: str, b: str) -> int:
    if len(a) < len(b):
        a, b = b, a
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


# C 확장이 있으면 그것을 사용 — 순수 파이썬 레벤슈타인은 긴 한글 검색어의 퍼지 매칭에서
# 변형 수십 개 × 전체 제목 전수조사로 수 초~수십 초가 걸리는 원인이었다.
try:
    from Levenshtein import distance as _c_levenshtein
except ImportError:  # pragma: no cover - 폴백
    _c_levenshtein = None


def _levenshtein_capped(a: str, b: str, max_dist: int) -> int:
    """거리가 max_dist를 넘으면 max_dist+1을 반환(정확한 값 아님).
    임계값 근처만 정확히 계산해 매치 불가능한 윈도우를 빠르게 버린다."""
    if len(a) < len(b):
        a, b = b, a
    if len(a) - len(b) > max_dist:
        return max_dist + 1
    if _c_levenshtein is not None:
        d = _c_levenshtein(a, b, score_cutoff=max_dist)
        return d if d <= max_dist else max_dist + 1
    band_inf = max_dist + 1
    # prev[j] for j in [0..len(b)], 밴드 밖은 band_inf
    prev = [j if j <= max_dist else band_inf for j in range(len(b) + 1)]
    for i, ca in enumerate(a, 1):
        lo = max(1, i - max_dist)
        hi = min(len(b), i + max_dist)
        cur = [band_inf] * (len(b) + 1)
        if i <= max_dist:
            cur[0] = i
        row_min = band_inf
        for j in range(lo, hi + 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != b[j - 1]))
            if cur[j] < row_min:
                row_min = cur[j]
        if row_min > max_dist:
            return band_inf
        prev = cur
    d = prev[len(b)]
    return d if d <= max_dist else band_inf


def window_similarity(needle: str, haystack: str) -> float:
    """needle을 haystack의 모든 윈도우(길이 ±2)와 비교한 최고 유사도 (0~1).
    임계값(0.85) 이상만 정확히 계산하고 나머지는 컷오프로 빠르게 버린다."""
    nl, hl = len(needle), len(haystack)
    if nl == 0 or hl == 0:
        return 0.0
    best = 0.0
    for wl in range(max(2, nl - 2), min(hl, nl + 2) + 1):
        # sim = 1 - d/max(nl, wl) ≥ 임계값 ⇔ d ≤ (1-임계값)*max — 그 범위만 정확히 계산
        max_dist = int((1 - SIMILARITY_THRESHOLD) * max(nl, wl))
        for i in range(0, hl - wl + 1):
            d = _levenshtein_capped(needle, haystack[i : i + wl], max_dist)
            sim = 1 - d / max(nl, wl)
            if sim > best:
                best = sim
                if best >= 1.0:
                    return best
    return best


def phonetic_match_score(variants: list[str], normalized_title: str) -> float:
    """발음 근사 매칭 점수: 부분문자열 1.0, 아니면 윈도우 유사도 (임계값 미만이면 0)."""
    best = 0.0
    for v in variants:
        if v in normalized_title:
            return 1.0
        sim = window_similarity(v, normalized_title)
        if sim > best:
            best = sim
            if best >= 1.0:
                break
        # 임계값 도달 시 조기 종료 — 초과 점수 차이는 정렬에 의미가 없고,
        # 긴 검색어에서 변형 64개 × 전체 제목 전수조사 비용이 수 초가 되는 것을 방지
        if best >= SIMILARITY_THRESHOLD:
            break
    return best * 0.9 if best >= SIMILARITY_THRESHOLD else 0.0
