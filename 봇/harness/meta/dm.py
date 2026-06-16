"""
dm - Direct message send and receive.

WHAT  : Send a DM to a user and receive replies from DM channels.
DEPS  : discord.py>=2.6
INTENTS: message_content (required to read incoming DM body text)
PERMS : No special guild permissions needed to send DMs; receiving message
        body requires the message_content intent.
USAGE : await dm_user(CLIENT, ALLOWED_USER_ID, "Hello")
        # Receiving: branch on isinstance(message.channel, discord.DMChannel)
        # inside your on_message event handler.
SAFETY: Send only to the allowed user. Never include secrets in the payload.
DEMO  : python harness/meta/dm.py  (prints usage examples)

Receive example:
   @client.event
   async def on_message(message):
       if isinstance(message.channel, discord.DMChannel) and message.author.id == ALLOWED_USER_ID:
           ...
"""

from typing import Any, Optional

import discord  # noqa: F401  (used in isinstance checks for DMChannel)


async def dm_user(
    client: "discord.Client",
    user_id: int,
    content: Optional[str] = None,
    **kw: Any,
) -> "discord.Message":
    """Send a direct message to the given user.

    Tries the local cache first (get_user); falls back to an API call
    (fetch_user) if the user is not cached.

    Args:
        client:   The connected discord.Client (or Bot) instance.
        user_id:  Discord user ID of the recipient.
        content:  Text content of the message (optional if embeds/files are
                  passed via keyword arguments).
        **kw:     Additional keyword arguments forwarded to user.send().

    Returns:
        The discord.Message object that was sent.
    """
    user = client.get_user(user_id) or await client.fetch_user(user_id)
    return await user.send(content, **kw)


if __name__ == "__main__":
    print("Usage: await dm_user(CLIENT, ALLOWED_USER_ID, 'Hello')")
