# -*- coding: utf-8 -*-
"""Headless tests for ai_generate_items capability.

Tests three behavioural contracts:
1. Gate skip: when the capability is not in enabled_capabilities, _invoke is never called
   and the result is an empty list.
2. Happy path: mock _invoke returning valid JSON for 2 seeds produces 2 card drafts with
   correct front/back/answer/seed/card_type fields.
3. Bad-JSON tolerance: a seed whose AI response is unparseable is skipped; other seeds
   still produce drafts.

No live Discord connection or network is required.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import ai_caps
from caps_ai.ai_generate_items import generate_cards, CAP_ID


# Fake AIResult mirroring the real ai.AIResult shape.

class _FakeResult:
    def __init__(self, text: str = "", ok: bool = True, error: str = "", session_id: str | None = None):
        self.text = text
        self.ok = ok
        self.error = error
        self.session_id = session_id


# Minimal fake ctx helpers.

class _FakeCtx:
    def __init__(self, enabled: bool = True):
        self.ai_model = None
        self.ai_effort = "low"
        self.ai_persona = None
        self.enabled_capabilities = {CAP_ID} if enabled else set()


# Tests

def test_gate_skip_when_disabled():
    """When the capability is not enabled, _invoke is never called and result is []."""
    call_count = {"n": 0}

    async def fake_invoke(*args, **kwargs):
        call_count["n"] += 1
        return _FakeResult(text='{"front":"f","back":"b","answer":"a"}')

    original = ai_caps._invoke
    ai_caps._invoke = fake_invoke
    try:
        ctx = _FakeCtx(enabled=False)
        result = asyncio.run(generate_cards(ctx, ["seed1", "seed2"]))
        assert result == [], f"Expected empty list, got {result}"
        assert call_count["n"] == 0, "Expected zero AI calls when gate is closed"
    finally:
        ai_caps._invoke = original


def test_two_good_seeds_produce_two_drafts():
    """Mock returning valid JSON for each seed should produce exactly 2 drafts."""
    responses = [
        '{"front":"What is X?","back":"X is the unknown.","answer":"unknown"}',
        '{"front":"Define Y.","back":"Y means yes.","answer":"yes"}',
    ]
    call_index = {"i": 0}

    async def fake_invoke(*args, **kwargs):
        text = responses[call_index["i"] % len(responses)]
        call_index["i"] += 1
        return _FakeResult(text=text)

    original = ai_caps._invoke
    ai_caps._invoke = fake_invoke
    try:
        ctx = _FakeCtx(enabled=True)
        drafts = asyncio.run(generate_cards(ctx, ["seed-x", "seed-y"], card_type="func"))

        assert len(drafts) == 2, f"Expected 2 drafts, got {len(drafts)}"

        assert drafts[0]["front"] == "What is X?"
        assert drafts[0]["back"] == "X is the unknown."
        assert drafts[0]["answer"] == "unknown"
        assert drafts[0]["seed"] == "seed-x"
        assert drafts[0]["card_type"] == "func"

        assert drafts[1]["front"] == "Define Y."
        assert drafts[1]["answer"] == "yes"
        assert drafts[1]["seed"] == "seed-y"
    finally:
        ai_caps._invoke = original


def test_bad_json_seed_is_skipped():
    """A seed returning unparseable text is skipped; valid seeds still appear in output."""
    responses = [
        "This is not JSON at all.",
        '{"front":"Valid front.","back":"Valid back.","answer":"valid"}',
    ]
    call_index = {"i": 0}

    async def fake_invoke(*args, **kwargs):
        text = responses[call_index["i"] % len(responses)]
        call_index["i"] += 1
        return _FakeResult(text=text)

    original = ai_caps._invoke
    ai_caps._invoke = fake_invoke
    try:
        ctx = _FakeCtx(enabled=True)
        drafts = asyncio.run(generate_cards(ctx, ["bad-seed", "good-seed"]))

        assert len(drafts) == 1, f"Expected 1 draft (bad skipped), got {len(drafts)}"
        assert drafts[0]["seed"] == "good-seed"
        assert drafts[0]["front"] == "Valid front."
    finally:
        ai_caps._invoke = original


def test_ai_error_seed_is_skipped():
    """A seed whose AI call returns ok=False is skipped gracefully."""
    responses_ok = [False, True]
    call_index = {"i": 0}

    async def fake_invoke(*args, **kwargs):
        ok = responses_ok[call_index["i"] % len(responses_ok)]
        call_index["i"] += 1
        if ok:
            return _FakeResult(text='{"front":"F","back":"B","answer":"A"}')
        return _FakeResult(text="", ok=False, error="network failure")

    original = ai_caps._invoke
    ai_caps._invoke = fake_invoke
    try:
        ctx = _FakeCtx(enabled=True)
        drafts = asyncio.run(generate_cards(ctx, ["fail-seed", "ok-seed"]))

        assert len(drafts) == 1, f"Expected 1 draft, got {len(drafts)}"
        assert drafts[0]["seed"] == "ok-seed"
    finally:
        ai_caps._invoke = original


def test_gate_skip_with_condition_false():
    """should_invoke with condition=False also blocks calls (direct gate test)."""
    assert not ai_caps.should_invoke(enabled=True, condition=False)
    assert not ai_caps.should_invoke(enabled=False, condition=True)
    assert not ai_caps.should_invoke(enabled=False, condition=False)
    assert ai_caps.should_invoke(enabled=True, condition=True)


def test_empty_seeds_returns_empty():
    """Passing an empty seeds list returns an empty list with no AI calls."""
    call_count = {"n": 0}

    async def fake_invoke(*args, **kwargs):
        call_count["n"] += 1
        return _FakeResult(text='{"front":"f","back":"b","answer":"a"}')

    original = ai_caps._invoke
    ai_caps._invoke = fake_invoke
    try:
        ctx = _FakeCtx(enabled=True)
        drafts = asyncio.run(generate_cards(ctx, []))

        assert drafts == []
        assert call_count["n"] == 0
    finally:
        ai_caps._invoke = original


def test_partial_json_missing_key_is_skipped():
    """JSON that is valid but missing required keys (back) is skipped."""
    async def fake_invoke(*args, **kwargs):
        return _FakeResult(text='{"front":"F","answer":"A"}')

    original = ai_caps._invoke
    ai_caps._invoke = fake_invoke
    try:
        ctx = _FakeCtx(enabled=True)
        drafts = asyncio.run(generate_cards(ctx, ["seed1"]))
        assert drafts == [], f"Expected empty (missing 'back'), got {drafts}"
    finally:
        ai_caps._invoke = original


def test_fenced_json_is_tolerated():
    """JSON wrapped in a markdown code fence is parsed correctly."""
    fenced = '```json\n{"front":"Q","back":"A","answer":"A"}\n```'

    async def fake_invoke(*args, **kwargs):
        return _FakeResult(text=fenced)

    original = ai_caps._invoke
    ai_caps._invoke = fake_invoke
    try:
        ctx = _FakeCtx(enabled=True)
        drafts = asyncio.run(generate_cards(ctx, ["seed1"]))
        assert len(drafts) == 1
        assert drafts[0]["front"] == "Q"
    finally:
        ai_caps._invoke = original


if __name__ == "__main__":
    import traceback

    tests = [
        test_gate_skip_when_disabled,
        test_two_good_seeds_produce_two_drafts,
        test_bad_json_seed_is_skipped,
        test_ai_error_seed_is_skipped,
        test_gate_skip_with_condition_false,
        test_empty_seeds_returns_empty,
        test_partial_json_missing_key_is_skipped,
        test_fenced_json_is_tolerated,
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
