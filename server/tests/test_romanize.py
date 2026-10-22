"""services/romanize.py — inc/romanize.php 포팅 검증."""
from server.services.romanize import (
    expand_pronunciation_variants,
    has_hangul,
    normalize_search_text,
    phonetic_match_score,
    romanize_hangul,
    search_query_variants,
    window_similarity,
)


def test_romanize_hangul_basic():
    assert romanize_hangul("스파이") == "seupai"
    assert romanize_hangul("리제로") == "rijero"
    # 비한글은 그대로 통과
    assert romanize_hangul("Spy x Family") == "Spy x Family"


def test_normalize_search_text():
    assert normalize_search_text("Spy x Family") == "spyxfamily"
    assert normalize_search_text("스파이 패밀리!") == "seupaipaemilri"


def test_has_hangul():
    assert has_hangul("스파이")
    assert not has_hangul("spy")


def test_expand_pronunciation_variants_riel():
    # 리 → ri/li (ㄹ → r/l, ㅣ → i/e 총 4가지)
    variants = expand_pronunciation_variants("리")
    assert set(variants) == {"ri", "re", "li", "le"}


def test_expand_eu_omission():
    # 스 → seu/s (ㅡ → eu/생략)
    variants = expand_pronunciation_variants("스")
    assert set(variants) == {"seu", "s"}


def test_variants_cap_at_64():
    # 변형이 폭증필 때 64개 제한
    variants = expand_pronunciation_variants("스파이패밀리제로레벨")
    assert len(variants) <= 64


def test_search_query_variants_loanword():
    # 외래어 사전 치환: 스파이 → spy 포함
    variants = search_query_variants("스파이")
    assert "spy" in variants
    assert any(v.startswith("seupai") or v.startswith("seupae") for v in variants)


def test_window_similarity_exact_and_close():
    assert window_similarity("spy", "spyxfamily") == 1.0
    assert window_similarity("seupai", "spy") < 0.85
    sim = window_similarity("family", "xfamely")
    assert 0.83 <= sim < 0.85  # 6글자 중 1글자 치환 = 0.833
    assert window_similarity("ffamily", "xfamily") >= 0.85  # 7글자 중 1글자 = 0.857


def test_phonetic_match_score_substring_is_one():
    assert phonetic_match_score(["spy"], "spyxfamily") == 1.0


def test_phonetic_match_score_threshold():
    # 유사도 0.85 이상이면 0.9 계수 점수, 미만이면 0
    score = phonetic_match_score(["ffamily"], "xfamily")  # 1글자 차이 → 0.857
    assert 0.75 < score < 0.85
    assert phonetic_match_score(["famili"], "xfamily") == 0.0  # 0.833 < 임계값
    assert phonetic_match_score(["abcdefgh"], "zzzzzzzz") == 0.0


def test_spy_family_scenario():
    # PHP 주석의 예시: "스파이" 검색이 "Spy x Family"를 찾아야 함
    variants = search_query_variants("스파이")
    assert phonetic_match_score(variants, normalize_search_text("Spy x Family")) == 1.0
