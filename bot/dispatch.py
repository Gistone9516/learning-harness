# -*- coding: utf-8 -*-
"""Routing table + capability_id -> handler registry (bot-contract §3).

Routing logic (card -> capability_id) must not import discord (headless test target).
Handler binding is deferred via registry injection so session does not directly import handlers.
"""
from __future__ import annotations

import _paths
_paths.setup()

from typing import Any, Callable, Awaitable
from models import CardDef, HandlerResult

# Handler type alias (bot-contract §3)
Handler = Callable[[Any, CardDef], Awaitable[HandlerResult]]

# capability_id -> Handler registry
# Populated at runtime via register() (discord-dependent modules inject handlers)
HANDLERS: dict[str, Handler] = {}


def register(capability_id: str, handler: Handler) -> None:
    """Register a handler for a capability_id."""
    HANDLERS[capability_id] = handler


def route(card: CardDef, grade_mode_of: Callable[[str], str]) -> str:
    """Card -> capability_id routing (bot-contract §3 priority table).

    Priority (first match top to bottom):
    1. grade_mode == self (all types)  -> recall_self
    2. type == cloze                   -> cloze_modal
    3. type == recall_seq              -> seq_modal
    4. type == judge, options <= 5     -> mcq_buttons
       type == judge, options > 5      -> mcq_select
    5. type in {func, proc}            -> short_modal
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

    # Fallback: recall_self
    return "recall_self"


async def dispatch(ctx: Any, card: CardDef) -> HandlerResult:
    """Route a card and invoke the registered handler. Falls back to recall_self if capability is unregistered."""
    grade_mode_of = ctx.grade_mode_of
    cap_id = route(card, grade_mode_of)

    handler = HANDLERS.get(cap_id)
    if handler is None:
        # Fallback: recall_self
        fallback = HANDLERS.get("recall_self")
        if fallback is None:
            # No handler at all; return a minimal HandlerResult
            return HandlerResult(card_id=card.card_id, verdict="skip", done=True)
        return await fallback(ctx, card)

    return await handler(ctx, card)
