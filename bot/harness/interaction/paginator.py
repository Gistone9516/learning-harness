"""
paginator - button pagination.

WHAT : Page through a list of text pages with Prev/Next buttons in one message.
DEPS : discord.py>=2.6
PERMS: Send Messages
USAGE: await send_paginator(CHANNEL, ALLOWED_USER_ID, ["page 1 text", "page 2", "page 3"])
SAFETY: Only ALLOWED_USER_ID's clicks work.
DEMO : python harness/interaction/paginator.py   (offline render check)
"""

from typing import List, Optional

import discord

COLOR_MAIN = 0x5865F2


class Paginator(discord.ui.LayoutView):
    def __init__(self, user_id: int, pages: List[str], timeout: float = 600):
        super().__init__(timeout=timeout)
        self.user_id = user_id
        self.pages = list(pages) or ["(empty)"]
        self.idx = 0
        self._sent: Optional[discord.Message] = None
        self.prev = discord.ui.Button(label="Prev", style=discord.ButtonStyle.secondary)
        self.nxt = discord.ui.Button(label="Next", style=discord.ButtonStyle.primary)
        self.prev.callback = self._go(-1)
        self.nxt.callback = self._go(1)
        self._build()

    def _build(self, expired: bool = False):
        self.clear_items()
        self.prev.disabled = expired or self.idx <= 0
        self.nxt.disabled = expired or self.idx >= len(self.pages) - 1
        body = f"{self.pages[self.idx]}\n\n`{self.idx + 1}/{len(self.pages)}`"
        if expired:
            body += "  (timed out)"
        self.add_item(discord.ui.Container(
            discord.ui.TextDisplay(body),
            discord.ui.ActionRow(self.prev, self.nxt),
            accent_colour=COLOR_MAIN,
        ))

    def _go(self, delta: int):
        async def cb(interaction: discord.Interaction):
            if interaction.user.id != self.user_id:
                await interaction.response.send_message("Not allowed.", ephemeral=True)
                return
            self.idx = max(0, min(len(self.pages) - 1, self.idx + delta))
            self._build()
            try:
                await interaction.response.edit_message(view=self)
            except Exception:
                pass
        return cb

    async def on_timeout(self):
        self._build(expired=True)
        if self._sent is not None:
            try:
                await self._sent.edit(view=self)
            except Exception:
                pass


async def send_paginator(channel: "discord.abc.Messageable", user_id: int,
                         pages: List[str], timeout: float = 600) -> Paginator:
    view = Paginator(user_id, pages, timeout)
    view._sent = await channel.send(view=view)
    return view


if __name__ == "__main__":
    assert Paginator(1, ["a", "b", "c"]).to_components()
    print("paginator: offline render OK")
