# -*- coding: utf-8 -*-
"""Headless tests for the ai_hint capability.

Monkeypatches ai_caps._invoke so no live AI or Discord connection is needed.
Tests:
  1. Gate skip: when capability is disabled, _invoke is never called.
  2. Gate skip: when level > _MAX_LEVEL, _invoke is never called.
  3. Enabled + ok=True: returns the hint text from the AI result.
  4. Enabled + ok=False: degrades gracefully, returns None.
  5. Enabled + empty text: returns None (no blank hints).
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
from models import CardDef, AnswerSpec
from caps_ai.ai_hint import ai_hint


# Helpers

def _make_card(prompt: str = "What is X?") -> CardDef:
    """Minimal CardDef with a simple prompt."""
    return CardDef(
        card_id="hint-test-01",
        schema_version=1,
        subject="test",
        unit="unit1",
        type="func",
        grade_mode="exact",
        front={"prompt": prompt},
        back={"answer": "X"},
        answer_spec=AnswerSpec(normalize=["trim"], accepted=["X"]),
        tags={},
        links={},
    )


class _FakeCtx:
    """Minimal ctx stub for ai_hint tests."""
    def __init__(self, enabled: bool = True) -> None:
        self.ai_model = None
        self.ai_effort = "low"
        self.ai_persona = None
        self.enabled_capabilities = {"ai_hint"} if enabled else set()
        self.channel = None
        self.user_id = "u123"


def _make_fake_invoke(text: str = "힌트입니다.", ok: bool = True):
    """Return a fake _invoke coroutine and a call-count tracker."""
    call_log: list[dict] = []

    async def fake_invoke(prompt, *, system=None, model=None, effort="low",
                          max_tokens=None, session_id=None, on_stream=None):
        call_log.append({"prompt": prompt, "system": system})
        return AIResult(text=text, ok=ok, error=None if ok else "simulated error", session_id=None)

    return fake_invoke, call_log


# Tests

def test_gate_disabled_invoke_not_called():
    """should_invoke returns False when capability is disabled; _invoke must not be called."""
    ctx = _FakeCtx(enabled=False)
    card = _make_card()
    fake, log_ = _make_fake_invoke()
    ai_caps._invoke = fake

    result = asyncio.run(ai_hint(ctx, card, level=1))

    assert result is None, "Expected None when gated by disabled capability"
    assert len(log_) == 0, "AI must not be called when capability is disabled"


def test_gate_level_too_high_invoke_not_called():
    """should_invoke condition=False when level > _MAX_LEVEL (3); _invoke must not be called."""
    ctx = _FakeCtx(enabled=True)
    card = _make_card()
    fake, log_ = _make_fake_invoke()
    ai_caps._invoke = fake

    result = asyncio.run(ai_hint(ctx, card, level=4))

    assert result is None, "Expected None for level > MAX_LEVEL"
    assert len(log_) == 0, "AI must not be called when level exceeds max"


def test_enabled_ok_returns_hint_text():
    """When enabled and AI returns ok=True, ai_hint returns the stripped hint text."""
    ctx = _FakeCtx(enabled=True)
    card = _make_card()
    expected = "이것은 X와 관련된 개념입니다."
    fake, log_ = _make_fake_invoke(text=f"  {expected}  ", ok=True)
    ai_caps._invoke = fake

    result = asyncio.run(ai_hint(ctx, card, level=1))

    assert result == expected, f"Expected hint text '{expected}', got '{result}'"
    assert len(log_) == 1, "AI must be called exactly once"


def test_enabled_ok_false_returns_none():
    """When enabled but AI returns ok=False, ai_hint degrades gracefully and returns None."""
    ctx = _FakeCtx(enabled=True)
    card = _make_card()
    fake, log_ = _make_fake_invoke(text="", ok=False)
    ai_caps._invoke = fake

    result = asyncio.run(ai_hint(ctx, card, level=2))

    assert result is None, "Expected None on AI failure"
    assert len(log_) == 1, "AI was called but must return None on failure"


def test_enabled_empty_text_returns_none():
    """When AI returns ok=True but empty/whitespace text, ai_hint returns None (no blank hints)."""
    ctx = _FakeCtx(enabled=True)
    card = _make_card()
    fake, log_ = _make_fake_invoke(text="   ", ok=True)
    ai_caps._invoke = fake

    result = asyncio.run(ai_hint(ctx, card, level=1))

    assert result is None, "Expected None when AI returns blank text"


def test_level_3_boundary_is_allowed():
    """Level 3 (the max) must pass the gate and call AI."""
    ctx = _FakeCtx(enabled=True)
    card = _make_card()
    fake, log_ = _make_fake_invoke(text="최종 힌트", ok=True)
    ai_caps._invoke = fake

    result = asyncio.run(ai_hint(ctx, card, level=3))

    assert result == "최종 힌트"
    assert len(log_) == 1, "Level 3 must be allowed through the gate"


if __name__ == "__main__":
    import traceback

    tests = [
        test_gate_disabled_invoke_not_called,
        test_gate_level_too_high_invoke_not_called,
        test_enabled_ok_returns_hint_text,
        test_enabled_ok_false_returns_none,
        test_enabled_empty_text_returns_none,
        test_level_3_boundary_is_allowed,
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
