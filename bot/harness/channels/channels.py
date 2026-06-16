"""
channels - Automatic text channel creation and editing.

WHAT : Looks up a channel by name or creates one, and edits topic/slowmode/etc.
DEPS : discord.py>=2.6
PERMS: Manage Channels
USAGE: ch = await get_or_create(CLIENT, GUILD_ID, "agent-log")
       await edit_channel(ch, topic="log", slowmode_delay=5)
SAFETY: -
DEMO  : python harness/channels/channels.py  (prints usage example)
"""

from typing import Optional
import discord


async def get_or_create(
    client: discord.Client,
    guild_id: int,
    name: str,
    category: Optional[discord.CategoryChannel] = None,
    topic: Optional[str] = None,
) -> Optional[discord.TextChannel]:
    guild = client.get_guild(guild_id)
    if guild is None:
        return None
    ch = discord.utils.get(guild.text_channels, name=name)
    if ch is None:
        try:
            ch = await guild.create_text_channel(name, category=category, topic=topic)
        except Exception as e:
            print("[channels] channel creation failed:", e)
            return None
    return ch


async def edit_channel(channel: discord.TextChannel, **kw) -> bool:
    try:
        await channel.edit(**kw)
        return True
    except Exception:
        return False


if __name__ == "__main__":
    print("Usage: ch = await get_or_create(CLIENT, GUILD_ID, 'name');  await edit_channel(ch, topic='...')")
