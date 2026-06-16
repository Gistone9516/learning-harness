"""
typing_indicator - Typing indicator helper.

WHAT : Shows 'typing...' in a Discord channel while a task or response is being generated.
DEPS : discord.py>=2.6
PERMS: Send Messages
USAGE: async with typing(CHANNEL):
           await long_work()
SAFETY: Keep the indicator active only while real work is running.
        Showing it during idle waiting can mislead users into thinking tokens are still being consumed.
NOTE : The filename is typing_indicator (not typing) to avoid shadowing the stdlib typing module,
       which would break imports.
DEMO  : python harness/output/typing_indicator.py  (prints a usage example)
"""

import discord
from typing import Any


def typing(channel: "discord.abc.Messageable") -> Any:
    """Async context manager. Typing stops automatically when the block exits."""
    return channel.typing()


if __name__ == "__main__":
    print("Usage: async with typing(CHANNEL):  await real_work()")
