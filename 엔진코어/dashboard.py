# -*- coding: utf-8 -*-
"""대시보드 집계 — 엔진계약 §5.

get_dashboard_data(deck, progress, now, pass_targets) -> DashboardData

순수 함수: 파일 I/O 0, 외부 호출 0, 부수효과 0.
enabled==True 카드만 집계. area/subarea 없는 카드는 by_area·pass_path·completion 제외.
weakness는 unit 기준이므로 area/subarea 둘 다 없을 때만 제외(엔진계약 §5 단서).
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
    """카드 진도 반환. 없으면 미학습 기본값."""
    if card_id in progress.cards:
        return progress.cards[card_id]
    return CardProgress(card_id=card_id)


def get_dashboard_data(
    deck: DeckData,
    progress: ProgressStore,
    now: int,
    pass_targets: dict[str, int] | None = None,
) -> DashboardData:
    """대시보드 집계 순수 함수.

    인자:
        deck: 카드 정의 묶음.
        progress: 현재 진도 스토어.
        now: 기준 시각(epoch ms, 주입).
        pass_targets: {subarea: 목표 점수(0~100 정수)}. 미주입 또는 subarea 키 없으면 pass_path 제외.

    반환:
        DashboardData(by_area, weakness, pass_path, completion).
    """
    enabled_cards = [c for c in deck.cards if c.enabled]

    # 카드별 진도 미리 계산
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
    """(area, subarea) 그룹별 인출률. cold0 -> None. area/subarea 없으면 제외."""
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

    # 결정적 순서 보장: (area, subarea) ASC
    result.sort(key=lambda e: (e.area, e.subarea))
    return result


# ── weakness ─────────────────────────────────────────────────────────────────

def _build_weakness(
    cards: list[CardDef], prog_map: dict[str, CardProgress]
) -> list[WeaknessEntry]:
    """(area, subarea, unit) 그룹별 오답률. cold0 제외. wrong_rate DESC -> unit ASC.

    엔진계약 §5 단서: area/subarea 둘 다 없으면 제외. unit은 포함(unit이 있어도 area/subarea 없으면 제외).
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
            continue  # cold0 제외
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
    """(area, subarea) 그룹별 합격 경로. pass_targets 미주입 또는 subarea 키 없으면 제외.

    coverage = cold>=1 카드 / 전체 카드.
    mastery = cold 시도 카드(covered) 중 정답률>=1(cold_correct>=cold_attempts, cold_attempts>0) 카드 비율.
              분모 = covered(cold_attempts>=1 카드 수), covered 0이면 0. v4 의미.
              그래야 progress = coverage * mastery = mastered / total (전체 중 정복 비율).
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
        # pass_targets에 subarea 키가 없으면 이 그룹은 나중에 걸러냄
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
            # mastery = cold 시도 카드 중 모두 맞힌 카드 비율(분모=covered, v4 의미).
            # 그래야 progress = coverage * mastery = mastered / total (전체 중 정복 비율로 깔끔).
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

    # 결정적 순서: (area, subarea) ASC
    result.sort(key=lambda e: (e.area, e.subarea))
    return result


# ── completion ────────────────────────────────────────────────────────────────

def _build_completion(
    cards: list[CardDef], prog_map: dict[str, CardProgress]
) -> list[CompletionEntry]:
    """(area, subarea) 그룹별 박스 분포·mastery_rate.

    미학습 = box1로 계산. graduated = box3로 계산.
    mastery_rate = box3 수 / 전체 수.
    area/subarea 없으면 제외.
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
        # graduated -> box3으로 집계. 미학습(cold_attempts==0) -> box1.
        # 일반 박스는 p.box 그대로.
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

    # 결정적 순서: (area, subarea) ASC
    result.sort(key=lambda e: (e.area, e.subarea))
    return result
