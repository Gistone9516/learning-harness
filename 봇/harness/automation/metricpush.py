"""
metricpush - Push named metrics to a live dashboard card.

WHAT  : Accepts named numeric pushes from multiple callers and aggregates
        them into a single dashboard card with real-time coalesced updates.
DEPS  : discord.py>=2.6
PERMS : Send Messages
USAGE : dash = MetricDashboard(CHANNEL, "Stats"); await dash.start()
        dash.push("pnl", 1234); dash.push("trades", 5); ... ; await dash.finalize()
SAFETY: Live-edit coalescing (at most one edit per second). Do not push secrets.
DEMO  : python harness/automation/metricpush.py  (offline render validation)
"""

import asyncio
from typing import Optional

import discord

COLOR_MAIN = 0x5865F2
COLOR_DONE = 0x57F287


def _card(text: str, color: int = COLOR_MAIN) -> discord.ui.LayoutView:
    v = discord.ui.LayoutView(timeout=None)
    v.add_item(discord.ui.Container(discord.ui.TextDisplay(text or "..."), accent_colour=color))
    return v


class MetricDashboard:
    def __init__(self, channel: "discord.abc.Messageable", title: str = "Metrics", interval: float = 1.0):
        self.channel = channel
        self.title = title
        self.interval = max(0.5, float(interval))
        self.metrics: dict = {}
        self._msg: Optional[discord.Message] = None
        self._dirty: bool = False
        self._task: Optional[asyncio.Task] = None

    def push(self, name: str, value) -> None:
        self.metrics[name] = value
        self._dirty = True

    def _render(self, color: int = COLOR_MAIN) -> discord.ui.LayoutView:
        body = "\n".join(f"`{k}`  {v}" for k, v in self.metrics.items()) or "(no metrics)"
        return _card(f"**{self.title}**\n{body}", color)

    async def start(self) -> "MetricDashboard":
        self._msg = await self.channel.send(view=self._render())
        self._task = asyncio.create_task(self._loop())
        return self

    async def _loop(self) -> None:
        try:
            while True:
                await asyncio.sleep(self.interval)
                if self._dirty and self._msg is not None:
                    self._dirty = False
                    try:
                        await self._msg.edit(view=self._render())
                    except Exception:
                        pass
        except asyncio.CancelledError:
            pass

    async def finalize(self) -> None:
        if self._task:
            self._task.cancel()
            self._task = None
        if self._msg is not None:
            try:
                await self._msg.edit(view=self._render(COLOR_DONE))
            except Exception:
                pass


if __name__ == "__main__":
    d = MetricDashboard(None, "T")
    d.push("pnl", 1234)
    d.push("trades", 5)
    assert d._render().to_components()
    print("metricpush: offline render OK")
