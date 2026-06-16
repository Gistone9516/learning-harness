"""
livecard - Real-time in-place update of a single card's numbers/fields (coalescing-based).

WHAT : Posts one message and edits it each time new data arrives, so the card's values
       update live without spawning new messages.
DEPS : discord.py>=2.6
PERMS: Send Messages, Send Messages in Threads (only needed when posting into a thread)
USAGE: card = LiveCard(CHANNEL, title="..."); await card.start(); card.set(key=value); await card.finalize()
       CHANNEL = the channel or thread to post in.
       set() is safe to call at any frequency; the loop edits only once per interval.
       For a real data source (stocks, etc.), replace the random-walk in the demo with a fetch call.
SAFETY: Live updates are coalesced so the card is edited at most once per second
        (Discord rate limit is roughly 5 edits per 5 seconds per channel).
        Never print secret values.

Coalescing is the key mechanism. set() just stores the latest value; the background loop
fires the actual edit once per interval (default 1 second). Even if data arrives dozens of
times per second, the card is updated only once per second -- safe against rate limits and
still fast enough to appear live. LiveTable, ProgressBar, and LogTail use the same pattern.

DEMO: python harness/live/livecard.py  (uses .env bot to run a simulated ticker for 30 s in #livecard-demo)
"""

import os
import sys
import re
import asyncio
import random
import time
from typing import Optional, Union, TYPE_CHECKING

if TYPE_CHECKING:
    import discord as _discord_types

try:
    import discord
except ImportError:
    print("[dependency] pip install -U discord.py (>=2.6) required.")
    sys.exit(1)

COLOR_MAIN = 0x5865F2   # in-progress
COLOR_DONE = 0x57F287   # finished (green)
COLOR_WARN = 0xF1C40F   # warning / error


def _card(text: str, color: int = COLOR_MAIN) -> "discord.ui.LayoutView":
    """Static V2 card: Container(accent) + TextDisplay."""
    view = discord.ui.LayoutView(timeout=None)
    view.add_item(discord.ui.Container(discord.ui.TextDisplay(text or "(empty card)"), accent_colour=color))
    return view


class LiveCard:
    """In-place live card. Feed values via set(); the loop edits the message once per interval."""

    def __init__(
        self,
        channel: "Optional[_discord_types.abc.Messageable]",
        title: str = "",
        color: int = COLOR_MAIN,
        interval: float = 1.0,
        show_elapsed: bool = True,
    ) -> None:
        self.channel = channel
        self.title = title
        self.color = color
        self.interval = max(0.5, float(interval))   # lower bound to stay within rate limits
        self.show_elapsed = show_elapsed
        self.fields: dict = {}   # label -> value (insertion order preserved)
        self.text: Optional[str] = None    # freeform body; when set, used instead of fields
        self.note: Optional[str] = None    # supplementary text shown at the bottom
        self._msg = None
        self._dirty: bool = False
        self._task: Optional[asyncio.Task] = None
        self._start_ts: Optional[float] = None

    # ---- rendering ----
    def _render(self, color: Optional[int] = None) -> "discord.ui.LayoutView":
        lines = []
        if self.title:
            lines.append(f"**{self.title}**")
        if self.text is not None:
            lines.append(self.text)
        else:
            for k, v in self.fields.items():
                lines.append(f"`{k}`  {v}")
        tail = []
        if self.show_elapsed and self._start_ts is not None:
            el = int(time.time() - self._start_ts)
            tail.append(f"elapsed {el // 60:02d}:{el % 60:02d}")
        if self.note:
            tail.append(self.note)
        if tail:
            lines.append("\n" + "  |  ".join(tail))
        return _card("\n".join(lines), color or self.color)

    # ---- lifecycle ----
    async def start(self, **fields) -> "LiveCard":
        """Post the card to the channel and start the update loop."""
        if fields:
            self.fields.update(fields)
        self._start_ts = time.time()
        self._msg = await self.channel.send(view=self._render())
        self._task = asyncio.create_task(self._loop())
        return self

    def set(self, **fields) -> None:
        """Update (merge) field values. May be called at any frequency; actual edits happen once per interval."""
        if fields:
            self.fields.update(fields)
            self.text = None
            self._dirty = True

    def set_text(self, text: str) -> None:
        """Update the card with a freeform body string instead of individual fields."""
        self.text = text
        self._dirty = True

    def set_note(self, note: str) -> None:
        """Set the supplementary text shown at the bottom of the card."""
        self.note = note
        self._dirty = True

    async def _loop(self) -> None:
        try:
            while True:
                await asyncio.sleep(self.interval)
                if self._dirty and self._msg is not None:
                    self._dirty = False
                    try:
                        await self._msg.edit(view=self._render())
                    except Exception:
                        pass   # transient rate limit or network error -- retry next cycle
        except asyncio.CancelledError:
            pass

    async def finalize(self, note: Optional[str] = None, color: Optional[int] = None, **fields) -> None:
        """Stop the loop and render the final state once more (defaults to green = done)."""
        if fields:
            self.fields.update(fields)
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


# ===================== simulated ticker demo =====================
def _load_env(path: str) -> dict:
    vals: dict = {}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                v = v.strip()
                if not (v.startswith('"') or v.startswith("'")):
                    v = re.sub(r"\s+#.*$", "", v).strip()
                vals[k.strip()] = v.strip('"').strip("'")
    return vals


async def stock_demo(channel: "discord.abc.Messageable", seconds: int = 30) -> None:
    """Simulated ticker demo on a single live card. Replace the random-walk with real fetch calls for production."""
    tickers = {"AAPL": 192.0, "TSLA": 245.0, "NVDA": 1180.0, "Samsung": 78000.0}
    card = LiveCard(channel, title="Live Ticker (simulated demo)", interval=1.0)
    await card.start()
    ticks = 0
    end = time.time() + seconds
    while time.time() < end:
        fields = {}
        for t in tickers:
            old = tickers[t]
            new = max(0.01, old + old * random.uniform(-0.004, 0.004))   # random walk (replace with real data)
            tickers[t] = new
            arrow = "+" if new >= old else "-"
            pct = (new - old) / old * 100 if old else 0.0
            fields[t] = f"{new:,.2f} {arrow}{abs(pct):.2f}%"
        ticks += 1
        card.set(**fields, ticks=str(ticks))
        await asyncio.sleep(0.2)   # data arrives every 0.2 s but the card updates only once per second
    await card.finalize(note=f"demo finished -- {ticks} ticks")


def _run_demo() -> None:
    base = os.path.dirname(os.path.abspath(__file__))
    # two levels up from harness/live/ is the project root (where .env lives)
    root = os.path.dirname(os.path.dirname(base))
    env = _load_env(os.path.join(root, ".env"))
    token = env.get("DISCORD_BOT_TOKEN")
    guild_id = int(env.get("DISCORD_GUILD_ID", "0") or 0)
    if not token:
        print("The demo requires DISCORD_BOT_TOKEN in .env")
        print("(The LiveCard class itself can be imported and used without a token.)")
        return
    print("Note: a bot token supports only one running instance at a time. Stop bridge.py first if it is running.")

    intents = discord.Intents.default()
    client = discord.Client(intents=intents)

    @client.event
    async def on_ready() -> None:
        print("[livecard] connected:", client.user)
        guild = client.get_guild(guild_id)
        ch = None
        if guild is not None:
            ch = discord.utils.get(guild.text_channels, name="livecard-demo")
            if ch is None:
                try:
                    ch = await guild.create_text_channel("livecard-demo")
                except Exception as e:
                    print("[livecard] failed to create channel:", e)
        if ch is None:
            print("[livecard] could not find a channel to post in.")
            await client.close()
            return
        try:
            await stock_demo(ch)
        finally:
            await client.close()

    client.run(token)


def _offline_check() -> None:
    c = LiveCard(None, title="t")
    c.set(a="1", b="2")
    assert c._render().to_components()
    print("livecard: offline render OK")


if __name__ == "__main__":
    _offline_check()
    if os.environ.get("HARNESS_LIVE") == "1":
        _run_demo()   # posts to real Discord (requires bot connection); one instance per token
    else:
        print("Live demo: HARNESS_LIVE=1 python harness/live/livecard.py")
