"""
moderation - kick / ban / timeout / bulk-delete / nickname.

WHAT : Kick, ban, timeout, bulk-delete messages, and set nicknames for guild members.
DEPS : discord.py>=2.6
PERMS: Kick Members, Ban Members, Moderate Members, Manage Messages, Manage Nicknames
USAGE: await kick(member); await ban(member); await timeout(member, minutes=10)
       await purge(channel, 50); await set_nick(member, "NewName")
SAFETY: Strong permissions required. Invoke only from authorized-user commands.
        Be careful when targeting administrators or the bot itself.
DEMO  : python harness/community/moderation.py
"""

import datetime
from typing import Optional, Callable, List

import discord


async def kick(member: discord.Member, reason: Optional[str] = None) -> None:
    await member.kick(reason=reason)


async def ban(member: discord.Member, reason: Optional[str] = None) -> None:
    await member.ban(reason=reason)


async def unban(guild: discord.Guild, user: discord.User, reason: Optional[str] = None) -> None:
    await guild.unban(user, reason=reason)


async def timeout(member: discord.Member, minutes: int = 10, reason: Optional[str] = None) -> None:
    await member.timeout(datetime.timedelta(minutes=minutes), reason=reason)


async def purge(
    channel: discord.TextChannel,
    limit: int = 50,
    check: Optional[Callable[[discord.Message], bool]] = None,
) -> List[discord.Message]:
    return await channel.purge(limit=limit, check=check)


async def set_nick(member: discord.Member, nick: str) -> None:
    await member.edit(nick=nick)


if __name__ == "__main__":
    print("moderation: kick / ban / unban / timeout / purge / set_nick  (requires strong guild permissions)")
