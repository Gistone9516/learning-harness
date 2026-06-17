"""
threads - Thread creation, archiving, and locking.

WHAT : Create threads from a message or a channel, then archive or lock them.
DEPS : discord.py>=2.6
PERMS: Create Public Threads, Send Messages in Threads, (archive/lock) Manage Threads
USAGE: th = await thread_from_message(MESSAGE, "task X")
       th = await thread_in_channel(CHANNEL, "name")
       await close_thread(th)
SAFETY: The bot must be reinvited with thread-related permissions if they are missing.
DEMO  : python harness/channels/threads.py  (prints usage example)
"""

import logging

import discord
from typing import Optional, Union

log = logging.getLogger(__name__)


async def thread_from_message(
    message: discord.Message,
    name: str,
    auto_archive: int = 1440,
) -> discord.Thread:
    """Create a thread attached to a message (the message becomes the first post)."""
    return await message.create_thread(name=name[:100], auto_archive_duration=auto_archive)


async def thread_in_channel(
    channel: Union[discord.TextChannel, discord.ForumChannel],
    name: str,
    auto_archive: int = 1440,
) -> discord.Thread:
    """Create a standalone public thread inside a channel."""
    return await channel.create_thread(
        name=name[:100],
        type=discord.ChannelType.public_thread,
        auto_archive_duration=auto_archive,
    )


async def close_thread(thread: discord.Thread, locked: bool = False) -> bool:
    try:
        await thread.edit(archived=True, locked=locked)
        return True
    except Exception:
        return False


async def delete_thread(thread: discord.Thread) -> bool:
    """Discard a one-off thread entirely. Falls back to archiving if delete is not permitted
    (Manage Threads required to delete)."""
    try:
        await thread.delete()
        return True
    except Exception as e:
        log.warning("delete_thread: delete failed (%s), falling back to archive", e)
        return await close_thread(thread)


if __name__ == "__main__":
    print("Usage: await thread_from_message(MESSAGE, 'name');  await close_thread(THREAD)")
