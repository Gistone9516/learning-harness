"""
confirm - button approval -> bool.

WHAT : Show Yes/No buttons and return the allowed user's choice as a bool (default on timeout).
DEPS : discord.py>=2.6
PERMS: Send Messages
USAGE: ok = await confirm(CHANNEL, ALLOWED_USER_ID, "Deploy now?")   # -> True/False
SAFETY: Only ALLOWED_USER_ID's click counts. Use before hard-to-reverse actions.
DEMO : python harness/interaction/confirm.py   (offline render check)
"""

import asyncio
from typing import Optional

import discord

COLOR_MAIN = 0x5865F2


def _done_card(text: str) -> discord.ui.LayoutView:
    v = discord.ui.LayoutView(timeout=None)
    v.add_item(discord.ui.Container(discord.ui.TextDisplay(text), accent_colour=COLOR_MAIN))
    return v


class _ConfirmView(discord.ui.LayoutView):
    def __init__(self, user_id: int, question: str, yes: str = "Yes", no: str = "No",
                 timeout: float = 300, default: bool = False):
        super().__init__(timeout=timeout)
        self.user_id = user_id
        self.default = default
        self.future = asyncio.get_running_loop().create_future()
        self._sent: Optional[discord.Message] = None   # set by confirm() after send
        by = discord.ui.Button(label=yes, style=discord.ButtonStyle.success)
        bn = discord.ui.Button(label=no, style=discord.ButtonStyle.danger)
        by.callback = self._cb(True)
        bn.callback = self._cb(False)
        self.add_item(discord.ui.Container(
            discord.ui.TextDisplay(f"**Confirm**\n\n{question}"),
            discord.ui.ActionRow(by, bn),
            accent_colour=COLOR_MAIN,
        ))

    def _cb(self, value: bool):
        async def cb(interaction: discord.Interaction):
            if interaction.user.id != self.user_id:
                await interaction.response.send_message("Not allowed.", ephemeral=True)
                return
            if not self.future.done():
                self.future.set_result(value)
            try:
                await interaction.response.edit_message(view=_done_card(f"Selected: **{'Yes' if value else 'No'}**"))
            except Exception:
                pass
            self.stop()
        return cb

    async def on_timeout(self):
        # Close the future with the default and clear the stale buttons.
        if not self.future.done():
            self.future.set_result(self.default)
        if self._sent is not None:
            try:
                await self._sent.edit(view=_done_card("(timed out)"))
            except Exception:
                pass


async def confirm(channel: "discord.abc.Messageable", user_id: int, question: str,
                  default: bool = False, timeout: float = 300) -> bool:
    view = _ConfirmView(user_id, question, timeout=timeout, default=default)
    view._sent = await channel.send(view=view)
    try:
        return await asyncio.wait_for(view.future, timeout=timeout)
    except asyncio.TimeoutError:
        return default


if __name__ == "__main__":
    async def _check():
        v = _ConfirmView(1, "question?")
        assert v.to_components()
    asyncio.run(_check())
    print("confirm: offline render OK")
