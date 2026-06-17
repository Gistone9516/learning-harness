"""
livetable - Multi-row table that updates in place in real time.

WHAT : Feed rows via set_row(); a single card (code-block-aligned table) refreshes
       every `interval` seconds (portfolio tracker, leaderboard, monitoring).
DEPS : discord.py>=2.6
PERMS: Send Messages
USAGE: t = LiveTable(CHANNEL, "Portfolio", columns=["Symbol","Price","Return"]); await t.start()
       t.set_row("AAPL", Symbol="AAPL", Price="192.3", Return="+0.8%"); ... ; await t.finalize()
SAFETY: Live-update coalescing (at most once per second). Never print secret values.
DEMO: python harness/live/livetable.py  (offline render check; set HARNESS_LIVE=1 to post live)
"""

import os
import sys
import re
import asyncio
import random
import time
from typing import Optional, Dict, Any

try:
    import discord
except ImportError:
    print("[dependency] pip install -U discord.py (>=2.6) required.")
    sys.exit(1)

COLOR_MAIN = 0x5865F2
COLOR_DONE = 0x57F287


def _card(text: str, color: int = COLOR_MAIN) -> discord.ui.LayoutView:
    v = discord.ui.LayoutView(timeout=None)
    v.add_item(discord.ui.Container(discord.ui.TextDisplay(text or "(empty table)"), accent_colour=color))
    return v


class LiveTable:
    """A table card that updates row-by-row. Feed data via set_row(key, **cols); the loop edits the message every `interval` seconds."""

    def __init__(
        self,
        channel: "Optional[discord.abc.Messageable]",
        title: str = "",
        columns: "Optional[list]" = None,
        color: int = COLOR_MAIN,
        interval: float = 1.0,
    ) -> None:
        self.channel = channel
        self.title = title
        self.columns = list(columns or [])
        self.color = color
        self.interval = max(0.5, float(interval))
        self.rows: Dict[str, Dict[str, Any]] = {}  # key -> {col: value}, insertion order preserved
        self._msg: "Optional[discord.Message]" = None
        self._dirty = False
        self._task: "Optional[asyncio.Task]" = None

    def set_row(self, key: str, **cols: Any) -> None:
        self.rows.setdefault(key, {}).update(cols)
        self._dirty = True

    def remove_row(self, key: str) -> None:
        if self.rows.pop(key, None) is not None:
            self._dirty = True

    def _render(self, color: "Optional[int]" = None) -> discord.ui.LayoutView:
        cols = self.columns or sorted({c for r in self.rows.values() for c in r})
        data_rows = [[r.get(c, "") for c in cols] for r in self.rows.values()]
        try:
            # Single source of truth for width-aware (CJK = 2) monospace tables.
            from text_format import render_table
            table = render_table(cols, data_rows) if cols else "```\n(empty table)\n```"
        except Exception:
            # Offline demo fallback (text_format may be off sys.path): char-width align.
            widths = {c: len(str(c)) for c in cols}
            for r in self.rows.values():
                for c in cols:
                    widths[c] = max(widths[c], len(str(r.get(c, ""))))

            def fmt(vals):
                return "  ".join(str(v).ljust(widths[c]) for c, v in zip(cols, vals))

            header = fmt(cols)
            body = "\n".join(fmt([r.get(c, "") for c in cols]) for r in self.rows.values()) or "(no rows)"
            table = f"```\n{header}\n{'-' * len(header)}\n{body}\n```"
        title = f"**{self.title}**\n" if self.title else ""
        return _card(title + table, color or self.color)

    async def start(self) -> "LiveTable":
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

    async def finalize(self, color: "Optional[int]" = None) -> None:
        if self._task:
            self._task.cancel()
            self._task = None
        if self._msg is not None:
            try:
                await self._msg.edit(view=self._render(color or COLOR_DONE))
            except Exception:
                pass


# ---- demo ----
def _load_env(path: str) -> Dict[str, str]:
    vals: Dict[str, str] = {}
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


async def portfolio_demo(channel: "discord.abc.Messageable", seconds: float = 20) -> None:
    prices = {"AAPL": 192.0, "TSLA": 245.0, "NVDA": 1180.0}
    t = LiveTable(channel, "Portfolio (simulated)", columns=["Symbol", "Price", "Change"])
    await t.start()
    end = time.time() + seconds
    while time.time() < end:
        for sym in prices:
            old = prices[sym]
            new = max(0.01, old + old * random.uniform(-0.004, 0.004))
            prices[sym] = new
            arrow = "^" if new >= old else "v"
            t.set_row(sym, Symbol=sym, Price=f"{new:,.2f}", Change=f"{arrow}{abs((new-old)/old*100):.2f}%")
        await asyncio.sleep(0.3)
    await t.finalize()


def _run_live() -> None:
    base = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(os.path.dirname(base))
    env = _load_env(os.path.join(root, ".env"))
    token = env.get("DISCORD_BOT_TOKEN")
    guild_id = int(env.get("DISCORD_GUILD_ID", "0") or 0)
    if not token:
        print("Live demo requires DISCORD_BOT_TOKEN in .env")
        return
    print("Note: only one bot instance can hold the token at a time. Stop bridge.py if it is running.")
    intents = discord.Intents.default()
    client = discord.Client(intents=intents)

    @client.event
    async def on_ready():
        guild = client.get_guild(guild_id)
        ch = discord.utils.get(guild.text_channels, name="livecard-demo") if guild else None
        if ch is None and guild is not None:
            try:
                ch = await guild.create_text_channel("livecard-demo")
            except Exception as e:
                print("Failed to create channel:", e)
        if ch is None:
            await client.close()
            return
        try:
            await portfolio_demo(ch)
        finally:
            await client.close()

    client.run(token)


def _offline_check() -> None:
    t = LiveTable(None, "T", columns=["a", "b"])
    t.set_row("x", a="1", b="22")
    t.set_row("y", a="333", b="4")
    assert t._render().to_components()
    print("livetable: offline render OK")


if __name__ == "__main__":
    _offline_check()
    if os.environ.get("HARNESS_LIVE") == "1":
        _run_live()
    else:
        print("Live demo: set HARNESS_LIVE=1 and run python harness/live/livetable.py")
