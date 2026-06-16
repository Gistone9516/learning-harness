"""
forum - Forum post creation with tag support.

WHAT : Creates a post (thread) in a forum channel and applies available tags.
DEPS : discord.py>=2.6
PERMS: Send Messages (to post in a forum), Manage Threads (to manage tags)
USAGE: post = await create_post(FORUM_CHANNEL, "Title", "Body text", tag_names=["in-progress"])
       # FORUM_CHANNEL = discord.ForumChannel
SAFETY: Tag names must exist in the forum's available_tags list to be applied.
DEMO  : python harness/channels/forum.py  (prints usage example)
"""

from typing import Optional, List
import discord


async def create_post(
    forum: discord.ForumChannel,
    title: str,
    content: str,
    tag_names: Optional[List[str]] = None,
) -> discord.Thread:
    # Resolve tag names to ForumTag objects; silently skip names not found in available_tags
    tags = []
    for name in (tag_names or []):
        tag = next((t for t in forum.available_tags if t.name == name), None)
        if tag:
            tags.append(tag)
    return await forum.create_thread(name=title[:100], content=content, applied_tags=tags)


if __name__ == "__main__":
    print("Usage: await create_post(FORUM_CHANNEL, 'Title', 'Body text', tag_names=['in-progress'])")
