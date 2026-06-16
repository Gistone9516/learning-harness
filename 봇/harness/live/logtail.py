"""
logtail - Rolling display of the last N lines of log output.

WHAT : Push lines in; the latest N lines are shown as a code block in a single rolling message (remote log monitor).
DEPS : discord.py>=2.6
PERMS: Send Messages
USAGE: lt = LogTail(CHANNEL, "Build log", lines=20); await lt.start()
       lt.push("..."); ... ; await lt.finalize()      # file tracking: await lt.tail_file(PATH)
SAFETY: Live updates are coalesced (at most once per second). Mask secrets before calling push().
DEMO  : python harness/live/logtail.py  (offline check; use demo(channel) coroutine for live mode)
"""

import os
import sys
import asyncio
import collections
from typing import Optional

try:
    import discord
except ImportError:
    print("[dependency] pip install -U discord.py(>=2.6) required.")
    sys.exit(1)

COLOR_MAIN = 0x5865F2
COLOR_DONE = 0x57F287


def _card(text: str, color: int = COLOR_MAIN) -> discord.ui.LayoutView:
    v = discord.ui.LayoutView(timeout=None)
    v.add_item(discord.ui.Container(discord.ui.TextDisplay(text or "..."), accent_colour=color))
    return v


class LogTail:
    def __init__(
        self,
        channel: "Optional[discord.abc.Messageable]",
        title: str = "",
        lines: int = 20,
        color: int = COLOR_MAIN,
        interval: float = 1.0,
    ) -> None:
        self.channel = channel
        self.title = title
        self.color = color
        self.interval = max(0.5, float(interval))
        self.buf = collections.deque(maxlen=max(1, lines))
        self._msg: Optional[discord.Message] = None
        self._dirty = False
        self._task: Optional[asyncio.Task] = None

    def push(self, *lines: object) -> None:
        for ln in lines:
            for sub in (str(ln).splitlines() or [""]):
                self.buf.append(sub)
        self._dirty = True

    def _render(self, color: Optional[int] = None) -> discord.ui.LayoutView:
        title = f"**{self.title}**\n" if self.title else ""
        body = "\n".join(self.buf) or "(no log lines)"
        if len(body) > 1800:
            body = body[-1800:]
        return _card(title + f"```\n{body}\n```", color or self.color)

    async def start(self) -> "LogTail":
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

    async def finalize(self, color: Optional[int] = None) -> None:
        if self._task:
            self._task.cancel()
            self._task = None
        if self._msg is not None:
            try:
                await self._msg.edit(view=self._render(color or COLOR_DONE))
            except Exception:
                pass

    async def tail_file(self, path: str, poll: float = 1.0) -> None:
        """Poll the end of a file and push new lines. Run this as a separate task."""
        pos = 0
        while True:
            try:
                if os.path.exists(path):
                    with open(path, encoding="utf-8", errors="replace") as f:
                        f.seek(pos)
                        new = f.read()
                        pos = f.tell()
                    if new:
                        self.push(*new.splitlines())
            except Exception:
                pass
            await asyncio.sleep(poll)


async def demo(channel: "discord.abc.Messageable", n: int = 30) -> None:
    lt = LogTail(channel, "Build log (mock)", lines=15)
    await lt.start()
    for i in range(n):
        lt.push(f"[{i:02d}] step running...")
        await asyncio.sleep(0.3)
    await lt.finalize()


def _offline_check() -> None:
    lt = LogTail(None, "T", lines=5)
    for i in range(8):
        lt.push(f"line {i}")
    assert lt._render().to_components() and len(lt.buf) == 5
    print("logtail: offline render OK (deque maxlen working)")


if __name__ == "__main__":
    _offline_check()
    print("live: call await demo(channel) or await LogTail(ch).tail_file(PATH) in on_ready")
