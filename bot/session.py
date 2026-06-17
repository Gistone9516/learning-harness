# -*- coding: utf-8 -*-
"""Session state and loop (bot-contract §4).

Session state (seen_card_ids, queue, requeue, idx) lives in memory only (volatile).
After a bot restart seen is cleared, so clicks are treated as cold (bot-contract §7, SoT §2 alignment).

discord import is forbidden - this module is a headless-test target.
Handler-agnostic: calls the injected handler(ctx, card) -> HandlerResult.
"""
from __future__ import annotations

import asyncio
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
    """Per-session summary statistics."""
    total_attempts: int = 0
    correct: int = 0
    incorrect: int = 0
    skipped: int = 0
    box_advances: int = 0
    box_demotions: int = 0


@dataclass
class Session:
    """Session state container (bot-contract §4 session state).

    queue: remaining card id list.
    requeue: incorrect-answer requeue list.
    seen_card_ids: set of card ids presented this session (used for warm/cold classification).
    stats: cumulative statistics.
    active: whether the session is in progress.
    """
    queue: list[str] = field(default_factory=list)
    requeue: list[str] = field(default_factory=list)
    seen_card_ids: set[str] = field(default_factory=set)
    stats: SessionStats = field(default_factory=SessionStats)
    active: bool = False
    claude_sid: str | None = None               # claude CLI session id for this study session (volatile, ai_socratic multi-turn)
    turns: list = field(default_factory=list)   # sliding conversation window [(role, text), ...]; volatile, dies with the session
    stop_event: Any = None                      # asyncio.Event set by the stop-word handler to interrupt the loop mid-card

    def next_card_id(self) -> str | None:
        """Drain requeue first, then pop from queue. Returns None when both are empty."""
        if self.requeue:
            return self.requeue.pop(0)
        if self.queue:
            return self.queue.pop(0)
        return None

    def is_exhausted(self) -> bool:
        return not self.queue and not self.requeue


async def _precard_caps(ctx, card) -> None:
    """Optional pre-card enhancement caps (opt-in via config). No-op headless (channel is None)."""
    caps = getattr(ctx, "enabled_capabilities", set()) or set()
    if "confidence_rate" in caps:
        try:
            from caps.confidence_rate import ask_confidence
            await ask_confidence(ctx, card.card_id)
        except Exception as e:
            log.warning("confidence_rate hook failed: %s", e)
    if "hint_progressive" in caps:
        try:
            from caps.hint_progressive import show_hint
            await show_hint(ctx, card)
        except Exception as e:
            log.warning("hint_progressive hook failed: %s", e)


async def _postcorrect_caps(ctx, card) -> None:
    """Optional post-correct enhancement cap (elaboration). Opt-in via config. No-op headless."""
    caps = getattr(ctx, "enabled_capabilities", set()) or set()
    if "elaborate_ask" in caps:
        try:
            from caps.elaborate_ask import ask_elaboration
            await ask_elaboration(ctx, card)
        except Exception as e:
            log.warning("elaborate_ask hook failed: %s", e)


async def _run_handler_or_stop(handler, ctx, card, session):
    """Run the card handler, returning None immediately if the session's stop_event fires.

    Lets the stop word (중단) interrupt the loop even while the current card is awaiting
    a button/modal response (which a plain text message could not otherwise cancel).
    """
    stop_event = getattr(session, "stop_event", None)
    if stop_event is None:
        return await handler(ctx, card)
    handler_task = asyncio.ensure_future(handler(ctx, card))
    stop_task = asyncio.ensure_future(stop_event.wait())
    await asyncio.wait({handler_task, stop_task}, return_when=asyncio.FIRST_COMPLETED)
    if stop_event.is_set():
        handler_task.cancel()
        try:
            await handler_task
        except BaseException:
            pass
        return None
    stop_task.cancel()
    return handler_task.result()


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
    """Session loop (bot-contract §4 full loop contract).

    1. build_queue -> assemble queue
    2. Determine attempt_kind + seen_card_ids.add immediately before presenting a card
    3. Invoke handler -> HandlerResult
    4. emit (leitner_transition + persist save)
    5. requeue (append to requeue if incorrect)
    6. Exhausted -> on_finish callback

    now_fn: inject a clock in tests (None means real time).
    """
    if now_fn is None:
        def now_fn():
            return int(time.time() * 1000)

    session = ctx.session
    session.active = True
    # Stop signal: the stop-word handler sets this Event to interrupt the loop,
    # even while the current card is awaiting a button/modal response.
    try:
        session.stop_event = asyncio.Event()
    except Exception:
        session.stop_event = None

    # 1. build_queue
    queue_ids = build_queue(deck_cards, store, now_fn(), opts)
    session.queue = list(queue_ids)
    session.requeue = []
    total_cards = len(queue_ids)   # denominator for the session progress indicator
    presented = 0

    # emit factory: capture attempt_kind upfront to create a per-iteration emit closure (bot-contract §4)
    def _make_emit(captured_attempt_kind: str):
        async def emit(card_id: str, verdict: str, now: int) -> None:
            if verdict == "skip":
                # skip produces no transition (bot-contract §4)
                return

            prog = store.cards.get(card_id)
            if prog is None:
                prog = CardProgress(
                    card_id=card_id, box=BOX_MIN, due_at=0,
                    graduated=False, cold_attempts=0, cold_correct=0,
                    last_attempt_at=None, last_verdict=None,
                )

            # attempt_kind is captured before seen.add (before handler invocation)
            attempt_kind = captured_attempt_kind
            dday_mode = opts.dday_mode
            leitner_cfg = ctx.leitner_cfg

            new_prog = leitner_transition(
                prog, attempt_kind, verdict, now,
                cfg=leitner_cfg, dday_mode=dday_mode,
            )
            store.cards[card_id] = new_prog

            # update statistics
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

    # steps 2-5: main loop
    card_map: dict[str, CardDef] = {c.card_id: c for c in deck_cards}

    while not session.is_exhausted():
        if not session.active:
            break
        card_id = session.next_card_id()
        if card_id is None:
            break

        card = card_map.get(card_id)
        if card is None or not card.enabled:
            continue

        # classify and register to seen immediately before presentation (bot-contract §4.2)
        attempt_kind = "warm" if card_id in session.seen_card_ids else "cold"
        session.seen_card_ids.add(card_id)
        # replace ctx.emit with a closure that captures this card's attempt_kind
        ctx.emit = _make_emit(attempt_kind)
        # session progress indicator (presented count vs total; requeued cards can
        # push presented past the initial queue size, so never show a denominator
        # smaller than the numerator)
        presented += 1
        ctx.progress = (presented, max(total_cards, presented))

        # optional pre-card enhancement caps (confidence, hint); opt-in, skipped headless
        if ctx.channel is not None:
            await _precard_caps(ctx, card)

        now = now_fn()

        # 3. invoke handler (interruptible by the stop word)
        try:
            result: HandlerResult | None = await _run_handler_or_stop(handler, ctx, card, session)
        except Exception as e:
            log.error("handler error (card_id=%s): %s", card_id, e)
            # treat errored card as skip
            result = HandlerResult(card_id=card_id, verdict="skip", done=True)
        if result is None or not session.active:
            # stopped mid-card: end the session without recording this card
            break

        # statistics: total attempts
        session.stats.total_attempts += 1
        if result.verdict == "skip":
            session.stats.skipped += 1

        # 4. transition + save (when a verdict is present)
        if result.verdict is not None:
            await ctx.emit(card_id, result.verdict, now_fn())

        # optional post-correct enhancement cap (elaboration); opt-in, skipped headless
        if result.verdict == "correct" and ctx.channel is not None:
            await _postcorrect_caps(ctx, card)

        # 5. requeue (bot-contract §4.5)
        if result.requeue:
            session.requeue.append(card_id)

    session.active = False

    # 6. finish callback
    if on_finish is not None:
        try:
            await on_finish(ctx, session)
        except Exception as e:
            log.error("on_finish error: %s", e)

    return session
