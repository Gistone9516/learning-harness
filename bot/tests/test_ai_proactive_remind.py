# -*- coding: utf-8 -*-
"""Headless tests for the ai_proactive_remind capability.

Monkeypatches ai_caps._invoke so no live AI or Discord connection is needed.
Tests:
  1. Gate skip (due_count == 0): _invoke is never called.
  2. Gate skip (capability disabled): _invoke is never called even when due > 0.
  3. Enabled + due > 0 + ok=True: returns stripped nudge text.
  4. Enabled + due > 0 + ok=False: degrades gracefully, returns None.
  5. Enabled + due > 0 + blank text: returns None (no blank nudges).
  6. due_titles included in the data slice sent to AI.
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
from caps_ai.ai_proactive_remind import proactive_remind


# Helpers

class _FakeCtx:
    """Minimal ctx stub for ai_proactive_remind tests."""

    def __init__(self, enabled: bool = True) -> None:
        self.ai_model = None
        self.ai_effort = "low"
        self.ai_persona = None
        self.enabled_capabilities = {"ai_proactive_remind"} if enabled else set()
        self.channel = None
        self.user_id = "u999"


def _make_fake_invoke(text: str = "오늘 카드를 복습할 시간입니다!", ok: bool = True):
    """Return a fake async _invoke and a call log list."""
    call_log: list[dict] = []

    async def fake_invoke(prompt, *, system=None, model=None, effort="low",
                          max_tokens=None, session_id=None, on_stream=None):
        call_log.append({"prompt": prompt, "system": system})
        return AIResult(text=text, ok=ok, error=None if ok else "simulated error", session_id=None)

    return fake_invoke, call_log


# Tests

def test_gate_due_zero_invoke_not_called():
    """due_count == 0 must short-circuit before calling AI."""
    ctx = _FakeCtx(enabled=True)
    fake, log_ = _make_fake_invoke()
    ai_caps._invoke = fake

    result = asyncio.run(proactive_remind(ctx, due_count=0))

    assert result is None, "Expected None when due_count is 0"
    assert len(log_) == 0, "AI must not be called when due_count is 0"


def test_gate_disabled_invoke_not_called():
    """Disabled capability must not call AI even when due_count > 0."""
    ctx = _FakeCtx(enabled=False)
    fake, log_ = _make_fake_invoke()
    ai_caps._invoke = fake

    result = asyncio.run(proactive_remind(ctx, due_count=5))

    assert result is None, "Expected None when capability is disabled"
    assert len(log_) == 0, "AI must not be called when capability is disabled"


def test_enabled_due_positive_ok_returns_text():
    """Enabled + due > 0 + ok=True returns the stripped nudge text."""
    ctx = _FakeCtx(enabled=True)
    expected = "지금 바로 복습을 시작해보세요!"
    fake, log_ = _make_fake_invoke(text=f"  {expected}  ", ok=True)
    ai_caps._invoke = fake

    result = asyncio.run(proactive_remind(ctx, due_count=3))

    assert result == expected, f"Expected '{expected}', got '{result}'"
    assert len(log_) == 1, "AI must be called exactly once"


def test_enabled_ok_false_returns_none():
    """When AI returns ok=False the capability degrades gracefully to None."""
    ctx = _FakeCtx(enabled=True)
    fake, log_ = _make_fake_invoke(text="", ok=False)
    ai_caps._invoke = fake

    result = asyncio.run(proactive_remind(ctx, due_count=2))

    assert result is None, "Expected None on AI failure"
    assert len(log_) == 1, "AI was attempted but must return None on failure"


def test_enabled_blank_text_returns_none():
    """ok=True but whitespace-only response must return None."""
    ctx = _FakeCtx(enabled=True)
    fake, log_ = _make_fake_invoke(text="   ", ok=True)
    ai_caps._invoke = fake

    result = asyncio.run(proactive_remind(ctx, due_count=1))

    assert result is None, "Expected None when AI returns blank text"


def test_due_titles_included_in_prompt():
    """Card titles are included in the system preamble data slice sent to AI."""
    ctx = _FakeCtx(enabled=True)
    titles = ["운영체제", "네트워크", "알고리즘"]
    fake, log_ = _make_fake_invoke(text="복습할 카드가 있습니다.", ok=True)
    ai_caps._invoke = fake

    asyncio.run(proactive_remind(ctx, due_count=3, due_titles=titles))

    assert len(log_) == 1
    system_text = log_[0]["system"]
    # Verify at least one title made it into the system preamble.
    assert "운영체제" in system_text, "Expected card title in system preamble"


def test_titles_capped_at_five():
    """More than 5 titles are truncated to avoid bloating the preamble."""
    ctx = _FakeCtx(enabled=True)
    titles = [f"과목{i}" for i in range(10)]
    fake, log_ = _make_fake_invoke(text="열심히 해봐요!", ok=True)
    ai_caps._invoke = fake

    asyncio.run(proactive_remind(ctx, due_count=10, due_titles=titles))

    system_text = log_[0]["system"]
    # Titles 0-4 should appear; title 5 and beyond should not.
    assert "과목4" in system_text, "Expected 5th title in preamble"
    assert "과목5" not in system_text, "6th+ title must be trimmed from preamble"


if __name__ == "__main__":
    import traceback

    tests = [
        test_gate_due_zero_invoke_not_called,
        test_gate_disabled_invoke_not_called,
        test_enabled_due_positive_ok_returns_text,
        test_enabled_ok_false_returns_none,
        test_enabled_blank_text_returns_none,
        test_due_titles_included_in_prompt,
        test_titles_capped_at_five,
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
