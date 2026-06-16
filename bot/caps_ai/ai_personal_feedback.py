# -*- coding: utf-8 -*-
"""ai_personal_feedback capability (layer-3 AI cap).

Generates personalized correction feedback after a wrong answer, taking into
account the last three wrong attempts so the coach can spot recurring patterns
and address them in one message.

Public API
----------
personal_feedback(ctx, card, user_answer, recent_wrongs) -> str | None

Integration notes
-----------------
- Register "ai_personal_feedback" in ctx.enabled_capabilities to enable.
- Call personal_feedback after a wrong verdict is confirmed.
- recent_wrongs is a list of up to 3 tuples: (card_id, user_answer, correct_answer).
  Pass an empty list when no history is available yet.
- Returns the feedback string on success, or None on failure / gate-off.
  The caller should degrade gracefully (skip or show a static message) on None.
"""
from __future__ import annotations

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import logging
from typing import Any

import ai_caps

log = logging.getLogger(__name__)

CAP_ID = "ai_personal_feedback"

_ROLE = (
    "You are an encouraging coach. "
    "Explain the mistake briefly in plain Korean. "
    "Be warm but concise. Do not repeat the question."
)

# Number of recent wrong answers to include in context.
_RECENT_WRONG_LIMIT = 3


def _build_data(card: Any, user_answer: str, recent_wrongs: list[tuple[str, str, str]]) -> str:
    """Build a compact data section for the preamble.

    Includes the current mistake and a short history of recent wrongs so the
    coach can notice patterns. Never passes the full card front or deck.
    """
    correct = _correct_answer(card)
    lines: list[str] = [
        f"Current card: {card.card_id}",
        f"Learner answered: {user_answer}",
        f"Correct answer: {correct}",
    ]

    trimmed = recent_wrongs[-_RECENT_WRONG_LIMIT:]
    if trimmed:
        lines.append("Recent wrong attempts (card_id | learner | correct):")
        for cid, uans, cans in trimmed:
            lines.append(f"  {cid} | {uans} | {cans}")

    return "\n".join(lines)


def _correct_answer(card: Any) -> str:
    """Extract a short correct-answer string from the card without exposing the full spec."""
    spec = getattr(card, "answer_spec", None)
    if spec is None:
        back = getattr(card, "back", {})
        return str(back.get("answer", "(정답 없음)"))
    accepted = getattr(spec, "accepted", None)
    if accepted:
        return accepted[0]
    return "(정답 참조)"


async def personal_feedback(
    ctx: Any,
    card: Any,
    user_answer: str,
    recent_wrongs: list[tuple[str, str, str]],
) -> str | None:
    """Return an encouraging, personalised correction message or None.

    Parameters
    ----------
    ctx:
        Bot handler context (Ctx instance). Provides enabled_capabilities,
        ai_model, ai_effort, ai_persona.
    card:
        The CardDef for the card that was answered incorrectly.
    user_answer:
        The learner's wrong answer text.
    recent_wrongs:
        List of (card_id, user_answer, correct_answer) for up to the last 3
        wrong attempts across any cards in the current session.

    Returns
    -------
    str | None
        Feedback text in Korean, or None when the gate is off or the AI call
        fails.
    """
    enabled = CAP_ID in getattr(ctx, "enabled_capabilities", set())
    # Only fire when the gate is on; no additional condition beyond that.
    if not ai_caps.should_invoke(enabled=enabled):
        log.debug("ai_personal_feedback skipped: capability not enabled")
        return None

    data = _build_data(card, user_answer, recent_wrongs)
    prompt = "이 학습자에게 틀린 이유를 짧고 따뜻하게 설명해 주세요."

    result = await ai_caps.one_shot(
        prompt,
        capability_id=CAP_ID,
        ctx=ctx,
        role=_ROLE,
        data=data,
    )

    if result.ok:
        return result.text.strip() or None

    log.warning("ai_personal_feedback: AI call failed (error=%s)", result.error)
    return None
