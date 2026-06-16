# -*- coding: utf-8 -*-
"""srs_due_alert - rising-edge due detection with per-card deduplication.

Reads CardProgress from a ProgressStore, checks is_due via the Leitner engine,
and suppresses repeat alerts within a configurable minimum interval.

Scheduler push wiring (firing the alert into Discord) is a later cycle.
This module provides only the pure dedup core and the sidecar record helper.

Sidecar layout: {card_id: last_alert_ms}  where last_alert_ms is epoch ms.

Pure core:
    cards_to_alert(store, now, alert_state, min_interval_ms=DAY_MS) -> list[str]
    record_alert(mount, deck_ns, card_ids, now) -> None

Discord shell:
    get_due_alert(ctx) -> list[str]
        Loads the alert state from sidecar, calls cards_to_alert, records the
        new alerts, and returns the list of card_ids that fired.
"""
from __future__ import annotations

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

from typing import TYPE_CHECKING

import sidecar as _sidecar
from leitner import is_due
from models import MS_PER_DAY, ProgressStore

if TYPE_CHECKING:
    from context import Ctx

CAP_ID = "srs_due_alert"

# Default minimum re-alert gap: one calendar day in milliseconds.
DAY_MS: int = MS_PER_DAY


# Pure core (no discord dependency, fully testable headless) ──────────────────

def cards_to_alert(
    store: ProgressStore,
    now: int,
    alert_state: dict,
    min_interval_ms: int = DAY_MS,
) -> list[str]:
    """Return card_ids that are due and have not been alerted within min_interval_ms.

    A card qualifies when both conditions hold:
      1. is_due(progress, now) is True (now >= progress.due_at).
      2. The card has never been alerted (absent from alert_state), OR
         now - last_alert_ms >= min_interval_ms.

    Returns a plain list of card_id strings in iteration order of store.cards.
    Disabled cards (if CardProgress had an enabled flag) are not filtered here
    because CardProgress does not carry an enabled flag; filtering by CardDef.enabled
    is the caller's responsibility if needed.
    """
    result = []
    for card_id, progress in store.cards.items():
        if not is_due(progress, now):
            continue
        last_alert = alert_state.get(card_id)
        if last_alert is None or (now - last_alert) >= min_interval_ms:
            result.append(card_id)
    return result


def record_alert(mount: str, deck_ns: str, card_ids: list[str], now: int) -> None:
    """Write now as the last_alert_ms for each card_id into the sidecar.

    Loads the existing alert state, updates all entries in card_ids to now,
    then saves atomically.
    """
    if not card_ids:
        return
    state: dict = _sidecar.load_all(mount, CAP_ID, deck_ns)
    for card_id in card_ids:
        state[card_id] = now
    _sidecar.save_all(mount, CAP_ID, deck_ns, state)


# Discord shell (thin wrapper) ────────────────────────────────────────────────

async def get_due_alert(ctx: "Ctx") -> list[str]:
    """Return card_ids that are currently due and pass the dedup gate.

    Loads the sidecar alert state for the session deck, calls cards_to_alert
    with the live ProgressStore and current epoch ms, records new alerts back
    to sidecar, and returns the resulting list.

    This is a thin shell; no Discord messages are sent here.
    Scheduler push wiring (sending the alert to a channel) is a later cycle.
    """
    import time

    mount = ctx.mount
    deck_ns = ctx.deck_namespace
    store: ProgressStore = ctx.store
    now = int(time.time() * 1000)

    alert_state: dict = _sidecar.load_all(mount, CAP_ID, deck_ns)
    due = cards_to_alert(store, now, alert_state)
    record_alert(mount, deck_ns, due, now)
    return due
