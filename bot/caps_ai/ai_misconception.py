# -*- coding: utf-8 -*-
"""ai_misconception capability: diagnose conceptual gaps from repeated-error cards.

Analyses the top-N highest wrong-rate cards and asks the AI to identify the
underlying conceptual gap pattern. Returns a plain-text diagnosis string or None.

Pure helpers (no discord, fully testable headless):
    top_error_cards(store, deck, n=5) -> list[str]
        Returns card_id strings sorted by wrong rate descending, capped to n.
        Only cards with at least one cold attempt are considered.

Discord shell:
    async diagnose(ctx, top_cards) -> str | None
        Builds a compact summary of the given cards, calls AI via one_shot,
        and returns the diagnosis text. Returns None on gate-skip or AI failure.
"""
from __future__ import annotations

import logging
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import ai_caps
from models import DeckData, ProgressStore

log = logging.getLogger(__name__)

CAP_ID = "ai_misconception"

_ROLE = (
    "You are a learning analyst. "
    "Given a list of flashcard topics where a learner repeatedly makes errors, "
    "identify the most likely shared conceptual gap or misconception. "
    "Be concise and specific. Respond in Korean."
)

_MAX_CARD_SUMMARY_LEN = 60  # characters per card front text in the data slice


def _wrong_rate(cold_attempts: int, cold_correct: int) -> float:
    """Compute wrong rate for a card. Returns 0.0 when cold_attempts is zero."""
    if cold_attempts <= 0:
        return 0.0
    return 1.0 - cold_correct / cold_attempts


def top_error_cards(store: ProgressStore, deck: DeckData, n: int = 5) -> list[str]:
    """Return up to n card_ids sorted by wrong rate descending.

    Only cards that have at least one cold attempt are included. Cards with no
    attempt record or cold_attempts == 0 are excluded (no data to rank on).
    The result is a stable sort: equal wrong rates preserve insertion order.
    """
    ranked: list[tuple[float, str]] = []

    card_ids_in_deck = {c.card_id for c in deck.cards}

    for card_id, prog in store.cards.items():
        if card_id not in card_ids_in_deck:
            continue
        if prog.cold_attempts <= 0:
            continue
        rate = _wrong_rate(prog.cold_attempts, prog.cold_correct)
        ranked.append((rate, card_id))

    ranked.sort(key=lambda x: x[0], reverse=True)
    return [card_id for _, card_id in ranked[:n]]


def _build_cards_summary(top_cards: list, deck: DeckData) -> str:
    """Build a compact summary string of the given cards for the AI data slice.

    top_cards may be CardDef objects (from operator) or plain card_id strings.
    When card_id strings are passed, front text is looked up from the deck.
    Keeps each entry short to avoid bloating the preamble.
    """
    card_map = {c.card_id: c for c in deck.cards} if deck else {}

    lines: list[str] = []
    for item in top_cards:
        if hasattr(item, "card_id"):
            card_id = item.card_id
            front = item.front.get("prompt", "") if isinstance(item.front, dict) else str(item.front)
        else:
            card_id = str(item)
            card = card_map.get(card_id)
            front = card.front.get("prompt", "") if (card and isinstance(card.front, dict)) else ""

        front_snippet = front[:_MAX_CARD_SUMMARY_LEN].strip()
        if front_snippet:
            lines.append(f"- {card_id}: {front_snippet}")
        else:
            lines.append(f"- {card_id}")

    return "\n".join(lines)


async def diagnose(ctx, top_cards) -> str | None:
    """Diagnose repeated-error patterns over the given top-error cards.

    top_cards is a small list of cards with high wrong rate. The operator builds
    this list (typically via top_error_cards) and passes it here. Cards may be
    CardDef objects or plain card_id strings.

    Gate conditions:
      - "ai_misconception" must be in ctx.enabled_capabilities
      - top_cards must be non-empty

    Returns the AI diagnosis text (Korean) or None when gated out or on failure.
    """
    enabled = CAP_ID in getattr(ctx, "enabled_capabilities", set())
    if not ai_caps.should_invoke(enabled=enabled, condition=len(top_cards) > 0):
        log.debug("ai_misconception: gate closed (enabled=%s, top_cards=%d)", enabled, len(top_cards))
        return None

    deck = getattr(ctx, "deck", None)
    data = _build_cards_summary(top_cards, deck)

    prompt = (
        "다음은 학습자가 반복적으로 오답을 낸 카드 목록입니다. "
        "이 오류들의 공통 개념적 원인을 진단해주세요."
    )

    result = await ai_caps.one_shot(
        prompt,
        capability_id=CAP_ID,
        ctx=ctx,
        role=_ROLE,
        data=data,
    )

    if not result.ok:
        log.warning("ai_misconception: AI call failed: %s", result.error)
        return None

    return result.text.strip() if result.text else None
