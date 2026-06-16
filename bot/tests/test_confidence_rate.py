# -*- coding: utf-8 -*-
"""Headless tests for the confidence_rate capability.

Pure core functions (store_confidence / get_confidence) are tested directly
with a tempfile mount. No live Discord connection is required.
"""
from __future__ import annotations

import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import pytest

from caps.confidence_rate import store_confidence, get_confidence, LEVELS, CAP_ID
import sidecar


# ── Roundtrip ────────────────────────────────────────────────────────────────

def test_store_and_get_roundtrip():
    with tempfile.TemporaryDirectory() as mount:
        store_confidence(mount, "deck1", "card-a", "easy")
        assert get_confidence(mount, "deck1", "card-a") == "easy"


def test_all_levels_roundtrip():
    with tempfile.TemporaryDirectory() as mount:
        for level in ("easy", "med", "hard"):
            store_confidence(mount, "deck1", f"card-{level}", level)
            assert get_confidence(mount, "deck1", f"card-{level}") == level


def test_get_absent_returns_none():
    with tempfile.TemporaryDirectory() as mount:
        result = get_confidence(mount, "deck1", "nonexistent-card")
        assert result is None


def test_overwrite_level():
    with tempfile.TemporaryDirectory() as mount:
        store_confidence(mount, "deck1", "card-x", "easy")
        store_confidence(mount, "deck1", "card-x", "hard")
        assert get_confidence(mount, "deck1", "card-x") == "hard"


# ── Level validation ─────────────────────────────────────────────────────────

def test_invalid_level_raises():
    with tempfile.TemporaryDirectory() as mount:
        with pytest.raises(ValueError, match="Unknown confidence level"):
            store_confidence(mount, "deck1", "card-a", "unknown")


def test_valid_levels_are_easy_med_hard():
    assert set(LEVELS.keys()) == {"easy", "med", "hard"}


def test_korean_labels_present():
    assert LEVELS["easy"] == "쉬움"
    assert LEVELS["med"] == "보통"
    assert LEVELS["hard"] == "어려움"


# ── Sidecar isolation ────────────────────────────────────────────────────────

def test_isolated_per_deck():
    with tempfile.TemporaryDirectory() as mount:
        store_confidence(mount, "deck1", "card-a", "easy")
        store_confidence(mount, "deck2", "card-a", "hard")
        assert get_confidence(mount, "deck1", "card-a") == "easy"
        assert get_confidence(mount, "deck2", "card-a") == "hard"


def test_does_not_collide_with_other_capabilities():
    with tempfile.TemporaryDirectory() as mount:
        store_confidence(mount, "deck1", "card-a", "easy")
        # write something else under a different cap_id directly
        sidecar.set(mount, "hint_progressive", "deck1", "card-a", 3)
        # confidence sidecar must remain untouched
        assert get_confidence(mount, "deck1", "card-a") == "easy"
        # hint sidecar is its own file
        assert sidecar.get(mount, "hint_progressive", "deck1", "card-a") == 3


def test_cap_id_constant():
    assert CAP_ID == "confidence_rate"


# ── Multiple cards coexist ───────────────────────────────────────────────────

def test_multiple_cards_coexist():
    with tempfile.TemporaryDirectory() as mount:
        store_confidence(mount, "deck1", "card-1", "easy")
        store_confidence(mount, "deck1", "card-2", "med")
        store_confidence(mount, "deck1", "card-3", "hard")

        assert get_confidence(mount, "deck1", "card-1") == "easy"
        assert get_confidence(mount, "deck1", "card-2") == "med"
        assert get_confidence(mount, "deck1", "card-3") == "hard"

        all_data = sidecar.load_all(mount, CAP_ID, "deck1")
        assert all_data == {"card-1": "easy", "card-2": "med", "card-3": "hard"}
