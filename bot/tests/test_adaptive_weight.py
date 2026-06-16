# -*- coding: utf-8 -*-
"""Headless tests for the adaptive_weight capability.

Pure core functions (recompute_weights, load_weight_overrides, save_weight_overrides)
are tested directly with tempfile mounts and in-memory model objects.
No live Discord connection is required.
"""
from __future__ import annotations

import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import pytest

from models import (
    AnswerSpec,
    CardDef,
    CardProgress,
    DeckData,
    ProgressStore,
    QueueOptions,
    BOX_MIN,
)
from caps.adaptive_weight import (
    CAP_ID,
    WEIGHT_MIN,
    WEIGHT_MAX,
    WEIGHT_DEFAULT,
    _compute_card_weight,
    recompute_weights,
    load_weight_overrides,
    save_weight_overrides,
)
from selection import build_queue
import sidecar


# Helpers

def _make_card(card_id: str, enabled: bool = True, weight_tag: int = 5) -> CardDef:
    """Build a minimal CardDef for testing."""
    return CardDef(
        card_id=card_id,
        schema_version=1,
        subject="test",
        unit="unit1",
        type="func",
        grade_mode="exact",
        front={"prompt": f"Question for {card_id}"},
        back={"answer": "answer"},
        answer_spec=AnswerSpec(normalize=["trim"], accepted=["answer"]),
        tags={"weight": weight_tag},
        links={},
        enabled=enabled,
    )


def _make_progress(
    card_id: str,
    cold_attempts: int = 0,
    cold_correct: int = 0,
    graduated: bool = False,
    box: int = BOX_MIN,
) -> CardProgress:
    """Build a CardProgress for testing."""
    return CardProgress(
        card_id=card_id,
        box=box,
        due_at=0,
        graduated=graduated,
        cold_attempts=cold_attempts,
        cold_correct=cold_correct,
    )


def _make_store(deck_ns: str, progresses: list[CardProgress]) -> ProgressStore:
    """Build a ProgressStore from a list of CardProgress objects."""
    return ProgressStore(
        schema_version=1,
        deck_namespace=deck_ns,
        cards={p.card_id: p for p in progresses},
    )


def _make_deck(deck_ns: str, cards: list[CardDef]) -> DeckData:
    """Build a DeckData from a list of CardDef objects."""
    return DeckData(namespace=deck_ns, cards=cards)


# Tests for _compute_card_weight

def test_no_progress_returns_default():
    assert _compute_card_weight(None) == WEIGHT_DEFAULT


def test_zero_attempts_returns_default():
    prog = _make_progress("card-a", cold_attempts=0)
    assert _compute_card_weight(prog) == WEIGHT_DEFAULT


def test_graduated_returns_min():
    prog = _make_progress("card-a", cold_attempts=5, cold_correct=5, graduated=True)
    assert _compute_card_weight(prog) == WEIGHT_MIN


def test_all_correct_returns_min():
    prog = _make_progress("card-a", cold_attempts=10, cold_correct=10)
    assert _compute_card_weight(prog) == WEIGHT_MIN


def test_all_wrong_returns_max():
    prog = _make_progress("card-a", cold_attempts=10, cold_correct=0)
    assert _compute_card_weight(prog) == WEIGHT_MAX


def test_half_wrong_returns_midpoint():
    prog = _make_progress("card-a", cold_attempts=10, cold_correct=5)
    # wrong_rate = 0.5, weight = round(1 + 0.5 * 9) = round(5.5) = 6
    result = _compute_card_weight(prog)
    assert result == 6


def test_weight_clamped_min():
    prog = _make_progress("card-a", cold_attempts=100, cold_correct=100)
    assert _compute_card_weight(prog) >= WEIGHT_MIN


def test_weight_clamped_max():
    prog = _make_progress("card-a", cold_attempts=100, cold_correct=0)
    assert _compute_card_weight(prog) <= WEIGHT_MAX


def test_weight_is_integer():
    prog = _make_progress("card-a", cold_attempts=7, cold_correct=3)
    result = _compute_card_weight(prog)
    assert isinstance(result, int)


# Tests for recompute_weights

def test_low_correctness_gets_higher_weight_than_graduated():
    card_weak = _make_card("card-weak")
    card_grad = _make_card("card-grad")

    prog_weak = _make_progress("card-weak", cold_attempts=10, cold_correct=1)
    prog_grad = _make_progress("card-grad", cold_attempts=10, cold_correct=10, graduated=True)

    store = _make_store("deck1", [prog_weak, prog_grad])
    deck = _make_deck("deck1", [card_weak, card_grad])

    overrides = recompute_weights(store, deck)

    assert overrides["card-weak"] > overrides["card-grad"]


def test_all_weights_clamped_to_range():
    cards = [_make_card(f"card-{i}") for i in range(5)]
    progresses = [
        _make_progress("card-0", cold_attempts=0),
        _make_progress("card-1", cold_attempts=10, cold_correct=0),
        _make_progress("card-2", cold_attempts=10, cold_correct=5),
        _make_progress("card-3", cold_attempts=10, cold_correct=10),
        _make_progress("card-4", cold_attempts=10, cold_correct=10, graduated=True),
    ]
    store = _make_store("deck1", progresses)
    deck = _make_deck("deck1", cards)

    overrides = recompute_weights(store, deck)

    for card_id, weight in overrides.items():
        assert WEIGHT_MIN <= weight <= WEIGHT_MAX, (
            f"Weight {weight} for {card_id} out of range [{WEIGHT_MIN}, {WEIGHT_MAX}]"
        )


def test_disabled_card_excluded():
    card_on = _make_card("card-on", enabled=True)
    card_off = _make_card("card-off", enabled=False)

    store = _make_store("deck1", [])
    deck = _make_deck("deck1", [card_on, card_off])

    overrides = recompute_weights(store, deck)

    assert "card-on" in overrides
    assert "card-off" not in overrides


def test_card_without_progress_gets_default():
    card = _make_card("card-new")
    store = _make_store("deck1", [])
    deck = _make_deck("deck1", [card])

    overrides = recompute_weights(store, deck)

    assert overrides["card-new"] == WEIGHT_DEFAULT


def test_graduated_gets_weight_1():
    card = _make_card("card-grad")
    prog = _make_progress("card-grad", cold_attempts=20, cold_correct=20, graduated=True)
    store = _make_store("deck1", [prog])
    deck = _make_deck("deck1", [card])

    overrides = recompute_weights(store, deck)

    assert overrides["card-grad"] == WEIGHT_MIN


def test_high_wrong_rate_gives_high_weight():
    card = _make_card("card-bad")
    prog = _make_progress("card-bad", cold_attempts=10, cold_correct=1)
    store = _make_store("deck1", [prog])
    deck = _make_deck("deck1", [card])

    overrides = recompute_weights(store, deck)

    assert overrides["card-bad"] >= 8


def test_multiple_cards_all_present():
    cards = [_make_card(f"card-{i}") for i in range(3)]
    store = _make_store("deck1", [])
    deck = _make_deck("deck1", cards)

    overrides = recompute_weights(store, deck)

    assert set(overrides.keys()) == {"card-0", "card-1", "card-2"}


# Tests for sidecar persistence

def test_save_and_load_roundtrip():
    with tempfile.TemporaryDirectory() as mount:
        original = {"card-a": 8, "card-b": 2, "card-c": 5}
        save_weight_overrides(mount, "deck1", original)
        loaded = load_weight_overrides(mount, "deck1")
        assert loaded == original


def test_load_empty_when_no_sidecar():
    with tempfile.TemporaryDirectory() as mount:
        result = load_weight_overrides(mount, "deck-missing")
        assert result == {}


def test_sidecar_isolated_per_deck():
    with tempfile.TemporaryDirectory() as mount:
        save_weight_overrides(mount, "deck1", {"card-a": 9})
        save_weight_overrides(mount, "deck2", {"card-a": 2})

        assert load_weight_overrides(mount, "deck1") == {"card-a": 9}
        assert load_weight_overrides(mount, "deck2") == {"card-a": 2}


def test_sidecar_values_cast_to_int():
    with tempfile.TemporaryDirectory() as mount:
        # Write raw floats directly to the sidecar to test the cast path.
        sidecar.save_all(mount, CAP_ID, "deck1", {"card-a": 7.9})
        loaded = load_weight_overrides(mount, "deck1")
        assert loaded["card-a"] == 7
        assert isinstance(loaded["card-a"], int)


def test_sidecar_bad_value_falls_back_to_default():
    with tempfile.TemporaryDirectory() as mount:
        sidecar.save_all(mount, CAP_ID, "deck1", {"card-a": "broken"})
        loaded = load_weight_overrides(mount, "deck1")
        assert loaded["card-a"] == WEIGHT_DEFAULT


def test_does_not_collide_with_other_capabilities():
    with tempfile.TemporaryDirectory() as mount:
        save_weight_overrides(mount, "deck1", {"card-a": 9})
        sidecar.set(mount, "confidence_rate", "deck1", "card-a", "easy")

        assert load_weight_overrides(mount, "deck1") == {"card-a": 9}
        assert sidecar.get(mount, "confidence_rate", "deck1", "card-a") == "easy"


# Tests for build_queue integration with weight_overrides

def test_build_queue_reorders_by_adaptive_weights():
    """A card with a high adaptive weight should appear before a graduated (low-weight) card."""
    card_weak = _make_card("card-weak", weight_tag=5)
    card_grad = _make_card("card-grad", weight_tag=5)

    # Both are new (cold_attempts == 0 -> added to new group in build_queue).
    # We inject weight_overrides to force the ordering.
    store = _make_store("deck1", [])
    deck = _make_deck("deck1", [card_weak, card_grad])

    overrides = {"card-weak": 9, "card-grad": 1}

    opts = QueueOptions(
        deck_namespace="deck1",
        weight_overrides=overrides,
    )

    queue = build_queue(deck.cards, store, now=0, opts=opts)

    assert "card-weak" in queue
    assert "card-grad" in queue
    assert queue.index("card-weak") < queue.index("card-grad")


def test_build_queue_with_recomputed_weights():
    """End-to-end: recompute_weights feeds into build_queue and reorders correctly."""
    card_weak = _make_card("card-weak")
    card_good = _make_card("card-good")

    prog_weak = _make_progress("card-weak", cold_attempts=10, cold_correct=1)
    prog_good = _make_progress("card-good", cold_attempts=10, cold_correct=10, graduated=True)

    store = _make_store("deck1", [prog_weak, prog_good])
    deck = _make_deck("deck1", [card_weak, card_good])

    overrides = recompute_weights(store, deck)

    # Verify the computed weights first.
    assert overrides["card-weak"] > overrides["card-good"]

    # Both are non-new but we set due_at=0 so they are always due.
    opts = QueueOptions(deck_namespace="deck1", weight_overrides=overrides)
    queue = build_queue(deck.cards, store, now=1, opts=opts)

    # card-weak is in review (cold_attempts > 0, due_at=0 means due), card-good graduated
    # but still due. Higher weight card-weak should appear first.
    assert queue.index("card-weak") < queue.index("card-good")


def test_cap_id_constant():
    assert CAP_ID == "adaptive_weight"


if __name__ == "__main__":
    import traceback

    tests = [
        test_no_progress_returns_default,
        test_zero_attempts_returns_default,
        test_graduated_returns_min,
        test_all_correct_returns_min,
        test_all_wrong_returns_max,
        test_half_wrong_returns_midpoint,
        test_weight_clamped_min,
        test_weight_clamped_max,
        test_weight_is_integer,
        test_low_correctness_gets_higher_weight_than_graduated,
        test_all_weights_clamped_to_range,
        test_disabled_card_excluded,
        test_card_without_progress_gets_default,
        test_graduated_gets_weight_1,
        test_high_wrong_rate_gives_high_weight,
        test_multiple_cards_all_present,
        test_save_and_load_roundtrip,
        test_load_empty_when_no_sidecar,
        test_sidecar_isolated_per_deck,
        test_sidecar_values_cast_to_int,
        test_sidecar_bad_value_falls_back_to_default,
        test_does_not_collide_with_other_capabilities,
        test_build_queue_reorders_by_adaptive_weights,
        test_build_queue_with_recomputed_weights,
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
