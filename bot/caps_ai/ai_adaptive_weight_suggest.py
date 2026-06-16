# -*- coding: utf-8 -*-
"""AI adaptive weight strategy suggestion capability (layer-3, ai_adaptive_weight_suggest).

Distinct from the rule-based caps/adaptive_weight module. Uses one_shot to ask a study coach
to produce a short prose focus strategy given a weakness summary. Does NOT emit numeric weights.

Public API:
    async def suggest_strategy(ctx, weakness_summary: str) -> str | None
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

_CAP_ID = "ai_adaptive_weight"

_ROLE = (
    "You are a study coach; suggest a focus strategy in prose. "
    "Do NOT output numeric weights or probabilities."
)


async def suggest_strategy(ctx, weakness_summary: str) -> str | None:
    """Generate a prose focus strategy based on the learner weakness summary.

    Gates on the 'ai_adaptive_weight' capability being enabled in ctx.enabled_capabilities.
    Calls one_shot with capability_id='ai_adaptive_weight' so CAP_LIMITS applies
    (low effort, 200 tokens). Returns strategy text on success, None when gated or on failure.

    Args:
        ctx: LearningContext with ai_model, ai_effort, ai_persona,
             enabled_capabilities, channel, user_id, etc.
        weakness_summary: Short text describing the learner's weak areas.

    Returns:
        Strategy prose string or None.
    """
    enabled = _CAP_ID in getattr(ctx, "enabled_capabilities", set())
    if not ai_caps.should_invoke(enabled=enabled):
        return None

    result = await ai_caps.one_shot(
        "학습자의 약점 분석을 바탕으로 집중 학습 전략을 제안해 주세요.",
        capability_id=_CAP_ID,
        ctx=ctx,
        role=_ROLE,
        data=weakness_summary,
    )

    if not result.ok:
        log.info("ai_adaptive_weight_suggest failed: %s", result.error)
        return None

    return result.text.strip() or None
