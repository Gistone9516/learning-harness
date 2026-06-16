"""
mention - send a @mention push notification to a user.

WHAT : Bot messages without an actual @mention do not trigger push notifications.
       Call this at closing time (result / judgment / error) to notify the user.
DEPS : discord.py>=2.6
PERMS: Send Messages
USAGE: await ping(CHANNEL, ALLOWED_USER_ID, "[done] ...")   /   mention(uid) -> '<@uid>'
SAFETY: Do NOT use during briefings or intermediate steps (notification fatigue).
        Restrict mention targets to the allowed user only.
DEMO  : python harness/output/mention.py  (offline output example)
"""

from typing import Optional

import discord


def mention(user_id: int) -> str:
    return f"<@{user_id}>"


async def ping(
    channel: "discord.abc.Messageable",
    user_id: int,
    text: str,
) -> Optional[discord.Message]:
    """Send a mention + short label as a plain message to trigger a push notification.

    Components V2 cards do not support content, so this is sent as a separate message.
    """
    if channel is None:
        return None
    try:
        return await channel.send(
            f"{mention(user_id)} {text}",
            allowed_mentions=discord.AllowedMentions(users=True),
        )
    except Exception:
        return None


if __name__ == "__main__":
    print("mention(123) =>", mention(123))
    print("usage: await ping(CHANNEL, ALLOWED_USER_ID, '[done] result has arrived.')")
