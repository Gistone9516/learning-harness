"""
progressbar - in-place progress bar card with live updates.

WHAT : Displays a long-running task's progress as a bar (e.g. [######....] 60%)
       inside a single card that is edited in real time.
DEPS : discord.py>=2.6
PERMS: Send Messages
USAGE: pb = ProgressBar(channel, "Build"); await pb.start()
       pb.update(3, 10, "step 3"); ...; await pb.finalize("Done")
SAFETY: Live edits are coalesced (at most once per second by default).
DEMO  : python harness/live/progressbar.py  (offline render check; use demo(channel) coroutine for live)
"""

import os
import sys
import asyncio

try:
    import discord
except ImportError:
    print("[dependency] pip install -U discord.py(>=2.6) required.")
    sys.exit(1)

COLOR_MAIN = 0x5865F2
COLOR_DONE = 0x57F287


def _card(text: str, color: int = COLOR_MAIN) -> "discord.ui.LayoutView":
    v = discord.ui.LayoutView(timeout=None)
    v.add_item(discord.ui.Container(discord.ui.TextDisplay(text or "..."), accent_colour=color))
    return v


class ProgressBar:
    def __init__(
        self,
        channel: "discord.abc.Messageable",
        title: str = "",
        color: int = COLOR_MAIN,
        interval: float = 1.0,
        width: int = 20,
    ) -> None:
        self.channel = channel
        self.title = title
        self.color = color
        self.interval = max(0.5, float(interval))
        self.width = width
        self.current = 0
        self.total = 1
        self.note = ""
        self._msg = None
        self._dirty = False
        self._task = None

    def update(self, current: int, total: int = None, note: str = "") -> None:
        self.current = current
        if total is not None:
            self.total = max(1, total)
        self.note = note
        self._dirty = True

    def _render(self, color: int = None) -> "discord.ui.LayoutView":
        frac = max(0.0, min(1.0, self.current / self.total))
        filled = int(round(frac * self.width))
        bar = "█" * filled + "░" * (self.width - filled)
        title = f"**{self.title}**\n" if self.title else ""
        line = f"`{bar}` {frac * 100:4.1f}%  ({self.current}/{self.total})"
        if self.note:
            line += f"\n{self.note}"
        return _card(title + line, color or self.color)

    async def start(self) -> "ProgressBar":
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

    async def finalize(self, note: str = None, color: int = None) -> None:
        if note is not None:
            self.note = note
        if self._task:
            self._task.cancel()
            self._task = None
        if self._msg is not None:
            try:
                await self._msg.edit(view=self._render(color or COLOR_DONE))
            except Exception:
                pass


async def demo(channel: "discord.abc.Messageable", steps: int = 10) -> None:
    pb = ProgressBar(channel, "Task progress (simulated)")
    await pb.start()
    for i in range(steps + 1):
        pb.update(i, steps, f"{i}/{steps} steps")
        await asyncio.sleep(0.4)
    await pb.finalize("Done")


def _offline_check() -> None:
    pb = ProgressBar(None, "T")
    pb.update(3, 10, "x")
    assert pb._render().to_components()
    print("progressbar: offline render OK")


if __name__ == "__main__":
    _offline_check()
    print("Live: call `await demo(channel)` inside your client on_ready handler")
