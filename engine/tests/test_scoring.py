# -*- coding: utf-8 -*-
"""Regression tests for scoring.py (engine-contract §7, ~52 cases).

Determinism: no `now` dependency (scoring is time-independent). Constants are stated explicitly.
No console output. pytest-style asserts.
"""
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
from models import AnswerSpec, ScoreInput
from errors import ScoreInputError
from scoring import normalize, score


# helpers

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


# normalize: each of the 9 rules

def test_norm_nfkc():
    # fullwidth 'Ａ' (U+FF21) becomes halfwidth 'A' after NFKC normalization
    result = normalize("Ａ", ["nfkc"])
    assert result == "A"


def test_norm_trim():
    result = normalize("  hello  ", ["trim"])
    assert result == "hello"


def test_norm_collapse_space():
    # multiple spaces, tabs, and newlines collapse into a single space
    result = normalize("a  b\t\tc", ["collapse_space"])
    assert result == "a b c"


def test_norm_collapse_space_fullwidth():
    # fullwidth space is also handled
    result = normalize("a　b", ["collapse_space"])
    assert result == "a b"


def test_norm_strip_all_space():
    result = normalize("a b c", ["strip_all_space"])
    assert result == "abc"


def test_norm_lower_ascii_only():
    # only ASCII uppercase is lowercased; Korean and digits are unchanged
    result = normalize("Hello 세계 ABC123", ["lower"])
    assert result == "hello 세계 abc123"


def test_norm_fullwidth_to_halfwidth():
    # fullwidth alphanumerics are converted to halfwidth
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
    # trailing parentheses with content are also stripped
    result = normalize("IF(True)", ["strip_trailing_paren"])
    assert result == "IF"


# normalize: rule ordering guarantees

def test_norm_order_trim_before_collapse():
    # trim then collapse_space: leading/trailing spaces removed, then internal spaces collapsed
    result = normalize("  a   b  ", ["trim", "collapse_space"])
    assert result == "a b"


def test_norm_order_nfkc_then_lower():
    # nfkc then lower: fullwidth uppercase becomes halfwidth uppercase, then lowercased
    result = normalize("Ａ", ["nfkc", "lower"])
    assert result == "a"


def test_norm_order_lower_then_unify_arg_sep():
    # lower then unify_arg_sep: each rule is applied independently regardless of order
    result = normalize("SUM(A;B)", ["lower", "unify_arg_sep"])
    assert result == "sum(a,b)"


# normalize: synonyms substitution timing

def test_norm_synonyms_after_lower():
    # synonyms substitution is inserted immediately after lower: "vlookup" -> "수직조회"
    synonyms = {"vlookup": "수직조회"}
    result = normalize("VLOOKUP", ["lower"], synonyms=synonyms)
    assert result == "수직조회"


def test_norm_synonyms_token_exact_match():
    # only token-level exact matches are substituted, not substrings
    synonyms = {"if": "조건"}
    result = normalize("IF IFA", ["lower"], synonyms=synonyms)
    # "if" is substituted; "ifa" has no matching key so it is left as-is
    assert result == "조건 ifa"


def test_norm_synonyms_no_lower_rule_no_replace():
    # without the lower rule, synonyms substitution does not run
    synonyms = {"hello": "안녕"}
    result = normalize("hello", ["trim"], synonyms=synonyms)
    assert result == "hello"


def test_norm_synonyms_after_lower_not_before():
    # substitution before lower would fail due to case mismatch; here lower fires first
    # confirm that synonyms fires after lower and "if" is substituted correctly
    synonyms = {"if": "조건"}
    result = normalize("IF", ["nfkc", "lower"], synonyms=synonyms)
    assert result == "조건"


# score: exact mode

def test_exact_correct_single():
    spec = make_spec(normalize_rules=["trim"], accepted=["SUM"])
    inp = make_inp("exact", "SUM", spec)
    r = score(inp)
    assert r.verdict == "correct"
    assert r.normalized_user == "SUM"


def test_exact_correct_with_normalization():
    # comparison after lower: case-insensitive match
    spec = make_spec(normalize_rules=["lower"], accepted=["sum"])
    inp = make_inp("exact", "SUM", spec)
    r = score(inp)
    assert r.verdict == "correct"


def test_exact_multiple_accepted():
    # multiple accepted values matched with OR
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
    # empty input yields incorrect (not ScoreInputError, per engine-contract §3.2)
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


# score: recall_seq (exact path)

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
    # length mismatch yields incorrect (not a throw, per engine-contract §3.1)
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
    # backward compat: a single comma-separated string is also accepted
    spec = make_spec(normalize_rules=["trim"], sequence=["A", "B"])
    inp = make_inp("exact", "A,B", spec)
    r = score(inp)
    assert r.verdict == "correct"


# score: keyword mode

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
    # any-of within a group: passing if either "합계" or "sum" is present
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


# score: cloze mode

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
    # binary: any wrong blank makes the whole result incorrect
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
    # blank count mismatch raises ScoreInputError
    spec = make_spec(
        normalize_rules=[],
        blanks=[["a"], ["b"]],
    )
    inp = make_inp("cloze", ["a"], spec)
    with pytest.raises(ScoreInputError):
        score(inp)


def test_cloze_index_string_in_matched():
    # matched and missed contain blank index strings
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
    # blanks[i] with multiple candidates: any match passes
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


# score: self mode

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


# score: unknown mode

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


# score: type error ScoreInputError

def test_exact_list_input_no_sequence_throws():
    # list input to exact mode without sequence raises ScoreInputError
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


# normalize: unknown rule is skipped

def test_norm_unknown_rule_passthrough():
    result = normalize("Hello", ["nonexistent_rule", "lower"])
    assert result == "hello"


# normalize: empty synonyms dict

def test_norm_synonyms_empty_dict_no_change():
    result = normalize("hello", ["lower"], synonyms={})
    assert result == "hello"


# normalize: empty rules array

def test_norm_empty_rules_identity():
    result = normalize("  Hello  ", [])
    assert result == "  Hello  "
