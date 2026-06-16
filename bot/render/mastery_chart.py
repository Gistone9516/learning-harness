# -*- coding: utf-8 -*-
"""mastery_chart - Render a mastery bar chart from DashboardData.completion.

Pure core (no discord):
    has_matplotlib() -> bool
    build_mastery_text(data: DashboardData) -> str    (text table fallback)
    build_mastery_png(data: DashboardData) -> io.BytesIO | None  (returns None when matplotlib absent)

Discord shell:
    async render(channel, data: DashboardData) -> None
        Sends a PNG chart when matplotlib is available, otherwise sends a text table.
"""
from __future__ import annotations

import io
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

from models import DashboardData

log = logging.getLogger(__name__)

# Attempt to import matplotlib at module load time; degrade gracefully if absent.
try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    _HAVE_MPL = True
except Exception:
    _HAVE_MPL = False


# ── Pure core ─────────────────────────────────────────────────────────────────

def has_matplotlib() -> bool:
    """Return True when matplotlib is available and usable for chart rendering."""
    return _HAVE_MPL


def build_mastery_text(data: DashboardData) -> str:
    """Build a plain-text mastery table from DashboardData.completion.

    Each row shows area, subarea, and mastery_rate as a percentage.
    Returns a markdown code block suitable for Discord.
    """
    entries = data.completion
    if not entries:
        return "```\n숙달도 데이터가 없습니다.\n```"

    lines = ["영역              하위영역          숙달도"]
    lines.append("-" * 46)
    for e in entries:
        area = e.area[:16].ljust(16)
        subarea = e.subarea[:16].ljust(16)
        pct = f"{e.mastery_rate * 100:.1f}%"
        lines.append(f"{area}  {subarea}  {pct}")

    return "```\n" + "\n".join(lines) + "\n```"


def build_mastery_png(data: DashboardData) -> "io.BytesIO | None":
    """Render a horizontal bar chart of mastery_rate per (area, subarea) to PNG.

    Returns a BytesIO PNG buffer, or None when matplotlib is absent or there
    is no completion data to show.
    """
    if not _HAVE_MPL:
        return None

    entries = data.completion
    if not entries:
        return None

    labels = [f"{e.area} / {e.subarea}" for e in entries]
    values = [e.mastery_rate * 100 for e in entries]

    # Decide bar colors: green (>=70%), yellow (>=40%), red (<40%).
    colors = []
    for v in values:
        if v >= 70:
            colors.append("#57F287")
        elif v >= 40:
            colors.append("#F1C40F")
        else:
            colors.append("#ED4245")

    fig_height = max(2.5, 0.45 * len(labels))
    fig, ax = plt.subplots(figsize=(7, fig_height))

    y_pos = range(len(labels))
    ax.barh(list(y_pos), values, color=colors, height=0.6)
    ax.set_yticks(list(y_pos))
    ax.set_yticklabels(labels, fontsize=9)
    ax.set_xlim(0, 100)
    ax.set_xlabel("숙달도 (%)")
    ax.set_title("숙달도 차트")
    ax.axvline(x=70, color="#5865F2", linewidth=1, linestyle="--", alpha=0.7)
    ax.invert_yaxis()

    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=120)
    plt.close(fig)
    buf.seek(0)
    return buf


# ── Discord shell ─────────────────────────────────────────────────────────────

async def render(channel: "discord.abc.Messageable", data: DashboardData) -> None:
    """Send a mastery chart to the channel.

    Sends a PNG bar chart when matplotlib is available. Falls back to a
    plain-text table when matplotlib is missing or the chart cannot be built.
    """
    import discord
    from imagesend import send_image

    if has_matplotlib():
        buf = build_mastery_png(data)
        if buf is not None:
            try:
                await send_image(channel, buf, "mastery_chart.png", content="**숙달도 차트**")
                return
            except Exception as exc:
                log.warning("mastery_chart: PNG send failed, falling back to text: %s", exc)

    text = build_mastery_text(data)
    await channel.send(f"**숙달도 현황**\n{text}")
