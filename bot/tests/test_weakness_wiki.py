# -*- coding: utf-8 -*-
"""Headless tests for weakness_wiki pure core.

Tests build_weakness_posts directly with synthetic DashboardData.
No live Discord connection required.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import pytest

from models import DashboardData, ByAreaEntry, WeaknessEntry, PassPathEntry, CompletionEntry
from render.weakness_wiki import build_weakness_posts, _severity_label, _DEFAULT_TOP_N


# Helpers


def make_weakness(area: str, subarea: str, unit: str, wrong_rate: float) -> WeaknessEntry:
    """Build a WeaknessEntry for testing."""
    return WeaknessEntry(area=area, subarea=subarea, unit=unit, wrong_rate=wrong_rate)


def make_data(weakness_entries: list[WeaknessEntry]) -> DashboardData:
    """Build a minimal DashboardData with only weakness populated."""
    return DashboardData(
        by_area=[],
        weakness=weakness_entries,
        pass_path=[],
        completion=[],
    )


# build_weakness_posts: sorting and capping


def test_posts_sorted_by_wrong_rate_desc():
    """Posts are returned sorted by wrong_rate descending."""
    entries = [
        make_weakness("수학", "확률", "확률의 기초", 0.3),
        make_weakness("수학", "통계", "표본조사", 0.8),
        make_weakness("수학", "함수", "이차함수", 0.5),
    ]
    data = make_data(entries)
    posts = build_weakness_posts(data)

    # Extract wrong_rates from titles (or just verify via title content ordering).
    # The first post should mention the highest wrong_rate unit.
    assert "표본조사" in posts[0]["title"]
    assert "이차함수" in posts[1]["title"]
    assert "확률의 기초" in posts[2]["title"]


def test_posts_capped_at_top_n():
    """build_weakness_posts returns at most top_n entries."""
    entries = [make_weakness("A", "A1", f"단원{i}", i * 0.1) for i in range(1, 11)]
    data = make_data(entries)
    posts = build_weakness_posts(data, top_n=5)
    assert len(posts) == 5


def test_posts_default_top_n():
    """Default top_n is _DEFAULT_TOP_N (5)."""
    entries = [make_weakness("A", "A1", f"단원{i}", i * 0.05) for i in range(1, 9)]
    data = make_data(entries)
    posts = build_weakness_posts(data)
    assert len(posts) == _DEFAULT_TOP_N


def test_fewer_entries_than_top_n():
    """When there are fewer entries than top_n, all entries are returned."""
    entries = [
        make_weakness("수학", "미적분", "극한", 0.4),
        make_weakness("수학", "수열", "등비수열", 0.6),
    ]
    data = make_data(entries)
    posts = build_weakness_posts(data, top_n=5)
    assert len(posts) == 2


def test_empty_weakness_returns_empty():
    """Empty weakness list returns empty posts list."""
    data = make_data([])
    posts = build_weakness_posts(data)
    assert posts == []


# build_weakness_posts: post structure


def test_post_has_required_keys():
    """Each post dict must have title, content, and tags keys."""
    entries = [make_weakness("수학", "미적분", "극한의 성질", 0.55)]
    data = make_data(entries)
    posts = build_weakness_posts(data)
    post = posts[0]
    assert "title" in post
    assert "content" in post
    assert "tags" in post


def test_post_title_contains_rank_and_unit():
    """Post title includes the rank number and unit name."""
    entries = [
        make_weakness("수학", "확률", "확률변수", 0.7),
        make_weakness("수학", "통계", "정규분포", 0.5),
    ]
    data = make_data(entries)
    posts = build_weakness_posts(data, top_n=2)
    # Highest wrong_rate comes first as rank 1.
    assert "1위" in posts[0]["title"]
    assert "확률변수" in posts[0]["title"]
    assert "2위" in posts[1]["title"]
    assert "정규분포" in posts[1]["title"]


def test_post_content_includes_area_and_subarea():
    """Post content mentions the area and subarea of the weakness entry."""
    entries = [make_weakness("영어", "독해", "주제 파악", 0.6)]
    data = make_data(entries)
    posts = build_weakness_posts(data)
    content = posts[0]["content"]
    assert "영어" in content
    assert "독해" in content


def test_post_content_includes_wrong_rate_pct():
    """Post content includes the wrong rate formatted as a percentage."""
    entries = [make_weakness("국어", "문학", "현대시", 0.65)]
    data = make_data(entries)
    posts = build_weakness_posts(data)
    content = posts[0]["content"]
    assert "65.0%" in content


def test_post_tags_include_weakness_tag():
    """Post tags always include the '취약단원' tag."""
    entries = [make_weakness("수학", "기하", "벡터", 0.3)]
    data = make_data(entries)
    posts = build_weakness_posts(data)
    assert "취약단원" in posts[0]["tags"]


# build_weakness_posts: severity tags


def test_severity_tag_danger():
    """wrong_rate >= 0.7 produces '위험' severity tag."""
    entries = [make_weakness("수학", "미분", "도함수", 0.75)]
    data = make_data(entries)
    posts = build_weakness_posts(data)
    assert "위험" in posts[0]["tags"]


def test_severity_tag_watch():
    """wrong_rate >= 0.4 and < 0.7 produces '주의' severity tag."""
    entries = [make_weakness("수학", "적분", "정적분", 0.55)]
    data = make_data(entries)
    posts = build_weakness_posts(data)
    assert "주의" in posts[0]["tags"]


def test_severity_tag_observe():
    """wrong_rate < 0.4 produces '관찰' severity tag."""
    entries = [make_weakness("수학", "집합", "집합의 연산", 0.25)]
    data = make_data(entries)
    posts = build_weakness_posts(data)
    assert "관찰" in posts[0]["tags"]


def test_severity_boundary_exactly_07():
    """wrong_rate exactly 0.7 is '위험', not '주의'."""
    assert _severity_label(0.7) == "위험"


def test_severity_boundary_exactly_04():
    """wrong_rate exactly 0.4 is '주의', not '관찰'."""
    assert _severity_label(0.4) == "주의"


def test_severity_just_below_04():
    """wrong_rate just below 0.4 is '관찰'."""
    assert _severity_label(0.39) == "관찰"


# build_weakness_posts: rank ordering correctness


def test_rank_numbers_are_sequential():
    """Post titles have sequential rank numbers starting from 1."""
    entries = [
        make_weakness("A", "A1", f"단원{i}", 0.9 - i * 0.1)
        for i in range(3)
    ]
    data = make_data(entries)
    posts = build_weakness_posts(data, top_n=3)
    for i, post in enumerate(posts, start=1):
        assert f"{i}위" in post["title"]


def test_top_n_zero_returns_empty():
    """top_n=0 returns empty list even when weakness data exists."""
    entries = [make_weakness("수학", "통계", "평균", 0.5)]
    data = make_data(entries)
    posts = build_weakness_posts(data, top_n=0)
    assert posts == []


def test_top_n_one_returns_highest():
    """top_n=1 returns only the single highest wrong_rate entry."""
    entries = [
        make_weakness("A", "A1", "높음", 0.8),
        make_weakness("B", "B1", "낮음", 0.3),
    ]
    data = make_data(entries)
    posts = build_weakness_posts(data, top_n=1)
    assert len(posts) == 1
    assert "높음" in posts[0]["title"]


def test_equal_wrong_rate_entries_included():
    """Entries with identical wrong_rate are all included up to top_n."""
    entries = [make_weakness("A", "A1", f"단원{i}", 0.5) for i in range(4)]
    data = make_data(entries)
    posts = build_weakness_posts(data, top_n=4)
    assert len(posts) == 4
