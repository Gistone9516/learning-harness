"""
poll - Native Discord poll creation and result handling.

WHAT  : Creates a Discord built-in poll (with deadline and vote tallying) and
        processes vote results received via event handlers.
DEPS  : discord.py>=2.6
PERMS : Send Messages
USAGE : msg = await send_poll(CHANNEL, "Lunch?", ["Kimbap", "Ramen"], hours=1)
        # To receive results, register an on_raw_poll_vote_add handler on the
        # client (see the comment block below for an example).
SAFETY: To ignore votes from unauthorized users, check
        payload.user_id == ALLOWED_USER_ID inside the handler.
DEMO  : python harness/interaction/poll.py  (offline structure validation)
"""

import datetime
from typing import Optional

import discord


def make_poll(question: str, options, hours: int = 24, multiple: bool = False) -> discord.Poll:
    poll = discord.Poll(
        question=question,
        duration=datetime.timedelta(hours=min(max(int(hours), 1), 24 * 7)),
        multiple=multiple,
    )
    for o in list(options)[:10]:
        poll.add_answer(text=str(o)[:55])
    return poll


async def send_poll(
    channel: "discord.abc.Messageable",
    question: str,
    options,
    hours: int = 24,
    multiple: bool = False,
) -> discord.Message:
    return await channel.send(poll=make_poll(question, options, hours, multiple))


# Example result handler (register on your client):
#   @client.event
#   async def on_raw_poll_vote_add(payload):
#       if payload.user_id != ALLOWED_USER_ID:
#           return
#       ch = client.get_channel(payload.channel_id)
#       msg = await ch.fetch_message(payload.message_id)
#       answer = next((a.text for a in msg.poll.answers if a.id == payload.answer_id), None)
#       # handle `answer` here


if __name__ == "__main__":
    p = make_poll("Lunch?", ["Kimbap", "Ramen", "Both"], hours=2)
    assert len(p.answers) == 3
    print("poll: structure OK (3 answers)")
