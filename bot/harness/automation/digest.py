"""
digest - Periodic event roll-up summary.

WHAT : Accumulates events and posts them as a summary card periodically (or on flush) to reduce spam.
DEPS : discord.py>=2.6
PERMS: Send Messages
USAGE: d = Digest(CHANNEL, title="Daily Summary", interval=3600); d.start()
       d.add("Order filled: AAPL x10"); ...   # items collected over each interval are posted as a card
       await d.flush()   # post immediately
SAFETY: Do not add items containing secrets or credentials.
DEMO: python harness/automation/digest.py  (offline verification)
"""

import asyncio
from typing import Optional

import discord

COLOR_MAIN = 0x5865F2


def _card(text: str) -> discord.ui.LayoutView:
    v = discord.ui.LayoutView(timeout=None)
    v.add_item(discord.ui.Container(discord.ui.TextDisplay(text or "(empty)"), accent_colour=COLOR_MAIN))
    return v


class Digest:
    def __init__(self, channel: Optional["discord.abc.Messageable"], title: str = "Summary", interval: float = 3600.0):
        self.channel = channel
        self.title = title
        self.interval = float(interval)
        self.items: list[str] = []
        self._task: Optional[asyncio.Task] = None

    def add(self, line: str) -> None:
        self.items.append(str(line))

    async def flush(self) -> None:
        if not self.items:
            return
        body = "\n".join(f"- {x}" for x in self.items[:100])
        self.items = []
        if self.channel is None:
            return
        try:
            await self.channel.send(view=_card(f"**{self.title}**\n{body}"))
        except Exception:
            pass

    async def _loop(self) -> None:
        try:
            while True:
                await asyncio.sleep(self.interval)
                await self.flush()
        except asyncio.CancelledError:
            pass

    def start(self) -> "Digest":
        self._task = asyncio.create_task(self._loop())
        return self

    def stop(self) -> None:
        if self._task:
            self._task.cancel()
            self._task = None


if __name__ == "__main__":
    d = Digest(None, "T")
    d.add("a"); d.add("b")
    assert len(d.items) == 2
    print("digest: OK (items accumulated)")
