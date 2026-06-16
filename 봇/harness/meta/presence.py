"""
presence - bot status and activity.

WHAT : Sets the bot's activity (playing/watching/listening/custom) and status (online/idle/dnd).
DEPS : discord.py>=2.6
USAGE: await set_activity(CLIENT, "market watch", kind="watching"); await set_status(CLIENT, "idle")
SAFETY: -
DEMO : python harness/meta/presence.py  (offline config validation)
"""

import discord
from typing import Optional

_KIND = {
    "playing": discord.ActivityType.playing,
    "watching": discord.ActivityType.watching,
    "listening": discord.ActivityType.listening,
}


async def set_activity(client: discord.Client, text: str, kind: str = "playing") -> None:
    # Falls back to "playing" if an unrecognized kind string is given.
    act = discord.Activity(type=_KIND.get(kind, discord.ActivityType.playing), name=text)
    await client.change_presence(activity=act)


async def set_status(client: discord.Client, status: str = "online") -> None:
    # Maps status string to a discord.Status enum; defaults to online.
    s = {"online": discord.Status.online, "idle": discord.Status.idle,
         "dnd": discord.Status.dnd}.get(status, discord.Status.online)
    await client.change_presence(status=s)


async def set_custom(client: discord.Client, text: str) -> None:
    # Sets a custom activity string (shown as a custom status in the client).
    await client.change_presence(activity=discord.CustomActivity(name=text))


if __name__ == "__main__":
    assert discord.Activity(type=discord.ActivityType.watching, name="x").name == "x"
    print("presence: config OK")
