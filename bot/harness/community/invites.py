"""
invites - Guild invite creation and tracking.  [non-core]

WHAT : Create channel invites and retrieve the full invite list for a guild.
DEPS : discord.py>=2.6
PERMS: Create Instant Invite, (listing) Manage Guild
USAGE: inv = await make_invite(CHANNEL, max_age=3600, max_uses=1)
       invs = await list_invites(guild)
SAFETY: Keep invite links private; do not expose them in public channels.
DEMO  : python harness/community/invites.py  (offline usage hint)
"""

from typing import Optional, List
import discord


async def make_invite(
    channel: discord.abc.GuildChannel,
    max_age: int = 86400,
    max_uses: int = 0,
    unique: bool = True,
) -> discord.Invite:
    return await channel.create_invite(max_age=max_age, max_uses=max_uses, unique=unique)


async def list_invites(guild: discord.Guild) -> List[discord.Invite]:
    try:
        return await guild.invites()
    except Exception:
        return []


if __name__ == "__main__":
    print("invites: make_invite(CHANNEL) / list_invites(guild)")
