# -*- coding: utf-8 -*-
"""Headless tests for render/mastery_chart.py.

Pure core functions (has_matplotlib, build_mastery_text, build_mastery_png)
are tested directly. No live Discord connection is required.

The matplotlib-absent path is covered by monkeypatching the module-level
_HAVE_MPL flag and the module-level plt reference so build_mastery_png
returns None and build_mastery_text is exercised.
"""
from __future__ import annotations

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import pytest

from models import DashboardData, CompletionEntry
import render.mastery_chart as mc


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_data(*entries: tuple) -> DashboardData:
    """Build a minimal DashboardData with given (area, subarea, mastery_rate) tuples."""
    completion = [
        CompletionEntry(
            area=area,
            subarea=subarea,
            box_dist={"box1": 0, "box2": 0, "box3": 0},
            mastery_rate=rate,
        )
        for area, subarea, rate in entries
    ]
    return DashboardData(by_area=[], weakness=[], pass_path=[], completion=completion)


def _empty_data() -> DashboardData:
    return DashboardData(by_area=[], weakness=[], pass_path=[], completion=[])


# ── has_matplotlib ────────────────────────────────────────────────────────────

def test_has_matplotlib_returns_bool():
    result = mc.has_matplotlib()
    assert isinstance(result, bool)


# ── build_mastery_text (fallback table) ───────────────────────────────────────

def test_build_mastery_text_empty():
    data = _empty_data()
    text = mc.build_mastery_text(data)
    assert "숙달도 데이터가 없습니다" in text


def test_build_mastery_text_contains_mastery_numbers():
    data = _make_data(("NLP", "감성분석", 0.75), ("NLP", "개체명인식", 0.40))
    text = mc.build_mastery_text(data)
    assert "75.0%" in text
    assert "40.0%" in text


def test_build_mastery_text_contains_area_and_subarea():
    data = _make_data(("CV", "객체탐지", 0.60))
    text = mc.build_mastery_text(data)
    assert "CV" in text
    assert "객체탐지" in text


def test_build_mastery_text_zero_mastery():
    data = _make_data(("수학", "미적분", 0.0))
    text = mc.build_mastery_text(data)
    assert "0.0%" in text


def test_build_mastery_text_full_mastery():
    data = _make_data(("수학", "선형대수", 1.0))
    text = mc.build_mastery_text(data)
    assert "100.0%" in text


def test_build_mastery_text_is_code_block():
    data = _make_data(("A", "B", 0.5))
    text = mc.build_mastery_text(data)
    assert text.startswith("```")
    assert text.strip().endswith("```")


def test_build_mastery_text_multiple_entries_all_present():
    entries = [("영역A", "하위A", 0.1), ("영역B", "하위B", 0.9), ("영역C", "하위C", 0.5)]
    data = _make_data(*entries)
    text = mc.build_mastery_text(data)
    for pct in ("10.0%", "90.0%", "50.0%"):
        assert pct in text, f"{pct} not found in text output"


# ── build_mastery_png (matplotlib path, skip if absent) ──────────────────────

@pytest.mark.skipif(not mc.has_matplotlib(), reason="matplotlib not installed")
def test_build_mastery_png_returns_bytesio():
    data = _make_data(("NLP", "분류", 0.8))
    buf = mc.build_mastery_png(data)
    assert buf is not None
    assert buf.getbuffer().nbytes > 0


@pytest.mark.skipif(not mc.has_matplotlib(), reason="matplotlib not installed")
def test_build_mastery_png_empty_data_returns_none():
    data = _empty_data()
    buf = mc.build_mastery_png(data)
    assert buf is None


@pytest.mark.skipif(not mc.has_matplotlib(), reason="matplotlib not installed")
def test_build_mastery_png_multiple_entries():
    entries = [("A", "X", 0.2), ("B", "Y", 0.6), ("C", "Z", 0.9)]
    data = _make_data(*entries)
    buf = mc.build_mastery_png(data)
    assert buf is not None
    assert buf.getbuffer().nbytes > 0


# ── matplotlib-absent path (monkeypatch) ─────────────────────────────────────

def test_has_matplotlib_false_when_flag_patched(monkeypatch):
    monkeypatch.setattr(mc, "_HAVE_MPL", False)
    assert mc.has_matplotlib() is False


def test_build_mastery_png_returns_none_without_matplotlib(monkeypatch):
    monkeypatch.setattr(mc, "_HAVE_MPL", False)
    data = _make_data(("NLP", "분류", 0.7))
    result = mc.build_mastery_png(data)
    assert result is None


def test_build_mastery_text_still_works_without_matplotlib(monkeypatch):
    """build_mastery_text must produce correct output regardless of matplotlib availability."""
    monkeypatch.setattr(mc, "_HAVE_MPL", False)
    data = _make_data(("NLP", "감성분석", 0.85))
    text = mc.build_mastery_text(data)
    assert "85.0%" in text
    assert "NLP" in text
    assert "감성분석" in text


def test_matplotlib_absent_path_uses_text(monkeypatch):
    """When _HAVE_MPL is False, build_mastery_png returns None and build_mastery_text provides fallback output."""
    monkeypatch.setattr(mc, "_HAVE_MPL", False)
    data = _make_data(("CV", "분류", 0.33), ("NLP", "생성", 0.67))

    png_result = mc.build_mastery_png(data)
    text_result = mc.build_mastery_text(data)

    assert png_result is None
    assert "33.0%" in text_result
    assert "67.0%" in text_result
