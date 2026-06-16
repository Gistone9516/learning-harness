# -*- coding: utf-8 -*-
"""Tests for the pure unit-filter helper (bot/study_select.py)."""
import os
import sys
from types import SimpleNamespace

_BOT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _BOT_ROOT)

import _paths
_paths.setup()

from study_select import filter_cards_by_unit


def _cards():
    return [
        SimpleNamespace(card_id="a", unit="day-01"),
        SimpleNamespace(card_id="b", unit="day-01"),
        SimpleNamespace(card_id="c", unit="day-02"),
        SimpleNamespace(card_id="d", unit="day-01-learn"),
    ]


def test_exact_unit_match():
    out = filter_cards_by_unit(_cards(), "day-01")
    assert [c.card_id for c in out] == ["a", "b"]   # exact: day-01 != day-01-learn


def test_learn_unit_is_distinct():
    out = filter_cards_by_unit(_cards(), "day-01-learn")
    assert [c.card_id for c in out] == ["d"]


def test_unknown_unit_empty():
    assert filter_cards_by_unit(_cards(), "day-99") == []


def test_falsy_unit_returns_all():
    assert len(filter_cards_by_unit(_cards(), None)) == 4
    assert len(filter_cards_by_unit(_cards(), "")) == 4
