"""
chunk - Split long text and wrap it in code blocks.

WHAT : Safely splits long text into pieces that fit Discord's 2000-character
       message limit and sends each piece in order.
DEPS : discord.py>=2.6
PERMS: Send Messages
USAGE: await send_chunks(CHANNEL, long_text)  /  await send_code(CHANNEL, code, lang="py")
SAFETY: Mask secrets before passing text here; never print raw secret values.
DEMO  : python harness/output/chunk.py  (offline split validation, no network needed)
"""

from __future__ import annotations

from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    import discord


def split_text(text: Optional[str], size: int = 1990) -> list[str]:
    """Split *text* into chunks of at most *size* characters. Returns [''] for empty input."""
    text = text or ""
    return [text[i:i + size] for i in range(0, len(text), size)] or [""]


async def send_chunks(
    channel: "discord.abc.Messageable",
    text: str,
    silent: bool = False,
) -> None:
    """Send *text* to *channel* in 1990-character chunks."""
    for part in split_text(text):
        await channel.send(part or "(empty)", silent=silent)


async def send_code(
    channel: "discord.abc.Messageable",
    code: str,
    lang: str = "",
    silent: bool = False,
) -> None:
    """Send *code* as a fenced code block, splitting at 1900 characters to leave room for fences."""
    for part in split_text(code, 1900):
        await channel.send(f"```{lang}\n{part}\n```", silent=silent)


if __name__ == "__main__":
    parts = split_text("x" * 4100)
    print("4100-char split ->", [len(p) for p in parts])
    assert all(len(p) <= 1990 for p in parts) and len(parts) == 3
    print("chunk: split OK")
