"""
pins - Pin, unpin, and list pinned messages in a channel.

WHAT : Pin or unpin an important message in a text channel.
DEPS : discord.py>=2.6
PERMS: Manage Messages (or the newer Pin Messages permission)
USAGE: await pin(MESSAGE)  /  await unpin(MESSAGE)  /  pinned = await list_pins(CHANNEL)
SAFETY: -
DEMO  : python harness/output/pins.py  (prints usage examples)
"""

from typing import List, Optional


async def pin(message, reason: Optional[str] = None) -> bool:
    try:
        await message.pin(reason=reason)
        return True
    except Exception:
        return False


async def unpin(message, reason: Optional[str] = None) -> bool:
    try:
        await message.unpin(reason=reason)
        return True
    except Exception:
        return False


async def list_pins(channel) -> List:
    try:
        return await channel.pins()
    except Exception:
        return []


if __name__ == "__main__":
    print("Usage: await pin(MESSAGE) / await unpin(MESSAGE) / await list_pins(CHANNEL)")
