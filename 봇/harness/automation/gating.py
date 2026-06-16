"""
gating - allowed-user / allowed-channel gate.

WHAT : Guard that restricts commands and interactions to permitted users and channels only.
DEPS : discord.py>=2.6
USAGE: if not allowed_msg(msg, ALLOWED_USER_ID, CHANNEL_ID): return
       if not allowed_interaction(interaction, ALLOWED_USER_ID): ...
SAFETY: Place at the top of every input path (on_message / slash command / button callback).
DEMO  : python harness/automation/gating.py  (offline check)
"""

from typing import Optional


def allowed_msg(message, allowed_user_id: int, channel_id: Optional[int] = None) -> bool:
    """Return True only when the message author matches and, if given, the channel matches."""
    if message.author.id != allowed_user_id:
        return False
    if channel_id is not None and message.channel.id != channel_id:
        return False
    return True


def allowed_interaction(interaction, allowed_user_id: int) -> bool:
    """Return True only when the interaction was triggered by the permitted user."""
    return interaction.user.id == allowed_user_id


if __name__ == "__main__":
    class _O:
        pass
    m = _O(); m.author = _O(); m.author.id = 1; m.channel = _O(); m.channel.id = 2
    assert allowed_msg(m, 1, 2) and not allowed_msg(m, 9, 2) and not allowed_msg(m, 1, 99)
    print("gating: OK")
