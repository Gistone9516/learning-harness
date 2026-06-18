# -*- coding: utf-8 -*-
"""Guardrail: the kit code (bot/ + engine/) must contain NO subject literal.

All subject flavor (a concrete subject name, its area labels, exam names) is injected
through config -> SubjectProfile. If a subject-specific string leaks back into shared kit
code, this test fails and points at the file:line. Scope is kit SOURCE only (test files and
__pycache__ excluded). This is a necessary check, not a sufficient one: it catches literals,
not semantic subject assumptions baked into logic.
"""
import os

_BOT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_ROOT = os.path.dirname(_BOT_ROOT)

# Subject-specific tokens that must never appear in generic kit code: the Korean English-subject
# terms + the English-subject area labels. (The bare word "English" is intentionally NOT here — it is
# a legitimate language name in the i18n map / English instruction prose, not subject leakage. The
# reliable subject-leak signal in this codebase is the Korean subject vocabulary.)
_DENY = ["영어", "영작", "토익", "토플", "단어", "문법", "숙어"]

_SCAN_DIRS = ["bot", "engine"]


def _kit_py_files():
    for d in _SCAN_DIRS:
        base = os.path.join(_ROOT, d)
        for dp, dn, fns in os.walk(base):
            parts = dp.split(os.sep)
            if "tests" in parts or "__pycache__" in parts:
                continue
            for fn in fns:
                if fn.endswith(".py"):
                    yield os.path.join(dp, fn)


def test_kit_code_has_no_subject_literal():
    hits = []
    for path in _kit_py_files():
        with open(path, encoding="utf-8") as f:
            for i, line in enumerate(f.read().splitlines(), 1):
                for token in _DENY:
                    if token in line:
                        rel = os.path.relpath(path, _ROOT)
                        hits.append(f"{rel}:{i} [{token}] {line.strip()[:80]}")
    assert not hits, "subject literal leaked into kit code:\n" + "\n".join(hits)
