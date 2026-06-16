# -*- coding: utf-8 -*-
"""scoring.py 회귀 테스트 (엔진계약 §7, ~52 케이스).

결정성: now 불필요(채점은 시각 비의존). 단 기준 상수 명시.
콘솔 출력 없음. pytest 스타일 assert.
"""
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
from models import AnswerSpec, ScoreInput
from errors import ScoreInputError
from scoring import normalize, score


# ── 헬퍼 ─────────────────────────────────────────────────────────────────────

def make_spec(
    normalize_rules=None,
    accepted=None,
    required_keywords=None,
    blanks=None,
    sequence=None,
):
    return AnswerSpec(
        normalize=normalize_rules or [],
        accepted=accepted,
        required_keywords=required_keywords,
        blanks=blanks,
        sequence=sequence,
    )


def make_inp(mode, user_answer, spec, synonyms=None):
    return ScoreInput(mode=mode, user_answer=user_answer, answer_spec=spec, synonyms=synonyms)


# ── normalize: 9규칙 각각 ──────────────────────────────────────────────────────

def test_norm_nfkc():
    # 전각 'Ａ'(U+FF21)는 NFKC 정규화 후 반각 'A'가 됨
    result = normalize("Ａ", ["nfkc"])
    assert result == "A"


def test_norm_trim():
    result = normalize("  hello  ", ["trim"])
    assert result == "hello"


def test_norm_collapse_space():
    # 여러 공백·탭·개행을 단일 스페이스로
    result = normalize("a  b\t\tc", ["collapse_space"])
    assert result == "a b c"


def test_norm_collapse_space_fullwidth():
    # 전각공백도 처리
    result = normalize("a　b", ["collapse_space"])
    assert result == "a b"


def test_norm_strip_all_space():
    result = normalize("a b c", ["strip_all_space"])
    assert result == "abc"


def test_norm_lower_ascii_only():
    # ASCII 대문자만 소문자화, 한글·숫자 불변
    result = normalize("Hello 세계 ABC123", ["lower"])
    assert result == "hello 세계 abc123"


def test_norm_fullwidth_to_halfwidth():
    # 전각 영숫자를 반각으로
    result = normalize("ＡＢＣ１２３", ["fullwidth_to_halfwidth"])
    assert result == "ABC123"


def test_norm_unify_cell_dollar():
    result = normalize("$A$1", ["unify_cell_dollar"])
    assert result == "A1"


def test_norm_unify_arg_sep_semicolon():
    result = normalize("SUM(A1;B1)", ["unify_arg_sep"])
    assert result == "SUM(A1,B1)"


def test_norm_unify_arg_sep_fullwidth_comma():
    result = normalize("IF(A1，B1，C1)", ["unify_arg_sep"])
    assert result == "IF(A1,B1,C1)"


def test_norm_strip_trailing_paren():
    result = normalize("SUM()", ["strip_trailing_paren"])
    assert result == "SUM"


def test_norm_strip_trailing_paren_content():
    # 괄호 안에 내용이 있어도 제거
    result = normalize("IF(True)", ["strip_trailing_paren"])
    assert result == "IF"


# ── normalize: 순서 보장 ──────────────────────────────────────────────────────

def test_norm_order_trim_before_collapse():
    # trim → collapse_space 순서: 앞뒤 공백 제거 후 내부 공백 병합
    result = normalize("  a   b  ", ["trim", "collapse_space"])
    assert result == "a b"


def test_norm_order_nfkc_then_lower():
    # nfkc 후 lower: 전각 대문자가 반각 대문자로 바뀐 뒤 소문자화
    result = normalize("Ａ", ["nfkc", "lower"])
    assert result == "a"


def test_norm_order_lower_then_unify_arg_sep():
    # lower 후 unify_arg_sep: 순서가 뒤집혀도 각 규칙이 독립 적용
    result = normalize("SUM(A;B)", ["lower", "unify_arg_sep"])
    assert result == "sum(a,b)"


# ── normalize: synonyms 치환 시점 ─────────────────────────────────────────────

def test_norm_synonyms_after_lower():
    # synonyms 치환은 lower 직후에 삽입: lower 후 "vlookup" → "수직조회"
    synonyms = {"vlookup": "수직조회"}
    result = normalize("VLOOKUP", ["lower"], synonyms=synonyms)
    assert result == "수직조회"


def test_norm_synonyms_token_exact_match():
    # 부분문자열이 아닌 토큰 단위 정확일치만 치환
    synonyms = {"if": "조건"}
    result = normalize("IF IFA", ["lower"], synonyms=synonyms)
    # "if"는 치환, "ifa"는 키 없음 → 그대로
    assert result == "조건 ifa"


def test_norm_synonyms_no_lower_rule_no_replace():
    # lower 규칙 없으면 synonyms 치환 없음
    synonyms = {"hello": "안녕"}
    result = normalize("hello", ["trim"], synonyms=synonyms)
    assert result == "hello"


def test_norm_synonyms_after_lower_not_before():
    # lower 이전에 치환 시도하면 대소문자 불일치로 치환 안 됨
    # 여기서는 lower 직후 synonyms가 "if"로 치환됨을 확인
    synonyms = {"if": "조건"}
    result = normalize("IF", ["nfkc", "lower"], synonyms=synonyms)
    assert result == "조건"


# ── score: exact 모드 ─────────────────────────────────────────────────────────

def test_exact_correct_single():
    spec = make_spec(normalize_rules=["trim"], accepted=["SUM"])
    inp = make_inp("exact", "SUM", spec)
    r = score(inp)
    assert r.verdict == "correct"
    assert r.normalized_user == "SUM"


def test_exact_correct_with_normalization():
    # normalize lower 후 비교: 대소문자 무관
    spec = make_spec(normalize_rules=["lower"], accepted=["sum"])
    inp = make_inp("exact", "SUM", spec)
    r = score(inp)
    assert r.verdict == "correct"


def test_exact_multiple_accepted():
    # 복수 정답 OR 일치
    spec = make_spec(normalize_rules=["lower"], accepted=["sumif", "sumifs"])
    inp = make_inp("exact", "SUMIFS", spec)
    r = score(inp)
    assert r.verdict == "correct"
    assert r.matched == ["sumifs"]


def test_exact_incorrect():
    spec = make_spec(normalize_rules=["lower"], accepted=["sum"])
    inp = make_inp("exact", "average", spec)
    r = score(inp)
    assert r.verdict == "incorrect"
    assert r.matched == []


def test_exact_empty_input_incorrect():
    # 빈 입력 → incorrect(ScoreInputError 아님, 엔진계약 §3.2)
    spec = make_spec(normalize_rules=["trim"], accepted=["sum"])
    inp = make_inp("exact", "", spec)
    r = score(inp)
    assert r.verdict == "incorrect"


def test_exact_matched_feedback():
    spec = make_spec(normalize_rules=[], accepted=["answer"])
    inp = make_inp("exact", "answer", spec)
    r = score(inp)
    assert r.feedback == {"highlight_missed": []}
    assert r.missed == []


# ── score: recall_seq(exact 경로) ─────────────────────────────────────────────

def test_recall_seq_correct_list():
    spec = make_spec(normalize_rules=["trim"], sequence=["단계A", "단계B", "단계C"])
    inp = make_inp("exact", ["단계A", "단계B", "단계C"], spec)
    r = score(inp)
    assert r.verdict == "correct"
    assert r.matched == ["단계A", "단계B", "단계C"]


def test_recall_seq_incorrect_order():
    spec = make_spec(normalize_rules=["trim"], sequence=["단계A", "단계B"])
    inp = make_inp("exact", ["단계B", "단계A"], spec)
    r = score(inp)
    assert r.verdict == "incorrect"


def test_recall_seq_length_mismatch():
    # 길이 불일치 → incorrect(throw 아님, 엔진계약 §3.1)
    spec = make_spec(normalize_rules=[], sequence=["A", "B", "C"])
    inp = make_inp("exact", ["A", "B"], spec)
    r = score(inp)
    assert r.verdict == "incorrect"
    assert r.missed == ["A", "B", "C"]


def test_recall_seq_single_step_correct():
    spec = make_spec(normalize_rules=["lower"], sequence=["start"])
    inp = make_inp("exact", ["START"], spec)
    r = score(inp)
    assert r.verdict == "correct"


def test_recall_seq_string_comma_split():
    # 하위호환: 쉼표 분리 단일 문자열도 허용
    spec = make_spec(normalize_rules=["trim"], sequence=["A", "B"])
    inp = make_inp("exact", "A,B", spec)
    r = score(inp)
    assert r.verdict == "correct"


# ── score: keyword 모드 ───────────────────────────────────────────────────────

def test_keyword_all_groups_correct():
    spec = make_spec(
        normalize_rules=["lower"],
        required_keywords=[["sum"], ["average"]],
    )
    inp = make_inp("keyword", "SUM 과 AVERAGE를 쓴다", spec)
    r = score(inp)
    assert r.verdict == "correct"
    assert r.missed == []


def test_keyword_any_of_within_group():
    # 그룹 내 any-of: "합계" 또는 "sum" 중 하나 포함하면 통과
    spec = make_spec(
        normalize_rules=["lower"],
        required_keywords=[["sum", "합계"]],
    )
    inp = make_inp("keyword", "합계를 구한다", spec)
    r = score(inp)
    assert r.verdict == "correct"
    assert "합계" in r.matched


def test_keyword_missed_group():
    spec = make_spec(
        normalize_rules=["lower"],
        required_keywords=[["sum"], ["average"]],
    )
    inp = make_inp("keyword", "sum만 씀", spec)
    r = score(inp)
    assert r.verdict == "incorrect"
    assert "average" in r.missed


def test_keyword_all_missed():
    spec = make_spec(
        normalize_rules=["lower"],
        required_keywords=[["sum"], ["average"]],
    )
    inp = make_inp("keyword", "vlookup 사용", spec)
    r = score(inp)
    assert r.verdict == "incorrect"
    assert len(r.missed) == 2


def test_keyword_empty_input_incorrect():
    spec = make_spec(
        normalize_rules=["trim"],
        required_keywords=[["sum"]],
    )
    inp = make_inp("keyword", "", spec)
    r = score(inp)
    assert r.verdict == "incorrect"


def test_keyword_feedback_highlight_missed():
    spec = make_spec(
        normalize_rules=["lower"],
        required_keywords=[["sum"], ["if"]],
    )
    inp = make_inp("keyword", "if만 포함", spec)
    r = score(inp)
    assert r.feedback["highlight_missed"] == r.missed
    assert "sum" in r.feedback["highlight_missed"]


# ── score: cloze 모드 ─────────────────────────────────────────────────────────

def test_cloze_all_correct():
    spec = make_spec(
        normalize_rules=["lower", "trim"],
        blanks=[["sum"], ["average"]],
    )
    inp = make_inp("cloze", ["SUM", "AVERAGE"], spec)
    r = score(inp)
    assert r.verdict == "correct"
    assert r.matched == ["0", "1"]
    assert r.missed == []


def test_cloze_partial_incorrect_is_incorrect():
    # 이진: 하나라도 틀리면 incorrect
    spec = make_spec(
        normalize_rules=["lower"],
        blanks=[["sum"], ["average"]],
    )
    inp = make_inp("cloze", ["sum", "vlookup"], spec)
    r = score(inp)
    assert r.verdict == "incorrect"
    assert "0" in r.matched
    assert "1" in r.missed


def test_cloze_blank_count_mismatch_throws():
    # 빈칸수 불일치 → ScoreInputError
    spec = make_spec(
        normalize_rules=[],
        blanks=[["a"], ["b"]],
    )
    inp = make_inp("cloze", ["a"], spec)
    with pytest.raises(ScoreInputError):
        score(inp)


def test_cloze_index_string_in_matched():
    # matched/missed는 빈칸 인덱스 문자열
    spec = make_spec(
        normalize_rules=[],
        blanks=[["x"], ["y"], ["z"]],
    )
    inp = make_inp("cloze", ["x", "WRONG", "z"], spec)
    r = score(inp)
    assert r.matched == ["0", "2"]
    assert r.missed == ["1"]


def test_cloze_empty_answer_incorrect():
    spec = make_spec(
        normalize_rules=["trim"],
        blanks=[["sum"]],
    )
    inp = make_inp("cloze", [""], spec)
    r = score(inp)
    assert r.verdict == "incorrect"
    assert r.missed == ["0"]


def test_cloze_any_of_candidates():
    # blanks[i]가 복수 후보이면 any 일치
    spec = make_spec(
        normalize_rules=["lower"],
        blanks=[["sum", "합계"]],
    )
    inp = make_inp("cloze", ["합계"], spec)
    r = score(inp)
    assert r.verdict == "correct"


def test_cloze_normalized_user_is_list():
    spec = make_spec(
        normalize_rules=["lower"],
        blanks=[["a"], ["b"]],
    )
    inp = make_inp("cloze", ["A", "B"], spec)
    r = score(inp)
    assert isinstance(r.normalized_user, list)
    assert r.normalized_user == ["a", "b"]


# ── score: self 모드 ──────────────────────────────────────────────────────────

def test_self_correct_passthrough():
    spec = make_spec(normalize_rules=[])
    inp = make_inp("self", "correct", spec)
    r = score(inp)
    assert r.verdict == "correct"
    assert r.normalized_user == "correct"
    assert r.matched == []
    assert r.missed == []


def test_self_incorrect_passthrough():
    spec = make_spec(normalize_rules=[])
    inp = make_inp("self", "incorrect", spec)
    r = score(inp)
    assert r.verdict == "incorrect"


def test_self_invalid_value_throws():
    spec = make_spec(normalize_rules=[])
    inp = make_inp("self", "maybe", spec)
    with pytest.raises(ScoreInputError):
        score(inp)


def test_self_feedback_empty():
    spec = make_spec(normalize_rules=[])
    inp = make_inp("self", "correct", spec)
    r = score(inp)
    assert r.feedback == {"highlight_missed": []}


# ── score: 알 수 없는 mode ────────────────────────────────────────────────────

def test_unknown_mode_throws():
    spec = make_spec(normalize_rules=[])
    inp = make_inp("magic", "answer", spec)
    with pytest.raises(ScoreInputError):
        score(inp)


def test_none_mode_throws():
    spec = make_spec(normalize_rules=[])
    inp = make_inp(None, "answer", spec)
    with pytest.raises(ScoreInputError):
        score(inp)


# ── score: 타입 오류 ScoreInputError ─────────────────────────────────────────

def test_exact_list_input_no_sequence_throws():
    # sequence 없는 exact에서 list 입력 → ScoreInputError
    spec = make_spec(normalize_rules=[], accepted=["answer"])
    inp = make_inp("exact", ["answer"], spec)
    with pytest.raises(ScoreInputError):
        score(inp)


def test_keyword_list_input_throws():
    spec = make_spec(normalize_rules=[], required_keywords=[["sum"]])
    inp = make_inp("keyword", ["sum"], spec)
    with pytest.raises(ScoreInputError):
        score(inp)


def test_cloze_str_input_throws():
    spec = make_spec(normalize_rules=[], blanks=[["a"]])
    inp = make_inp("cloze", "a", spec)
    with pytest.raises(ScoreInputError):
        score(inp)


# ── normalize: 알 수 없는 규칙 건너뜀 ────────────────────────────────────────

def test_norm_unknown_rule_passthrough():
    result = normalize("Hello", ["nonexistent_rule", "lower"])
    assert result == "hello"


# ── normalize: synonyms 빈 딕셔너리 ─────────────────────────────────────────

def test_norm_synonyms_empty_dict_no_change():
    result = normalize("hello", ["lower"], synonyms={})
    assert result == "hello"


# ── normalize: rules 빈 배열 ────────────────────────────────────────────────

def test_norm_empty_rules_identity():
    result = normalize("  Hello  ", [])
    assert result == "  Hello  "
