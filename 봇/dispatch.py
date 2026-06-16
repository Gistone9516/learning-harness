# -*- coding: utf-8 -*-
"""라우팅 테이블 + capability_id -> 핸들러 등록 맵 (봇계약 §3).

라우팅 로직(card -> capability_id)은 discord import 금지(헤드리스 테스트 대상).
핸들러 바인딩은 레지스트리 주입으로 지연 — session이 핸들러를 직접 import하지 않음.
"""
from __future__ import annotations

import _paths
_paths.setup()

from typing import Any, Callable, Awaitable
from models import CardDef, HandlerResult

# Handler 타입 별칭 (봇계약 §3)
Handler = Callable[[Any, CardDef], Awaitable[HandlerResult]]

# capability_id -> Handler 등록 맵
# 실행 시 register() 로 채워짐 (discord 의존 모듈이 주입)
HANDLERS: dict[str, Handler] = {}


def register(capability_id: str, handler: Handler) -> None:
    """capability_id에 핸들러를 등록."""
    HANDLERS[capability_id] = handler


def route(card: CardDef, grade_mode_of: Callable[[str], str]) -> str:
    """카드 -> capability_id 라우팅 (봇계약 §3 우선순위 테이블).

    우선순위 (위에서 아래로 첫 매치):
    1. grade_mode == self (모든 type) -> recall_self
    2. type == cloze                 -> cloze_modal
    3. type == recall_seq            -> seq_modal
    4. type == judge, options <= 5   -> mcq_buttons
       type == judge, options > 5    -> mcq_select
    5. type in {func, proc}          -> short_modal
    """
    effective_mode = grade_mode_of(card.card_id)

    # 1. self grade_mode
    if effective_mode == "self":
        return "recall_self"

    ctype = card.type

    # 2. cloze
    if ctype == "cloze":
        return "cloze_modal"

    # 3. recall_seq
    if ctype == "recall_seq":
        return "seq_modal"

    # 4. judge
    if ctype == "judge":
        options = card.front.get("options", [])
        option_count = len(options) if isinstance(options, list) else 0
        if option_count <= 5:
            return "mcq_buttons"
        else:
            return "mcq_select"

    # 5. func / proc
    if ctype in ("func", "proc"):
        return "short_modal"

    # 폴백: recall_self
    return "recall_self"


async def dispatch(ctx: Any, card: CardDef) -> HandlerResult:
    """카드를 라우팅해 등록된 핸들러 호출. 미등록 capability는 recall_self로 폴백."""
    grade_mode_of = ctx.grade_mode_of
    cap_id = route(card, grade_mode_of)

    handler = HANDLERS.get(cap_id)
    if handler is None:
        # 폴백: recall_self
        fallback = HANDLERS.get("recall_self")
        if fallback is None:
            # 핸들러 자체가 없으면 최소 HandlerResult 반환
            return HandlerResult(card_id=card.card_id, verdict="skip", done=True)
        return await fallback(ctx, card)

    return await handler(ctx, card)
