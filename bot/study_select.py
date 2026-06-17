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


def _area(card: CardDef) -> str:
    return (card.tags or {}).get("area", "")


def _level(card: CardDef):
    return (card.tags or {}).get("level")


def cards_in_area_level(cards: list[CardDef], area: str, level: int) -> list[CardDef]:
    """Cards of one area AT exactly the given level. Never returns higher levels (difficulty continuity)."""
    return [c for c in cards if _area(c) == area and _level(c) == level]


def cards_in_area_upto(cards: list[CardDef], area: str, level: int) -> list[CardDef]:
    """Cards of one area at level <= the given level (current + lower, for review). Never above."""
    out = []
    for c in cards:
        lvl = _level(c)
        if _area(c) == area and isinstance(lvl, int) and lvl <= level:
            out.append(c)
    return out
