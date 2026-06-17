# -*- coding: utf-8 -*-
"""SubjectProfile — area taxonomy + AI task templates, injected from config.

Keeps the kit subject-agnostic: this module holds only GENERIC, subject-neutral
defaults plus a holder for per-subject overrides read from config. No subject
literal (a concrete subject name or its area labels) may live here or anywhere in
the kit code; subjects inject them through config (specs/injection-interface.md §5).

- areas: ordered area taxonomy (key + display label + icon + input aliases). Replaces
  the old hardcoded area constants. The catalog level/practice/panel features read it.
- tasks: per-capability overrides for AI roles and a few UI strings. When a subject
  does not override, the generic default below applies. Subject identity itself is
  carried by capabilities.ai.persona (already injected into every AI preamble), so the
  default roles describe only the task, never a subject.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# Generic, subject-neutral task defaults. NEVER put a subject literal here.
_TASK_DEFAULTS: dict[str, dict[str, str]] = {
    "practice": {
        "role": (
            "주어진 학습 항목을 직접 활용하는 짧은 연습 문제 하나를 한국어 지시문으로 낸다. "
            '오직 JSON으로만 답한다: {"problem":"<한국어 지시문>","answer":"<모범 답안>"}'
        ),
        "grader_role": (
            "학습자의 답안이 그 학습 항목을 올바르고 자연스럽게 사용했는지 판정한다. "
            "reason은 한국어로, 비전공자도 알기 쉽게 한두 문장."
        ),
        "modal_title": "답안 작성",
        "modal_input_label": "답",
        "problem_prefix": "✍️ 연습 문제.",
    },
    "convo": {
        "role": (
            "한 번에 한 항목 위주로, 학습자가 그 항목을 직접 써 보도록 유도하는 질문을 한국어로 하나만 던진다. "
            "학습자가 답하면 한국어로 교정하고 칭찬한 뒤, 다음 항목으로 자연스럽게 이어간다."
        ),
        "thread_title": "🗣 대화 연습",
        "seed_hint": "기초 표현",
    },
    "explain": {
        "role": (
            "개념을 한국어로, 비전공자도 이해하기 쉽게 짧고 명확하게 설명한다. "
            "쉬운 예와 자주 하는 실수를 곁들이되 장황하지 않게. 학습자가 더 물으면 이어서 답한다."
        ),
    },
}


@dataclass(frozen=True)
class AreaDef:
    """One catalog area (e.g. a category of items the subject is split into)."""
    key: str
    label: str
    icon: str = ""
    aliases: tuple[str, ...] = ()


@dataclass
class SubjectProfile:
    """Injected subject shape. Empty profile = no catalog areas, generic AI tasks."""
    areas: tuple[AreaDef, ...] = ()
    tasks: dict = field(default_factory=dict)  # {capability: {key: override_string}}

    def area_keys(self) -> list[str]:
        return [a.key for a in self.areas]

    def has_areas(self) -> bool:
        return bool(self.areas)

    def _find(self, key: str) -> "AreaDef | None":
        for a in self.areas:
            if a.key == key:
                return a
        return None

    def ko_label(self, key: str) -> str:
        a = self._find(key)
        return a.label if a else key

    def icon_of(self, key: str) -> str:
        a = self._find(key)
        return a.icon if a else ""

    def area_from_label(self, label: str) -> "str | None":
        s = (label or "").strip()
        for a in self.areas:
            if s == a.label or s == a.key or s in a.aliases:
                return a.key
        return None

    def task(self, cap: str, key: str) -> str:
        """Per-subject override else the generic default else ''."""
        override = (self.tasks.get(cap) or {}).get(key)
        if override:
            return str(override)
        return _TASK_DEFAULTS.get(cap, {}).get(key, "")


def build_subject_profile(config: dict) -> SubjectProfile:
    """Parse the `areas` list and `capabilities.ai.tasks` overrides from a deck config."""
    areas: list[AreaDef] = []
    for a in config.get("areas") or []:
        if not isinstance(a, dict) or not a.get("key"):
            continue
        areas.append(AreaDef(
            key=str(a["key"]),
            label=str(a.get("label") or a["key"]),
            icon=str(a.get("icon") or ""),
            aliases=tuple(str(x) for x in (a.get("aliases") or ())),
        ))
    ai = (config.get("capabilities") or {}).get("ai") or {}
    tasks = ai.get("tasks")
    return SubjectProfile(areas=tuple(areas), tasks=tasks if isinstance(tasks, dict) else {})


def task_of(ctx, cap: str, key: str) -> str:
    """Resolve a task string from ctx.subject, falling back to the generic default."""
    subj = getattr(ctx, "subject", None)
    if subj is not None:
        return subj.task(cap, key)
    return _TASK_DEFAULTS.get(cap, {}).get(key, "")
