# -*- coding: utf-8 -*-
"""Headless tests for the ai_variant_q capability.

Monkeypatches ai_caps._invoke so no live AI or Discord connection is needed.

Tests:
  1. box3_cards - pure filter: only box-3 cards present in the deck are returned.
  2. box3_cards - excludes cards not in the deck (stale progress entries).
  3. Gate skip: when capability is disabled, _invoke is never called and None is returned.
  4. Happy path: valid JSON {front} -> dict with 'front' and 'answer_spec'.
  5. AI failure (ok=False): returns None, does not raise.
  6. Bad JSON response: returns None gracefully.
  7. JSON missing 'front' key: returns None.
  8. Fenced JSON is tolerated.
  9. Empty 'front' string: returns None (no blank variants).
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
from ai import AIResult
from models import (
    CardDef,
    AnswerSpec,
    DeckData,
    ProgressStore,
    CardProgress,
    SCHEMA_VERSION,
)
from caps_ai.ai_variant_q import make_variant, box3_cards, _CAP_ID


# Helpers

def _make_card(card_id: str = "card-01", prompt: str = "X란 무엇인가?") -> CardDef:
    return CardDef(
        card_id=card_id,
        schema_version=1,
        subject="test",
        unit="unit1",
        type="func",
        grade_mode="exact",
        front={"prompt": prompt},
        back={"answer": "정답"},
        answer_spec=AnswerSpec(normalize=["trim"], accepted=["정답"]),
        tags={},
        links={},
    )


def _make_store(box_map: dict[str, int]) -> ProgressStore:
    """Build a ProgressStore where each key is a card_id and value is its box number."""
    store = ProgressStore(schema_version=SCHEMA_VERSION, deck_namespace="test-ns")
    for card_id, box in box_map.items():
        store.cards[card_id] = CardProgress(card_id=card_id, box=box)
    return store


def _make_deck(*card_ids: str) -> DeckData:
    cards = [_make_card(cid) for cid in card_ids]
    return DeckData(namespace="test-ns", cards=cards)


class _FakeCtx:
    def __init__(self, enabled: bool = True) -> None:
        self.ai_model = None
        self.ai_effort = "low"
        self.ai_persona = None
        self.enabled_capabilities = {_CAP_ID} if enabled else set()
        self.channel = None
        self.user_id = "u-test"


def _fake_invoke(text: str, ok: bool = True):
    """Return a fake async _invoke and a call-count tracker."""
    calls: list[dict] = []

    async def fake(prompt, *, system=None, model=None, effort="low",
                   max_tokens=None, session_id=None, on_stream=None):
        calls.append({"prompt": prompt})
        return AIResult(text=text, ok=ok, error=None if ok else "simulated", session_id=None)

    return fake, calls


# Tests: box3_cards (pure, no AI)

def test_box3_cards_returns_only_box3():
    """Only cards with box == 3 that exist in the deck are returned."""
    store = _make_store({"card-01": 3, "card-02": 2, "card-03": 1, "card-04": 3})
    deck = _make_deck("card-01", "card-02", "card-03", "card-04")
    result = box3_cards(store, deck)
    assert set(result) == {"card-01", "card-04"}, f"Unexpected result: {result}"


def test_box3_cards_excludes_stale_progress():
    """Cards in box 3 but absent from the current deck are excluded."""
    store = _make_store({"card-01": 3, "stale-card": 3})
    deck = _make_deck("card-01")
    result = box3_cards(store, deck)
    assert result == ["card-01"], f"Expected only card-01, got {result}"


def test_box3_cards_empty_when_none_mastered():
    """Returns an empty list when no cards are in box 3."""
    store = _make_store({"card-01": 1, "card-02": 2})
    deck = _make_deck("card-01", "card-02")
    result = box3_cards(store, deck)
    assert result == [], f"Expected empty list, got {result}"


def test_box3_cards_empty_store():
    """Returns an empty list when the store has no progress at all."""
    store = ProgressStore(schema_version=SCHEMA_VERSION, deck_namespace="ns")
    deck = _make_deck("card-01")
    result = box3_cards(store, deck)
    assert result == []


# Tests: make_variant (async, AI-gated)

def test_gate_disabled_invoke_not_called():
    """should_invoke gate must block the AI call when capability is disabled."""
    ctx = _FakeCtx(enabled=False)
    card = _make_card()
    fake, calls = _fake_invoke('{"front":"다른 표현"}')
    original = ai_caps._invoke
    ai_caps._invoke = fake
    try:
        result = asyncio.run(make_variant(ctx, card))
        assert result is None, "Expected None when gated"
        assert len(calls) == 0, "AI must not be called when disabled"
    finally:
        ai_caps._invoke = original


def test_happy_path_returns_dict():
    """Valid JSON {front} from AI -> dict with 'front' and 'answer_spec'."""
    ctx = _FakeCtx(enabled=True)
    card = _make_card()
    payload = json.dumps({"front": "X를 설명하시오."})
    fake, calls = _fake_invoke(payload, ok=True)
    original = ai_caps._invoke
    ai_caps._invoke = fake
    try:
        result = asyncio.run(make_variant(ctx, card))
        assert result is not None, "Expected a dict on success"
        assert result["front"] == "X를 설명하시오."
        assert result["answer_spec"] is card.answer_spec, "answer_spec must be the card's own spec"
        assert len(calls) == 1, "AI must be called exactly once"
    finally:
        ai_caps._invoke = original


def test_ai_failure_returns_none():
    """When AI call returns ok=False, make_variant returns None gracefully."""
    ctx = _FakeCtx(enabled=True)
    card = _make_card()
    fake, calls = _fake_invoke("", ok=False)
    original = ai_caps._invoke
    ai_caps._invoke = fake
    try:
        result = asyncio.run(make_variant(ctx, card))
        assert result is None, "Expected None on AI failure"
        assert len(calls) == 1, "AI was called but must return None"
    finally:
        ai_caps._invoke = original


def test_bad_json_returns_none():
    """Non-JSON response from AI -> None (graceful degradation)."""
    ctx = _FakeCtx(enabled=True)
    card = _make_card()
    fake, calls = _fake_invoke("이건 JSON이 아닙니다.", ok=True)
    original = ai_caps._invoke
    ai_caps._invoke = fake
    try:
        result = asyncio.run(make_variant(ctx, card))
        assert result is None, "Expected None when AI returns non-JSON"
    finally:
        ai_caps._invoke = original


def test_missing_front_key_returns_none():
    """JSON without 'front' key -> None."""
    ctx = _FakeCtx(enabled=True)
    card = _make_card()
    fake, calls = _fake_invoke('{"question":"X란?"}', ok=True)
    original = ai_caps._invoke
    ai_caps._invoke = fake
    try:
        result = asyncio.run(make_variant(ctx, card))
        assert result is None, "Expected None when 'front' key is absent"
    finally:
        ai_caps._invoke = original


def test_fenced_json_is_tolerated():
    """JSON wrapped in a markdown code fence is parsed correctly."""
    ctx = _FakeCtx(enabled=True)
    card = _make_card()
    fenced = '```json\n{"front":"X의 정의를 말하시오."}\n```'
    fake, calls = _fake_invoke(fenced, ok=True)
    original = ai_caps._invoke
    ai_caps._invoke = fake
    try:
        result = asyncio.run(make_variant(ctx, card))
        assert result is not None, "Expected dict from fenced JSON"
        assert result["front"] == "X의 정의를 말하시오."
    finally:
        ai_caps._invoke = original


def test_empty_front_returns_none():
    """JSON with an empty 'front' string -> None (no blank variant questions)."""
    ctx = _FakeCtx(enabled=True)
    card = _make_card()
    fake, calls = _fake_invoke('{"front":""}', ok=True)
    original = ai_caps._invoke
    ai_caps._invoke = fake
    try:
        result = asyncio.run(make_variant(ctx, card))
        assert result is None, "Expected None when 'front' is empty"
    finally:
        ai_caps._invoke = original


def test_whitespace_only_front_returns_none():
    """JSON with a whitespace-only 'front' string -> None."""
    ctx = _FakeCtx(enabled=True)
    card = _make_card()
    fake, calls = _fake_invoke('{"front":"   "}', ok=True)
    original = ai_caps._invoke
    ai_caps._invoke = fake
    try:
        result = asyncio.run(make_variant(ctx, card))
        assert result is None, "Expected None when 'front' is whitespace only"
    finally:
        ai_caps._invoke = original


def test_front_is_stripped():
    """Leading and trailing whitespace in 'front' value is stripped."""
    ctx = _FakeCtx(enabled=True)
    card = _make_card()
    fake, calls = _fake_invoke('{"front":"  X는 무엇인가?  "}', ok=True)
    original = ai_caps._invoke
    ai_caps._invoke = fake
    try:
        result = asyncio.run(make_variant(ctx, card))
        assert result is not None
        assert result["front"] == "X는 무엇인가?", f"Expected stripped text, got {result['front']!r}"
    finally:
        ai_caps._invoke = original


if __name__ == "__main__":
    import traceback

    tests = [
        test_box3_cards_returns_only_box3,
        test_box3_cards_excludes_stale_progress,
        test_box3_cards_empty_when_none_mastered,
        test_box3_cards_empty_store,
        test_gate_disabled_invoke_not_called,
        test_happy_path_returns_dict,
        test_ai_failure_returns_none,
        test_bad_json_returns_none,
        test_missing_front_key_returns_none,
        test_fenced_json_is_tolerated,
        test_empty_front_returns_none,
        test_whitespace_only_front_returns_none,
        test_front_is_stripped,
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
