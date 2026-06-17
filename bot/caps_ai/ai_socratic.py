# -*- coding: utf-8 -*-
"""ai_socratic - multi-turn Socratic dialogue capability.

The only multi-turn AI capability in the bot. Uses ConvManager so every turn
in a single study session resumes the same claude session id. The AI asks one
probing question per turn and never reveals the answer.

Integration notes (operator wires these after merge):
- Register "ai_socratic" in the boot-time enabled_capabilities set.
- Call run_socratic(ctx, card, opening_text) from a command or a post-correct hook.
- The function sends AI questions to ctx.channel and waits for the learner's
  reply via discord.py channel.wait_for. In environments without a real discord
  channel (headless tests), the wait path is skipped; callers pass a fake channel
  or leave ctx.channel as None.
- The session is reset between study sessions because Session is volatile.
"""
from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import ai_caps

if TYPE_CHECKING:
    from models import CardDef

log = logging.getLogger(__name__)

CAP_ID = "ai_socratic"

# The role injected into every Socratic turn.
_SOCRATIC_ROLE = (
    "You are a Socratic tutor. Ask exactly one short probing question that helps "
    "the learner discover the answer themselves. Never state or hint the answer directly."
)

# Timeout for waiting on the learner's next Discord message (seconds).
_REPLY_TIMEOUT = None


def _card_topic(card: Any) -> str:
    """Extract a short topic label from the card for the opening preamble."""
    front = getattr(card, "front", {}) or {}
    prompt = front.get("prompt") or front.get("question") or ""
    subject = getattr(card, "subject", "") or ""
    unit = getattr(card, "unit", "") or ""
    parts = [p for p in [subject, unit, prompt[:80]] if p]
    return " / ".join(parts) if parts else card.card_id


async def _send_to_channel(channel: Any, text: str) -> None:
    """Send text to the discord channel. No-op when channel is None (headless)."""
    if channel is None:
        return
    try:
        await channel.send(text)
    except Exception as e:
        log.warning("ai_socratic: channel.send failed: %s", e)


async def _wait_for_reply(client: Any, channel: Any, user_id: int, timeout: float) -> str | None:
    """Wait for the next message from user_id in channel.

    Returns the message content string, or None on timeout or missing mechanism.
    wait_for is a method of the discord Client/Bot (not of a channel), so the caller
    passes the client. In headless tests client/channel are None and this returns None.
    """
    if client is None or channel is None:
        return None
    wait_for = getattr(client, "wait_for", None)
    if wait_for is None:
        return None
    try:
        channel_id = getattr(channel, "id", None)

        def _check(msg: Any) -> bool:
            author = getattr(msg, "author", None)
            same_user = author is not None and getattr(author, "id", None) == user_id
            same_chan = getattr(getattr(msg, "channel", None), "id", None) == channel_id
            return same_user and same_chan

        msg = await asyncio.wait_for(wait_for("message", check=_check), timeout=timeout)
        return (msg.content or "").strip()
    except asyncio.TimeoutError:
        log.info("ai_socratic: learner reply timed out after %.0fs", timeout)
        return None
    except Exception as e:
        log.warning("ai_socratic: wait_for error: %s", e)
        return None


async def run_socratic(
    ctx: Any,
    card: Any,
    opening_text: str,
    max_turns: int = 4,
    client: Any = None,
) -> None:
    """Run a multi-turn Socratic dialogue for one card.

    Sends the AI first question to ctx.channel, then loops up to max_turns,
    collecting the learner's replies and generating follow-up questions.

    The conversation state (claude_sid, turns) lives in ctx.session, which is
    volatile and reset between study sessions.

    Args:
        ctx: Ctx instance. ctx.channel may be None in headless mode.
        card: CardDef for the current card.
        opening_text: Learner's first message to seed the dialogue (e.g. their
            initial attempt or a free-text response that triggered this mode).
        max_turns: Maximum number of AI turns (default 4, matches window size).
    """
    if not ai_caps.should_invoke(enabled="ai_socratic" in getattr(ctx, "enabled_capabilities", set())):
        log.debug("ai_socratic: disabled, skipping")
        return

    topic = _card_topic(card)
    cm = ai_caps.ConvManager(ctx.session, window=max_turns)

    # Seed the opening with topic context so the first question is on-target.
    seed_text = f"[Topic: {topic}]\n{opening_text}" if opening_text else f"[Topic: {topic}]"

    current_user_text = seed_text
    for turn_idx in range(max_turns):
        if not ai_caps.should_invoke(enabled="ai_socratic" in getattr(ctx, "enabled_capabilities", set())):
            break

        result = await cm.turn(
            current_user_text,
            ctx=ctx,
            role=_SOCRATIC_ROLE,
        )

        if not result.ok:
            log.warning("ai_socratic: AI call failed on turn %d: %s", turn_idx + 1, result.error)
            await _send_to_channel(
                ctx.channel,
                "잠깐 생각해보세요. (AI에 일시적인 문제가 생겼습니다.)"
            )
            break

        ai_question = (result.text or "").strip()
        if not ai_question:
            break

        await _send_to_channel(ctx.channel, ai_question)

        # Last turn: no need to wait for another reply.
        if turn_idx == max_turns - 1:
            break

        learner_reply = await _wait_for_reply(client, ctx.channel, ctx.user_id, _REPLY_TIMEOUT)
        if learner_reply is None:
            # Timed out or no input mechanism: end gracefully.
            break

        current_user_text = learner_reply


async def build_turn(
    ctx: Any,
    user_text: str,
    *,
    cm: "ai_caps.ConvManager | None" = None,
) -> str | None:
    """Pure-core helper: run one Socratic turn and return the AI question text.

    Used by tests and by callers that manage the ConvManager lifecycle themselves.
    Returns None when the capability is disabled or the AI call fails.
    """
    if not ai_caps.should_invoke(enabled="ai_socratic" in getattr(ctx, "enabled_capabilities", set())):
        return None

    if cm is None:
        cm = ai_caps.ConvManager(ctx.session)

    result = await cm.turn(user_text, ctx=ctx, role=_SOCRATIC_ROLE)
    if not result.ok:
        log.warning("ai_socratic: build_turn failed: %s", result.error)
        return None
    return (result.text or "").strip() or None
