"""
roles - role creation, assignment, and removal.

WHAT : Create guild roles and add/remove them from members.
DEPS : discord.py>=2.6
PERMS: Manage Roles
USAGE: role = await create_role(guild, "VIP", color=0x5865F2)
       await give(member, role); await take(member, role)
SAFETY: The bot's own role must be positioned above the target role
        in the guild hierarchy before assignment will succeed.
DEMO  : python harness/community/roles.py  (offline info)
"""

import discord
from typing import Optional


async def create_role(
    guild: discord.Guild,
    name: str,
    color: int = 0,
    **kw,
) -> discord.Role:
    return await guild.create_role(name=name, colour=discord.Colour(color), **kw)


async def give(
    member: discord.Member,
    role: discord.Role,
    reason: Optional[str] = None,
) -> None:
    await member.add_roles(role, reason=reason)


async def take(
    member: discord.Member,
    role: discord.Role,
    reason: Optional[str] = None,
) -> None:
    await member.remove_roles(role, reason=reason)


def find_role(guild: discord.Guild, name: str) -> Optional[discord.Role]:
    return discord.utils.get(guild.roles, name=name)


if __name__ == "__main__":
    print("roles: create_role / give / take / find_role")
