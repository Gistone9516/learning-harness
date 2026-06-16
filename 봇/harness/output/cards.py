"""
cards - Components V2 card builder.

WHAT : Build cards using V2 LayoutView (Container / Section / Separator / MediaGallery / Thumbnail / TextDisplay).
DEPS : discord.py>=2.6
PERMS: Send Messages
USAGE: await CHANNEL.send(view=card("body")) / titled_card("title","body") / section_with_button / gallery
SAFETY: V2 messages cannot carry content/embed/poll in the same message (send as separate messages). Never print secrets.
DEMO: python harness/output/cards.py  (offline validation of view construction only)
"""

from typing import Optional
import discord

COLOR_MAIN = 0x5865F2
COLOR_WARN = 0xF1C40F
COLOR_DANGER = 0xED4245
COLOR_DONE = 0x57F287


def card(text: str, color: int = COLOR_MAIN) -> discord.ui.LayoutView:
    """Single-body card."""
    v = discord.ui.LayoutView(timeout=None)
    v.add_item(discord.ui.Container(discord.ui.TextDisplay(text or "(empty card)"), accent_colour=color))
    return v


def titled_card(title: str, body: str, color: int = COLOR_MAIN) -> discord.ui.LayoutView:
    """Card with a bold title followed by body text."""
    return card(f"**{title}**\n\n{body}", color)


def container(*texts: str, color: int = COLOR_MAIN, separator: bool = False) -> discord.ui.LayoutView:
    """Pack multiple TextDisplay items (with optional Separators between them) into one Container."""
    items = []
    for i, t in enumerate(texts):
        if separator and i:
            items.append(discord.ui.Separator())
        items.append(discord.ui.TextDisplay(str(t)))
    v = discord.ui.LayoutView(timeout=None)
    v.add_item(discord.ui.Container(*items, accent_colour=color))
    return v


def section_with_button(
    text: str,
    button: discord.ui.Button,
    color: int = COLOR_MAIN,
) -> discord.ui.LayoutView:
    """Section with an accessory button beside the text. button=discord.ui.Button(...)."""
    v = discord.ui.LayoutView(timeout=None)
    v.add_item(discord.ui.Container(
        discord.ui.Section(discord.ui.TextDisplay(text), accessory=button),
        accent_colour=color,
    ))
    return v


def gallery(*media: str, color: int = COLOR_MAIN) -> discord.ui.LayoutView:
    """Render images in a MediaGallery card. media = image URL or 'attachment://filename'."""
    items = [discord.MediaGalleryItem(media=m) for m in media]
    v = discord.ui.LayoutView(timeout=None)
    v.add_item(discord.ui.Container(discord.ui.MediaGallery(*items), accent_colour=color))
    return v


if __name__ == "__main__":
    btn = discord.ui.Button(label="ok")
    views = [
        card("hi"),
        titled_card("Title", "Body"),
        container("a", "b", separator=True),
        section_with_button("text with button", btn),
        gallery("https://example.com/a.png"),
    ]
    for v in views:
        assert v.to_components(), "view construction failed"
    print("cards: 5 view types constructed OK (offline validation)")
