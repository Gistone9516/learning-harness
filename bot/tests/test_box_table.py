# -*- coding: utf-8 -*-
"""Headless tests for the box_table render module.

build_box_rows (pure core) is tested directly on constructed DashboardData.
No live Discord connection is required.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

from models import (
    ByAreaEntry,
    CompletionEntry,
    DashboardData,
    WeaknessEntry,
)
from render.box_table import build_box_rows


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_data(completion: list) -> DashboardData:
    """Construct a minimal DashboardData for testing."""
    return DashboardData(
        by_area=[],
        weakness=[],
        pass_path=[],
        completion=completion,
    )


def _entry(area: str, subarea: str, box1: int, box2: int, box3: int) -> CompletionEntry:
    total = box1 + box2 + box3
    mastery_rate = box3 / total if total > 0 else 0.0
    return CompletionEntry(
        area=area,
        subarea=subarea,
        box_dist={"box1": box1, "box2": box2, "box3": box3},
        mastery_rate=mastery_rate,
    )


# ── Empty data ────────────────────────────────────────────────────────────────

def test_empty_completion_returns_empty_list():
    data = _make_data([])
    assert build_box_rows(data) == []


# ── Single row ────────────────────────────────────────────────────────────────

def test_single_row_fields():
    entry = _entry("자연어처리", "언어모델", box1=3, box2=2, box3=5)
    data = _make_data([entry])
    rows = build_box_rows(data)
    assert len(rows) == 1
    area, subarea, box1, box2, box3, mastery = rows[0]
    assert area == "자연어처리"
    assert subarea == "언어모델"
    assert box1 == 3
    assert box2 == 2
    assert box3 == 5


def test_mastery_pct_format():
    # 5 out of 10 cards in box3 -> 50%
    entry = _entry("수학", "선형대수", box1=3, box2=2, box3=5)
    data = _make_data([entry])
    rows = build_box_rows(data)
    area, subarea, b1, b2, b3, mastery = rows[0]
    assert mastery == "50%"


def test_mastery_pct_rounds_correctly():
    # 1 out of 3 cards in box3 -> 33.3...% rounds to 33%
    entry = CompletionEntry(
        area="A",
        subarea="B",
        box_dist={"box1": 2, "box2": 0, "box3": 1},
        mastery_rate=1 / 3,
    )
    data = _make_data([entry])
    rows = build_box_rows(data)
    assert rows[0][5] == "33%"


def test_mastery_100_percent():
    entry = CompletionEntry(
        area="A",
        subarea="B",
        box_dist={"box1": 0, "box2": 0, "box3": 5},
        mastery_rate=1.0,
    )
    data = _make_data([entry])
    rows = build_box_rows(data)
    assert rows[0][5] == "100%"


def test_mastery_0_percent():
    entry = _entry("A", "B", box1=5, box2=0, box3=0)
    data = _make_data([entry])
    rows = build_box_rows(data)
    assert rows[0][5] == "0%"


# ── Multiple rows ─────────────────────────────────────────────────────────────

def test_multiple_rows_count():
    entries = [
        _entry("A", "a1", 2, 1, 1),
        _entry("A", "a2", 0, 3, 2),
        _entry("B", "b1", 5, 0, 0),
    ]
    data = _make_data(entries)
    rows = build_box_rows(data)
    assert len(rows) == 3


def test_multiple_rows_order_preserved():
    # build_box_rows preserves data.completion order (engine already sorts ASC)
    entries = [
        _entry("Z", "z1", 1, 1, 1),
        _entry("A", "a1", 2, 2, 2),
    ]
    data = _make_data(entries)
    rows = build_box_rows(data)
    assert rows[0][0] == "Z"
    assert rows[1][0] == "A"


def test_box_counts_are_integers():
    entry = _entry("X", "y", box1=10, box2=5, box3=3)
    data = _make_data([entry])
    rows = build_box_rows(data)
    area, subarea, b1, b2, b3, mastery = rows[0]
    assert isinstance(b1, int)
    assert isinstance(b2, int)
    assert isinstance(b3, int)


# ── Tuple shape ───────────────────────────────────────────────────────────────

def test_row_has_six_fields():
    entry = _entry("A", "B", 1, 2, 3)
    data = _make_data([entry])
    rows = build_box_rows(data)
    assert len(rows[0]) == 6


# ── box_dist missing keys fallback ────────────────────────────────────────────

def test_missing_box_key_defaults_to_zero():
    # box_dist with only partial keys
    entry = CompletionEntry(
        area="A",
        subarea="B",
        box_dist={"box1": 4},  # box2, box3 absent
        mastery_rate=0.0,
    )
    data = _make_data([entry])
    rows = build_box_rows(data)
    area, subarea, b1, b2, b3, mastery = rows[0]
    assert b1 == 4
    assert b2 == 0
    assert b3 == 0
