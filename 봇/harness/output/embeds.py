"""
embeds - Classic embed builder.

WHAT  : Builds Discord embeds (legacy format, alternative to V2 cards)
        with fields, author, footer, timestamp, and image support.
DEPS  : discord.py>=2.6
PERMS : Send Messages, Embed Links
USAGE : await CHANNEL.send(embed=build_embed("Title", "Body", fields=[("k", "v", True)]))
SAFETY: Cannot be mixed with V2 cards (LayoutView) in the same message.
        Never print secret values inside an embed.
DEMO  : python harness/output/embeds.py  (offline construction check)
"""

from __future__ import annotations

from typing import List, Optional, Tuple, Union

import discord


def build_embed(
    title: Optional[str] = None,
    description: Optional[str] = None,
    color: int = 0x5865F2,
    fields: Optional[List[Union[Tuple[str, str], Tuple[str, str, bool]]]] = None,
    footer: Optional[str] = None,
    image: Optional[str] = None,
    thumbnail: Optional[str] = None,
    url: Optional[str] = None,
) -> discord.Embed:
    """Build and return a discord.Embed with the given parameters.

    Args:
        title:       Embed title text.
        description: Embed body text.
        color:       Sidebar color as an integer (default Discord blurple).
        fields:      List of (name, value) or (name, value, inline) tuples.
        footer:      Footer text.
        image:       URL of a large image placed at the bottom.
        thumbnail:   URL of a small thumbnail in the top-right corner.
        url:         Hyperlink applied to the title.

    Returns:
        A configured discord.Embed instance ready to send.
    """
    e = discord.Embed(title=title, description=description, color=color, url=url)
    for f in (fields or []):
        name, value = f[0], f[1]
        inline = f[2] if len(f) > 2 else False
        e.add_field(name=name, value=value, inline=inline)
    if footer:
        e.set_footer(text=footer)
    if image:
        e.set_image(url=image)
    if thumbnail:
        e.set_thumbnail(url=thumbnail)
    return e


if __name__ == "__main__":
    # Offline construction check: verify title and field count survive a round-trip.
    e = build_embed("Title", "Body", fields=[("a", "1", True), ("b", "2", True)], footer="ft")
    assert e.to_dict()["title"] == "Title" and len(e.fields) == 2
    print("embeds: construction OK")
