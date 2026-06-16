"""
emoji - Custom emoji lookup and management.  [non-core]

WHAT  : Find guild custom emojis for use in messages/reactions, and create new ones.
DEPS  : discord.py>=2.6
PERMS : (admin) Manage Expressions
USAGE : e = find_emoji(guild, "name"); await msg.add_reaction(e); await channel.send(str(e))
        new = await add_emoji(guild, "name", image_bytes)
SAFETY: Image must be 256 KB or smaller.
DEMO  : python harness/community/emoji.py  (prints usage hint)
"""

import discord
from typing import Optional


def find_emoji(guild: discord.Guild, name: str) -> Optional[discord.Emoji]:
    """Return the first guild emoji matching *name*, or None if not found."""
    return discord.utils.get(guild.emojis, name=name)


async def add_emoji(
    guild: discord.Guild,
    name: str,
    image_bytes: bytes,
    reason: Optional[str] = None,
) -> discord.Emoji:
    """Create a new custom emoji in *guild* and return the created Emoji object."""
    return await guild.create_custom_emoji(name=name, image=image_bytes, reason=reason)


if __name__ == "__main__":
    print("emoji: find_emoji(guild, 'name') / add_emoji(guild, 'name', image_bytes)")
