# -*- coding: utf-8 -*-
"""마이그레이션 — 엔진계약 §4.

migrate(raw: dict) -> ProgressStore    -- v0~vN -> 최신 버전 단조 체인, 순수
new_card_progress(card_id) -> CardProgress  -- 신규 카드 기본값 생성, 순수

파일 I/O 없음. 외부 호출 없음. 부수효과 없음.

v0 = schema_version 필드 부재(v4 레거시). 필드명은 v4도 snake_case라 near-identity.
v0 -> v1: schema_version 주입 + 누락 필드 기본값 채움.
미래 버전은 체인 말미에 _migrate_vN_to_vN1 함수 추가.
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
    """신규 카드 기본값 CardProgress 반환.

    기본값(엔진계약 §4):
        box=BOX_MIN, due_at=0(즉시 due), graduated=False,
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


# ── v0 -> v1 ─────────────────────────────────────────────────────────────────

def _migrate_v0_to_v1(raw: dict) -> dict:
    """v0(schema_version 부재) -> v1.

    near-identity 변환: schema_version 주입 + 각 카드 누락 필드 기본값 채움.
    원본 dict는 변경하지 않고 새 dict를 반환한다(순수).
    """
    out = dict(raw)
    out["schema_version"] = 1

    raw_cards = raw.get("cards", {})
    new_cards: dict[str, dict] = {}

    if isinstance(raw_cards, dict):
        for card_id, card_data in raw_cards.items():
            new_cards[card_id] = _fill_card_defaults(card_id, card_data)
    elif isinstance(raw_cards, list):
        # v4 이전 일부 구조가 리스트일 경우 대비
        for card_data in raw_cards:
            if isinstance(card_data, dict) and "card_id" in card_data:
                cid = card_data["card_id"]
                new_cards[cid] = _fill_card_defaults(cid, card_data)

    out["cards"] = new_cards
    return out


def _fill_card_defaults(card_id: str, data: dict) -> dict:
    """카드 dict의 누락 필드를 기본값으로 채워 반환(새 dict, 원본 불변)."""
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
    # card_id는 키와 동일해야 함(덮어쓰기 방지)
    merged["card_id"] = card_id
    return merged


# ── 체인 진입점 ───────────────────────────────────────────────────────────────

def migrate(raw: dict) -> ProgressStore:
    """버전 정규화 단조 체인. 순수(파일 I/O 없음).

    schema_version 부재 = v0(레거시).
    schema_version > SCHEMA_VERSION -> SchemaVersionError(다운그레이드 보호).
    누락 필드는 기본값으로 채움.

    반환: ProgressStore(schema_version=SCHEMA_VERSION, ...).
    """
    raw_version = raw.get("schema_version")

    if raw_version is None:
        current_version = 0
    else:
        current_version = int(raw_version)

    if current_version > SCHEMA_VERSION:
        raise SchemaVersionError(
            f"저장 스키마 버전({current_version}) > 코드 버전({SCHEMA_VERSION}). "
            "다운그레이드 불가: 더 새로운 버전의 엔진이 필요합니다."
        )

    # 단조 체인: 각 버전 단계를 순서대로 적용
    data = dict(raw)

    if current_version < 1:
        data = _migrate_v0_to_v1(data)
        current_version = 1

    # 미래 버전 단계는 여기에 추가:
    # if current_version < 2:
    #     data = _migrate_v1_to_v2(data)
    #     current_version = 2

    # dict -> ProgressStore 변환
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
    """카드 dict -> CardProgress 변환. 누락 필드는 기본값 사용."""
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
