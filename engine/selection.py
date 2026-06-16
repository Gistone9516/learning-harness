# -*- coding: utf-8 -*-
"""Question queue builder (engine-contract §2).

Pure functions. No file I/O, no random calls, no current-time calls.
The caller injects `now` to guarantee determinism.
"""
from __future__ import annotations

import math
from typing import Any

from models import (
    BOX_MIN,
    BOX_MAX,
    CardDef,
    CardProgress,
    ProgressStore,
    QueueOptions,
)
from leitner import is_due


# ── weight normalization ──────────────────────────────────────────────

def _resolve_weight(
    card: CardDef,
    overrides: dict[str, int] | None,
) -> int:
    """Return the effective weight for a card.

    Priority: weight_overrides[card_id] > CardDef.tags.weight > default 5.
    Normalization rules (engine-contract §2.2, v4 spec §2.3):
      - NaN or non-numeric value -> 5
      - Out of range or non-integer -> clamp to [1, 10]
    """
    raw: Any = None

    if overrides is not None and card.card_id in overrides:
        raw = overrides[card.card_id]
    else:
        raw = card.tags.get("weight", 5) if isinstance(card.tags, dict) else 5

    # Non-numeric: fall back to default 5
    if not isinstance(raw, (int, float)) or (isinstance(raw, float) and math.isnan(raw)):
        return 5

    # Convert to int then clamp
    val = int(raw)
    if val < 1:
        return 1
    if val > 10:
        return 10
    return val


# ── source classification ─────────────────────────────────────────────

def _get_progress(
    card: CardDef,
    progress_map: dict[str, CardProgress],
) -> CardProgress | None:
    """Return the CardProgress for card_id, or None if absent."""
    return progress_map.get(card.card_id)


# ── interleaved round-robin ───────────────────────────────────────────

def _interleave_by_unit(items: list[tuple[int, str, str]]) -> list[str]:
    """Interleave by unit round-robin and return a list of card_ids.

    items: list of (weight, unit, card_id) tuples, already sorted weight DESC, card_id ASC.
    Applies unit round-robin within each weight group.

    Implementation: collect weight groups in order, then round-robin by unit inside each group.
    Unit order within a weight group follows the first-appearance order.
    """
    # Collect weight groups in order
    from collections import OrderedDict

    result: list[str] = []

    # Separate weight groups while preserving order
    groups: list[list[tuple[int, str, str]]] = []
    cur_w: int | None = None
    cur_group: list[tuple[int, str, str]] = []

    for item in items:
        w = item[0]
        if w != cur_w:
            if cur_group:
                groups.append(cur_group)
            cur_group = [item]
            cur_w = w
        else:
            cur_group.append(item)
    if cur_group:
        groups.append(cur_group)

    for group in groups:
        # Collect units in first-appearance order
        unit_order: list[str] = []
        unit_cards: dict[str, list[str]] = OrderedDict()
        for _, unit, cid in group:
            if unit not in unit_cards:
                unit_order.append(unit)
                unit_cards[unit] = []
            unit_cards[unit].append(cid)

        # Round-robin
        while any(unit_cards[u] for u in unit_order):
            for u in unit_order:
                if unit_cards[u]:
                    result.append(unit_cards[u].pop(0))

    return result


# ── public API ────────────────────────────────────────────────────────

def build_queue(
    cards: list[CardDef],
    progress: ProgressStore,
    now: int,
    opts: QueueOptions,
) -> list[str]:
    """Build the question queue and return an ordered list of card_ids (engine-contract §2).

    Normal mode:
      - new: cold_attempts == 0 (includes cards with no progress record)
      - review: cold_attempts > 0 AND is_due
      - sort: review > new; within each group: weight DESC, unit round-robin, tie-break card_id ASC
      - limit: truncate each group after sorting using new_card_limit / review_limit

    D-day mode (opts.dday_mode==True):
      - Summon all studied cards (all boxes) plus new cards
      - sort: box ASC, weight DESC, unit round-robin, card_id ASC

    Orphaned progress records (card not in cards list) are excluded from the queue but not deleted.
    Cards with enabled==False are not added to the queue (per engine-contract §5 aggregation rules).
    """
    progress_map = progress.cards
    overrides = opts.weight_overrides

    if opts.dday_mode:
        return _build_dday_queue(cards, progress_map, now, opts, overrides)
    else:
        return _build_normal_queue(cards, progress_map, now, opts, overrides)


def _build_normal_queue(
    cards: list[CardDef],
    progress_map: dict[str, CardProgress],
    now: int,
    opts: QueueOptions,
    overrides: dict[str, int] | None,
) -> list[str]:
    """Build the queue for normal mode."""
    new_items: list[tuple[int, str, str]] = []
    review_items: list[tuple[int, str, str]] = []

    for card in cards:
        if not card.enabled:
            continue

        prog = _get_progress(card, progress_map)
        w = _resolve_weight(card, overrides)
        unit = card.unit if card.unit else ""

        if prog is None or prog.cold_attempts == 0:
            # new card
            new_items.append((w, unit, card.card_id))
        elif is_due(prog, now):
            # review card (only if due)
            review_items.append((w, unit, card.card_id))
        # studied card that is not due: skip

    # Sort each group: weight DESC, tie-break card_id ASC
    # Input to interleaving must be deterministically sorted
    review_items.sort(key=lambda x: (-x[0], x[2]))
    new_items.sort(key=lambda x: (-x[0], x[2]))

    # Apply limits
    if opts.review_limit is not None:
        review_items = review_items[: opts.review_limit]
    if opts.new_card_limit is not None:
        new_items = new_items[: opts.new_card_limit]

    # Interleave (unit round-robin) within each group
    review_ids = _interleave_by_unit(review_items)
    new_ids = _interleave_by_unit(new_items)

    return review_ids + new_ids


def _build_dday_queue(
    cards: list[CardDef],
    progress_map: dict[str, CardProgress],
    now: int,
    opts: QueueOptions,
    overrides: dict[str, int] | None,
) -> list[str]:
    """Build the queue for D-day mode (engine-contract §2.3).

    Summon all boxes plus new cards. Sort: box ASC, weight DESC, unit round-robin, card_id ASC.
    due is ignored. Limits are applied after sorting.
    """
    # D-day sort key: (box, weight_neg, unit, card_id)
    # box ASC so box is used as-is; weight DESC so negate weight
    all_items: list[tuple[int, int, str, str]] = []

    for card in cards:
        if not card.enabled:
            continue

        prog = _get_progress(card, progress_map)
        w = _resolve_weight(card, overrides)
        unit = card.unit if card.unit else ""

        if prog is None or prog.cold_attempts == 0:
            box = 1  # new card: default box is BOX_MIN
        else:
            box = prog.box

        all_items.append((box, w, unit, card.card_id))

    # Primary sort: box ASC, weight DESC, card_id ASC
    all_items.sort(key=lambda x: (x[0], -x[1], x[3]))

    # Apply limits separately for new and review, then merge.
    # D-day also respects QueueOptions.new_card_limit / review_limit (engine-contract §2.3).
    # "Truncate each group after sorting" requires separating new from review.
    new_items_dday: list[tuple[int, int, str, str]] = []
    review_items_dday: list[tuple[int, int, str, str]] = []

    for item in all_items:
        box, w, unit, cid = item
        prog = progress_map.get(cid)
        if prog is None or prog.cold_attempts == 0:
            new_items_dday.append(item)
        else:
            review_items_dday.append(item)

    if opts.review_limit is not None:
        review_items_dday = review_items_dday[: opts.review_limit]
    if opts.new_card_limit is not None:
        new_items_dday = new_items_dday[: opts.new_card_limit]

    # Merge and re-sort with D-day order: box ASC, weight DESC, card_id ASC
    combined = review_items_dday + new_items_dday
    combined.sort(key=lambda x: (x[0], -x[1], x[3]))

    # Interleave: unit round-robin is applied in D-day mode too (engine-contract §2.3).
    # Round-robin is done within (box, weight) groups.
    # Processing order: box group -> weight group -> unit round-robin.
    # _interleave_by_unit expects (weight, unit, card_id) tuples, so
    # convert to a D-day-compatible (box_weight_combined, unit, card_id) form.
    # The weight-group concept must be preserved inside interleaving.
    # D-day sort priority: box ASC -> weight DESC -> unit round-robin -> card_id ASC.
    # Achieve this by grouping on the (box, -weight) composite key before round-robin.

    return _interleave_dday(combined)


def _interleave_dday(
    items: list[tuple[int, int, str, str]],
) -> list[str]:
    """D-day mode interleaving. Unit round-robin within box ASC, weight DESC groups.

    items: (box, weight, unit, card_id). Already sorted (box ASC, weight DESC, card_id ASC).
    """
    from collections import OrderedDict

    result: list[str] = []

    # Split into (box, weight) groups
    groups: list[list[tuple[int, int, str, str]]] = []
    cur_key: tuple[int, int] | None = None
    cur_group: list[tuple[int, int, str, str]] = []

    for item in items:
        key = (item[0], item[1])
        if key != cur_key:
            if cur_group:
                groups.append(cur_group)
            cur_group = [item]
            cur_key = key
        else:
            cur_group.append(item)
    if cur_group:
        groups.append(cur_group)

    for group in groups:
        # Unit round-robin
        unit_order: list[str] = []
        unit_cards: dict[str, list[str]] = OrderedDict()
        for _, _, unit, cid in group:
            if unit not in unit_cards:
                unit_order.append(unit)
                unit_cards[unit] = []
            unit_cards[unit].append(cid)

        while any(unit_cards[u] for u in unit_order):
            for u in unit_order:
                if unit_cards[u]:
                    result.append(unit_cards[u].pop(0))

    return result
