# -*- coding: utf-8 -*-
"""세션 상태 및 루프 (봇계약 §4).

세션 상태(seen_card_ids, queue, requeue, idx)는 메모리에만 존재(휘발).
봇 재시작 후 seen 초기화 -> 클릭은 cold 처리됨(봇계약 §7, SoT §2 정합).

discord import 금지 - 헤드리스 테스트 대상.
핸들러 비종속: 주입된 handler(ctx, card) -> HandlerResult 호출.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Awaitable

import _paths
_paths.setup()

from models import (
    CardDef, CardProgress, ProgressStore,
    QueueOptions, HandlerResult,
    BOX_MIN,
)
from leitner import leitner_transition
from selection import build_queue
import persist as _persist

log = logging.getLogger(__name__)


@dataclass
class SessionStats:
    """세션 종료 요약용 통계."""
    total_attempts: int = 0
    correct: int = 0
    incorrect: int = 0
    skipped: int = 0
    box_advances: int = 0
    box_demotions: int = 0


@dataclass
class Session:
    """세션 상태 컨테이너 (봇계약 §4 세션 상태).

    queue: 남은 카드 id 목록.
    requeue: 오답 재큐 목록.
    seen_card_ids: 이번 세션에 제시된 카드 id 집합(warm/cold 판정용).
    stats: 누적 통계.
    active: 세션 진행 중 여부.
    """
    queue: list[str] = field(default_factory=list)
    requeue: list[str] = field(default_factory=list)
    seen_card_ids: set[str] = field(default_factory=set)
    stats: SessionStats = field(default_factory=SessionStats)
    active: bool = False

    def next_card_id(self) -> str | None:
        """requeue 먼저 소진 후 queue에서 반환. 없으면 None."""
        if self.requeue:
            return self.requeue.pop(0)
        if self.queue:
            return self.queue.pop(0)
        return None

    def is_exhausted(self) -> bool:
        return not self.queue and not self.requeue


async def run_session(
    ctx: Any,
    deck_cards: list[CardDef],
    store: ProgressStore,
    mount: str,
    opts: QueueOptions,
    handler: Callable[[Any, CardDef], Awaitable[HandlerResult]],
    on_finish: Callable[[Any, "Session"], Awaitable[None]] | None = None,
    now_fn: Callable[[], int] | None = None,
) -> Session:
    """세션 루프 (봇계약 §4 전 루프 계약).

    1. build_queue -> queue 구성
    2. 카드 제시 직전 attempt_kind 판정 + seen_card_ids.add
    3. 핸들러 호출 -> HandlerResult
    4. emit(leitner_transition + persist save)
    5. requeue(오답이면 재큐에 추가)
    6. 소진 -> on_finish 콜백

    now_fn: 테스트에서 시각 주입용(None이면 실시간).
    """
    if now_fn is None:
        def now_fn():
            return int(time.time() * 1000)

    session = ctx.session
    session.active = True

    # 1. build_queue
    queue_ids = build_queue(deck_cards, store, now_fn(), opts)
    session.queue = list(queue_ids)
    session.requeue = []

    # emit 팩토리: attempt_kind를 미리 캡처해 per-iteration emit 생성 (봇계약 §4)
    def _make_emit(captured_attempt_kind: str):
        async def emit(card_id: str, verdict: str, now: int) -> None:
            if verdict == "skip":
                # skip은 전이 없음(봇계약 §4)
                return

            prog = store.cards.get(card_id)
            if prog is None:
                prog = CardProgress(
                    card_id=card_id, box=BOX_MIN, due_at=0,
                    graduated=False, cold_attempts=0, cold_correct=0,
                    last_attempt_at=None, last_verdict=None,
                )

            # attempt_kind는 seen.add 직전(핸들러 호출 전)에 계산된 값을 캡처해 사용
            attempt_kind = captured_attempt_kind
            dday_mode = opts.dday_mode
            leitner_cfg = ctx.leitner_cfg

            new_prog = leitner_transition(
                prog, attempt_kind, verdict, now,
                cfg=leitner_cfg, dday_mode=dday_mode,
            )
            store.cards[card_id] = new_prog

            # 통계 업데이트
            if attempt_kind == "cold":
                if verdict == "correct":
                    session.stats.correct += 1
                    if new_prog.box > prog.box or new_prog.graduated:
                        session.stats.box_advances += 1
                elif verdict == "incorrect":
                    session.stats.incorrect += 1
                    if new_prog.box < prog.box:
                        session.stats.box_demotions += 1

            _persist.save_progress(mount, store)
        return emit

    # 2~5. 루프
    card_map: dict[str, CardDef] = {c.card_id: c for c in deck_cards}

    while not session.is_exhausted():
        card_id = session.next_card_id()
        if card_id is None:
            break

        card = card_map.get(card_id)
        if card is None or not card.enabled:
            continue

        # 제시 직전 분류 + seen 등록 (봇계약 §4.2)
        attempt_kind = "warm" if card_id in session.seen_card_ids else "cold"
        session.seen_card_ids.add(card_id)
        # ctx.emit을 이번 카드의 attempt_kind를 캡처한 클로저로 교체
        ctx.emit = _make_emit(attempt_kind)

        now = now_fn()

        # 3. 핸들러 호출
        try:
            result: HandlerResult = await handler(ctx, card)
        except Exception as e:
            log.error("핸들러 오류(card_id=%s): %s", card_id, e)
            # 오류 카드는 skip 처리
            result = HandlerResult(card_id=card_id, verdict="skip", done=True)

        # 통계: 총 시도
        session.stats.total_attempts += 1
        if result.verdict == "skip":
            session.stats.skipped += 1

        # 4. 전이+저장 (verdict가 있는 경우)
        if result.verdict is not None:
            await ctx.emit(card_id, result.verdict, now_fn())

        # 5. 재큐 (봇계약 §4.5)
        if result.requeue:
            session.requeue.append(card_id)

    session.active = False

    # 6. 종료 콜백
    if on_finish is not None:
        try:
            await on_finish(ctx, session)
        except Exception as e:
            log.error("on_finish 오류: %s", e)

    return session
