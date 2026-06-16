# -*- coding: utf-8 -*-
"""Ctx 데이터클래스 (봇계약 §3).

핸들러에 주입되는 세션 컨텍스트. discord import 금지(헤드리스 테스트 대상).
모든 필드는 봇계약 §3 Ctx 정의를 따름.
"""
from __future__ import annotations

import _paths
_paths.setup()

from dataclasses import dataclass, field
from typing import Any, Callable, TYPE_CHECKING

from models import (
    ProgressStore,
    DeckData,
    LeitnerConfig,
    Verdict,
)
from models import Effort

if TYPE_CHECKING:
    pass


@dataclass
class Ctx:
    """핸들러 주입 컨텍스트 (봇계약 §3).

    channel: discord 채널 객체(Any, discord import 회피).
    user_id: 허용된 사용자 Discord ID.
    store: 로드된 ProgressStore.
    deck: 현재 덱 DeckData.
    synonyms: 역인덱스 dict[동의어->대표어] (부트가 컴파일).
    grade_mode_of: card_id -> 실효 ScoreMode (scoring_overrides 반영).
    leitner_cfg: LeitnerConfig 또는 None(기본값 사용).
    ai_model: AI 모델 id 또는 None.
    ai_effort: Effort 리터럴.
    sid: AI 세션 id(멀티턴) 또는 None.
    session: 현재 Session 인스턴스(순환 참조, TYPE_CHECKING 아닌 Any).
    emit: 분류+전이+저장 공통 코루틴.
    """
    channel: Any
    user_id: int
    store: ProgressStore
    deck: DeckData
    synonyms: dict[str, str]
    grade_mode_of: Callable[[str], str]
    leitner_cfg: LeitnerConfig | None
    ai_model: str | None
    ai_effort: Effort
    sid: str | None
    session: Any
    emit: Callable[..., Any]
