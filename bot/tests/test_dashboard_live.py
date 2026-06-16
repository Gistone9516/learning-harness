# -*- coding: utf-8 -*-
"""Headless tests for dashboard_live pure core (build_dashboard_text).

No live discord connection required. All assertions target the pure function.
"""
from __future__ import annotations

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

from models import (
    DashboardData,
    ByAreaEntry,
    WeaknessEntry,
    PassPathEntry,
    CompletionEntry,
)
from render.dashboard_live import build_dashboard_text


# Helpers -----------------------------------------------------------------------

def _make_data(
    by_area: list[ByAreaEntry] | None = None,
    weakness: list[WeaknessEntry] | None = None,
    pass_path: list[PassPathEntry] | None = None,
    completion: list[CompletionEntry] | None = None,
) -> DashboardData:
    """Build a minimal DashboardData for testing."""
    return DashboardData(
        by_area=by_area or [],
        weakness=weakness or [],
        pass_path=pass_path or [],
        completion=completion or [],
    )


# by_area section ---------------------------------------------------------------

def test_by_area_with_data_shows_rate():
    data = _make_data(
        by_area=[
            ByAreaEntry(area="통계", subarea="기초통계", retrieval_rate=0.75),
        ]
    )
    text = build_dashboard_text(data)
    assert "영역별 인출률" in text
    assert "통계" in text
    assert "기초통계" in text
    assert "75%" in text


def test_by_area_none_rate_shows_no_attempt():
    data = _make_data(
        by_area=[
            ByAreaEntry(area="수학", subarea="미적분", retrieval_rate=None),
        ]
    )
    text = build_dashboard_text(data)
    assert "미시도" in text


def test_by_area_empty_shows_no_data():
    data = _make_data(by_area=[])
    text = build_dashboard_text(data)
    assert "영역별 인출률" in text
    assert "데이터 없음" in text


def test_by_area_multiple_entries():
    data = _make_data(
        by_area=[
            ByAreaEntry(area="A과목", subarea="단원1", retrieval_rate=0.50),
            ByAreaEntry(area="A과목", subarea="단원2", retrieval_rate=1.0),
        ]
    )
    text = build_dashboard_text(data)
    assert "단원1" in text
    assert "단원2" in text
    assert "50%" in text
    assert "100%" in text


# weakness section --------------------------------------------------------------

def test_weakness_with_data_shows_wrong_rate():
    data = _make_data(
        weakness=[
            WeaknessEntry(area="통계", subarea="기초통계", unit="정규분포", wrong_rate=0.6),
        ]
    )
    text = build_dashboard_text(data)
    assert "취약 단원" in text
    assert "정규분포" in text
    assert "60%" in text


def test_weakness_shows_rank_prefix():
    data = _make_data(
        weakness=[
            WeaknessEntry(area="A", subarea="B", unit="단원X", wrong_rate=0.8),
        ]
    )
    text = build_dashboard_text(data)
    assert "1." in text


def test_weakness_capped_at_top_five():
    entries = [
        WeaknessEntry(area="A", subarea="B", unit=f"단원{i}", wrong_rate=1.0 - i * 0.05)
        for i in range(10)
    ]
    data = _make_data(weakness=entries)
    text = build_dashboard_text(data)
    # Only top 5 should appear: 단원0 through 단원4
    assert "단원0" in text
    assert "단원4" in text
    assert "단원5" not in text


def test_weakness_empty_shows_no_data():
    data = _make_data(weakness=[])
    text = build_dashboard_text(data)
    assert "취약 단원" in text
    assert "데이터 없음" in text


# pass_path section -------------------------------------------------------------

def test_pass_path_safe_status_label():
    data = _make_data(
        pass_path=[
            PassPathEntry(
                area="통계", subarea="기초통계",
                target=70, coverage=0.9, mastery=0.9, progress=0.81,
                status="safe",
            )
        ]
    )
    text = build_dashboard_text(data)
    assert "합격경로" in text
    assert "안전" in text
    assert "81%" in text
    assert "70%" in text


def test_pass_path_danger_status_label():
    data = _make_data(
        pass_path=[
            PassPathEntry(
                area="영어", subarea="독해",
                target=80, coverage=0.2, mastery=0.5, progress=0.10,
                status="danger",
            )
        ]
    )
    text = build_dashboard_text(data)
    assert "위험" in text


def test_pass_path_watch_status_label():
    data = _make_data(
        pass_path=[
            PassPathEntry(
                area="영어", subarea="문법",
                target=80, coverage=0.6, mastery=0.7, progress=0.42,
                status="watch",
            )
        ]
    )
    text = build_dashboard_text(data)
    assert "주의" in text


def test_pass_path_empty_omitted():
    data = _make_data(pass_path=[])
    text = build_dashboard_text(data)
    assert "합격경로" not in text


# completion section ------------------------------------------------------------

def test_completion_shows_box_counts():
    data = _make_data(
        completion=[
            CompletionEntry(
                area="수학", subarea="집합",
                box_dist={"box1": 5, "box2": 3, "box3": 2},
                mastery_rate=0.2,
            )
        ]
    )
    text = build_dashboard_text(data)
    assert "완성도" in text
    assert "Box1=5" in text
    assert "Box2=3" in text
    assert "Box3=2" in text
    assert "20%" in text


def test_completion_empty_shows_no_data():
    data = _make_data(completion=[])
    text = build_dashboard_text(data)
    assert "완성도" in text
    assert "데이터 없음" in text


# integration: all sections together -------------------------------------------

def test_full_dashboard_contains_all_sections():
    data = DashboardData(
        by_area=[
            ByAreaEntry(area="과학", subarea="물리", retrieval_rate=0.55),
        ],
        weakness=[
            WeaknessEntry(area="과학", subarea="물리", unit="역학", wrong_rate=0.45),
        ],
        pass_path=[
            PassPathEntry(
                area="과학", subarea="물리",
                target=60, coverage=0.5, mastery=0.8, progress=0.40,
                status="watch",
            )
        ],
        completion=[
            CompletionEntry(
                area="과학", subarea="물리",
                box_dist={"box1": 4, "box2": 4, "box3": 2},
                mastery_rate=0.20,
            )
        ],
    )
    text = build_dashboard_text(data)
    assert "영역별 인출률" in text
    assert "취약 단원" in text
    assert "합격경로" in text
    assert "완성도" in text
    assert "역학" in text
    assert "물리" in text
    assert "주의" in text


def test_return_type_is_str():
    data = _make_data()
    result = build_dashboard_text(data)
    assert isinstance(result, str)


def test_sections_separated_by_blank_line():
    data = _make_data(
        by_area=[ByAreaEntry(area="A", subarea="B", retrieval_rate=0.5)],
        completion=[
            CompletionEntry(
                area="A", subarea="B",
                box_dist={"box1": 1, "box2": 0, "box3": 0},
                mastery_rate=0.0,
            )
        ],
    )
    text = build_dashboard_text(data)
    assert "\n\n" in text
