"""
reactions - Add and collect emoji reactions on messages.

WHAT  : Adds emoji reactions to a message and waits for a permitted user to
        pick one (lightweight yes/no approval flow).
DEPS  : discord.py>=2.6
PERMS : Add Reactions, Read Message History; the 'reactions' gateway intent
        is required when collecting reactions from other users.
INTENTS: reactions
USAGE : await add(MESSAGE, "yes", "no");
        picked = await wait_choice(CLIENT, MESSAGE, ALLOWED_USER_ID, ["yes", "no"])
SAFETY: wait_choice only accepts reactions from ALLOWED_USER_ID.
DEMO  : python harness/output/reactions.py  (prints usage examples)
"""

import asyncio
from typing import Optional, Sequence


async def add(message, *emojis: str) -> None:
    """Add one or more emoji reactions to a message, silently skipping any that fail."""
    for e in emojis:
        try:
            await message.add_reaction(e)
        except Exception:
            pass


async def wait_choice(
    client,
    message,
    user_id: int,
    emojis: Sequence[str],
    timeout: float = 300,
) -> Optional[str]:
    """Add emojis to message, then wait for user_id to click one.

    Returns the chosen emoji string, or None on timeout.
    """
    await add(message, *emojis)

    def check(reaction, user):
        return (
            user.id == user_id
            and str(reaction.emoji) in emojis
            and reaction.message.id == message.id
        )

    try:
        reaction, _ = await client.wait_for("reaction_add", timeout=timeout, check=check)
        return str(reaction.emoji)
    except asyncio.TimeoutError:
        return None


if __name__ == "__main__":
    print("Usage: await add(MSG, emoji1, emoji2);  await wait_choice(CLIENT, MSG, ALLOWED_USER_ID, [emojis])")
    print("(Pass actual emoji strings at call time. Emojis omitted here to keep console output cp949-safe.)")
