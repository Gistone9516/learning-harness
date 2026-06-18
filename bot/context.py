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
    mount: content folder mount path (for sidecar I/O, SoT §2.1).
    deck_namespace: active deck namespace (sidecar filename component).
    ai_persona: optional global persona clause injected into AI preambles.
    """
    channel: Any
    user_id: int
    store: ProgressStore
    deck: DeckData
    mount: str
    deck_namespace: str
    synonyms: dict[str, str]
    grade_mode_of: Callable[[str], str]
    leitner_cfg: LeitnerConfig | None
    ai_model: str | None
    ai_effort: Effort
    sid: str | None
    session: Any
    emit: Callable[..., Any]
    ai_persona: str | None = None
    enabled_capabilities: set = field(default_factory=set)
    progress: tuple | None = None   # (presented, total) for the session progress indicator
    ai_model_explain: str | None = None   # model for ai_explain (haiku); from .env AI_MODEL_EXPLAIN
    subject: Any = None   # SubjectProfile: injected area taxonomy + AI task overrides
    output_lang: str = "Korean"   # AI natural-language output language (.env USER_LANG)
