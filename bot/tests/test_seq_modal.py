# -*- coding: utf-8 -*-
"""Headless tests for seq_modal handler (pure core: evaluate_seq).

No live Discord connection required. All assertions target evaluate_seq directly.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

from models import CardDef, AnswerSpec, HandlerResult
from handlers.seq_modal import evaluate_seq


# Helpers

def _make_card(sequence: list[str], normalize: list[str] | None = None) -> CardDef:
    """Build a minimal recall_seq CardDef."""
    return CardDef(
        card_id="seq-test-001",
        schema_version=1,
        subject="test-subject",
        unit="test-unit",
        type="recall_seq",
        grade_mode="exact",
        front={"text": "올바른 순서대로 나열하시오."},
        back={},
        answer_spec=AnswerSpec(
            normalize=normalize if normalize is not None else ["trim"],
            sequence=sequence,
        ),
        tags={"weight": 5},
        links={},
    )


def _make_card_no_spec() -> CardDef:
    """Build a CardDef with no answer_spec (edge case)."""
    return CardDef(
        card_id="seq-no-spec",
        schema_version=1,
        subject="test-subject",
        unit="test-unit",
        type="recall_seq",
        grade_mode="exact",
        front={"text": "no spec card"},
        back={},
        answer_spec=None,
        tags={"weight": 5},
        links={},
    )


def _make_card_no_sequence() -> CardDef:
    """Build a CardDef with answer_spec but sequence=None."""
    return CardDef(
        card_id="seq-no-seq",
        schema_version=1,
        subject="test-subject",
        unit="test-unit",
        type="recall_seq",
        grade_mode="exact",
        front={"text": "no sequence card"},
        back={},
        answer_spec=AnswerSpec(normalize=["trim"], sequence=None),
        tags={"weight": 5},
        links={},
    )


# Tests: correct ordered match

def test_correct_exact_ordered_match():
    card = _make_card(["alpha", "beta", "gamma"])
    result = evaluate_seq(card, ["alpha", "beta", "gamma"], "exact", None)
    assert isinstance(result, HandlerResult)
    assert result.verdict == "correct"
    assert result.card_id == "seq-test-001"
    assert result.done is True
    assert result.requeue is False


def test_correct_single_step():
    card = _make_card(["only-step"])
    result = evaluate_seq(card, ["only-step"], "exact", None)
    assert result.verdict == "correct"
    assert result.requeue is False


def test_correct_with_trim_normalization():
    card = _make_card(["alpha", "beta"], normalize=["trim"])
    result = evaluate_seq(card, ["  alpha  ", "  beta  "], "exact", None)
    assert result.verdict == "correct"


# Tests: incorrect (wrong order)

def test_incorrect_wrong_order():
    card = _make_card(["alpha", "beta", "gamma"])
    result = evaluate_seq(card, ["beta", "alpha", "gamma"], "exact", None)
    assert result.verdict == "incorrect"
    assert result.requeue is True
    assert result.done is True


def test_incorrect_reversed_two_steps():
    card = _make_card(["first", "second"])
    result = evaluate_seq(card, ["second", "first"], "exact", None)
    assert result.verdict == "incorrect"
    assert result.requeue is True


# Tests: incorrect (wrong length)

def test_incorrect_too_few_steps():
    card = _make_card(["alpha", "beta", "gamma"])
    result = evaluate_seq(card, ["alpha", "beta"], "exact", None)
    assert result.verdict == "incorrect"
    assert result.requeue is True


def test_incorrect_too_many_steps():
    card = _make_card(["alpha", "beta"])
    result = evaluate_seq(card, ["alpha", "beta", "extra"], "exact", None)
    assert result.verdict == "incorrect"
    assert result.requeue is True


def test_incorrect_empty_user_steps():
    card = _make_card(["alpha", "beta"])
    result = evaluate_seq(card, [], "exact", None)
    assert result.verdict == "incorrect"
    assert result.requeue is True


# Tests: wrong content (correct count, wrong values)

def test_incorrect_wrong_content():
    card = _make_card(["alpha", "beta", "gamma"])
    result = evaluate_seq(card, ["alpha", "WRONG", "gamma"], "exact", None)
    assert result.verdict == "incorrect"
    assert result.requeue is True


# Tests: synonym substitution

def test_correct_with_synonym_substitution():
    card = _make_card(["alpha", "beta"], normalize=["trim", "lower"])
    synonyms = {"a": "alpha", "b": "beta"}
    result = evaluate_seq(card, ["a", "b"], "exact", synonyms)
    assert result.verdict == "correct"


# Tests: edge cases (missing spec/sequence)

def test_skip_when_answer_spec_is_none():
    card = _make_card_no_spec()
    result = evaluate_seq(card, ["step1"], "exact", None)
    assert result.verdict == "skip"
    assert result.requeue is False


def test_skip_when_sequence_is_none():
    card = _make_card_no_sequence()
    result = evaluate_seq(card, ["step1"], "exact", None)
    assert result.verdict == "skip"
    assert result.requeue is False


# Tests: five-step sequence (boundary around the modal field limit)

def test_correct_five_steps():
    steps = ["s1", "s2", "s3", "s4", "s5"]
    card = _make_card(steps)
    result = evaluate_seq(card, steps[:], "exact", None)
    assert result.verdict == "correct"


def test_incorrect_five_steps_wrong_order():
    steps = ["s1", "s2", "s3", "s4", "s5"]
    card = _make_card(steps)
    result = evaluate_seq(card, ["s5", "s4", "s3", "s2", "s1"], "exact", None)
    assert result.verdict == "incorrect"


# Tests: six steps (above the per-field cap, uses multiline fallback path)

def test_correct_six_steps_above_modal_cap():
    steps = [f"step{i}" for i in range(6)]
    card = _make_card(steps)
    result = evaluate_seq(card, steps[:], "exact", None)
    assert result.verdict == "correct"


def test_incorrect_six_steps_wrong_order():
    steps = [f"step{i}" for i in range(6)]
    card = _make_card(steps)
    shuffled = list(reversed(steps))
    result = evaluate_seq(card, shuffled, "exact", None)
    assert result.verdict == "incorrect"
