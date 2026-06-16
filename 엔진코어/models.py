# -*- coding: utf-8 -*-
"""엔진코어 공유 타입·상수 (SoT _인터페이스계약.md §0·§1, 엔진계약.md §5).

이 파일은 buildflow 공유 인터페이스(SoT). 모든 엔진코어 모듈은 여기서 타입·상수를 import한다.
순수 데이터 정의만 — 로직·부수효과 없음. 런타임은 바닐라 파이썬(타입 강제 아님, 가드 함수로 검증).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Literal

# ── 전역 상수 (SoT §0) ──────────────────────────────────────────────
BOX_MIN: int = 1
BOX_MAX: int = 3
BOX_INTERVALS_DAYS: dict[int, int] = {1: 1, 2: 3, 3: 7}
SCHEMA_VERSION: int = 1
MS_PER_DAY: int = 86_400_000
DDAY_COMPRESS_DAYS: int = 1

# ── 리터럴 (SoT §1) ─────────────────────────────────────────────────
Verdict = Literal["correct", "incorrect", "skip"]
ScoreMode = Literal["exact", "keyword", "cloze", "self"]
CardType = Literal["func", "proc", "recall_seq", "cloze", "judge"]
Effort = Literal["low", "medium", "high"]
PassStatus = Literal["safe", "watch", "danger"]


# ── 카드·덱·정답 (콘텐츠 주입) ──────────────────────────────────────
@dataclass
class AnswerSpec:
    normalize: list[str]                                   # 적용할 정규화 규칙 id 순서배열
    accepted: list[str] | None = None                      # exact 후보(OR)
    required_keywords: list[list[str]] | None = None       # keyword. 내부=한 그룹 동의어(any-of), 모든 그룹 필수
    blanks: list[list[str]] | None = None                  # cloze. blanks[i]=i번 빈칸 후보(0-base)
    sequence: list[str] | None = None                      # recall_seq 순서 단계


@dataclass
class CardDef:
    card_id: str                                           # ^[a-z][a-z0-9-]{2,63}$ (콜론 금지)
    schema_version: int
    subject: str
    unit: str
    type: CardType
    grade_mode: ScoreMode                                  # 콘텐츠 기본. 실효 모드는 봇이 scoring_overrides 반영
    front: dict
    back: dict
    answer_spec: AnswerSpec | None                         # self면 None
    tags: dict                                             # {weight:int[1,10]=5, area?:str, subarea?:str}
    links: dict                                            # {concept_ref?:str}
    enabled: bool = True


@dataclass
class DeckData:
    namespace: str
    cards: list[CardDef]


# ── 진도 (영속, SoT §2) ─────────────────────────────────────────────
@dataclass
class CardProgress:
    card_id: str
    box: int = BOX_MIN
    due_at: int = 0                                        # epoch ms. 0=즉시 due
    graduated: bool = False
    cold_attempts: int = 0                                 # skip 포함
    cold_correct: int = 0
    last_attempt_at: int | None = None
    last_verdict: Verdict | None = None


@dataclass
class ProgressStore:
    schema_version: int
    deck_namespace: str
    cards: dict[str, CardProgress] = field(default_factory=dict)


# ── 채점 I/O (SoT §1, 엔진계약 §3) ──────────────────────────────────
@dataclass
class ScoreInput:
    mode: ScoreMode
    user_answer: str | list[str]                           # exact/keyword→str, cloze→list[str], self→"correct"|"incorrect"
    answer_spec: AnswerSpec
    synonyms: dict[str, str] | None = None                 # 역인덱스(동의어->대표어). 봇 부트가 config에서 컴파일


@dataclass
class ScoreResult:
    verdict: Literal["correct", "incorrect"]
    matched: list[str]
    missed: list[str]
    normalized_user: str | list[str]
    feedback: dict                                         # {"highlight_missed": list[str]}


@dataclass
class HandlerResult:                                       # 학습 능력 핸들러 반환(봇계약 §3·§4)
    card_id: str
    verdict: Verdict | None                                # None=제시만/미응답
    requeue: bool = False
    done: bool = True


# ── Leitner·큐 옵션 (SoT §1, 엔진계약 §1·§2) ────────────────────────
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
    weight_overrides: dict[str, int] | None = None         # card_id->weight(사이드카 §2.1 주입). 없으면 CardDef.tags.weight


# ── 대시보드 집계 (엔진계약 §5) ─────────────────────────────────────
@dataclass
class ByAreaEntry:
    area: str
    subarea: str
    retrieval_rate: float | None                           # cold_correct/cold_attempts, cold0→None


@dataclass
class WeaknessEntry:
    area: str
    subarea: str
    unit: str
    wrong_rate: float                                      # cold오답/cold_attempts


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
    mastery_rate: float                                    # box3/전체


@dataclass
class DashboardData:
    by_area: list[ByAreaEntry]
    weakness: list[WeaknessEntry]
    pass_path: list[PassPathEntry]
    completion: list[CompletionEntry]


# 채점 핸들러 타입 별칭(봇계약 §3에서 사용)
Handler = Callable[..., object]
