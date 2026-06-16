# -*- coding: utf-8 -*-
"""Headless tests for mcq_select pure core (evaluate_choice + build_feedback_text).

No live discord connection required. All assertions target the pure functions.
"""
from __future__ import annotations

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

from models import CardDef, AnswerSpec, HandlerResult
from handlers.mcq_select import evaluate_choice, build_feedback_text
from scoring import score
from models import ScoreInput


# Helpers -----------------------------------------------------------------------

def _make_card(
    card_id: str = "test-card-001",
    options: list[str] | None = None,
    accepted: list[str] | None = None,
    grade_mode: str = "exact",
    detail: str = "",
) -> CardDef:
    """Build a minimal judge CardDef for testing."""
    if options is None:
        options = ["선택지 A", "선택지 B", "선택지 C", "선택지 D", "선택지 E", "선택지 F"]
    spec = None
    if accepted is not None:
        spec = AnswerSpec(normalize=["nfkc", "trim"], accepted=accepted)
    return CardDef(
        card_id=card_id,
        schema_version=1,
        subject="테스트과목",
        unit="1단원",
        type="judge",
        grade_mode=grade_mode,
        front={"scenario": "올바른 선택지를 고르시오.", "options": options},
        back={"detail": detail},
        answer_spec=spec,
        tags={"weight": 5},
        links={},
        enabled=True,
    )


# evaluate_choice tests ---------------------------------------------------------

def test_timeout_returns_skip():
    card = _make_card(accepted=["선택지 A"])
    result = evaluate_choice(card, None, "exact", None)
    assert isinstance(result, HandlerResult)
    assert result.verdict == "skip"
    assert result.card_id == card.card_id
    assert result.done is True


def test_no_answer_spec_returns_skip():
    card = _make_card(accepted=None)
    result = evaluate_choice(card, "선택지 A", "exact", None)
    assert result.verdict == "skip"


def test_self_grade_mode_returns_skip():
    card = _make_card(accepted=["선택지 A"])
    result = evaluate_choice(card, "선택지 A", "self", None)
    assert result.verdict == "skip"


def test_correct_choice_returns_correct():
    card = _make_card(accepted=["선택지 A"])
    result = evaluate_choice(card, "선택지 A", "exact", None)
    assert result.verdict == "correct"
    assert result.requeue is False
    assert result.done is True


def test_incorrect_choice_returns_incorrect_with_requeue():
    card = _make_card(accepted=["선택지 A"])
    result = evaluate_choice(card, "선택지 B", "exact", None)
    assert result.verdict == "incorrect"
    assert result.requeue is True
    assert result.done is True


def test_correct_with_multiple_accepted():
    card = _make_card(accepted=["선택지 A", "선택지 C"])
    r1 = evaluate_choice(card, "선택지 A", "exact", None)
    assert r1.verdict == "correct"
    r2 = evaluate_choice(card, "선택지 C", "exact", None)
    assert r2.verdict == "correct"


def test_wrong_option_not_in_accepted():
    card = _make_card(accepted=["선택지 A", "선택지 C"])
    result = evaluate_choice(card, "선택지 D", "exact", None)
    assert result.verdict == "incorrect"


def test_card_id_preserved_in_result():
    card = _make_card(card_id="my-special-card", accepted=["선택지 A"])
    result = evaluate_choice(card, "선택지 A", "exact", None)
    assert result.card_id == "my-special-card"


# build_feedback_text tests -----------------------------------------------------

def _score_for(card: CardDef, chosen: str, mode: str = "exact"):
    return score(ScoreInput(
        mode=mode,
        user_answer=chosen,
        answer_spec=card.answer_spec,
        synonyms=None,
    ))


def test_feedback_correct_shows_matched():
    card = _make_card(accepted=["선택지 A"])
    sr = _score_for(card, "선택지 A")
    fb = build_feedback_text(card, "선택지 A", sr)
    assert "정답!" in fb
    assert "선택지 A" in fb


def test_feedback_incorrect_shows_correct_answer():
    card = _make_card(accepted=["선택지 A"])
    sr = _score_for(card, "선택지 B")
    fb = build_feedback_text(card, "선택지 B", sr)
    assert "오답" in fb
    assert "선택지 A" in fb


def test_feedback_includes_detail():
    card = _make_card(accepted=["선택지 A"], detail="이것이 이유입니다.")
    sr = _score_for(card, "선택지 B")
    fb = build_feedback_text(card, "선택지 B", sr)
    assert "이것이 이유입니다." in fb


def test_feedback_no_detail_when_empty():
    card = _make_card(accepted=["선택지 A"], detail="")
    sr = _score_for(card, "선택지 A")
    fb = build_feedback_text(card, "선택지 A", sr)
    assert fb.strip() != ""
    # No trailing newline from empty detail
    assert not fb.endswith("\n")


def test_feedback_no_spec_safe(monkeypatch):
    # build_feedback_text is called only when spec exists and scoring succeeded,
    # but guard: if accepted is empty, correct_ans falls back to "?"
    card = _make_card(accepted=[])
    # Patch answer_spec so accepted is empty list
    from models import AnswerSpec
    card.answer_spec = AnswerSpec(normalize=[], accepted=[])
    # simulate an incorrect score result with no matched
    class FakeResult:
        matched = []
        verdict = "incorrect"
    fb = build_feedback_text(card, "선택지 X", FakeResult())
    assert "?" in fb


# Options boundary test ---------------------------------------------------------

def test_many_options_correct_still_works():
    options = [f"선택지 {i}" for i in range(20)]
    card = _make_card(options=options, accepted=["선택지 7"])
    result = evaluate_choice(card, "선택지 7", "exact", None)
    assert result.verdict == "correct"

    result2 = evaluate_choice(card, "선택지 3", "exact", None)
    assert result2.verdict == "incorrect"
