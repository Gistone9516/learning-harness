# -*- coding: utf-8 -*-
"""Review card selection (pure, no discord). Used by /review to build a focused review session.

A card is included when its last attempt was incorrect, or when it is currently due. This is pure so it
is unit-testable without a bot.
"""
from __future__ import annotations

from typing import List

import _paths
_paths.setup()

from models import CardDef, ProgressStore
from leitner import is_due


def select_review_cards(store: ProgressStore, cards: List[CardDef], now: int) -> List[CardDef]:
    """Return the subset of cards worth reviewing now: last verdict incorrect, or due.

    Cards with no progress yet are skipped (nothing to review). Order follows the deck card order.
    """
    out: List[CardDef] = []
    for card in cards:
        prog = store.cards.get(card.card_id)
        if prog is None:
            continue
        if prog.last_verdict == "incorrect" or is_due(prog, now):
            out.append(card)
    return out
