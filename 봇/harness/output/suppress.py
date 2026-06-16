"""
suppress - Link preview / embed suppression.

WHAT : Prevents URL auto-embeds from leaking content externally (security).
       Supports both pre-send wrapping and post-send suppression.
DEPS : discord.py>=2.6
PERMS: Send Messages; post-send suppression also requires Manage Messages
USAGE: await CHANNEL.send(wrap_urls(text))  or  send(text, suppress_embeds=True);
       await suppress(MESSAGE)
SAFETY: Always suppress when URL contents are sensitive. Never embed secrets in URLs.
DEMO  : python harness/output/suppress.py  (offline verification)
"""

import re
from typing import Optional

import discord

_URL = re.compile(r"https?://\S+")


def wrap_urls(text: Optional[str]) -> str:
    """Wrap URLs in angle brackets to prevent auto-preview (already-wrapped URLs are left as-is)."""
    def repl(m: re.Match) -> str:
        u = m.group(0)
        return u if u.endswith(">") else f"<{u}>"
    return _URL.sub(repl, text or "")


async def suppress(message: discord.Message) -> bool:
    """Suppress embeds/previews on a message that has already been sent."""
    try:
        await message.edit(suppress=True)
        return True
    except Exception:
        try:
            await message.edit(flags=discord.MessageFlags(suppress_embeds=True))
            return True
        except Exception:
            return False


if __name__ == "__main__":
    out = wrap_urls("see https://a.com and <https://b.com>")
    print(out)
    assert "<<" not in out  # already-wrapped URLs must not be double-wrapped
    print("suppress: wrap_urls OK")
