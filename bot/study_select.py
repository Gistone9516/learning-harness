# -*- coding: utf-8 -*-
"""Pure card-selection helpers for the study runner (headless-testable, no discord)."""
from __future__ import annotations

import _paths
_paths.setup()

from models import CardDef


def filter_cards_by_unit(cards: list[CardDef], unit: str | None) -> list[CardDef]:
    """Return only cards whose `unit` exactly matches `unit`. Falsy unit returns all cards."""
    if not unit:
        return list(cards)
    return [c for c in cards if c.unit == unit]
