"""
permissions - Channel permission overwrites.

WHAT : Overwrite channel-level permissions for a specific role or member.
DEPS : discord.py>=2.6
PERMS: Manage Roles / Manage Channels
USAGE: await set_overwrite(CHANNEL, role_or_member, send_messages=False, view_channel=True)
SAFETY: Misconfigured overwrites can lock users out of a channel. Use with care.
DEMO: python harness/community/permissions.py
"""

from __future__ import annotations

from typing import Any, Union

import discord


async def set_overwrite(
    channel: discord.abc.GuildChannel,
    target: Union[discord.Role, discord.Member],
    **perms: Any,
) -> None:
    """Apply a permission overwrite on *channel* for the given role or member."""
    await channel.set_permissions(target, overwrite=discord.PermissionOverwrite(**perms))


if __name__ == "__main__":
    print("permissions: await set_overwrite(CHANNEL, role_or_member, send_messages=False)")
