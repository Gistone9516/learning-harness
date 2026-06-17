# -*- coding: utf-8 -*-
"""Scoring core and normalization (engine-contract §3, SoT §7.5·§7.10).

Fully pure: no file I/O, no discord, no harness imports.
No `now` needed — scoring is time-independent. Deterministic.
"""
from __future__ import annotations

import unicodedata
import re

from models import (
    ScoreInput,
    ScoreResult,
    AnswerSpec,
)
from errors import ScoreInputError

# Allowed ScoreMode set (synced with models.py Literal; do not redefine)
_VALID_MODES = {"exact", "keyword", "cloze", "self"}


# Normalization

def _apply_rule(s: str, rule_id: str) -> str:
    """Apply a single normalization rule. Unknown rule_id is skipped (engine stays clean)."""
    if rule_id == "nfkc":
        return unicodedata.normalize("NFKC", s)
    if rule_id == "trim":
        return s.strip()
    if rule_id == "collapse_space":
        # Replace all Unicode whitespace variants with a single space.
        return re.sub(r"[\s　 ﻿]+", " ", s)
    if rule_id == "strip_all_space":
        return re.sub(r"[\s　 ﻿]+", "", s)
    if rule_id == "lower":
        # Lowercase ASCII letters only (full Unicode lower is out of scope).
        return re.sub(r"[A-Z]", lambda m: m.group(0).lower(), s)
    if rule_id == "fullwidth_to_halfwidth":
        # Fullwidth ASCII alphanumerics/symbols (U+FF01-FF5E) to halfwidth (U+0021-007E).
        return re.sub(
            r"[！-～]",
            lambda m: chr(ord(m.group(0)) - 0xFEE0),
            s,
        )
    if rule_id == "unify_cell_dollar":
        return s.replace("$", "")
    if rule_id == "unify_arg_sep":
        # Unify semicolons, fullwidth semicolons, and fullwidth commas to comma.
        s = re.sub(r"[;；]", ",", s)
        s = s.replace("，", ",")
        return s
    if rule_id == "strip_trailing_paren":
        return re.sub(r"\s*\(.*?\)\s*$", "", s).rstrip()
    # Unknown rule: return the string as-is.
    return s


def _apply_synonyms(s: str, synonyms: dict[str, str] | None) -> str:
    """Apply synonym substitution (runs right after lower, before comparison).

    Splits by whitespace tokens; replaces each token that matches a synonyms key
    (variant form) with the canonical value. Token-level exact match only, no
    substring substitution. Multi-word phrase substitution is out of v1 scope.
    """
    if not synonyms:
        return s
    tokens = s.split(" ")
    result = [synonyms.get(tok, tok) for tok in tokens]
    return " ".join(result)


def normalize(s: str, rules: list[str], synonyms: dict[str, str] | None = None) -> str:
    """Normalization pipeline (engine-contract §3.3, SoT §7.10).

    Applies rules in order, deterministically.
    Synonym substitution is inserted immediately after the lower rule.
    If the lower rule is absent, synonym substitution is not performed.
    """
    if not isinstance(s, str):
        s = str(s)
    result = s
    for rule_id in rules:
        result = _apply_rule(result, rule_id)
        if rule_id == "lower":
            result = _apply_synonyms(result, synonyms)
    return result


# Scoring

def _norm_fn(answer_spec: AnswerSpec, synonyms: dict[str, str] | None):
    """Return a normalization closure applied identically to both sides."""
    rules = answer_spec.normalize if answer_spec.normalize else []
    def _norm(s: str) -> str:
        return normalize(s, rules, synonyms)
    return _norm


def _score_exact(inp: ScoreInput) -> ScoreResult:
    """Exact mode scoring (engine-contract §3.1, §3.2).

    recall_seq cards are detected by the presence of answer_spec.sequence.
    Plain exact: accepted OR match. recall_seq: full ordered array match.
    """
    norm = _norm_fn(inp.answer_spec, inp.synonyms)
    spec = inp.answer_spec

    # recall_seq path: compare as array when sequence is present.
    if spec.sequence is not None:
        user_ans = inp.user_answer
        if isinstance(user_ans, list):
            user_steps = [norm(s) for s in user_ans]
        elif isinstance(user_ans, str):
            # Backward-compat: accept a single comma-separated string.
            user_steps = [norm(s.strip()) for s in user_ans.split(",")]
        else:
            raise ScoreInputError(
                "recall_seq exact mode: user_answer must be list[str] or str"
            )
        seq_steps = [norm(s) for s in spec.sequence]
        if len(user_steps) != len(seq_steps):
            return ScoreResult(
                verdict="incorrect",
                matched=[],
                missed=seq_steps,
                normalized_user=user_steps,
                feedback={"highlight_missed": seq_steps},
            )
        all_match = all(u == a for u, a in zip(user_steps, seq_steps))
        # Per-step matched/missed so partially-correct sequences give accurate feedback
        # (a correct step is never reported as missed).
        step_matched = [a for u, a in zip(user_steps, seq_steps) if u == a]
        step_missed = [a for u, a in zip(user_steps, seq_steps) if u != a]
        return ScoreResult(
            verdict="correct" if all_match else "incorrect",
            matched=step_matched,
            missed=step_missed,
            normalized_user=user_steps,
            feedback={"highlight_missed": step_missed},
        )

    # Plain exact path: user_answer must be str.
    if not isinstance(inp.user_answer, str):
        raise ScoreInputError("exact mode: user_answer must be str")
    norm_user = norm(inp.user_answer)
    # Empty input is incorrect (no raise; see engine-contract §3.2).
    accepted = spec.accepted if spec.accepted else []
    norm_accepted = [norm(a) for a in accepted]
    matched_val = next((a for a in norm_accepted if a == norm_user), None)
    is_correct = matched_val is not None
    return ScoreResult(
        verdict="correct" if is_correct else "incorrect",
        matched=[matched_val] if is_correct else [],
        missed=[],
        normalized_user=norm_user,
        feedback={"highlight_missed": []},
    )


def _score_keyword(inp: ScoreInput) -> ScoreResult:
    """Keyword mode scoring (engine-contract §3.1).

    All required_keywords groups must be satisfied (any-of containment check per group).
    """
    if not isinstance(inp.user_answer, str):
        raise ScoreInputError("keyword mode: user_answer must be str")
    norm = _norm_fn(inp.answer_spec, inp.synonyms)
    norm_user = norm(inp.user_answer)
    groups = inp.answer_spec.required_keywords or []
    if not groups:
        raise ScoreInputError("keyword mode: required_keywords must not be empty")
    matched: list[str] = []
    missed: list[str] = []
    for group in groups:
        norm_group = [norm(k) for k in group] if group else []
        hit = next((k for k in norm_group if k in norm_user), None)
        if hit is not None:
            matched.append(hit)
        else:
            # Record the first candidate in the group as feedback representative.
            missed.append(norm_group[0] if norm_group else "")
    is_correct = len(missed) == 0
    return ScoreResult(
        verdict="correct" if is_correct else "incorrect",
        matched=matched,
        missed=missed,
        normalized_user=norm_user,
        feedback={"highlight_missed": missed},
    )


def _score_cloze(inp: ScoreInput) -> ScoreResult:
    """Cloze mode scoring (engine-contract §3.1, §3.4).

    Blank count mismatch raises ScoreInputError. matched/missed are blank index strings.
    """
    if not isinstance(inp.user_answer, list):
        raise ScoreInputError("cloze mode: user_answer must be list[str]")
    blanks = inp.answer_spec.blanks or []
    if not blanks:
        raise ScoreInputError("cloze mode: blanks must not be empty")
    if len(inp.user_answer) != len(blanks):
        raise ScoreInputError(
            f"cloze blank count mismatch: got {len(inp.user_answer)}, expected {len(blanks)}"
        )
    norm = _norm_fn(inp.answer_spec, inp.synonyms)
    norm_user = [norm(u) for u in inp.user_answer]
    matched: list[str] = []
    missed: list[str] = []
    for i, (user_val, candidates) in enumerate(zip(norm_user, blanks)):
        norm_cands = [norm(c) for c in candidates] if candidates else []
        if user_val in norm_cands:
            matched.append(str(i))
        else:
            missed.append(str(i))
    is_correct = len(missed) == 0
    return ScoreResult(
        verdict="correct" if is_correct else "incorrect",
        matched=matched,
        missed=missed,
        normalized_user=norm_user,
        feedback={"highlight_missed": missed},
    )


def _score_self(inp: ScoreInput) -> ScoreResult:
    """Self mode scoring (engine-contract §3.1).

    Adopts user_answer directly as the verdict. Raises ScoreInputError for any other value.
    """
    user_ans = inp.user_answer
    if user_ans not in ("correct", "incorrect"):
        raise ScoreInputError(
            f'self mode: user_answer must be "correct" or "incorrect". Got: {user_ans!r}'
        )
    return ScoreResult(
        verdict=user_ans,  # type: ignore[arg-type]
        matched=[],
        missed=[],
        normalized_user=user_ans,
        feedback={"highlight_missed": []},
    )


def score(inp: ScoreInput) -> ScoreResult:
    """Scoring entry point (engine-contract §3.4).

    Dispatches to the per-mode scoring function. Unknown mode raises ScoreInputError.
    skip is not passed to score() (see engine-contract §3.2; handled by bot).
    """
    mode = inp.mode
    if mode not in _VALID_MODES:
        raise ScoreInputError(f"unknown grade_mode: {mode!r}")
    if mode == "exact":
        return _score_exact(inp)
    if mode == "keyword":
        return _score_keyword(inp)
    if mode == "cloze":
        return _score_cloze(inp)
    if mode == "self":
        return _score_self(inp)
    # Unreachable (caught above).
    raise ScoreInputError(f"unhandled mode: {mode!r}")
