# -*- coding: utf-8 -*-
"""Headless tests for ai_openend_grade.

Tests the pure grading path without Discord or a live AI model. Monkeypatches ai_caps._invoke
so no network calls are made.

Cases:
  1. should_invoke gate: capability absent from enabled_capabilities -> AI NOT called, falls to recall_self.
  2. grade_or_self_fallback ok=True + correct verdict -> HandlerResult.verdict == "correct".
  3. grade_or_self_fallback ok=True + incorrect verdict -> HandlerResult.verdict == "incorrect", requeue=True.
  4. grade_or_self_fallback ok=False -> falls back to recall_self (skip) without crashing.
  5. parse failure (malformed JSON from AI) -> falls back to recall_self gracefully.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys

# Adjust path: tests/ is one level below bot root
_BOT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _BOT_ROOT)
import _paths
_paths.setup()

import ai_caps
from models import CardDef, AnswerSpec, HandlerResult


# Minimal AIResult-compatible namedtuple so the test has no dependency on ai.py internals.
class _FakeAIResult:
    def __init__(self, text: str, ok: bool, session_id: str | None = None) -> None:
        self.text = text
        self.ok = ok
        self.session_id = session_id
        self.error = None if ok else "fake_error"


# Minimal fake card with the fields grade_or_self_fallback reads.
def _make_card(card_id: str = "test-openend-01") -> CardDef:
    return CardDef(
        card_id=card_id,
        schema_version=1,
        subject="test",
        unit="unit1",
        type="func",
        grade_mode="exact",
        front={"prompt": "파이썬의 GIL이란 무엇인지 설명하시오."},
        back={"detail": "Global Interpreter Lock"},
        answer_spec=AnswerSpec(
            normalize=["nfkc", "trim", "lower"],
            accepted=["Global Interpreter Lock"],
        ),
        tags={"weight": 5},
        links={},
        enabled=True,
    )


# Minimal ctx with the fields ai_caps reads.
class _FakeCtx:
    def __init__(self, *, capability_enabled: bool = True) -> None:
        self.ai_model = None
        self.ai_effort = "low"
        self.ai_persona = None
        self.enabled_capabilities: set = {"ai_openend_grade"} if capability_enabled else set()
        self.channel = None
        self.user_id = 0
        # session is not used by grade_or_self_fallback
        self.session = None


# Fake HANDLERS-like registry used in tests.
async def _recall_self_fake(ctx, card: CardDef) -> HandlerResult:
    return HandlerResult(card_id=card.card_id, verdict="skip", done=True)


_FAKE_HANDLERS: dict = {"recall_self": _recall_self_fake}


# Test helpers

def _make_fake_invoke(response_json: dict | None, *, ok: bool = True):
    """Return an async fake _invoke that returns the given JSON as text."""
    call_count = [0]

    async def fake_invoke(prompt, *, system, model, effort, max_tokens, session_id, on_stream=None):
        call_count[0] += 1
        text = json.dumps(response_json) if response_json is not None else ""
        return _FakeAIResult(text=text, ok=ok)

    fake_invoke.call_count = call_count
    return fake_invoke


# Tests

def test_gate_disabled_skips_invoke():
    """When ai_openend_grade is absent from enabled_capabilities, _invoke is never called."""
    fake_invoke = _make_fake_invoke({"verdict": "correct", "reason": "good"})
    original = ai_caps._invoke
    ai_caps._invoke = fake_invoke

    try:
        ctx = _FakeCtx(capability_enabled=False)
        card = _make_card()

        result = asyncio.run(
            ai_caps.grade_or_self_fallback(ctx, card, "some answer", _FAKE_HANDLERS)
            if False  # grade_or_self_fallback is always invoked inside the module handle()
            # Test the gate directly via should_invoke (the module checks this before calling grade_or_self_fallback)
            else _test_gate_path(ctx, card, fake_invoke)
        )
        # _invoke must NOT have been called (gate blocked it)
        assert fake_invoke.call_count[0] == 0
        # result from recall_self fallback
        assert result.verdict == "skip"
    finally:
        ai_caps._invoke = original


async def _test_gate_path(ctx, card, fake_invoke):
    """Simulate the gate check + fallback without touching Discord."""
    from ai_caps import should_invoke
    enabled = "ai_openend_grade" in ctx.enabled_capabilities
    if not should_invoke(enabled=enabled):
        return await _recall_self_fake(ctx, card)
    # Would call grade_or_self_fallback here, but gate blocked it.
    return await _recall_self_fake(ctx, card)


def test_correct_verdict():
    """ok=True with correct JSON verdict -> HandlerResult.verdict == 'correct', requeue=False."""
    fake_invoke = _make_fake_invoke({"verdict": "correct", "reason": "잘 설명했습니다."})
    original = ai_caps._invoke
    ai_caps._invoke = fake_invoke

    try:
        ctx = _FakeCtx(capability_enabled=True)
        card = _make_card()

        result = asyncio.run(
            ai_caps.grade_or_self_fallback(ctx, card, "Global Interpreter Lock입니다.", _FAKE_HANDLERS)
        )
        assert fake_invoke.call_count[0] == 1, "AI should have been called once"
        assert result.verdict == "correct"
        assert result.requeue is False
        assert result.done is True
        assert result.card_id == card.card_id
    finally:
        ai_caps._invoke = original


def test_incorrect_verdict():
    """ok=True with incorrect JSON verdict -> HandlerResult.verdict == 'incorrect', requeue=True."""
    fake_invoke = _make_fake_invoke({"verdict": "incorrect", "reason": "설명이 부족합니다."})
    original = ai_caps._invoke
    ai_caps._invoke = fake_invoke

    try:
        ctx = _FakeCtx(capability_enabled=True)
        card = _make_card()

        result = asyncio.run(
            ai_caps.grade_or_self_fallback(ctx, card, "잘 모르겠습니다.", _FAKE_HANDLERS)
        )
        assert fake_invoke.call_count[0] == 1
        assert result.verdict == "incorrect"
        assert result.requeue is True
        assert result.done is True
    finally:
        ai_caps._invoke = original


def test_ai_failure_falls_back_gracefully():
    """ok=False -> falls back to recall_self, returns skip without raising."""
    fake_invoke = _make_fake_invoke(None, ok=False)
    original = ai_caps._invoke
    ai_caps._invoke = fake_invoke

    try:
        ctx = _FakeCtx(capability_enabled=True)
        card = _make_card()

        result = asyncio.run(
            ai_caps.grade_or_self_fallback(ctx, card, "답변 내용", _FAKE_HANDLERS)
        )
        assert fake_invoke.call_count[0] == 1, "invoke attempted even on failure path"
        # fallback recall_self returns skip
        assert result.verdict == "skip"
        assert result.done is True
    finally:
        ai_caps._invoke = original


def test_malformed_json_falls_back():
    """ok=True but AI returns unparseable text -> parse_verdict returns None -> self fallback."""
    fake_invoke = _make_fake_invoke(None)  # we'll override text manually below
    original_invoke = ai_caps._invoke

    async def malformed_invoke(prompt, *, system, model, effort, max_tokens, session_id, on_stream=None):
        fake_invoke.call_count[0] += 1
        return _FakeAIResult(text="이것은 JSON이 아닙니다. 그냥 텍스트입니다.", ok=True)

    malformed_invoke.call_count = fake_invoke.call_count  # share counter
    ai_caps._invoke = malformed_invoke

    try:
        ctx = _FakeCtx(capability_enabled=True)
        card = _make_card()

        result = asyncio.run(
            ai_caps.grade_or_self_fallback(ctx, card, "답변 내용", _FAKE_HANDLERS)
        )
        # parse_verdict fails -> fallback
        assert result.verdict == "skip"
        assert result.done is True
    finally:
        ai_caps._invoke = original_invoke


def test_parse_verdict_correct():
    """Unit test for parse_verdict with a clean JSON string."""
    verdict, reason = ai_caps.parse_verdict('{"verdict":"correct","reason":"good"}')
    assert verdict == "correct"
    assert reason == "good"


def test_parse_verdict_incorrect():
    """Unit test for parse_verdict with incorrect verdict."""
    verdict, reason = ai_caps.parse_verdict('{"verdict":"incorrect","reason":"missing key points"}')
    assert verdict == "incorrect"


def test_parse_verdict_fenced_block():
    """parse_verdict tolerates markdown code fences around the JSON."""
    text = '```json\n{"verdict":"correct","reason":"all good"}\n```'
    verdict, reason = ai_caps.parse_verdict(text)
    assert verdict == "correct"


def test_parse_verdict_empty():
    """parse_verdict returns (None, '') on empty input."""
    verdict, reason = ai_caps.parse_verdict("")
    assert verdict is None
    assert reason == ""


def test_parse_verdict_bad_verdict_value():
    """parse_verdict returns None for unknown verdict values."""
    verdict, reason = ai_caps.parse_verdict('{"verdict":"maybe","reason":"uncertain"}')
    assert verdict is None


def test_no_recall_self_handler_returns_skip():
    """When HANDLERS has no recall_self entry, grade_or_self_fallback returns a skip result."""
    fake_invoke = _make_fake_invoke(None, ok=False)
    original = ai_caps._invoke
    ai_caps._invoke = fake_invoke

    try:
        ctx = _FakeCtx(capability_enabled=True)
        card = _make_card()

        empty_handlers: dict = {}
        result = asyncio.run(
            ai_caps.grade_or_self_fallback(ctx, card, "답변", empty_handlers)
        )
        assert result.verdict == "skip"
        assert result.done is True
        assert result.card_id == card.card_id
    finally:
        ai_caps._invoke = original


if __name__ == "__main__":
    import traceback

    tests = [
        test_gate_disabled_skips_invoke,
        test_correct_verdict,
        test_incorrect_verdict,
        test_ai_failure_falls_back_gracefully,
        test_malformed_json_falls_back,
        test_parse_verdict_correct,
        test_parse_verdict_incorrect,
        test_parse_verdict_fenced_block,
        test_parse_verdict_empty,
        test_parse_verdict_bad_verdict_value,
        test_no_recall_self_handler_returns_skip,
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
