"""
webhook - Post messages under a webhook identity.

WHAT  : Creates a webhook in a channel and sends messages with an arbitrary
        name and avatar, letting multiple "speakers" coexist in one channel.
DEPS  : discord.py>=2.6
PERMS : Manage Webhooks
USAGE : hook = await get_webhook(CHANNEL, "harness-hook")
        await hook.send("Hello", username="Expert A", thread=THREAD)  # thread is optional
SAFETY: Manage Webhooks permission is required when re-inviting the bot.
        Never post tokens or secrets through a webhook.
DEMO  : python harness/channels/webhook.py  (prints usage example)
"""

from typing import Optional

import discord


async def get_webhook(
    channel: discord.abc.Messageable,
    name: str = "harness-hook",
) -> Optional[discord.Webhook]:
    """Return an existing webhook with the given name, or create a new one.

    For sending to a thread, pass the parent channel here and supply the
    thread object when calling hook.send().
    """
    try:
        for h in await channel.webhooks():
            if h.name == name:
                return h
        return await channel.create_webhook(name=name)
    except Exception as e:
        print("[webhook] Failed to acquire webhook:", e)
        return None


if __name__ == "__main__":
    print(
        "Usage: hook = await get_webhook(CHANNEL);"
        "  await hook.send('hi', username='Name', thread=THREAD)"
    )
