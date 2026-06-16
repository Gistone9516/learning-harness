"""
files - File attachment with dynamic filesize_limit and sensitive-file guard.

WHAT : Send a file from the working directory to a Discord channel.
       Respects the actual upload limit for each server boost tier.
       Rejects .env, keys, and other sensitive files.
DEPS : discord.py>=2.6
PERMS: Attach Files
USAGE: ok, err = await send_file(CHANNEL, WORKDIR, "path/rel.txt")
SAFETY: Paths outside the working directory and sensitive files
        (.env, *.key, etc.) are rejected. No secrets are exposed.
DEMO  : python harness/media/files.py  (validates sensitive-file guard)
"""

import os
from typing import Optional, Tuple

import discord

_SENSITIVE_END = (".pem", ".key", ".secret", ".p12", ".pfx")


def is_sensitive(path: str) -> bool:
    n = os.path.basename(path).lower()
    return (n.startswith(".env") or n in ("id_rsa", "id_dsa", ".bridge_state.json")
            or n.endswith(_SENSITIVE_END))


def attach_limit(channel: "discord.abc.Messageable") -> int:
    """Return the actual upload limit for the channel's server (boost-aware). Defaults to 10 MB."""
    g = getattr(channel, "guild", None)
    return getattr(g, "filesize_limit", 0) or 10 * 1024 * 1024


def resolve(workdir: str, rel: str) -> Tuple[Optional[str], Optional[str]]:
    base = os.path.abspath(workdir)
    full = os.path.abspath(os.path.join(base, rel))
    if not (full == base or full.startswith(base + os.sep)):
        return None, "path is outside the working directory"
    if is_sensitive(full):
        return None, "sensitive file rejected"
    if not os.path.isfile(full):
        return None, "file not found"
    return full, None


async def send_file(
    channel: "discord.abc.Messageable",
    workdir: str,
    rel: str,
) -> Tuple[bool, Optional[str]]:
    full, err = resolve(workdir, rel)
    if err:
        return False, err
    if os.path.getsize(full) > attach_limit(channel):
        return False, f"file exceeds upload limit ({attach_limit(channel) // (1024 * 1024)} MB)"
    await channel.send(file=discord.File(full))
    return True, None


if __name__ == "__main__":
    assert is_sensitive("/x/.env") and is_sensitive("/x/a.key") and not is_sensitive("/x/a.py")
    print("files: sensitive-file guard OK")
