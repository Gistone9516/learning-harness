# -*- coding: utf-8 -*-
"""Migration -- engine-contract §4.

migrate(raw: dict) -> ProgressStore    -- v0~vN -> latest version monotone chain, pure
new_card_progress(card_id) -> CardProgress  -- create default CardProgress for a new card, pure

No file I/O. No external calls. No side effects.

v0 = schema_version field absent (v4 legacy). Field names are snake_case in v4 too, so near-identity.
v0 -> v1: inject schema_version + fill missing fields with defaults.
Future versions: add _migrate_vN_to_vN1 function at the end of the chain.
"""
from __future__ import annotations

from models import (
    BOX_MIN,
    SCHEMA_VERSION,
    CardProgress,
    ProgressStore,
)
from errors import SchemaVersionError


def new_card_progress(card_id: str) -> CardProgress:
    """Return a default CardProgress for a new card.

    Defaults (engine-contract §4):
        box=BOX_MIN, due_at=0 (immediately due), graduated=False,
        cold_attempts=0, cold_correct=0,
        last_attempt_at=None, last_verdict=None.
    """
    return CardProgress(
        card_id=card_id,
        box=BOX_MIN,
        due_at=0,
        graduated=False,
        cold_attempts=0,
        cold_correct=0,
        last_attempt_at=None,
        last_verdict=None,
    )


# -- v0 -> v1 -----------------------------------------------------------------

def _migrate_v0_to_v1(raw: dict) -> dict:
    """v0 (schema_version absent) -> v1.

    Near-identity transform: inject schema_version + fill missing card fields with defaults.
    Returns a new dict without mutating the original (pure).
    """
    out = dict(raw)
    out["schema_version"] = 1

    raw_cards = raw.get("cards", {})
    new_cards: dict[str, dict] = {}

    if isinstance(raw_cards, dict):
        for card_id, card_data in raw_cards.items():
            new_cards[card_id] = _fill_card_defaults(card_id, card_data)
    elif isinstance(raw_cards, list):
        # guard against list-shaped cards from some pre-v4 structures
        for card_data in raw_cards:
            if isinstance(card_data, dict) and "card_id" in card_data:
                cid = card_data["card_id"]
                new_cards[cid] = _fill_card_defaults(cid, card_data)

    out["cards"] = new_cards
    return out


def _fill_card_defaults(card_id: str, data: dict) -> dict:
    """Fill missing fields in a card dict with defaults and return a new dict (original unchanged)."""
    defaults = {
        "card_id": card_id,
        "box": BOX_MIN,
        "due_at": 0,
        "graduated": False,
        "cold_attempts": 0,
        "cold_correct": 0,
        "last_attempt_at": None,
        "last_verdict": None,
    }
    merged = {**defaults, **data}
    # card_id must match the key (prevent override)
    merged["card_id"] = card_id
    return merged


# -- chain entry point --------------------------------------------------------

def migrate(raw: dict) -> ProgressStore:
    """Version-normalization monotone chain. Pure (no file I/O).

    Absent schema_version = v0 (legacy).
    schema_version > SCHEMA_VERSION -> SchemaVersionError (downgrade protection).
    Missing fields are filled with defaults.

    Returns: ProgressStore(schema_version=SCHEMA_VERSION, ...).
    """
    raw_version = raw.get("schema_version")

    if raw_version is None:
        current_version = 0
    else:
        try:
            current_version = int(raw_version)
        except (ValueError, TypeError):
            raise SchemaVersionError(
                f"schema_version is not a valid integer: {raw_version!r}"
            )

    if current_version > SCHEMA_VERSION:
        raise SchemaVersionError(
            f"Saved schema version ({current_version}) > code version ({SCHEMA_VERSION}). "
            "Downgrade not supported: a newer engine is required."
        )

    # monotone chain: apply each version step in order
    data = dict(raw)

    if current_version < 1:
        data = _migrate_v0_to_v1(data)
        current_version = 1

    # future version steps go here:
    # if current_version < 2:
    #     data = _migrate_v1_to_v2(data)
    #     current_version = 2

    # convert dict -> ProgressStore
    deck_namespace = data.get("deck_namespace", "")
    raw_cards = data.get("cards", {})

    cards: dict[str, CardProgress] = {}
    if isinstance(raw_cards, dict):
        for cid, cd in raw_cards.items():
            cards[cid] = _dict_to_card_progress(cid, cd)

    return ProgressStore(
        schema_version=SCHEMA_VERSION,
        deck_namespace=deck_namespace,
        cards=cards,
    )


def _dict_to_card_progress(card_id: str, data: dict) -> CardProgress:
    """Convert a card dict to CardProgress. Missing fields use defaults."""
    return CardProgress(
        card_id=data.get("card_id", card_id),
        box=int(data.get("box", BOX_MIN)),
        due_at=int(data.get("due_at", 0)),
        graduated=bool(data.get("graduated", False)),
        cold_attempts=int(data.get("cold_attempts", 0)),
        cold_correct=int(data.get("cold_correct", 0)),
        last_attempt_at=data.get("last_attempt_at", None),
        last_verdict=data.get("last_verdict", None),
    )
