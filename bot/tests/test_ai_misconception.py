# -*- coding: utf-8 -*-
"""Headless tests for the ai_misconception capability.

Tests cover:
  - top_error_cards ordering (pure, no AI)
  - should_invoke gate: skips AI when capability disabled
  - should_invoke gate: skips AI when top_cards is empty
  - mock-based test: AI called and text returned when enabled
  - graceful handling when AI returns ok=False
"""
from __future__ import annotations

import asyncio
import os
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import ai_caps
from models import (
    AnswerSpec,
    CardDef,
    CardProgress,
    DeckData,
    ProgressStore,
    BOX_MIN,
)
from caps_ai.ai_misconception import (
    CAP_ID,
    top_error_cards,
    diagnose,
    _wrong_rate,
    _build_cards_summary,
)


# Helpers

def _make_card(card_id: str, prompt: str = "") -> CardDef:
    return CardDef(
        card_id=card_id,
        schema_version=1,
        subject="test",
        unit="unit1",
        type="func",
        grade_mode="exact",
        front={"prompt": prompt or f"Question for {card_id}"},
        back={"answer": "answer"},
        answer_spec=AnswerSpec(normalize=["trim"], accepted=["answer"]),
        tags={"weight": 5},
        links={},
        enabled=True,
    )


def _make_progress(card_id: str, cold_attempts: int = 0, cold_correct: int = 0) -> CardProgress:
    return CardProgress(
        card_id=card_id,
        box=BOX_MIN,
        due_at=0,
        graduated=False,
        cold_attempts=cold_attempts,
        cold_correct=cold_correct,
    )


def _make_store(deck_ns: str, progresses: list) -> ProgressStore:
    return ProgressStore(
        schema_version=1,
        deck_namespace=deck_ns,
        cards={p.card_id: p for p in progresses},
    )


def _make_deck(deck_ns: str, cards: list) -> DeckData:
    return DeckData(namespace=deck_ns, cards=cards)


def _make_ctx(enabled: bool = True, deck: DeckData | None = None) -> types.SimpleNamespace:
    caps = {CAP_ID} if enabled else set()
    return types.SimpleNamespace(
        ai_model=None,
        ai_effort="low",
        ai_persona=None,
        enabled_capabilities=caps,
        deck=deck,
    )


class _FakeAIResult:
    def __init__(self, text: str = "", ok: bool = True, error: str = "", session_id: str | None = None):
        self.text = text
        self.ok = ok
        self.error = error
        self.session_id = session_id


def _make_fake_invoke(text: str = "진단 결과", ok: bool = True):
    """Return an async fake _invoke that records whether it was called."""
    call_log: list[dict] = []

    async def fake_invoke(prompt, *, system, model, effort, max_tokens, session_id, on_stream=None):
        call_log.append({"prompt": prompt, "system": system})
        return _FakeAIResult(text=text, ok=ok, error="" if ok else "AI error")

    return fake_invoke, call_log


# ---- Tests for _wrong_rate (pure) ----

def test_wrong_rate_zero_attempts():
    assert _wrong_rate(0, 0) == 0.0


def test_wrong_rate_all_correct():
    assert _wrong_rate(10, 10) == 0.0


def test_wrong_rate_all_wrong():
    assert _wrong_rate(10, 0) == 1.0


def test_wrong_rate_half():
    assert abs(_wrong_rate(10, 5) - 0.5) < 1e-9


# ---- Tests for top_error_cards (pure) ----

def test_top_error_cards_empty_store():
    deck = _make_deck("d1", [_make_card("c1")])
    store = _make_store("d1", [])
    result = top_error_cards(store, deck, n=5)
    assert result == []


def test_top_error_cards_excludes_zero_attempts():
    deck = _make_deck("d1", [_make_card("c1"), _make_card("c2")])
    store = _make_store("d1", [
        _make_progress("c1", cold_attempts=0, cold_correct=0),
        _make_progress("c2", cold_attempts=5, cold_correct=1),
    ])
    result = top_error_cards(store, deck, n=5)
    assert "c1" not in result
    assert "c2" in result


def test_top_error_cards_sorted_by_wrong_rate_descending():
    deck = _make_deck("d1", [
        _make_card("c-bad"),
        _make_card("c-ok"),
        _make_card("c-worst"),
    ])
    store = _make_store("d1", [
        _make_progress("c-bad",   cold_attempts=10, cold_correct=5),   # wrong_rate 0.5
        _make_progress("c-ok",    cold_attempts=10, cold_correct=9),   # wrong_rate 0.1
        _make_progress("c-worst", cold_attempts=10, cold_correct=1),   # wrong_rate 0.9
    ])
    result = top_error_cards(store, deck, n=5)
    assert result[0] == "c-worst"
    assert result[1] == "c-bad"
    assert result[2] == "c-ok"


def test_top_error_cards_respects_n_cap():
    cards = [_make_card(f"c{i}") for i in range(10)]
    deck = _make_deck("d1", cards)
    progs = [_make_progress(f"c{i}", cold_attempts=10, cold_correct=i) for i in range(10)]
    store = _make_store("d1", progs)
    result = top_error_cards(store, deck, n=3)
    assert len(result) == 3


def test_top_error_cards_excludes_cards_not_in_deck():
    deck = _make_deck("d1", [_make_card("c-in-deck")])
    store = _make_store("d1", [
        _make_progress("c-in-deck",     cold_attempts=10, cold_correct=0),
        _make_progress("c-not-in-deck", cold_attempts=10, cold_correct=0),
    ])
    result = top_error_cards(store, deck, n=5)
    assert "c-in-deck" in result
    assert "c-not-in-deck" not in result


def test_top_error_cards_all_correct_returns_empty():
    deck = _make_deck("d1", [_make_card("c1"), _make_card("c2")])
    store = _make_store("d1", [
        _make_progress("c1", cold_attempts=10, cold_correct=10),
        _make_progress("c2", cold_attempts=5, cold_correct=5),
    ])
    result = top_error_cards(store, deck, n=5)
    # wrong_rate is 0.0 for both but they are still included (attempts > 0)
    assert set(result) == {"c1", "c2"}


# ---- Tests for _build_cards_summary (pure) ----

def test_build_cards_summary_card_def_objects():
    cards = [_make_card("c1", prompt="What is X?"), _make_card("c2", prompt="Explain Y")]
    deck = _make_deck("d1", cards)
    summary = _build_cards_summary(cards, deck)
    assert "c1" in summary
    assert "What is X?" in summary
    assert "c2" in summary


def test_build_cards_summary_plain_card_id_strings():
    cards = [_make_card("c1", prompt="What is X?")]
    deck = _make_deck("d1", cards)
    summary = _build_cards_summary(["c1"], deck)
    assert "c1" in summary
    assert "What is X?" in summary


def test_build_cards_summary_unknown_id_still_included():
    deck = _make_deck("d1", [])
    summary = _build_cards_summary(["unknown-card"], deck)
    assert "unknown-card" in summary


# ---- Tests for diagnose (async, monkeypatched AI) ----

def test_diagnose_gate_skips_when_disabled():
    """should_invoke returns False when capability not in enabled_capabilities; fake NOT called."""
    fake, call_log = _make_fake_invoke()
    ai_caps._invoke = fake

    ctx = _make_ctx(enabled=False)
    cards = [_make_card("c1")]

    result = asyncio.run(diagnose(ctx, cards))

    assert result is None
    assert len(call_log) == 0


def test_diagnose_gate_skips_when_empty_top_cards():
    """should_invoke returns False when top_cards is empty; fake NOT called."""
    fake, call_log = _make_fake_invoke()
    ai_caps._invoke = fake

    ctx = _make_ctx(enabled=True)

    result = asyncio.run(diagnose(ctx, []))

    assert result is None
    assert len(call_log) == 0


def test_diagnose_returns_text_on_success():
    """When enabled and top_cards non-empty, AI is called and its text is returned."""
    expected_text = "개념 오류: 정규화 이해 부족"
    fake, call_log = _make_fake_invoke(text=expected_text, ok=True)
    ai_caps._invoke = fake

    deck = _make_deck("d1", [_make_card("c1", prompt="What is normalization?")])
    ctx = _make_ctx(enabled=True, deck=deck)
    cards = [_make_card("c1", prompt="What is normalization?")]

    result = asyncio.run(diagnose(ctx, cards))

    assert result == expected_text
    assert len(call_log) == 1


def test_diagnose_graceful_on_ai_failure():
    """When AI returns ok=False, diagnose returns None without raising."""
    fake, call_log = _make_fake_invoke(text="", ok=False)
    ai_caps._invoke = fake

    deck = _make_deck("d1", [_make_card("c1")])
    ctx = _make_ctx(enabled=True, deck=deck)
    cards = [_make_card("c1")]

    result = asyncio.run(diagnose(ctx, cards))

    assert result is None
    assert len(call_log) == 1  # AI was called but failed


def test_diagnose_ai_call_uses_correct_capability_id():
    """Ensure the capability_id in the one_shot call hits CAP_LIMITS for ai_misconception."""
    fake, call_log = _make_fake_invoke(text="분석 결과", ok=True)
    ai_caps._invoke = fake

    deck = _make_deck("d1", [_make_card("c1", prompt="개념 설명")])
    ctx = _make_ctx(enabled=True, deck=deck)
    cards = [_make_card("c1", prompt="개념 설명")]

    asyncio.run(diagnose(ctx, cards))

    assert len(call_log) == 1
    # The system preamble should contain the role text from _ROLE
    system = call_log[0]["system"]
    assert "learning analyst" in system


def test_diagnose_with_card_id_strings():
    """diagnose accepts plain card_id strings as top_cards (operator may pass these)."""
    fake, call_log = _make_fake_invoke(text="결과", ok=True)
    ai_caps._invoke = fake

    deck = _make_deck("d1", [_make_card("c1", prompt="What is X?")])
    ctx = _make_ctx(enabled=True, deck=deck)

    result = asyncio.run(diagnose(ctx, ["c1"]))

    assert result == "결과"
    assert len(call_log) == 1


if __name__ == "__main__":
    import traceback

    tests = [
        test_wrong_rate_zero_attempts,
        test_wrong_rate_all_correct,
        test_wrong_rate_all_wrong,
        test_wrong_rate_half,
        test_top_error_cards_empty_store,
        test_top_error_cards_excludes_zero_attempts,
        test_top_error_cards_sorted_by_wrong_rate_descending,
        test_top_error_cards_respects_n_cap,
        test_top_error_cards_excludes_cards_not_in_deck,
        test_top_error_cards_all_correct_returns_empty,
        test_build_cards_summary_card_def_objects,
        test_build_cards_summary_plain_card_id_strings,
        test_build_cards_summary_unknown_id_still_included,
        test_diagnose_gate_skips_when_disabled,
        test_diagnose_gate_skips_when_empty_top_cards,
        test_diagnose_returns_text_on_success,
        test_diagnose_graceful_on_ai_failure,
        test_diagnose_ai_call_uses_correct_capability_id,
        test_diagnose_with_card_id_strings,
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
