# -*- coding: utf-8 -*-
"""ai_session_summary capability (layer-3 AI cap).

Generates an encouraging end-of-session journal entry via a single one_shot
call. Called after all cards in a session are exhausted. The text is suitable
for display in a Discord embed or plain message.

Public API
----------
session_summary(ctx, stats) -> str | None

Integration notes
-----------------
- Register "ai_session_summary" in ctx.enabled_capabilities to enable.
- Call session_summary at session-end, passing the Session.stats object.
- stats must expose: total_attempts, correct, box_advances, box_demotions, skipped.
- Returns the journal text (Korean) on success, or None when gated (zero
  attempts, capability off) or when the AI call fails.
- The caller should degrade gracefully on None (skip the journal embed).
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

CAP_ID = "ai_session_summary"

_ROLE = (
    "You are a study coach. "
    "Write a short, encouraging session log for the learner. "
    "Mention what went well and suggest one thing to focus on next. "
    "Keep it under 5 sentences."
)


def _stats_data(stats: Any) -> str:
    """Format the stats object into a compact data string for the preamble.

    Never passes the full deck or session history, only numeric totals.
    """
    total = getattr(stats, "total_attempts", 0)
    correct = getattr(stats, "correct", 0)
    advances = getattr(stats, "box_advances", 0)
    demotions = getattr(stats, "box_demotions", 0)
    skipped = getattr(stats, "skipped", 0)
    wrong = total - correct
    return (
        f"Session stats: total_attempts={total}, correct={correct}, "
        f"wrong={wrong}, box_advances={advances}, box_demotions={demotions}, "
        f"skipped={skipped}"
    )


async def session_summary(ctx: Any, stats: Any) -> str | None:
    """Return a short AI-generated Korean session journal or None.

    Gates on the capability being enabled AND stats.total_attempts > 0.
    When total_attempts is zero the session was empty and no AI token is spent.

    Parameters
    ----------
    ctx:
        Bot handler context (Ctx instance). Provides enabled_capabilities,
        ai_model, ai_effort, ai_persona.
    stats:
        Session.stats object with fields: total_attempts, correct,
        box_advances, box_demotions, skipped.

    Returns
    -------
    str | None
        Encouraging journal text in Korean, or None when gated or on AI
        failure.
    """
    enabled = CAP_ID in getattr(ctx, "enabled_capabilities", set())
    total_attempts = getattr(stats, "total_attempts", 0)

    if not ai_caps.should_invoke(enabled=enabled, condition=total_attempts > 0):
        log.debug(
            "ai_session_summary skipped: enabled=%s, total_attempts=%d",
            enabled,
            total_attempts,
        )
        return None

    data = _stats_data(stats)
    prompt = "Write a short study-session log."

    result = await ai_caps.one_shot(
        prompt,
        capability_id=CAP_ID,
        ctx=ctx,
        role=_ROLE,
        data=data,
    )

    if result.ok:
        return result.text.strip() or None

    log.warning("ai_session_summary: AI call failed (error=%s)", result.error)
    return None
