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
# role / grader_role are INSTRUCTIONS to the model -> English for instruction determinism and
# consistent output-language control (token effect is modest; output language is enforced by the
# safety preamble). modal_title / input_label / problem_prefix / thread_title /
# seed_hint are USER-FACING strings or seed data -> kept in the learner's language.
_TASK_DEFAULTS: dict[str, dict[str, str]] = {
    "practice": {
        "role": (
            "Create one short practice problem that makes the learner actively use the given study item. "
            'Respond ONLY as JSON: {"problem":"<instruction text>","answer":"<model answer>"}'
        ),
        "grader_role": (
            "Decide whether the learner's answer uses the given item correctly and naturally. "
            "Keep the reason to one or two sentences a beginner can follow."
        ),
        "modal_title": "답안 작성",
        "modal_input_label": "답",
        "problem_prefix": "✍️ 연습 문제.",
    },
    "convo": {
        "role": (
            "Focus on one item at a time. Ask exactly one question that nudges the learner to actively use "
            "that item. After they answer, correct and encourage, then move naturally to the next item."
        ),
        "thread_title": "🗣 대화 연습",
        "seed_hint": "기초 표현",
    },
    "explain": {
        "role": (
            "Explain the concept clearly and simply for a non-expert. Add an easy example and a common "
            "mistake, but stay concise. If the learner asks more, keep answering."
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
