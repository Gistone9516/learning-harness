"""
categories - Channel category organization.

WHAT : Create channel categories and move channels under them.
DEPS : discord.py>=2.6
PERMS: Manage Channels
USAGE: cat = await get_or_create_category(guild, "work"); await move_to(channel, cat)
SAFETY: -
DEMO  : python harness/community/categories.py  (prints usage hint)
"""

from __future__ import annotations

from typing import Optional

import discord


async def get_or_create_category(
    guild: discord.Guild,
    name: str,
) -> discord.CategoryChannel:
    """Return the named category, creating it if it does not exist."""
    cat: Optional[discord.CategoryChannel] = discord.utils.get(
        guild.categories, name=name
    )
    if cat is None:
        cat = await guild.create_category(name)
    return cat


async def move_to(
    channel: discord.abc.GuildChannel,
    category: discord.CategoryChannel,
) -> None:
    """Move *channel* under *category*."""
    await channel.edit(category=category)


if __name__ == "__main__":
    print("categories: get_or_create_category(guild, 'work') / move_to(channel, cat)")
