"""
buttons - callback, link, and emoji button utilities.

WHAT : Build callback buttons, link (URL) buttons, and emoji buttons, then
       arrange them in a single card view.
DEPS : discord.py>=2.6
PERMS: Send Messages
USAGE: view = button_card("Choose one", [("A", cb_a), ("B", cb_b)]); await CHANNEL.send(view=view)
       Link button: link_button("Docs", "https://...")
SAFETY: Inside each callback, verify interaction.user.id == ALLOWED_USER_ID.
DEMO  : python harness/interaction/buttons.py  (offline render check)
"""

import discord
from typing import Callable, Optional, Sequence, Tuple, Union

COLOR_MAIN = 0x5865F2


def make_button(
    label: str,
    callback: Optional[Callable] = None,
    style: discord.ButtonStyle = discord.ButtonStyle.primary,
    emoji: Optional[str] = None,
) -> discord.ui.Button:
    b = discord.ui.Button(label=label, style=style, emoji=emoji)
    if callback is not None:
        b.callback = callback   # async def cb(interaction): ...  (must check allowed user)
    return b


def link_button(
    label: str,
    url: str,
    emoji: Optional[str] = None,
) -> discord.ui.Button:
    return discord.ui.Button(label=label, url=url, emoji=emoji)


def button_card(
    text: str,
    items: Sequence[Union[discord.ui.Button, Tuple[str, Optional[Callable]]]],
    color: int = COLOR_MAIN,
    timeout: int = 600,
) -> discord.ui.LayoutView:
    """items = [(label, callback), ...] or [discord.ui.Button, ...]. Max 5 per row."""
    buttons = []
    for it in items[:5]:
        buttons.append(it if isinstance(it, discord.ui.Button) else make_button(it[0], it[1]))
    view = discord.ui.LayoutView(timeout=timeout)
    view.add_item(discord.ui.Container(
        discord.ui.TextDisplay(text),
        discord.ui.ActionRow(*buttons),
        accent_colour=color,
    ))
    return view


if __name__ == "__main__":
    v = button_card("Choose one", [("A", None), ("B", None), link_button("Docs", "https://example.com")])
    assert v.to_components()
    print("buttons: offline render OK")
