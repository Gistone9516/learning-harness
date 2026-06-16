# -*- coding: utf-8 -*-
"""Ctx dataclass (bot-contract §3).

Session context injected into handlers. No discord imports (headless test target).
All fields follow the bot-contract §3 Ctx definition.
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
    """Handler injection context (bot-contract §3).

    channel: discord channel object (Any, avoids discord import).
    user_id: allowed user Discord ID.
    store: loaded ProgressStore.
    deck: current deck DeckData.
    synonyms: reverse-index dict[synonym->canonical] (compiled at boot).
    grade_mode_of: card_id -> effective ScoreMode (reflects scoring_overrides).
    leitner_cfg: LeitnerConfig or None (use default).
    ai_model: AI model id or None.
    ai_effort: Effort literal.
    sid: AI session id (multi-turn) or None.
    session: current Session instance (circular ref, Any not TYPE_CHECKING).
    emit: shared coroutine for classify + transition + save.
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
