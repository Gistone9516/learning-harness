# -*- coding: utf-8 -*-
"""Headless tests for the ai_socratic capability.

Tests:
1. should_invoke gate: when "ai_socratic" is not in enabled_capabilities, the
   fake _invoke is never called.
2. First turn mints a new session id onto ctx.session.claude_sid.
3. Second turn passes the session id back (resume path).
4. Graceful handling when AI returns ok=False (no crash, returns None from build_turn).
5. build_turn returns None when capability is disabled.
"""
from __future__ import annotations

import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import ai_caps
from caps_ai.ai_socratic import build_turn, CAP_ID


# Minimal stubs

class _Session:
    """Minimal Session stub with the fields ConvManager needs."""
    def __init__(self):
        self.claude_sid = None
        self.turns = []


class _Ctx:
    """Minimal Ctx stub for Socratic tests."""
    def __init__(self, enabled: bool = True):
        self.ai_model = None
        self.ai_effort = "low"
        self.ai_persona = None
        self.enabled_capabilities = {"ai_socratic"} if enabled else set()
        self.session = _Session()
        self.channel = None
        self.user_id = 12345


def _make_fake_invoke(responses: list[dict]):
    """Build a fake _invoke that returns AIResult objects from a pre-built response list."""
    from ai import AIResult
    call_log = []
    responses_iter = iter(responses)

    async def fake_invoke(prompt, *, system=None, model=None, effort="low",
                          max_tokens=None, session_id=None, on_stream=None):
        call_log.append({"prompt": prompt, "session_id": session_id})
        resp = next(responses_iter, {"text": "fallback question?", "ok": True, "session_id": None})
        return AIResult(
            text=resp.get("text", ""),
            ok=resp.get("ok", True),
            error=resp.get("error", None),
            session_id=resp.get("session_id", None),
        )

    return fake_invoke, call_log


# Test 1: should_invoke gate skips AI when capability is disabled

def test_gate_disabled_skips_ai():
    ctx = _Ctx(enabled=False)
    fake, call_log = _make_fake_invoke([{"text": "Q?", "ok": True, "session_id": "s-abc"}])

    original = ai_caps._invoke
    ai_caps._invoke = fake
    try:
        result = asyncio.run(build_turn(ctx, "my answer"))
    finally:
        ai_caps._invoke = original

    assert result is None, "Expected None when capability is disabled"
    assert len(call_log) == 0, "fake _invoke must not be called when gate is closed"


# Test 2: first turn mints a new session id

def test_first_turn_mints_session_id():
    ctx = _Ctx(enabled=True)
    assert ctx.session.claude_sid is None

    fake, call_log = _make_fake_invoke([
        {"text": "첫번째 질문?", "ok": True, "session_id": "new-sid-001"},
    ])

    original = ai_caps._invoke
    ai_caps._invoke = fake
    try:
        text = asyncio.run(build_turn(ctx, "처음 답변입니다"))
    finally:
        ai_caps._invoke = original

    assert text == "첫번째 질문?", f"Expected question text, got: {text!r}"
    assert ctx.session.claude_sid == "new-sid-001", (
        f"Expected session id to be minted, got: {ctx.session.claude_sid!r}"
    )
    assert len(call_log) == 1
    # First call passes session_id=None because no prior sid exists.
    assert call_log[0]["session_id"] is None, (
        "First turn must pass session_id=None to mint a fresh session"
    )


# Test 3: second turn resumes the minted session id

def test_second_turn_resumes_session_id():
    ctx = _Ctx(enabled=True)
    cm = ai_caps.ConvManager(ctx.session, window=4)

    fake, call_log = _make_fake_invoke([
        {"text": "Q1?", "ok": True, "session_id": "sid-xyz"},
        {"text": "Q2?", "ok": True, "session_id": "sid-xyz"},
    ])

    original = ai_caps._invoke
    ai_caps._invoke = fake
    try:
        text1 = asyncio.run(build_turn(ctx, "first reply", cm=cm))
        text2 = asyncio.run(build_turn(ctx, "second reply", cm=cm))
    finally:
        ai_caps._invoke = original

    assert text1 == "Q1?"
    assert text2 == "Q2?"
    assert len(call_log) == 2

    # First call: no sid yet, must pass None.
    assert call_log[0]["session_id"] is None, "Turn 1 must pass None to mint a session"
    # Second call: sid was minted by turn 1, must be passed for resume.
    assert call_log[1]["session_id"] == "sid-xyz", (
        f"Turn 2 must resume sid-xyz, got: {call_log[1]['session_id']!r}"
    )
    # Session object also carries the sid.
    assert ctx.session.claude_sid == "sid-xyz"


# Test 4: graceful handling when AI returns ok=False

def test_graceful_on_ai_failure():
    ctx = _Ctx(enabled=True)

    fake, call_log = _make_fake_invoke([
        {"text": "", "ok": False, "error": "timeout", "session_id": None},
    ])

    original = ai_caps._invoke
    ai_caps._invoke = fake
    try:
        result = asyncio.run(build_turn(ctx, "some input"))
    finally:
        ai_caps._invoke = original

    # Must not raise and must return None on failure.
    assert result is None, f"Expected None on AI failure, got: {result!r}"
    assert len(call_log) == 1, "fake _invoke must still be called once (gate is open)"


# Test 5: should_invoke condition parameter is respected

def test_gate_condition_false_skips_ai():
    """should_invoke with condition=False must return False regardless of enabled."""
    assert ai_caps.should_invoke(enabled=True, condition=False) is False
    assert ai_caps.should_invoke(enabled=False, condition=True) is False
    assert ai_caps.should_invoke(enabled=True, condition=True) is True


# Test 6: CAP_ID constant is correct

def test_cap_id():
    assert CAP_ID == "ai_socratic"


if __name__ == "__main__":
    import traceback

    tests = [
        test_gate_disabled_skips_ai,
        test_first_turn_mints_session_id,
        test_second_turn_resumes_session_id,
        test_graceful_on_ai_failure,
        test_gate_condition_false_skips_ai,
        test_cap_id,
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
