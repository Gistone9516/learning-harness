"""
checklist - intent and permission validation.

WHAT  : Helper that verifies required intents and permissions before or after the bot starts.
DEPS  : discord.py>=2.6
INTENTS: message_content, members (privileged - must be enabled in the Developer Portal)
USAGE : intents = recommended_intents()                        # Intents with message_content on
        missing = check_permissions(CHANNEL, CLIENT, ["send_messages", "attach_files"])
SAFETY: message_content and members are privileged intents and must be explicitly enabled
        in the Discord Developer Portal before the bot can receive those events.
DEMO  : python harness/meta/checklist.py  (offline self-check)
"""

from typing import List, Optional
import discord


def recommended_intents() -> discord.Intents:
    """Return a discord.Intents preset with message_content enabled."""
    i = discord.Intents.default()
    i.message_content = True
    return i


def check_permissions(
    channel: "discord.abc.GuildChannel",
    client: "discord.Client",
    needed: List[str],
) -> List[str]:
    """Compare the bot's actual permissions in *channel* against *needed*.

    Returns the list of permission names that are missing.
    If the channel has no guild (e.g. a DM), all needed permissions are
    considered missing and the full list is returned.
    """
    me: Optional[discord.Member] = (
        channel.guild.me if getattr(channel, "guild", None) else None
    )
    if me is None:
        return list(needed)
    perms = channel.permissions_for(me)
    return [n for n in needed if not getattr(perms, n, False)]


if __name__ == "__main__":
    assert recommended_intents().message_content
    print("checklist: recommended_intents OK (message_content on)")
