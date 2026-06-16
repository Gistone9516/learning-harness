"""
livechart - Periodically render and replace a chart image in a Discord message.

WHAT  : Renders a matplotlib chart as PNG and replaces the image in a single
        message in-place (live chart updates).
DEPS  : discord.py>=2.6, matplotlib (graceful fallback if missing)
PERMS : Send Messages, Attach Files
USAGE : lc = LiveChart(CHANNEL, "Price"); await lc.start(); lc.push(value); ... ; await lc.finalize()
        Pass render_fn(ax, data) for a custom chart; default is a line chart.
SAFETY: Coalescing default is 2 s per update (image re-upload is expensive). No secrets printed.
DEMO  : python harness/live/livechart.py  (verifies PNG render if matplotlib present; use demo(channel) for live)
"""

import os
import sys
import io
import asyncio
import collections
from typing import Callable, Deque, List, Optional, Any

try:
    import discord
except ImportError:
    print("[dependency] pip install -U discord.py(>=2.6) required.")
    sys.exit(1)

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    HAVE_MPL = True
except Exception:
    HAVE_MPL = False


class LiveChart:
    """Maintains a rolling data buffer and periodically uploads an updated chart PNG."""

    def __init__(
        self,
        channel: "discord.abc.Messageable",
        title: str = "",
        maxlen: int = 120,
        interval: float = 2.0,
        render_fn: Optional[Callable[["plt.Axes", List[float]], None]] = None,
    ) -> None:
        self.channel = channel
        self.title = title
        self.interval = max(1.0, float(interval))
        self.data: Deque[float] = collections.deque(maxlen=maxlen)
        self.render_fn = render_fn
        self._msg: Optional["discord.Message"] = None
        self._dirty: bool = False
        self._task: Optional[asyncio.Task] = None

    def push(self, value: float) -> None:
        """Append a data point and mark the chart as needing a redraw."""
        self.data.append(value)
        self._dirty = True

    def _png(self) -> Optional[io.BytesIO]:
        """Render the current data buffer to a PNG byte stream."""
        if not HAVE_MPL:
            return None
        fig = plt.figure(figsize=(6, 3))
        ax = fig.add_subplot(111)
        if self.render_fn:
            self.render_fn(ax, list(self.data))
        else:
            ax.plot(list(self.data))
            ax.set_title(self.title)
        buf = io.BytesIO()
        fig.tight_layout()
        fig.savefig(buf, format="png")
        plt.close(fig)
        buf.seek(0)
        return buf

    async def start(self) -> "LiveChart":
        """Send the initial chart message and start the background update loop."""
        if not HAVE_MPL:
            self._msg = await self.channel.send(
                "livechart: matplotlib not installed (pip install matplotlib)"
            )
            return self
        self._msg = await self.channel.send(file=discord.File(self._png(), "chart.png"))
        self._task = asyncio.create_task(self._loop())
        return self

    async def _loop(self) -> None:
        """Background task: re-upload the chart whenever new data has arrived."""
        try:
            while True:
                await asyncio.sleep(self.interval)
                if self._dirty and self._msg is not None and HAVE_MPL:
                    self._dirty = False
                    try:
                        await self._msg.edit(
                            attachments=[discord.File(self._png(), "chart.png")]
                        )
                    except Exception:
                        pass
        except asyncio.CancelledError:
            pass

    async def finalize(self) -> None:
        """Cancel the update loop and clean up."""
        if self._task:
            self._task.cancel()
            self._task = None


async def demo(channel: "discord.abc.Messageable", n: int = 40) -> None:
    """Push simulated price data to a LiveChart and let it update live."""
    import random
    lc = LiveChart(channel, "Price (simulated)")
    await lc.start()
    p = 100.0
    for _ in range(n):
        p = max(1.0, p + random.uniform(-2, 2))
        lc.push(p)
        await asyncio.sleep(0.3)
    await lc.finalize()


def _offline_check() -> None:
    """Verify the PNG render path without a real Discord connection."""
    lc = LiveChart(None, "T")
    for i in range(10):
        lc.push(i)
    if HAVE_MPL:
        buf = lc._png()
        assert buf and buf.getbuffer().nbytes > 0
        print("livechart: matplotlib PNG render OK")
    else:
        print("livechart: matplotlib not installed, structure-only check (install it for PNG render)")


if __name__ == "__main__":
    _offline_check()
    print("Live mode: call await demo(channel) from your client on_ready handler")
