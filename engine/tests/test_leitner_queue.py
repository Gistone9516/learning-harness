# -*- coding: utf-8 -*-
"""Leitner transition table + selection queue regression tests (engine-contract §7).

pytest style. `now` is injected as a fixed constant. No console output.
"""
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest

from models import (
    BOX_MIN,
    BOX_MAX,
    BOX_INTERVALS_DAYS,
    MS_PER_DAY,
    DDAY_COMPRESS_DAYS,
    CardDef,
    CardProgress,
    AnswerSpec,
    DeckData,
    ProgressStore,
    LeitnerConfig,
    QueueOptions,
)
from leitner import leitner_transition, next_due_at, is_due
from selection import build_queue


# -- shared constants ---------------------------------------------------------

NOW = 1_000_000_000_000  # fixed reference time (epoch ms)


# -- helpers ------------------------------------------------------------------

def make_progress(
    card_id: str = "test-card",
    box: int = BOX_MIN,
    due_at: int = 0,
    graduated: bool = False,
    cold_attempts: int = 0,
    cold_correct: int = 0,
    last_attempt_at: int | None = None,
    last_verdict=None,
) -> CardProgress:
    return CardProgress(
        card_id=card_id,
        box=box,
        due_at=due_at,
        graduated=graduated,
        cold_attempts=cold_attempts,
        cold_correct=cold_correct,
        last_attempt_at=last_attempt_at,
        last_verdict=last_verdict,
    )


def make_card(
    card_id: str,
    weight: int = 5,
    unit: str = "unit-a",
    area: str | None = None,
    subarea: str | None = None,
    enabled: bool = True,
) -> CardDef:
    tags: dict = {"weight": weight}
    if area is not None:
        tags["area"] = area
    if subarea is not None:
        tags["subarea"] = subarea
    return CardDef(
        card_id=card_id,
        schema_version=1,
        subject="test",
        unit=unit,
        type="func",
        grade_mode="exact",
        front={},
        back={},
        answer_spec=None,
        tags=tags,
        links={},
        enabled=enabled,
    )


def make_store(
    namespace: str = "test-deck",
    cards: dict | None = None,
) -> ProgressStore:
    return ProgressStore(
        schema_version=1,
        deck_namespace=namespace,
        cards=cards or {},
    )


# ============================================================================
# 1. Leitner transition table - all rows
# ============================================================================

class TestLeitnerTransitionTable:
    """engine-contract §1.3 transition table full-row validation."""

    # -- cold + correct -------------------------------------------------------

    def test_cold_correct_box1_advances_to_box2(self):
        state = make_progress(box=1)
        result = leitner_transition(state, "cold", "correct", NOW)
        assert result.box == 2
        expected_due = NOW + BOX_INTERVALS_DAYS[2] * MS_PER_DAY
        assert result.due_at == expected_due
        assert result.graduated is False

    def test_cold_correct_box2_advances_to_box3(self):
        state = make_progress(box=2)
        result = leitner_transition(state, "cold", "correct", NOW)
        assert result.box == 3
        expected_due = NOW + BOX_INTERVALS_DAYS[3] * MS_PER_DAY
        assert result.due_at == expected_due
        assert result.graduated is False

    def test_cold_correct_box3_graduates(self):
        """cold correct at BOX_MAX sets graduated=True, keeps box=BOX_MAX, resets due."""
        state = make_progress(box=BOX_MAX)
        result = leitner_transition(state, "cold", "correct", NOW)
        assert result.box == BOX_MAX
        assert result.graduated is True
        expected_due = NOW + BOX_INTERVALS_DAYS[BOX_MAX] * MS_PER_DAY
        assert result.due_at == expected_due

    # -- cold + incorrect -----------------------------------------------------

    def test_cold_incorrect_box2_demotes_to_box1(self):
        state = make_progress(box=2)
        result = leitner_transition(state, "cold", "incorrect", NOW)
        assert result.box == BOX_MIN
        expected_due = NOW + BOX_INTERVALS_DAYS[BOX_MIN] * MS_PER_DAY
        assert result.due_at == expected_due
        assert result.graduated is False

    def test_cold_incorrect_box3_demotes_to_box1(self):
        state = make_progress(box=BOX_MAX)
        result = leitner_transition(state, "cold", "incorrect", NOW)
        assert result.box == BOX_MIN
        assert result.graduated is False

    def test_cold_incorrect_box1_stays_box1(self):
        state = make_progress(box=BOX_MIN)
        result = leitner_transition(state, "cold", "incorrect", NOW)
        assert result.box == BOX_MIN

    # -- warm + correct/incorrect ---------------------------------------------

    def test_warm_correct_no_change(self):
        """warm correct: box/due/graduated unchanged."""
        state = make_progress(box=2, due_at=NOW + 9999, graduated=False)
        result = leitner_transition(state, "warm", "correct", NOW)
        assert result.box == 2
        assert result.due_at == NOW + 9999
        assert result.graduated is False

    def test_warm_incorrect_no_change(self):
        """warm incorrect: box/due/graduated unchanged."""
        state = make_progress(box=2, due_at=NOW + 9999)
        result = leitner_transition(state, "warm", "incorrect", NOW)
        assert result.box == 2
        assert result.due_at == NOW + 9999

    # -- skip -----------------------------------------------------------------

    def test_cold_skip_no_box_change(self):
        """cold skip: box/due unchanged."""
        state = make_progress(box=2, due_at=NOW + 5000)
        result = leitner_transition(state, "cold", "skip", NOW)
        assert result.box == 2
        assert result.due_at == NOW + 5000

    def test_warm_skip_no_box_change(self):
        """warm skip: no change."""
        state = make_progress(box=1, due_at=NOW + 100)
        result = leitner_transition(state, "warm", "skip", NOW)
        assert result.box == 1
        assert result.due_at == NOW + 100


# ============================================================================
# 2. Boundary cases
# ============================================================================

class TestLeitnerBoundary:

    def test_box_min_cold_incorrect_stays_box_min(self):
        """cold incorrect at BOX_MIN stays at BOX_MIN."""
        state = make_progress(box=BOX_MIN)
        result = leitner_transition(state, "cold", "incorrect", NOW)
        assert result.box == BOX_MIN

    def test_box_max_cold_correct_does_not_exceed(self):
        """cold correct at BOX_MAX must not push box above BOX_MAX."""
        state = make_progress(box=BOX_MAX)
        result = leitner_transition(state, "cold", "correct", NOW)
        assert result.box <= BOX_MAX


# ============================================================================
# 3. Graduation and post-graduation transitions
# ============================================================================

class TestGraduation:

    def test_graduation_flag_set_on_box_max_cold_correct(self):
        state = make_progress(box=BOX_MAX, graduated=False)
        result = leitner_transition(state, "cold", "correct", NOW)
        assert result.graduated is True

    def test_not_graduated_when_advancing_to_box_max(self):
        """box2 to box3 promotion is not graduation; graduation requires cold correct at box3."""
        state = make_progress(box=2, graduated=False)
        result = leitner_transition(state, "cold", "correct", NOW)
        assert result.box == BOX_MAX
        assert result.graduated is False

    def test_graduated_cold_correct_keeps_graduated(self):
        """already-graduated card with cold correct stays graduated at BOX_MAX."""
        state = make_progress(box=BOX_MAX, graduated=True)
        result = leitner_transition(state, "cold", "correct", NOW)
        assert result.graduated is True
        assert result.box == BOX_MAX

    def test_graduated_cold_correct_resets_due(self):
        """already-graduated card with cold correct resets due_at."""
        state = make_progress(box=BOX_MAX, graduated=True, due_at=0)
        result = leitner_transition(state, "cold", "correct", NOW)
        expected_due = NOW + BOX_INTERVALS_DAYS[BOX_MAX] * MS_PER_DAY
        assert result.due_at == expected_due

    def test_graduated_cold_incorrect_demotes(self):
        """already-graduated card with cold incorrect demotes to BOX_MIN and clears graduated."""
        state = make_progress(box=BOX_MAX, graduated=True)
        result = leitner_transition(state, "cold", "incorrect", NOW)
        assert result.box == BOX_MIN
        assert result.graduated is False

    def test_graduated_warm_correct_no_change(self):
        """graduated card with warm correct produces no change."""
        state = make_progress(box=BOX_MAX, graduated=True, due_at=NOW + 100)
        result = leitner_transition(state, "warm", "correct", NOW)
        assert result.box == BOX_MAX
        assert result.graduated is True
        assert result.due_at == NOW + 100


# ============================================================================
# 4. cold_attempts / cold_correct accumulation
# ============================================================================

class TestColdAttemptAccumulation:

    def test_cold_correct_increments_both_counters(self):
        state = make_progress(cold_attempts=2, cold_correct=1)
        result = leitner_transition(state, "cold", "correct", NOW)
        assert result.cold_attempts == 3
        assert result.cold_correct == 2

    def test_cold_incorrect_increments_only_attempts(self):
        state = make_progress(cold_attempts=1, cold_correct=0)
        result = leitner_transition(state, "cold", "incorrect", NOW)
        assert result.cold_attempts == 2
        assert result.cold_correct == 0

    def test_cold_skip_increments_only_attempts(self):
        """cold skip: cold_attempts += 1, cold_correct unchanged."""
        state = make_progress(cold_attempts=1, cold_correct=1)
        result = leitner_transition(state, "cold", "skip", NOW)
        assert result.cold_attempts == 2
        assert result.cold_correct == 1

    def test_warm_correct_no_counter_change(self):
        """warm: counters unchanged."""
        state = make_progress(cold_attempts=3, cold_correct=2)
        result = leitner_transition(state, "warm", "correct", NOW)
        assert result.cold_attempts == 3
        assert result.cold_correct == 2

    def test_warm_incorrect_no_counter_change(self):
        state = make_progress(cold_attempts=3, cold_correct=2)
        result = leitner_transition(state, "warm", "incorrect", NOW)
        assert result.cold_attempts == 3
        assert result.cold_correct == 2

    def test_accumulation_sequence(self):
        """sequence accumulation: cold correct x2, cold incorrect x1, warm correct x1."""
        state = make_progress()
        # attempt 1: cold correct
        state = leitner_transition(state, "cold", "correct", NOW)
        assert state.cold_attempts == 1
        assert state.cold_correct == 1
        # attempt 2: warm correct (counters unchanged)
        state = leitner_transition(state, "warm", "correct", NOW + 1000)
        assert state.cold_attempts == 1
        assert state.cold_correct == 1
        # attempt 3: cold incorrect
        state = leitner_transition(state, "cold", "incorrect", NOW + 2000)
        assert state.cold_attempts == 2
        assert state.cold_correct == 1


# ============================================================================
# 5. D-day compression
# ============================================================================

class TestDdayCompression:

    def test_dday_correct_box1_compresses(self):
        """D-day + cold correct + box1 promotion: min(3d, 1d) * MS_PER_DAY."""
        state = make_progress(box=1)
        result = leitner_transition(state, "cold", "correct", NOW, dday_mode=True)
        compress = DDAY_COMPRESS_DAYS
        normal_days = BOX_INTERVALS_DAYS[2]  # after promotion to box2 = 3 days
        expected_days = min(normal_days, compress)
        assert result.due_at == NOW + expected_days * MS_PER_DAY

    def test_dday_correct_box3_compresses(self):
        """D-day + cold correct + BOX_MAX: min(7d, 1d)."""
        state = make_progress(box=BOX_MAX)
        result = leitner_transition(state, "cold", "correct", NOW, dday_mode=True)
        compress = DDAY_COMPRESS_DAYS
        normal_days = BOX_INTERVALS_DAYS[BOX_MAX]
        expected_days = min(normal_days, compress)
        assert result.due_at == NOW + expected_days * MS_PER_DAY

    def test_dday_incorrect_no_compression(self):
        """D-day + cold incorrect: normal demotion rules apply (no compression)."""
        state = make_progress(box=2)
        result = leitner_transition(state, "cold", "incorrect", NOW, dday_mode=True)
        # incorrect uses the BOX_MIN interval as-is
        expected_due = NOW + BOX_INTERVALS_DAYS[BOX_MIN] * MS_PER_DAY
        assert result.due_at == expected_due

    def test_dday_custom_config_compress(self):
        """D-day + LeitnerConfig.dday_compress_days override."""
        cfg = LeitnerConfig(intervals_days={1: 1, 2: 3, 3: 7}, dday_compress_days=2)
        state = make_progress(box=3)
        result = leitner_transition(state, "cold", "correct", NOW, cfg=cfg, dday_mode=True)
        # min(7, 2) = 2
        assert result.due_at == NOW + 2 * MS_PER_DAY

    def test_non_dday_normal_interval(self):
        """dday_mode=False: uses the normal interval."""
        state = make_progress(box=1)
        result = leitner_transition(state, "cold", "correct", NOW, dday_mode=False)
        assert result.due_at == NOW + BOX_INTERVALS_DAYS[2] * MS_PER_DAY


# ============================================================================
# 6. next_due_at / is_due
# ============================================================================

class TestNextDueAtIsDue:

    def test_next_due_at_box1(self):
        assert next_due_at(1, NOW) == NOW + 1 * MS_PER_DAY

    def test_next_due_at_box2(self):
        assert next_due_at(2, NOW) == NOW + 3 * MS_PER_DAY

    def test_next_due_at_box3(self):
        assert next_due_at(3, NOW) == NOW + 7 * MS_PER_DAY

    def test_next_due_at_with_custom_cfg(self):
        cfg = LeitnerConfig(intervals_days={1: 2, 2: 5, 3: 14}, dday_compress_days=1)
        assert next_due_at(1, NOW, cfg=cfg) == NOW + 2 * MS_PER_DAY
        assert next_due_at(2, NOW, cfg=cfg) == NOW + 5 * MS_PER_DAY

    def test_is_due_boundary_equal(self):
        """now == due_at is considered due (inclusive boundary)."""
        state = make_progress(due_at=NOW)
        assert is_due(state, NOW) is True

    def test_is_due_past(self):
        state = make_progress(due_at=NOW - 1)
        assert is_due(state, NOW) is True

    def test_is_due_future(self):
        state = make_progress(due_at=NOW + 1)
        assert is_due(state, NOW) is False


# ============================================================================
# 7. Immutability - original state must not be mutated
# ============================================================================

class TestImmutability:

    def test_transition_does_not_mutate_original(self):
        state = make_progress(box=1, cold_attempts=0)
        _ = leitner_transition(state, "cold", "correct", NOW)
        assert state.box == 1
        assert state.cold_attempts == 0


# ============================================================================
# 8. build_queue - basic behavior
# ============================================================================

class TestBuildQueueBasic:

    def test_empty_cards_returns_empty(self):
        store = make_store()
        result = build_queue([], store, NOW, QueueOptions(deck_namespace="test"))
        assert result == []

    def test_all_new_cards_included(self):
        cards = [make_card("card-a"), make_card("card-b")]
        store = make_store()
        result = build_queue(cards, store, NOW, QueueOptions(deck_namespace="test"))
        assert set(result) == {"card-a", "card-b"}

    def test_disabled_card_excluded(self):
        cards = [make_card("card-a", enabled=True), make_card("card-b", enabled=False)]
        store = make_store()
        result = build_queue(cards, store, NOW, QueueOptions(deck_namespace="test"))
        assert "card-b" not in result
        assert "card-a" in result

    def test_no_due_review_excluded(self):
        """card with history but not yet due is excluded from the queue."""
        cards = [make_card("card-a")]
        progress_map = {
            "card-a": make_progress(
                card_id="card-a", box=2, cold_attempts=1, due_at=NOW + MS_PER_DAY
            )
        }
        store = make_store(cards=progress_map)
        result = build_queue(cards, store, NOW, QueueOptions(deck_namespace="test"))
        assert result == []


# ============================================================================
# 9. build_queue - due-first
# ============================================================================

class TestDueFirst:

    def test_review_before_new(self):
        """review cards appear before new cards."""
        cards = [make_card("card-new"), make_card("card-review")]
        progress_map = {
            "card-review": make_progress(
                card_id="card-review", box=2, cold_attempts=1, due_at=NOW - 1
            )
        }
        store = make_store(cards=progress_map)
        result = build_queue(cards, store, NOW, QueueOptions(deck_namespace="test"))
        assert result.index("card-review") < result.index("card-new")

    def test_multiple_reviews_before_all_new(self):
        cards = [make_card(f"card-{i}") for i in range(4)]
        progress_map = {
            "card-0": make_progress(card_id="card-0", box=1, cold_attempts=1, due_at=NOW),
            "card-1": make_progress(card_id="card-1", box=2, cold_attempts=1, due_at=NOW),
        }
        store = make_store(cards=progress_map)
        result = build_queue(cards, store, NOW, QueueOptions(deck_namespace="test"))
        review_set = {"card-0", "card-1"}
        new_set = {"card-2", "card-3"}
        review_indices = [result.index(c) for c in review_set]
        new_indices = [result.index(c) for c in new_set]
        assert max(review_indices) < min(new_indices)


# ============================================================================
# 10. build_queue - weight ordering
# ============================================================================

class TestWeightOrdering:

    def test_higher_weight_first_in_new(self):
        cards = [make_card("card-low", weight=2), make_card("card-high", weight=8)]
        store = make_store()
        result = build_queue(cards, store, NOW, QueueOptions(deck_namespace="test"))
        assert result.index("card-high") < result.index("card-low")

    def test_higher_weight_first_in_review(self):
        cards = [make_card("card-low", weight=3), make_card("card-high", weight=9)]
        progress_map = {
            "card-low": make_progress(card_id="card-low", cold_attempts=1, due_at=NOW),
            "card-high": make_progress(card_id="card-high", cold_attempts=1, due_at=NOW),
        }
        store = make_store(cards=progress_map)
        result = build_queue(cards, store, NOW, QueueOptions(deck_namespace="test"))
        assert result.index("card-high") < result.index("card-low")


# ============================================================================
# 11. build_queue - weight_overrides
# ============================================================================

class TestWeightOverrides:

    def test_override_beats_tags_weight(self):
        """override weight replaces tags.weight."""
        cards = [
            make_card("card-a", weight=2),
            make_card("card-b", weight=9),
        ]
        overrides = {"card-a": 10}  # override card-a to a higher weight
        store = make_store()
        opts = QueueOptions(deck_namespace="test", weight_overrides=overrides)
        result = build_queue(cards, store, NOW, opts)
        assert result.index("card-a") < result.index("card-b")

    def test_override_nan_fallback_to_5(self):
        """no override and tags.weight is NaN: falls back to default 5."""
        cards = [
            make_card("card-a", weight=5),
        ]
        # manually replace with nan
        cards[0].tags["weight"] = float("nan")
        store = make_store()
        result = build_queue(cards, store, NOW, QueueOptions(deck_namespace="test"))
        assert "card-a" in result

    def test_weight_clamp_below_1(self):
        """weight < 1 is clamped to 1."""
        cards = [make_card("card-low", weight=5), make_card("card-zero")]
        cards[1].tags["weight"] = 0
        store = make_store()
        result = build_queue(cards, store, NOW, QueueOptions(deck_namespace="test"))
        assert "card-zero" in result

    def test_weight_clamp_above_10(self):
        """weight > 10 is clamped to 10."""
        cards = [make_card("card-a", weight=5)]
        cards[0].tags["weight"] = 99
        store = make_store()
        result = build_queue(cards, store, NOW, QueueOptions(deck_namespace="test"))
        assert "card-a" in result


# ============================================================================
# 12. build_queue - interleaving (unit round-robin)
# ============================================================================

class TestInterleaving:

    def test_interleave_two_units(self):
        """cards from two units alternate (same weight, same group)."""
        cards = [
            make_card("unit-a-1", weight=5, unit="unit-a"),
            make_card("unit-a-2", weight=5, unit="unit-a"),
            make_card("unit-b-1", weight=5, unit="unit-b"),
            make_card("unit-b-2", weight=5, unit="unit-b"),
        ]
        store = make_store()
        result = build_queue(cards, store, NOW, QueueOptions(deck_namespace="test"))
        # first two positions must each come from a different unit
        first_units = set()
        for cid in result[:2]:
            for c in cards:
                if c.card_id == cid:
                    first_units.add(c.unit)
        assert len(first_units) == 2

    def test_interleave_does_not_break_weight_priority(self):
        """interleaving must not violate weight-descending priority."""
        cards = [
            make_card("high-a", weight=9, unit="unit-a"),
            make_card("high-b", weight=9, unit="unit-b"),
            make_card("low-a", weight=2, unit="unit-a"),
            make_card("low-b", weight=2, unit="unit-b"),
        ]
        store = make_store()
        result = build_queue(cards, store, NOW, QueueOptions(deck_namespace="test"))
        # the two weight=9 cards must appear before both weight=2 cards
        high_ids = {"high-a", "high-b"}
        low_ids = {"low-a", "low-b"}
        high_indices = [result.index(c) for c in high_ids]
        low_indices = [result.index(c) for c in low_ids]
        assert max(high_indices) < min(low_indices)


# ============================================================================
# 13. build_queue - tie-break
# ============================================================================

class TestTieBreak:

    def test_same_weight_sorted_by_card_id_asc(self):
        """equal weight: sorted by card_id ascending."""
        cards = [
            make_card("card-z", weight=5, unit="unit-a"),
            make_card("card-a", weight=5, unit="unit-a"),
            make_card("card-m", weight=5, unit="unit-a"),
        ]
        store = make_store()
        result = build_queue(cards, store, NOW, QueueOptions(deck_namespace="test"))
        assert result == ["card-a", "card-m", "card-z"]

    def test_deterministic_same_input(self):
        """same input always produces the same output (deterministic)."""
        cards = [make_card(f"card-{i:02}", weight=5) for i in range(5)]
        store = make_store()
        opts = QueueOptions(deck_namespace="test")
        r1 = build_queue(cards, store, NOW, opts)
        r2 = build_queue(cards, store, NOW, opts)
        assert r1 == r2


# ============================================================================
# 14. build_queue - empty queue cases
# ============================================================================

class TestEmptyQueue:

    def test_all_not_due_returns_empty(self):
        cards = [make_card("card-a")]
        progress_map = {
            "card-a": make_progress(
                card_id="card-a", box=1, cold_attempts=1, due_at=NOW + 1000
            )
        }
        store = make_store(cards=progress_map)
        result = build_queue(cards, store, NOW, QueueOptions(deck_namespace="test"))
        assert result == []

    def test_no_enabled_cards_returns_empty(self):
        cards = [make_card("card-a", enabled=False)]
        store = make_store()
        result = build_queue(cards, store, NOW, QueueOptions(deck_namespace="test"))
        assert result == []


# ============================================================================
# 15. build_queue - orphan and new progress
# ============================================================================

class TestOrphanAndNew:

    def test_orphan_progress_excluded_from_queue(self):
        """orphan progress (no matching card) is excluded from the queue."""
        cards = [make_card("card-a")]
        progress_map = {
            "card-a": make_progress(card_id="card-a", cold_attempts=1, due_at=NOW),
            "orphan-card": make_progress(card_id="orphan-card", cold_attempts=1, due_at=NOW),
        }
        store = make_store(cards=progress_map)
        result = build_queue(cards, store, NOW, QueueOptions(deck_namespace="test"))
        assert "orphan-card" not in result

    def test_new_card_no_progress_included(self):
        """card with no progress record is included as new."""
        cards = [make_card("card-new")]
        store = make_store(cards={})
        result = build_queue(cards, store, NOW, QueueOptions(deck_namespace="test"))
        assert "card-new" in result

    def test_graduated_card_due_included_as_review(self):
        """graduated card that is due is included as a review."""
        cards = [make_card("card-a")]
        progress_map = {
            "card-a": make_progress(
                card_id="card-a", box=BOX_MAX, graduated=True,
                cold_attempts=1, due_at=NOW
            )
        }
        store = make_store(cards=progress_map)
        result = build_queue(cards, store, NOW, QueueOptions(deck_namespace="test"))
        assert "card-a" in result

    def test_graduated_card_not_due_excluded(self):
        """graduated card that is not yet due is excluded."""
        cards = [make_card("card-a")]
        progress_map = {
            "card-a": make_progress(
                card_id="card-a", box=BOX_MAX, graduated=True,
                cold_attempts=1, due_at=NOW + 1000
            )
        }
        store = make_store(cards=progress_map)
        result = build_queue(cards, store, NOW, QueueOptions(deck_namespace="test"))
        assert result == []


# ============================================================================
# 16. build_queue - limit
# ============================================================================

class TestQueueLimit:

    def test_new_card_limit(self):
        cards = [make_card(f"card-{i:02}") for i in range(5)]
        store = make_store()
        opts = QueueOptions(deck_namespace="test", new_card_limit=2)
        result = build_queue(cards, store, NOW, opts)
        assert len(result) == 2

    def test_review_limit(self):
        cards = [make_card(f"card-{i:02}") for i in range(4)]
        progress_map = {
            c.card_id: make_progress(card_id=c.card_id, cold_attempts=1, due_at=NOW)
            for c in cards
        }
        store = make_store(cards=progress_map)
        opts = QueueOptions(deck_namespace="test", review_limit=2)
        result = build_queue(cards, store, NOW, opts)
        assert len(result) == 2

    def test_review_and_new_limit_independent(self):
        """review_limit and new_card_limit are applied independently."""
        review_cards = [make_card(f"rev-{i:02}") for i in range(4)]
        new_cards = [make_card(f"new-{i:02}") for i in range(4)]
        cards = review_cards + new_cards
        progress_map = {
            c.card_id: make_progress(card_id=c.card_id, cold_attempts=1, due_at=NOW)
            for c in review_cards
        }
        store = make_store(cards=progress_map)
        opts = QueueOptions(deck_namespace="test", review_limit=2, new_card_limit=3)
        result = build_queue(cards, store, NOW, opts)
        review_in_result = [r for r in result if r.startswith("rev-")]
        new_in_result = [r for r in result if r.startswith("new-")]
        assert len(review_in_result) == 2
        assert len(new_in_result) == 3

    def test_limit_none_means_unlimited(self):
        """limit=None includes all cards."""
        cards = [make_card(f"card-{i:02}") for i in range(10)]
        store = make_store()
        opts = QueueOptions(deck_namespace="test", new_card_limit=None)
        result = build_queue(cards, store, NOW, opts)
        assert len(result) == 10


# ============================================================================
# 17. build_queue - D-day mode
# ============================================================================

class TestDdayQueue:

    def test_dday_includes_all_boxes(self):
        """D-day: ignores due date, pulls all boxes plus new cards."""
        cards = [
            make_card("card-b1"),
            make_card("card-b2"),
            make_card("card-new"),
        ]
        progress_map = {
            "card-b1": make_progress(card_id="card-b1", box=1, cold_attempts=1, due_at=NOW + 9999),
            "card-b2": make_progress(card_id="card-b2", box=2, cold_attempts=1, due_at=NOW + 9999),
        }
        store = make_store(cards=progress_map)
        opts = QueueOptions(deck_namespace="test", dday_mode=True)
        result = build_queue(cards, store, NOW, opts)
        assert set(result) == {"card-b1", "card-b2", "card-new"}

    def test_dday_sort_box_asc(self):
        """D-day: sorted by box ascending (lowest box first)."""
        cards = [
            make_card("card-b3", weight=5, unit="unit-x"),
            make_card("card-b1", weight=5, unit="unit-x"),
            make_card("card-b2", weight=5, unit="unit-x"),
        ]
        progress_map = {
            "card-b3": make_progress(card_id="card-b3", box=3, cold_attempts=1, due_at=NOW + 1),
            "card-b1": make_progress(card_id="card-b1", box=1, cold_attempts=1, due_at=NOW + 1),
            "card-b2": make_progress(card_id="card-b2", box=2, cold_attempts=1, due_at=NOW + 1),
        }
        store = make_store(cards=progress_map)
        opts = QueueOptions(deck_namespace="test", dday_mode=True)
        result = build_queue(cards, store, NOW, opts)
        assert result.index("card-b1") < result.index("card-b2")
        assert result.index("card-b2") < result.index("card-b3")

    def test_dday_same_box_weight_desc(self):
        """D-day: within the same box, sorted by weight descending."""
        cards = [
            make_card("card-low", weight=2, unit="unit-x"),
            make_card("card-high", weight=8, unit="unit-x"),
        ]
        progress_map = {
            "card-low": make_progress(card_id="card-low", box=1, cold_attempts=1, due_at=NOW + 1),
            "card-high": make_progress(card_id="card-high", box=1, cold_attempts=1, due_at=NOW + 1),
        }
        store = make_store(cards=progress_map)
        opts = QueueOptions(deck_namespace="test", dday_mode=True)
        result = build_queue(cards, store, NOW, opts)
        assert result.index("card-high") < result.index("card-low")

    def test_dday_new_card_included(self):
        """D-day: cards with cold_attempts==0 (new) are also included."""
        cards = [make_card("card-new")]
        store = make_store()
        opts = QueueOptions(deck_namespace="test", dday_mode=True)
        result = build_queue(cards, store, NOW, opts)
        assert "card-new" in result

    def test_dday_limit_applies(self):
        """limits are enforced in D-day mode as well."""
        cards = [make_card(f"card-{i:02}", unit="unit-x") for i in range(6)]
        progress_map = {
            c.card_id: make_progress(card_id=c.card_id, box=1, cold_attempts=1, due_at=NOW + 1)
            for c in cards[:4]
        }
        store = make_store(cards=progress_map)
        opts = QueueOptions(deck_namespace="test", dday_mode=True, review_limit=2, new_card_limit=1)
        result = build_queue(cards, store, NOW, opts)
        assert len(result) == 3

    def test_dday_tiebreak_card_id_asc(self):
        """D-day: same box + same weight breaks ties by card_id ascending."""
        cards = [
            make_card("card-z", weight=5, unit="unit-x"),
            make_card("card-a", weight=5, unit="unit-x"),
        ]
        progress_map = {
            "card-z": make_progress(card_id="card-z", box=1, cold_attempts=1, due_at=NOW + 1),
            "card-a": make_progress(card_id="card-a", box=1, cold_attempts=1, due_at=NOW + 1),
        }
        store = make_store(cards=progress_map)
        opts = QueueOptions(deck_namespace="test", dday_mode=True)
        result = build_queue(cards, store, NOW, opts)
        assert result.index("card-a") < result.index("card-z")
