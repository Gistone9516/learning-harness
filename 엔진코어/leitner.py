# -*- coding: utf-8 -*-
"""Leitner 코어 (엔진계약 §1).

순수 함수만 포함한다. 파일 I/O, 난수, 현재시각 호출 없음.
now는 호출자가 주입한다(결정성 보장).
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


# ── 내부 헬퍼 ────────────────────────────────────────────────────────

def _intervals(cfg: LeitnerConfig | None) -> dict[int, int]:
    """주입 config가 있으면 그 intervals_days, 없으면 전역 기본값."""
    if cfg is not None:
        return cfg.intervals_days
    return BOX_INTERVALS_DAYS


def _dday_compress(cfg: LeitnerConfig | None) -> int:
    """D-day 압축 상한일. config 우선, 없으면 전역 기본."""
    if cfg is not None:
        return cfg.dday_compress_days
    return DDAY_COMPRESS_DAYS


# ── 공개 API ─────────────────────────────────────────────────────────

def next_due_at(box: int, now: int, cfg: LeitnerConfig | None = None) -> int:
    """해당 box의 간격으로 다음 due_at(epoch ms)을 계산한다.

    box에 해당하는 interval_days(일수)를 MS_PER_DAY로 변환해 now에 더한다.
    box가 intervals 맵에 없으면 BOX_MIN 간격을 쓴다(방어적 폴백).
    """
    intervals = _intervals(cfg)
    days = intervals.get(box, intervals.get(BOX_MIN, 1))
    return now + days * MS_PER_DAY


def is_due(state: CardProgress, now: int) -> bool:
    """now >= state.due_at이면 due(경계 포함)."""
    return now >= state.due_at


def leitner_transition(
    state: CardProgress,
    attempt_kind: str,
    verdict: str,
    now: int,
    cfg: LeitnerConfig | None = None,
    dday_mode: bool = False,
) -> CardProgress:
    """Leitner 전이표를 적용해 새 CardProgress를 반환한다(불변 복사).

    전이표 (엔진계약 §1.3):
      cold + correct   -> box = min(box+1, BOX_MAX), due 재설정, 졸업 판정
      cold + incorrect -> box = BOX_MIN, due 재설정(BOX_MIN 간격), graduated=False
      warm + any       -> 변화 없음
      any  + skip      -> 변화 없음
    누적:
      cold attempt      -> cold_attempts += 1 (verdict 무관)
      cold + correct    -> cold_correct += 1
    D-day 압축(정답, dday_mode=True):
      due_at = now + min(원래 간격, dday_compress_days) * MS_PER_DAY
    졸업 카드 재전이:
      already graduated + cold + correct -> box=BOX_MAX 유지, due 재설정, graduated 유지
      already graduated + cold + incorrect -> 일반 강등(graduated=False)
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

    # cold 시도 누적 (skip 포함)
    if is_cold:
        new_cold_attempts += 1

    if is_skip:
        # skip: box/due/graduated 변화 없음, cold_correct 미증가
        pass
    elif is_cold and is_correct:
        # cold 정답 - 승급 또는 졸업
        intervals = _intervals(cfg)
        if fields["box"] == BOX_MAX:
            # 이미 BOX_MAX였고 cold 정답 -> 졸업(혹은 졸업 유지)
            new_graduated = True
            # box는 BOX_MAX 유지, due 재설정
            raw_days = intervals.get(BOX_MAX, BOX_INTERVALS_DAYS[BOX_MAX])
            if dday_mode:
                compress = _dday_compress(cfg)
                days = min(raw_days, compress)
            else:
                days = raw_days
            new_due_at = now + days * MS_PER_DAY
        else:
            # 승급
            new_box = min(fields["box"] + 1, BOX_MAX)
            raw_days = intervals.get(new_box, BOX_INTERVALS_DAYS.get(new_box, 1))
            if dday_mode:
                compress = _dday_compress(cfg)
                days = min(raw_days, compress)
            else:
                days = raw_days
            new_due_at = now + days * MS_PER_DAY
            # BOX_MAX로 승급한 것이지 BOX_MAX에서 재전이한 것이 아니므로 graduated는 False
            new_graduated = False
        new_cold_correct += 1
    elif is_cold and is_incorrect:
        # cold 오답 - 강등
        new_box = BOX_MIN
        intervals = _intervals(cfg)
        raw_days = intervals.get(BOX_MIN, BOX_INTERVALS_DAYS[BOX_MIN])
        new_due_at = now + raw_days * MS_PER_DAY
        new_graduated = False
    # warm correct/incorrect: 변화 없음 (이미 필드 복사됨)

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
