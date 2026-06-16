"""
reply - reply (message reference) and message forwarding.

WHAT : Reply to a specific message with a reference, or forward a message to another channel.
DEPS : discord.py>=2.6
PERMS: Send Messages, Read Message History
USAGE: await reply_to(MESSAGE, "text")  /  await forward(MESSAGE, CHANNEL)
SAFETY: mention_author=False by default; set True to ping the original author.
DEMO  : python harness/output/reply.py  (prints usage examples)
"""

import discord


async def reply_to(
    message: discord.Message,
    text: str,
    mention_author: bool = False,
    **kw,
) -> discord.Message:
    return await message.reply(text, mention_author=mention_author, **kw)


async def forward(
    message: discord.Message,
    channel: "discord.abc.Messageable",
) -> discord.Message:
    """Forward using Message.forward if available; fall back to a quoted text copy."""
    try:
        return await message.forward(channel)
    except Exception:
        who = getattr(message.author, "display_name", "?")
        body = (message.content or "")[:1800]
        return await channel.send(f"(forwarded) {who}: {body}")


if __name__ == "__main__":
    print("Usage: await reply_to(MESSAGE, '...'),  await forward(MESSAGE, CHANNEL)")
