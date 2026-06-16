# -*- coding: utf-8 -*-
"""adaptive_weight capability (learning-types, LAYER 2, capability_id=adaptive_weight).

Recomputes per-card weights from the learner's answer history and exposes them
as QueueOptions.weight_overrides so the engine selection layer uses them on the
next queue build.  No AI is involved; this is fully rule-based.

Weight formula (clamped to [1, 10]):
  - card has never been attempted (cold_attempts == 0): weight 5 (neutral default)
  - card is graduated (graduated == True): weight 1 (lowest priority)
  - wrong_rate = 1 - cold_correct / cold_attempts
    weight = round(1 + wrong_rate * 9)  maps [0.0, 1.0] -> [1, 10]

Pure core (no discord):
    recompute_weights(store, deck) -> dict[card_id, int]
    load_weight_overrides(mount, deck_ns) -> dict[card_id, int]
    save_weight_overrides(mount, deck_ns, overrides) -> None

Discord shell:
    async apply_weights(ctx) -> dict[card_id, int]
        Recomputes weights from ctx.store/ctx.deck, persists them, and returns
        the override dict so the caller can inject it into QueueOptions.
"""
from __future__ import annotations

import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import sidecar
from models import CardDef, CardProgress, DeckData, ProgressStore

log = logging.getLogger(__name__)

CAP_ID = "adaptive_weight"

WEIGHT_MIN = 1
WEIGHT_MAX = 10
WEIGHT_DEFAULT = 5  # used for cards with no attempts yet


# Pure core functions (no discord, fully testable headless)

def _compute_card_weight(prog: CardProgress | None) -> int:
    """Compute the adaptive weight for one card from its progress record.

    Rules (applied in order):
      1. No progress record or cold_attempts == 0: return WEIGHT_DEFAULT (5).
      2. graduated == True: return WEIGHT_MIN (1).
      3. Otherwise map wrong_rate linearly to [WEIGHT_MIN, WEIGHT_MAX].
         wrong_rate = 1.0 - cold_correct / cold_attempts
         weight = round(WEIGHT_MIN + wrong_rate * (WEIGHT_MAX - WEIGHT_MIN))
         Result is then clamped to [WEIGHT_MIN, WEIGHT_MAX].
    """
    if prog is None or prog.cold_attempts == 0:
        return WEIGHT_DEFAULT

    if prog.graduated:
        return WEIGHT_MIN

    wrong_rate = 1.0 - prog.cold_correct / prog.cold_attempts
    raw = WEIGHT_MIN + wrong_rate * (WEIGHT_MAX - WEIGHT_MIN)
    return max(WEIGHT_MIN, min(WEIGHT_MAX, round(raw)))


def recompute_weights(store: ProgressStore, deck: DeckData) -> dict[str, int]:
    """Return a fresh weight override dict for all cards in deck.

    Only enabled cards are included.  Weights are clamped to [WEIGHT_MIN, WEIGHT_MAX].
    The result is suitable for use as QueueOptions.weight_overrides.
    """
    overrides: dict[str, int] = {}
    for card in deck.cards:
        if not card.enabled:
            continue
        prog = store.cards.get(card.card_id)
        overrides[card.card_id] = _compute_card_weight(prog)
    return overrides


def load_weight_overrides(mount: str, deck_ns: str) -> dict[str, int]:
    """Load the persisted weight overrides from the sidecar.

    Returns an empty dict when no overrides have been saved yet.
    Values are cast to int for safety.
    """
    raw = sidecar.load_all(mount, CAP_ID, deck_ns)
    result: dict[str, int] = {}
    for k, v in raw.items():
        try:
            result[k] = int(v)
        except (TypeError, ValueError):
            result[k] = WEIGHT_DEFAULT
    return result


def save_weight_overrides(mount: str, deck_ns: str, overrides: dict[str, int]) -> None:
    """Persist the weight override dict to the sidecar (atomic write)."""
    sidecar.save_all(mount, CAP_ID, deck_ns, overrides)


# Discord shell

async def apply_weights(ctx) -> dict[str, int]:
    """Recompute weights from the current session state, persist, and return the overrides.

    The caller should inject the return value into QueueOptions(weight_overrides=...) before
    calling build_queue.  This function has no interactive discord component; it is
    called programmatically by the session driver, not directly by a learner interaction.
    """
    store: ProgressStore = ctx.store
    deck: DeckData = ctx.deck
    mount: str = ctx.mount
    deck_ns: str = ctx.deck_namespace

    overrides = recompute_weights(store, deck)
    try:
        save_weight_overrides(mount, deck_ns, overrides)
    except Exception as exc:
        log.warning("adaptive_weight: failed to persist overrides for deck=%s: %s", deck_ns, exc)

    return overrides
