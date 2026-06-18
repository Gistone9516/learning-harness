# -*- coding: utf-8 -*-
"""AI proactive reminder capability (layer-3, ai_proactive_remind).

Generates a short motivational nudge when the learner has cards due.
Not called when due_count == 0 (explicit zero-token rule enforced via should_invoke).

Public API:
    async def proactive_remind(ctx, due_count: int, due_titles: list[str] | None = None) -> str | None
"""
from __future__ import annotations

import logging
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import ai_caps

log = logging.getLogger(__name__)

_CAP_ID = "ai_proactive_remind"

_ROLE = "You are a motivational coach; write a short nudge."

# Maximum number of card titles to include in the data slice sent to the AI.
_MAX_TITLES = 5


def _build_data(due_count: int, due_titles: list[str] | None) -> str:
    """Build a compact data string describing what is due.

    Keeps the preamble short as required by the token budget (low effort, 120 tokens).
    """
    parts = [f"Cards due: {due_count}"]
    if due_titles:
        shown = due_titles[:_MAX_TITLES]
        parts.append("Topics: " + ", ".join(shown))
    return "\n".join(parts)


async def proactive_remind(
    ctx,
    due_count: int,
    due_titles: list[str] | None = None,
) -> str | None:
    """Generate a short motivational nudge for the learner.

    Gates on capability enabled AND due_count > 0. When either condition is false
    the AI is never invoked (zero-token rule). Calls one_shot with
    capability_id="ai_proactive_remind" so CAP_LIMITS applies (low effort, 120 tokens).

    Args:
        ctx: LearningContext with ai_model, ai_effort, ai_persona,
             enabled_capabilities, channel, user_id, etc.
        due_count: Number of cards currently due. Must be > 0 to trigger.
        due_titles: Optional list of card/topic titles to personalise the nudge.

    Returns:
        Korean motivational text string, or None when gated or on AI failure.
    """
    enabled = _CAP_ID in getattr(ctx, "enabled_capabilities", set())
    if not ai_caps.should_invoke(enabled=enabled, condition=due_count > 0):
        return None

    data = _build_data(due_count, due_titles)

    result = await ai_caps.one_shot(
        "Write the nudge now. One or two sentences only.",
        capability_id=_CAP_ID,
        ctx=ctx,
        role=_ROLE,
        data=data,
    )

    if not result.ok:
        log.info("ai_proactive_remind failed (due=%d): %s", due_count, result.error)
        return None

    return result.text.strip() or None
