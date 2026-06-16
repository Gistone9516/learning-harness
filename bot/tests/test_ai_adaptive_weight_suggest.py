# -*- coding: utf-8 -*-
"""Headless tests for the ai_adaptive_weight_suggest capability.

Monkeypatches ai_caps._invoke so no live AI or Discord connection is needed.
Tests:
  1. Gate skip: when capability is disabled, _invoke is never called.
  2. Enabled + ok=True: returns strategy text from the AI result.
  3. Enabled + ok=False: degrades gracefully, returns None.
  4. Enabled + empty text: returns None (no blank strategies).
  5. Text passthrough: returned text is not required to contain numeric weights.
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
from caps_ai.ai_adaptive_weight_suggest import suggest_strategy


# Helpers

class _FakeCtx:
    """Minimal ctx stub for suggest_strategy tests."""
    def __init__(self, enabled: bool = True) -> None:
        self.ai_model = None
        self.ai_effort = "low"
        self.ai_persona = None
        self.enabled_capabilities = {"ai_adaptive_weight"} if enabled else set()
        self.channel = None
        self.user_id = "u456"


def _make_fake_invoke(text: str = "동사 문제에 집중하세요.", ok: bool = True):
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
    fake, log_ = _make_fake_invoke()
    ai_caps._invoke = fake

    result = asyncio.run(suggest_strategy(ctx, "틀린 문제: 동사 활용"))

    assert result is None, "Expected None when capability is disabled"
    assert len(log_) == 0, "AI must not be called when capability is disabled"


def test_enabled_ok_returns_strategy_text():
    """When enabled and AI returns ok=True, suggest_strategy returns the stripped text."""
    ctx = _FakeCtx(enabled=True)
    expected = "동사 활용 카드를 매일 복습하고 문장 생성 연습을 추가하세요."
    fake, log_ = _make_fake_invoke(text=f"  {expected}  ", ok=True)
    ai_caps._invoke = fake

    result = asyncio.run(suggest_strategy(ctx, "동사 활용 오답 3회"))

    assert result == expected, f"Expected strategy text '{expected}', got '{result}'"
    assert len(log_) == 1, "AI must be called exactly once"


def test_enabled_ok_false_returns_none():
    """When enabled but AI returns ok=False, suggest_strategy degrades gracefully and returns None."""
    ctx = _FakeCtx(enabled=True)
    fake, log_ = _make_fake_invoke(text="", ok=False)
    ai_caps._invoke = fake

    result = asyncio.run(suggest_strategy(ctx, "약점 요약"))

    assert result is None, "Expected None on AI failure"
    assert len(log_) == 1, "AI was called but must return None on failure"


def test_enabled_empty_text_returns_none():
    """When AI returns ok=True but empty/whitespace text, suggest_strategy returns None."""
    ctx = _FakeCtx(enabled=True)
    fake, log_ = _make_fake_invoke(text="   ", ok=True)
    ai_caps._invoke = fake

    result = asyncio.run(suggest_strategy(ctx, "약점 요약"))

    assert result is None, "Expected None when AI returns blank text"


def test_text_passthrough_no_numeric_weight_required():
    """Returned text is plain prose; no numeric weights are required or expected.

    This test verifies the spec constraint: the role forbids numeric weights so the
    returned text should be treated as opaque prose by the caller. We assert only that
    the text comes back unchanged (passthrough), not that it lacks digits, since the
    coach might legitimately say 'spend 2 hours on X' in prose.
    """
    ctx = _FakeCtx(enabled=True)
    prose = "이번 주는 접속사 표현 위주로 집중하세요. 오답 카드를 반복 학습하면 효과적입니다."
    fake, log_ = _make_fake_invoke(text=prose, ok=True)
    ai_caps._invoke = fake

    result = asyncio.run(suggest_strategy(ctx, "접속사 오답 다수"))

    assert result == prose, "Text must be returned as-is (stripped)"
    assert len(log_) == 1


if __name__ == "__main__":
    import traceback

    tests = [
        test_gate_disabled_invoke_not_called,
        test_enabled_ok_returns_strategy_text,
        test_enabled_ok_false_returns_none,
        test_enabled_empty_text_returns_none,
        test_text_passthrough_no_numeric_weight_required,
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
