# -*- coding: utf-8 -*-
"""Headless tests for render/digest_weekly.

Tests cover the pure core function build_digest_lines only.
No live Discord connection required.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

from models import (
    ByAreaEntry,
    DashboardData,
    PassPathEntry,
    WeaknessEntry,
    CompletionEntry,
)
from render.digest_weekly import build_digest_lines, _TOP_WEAK_N, _TOP_PASS_N


# Helpers to build minimal DashboardData objects.

def _empty_data() -> DashboardData:
    return DashboardData(by_area=[], weakness=[], pass_path=[], completion=[])


def _full_data() -> DashboardData:
    by_area = [
        ByAreaEntry(area="수학", subarea="미적분", retrieval_rate=0.8),
        ByAreaEntry(area="수학", subarea="확률", retrieval_rate=0.5),
        ByAreaEntry(area="영어", subarea="어휘", retrieval_rate=0.6),
    ]
    weakness = [
        WeaknessEntry(area="수학", subarea="확률", unit="1단원", wrong_rate=0.5),
        WeaknessEntry(area="영어", subarea="어휘", unit="3단원", wrong_rate=0.4),
        WeaknessEntry(area="수학", subarea="미적분", unit="2단원", wrong_rate=0.2),
        WeaknessEntry(area="국어", subarea="문법", unit="1단원", wrong_rate=0.1),
    ]
    pass_path = [
        PassPathEntry(
            area="수학", subarea="미적분",
            target=70, coverage=0.9, mastery=0.8, progress=0.72, status="safe",
        ),
        PassPathEntry(
            area="수학", subarea="확률",
            target=60, coverage=0.5, mastery=0.4, progress=0.2, status="danger",
        ),
        PassPathEntry(
            area="영어", subarea="어휘",
            target=80, coverage=0.7, mastery=0.6, progress=0.42, status="watch",
        ),
    ]
    completion = [
        CompletionEntry(
            area="수학", subarea="미적분",
            box_dist={"box1": 2, "box2": 3, "box3": 5},
            mastery_rate=0.5,
        ),
    ]
    return DashboardData(by_area=by_area, weakness=weakness, pass_path=pass_path, completion=completion)


# Tests for empty data


def test_empty_data_returns_list():
    lines = build_digest_lines(_empty_data())
    assert isinstance(lines, list)
    assert len(lines) > 0


def test_empty_data_no_session_stats_no_crash():
    lines = build_digest_lines(_empty_data())
    # No session stats line when not provided.
    assert not any("이번 주 학습" in line for line in lines)


def test_empty_by_area_shows_no_data():
    lines = build_digest_lines(_empty_data())
    assert any("데이터 없음" in line for line in lines)


def test_empty_weakness_shows_no_data():
    lines = build_digest_lines(_empty_data())
    assert any("취약 단원" in line for line in lines)


def test_empty_pass_path_shows_no_target():
    lines = build_digest_lines(_empty_data())
    assert any("목표 미설정" in line for line in lines)


# Tests for full data


def test_full_data_returns_lines():
    lines = build_digest_lines(_full_data())
    assert len(lines) >= 4


def test_overall_retrieval_rate_present():
    lines = build_digest_lines(_full_data())
    assert any("전체 평균 정답률" in line for line in lines)


def test_overall_rate_shows_percentage():
    lines = build_digest_lines(_full_data())
    rate_lines = [l for l in lines if "전체 평균 정답률" in l]
    assert len(rate_lines) == 1
    assert "%" in rate_lines[0]


def test_overall_rate_value_correct():
    data = DashboardData(
        by_area=[
            ByAreaEntry(area="A", subarea="X", retrieval_rate=0.8),
            ByAreaEntry(area="A", subarea="Y", retrieval_rate=0.6),
        ],
        weakness=[],
        pass_path=[],
        completion=[],
    )
    lines = build_digest_lines(data)
    rate_lines = [l for l in lines if "전체 평균 정답률" in l]
    assert "70.0%" in rate_lines[0]


def test_by_area_with_none_retrieval_excluded_from_average():
    data = DashboardData(
        by_area=[
            ByAreaEntry(area="A", subarea="X", retrieval_rate=1.0),
            ByAreaEntry(area="B", subarea="Y", retrieval_rate=None),
        ],
        weakness=[],
        pass_path=[],
        completion=[],
    )
    lines = build_digest_lines(data)
    rate_lines = [l for l in lines if "전체 평균 정답률" in l]
    assert "100.0%" in rate_lines[0]
    assert "1개 영역" in rate_lines[0]


def test_weakness_section_header_present():
    lines = build_digest_lines(_full_data())
    assert any("취약 단원" in line for line in lines)


def test_weakness_limits_to_top_n():
    lines = build_digest_lines(_full_data())
    weak_detail_lines = [l for l in lines if "오답률" in l]
    assert len(weak_detail_lines) <= _TOP_WEAK_N


def test_weakness_shows_correct_entries():
    lines = build_digest_lines(_full_data())
    weak_detail_lines = [l for l in lines if "오답률" in l]
    # First entry must be highest wrong_rate (0.5 = 수학/확률/1단원).
    assert "확률" in weak_detail_lines[0]
    assert "50.0%" in weak_detail_lines[0]


def test_weakness_shows_area_and_unit():
    lines = build_digest_lines(_full_data())
    weak_detail_lines = [l for l in lines if "오답률" in l]
    first = weak_detail_lines[0]
    assert "수학" in first
    assert "1단원" in first


def test_pass_path_section_header_present():
    lines = build_digest_lines(_full_data())
    assert any("합격 경로" in line for line in lines)


def test_pass_path_limits_to_top_n():
    lines = build_digest_lines(_full_data())
    pass_detail_lines = [l for l in lines if "커버리지" in l]
    assert len(pass_detail_lines) <= _TOP_PASS_N


def test_pass_path_status_translated_to_korean():
    lines = build_digest_lines(_full_data())
    pass_detail_lines = [l for l in lines if "커버리지" in l]
    all_text = " ".join(pass_detail_lines)
    # All three statuses appear in the test data.
    assert "안전" in all_text
    assert "주의" in all_text
    assert "위험" in all_text


def test_pass_path_shows_target():
    lines = build_digest_lines(_full_data())
    pass_detail_lines = [l for l in lines if "목표" in l and "커버리지" in l]
    assert len(pass_detail_lines) > 0
    assert "70점" in pass_detail_lines[0] or "60점" in pass_detail_lines[0] or "80점" in pass_detail_lines[0]


# Tests with session_stats


def test_session_stats_header_when_provided():
    lines = build_digest_lines(_empty_data(), session_stats={"total": 20, "correct": 15, "incorrect": 5})
    assert any("이번 주 학습" in line for line in lines)


def test_session_stats_values_shown():
    lines = build_digest_lines(_empty_data(), session_stats={"total": 20, "correct": 15, "incorrect": 5})
    header = [l for l in lines if "이번 주 학습" in l][0]
    assert "20" in header
    assert "15" in header
    assert "5" in header


def test_session_stats_none_no_header():
    lines = build_digest_lines(_full_data(), session_stats=None)
    assert not any("이번 주 학습" in line for line in lines)


def test_session_stats_zero_values():
    lines = build_digest_lines(_empty_data(), session_stats={"total": 0, "correct": 0, "incorrect": 0})
    header = [l for l in lines if "이번 주 학습" in l][0]
    assert "0" in header


# Tests for return type and structure


def test_returns_list_of_strings():
    lines = build_digest_lines(_full_data())
    assert all(isinstance(line, str) for line in lines)


def test_no_empty_lines():
    lines = build_digest_lines(_full_data())
    assert all(line.strip() for line in lines)


def test_no_crash_on_single_by_area_entry():
    data = DashboardData(
        by_area=[ByAreaEntry(area="A", subarea="X", retrieval_rate=0.75)],
        weakness=[],
        pass_path=[],
        completion=[],
    )
    lines = build_digest_lines(data)
    assert any("75.0%" in l for l in lines)


def test_no_crash_on_single_pass_path_entry():
    data = DashboardData(
        by_area=[],
        weakness=[],
        pass_path=[
            PassPathEntry(
                area="A", subarea="X",
                target=80, coverage=1.0, mastery=1.0, progress=1.0, status="safe",
            )
        ],
        completion=[],
    )
    lines = build_digest_lines(data)
    assert any("합격 경로" in l for l in lines)
    assert any("안전" in l for l in lines)


if __name__ == "__main__":
    import traceback
    tests = [
        test_empty_data_returns_list,
        test_empty_data_no_session_stats_no_crash,
        test_empty_by_area_shows_no_data,
        test_empty_weakness_shows_no_data,
        test_empty_pass_path_shows_no_target,
        test_full_data_returns_lines,
        test_overall_retrieval_rate_present,
        test_overall_rate_shows_percentage,
        test_overall_rate_value_correct,
        test_by_area_with_none_retrieval_excluded_from_average,
        test_weakness_section_header_present,
        test_weakness_limits_to_top_n,
        test_weakness_shows_correct_entries,
        test_weakness_shows_area_and_unit,
        test_pass_path_section_header_present,
        test_pass_path_limits_to_top_n,
        test_pass_path_status_translated_to_korean,
        test_pass_path_shows_target,
        test_session_stats_header_when_provided,
        test_session_stats_values_shown,
        test_session_stats_none_no_header,
        test_session_stats_zero_values,
        test_returns_list_of_strings,
        test_no_empty_lines,
        test_no_crash_on_single_by_area_entry,
        test_no_crash_on_single_pass_path_entry,
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
