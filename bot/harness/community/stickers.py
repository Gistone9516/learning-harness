"""
stickers - Send a guild sticker in a channel.  [non-mainstream]

WHAT : Looks up a guild sticker by name and sends it as a message.
DEPS : discord.py>=2.6
PERMS: Send Messages; (admin) Manage Expressions
USAGE: await send_sticker(CHANNEL, guild, "sticker-name")
SAFETY: -
DEMO  : python harness/community/stickers.py  (offline info)
"""

import discord
from typing import Optional


async def send_sticker(
    channel: "discord.abc.Messageable",
    guild: "discord.Guild",
    sticker_name: str,
) -> bool:
    """Send a guild sticker by name to the given channel.

    Returns True if the sticker was found and sent, False otherwise.
    """
    st: Optional[discord.GuildSticker] = discord.utils.get(
        guild.stickers, name=sticker_name
    )
    if st is None:
        return False
    await channel.send(stickers=[st])
    return True


if __name__ == "__main__":
    print("stickers: await send_sticker(CHANNEL, guild, 'sticker-name')")
