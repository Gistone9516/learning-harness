# -*- coding: utf-8 -*-
"""Headless tests for hint_progressive capability.

Tests the pure core functions (next_hint, bump_level, get_level) directly.
No live discord connection required.
"""
from __future__ import annotations

import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

from models import CardDef, AnswerSpec
from caps.hint_progressive import next_hint, bump_level, get_level, _get_hint_list, _MAX_LEVEL
import sidecar


# Helpers

def _make_card(hints=None, hint=None) -> CardDef:
    """Build a minimal CardDef with the given hints/hint front fields."""
    front: dict = {"prompt": "What is X?"}
    if hints is not None:
        front["hints"] = hints
    if hint is not None:
        front["hint"] = hint
    return CardDef(
        card_id="tst-hint-01",
        schema_version=1,
        subject="test",
        unit="unit1",
        type="func",
        grade_mode="exact",
        front=front,
        back={},
        answer_spec=AnswerSpec(normalize=["trim"], accepted=["answer"]),
        tags={},
        links={},
    )


# Tests for _get_hint_list

def test_get_hint_list_from_hints_key():
    card = _make_card(hints=["h1", "h2", "h3"])
    assert _get_hint_list(card) == ["h1", "h2", "h3"]


def test_get_hint_list_caps_at_max_level():
    card = _make_card(hints=["h1", "h2", "h3", "h4", "h5"])
    result = _get_hint_list(card)
    assert len(result) == _MAX_LEVEL
    assert result == ["h1", "h2", "h3"]


def test_get_hint_list_fallback_to_single_hint():
    card = _make_card(hint="single hint text")
    assert _get_hint_list(card) == ["single hint text"]


def test_get_hint_list_empty_when_no_hints():
    card = _make_card()
    assert _get_hint_list(card) == []


def test_get_hint_list_prefers_hints_over_hint():
    card = _make_card(hints=["list hint"], hint="fallback hint")
    assert _get_hint_list(card) == ["list hint"]


# Tests for next_hint

def test_next_hint_level1_returns_first():
    card = _make_card(hints=["first", "second", "third"])
    assert next_hint(card, 1) == "first"


def test_next_hint_level2_returns_second():
    card = _make_card(hints=["first", "second", "third"])
    assert next_hint(card, 2) == "second"


def test_next_hint_level3_returns_third():
    card = _make_card(hints=["first", "second", "third"])
    assert next_hint(card, 3) == "third"


def test_next_hint_beyond_max_returns_none():
    card = _make_card(hints=["first", "second", "third"])
    assert next_hint(card, 4) is None


def test_next_hint_zero_returns_none():
    card = _make_card(hints=["first"])
    assert next_hint(card, 0) is None


def test_next_hint_negative_returns_none():
    card = _make_card(hints=["first"])
    assert next_hint(card, -1) is None


def test_next_hint_level1_with_single_hint():
    card = _make_card(hint="only hint")
    assert next_hint(card, 1) == "only hint"


def test_next_hint_level2_no_second_hint_returns_none():
    card = _make_card(hint="only hint")
    assert next_hint(card, 2) is None


def test_next_hint_no_hints_at_all_returns_none():
    card = _make_card()
    assert next_hint(card, 1) is None


def test_next_hint_partial_list_level_within_bounds():
    card = _make_card(hints=["a", "b"])
    assert next_hint(card, 2) == "b"
    assert next_hint(card, 3) is None


# Tests for bump_level and get_level via sidecar

def test_bump_level_starts_from_zero():
    with tempfile.TemporaryDirectory() as mount:
        level = bump_level(mount, "deck1", "card-a")
        assert level == 1


def test_bump_level_increments_on_each_call():
    with tempfile.TemporaryDirectory() as mount:
        assert bump_level(mount, "deck1", "card-a") == 1
        assert bump_level(mount, "deck1", "card-a") == 2
        assert bump_level(mount, "deck1", "card-a") == 3


def test_get_level_before_any_bump_is_zero():
    with tempfile.TemporaryDirectory() as mount:
        assert get_level(mount, "deck1", "card-a") == 0


def test_get_level_reflects_bumped_level():
    with tempfile.TemporaryDirectory() as mount:
        bump_level(mount, "deck1", "card-a")
        bump_level(mount, "deck1", "card-a")
        assert get_level(mount, "deck1", "card-a") == 2


def test_bump_level_isolated_per_card():
    with tempfile.TemporaryDirectory() as mount:
        bump_level(mount, "deck1", "card-a")
        bump_level(mount, "deck1", "card-a")
        bump_level(mount, "deck1", "card-b")
        assert get_level(mount, "deck1", "card-a") == 2
        assert get_level(mount, "deck1", "card-b") == 1


def test_bump_level_isolated_per_deck():
    with tempfile.TemporaryDirectory() as mount:
        bump_level(mount, "deck1", "card-a")
        assert get_level(mount, "deck2", "card-a") == 0


def test_sidecar_persists_across_calls():
    """Verify the level written by bump_level is readable via sidecar directly."""
    with tempfile.TemporaryDirectory() as mount:
        bump_level(mount, "deck1", "card-x")
        bump_level(mount, "deck1", "card-x")
        raw = sidecar.get(mount, "hint_progressive", "deck1", "card-x", None)
        assert raw == 2


def test_next_hint_integration_with_bump():
    """Simulate the full hint reveal flow: bump then retrieve the revealed hint."""
    card = _make_card(hints=["hint A", "hint B", "hint C"])
    with tempfile.TemporaryDirectory() as mount:
        level1 = bump_level(mount, "deck1", card.card_id)
        assert next_hint(card, level1) == "hint A"

        level2 = bump_level(mount, "deck1", card.card_id)
        assert next_hint(card, level2) == "hint B"

        level3 = bump_level(mount, "deck1", card.card_id)
        assert next_hint(card, level3) == "hint C"

        level4 = bump_level(mount, "deck1", card.card_id)
        assert next_hint(card, level4) is None


if __name__ == "__main__":
    import traceback
    tests = [
        test_get_hint_list_from_hints_key,
        test_get_hint_list_caps_at_max_level,
        test_get_hint_list_fallback_to_single_hint,
        test_get_hint_list_empty_when_no_hints,
        test_get_hint_list_prefers_hints_over_hint,
        test_next_hint_level1_returns_first,
        test_next_hint_level2_returns_second,
        test_next_hint_level3_returns_third,
        test_next_hint_beyond_max_returns_none,
        test_next_hint_zero_returns_none,
        test_next_hint_negative_returns_none,
        test_next_hint_level1_with_single_hint,
        test_next_hint_level2_no_second_hint_returns_none,
        test_next_hint_no_hints_at_all_returns_none,
        test_next_hint_partial_list_level_within_bounds,
        test_bump_level_starts_from_zero,
        test_bump_level_increments_on_each_call,
        test_get_level_before_any_bump_is_zero,
        test_get_level_reflects_bumped_level,
        test_bump_level_isolated_per_card,
        test_bump_level_isolated_per_deck,
        test_sidecar_persists_across_calls,
        test_next_hint_integration_with_bump,
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
    import sys as _sys
    _sys.exit(0 if failed == 0 else 1)
