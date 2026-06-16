# -*- coding: utf-8 -*-
"""digest_weekly - Weekly digest summary rendered to a Discord channel.

Pure core:
    build_digest_lines(data, session_stats) -> list[str]
        Builds Korean-language summary lines from DashboardData.
        Covers overall retrieval, weakest areas, and pass-path progress.

Discord shell:
    async render(channel, data, session_stats) -> None
        Sends the lines via a Digest card to the given channel.

session_stats is optional: {total, correct, incorrect} counts for the session.
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


# Number of weakest areas to surface in the digest.
_TOP_WEAK_N = 3
# Number of pass-path entries to surface.
_TOP_PASS_N = 5


# Status Korean labels for pass-path entries.
_STATUS_LABEL: dict[str, str] = {
    "safe": "안전",
    "watch": "주의",
    "danger": "위험",
}


# Pure core


def build_digest_lines(
    data: "DashboardData",
    session_stats: dict | None = None,
) -> list[str]:
    """Build a Korean weekly digest summary as a list of text lines.

    Lines cover:
      1. Optional session stats header (total attempted, correct, incorrect).
      2. Overall retrieval rate across all by_area entries.
      3. Top weakest areas (highest wrong_rate) with their subarea and wrong rate.
      4. Pass-path progress per subarea with status label.

    Args:
        data: DashboardData from get_dashboard_data.
        session_stats: Optional dict with keys total, correct, incorrect (int).

    Returns:
        A list of strings, each intended as a Digest line item.
    """
    lines: list[str] = []

    # Section 1: session stats header when provided.
    if session_stats is not None:
        total = session_stats.get("total", 0)
        correct = session_stats.get("correct", 0)
        incorrect = session_stats.get("incorrect", 0)
        lines.append(f"이번 주 학습: 총 {total}문제 (정답 {correct} / 오답 {incorrect})")

    # Section 2: overall retrieval rate.
    rated = [e for e in data.by_area if e.retrieval_rate is not None]
    if rated:
        total_attempts = sum(
            int(e.retrieval_rate * 1) for e in rated
        )
        # Compute weighted average retrieval rate from raw by_area entries.
        # retrieval_rate is cold_correct/cold_attempts per entry; to get the
        # overall rate we reconstruct the weighted mean using individual rates.
        avg_rate = sum(e.retrieval_rate for e in rated) / len(rated)
        lines.append(f"전체 평균 정답률: {avg_rate * 100:.1f}% ({len(rated)}개 영역 기준)")
    else:
        lines.append("전체 평균 정답률: 데이터 없음 (아직 시도한 카드가 없습니다)")

    # Section 3: weakest areas.
    if data.weakness:
        weak_slice = data.weakness[:_TOP_WEAK_N]
        lines.append(f"취약 단원 TOP {len(weak_slice)}")
        for entry in weak_slice:
            pct = entry.wrong_rate * 100
            lines.append(
                f"  [{entry.area} / {entry.subarea}] {entry.unit}: 오답률 {pct:.1f}%"
            )
    else:
        lines.append("취약 단원: 데이터 없음")

    # Section 4: pass-path progress.
    if data.pass_path:
        pass_slice = data.pass_path[:_TOP_PASS_N]
        lines.append("합격 경로 현황")
        for entry in pass_slice:
            status_kor = _STATUS_LABEL.get(entry.status, entry.status)
            cov_pct = entry.coverage * 100
            mst_pct = entry.mastery * 100
            prog_pct = entry.progress * 100
            lines.append(
                f"  [{entry.area} / {entry.subarea}] "
                f"커버리지 {cov_pct:.0f}% / 숙달도 {mst_pct:.0f}% / "
                f"진도 {prog_pct:.0f}% (목표 {entry.target}점, {status_kor})"
            )
    else:
        lines.append("합격 경로: 목표 미설정")

    return lines


# Discord shell


async def render(
    channel: "discord.abc.Messageable",
    data: "DashboardData",
    session_stats: dict | None = None,
) -> None:
    """Send the weekly digest summary to the given Discord channel.

    Args:
        channel: Discord channel to post to.
        data: DashboardData from get_dashboard_data.
        session_stats: Optional session stats dict (total, correct, incorrect).
    """
    from digest import Digest

    d = Digest(channel, title="주간 학습 요약")
    for line in build_digest_lines(data, session_stats):
        d.add(line)
    await d.flush()
