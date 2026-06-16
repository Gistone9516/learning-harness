# -*- coding: utf-8 -*-
"""AI hint generation capability (layer-3, ai_hint).

Dynamic alternative to the non-AI caps/hint_progressive. Generates a single
graduated hint via one_shot without revealing the answer.

Public API:
    async def ai_hint(ctx, card, level: int) -> str | None
"""
from __future__ import annotations

import logging
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import ai_caps
from models import CardDef

log = logging.getLogger(__name__)

_CAP_ID = "ai_hint"
_MAX_LEVEL = 3

_ROLE = (
    "Give a single graduated hint for the study card below. "
    "Do NOT reveal the answer. Be concise."
)


async def ai_hint(ctx, card: CardDef, level: int) -> str | None:
    """Generate a graduated AI hint for the given card and hint level.

    Gates on capability enabled and level <= _MAX_LEVEL. Calls one_shot with
    capability_id="ai_hint" so CAP_LIMITS applies (low effort, 80 tokens).
    Returns hint text on success, None when gated or on failure.

    Args:
        ctx: LearningContext with ai_model, ai_effort, ai_persona,
             enabled_capabilities, channel, user_id, etc.
        card: The card being studied.
        level: Hint level requested (1 = first/gentlest, 3 = most specific).

    Returns:
        Hint text string or None.
    """
    enabled = _CAP_ID in getattr(ctx, "enabled_capabilities", set())
    if not ai_caps.should_invoke(enabled=enabled, condition=level <= _MAX_LEVEL):
        return None

    prompt_text = card.front.get("prompt", "") if isinstance(card.front, dict) else str(card.front)
    data = f"Card prompt: {prompt_text}\nHint level: {level} of {_MAX_LEVEL}"

    result = await ai_caps.one_shot(
        "Generate the hint now.",
        capability_id=_CAP_ID,
        ctx=ctx,
        role=_ROLE,
        data=data,
    )

    if not result.ok:
        log.info("ai_hint failed (card=%s, level=%d): %s", card.card_id, level, result.error)
        return None

    return result.text.strip() or None
