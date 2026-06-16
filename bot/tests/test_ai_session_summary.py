# -*- coding: utf-8 -*-
"""Headless tests for the ai_session_summary capability.

Monkeypatches ai_caps._invoke so no live AI or Discord connection is needed.

Tests:
  1. Gate skip: when total_attempts == 0, _invoke is never called.
  2. Gate skip: when capability is disabled (not in enabled_capabilities), _invoke is never called.
  3. Enabled + total_attempts > 0 + ok=True: returns stripped journal text.
  4. Enabled + total_attempts > 0 + ok=False: degrades gracefully, returns None.
  5. Enabled + total_attempts > 0 + ok=True but empty text: returns None.
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
from caps_ai.ai_session_summary import session_summary


# Helpers

class _FakeStats:
    """Minimal stats stub matching Session.stats fields."""

    def __init__(
        self,
        total_attempts: int = 10,
        correct: int = 7,
        box_advances: int = 5,
        box_demotions: int = 1,
        skipped: int = 0,
    ) -> None:
        self.total_attempts = total_attempts
        self.correct = correct
        self.box_advances = box_advances
        self.box_demotions = box_demotions
        self.skipped = skipped


class _FakeCtx:
    """Minimal ctx stub for ai_session_summary tests."""

    def __init__(self, enabled: bool = True) -> None:
        self.ai_model = None
        self.ai_effort = "low"
        self.ai_persona = None
        self.enabled_capabilities = {"ai_session_summary"} if enabled else set()
        self.channel = None
        self.user_id = "u999"


def _make_fake_invoke(text: str = "오늘 세션 수고했어요.", ok: bool = True):
    """Return a fake _invoke coroutine and a call-count log list."""
    call_log: list[dict] = []

    async def fake_invoke(
        prompt,
        *,
        system=None,
        model=None,
        effort="low",
        max_tokens=None,
        session_id=None,
        on_stream=None,
    ):
        call_log.append({"prompt": prompt, "system": system})
        return AIResult(
            text=text,
            ok=ok,
            error=None if ok else "simulated error",
            session_id=None,
        )

    return fake_invoke, call_log


# Tests

def test_gate_zero_attempts_invoke_not_called():
    """When total_attempts == 0, should_invoke condition is False and _invoke must not be called."""
    ctx = _FakeCtx(enabled=True)
    stats = _FakeStats(total_attempts=0)
    fake, log_ = _make_fake_invoke()
    ai_caps._invoke = fake

    result = asyncio.run(session_summary(ctx, stats))

    assert result is None, "Expected None when total_attempts is zero"
    assert len(log_) == 0, "AI must not be called when total_attempts == 0"


def test_gate_disabled_invoke_not_called():
    """When capability is not in enabled_capabilities, _invoke must not be called."""
    ctx = _FakeCtx(enabled=False)
    stats = _FakeStats(total_attempts=5)
    fake, log_ = _make_fake_invoke()
    ai_caps._invoke = fake

    result = asyncio.run(session_summary(ctx, stats))

    assert result is None, "Expected None when capability is disabled"
    assert len(log_) == 0, "AI must not be called when capability is disabled"


def test_enabled_ok_returns_journal_text():
    """When enabled, total_attempts > 0, and AI ok=True, returns stripped journal text."""
    ctx = _FakeCtx(enabled=True)
    stats = _FakeStats(total_attempts=10, correct=7)
    expected = "오늘 세션 잘 하셨어요. 다음에도 화이팅!"
    fake, log_ = _make_fake_invoke(text=f"  {expected}  ", ok=True)
    ai_caps._invoke = fake

    result = asyncio.run(session_summary(ctx, stats))

    assert result == expected, f"Expected '{expected}', got '{result}'"
    assert len(log_) == 1, "AI must be called exactly once"


def test_enabled_ok_false_returns_none():
    """When AI returns ok=False, session_summary degrades gracefully and returns None."""
    ctx = _FakeCtx(enabled=True)
    stats = _FakeStats(total_attempts=3)
    fake, log_ = _make_fake_invoke(text="", ok=False)
    ai_caps._invoke = fake

    result = asyncio.run(session_summary(ctx, stats))

    assert result is None, "Expected None on AI failure"
    assert len(log_) == 1, "AI was called but must return None on failure"


def test_enabled_empty_text_returns_none():
    """When AI returns ok=True but blank text, session_summary returns None."""
    ctx = _FakeCtx(enabled=True)
    stats = _FakeStats(total_attempts=4)
    fake, log_ = _make_fake_invoke(text="   ", ok=True)
    ai_caps._invoke = fake

    result = asyncio.run(session_summary(ctx, stats))

    assert result is None, "Expected None when AI returns blank text"


if __name__ == "__main__":
    import traceback

    tests = [
        test_gate_zero_attempts_invoke_not_called,
        test_gate_disabled_invoke_not_called,
        test_enabled_ok_returns_journal_text,
        test_enabled_ok_false_returns_none,
        test_enabled_empty_text_returns_none,
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
