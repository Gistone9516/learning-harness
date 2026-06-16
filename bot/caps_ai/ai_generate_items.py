# -*- coding: utf-8 -*-
"""ai_generate_items capability: batch card-draft generation from a seed list.

Each seed phrase becomes one AI call that returns a JSON card draft with front, back,
and answer fields. Calls are made serially so token pressure is bounded. Seeds that
yield invalid JSON are skipped silently with a log warning.
"""
from __future__ import annotations

import json
import logging
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import ai_caps

log = logging.getLogger(__name__)

CAP_ID = "ai_generate_items"

_ROLE = (
    "You author flashcards. "
    "Output ONLY a JSON object with exactly three keys: "
    '"front" (the question or prompt), '
    '"back" (the explanation or full answer), '
    '"answer" (the short canonical answer string). '
    "No extra keys, no prose outside the JSON."
)


def _parse_card_json(text: str) -> dict | None:
    """Extract the first JSON object from text and validate it has front/back/answer.

    Tolerates fenced code blocks and leading prose by scanning for the first '{'.
    Returns None when parsing fails or required keys are missing.
    """
    if not text:
        return None
    s = text.strip()
    start = s.find("{")
    end = s.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        obj = json.loads(s[start : end + 1])
    except (json.JSONDecodeError, ValueError):
        return None
    if not isinstance(obj, dict):
        return None
    if not all(k in obj for k in ("front", "back", "answer")):
        return None
    return obj


async def generate_cards(ctx, seeds: list[str], card_type: str = "func") -> list[dict]:
    """Generate flashcard drafts from a list of seed strings.

    For each seed, one AI call is made (force_json=True). Seeds that fail to parse
    are skipped. Returns a list of dicts, each with keys: front, back, answer, seed,
    card_type.

    The should_invoke gate checks ctx.enabled_capabilities; when "ai_generate_items"
    is absent, returns an empty list immediately with no AI calls.
    """
    enabled = CAP_ID in getattr(ctx, "enabled_capabilities", set())
    if not ai_caps.should_invoke(enabled=enabled):
        log.debug("ai_generate_items: gate closed (not in enabled_capabilities)")
        return []

    drafts: list[dict] = []

    for seed in seeds:
        prompt = f"Create a flashcard for this concept: {seed}"
        result = await ai_caps.one_shot(
            prompt,
            capability_id=CAP_ID,
            ctx=ctx,
            role=_ROLE,
            data=f"card_type: {card_type}",
            force_json=True,
        )

        if not result.ok:
            log.warning("ai_generate_items: AI call failed for seed %r: %s", seed, result.error)
            continue

        parsed = _parse_card_json(result.text)
        if parsed is None:
            log.warning("ai_generate_items: JSON parse failed for seed %r, raw=%r", seed, result.text[:120])
            continue

        parsed["seed"] = seed
        parsed["card_type"] = card_type
        drafts.append(parsed)

    return drafts
