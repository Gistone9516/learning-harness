# -*- coding: utf-8 -*-
"""dashboard_live - Render DashboardData as a live card.

Pure core: build_dashboard_text(data) -> str
Discord shell: async def render(channel, data) sends via titled_card.

No discord import needed for the pure core.
"""
from __future__ import annotations

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

from models import DashboardData, ByAreaEntry, WeaknessEntry, PassPathEntry, CompletionEntry

_TOP_WEAKNESS = 5   # max weakness entries to show
_PASS_STATUS_LABEL = {
    "safe": "안전",
    "watch": "주의",
    "danger": "위험",
}


# ---- pure core ----------------------------------------------------------------

def _fmt_rate(rate: float | None) -> str:
    """Format a float rate as a percentage string. None means no data yet."""
    if rate is None:
        return "-(미시도)"
    return f"{rate * 100:.0f}%"


def _section_by_area(entries: list[ByAreaEntry]) -> str:
    """Build the retrieval rate by area section."""
    if not entries:
        return "**영역별 인출률**\n데이터 없음."
    lines = ["**영역별 인출률**"]
    for e in entries:
        lines.append(f"  {e.area} / {e.subarea}: {_fmt_rate(e.retrieval_rate)}")
    return "\n".join(lines)


def _section_weakness(entries: list[WeaknessEntry]) -> str:
    """Build the top weakness units section (up to _TOP_WEAKNESS entries)."""
    if not entries:
        return "**취약 단원 Top {n}**\n데이터 없음.".format(n=_TOP_WEAKNESS)
    top = entries[:_TOP_WEAKNESS]
    lines = [f"**취약 단원 Top {_TOP_WEAKNESS}**"]
    for i, e in enumerate(top, start=1):
        lines.append(f"  {i}. [{e.area}/{e.subarea}] {e.unit} — 오답률 {_fmt_rate(e.wrong_rate)}")
    return "\n".join(lines)


def _section_pass_path(entries: list[PassPathEntry]) -> str:
    """Build the pass path status section."""
    if not entries:
        return ""
    lines = ["**합격경로 현황**"]
    for e in entries:
        status_label = _PASS_STATUS_LABEL.get(e.status, e.status)
        lines.append(
            f"  {e.area} / {e.subarea}: 진도 {_fmt_rate(e.progress)} "
            f"(목표 {e.target}%) [{status_label}]"
        )
    return "\n".join(lines)


def _section_completion(entries: list[CompletionEntry]) -> str:
    """Build the box completion / mastery rate section."""
    if not entries:
        return "**완성도 (박스 분포)**\n데이터 없음."
    lines = ["**완성도 (박스 분포)**"]
    for e in entries:
        d = e.box_dist
        lines.append(
            f"  {e.area} / {e.subarea}: "
            f"Box1={d.get('box1', 0)} Box2={d.get('box2', 0)} Box3={d.get('box3', 0)} "
            f"마스터 {_fmt_rate(e.mastery_rate)}"
        )
    return "\n".join(lines)


def build_dashboard_text(data: DashboardData) -> str:
    """Pure function. Build a multi-section dashboard string from DashboardData.

    Returns a single Korean string suitable for sending as a Discord card body.
    Sections: retrieval rate by area, top weakness units, pass path status,
    box completion.
    """
    sections: list[str] = []

    by_area_text = _section_by_area(data.by_area)
    sections.append(by_area_text)

    weakness_text = _section_weakness(data.weakness)
    sections.append(weakness_text)

    pass_path_text = _section_pass_path(data.pass_path)
    if pass_path_text:
        sections.append(pass_path_text)

    completion_text = _section_completion(data.completion)
    sections.append(completion_text)

    return "\n\n".join(sections)


# ---- discord shell ------------------------------------------------------------

async def render(channel, data: DashboardData) -> None:
    """Send a dashboard card to channel.

    Builds the text via build_dashboard_text (pure) then sends it as a titled_card.
    No return value: this is a fire-and-forget display.
    """
    import discord
    from cards import titled_card, COLOR_MAIN

    body = build_dashboard_text(data)
    view = titled_card("학습 대시보드", body, color=COLOR_MAIN)
    await channel.send(view=view)
