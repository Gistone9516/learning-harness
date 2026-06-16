# -*- coding: utf-8 -*-
"""Shared types and constants for the engine (SoT _interface-contract.md §0·§1, engine-contract.md §5).

This file is the buildflow shared interface (SoT). All engine modules import types and constants from here.
Pure data definitions only — no logic, no side effects. Runtime is vanilla Python (no type enforcement; use guard functions for validation).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Literal

# Global constants (SoT §0) ──────────────────────────────────────────────
BOX_MIN: int = 1
BOX_MAX: int = 3
BOX_INTERVALS_DAYS: dict[int, int] = {1: 1, 2: 3, 3: 7}
SCHEMA_VERSION: int = 1
MS_PER_DAY: int = 86_400_000
DDAY_COMPRESS_DAYS: int = 1

# Literals (SoT §1) ─────────────────────────────────────────────────
Verdict = Literal["correct", "incorrect", "skip"]
ScoreMode = Literal["exact", "keyword", "cloze", "self"]
CardType = Literal["func", "proc", "recall_seq", "cloze", "judge"]
Effort = Literal["low", "medium", "high"]
PassStatus = Literal["safe", "watch", "danger"]


# Card, deck, and answer definitions (content injection) ──────────────────────────────────────────────
@dataclass
class AnswerSpec:
    normalize: list[str]                                   # ordered list of normalization rule IDs to apply
    accepted: list[str] | None = None                      # exact candidates (OR)
    required_keywords: list[list[str]] | None = None       # keyword mode: inner list = synonym group (any-of), all groups required
    blanks: list[list[str]] | None = None                  # cloze mode: blanks[i] = candidates for blank i (0-based)
    sequence: list[str] | None = None                      # recall_seq ordered steps


@dataclass
class CardDef:
    card_id: str                                           # ^[a-z][a-z0-9-]{2,63}$ (no colons)
    schema_version: int
    subject: str
    unit: str
    type: CardType
    grade_mode: ScoreMode                                  # content default; effective mode is resolved by bot via scoring_overrides
    front: dict
    back: dict
    answer_spec: AnswerSpec | None                         # None when self-graded
    tags: dict                                             # {weight:int[1,10]=5, area?:str, subarea?:str}
    links: dict                                            # {concept_ref?:str}
    enabled: bool = True


@dataclass
class DeckData:
    namespace: str
    cards: list[CardDef]


# Progress (persistent, SoT §2) ─────────────────────────────────────────────────
@dataclass
class CardProgress:
    card_id: str
    box: int = BOX_MIN
    due_at: int = 0                                        # epoch ms; 0 = due immediately
    graduated: bool = False
    cold_attempts: int = 0                                 # includes skips
    cold_correct: int = 0
    last_attempt_at: int | None = None
    last_verdict: Verdict | None = None


@dataclass
class ProgressStore:
    schema_version: int
    deck_namespace: str
    cards: dict[str, CardProgress] = field(default_factory=dict)


# Scoring I/O (SoT §1, engine-contract §3) ──────────────────────────────────────
@dataclass
class ScoreInput:
    mode: ScoreMode
    user_answer: str | list[str]                           # exact/keyword -> str, cloze -> list[str], self -> "correct"|"incorrect"
    answer_spec: AnswerSpec
    synonyms: dict[str, str] | None = None                 # reverse index (synonym -> canonical); compiled from config at bot boot


@dataclass
class ScoreResult:
    verdict: Literal["correct", "incorrect"]
    matched: list[str]
    missed: list[str]
    normalized_user: str | list[str]
    feedback: dict                                         # {"highlight_missed": list[str]}


@dataclass
class HandlerResult:                                       # return value of a learning skill handler (bot-contract §3·§4)
    card_id: str
    verdict: Verdict | None                                # None = card presented with no response
    requeue: bool = False
    done: bool = True


# Leitner and queue options (SoT §1, engine-contract §1·§2) ────────────────────────
@dataclass
class LeitnerConfig:
    intervals_days: dict[int, int] = field(default_factory=lambda: dict(BOX_INTERVALS_DAYS))
    dday_compress_days: int = DDAY_COMPRESS_DAYS


@dataclass
class QueueOptions:
    deck_namespace: str
    dday_mode: bool = False
    new_card_limit: int | None = None
    review_limit: int | None = None
    weight_overrides: dict[str, int] | None = None         # card_id -> weight (sidecar §2.1 injection); falls back to CardDef.tags.weight


# Dashboard aggregates (engine-contract §5) ─────────────────────────────────────
@dataclass
class ByAreaEntry:
    area: str
    subarea: str
    retrieval_rate: float | None                           # cold_correct/cold_attempts; None when cold_attempts == 0


@dataclass
class WeaknessEntry:
    area: str
    subarea: str
    unit: str
    wrong_rate: float                                      # cold wrong answers / cold_attempts


@dataclass
class PassPathEntry:
    area: str
    subarea: str
    target: int
    coverage: float
    mastery: float
    progress: float                                        # coverage * mastery
    status: PassStatus


@dataclass
class CompletionEntry:
    area: str
    subarea: str
    box_dist: dict                                         # {"box1":int,"box2":int,"box3":int}
    mastery_rate: float                                    # box3 / total


@dataclass
class DashboardData:
    by_area: list[ByAreaEntry]
    weakness: list[WeaknessEntry]
    pass_path: list[PassPathEntry]
    completion: list[CompletionEntry]


# Type alias for scoring handlers (used in bot-contract §3)
Handler = Callable[..., object]
