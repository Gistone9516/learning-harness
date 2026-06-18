# -*- coding: utf-8 -*-
"""AI variant question generation capability (layer-3, ai_variant_q).

Generates a rephrased question for a mastered (box 3) card, keeping the same
correct answer. Used to re-engage learners who have already mastered a card.

Public API:
    async def make_variant(ctx, card) -> dict | None
    def box3_cards(store, deck) -> list[str]
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
from models import CardDef, DeckData, ProgressStore

log = logging.getLogger(__name__)

_CAP_ID = "ai_variant_q"

_ROLE = (
    "Rephrase the question keeping the same answer; output JSON {front}. "
    "The 'front' value must be a complete question string. "
    "Do NOT change what counts as a correct answer. No extra keys."
)


def _parse_variant_json(text: str) -> dict | None:
    """Extract the first JSON object from text and validate it has a 'front' key.

    Tolerates fenced code blocks and leading prose by scanning for the first '{'.
    Returns None when parsing fails or the 'front' key is missing or empty.
    """
    if not text:
        return None
    s = text.strip()
    start = s.find("{")
    end = s.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        obj = json.loads(s[start:end + 1])
    except (json.JSONDecodeError, ValueError):
        return None
    if not isinstance(obj, dict):
        return None
    front = obj.get("front")
    if not front or not isinstance(front, str) or not front.strip():
        return None
    return obj


def box3_cards(store: ProgressStore, deck: DeckData) -> list[str]:
    """Return card IDs that are in box 3 (mastered) and present in the active deck.

    Pure function, no AI call. Filters store.cards for box == 3 and cross-checks
    against the deck's card list so stale progress entries are excluded.

    Args:
        store: ProgressStore with the learner's current progress.
        deck: DeckData for the active subject.

    Returns:
        List of card_id strings in box 3.
    """
    deck_ids = {c.card_id for c in deck.cards}
    return [
        card_id
        for card_id, cp in store.cards.items()
        if cp.box == 3 and card_id in deck_ids
    ]


async def make_variant(ctx, card: CardDef) -> dict | None:
    """Generate a variant question for a mastered card, keeping the same answer.

    Gates on 'ai_variant_q' being in ctx.enabled_capabilities. Calls one_shot
    with capability_id='ai_variant_q' (force_json=True) so CAP_LIMITS applies
    (low effort, 300 tokens).

    On success, returns a dict with keys:
        front      - rephrased question string (from AI)
        answer_spec - copied from card.answer_spec (same answer, unchanged)

    Returns None when gated, when the AI call fails, or when the response
    cannot be parsed as valid JSON with a non-empty 'front'.

    Args:
        ctx: LearningContext with ai_model, ai_effort, ai_persona,
             enabled_capabilities, channel, user_id, etc.
        card: The mastered CardDef to rephrase.

    Returns:
        dict with keys 'front' and 'answer_spec', or None.
    """
    enabled = _CAP_ID in getattr(ctx, "enabled_capabilities", set())
    if not ai_caps.should_invoke(enabled=enabled):
        return None

    original_front = card.front.get("prompt", "") if isinstance(card.front, dict) else str(card.front)
    data = f"Original question: {original_front}"

    result = await ai_caps.one_shot(
        "Rephrase the current question (keep the same correct answer).",
        capability_id=_CAP_ID,
        ctx=ctx,
        role=_ROLE,
        data=data,
        force_json=True,
    )

    if not result.ok:
        log.info("ai_variant_q: AI call failed (card=%s): %s", card.card_id, result.error)
        return None

    parsed = _parse_variant_json(result.text)
    if parsed is None:
        log.warning(
            "ai_variant_q: JSON parse failed (card=%s), raw=%r",
            card.card_id,
            result.text[:120],
        )
        return None

    return {
        "front": parsed["front"].strip(),
        "answer_spec": card.answer_spec,
    }
