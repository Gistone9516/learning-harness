"""
selects - select menus (string / user / role / channel / mentionable).

WHAT : Drop-downs to pick options / users / roles / channels / mentionables; returns the choice.
DEPS : discord.py>=2.6
PERMS: Send Messages
USAGE: val  = await pick_string(CHANNEL, ALLOWED_USER_ID, "Pick one", ["A","B","C"])
       user = await pick_user(CHANNEL, ALLOWED_USER_ID, "Pick a user")   # role/channel/mentionable likewise
SAFETY: Only ALLOWED_USER_ID's selection counts.
DEMO : python harness/interaction/selects.py   (offline render check)
"""

import asyncio
from typing import Optional, List

import discord

COLOR_MAIN = 0x5865F2


def _card(text: str) -> discord.ui.LayoutView:
    v = discord.ui.LayoutView(timeout=None)
    v.add_item(discord.ui.Container(discord.ui.TextDisplay(text), accent_colour=COLOR_MAIN))
    return v


class _SelectView(discord.ui.LayoutView):
    def __init__(self, user_id: int, question: str, select, timeout: float = 300):
        super().__init__(timeout=timeout)
        self.user_id = user_id
        self.future = asyncio.get_running_loop().create_future()
        self._sent: Optional[discord.Message] = None
        select.callback = self._cb(select)
        self.add_item(discord.ui.Container(
            discord.ui.TextDisplay(f"**{question}**"),
            discord.ui.ActionRow(select),
            accent_colour=COLOR_MAIN,
        ))

    def _cb(self, select):
        async def cb(interaction: discord.Interaction):
            if interaction.user.id != self.user_id:
                await interaction.response.send_message("Not allowed.", ephemeral=True)
                return
            vals = list(select.values)
            if not self.future.done():
                self.future.set_result(vals)
            try:
                await interaction.response.edit_message(view=_card("Selected."))
            except Exception:
                pass
            self.stop()
        return cb

    async def on_timeout(self):
        if not self.future.done():
            self.future.set_result([])
        if self._sent is not None:
            try:
                await self._sent.edit(view=_card("(timed out)"))
            except Exception:
                pass


async def _run(channel, user_id, question, select, timeout, single):
    view = _SelectView(user_id, question, select, timeout)
    view._sent = await channel.send(view=view)
    try:
        vals = await asyncio.wait_for(view.future, timeout=timeout)
    except asyncio.TimeoutError:
        return None
    if single:
        return vals[0] if vals else None
    return vals


async def pick_string(channel: "discord.abc.Messageable", user_id: int, question: str,
                      options: List[str], single: bool = True, timeout: float = 300):
    opts = [discord.SelectOption(label=str(o)[:100]) for o in list(options)[:25]]
    sel = discord.ui.Select(placeholder="Select", options=opts,
                            min_values=1, max_values=1 if single else len(opts))
    return await _run(channel, user_id, question, sel, timeout, single)


async def pick_user(channel: "discord.abc.Messageable", user_id: int, question: str, timeout: float = 300):
    return await _run(channel, user_id, question, discord.ui.UserSelect(placeholder="User"), timeout, True)


async def pick_role(channel: "discord.abc.Messageable", user_id: int, question: str, timeout: float = 300):
    return await _run(channel, user_id, question, discord.ui.RoleSelect(placeholder="Role"), timeout, True)


async def pick_channel(channel: "discord.abc.Messageable", user_id: int, question: str, timeout: float = 300):
    return await _run(channel, user_id, question, discord.ui.ChannelSelect(placeholder="Channel"), timeout, True)


async def pick_mentionable(channel: "discord.abc.Messageable", user_id: int, question: str, timeout: float = 300):
    return await _run(channel, user_id, question, discord.ui.MentionableSelect(placeholder="Target"), timeout, True)


if __name__ == "__main__":
    async def _check():
        sel = discord.ui.Select(options=[discord.SelectOption(label="A")])
        assert _SelectView(1, "q", sel).to_components()
        for S in (discord.ui.UserSelect, discord.ui.RoleSelect,
                  discord.ui.ChannelSelect, discord.ui.MentionableSelect):
            assert _SelectView(1, "q", S()).to_components()
    asyncio.run(_check())
    print("selects: 5 types offline render OK")
