# -*- coding: utf-8 -*-
"""Leitner core (engine-contract §1).

Contains pure functions only. No file I/O, no random, no current-time calls.
now is injected by the caller to guarantee determinism.
"""
from __future__ import annotations

import dataclasses

from models import (
    BOX_MIN,
    BOX_MAX,
    BOX_INTERVALS_DAYS,
    MS_PER_DAY,
    DDAY_COMPRESS_DAYS,
    CardProgress,
    LeitnerConfig,
)


# -- internal helpers ---------------------------------------------------------

def _intervals(cfg: LeitnerConfig | None) -> dict[int, int]:
    """Return injected config intervals_days if present, otherwise the global default."""
    if cfg is not None:
        return cfg.intervals_days
    return BOX_INTERVALS_DAYS


def _dday_compress(cfg: LeitnerConfig | None) -> int:
    """D-day compression ceiling in days. Config takes priority, otherwise global default."""
    if cfg is not None:
        return cfg.dday_compress_days
    return DDAY_COMPRESS_DAYS


# -- public API ---------------------------------------------------------------

def next_due_at(box: int, now: int, cfg: LeitnerConfig | None = None) -> int:
    """Compute the next due_at (epoch ms) using the interval for the given box.

    Converts the interval_days for the box to milliseconds and adds it to now.
    Falls back to BOX_MIN interval if the box is not in the intervals map.
    """
    intervals = _intervals(cfg)
    days = intervals.get(box, intervals.get(BOX_MIN, 1))
    return now + days * MS_PER_DAY


def is_due(state: CardProgress, now: int) -> bool:
    """Return True if now >= state.due_at (boundary inclusive)."""
    return now >= state.due_at


def leitner_transition(
    state: CardProgress,
    attempt_kind: str,
    verdict: str,
    now: int,
    cfg: LeitnerConfig | None = None,
    dday_mode: bool = False,
) -> CardProgress:
    """Apply the Leitner transition table and return a new CardProgress (immutable copy).

    Transition table (engine-contract §1.3):
      cold + correct   -> box = min(box+1, BOX_MAX), reset due, evaluate graduation
      cold + incorrect -> box = BOX_MIN, reset due (BOX_MIN interval), graduated=False
      warm + any       -> no change
      any  + skip      -> no change
    Accumulation:
      cold attempt      -> cold_attempts += 1 (regardless of verdict)
      cold + correct    -> cold_correct += 1
    D-day compression (correct, dday_mode=True):
      due_at = now + min(original interval, dday_compress_days) * MS_PER_DAY
    Graduated card re-transition:
      already graduated + cold + correct -> keep box=BOX_MAX, reset due, keep graduated
      already graduated + cold + incorrect -> normal demotion (graduated=False)
    """
    fields = dataclasses.asdict(state)

    new_box = fields["box"]
    new_due_at = fields["due_at"]
    new_graduated = fields["graduated"]
    new_cold_attempts = fields["cold_attempts"]
    new_cold_correct = fields["cold_correct"]

    is_cold = attempt_kind == "cold"
    is_skip = verdict == "skip"
    is_correct = verdict == "correct"
    is_incorrect = verdict == "incorrect"

    # accumulate cold attempts (including skip)
    if is_cold:
        new_cold_attempts += 1

    if is_skip:
        # skip: no change to box/due/graduated, cold_correct not incremented
        pass
    elif is_cold and is_correct:
        # cold correct: promote or graduate
        intervals = _intervals(cfg)
        if fields["box"] == BOX_MAX:
            # already at BOX_MAX and cold correct -> graduate (or maintain graduation)
            new_graduated = True
            # keep box at BOX_MAX, reset due
            raw_days = intervals.get(BOX_MAX, BOX_INTERVALS_DAYS[BOX_MAX])
            if dday_mode:
                compress = _dday_compress(cfg)
                days = min(raw_days, compress)
            else:
                days = raw_days
            new_due_at = now + days * MS_PER_DAY
        else:
            # promote
            new_box = min(fields["box"] + 1, BOX_MAX)
            raw_days = intervals.get(new_box, BOX_INTERVALS_DAYS.get(new_box, 1))
            if dday_mode:
                compress = _dday_compress(cfg)
                days = min(raw_days, compress)
            else:
                days = raw_days
            new_due_at = now + days * MS_PER_DAY
            # promoted to BOX_MAX for the first time, not a re-transition, so graduated stays False
            new_graduated = False
        new_cold_correct += 1
    elif is_cold and is_incorrect:
        # cold incorrect: demote
        new_box = BOX_MIN
        intervals = _intervals(cfg)
        raw_days = intervals.get(BOX_MIN, BOX_INTERVALS_DAYS[BOX_MIN])
        new_due_at = now + raw_days * MS_PER_DAY
        new_graduated = False
    # warm correct/incorrect: no change (fields already copied)

    return CardProgress(
        card_id=state.card_id,
        box=new_box,
        due_at=new_due_at,
        graduated=new_graduated,
        cold_attempts=new_cold_attempts,
        cold_correct=new_cold_correct,
        last_attempt_at=now,
        last_verdict=verdict,
    )
