# -*- coding: utf-8 -*-
"""Headless tests for caps_ai/ai_personal_feedback.

Tests the should_invoke gate, successful AI response handling, and graceful
degradation on AI failure. No live Discord or network connection required.
Monkeypatches ai_caps._invoke with an async fake.
"""
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import ai_caps
from ai import AIResult
from caps_ai.ai_personal_feedback import personal_feedback, CAP_ID, _build_data, _correct_answer
from models import CardDef, AnswerSpec


# Helpers


def _make_card(card_id: str = "test-card-01", accepted: list[str] | None = None) -> CardDef:
    """Build a minimal CardDef for testing."""
    return CardDef(
        card_id=card_id,
        schema_version=1,
        subject="test",
        unit="unit1",
        type="func",
        grade_mode="exact",
        front={"prompt": "What is X?"},
        back={"answer": "correct answer"},
        answer_spec=AnswerSpec(normalize=["trim"], accepted=accepted or ["correct answer"]),
        tags={},
        links={},
    )


class _FakeCtx:
    """Minimal ctx stub for headless testing."""

    def __init__(self, enabled: bool = True):
        self.enabled_capabilities: set = {CAP_ID} if enabled else set()
        self.ai_model = None
        self.ai_effort = "low"
        self.ai_persona = None


def _make_fake_invoke(text: str, ok: bool, error: str | None = None):
    """Return an async fake that records whether it was called."""
    call_log: list[dict] = []

    async def _fake(prompt, *, system=None, model=None, effort="low",
                    max_tokens=None, session_id=None, on_stream=None):
        call_log.append({"prompt": prompt, "system": system})
        return AIResult(text=text, ok=ok, error=error, session_id=None)

    return _fake, call_log


# Gate tests


def test_gate_off_skips_invoke():
    """When ai_personal_feedback is not in enabled_capabilities, _invoke is never called."""
    ctx = _FakeCtx(enabled=False)
    card = _make_card()
    fake, log = _make_fake_invoke("some text", ok=True)

    original = ai_caps._invoke
    ai_caps._invoke = fake
    try:
        result = asyncio.run(personal_feedback(ctx, card, "wrong answer", []))
    finally:
        ai_caps._invoke = original

    assert result is None
    assert len(log) == 0


def test_gate_on_calls_invoke():
    """When the capability is enabled, _invoke is called exactly once."""
    ctx = _FakeCtx(enabled=True)
    card = _make_card()
    fake, log = _make_fake_invoke("격려 피드백입니다.", ok=True)

    original = ai_caps._invoke
    ai_caps._invoke = fake
    try:
        result = asyncio.run(personal_feedback(ctx, card, "wrong answer", []))
    finally:
        ai_caps._invoke = original

    assert len(log) == 1
    assert result == "격려 피드백입니다."


# Success path tests


def test_returns_feedback_text_on_ok():
    """Returns the AI text stripped of whitespace when ok=True."""
    ctx = _FakeCtx(enabled=True)
    card = _make_card()
    feedback_text = "  틀린 이유는 이렇습니다.  "
    fake, _ = _make_fake_invoke(feedback_text, ok=True)

    original = ai_caps._invoke
    ai_caps._invoke = fake
    try:
        result = asyncio.run(personal_feedback(ctx, card, "오답", []))
    finally:
        ai_caps._invoke = original

    assert result == "틀린 이유는 이렇습니다."


def test_recent_wrongs_included_in_invoke_system():
    """recent_wrongs content appears in the system preamble passed to _invoke."""
    ctx = _FakeCtx(enabled=True)
    card = _make_card("card-x")
    wrongs = [("card-a", "잘못된 답", "올바른 답")]
    fake, log = _make_fake_invoke("피드백", ok=True)

    original = ai_caps._invoke
    ai_caps._invoke = fake
    try:
        asyncio.run(personal_feedback(ctx, card, "틀린 답", wrongs))
    finally:
        ai_caps._invoke = original

    assert len(log) == 1
    system_text = log[0]["system"] or ""
    assert "card-a" in system_text
    assert "잘못된 답" in system_text


def test_no_recent_wrongs_still_works():
    """Empty recent_wrongs list does not cause errors."""
    ctx = _FakeCtx(enabled=True)
    card = _make_card()
    fake, log = _make_fake_invoke("피드백 텍스트", ok=True)

    original = ai_caps._invoke
    ai_caps._invoke = fake
    try:
        result = asyncio.run(personal_feedback(ctx, card, "오답", []))
    finally:
        ai_caps._invoke = original

    assert result == "피드백 텍스트"
    assert len(log) == 1


# Graceful degradation on failure


def test_returns_none_on_ok_false():
    """Returns None when the AI call returns ok=False; does not raise."""
    ctx = _FakeCtx(enabled=True)
    card = _make_card()
    fake, _ = _make_fake_invoke("", ok=False, error="simulated error")

    original = ai_caps._invoke
    ai_caps._invoke = fake
    try:
        result = asyncio.run(personal_feedback(ctx, card, "오답", []))
    finally:
        ai_caps._invoke = original

    assert result is None


def test_returns_none_on_empty_text():
    """Returns None when the AI returns an empty string (blank response)."""
    ctx = _FakeCtx(enabled=True)
    card = _make_card()
    fake, _ = _make_fake_invoke("   ", ok=True)

    original = ai_caps._invoke
    ai_caps._invoke = fake
    try:
        result = asyncio.run(personal_feedback(ctx, card, "오답", []))
    finally:
        ai_caps._invoke = original

    assert result is None


# Pure helper tests (no AI call needed)


def test_correct_answer_from_accepted():
    """_correct_answer picks the first accepted answer from the spec."""
    card = _make_card(accepted=["정답A", "정답B"])
    assert _correct_answer(card) == "정답A"


def test_correct_answer_fallback_to_back():
    """_correct_answer falls back to back.answer when spec has no accepted list."""
    card = CardDef(
        card_id="fb-card",
        schema_version=1,
        subject="s",
        unit="u",
        type="func",
        grade_mode="self",
        front={"prompt": "Q"},
        back={"answer": "백 정답"},
        answer_spec=None,
        tags={},
        links={},
    )
    assert _correct_answer(card) == "백 정답"


def test_build_data_trims_to_last_3_wrongs():
    """_build_data includes at most the last 3 recent wrong entries."""
    card = _make_card()
    wrongs = [
        ("c1", "a1", "r1"),
        ("c2", "a2", "r2"),
        ("c3", "a3", "r3"),
        ("c4", "a4", "r4"),  # oldest entry after trim
    ]
    data = _build_data(card, "오답", wrongs)
    # The first entry c1 was trimmed away; c2, c3, c4 remain.
    assert "c1" not in data
    assert "c2" in data
    assert "c3" in data
    assert "c4" in data


def test_build_data_contains_user_answer_and_correct():
    """_build_data always includes the current user_answer and correct answer."""
    card = _make_card(accepted=["올바른 답"])
    data = _build_data(card, "틀린 답", [])
    assert "틀린 답" in data
    assert "올바른 답" in data


def test_cap_id_constant():
    assert CAP_ID == "ai_personal_feedback"


if __name__ == "__main__":
    import traceback

    tests = [
        test_gate_off_skips_invoke,
        test_gate_on_calls_invoke,
        test_returns_feedback_text_on_ok,
        test_recent_wrongs_included_in_invoke_system,
        test_no_recent_wrongs_still_works,
        test_returns_none_on_ok_false,
        test_returns_none_on_empty_text,
        test_correct_answer_from_accepted,
        test_correct_answer_fallback_to_back,
        test_build_data_trims_to_last_3_wrongs,
        test_build_data_contains_user_answer_and_correct,
        test_cap_id_constant,
    ]
    passed = 0
    failed = 0
    for fn in tests:
        try:
            fn()
            print(f"  PASS  {fn.__name__}")
            passed += 1
        except Exception:
            print(f"  FAIL  {fn.__name__}")
            traceback.print_exc()
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(0 if failed == 0 else 1)
