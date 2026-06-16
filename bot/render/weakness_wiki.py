# -*- coding: utf-8 -*-
"""weakness_wiki - Create forum posts for weak areas from DashboardData.weakness.

Pure core (no discord):
    build_weakness_posts(data, top_n=5) -> list[dict]
        Builds a list of post dicts (title, content, tags) for the top-N entries
        sorted by wrong_rate descending. Korean UI strings throughout.

Discord shell:
    async render(forum, data, top_n=5) -> None
        Calls create_post for each post dict and creates a thread per weak area.
"""
from __future__ import annotations

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import discord
    from models import DashboardData

# Default number of top weak areas to surface.
_DEFAULT_TOP_N = 5

# Tag applied to every weakness forum post.
_TAG_WEAKNESS = "취약단원"

# Wrong-rate thresholds for severity tags.
_THRESHOLD_CRITICAL = 0.7   # wrong_rate >= 70% gets "위험" tag
_THRESHOLD_WATCH    = 0.4   # wrong_rate >= 40% gets "주의" tag


def _severity_label(wrong_rate: float) -> str:
    """Return a Korean severity label based on wrong_rate."""
    if wrong_rate >= _THRESHOLD_CRITICAL:
        return "위험"
    if wrong_rate >= _THRESHOLD_WATCH:
        return "주의"
    return "관찰"


def _build_post(entry, rank: int) -> dict:
    """Build a single forum post dict for one WeaknessEntry.

    Args:
        entry: WeaknessEntry with area, subarea, unit, wrong_rate fields.
        rank: 1-based rank position in the sorted weakness list.

    Returns:
        Dict with keys: title (str), content (str), tags (list[str]).
    """
    pct = entry.wrong_rate * 100
    severity = _severity_label(entry.wrong_rate)

    title = f"[취약 {rank}위] {entry.unit} ({entry.area} / {entry.subarea})"

    lines = [
        f"**단원:** {entry.unit}",
        f"**영역:** {entry.area} / {entry.subarea}",
        f"**오답률:** {pct:.1f}% ({severity})",
        "",
        "**학습 가이드**",
        f"이 단원의 오답률이 {pct:.1f}%입니다. 아래 방법으로 집중 복습을 진행하세요.",
        "",
        "1. 해당 단원의 카드를 다시 뽑아 틀린 문제를 반복 학습하세요.",
        "2. 핵심 개념을 요약 정리하고 스스로 설명해 보세요.",
        "3. 오답 원인을 메모에 기록해 두면 재발 방지에 도움이 됩니다.",
    ]
    content = "\n".join(lines)

    tags = [_TAG_WEAKNESS, severity]

    return {"title": title, "content": content, "tags": tags}


# Pure core


def build_weakness_posts(data: "DashboardData", top_n: int = _DEFAULT_TOP_N) -> list[dict]:
    """Build forum post dicts for the top-N weakest areas sorted by wrong_rate desc.

    Args:
        data: DashboardData whose weakness list comes pre-populated from the engine.
        top_n: Maximum number of posts to build. Defaults to 5.

    Returns:
        A list of dicts each with keys title, content, tags. The list is sorted
        by wrong_rate descending and contains at most top_n entries.
    """
    sorted_entries = sorted(data.weakness, key=lambda e: e.wrong_rate, reverse=True)
    top_entries = sorted_entries[:top_n]

    posts = []
    for rank, entry in enumerate(top_entries, start=1):
        posts.append(_build_post(entry, rank))
    return posts


# Discord shell


async def render(
    forum: "discord.ForumChannel",
    data: "DashboardData",
    top_n: int = _DEFAULT_TOP_N,
) -> None:
    """Create one forum thread per weak area (up to top_n threads).

    Args:
        forum: Discord ForumChannel to post into.
        data: DashboardData from get_dashboard_data.
        top_n: Maximum number of posts to create. Defaults to 5.
    """
    from forum import create_post

    posts = build_weakness_posts(data, top_n=top_n)
    for post in posts:
        await create_post(forum, post["title"], post["content"], tag_names=post["tags"])
