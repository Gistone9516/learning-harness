# -*- coding: utf-8 -*-
"""출제큐 (엔진계약 §2).

순수 함수. 파일 I/O, 난수, 현재시각 호출 없음.
now는 호출자가 주입한다(결정성 보장).
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


# ── weight 정상화 ─────────────────────────────────────────────────────

def _resolve_weight(
    card: CardDef,
    overrides: dict[str, int] | None,
) -> int:
    """카드의 실효 weight를 반환한다.

    우선순위: weight_overrides[card_id] > CardDef.tags.weight > 기본값 5.
    정상화 규칙(엔진계약 §2.2, v4규격 §2.3):
      - NaN 또는 숫자가 아닌 값 -> 5
      - 범위 밖이거나 비정수 -> [1, 10] 클램프
    """
    raw: Any = None

    if overrides is not None and card.card_id in overrides:
        raw = overrides[card.card_id]
    else:
        raw = card.tags.get("weight", 5) if isinstance(card.tags, dict) else 5

    # 숫자가 아닌 경우 기본값 5
    if not isinstance(raw, (int, float)) or (isinstance(raw, float) and math.isnan(raw)):
        return 5

    # 정수로 변환 후 클램프
    val = int(raw)
    if val < 1:
        return 1
    if val > 10:
        return 10
    return val


# ── 소스 분류 ─────────────────────────────────────────────────────────

def _get_progress(
    card: CardDef,
    progress_map: dict[str, CardProgress],
) -> CardProgress | None:
    """card_id에 해당하는 CardProgress를 반환한다. 없으면 None."""
    return progress_map.get(card.card_id)


# ── 인터리빙 라운드로빈 ───────────────────────────────────────────────

def _interleave_by_unit(items: list[tuple[int, str, str]]) -> list[str]:
    """unit 라운드로빈으로 인터리빙해 card_id 리스트를 반환한다.

    items: (weight, unit, card_id) 튜플 리스트. 이미 weight DESC, card_id ASC 정렬됨.
    같은 weight 내에서 단원 라운드로빈을 적용한다.

    구현: weight 그룹별로 묶은 뒤, 각 그룹 안에서 unit 순서로 라운드로빈.
    단원 순서는 해당 weight 그룹에서 처음 등장한 unit 순서를 유지한다.
    """
    # weight 그룹을 순서대로 수집
    from collections import OrderedDict

    result: list[str] = []

    # weight 그룹 분리: 동일 weight 그룹끼리 모으되 순서 보존
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
        # 단원 순서를 첫 등장 순으로 수집
        unit_order: list[str] = []
        unit_cards: dict[str, list[str]] = OrderedDict()
        for _, unit, cid in group:
            if unit not in unit_cards:
                unit_order.append(unit)
                unit_cards[unit] = []
            unit_cards[unit].append(cid)

        # 라운드로빈
        while any(unit_cards[u] for u in unit_order):
            for u in unit_order:
                if unit_cards[u]:
                    result.append(unit_cards[u].pop(0))

    return result


# ── 공개 API ─────────────────────────────────────────────────────────

def build_queue(
    cards: list[CardDef],
    progress: ProgressStore,
    now: int,
    opts: QueueOptions,
) -> list[str]:
    """출제큐를 구성해 card_id 순서 리스트를 반환한다(엔진계약 §2).

    일반 모드:
      - new: cold_attempts == 0 (progress 없는 카드 포함)
      - review: cold_attempts > 0 AND is_due
      - 정렬: review > new, 각 그룹 내 weight DESC, 단원 라운드로빈, tie-break card_id ASC
      - limit: 각 그룹 정렬 후 new_card_limit / review_limit 절단

    D-day 모드(opts.dday_mode==True):
      - 모든 학습이력 카드(전 박스) + new 카드 소환
      - 정렬: box ASC, weight DESC, 단원 라운드로빈, card_id ASC

    고아 progress(cards에 없음)는 큐 제외, 삭제 안 함.
    enabled==False 카드는 큐에 넣지 않는다(엔진계약 §5 집계 규칙 원용).
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
    """일반 모드 큐 구성."""
    new_items: list[tuple[int, str, str]] = []
    review_items: list[tuple[int, str, str]] = []

    for card in cards:
        if not card.enabled:
            continue

        prog = _get_progress(card, progress_map)
        w = _resolve_weight(card, overrides)
        unit = card.unit if card.unit else ""

        if prog is None or prog.cold_attempts == 0:
            # new 카드
            new_items.append((w, unit, card.card_id))
        elif is_due(prog, now):
            # review 카드 (due인 경우만)
            review_items.append((w, unit, card.card_id))
        # due 아닌 학습이력 카드: 제외

    # 각 그룹 정렬: weight DESC, tie-break card_id ASC
    # 인터리빙 전 정렬 기준을 고정해야 라운드로빈 입력이 결정적
    review_items.sort(key=lambda x: (-x[0], x[2]))
    new_items.sort(key=lambda x: (-x[0], x[2]))

    # limit 절단
    if opts.review_limit is not None:
        review_items = review_items[: opts.review_limit]
    if opts.new_card_limit is not None:
        new_items = new_items[: opts.new_card_limit]

    # 인터리빙(단원 라운드로빈): 각 그룹 내부에서 적용
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
    """D-day 모드 큐 구성 (엔진계약 §2.3).

    전 박스 + new 소환. 정렬: box ASC, weight DESC, 단원 라운드로빈, card_id ASC.
    due 무시. limit는 정렬 후 절단.
    """
    # D-day 정렬 항목: (box, weight_neg, unit, card_id)
    # box ASC이므로 box 그대로, weight DESC이므로 -weight
    all_items: list[tuple[int, int, str, str]] = []

    for card in cards:
        if not card.enabled:
            continue

        prog = _get_progress(card, progress_map)
        w = _resolve_weight(card, overrides)
        unit = card.unit if card.unit else ""

        if prog is None or prog.cold_attempts == 0:
            box = 1  # new 카드: box 기본값 BOX_MIN
        else:
            box = prog.box

        all_items.append((box, w, unit, card.card_id))

    # box ASC, weight DESC, card_id ASC 우선 정렬
    all_items.sort(key=lambda x: (x[0], -x[1], x[3]))

    # limit 분리 적용: new와 review를 구분해 각 limit 적용 후 합산
    # D-day에서도 QueueOptions.new_card_limit / review_limit 적용(엔진계약 §2.3)
    # "limit 각 그룹 정렬 후 절단"이므로 new/review를 구분해야 함
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

    # 합산 후 D-day 정렬: box ASC, weight DESC, card_id ASC
    combined = review_items_dday + new_items_dday
    combined.sort(key=lambda x: (x[0], -x[1], x[3]))

    # 인터리빙: D-day에서도 단원 라운드로빈 적용(엔진계약 §2.3)
    # (box, weight) 그룹 내에서 단원 라운드로빈
    # box 그룹 -> weight 그룹 -> 단원 라운드로빈 순으로 처리
    # _interleave_by_unit은 (weight, unit, card_id) 튜플을 받으므로
    # D-day용으로 (box_weight_combined, unit, card_id) 형태로 변환
    # 단, 인터리빙 내부에서 weight 그룹 개념을 살려야 함
    # D-day 정렬 우선순위: box ASC -> weight DESC -> 단원 라운드로빈 -> card_id ASC
    # 이를 위해 (box, -weight) 복합키 그룹 내에서 라운드로빈

    return _interleave_dday(combined)


def _interleave_dday(
    items: list[tuple[int, int, str, str]],
) -> list[str]:
    """D-day 모드 인터리빙. box ASC, weight DESC 그룹 내에서 단원 라운드로빈.

    items: (box, weight, unit, card_id). 이미 (box ASC, weight DESC, card_id ASC) 정렬됨.
    """
    from collections import OrderedDict

    result: list[str] = []

    # (box, weight) 그룹으로 분리
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
        # 단원 라운드로빈
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
