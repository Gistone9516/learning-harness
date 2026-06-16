# -*- coding: utf-8 -*-
"""Dashboard aggregation — engine-contract §5.

get_dashboard_data(deck, progress, now, pass_targets) -> DashboardData

Pure function: no file I/O, no external calls, no side effects.
Only enabled==True cards are aggregated. Cards without area/subarea are excluded from by_area, pass_path, and completion.
weakness is unit-scoped, so a card is excluded only when both area and subarea are absent (engine-contract §5 note).
"""
from __future__ import annotations

from collections import defaultdict

from models import (
    BOX_MIN,
    BOX_MAX,
    ByAreaEntry,
    CardDef,
    CardProgress,
    CompletionEntry,
    DashboardData,
    DeckData,
    PassPathEntry,
    ProgressStore,
    WeaknessEntry,
)


def _get_progress(progress: ProgressStore, card_id: str) -> CardProgress:
    """Return progress for a card. Returns default (not-yet-studied) if absent."""
    if card_id in progress.cards:
        return progress.cards[card_id]
    return CardProgress(card_id=card_id)


def get_dashboard_data(
    deck: DeckData,
    progress: ProgressStore,
    now: int,
    pass_targets: dict[str, int] | None = None,
) -> DashboardData:
    """Pure function that aggregates dashboard data.

    Args:
        deck: Card definition bundle.
        progress: Current progress store.
        now: Reference timestamp (epoch ms, injected).
        pass_targets: {subarea: target score (integer 0-100)}. pass_path is omitted if not provided or if the subarea key is missing.

    Returns:
        DashboardData(by_area, weakness, pass_path, completion).
    """
    enabled_cards = [c for c in deck.cards if c.enabled]

    # Pre-compute progress for each card.
    prog_map: dict[str, CardProgress] = {
        c.card_id: _get_progress(progress, c.card_id) for c in enabled_cards
    }

    by_area_data = _build_by_area(enabled_cards, prog_map)
    weakness_data = _build_weakness(enabled_cards, prog_map)
    pass_path_data = _build_pass_path(enabled_cards, prog_map, pass_targets)
    completion_data = _build_completion(enabled_cards, prog_map)

    return DashboardData(
        by_area=by_area_data,
        weakness=weakness_data,
        pass_path=pass_path_data,
        completion=completion_data,
    )


# ── by_area ──────────────────────────────────────────────────────────────────

def _build_by_area(
    cards: list[CardDef], prog_map: dict[str, CardProgress]
) -> list[ByAreaEntry]:
    """Retrieval rate per (area, subarea) group. cold0 -> None. Cards without area/subarea are excluded."""
    # {(area, subarea): [cold_attempts, cold_correct]}
    buckets: dict[tuple[str, str], list[int]] = defaultdict(lambda: [0, 0])

    for card in cards:
        area = card.tags.get("area")
        subarea = card.tags.get("subarea")
        if not area or not subarea:
            continue
        p = prog_map[card.card_id]
        key = (area, subarea)
        buckets[key][0] += p.cold_attempts
        buckets[key][1] += p.cold_correct

    result: list[ByAreaEntry] = []
    for (area, subarea), (attempts, correct) in buckets.items():
        if attempts == 0:
            rate = None
        else:
            rate = correct / attempts
        result.append(ByAreaEntry(area=area, subarea=subarea, retrieval_rate=rate))

    # Deterministic ordering: (area, subarea) ASC.
    result.sort(key=lambda e: (e.area, e.subarea))
    return result


# ── weakness ─────────────────────────────────────────────────────────────────

def _build_weakness(
    cards: list[CardDef], prog_map: dict[str, CardProgress]
) -> list[WeaknessEntry]:
    """Wrong rate per (area, subarea, unit) group. cold0 excluded. Sorted wrong_rate DESC then unit ASC.

    engine-contract §5 note: excluded when both area and subarea are absent. unit is included,
    but a card with unit and no area/subarea is still excluded.
    """
    # {(area, subarea, unit): [cold_attempts, cold_incorrect]}
    buckets: dict[tuple[str, str, str], list[int]] = defaultdict(lambda: [0, 0])

    for card in cards:
        area = card.tags.get("area")
        subarea = card.tags.get("subarea")
        if not area or not subarea:
            continue
        unit = card.unit
        p = prog_map[card.card_id]
        key = (area, subarea, unit)
        buckets[key][0] += p.cold_attempts
        cold_incorrect = p.cold_attempts - p.cold_correct
        buckets[key][1] += cold_incorrect

    result: list[WeaknessEntry] = []
    for (area, subarea, unit), (attempts, incorrect) in buckets.items():
        if attempts == 0:
            continue  # Exclude cold0 entries.
        wrong_rate = incorrect / attempts
        result.append(
            WeaknessEntry(area=area, subarea=subarea, unit=unit, wrong_rate=wrong_rate)
        )

    # wrong_rate DESC, tie-break unit ASC
    result.sort(key=lambda e: (-e.wrong_rate, e.unit))
    return result


# ── pass_path ─────────────────────────────────────────────────────────────────

def _build_pass_path(
    cards: list[CardDef],
    prog_map: dict[str, CardProgress],
    pass_targets: dict[str, int] | None,
) -> list[PassPathEntry]:
    """Pass path per (area, subarea) group. Omitted if pass_targets is not provided or the subarea key is missing.

    coverage = cards with cold>=1 / total cards.
    mastery = among cold-attempted cards (covered), fraction where correct rate >= 1
              (cold_correct >= cold_attempts, cold_attempts > 0).
              denominator = covered (cards with cold_attempts >= 1); 0 if covered is 0. v4 semantics.
              This ensures progress = coverage * mastery = mastered / total (clean fraction of mastered over total).
    progress = coverage * mastery.
    status: t = target/100. r=progress >= t -> safe, r >= 0.7*t -> watch, else -> danger.
    """
    if not pass_targets:
        return []

    # {(area, subarea): {total, covered, mastered}}
    buckets: dict[tuple[str, str], dict] = defaultdict(
        lambda: {"total": 0, "covered": 0, "mastered": 0}
    )

    for card in cards:
        area = card.tags.get("area")
        subarea = card.tags.get("subarea")
        if not area or not subarea:
            continue
        # Groups whose subarea key is absent from pass_targets are filtered out later.
        key = (area, subarea)
        p = prog_map[card.card_id]
        buckets[key]["total"] += 1
        if p.cold_attempts >= 1:
            buckets[key]["covered"] += 1
        if p.cold_attempts > 0 and p.cold_correct >= p.cold_attempts:
            buckets[key]["mastered"] += 1

    result: list[PassPathEntry] = []
    for (area, subarea), counts in buckets.items():
        if subarea not in pass_targets:
            continue
        target_val = pass_targets[subarea]
        total = counts["total"]
        if total == 0:
            coverage = 0.0
            mastery = 0.0
        else:
            coverage = counts["covered"] / total
            # mastery = fraction of cold-attempted cards that were answered fully correctly
            # (denominator = covered, v4 semantics).
            # This keeps progress = coverage * mastery = mastered / total (clean overall mastery ratio).
            mastery = counts["mastered"] / counts["covered"] if counts["covered"] > 0 else 0.0
        prog_val = coverage * mastery
        t = target_val / 100.0
        if t == 0:
            status = "safe"
        elif prog_val >= t:
            status = "safe"
        elif prog_val >= 0.7 * t:
            status = "watch"
        else:
            status = "danger"
        result.append(
            PassPathEntry(
                area=area,
                subarea=subarea,
                target=target_val,
                coverage=coverage,
                mastery=mastery,
                progress=prog_val,
                status=status,
            )
        )

    # Deterministic ordering: (area, subarea) ASC.
    result.sort(key=lambda e: (e.area, e.subarea))
    return result


# ── completion ────────────────────────────────────────────────────────────────

def _build_completion(
    cards: list[CardDef], prog_map: dict[str, CardProgress]
) -> list[CompletionEntry]:
    """Box distribution and mastery_rate per (area, subarea) group.

    Not-yet-studied cards count as box1. Graduated cards count as box3.
    mastery_rate = box3 count / total count.
    Cards without area/subarea are excluded.
    """
    # {(area, subarea): {box1, box2, box3, total}}
    buckets: dict[tuple[str, str], dict] = defaultdict(
        lambda: {"box1": 0, "box2": 0, "box3": 0, "total": 0}
    )

    for card in cards:
        area = card.tags.get("area")
        subarea = card.tags.get("subarea")
        if not area or not subarea:
            continue
        p = prog_map[card.card_id]
        key = (area, subarea)
        buckets[key]["total"] += 1
        # Graduated cards are tallied as box3. Not-yet-studied (cold_attempts==0) cards use p.box directly (box1).
        effective_box = p.box
        box_key = f"box{effective_box}"
        buckets[key][box_key] += 1

    result: list[CompletionEntry] = []
    for (area, subarea), counts in buckets.items():
        total = counts["total"]
        box3_count = counts["box3"]
        mastery_rate = box3_count / total if total > 0 else 0.0
        result.append(
            CompletionEntry(
                area=area,
                subarea=subarea,
                box_dist={
                    "box1": counts["box1"],
                    "box2": counts["box2"],
                    "box3": counts["box3"],
                },
                mastery_rate=mastery_rate,
            )
        )

    # Deterministic ordering: (area, subarea) ASC.
    result.sort(key=lambda e: (e.area, e.subarea))
    return result
