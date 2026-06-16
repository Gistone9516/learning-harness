# -*- coding: utf-8 -*-
"""box_table - Render Leitner box distribution from DashboardData.completion as a live table.

Pure core (no discord):
    build_box_rows(data) -> list[tuple[str, str, int, int, int, str]]
    Each tuple is (area, subarea, box1, box2, box3, mastery_pct).

Discord shell (thin):
    async render(channel, data) -> None
    Posts a static LiveTable snapshot showing the box distribution for every
    (area, subarea) pair found in DashboardData.completion.
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

# Column headers shown in the Discord table (Korean UI strings).
_COL_AREA    = "영역"
_COL_SUBAREA = "세부영역"
_COL_BOX1    = "박스1"
_COL_BOX2    = "박스2"
_COL_BOX3    = "박스3"
_COL_MASTERY = "숙달률"


# ── Pure core ────────────────────────────────────────────────────────────────

def build_box_rows(data: "DashboardData") -> list[tuple]:
    """Build display rows from DashboardData.completion.

    Returns a list of tuples, one per CompletionEntry, with fields:
        (area, subarea, box1, box2, box3, mastery_pct_str)

    mastery_pct_str is formatted as "XX%" (rounded to nearest integer).
    Rows are returned in the same order as data.completion (already sorted
    area/subarea ASC by the engine).
    """
    rows = []
    for entry in data.completion:
        box1 = entry.box_dist.get("box1", 0)
        box2 = entry.box_dist.get("box2", 0)
        box3 = entry.box_dist.get("box3", 0)
        mastery_pct = f"{round(entry.mastery_rate * 100)}%"
        rows.append((entry.area, entry.subarea, box1, box2, box3, mastery_pct))
    return rows


# ── Discord shell ─────────────────────────────────────────────────────────────

async def render(channel: "discord.abc.Messageable", data: "DashboardData") -> None:
    """Post a LiveTable showing the Leitner box distribution for all (area, subarea) pairs.

    Sends a single finalized table card. No live update loop is started because
    the dashboard data is a static snapshot.
    """
    from livetable import LiveTable

    rows = build_box_rows(data)

    table = LiveTable(
        channel,
        title="박스 분포 현황",
        columns=[_COL_AREA, _COL_SUBAREA, _COL_BOX1, _COL_BOX2, _COL_BOX3, _COL_MASTERY],
    )

    if not rows:
        table.set_row(
            "__empty__",
            **{
                _COL_AREA: "-",
                _COL_SUBAREA: "-",
                _COL_BOX1: "-",
                _COL_BOX2: "-",
                _COL_BOX3: "-",
                _COL_MASTERY: "-",
            },
        )
    else:
        for area, subarea, box1, box2, box3, mastery_pct in rows:
            key = f"{area}|{subarea}"
            table.set_row(
                key,
                **{
                    _COL_AREA: area,
                    _COL_SUBAREA: subarea,
                    _COL_BOX1: str(box1),
                    _COL_BOX2: str(box2),
                    _COL_BOX3: str(box3),
                    _COL_MASTERY: mastery_pct,
                },
            )

    # Post a single message and immediately finalize (no polling loop needed).
    await table.start()
    await table.finalize()
