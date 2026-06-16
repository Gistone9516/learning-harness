# -*- coding: utf-8 -*-
"""채점코어·정규화 (엔진계약 §3, SoT §7.5·§7.10).

완전 순수: 파일 I/O·discord·harness import 없음.
now 불필요 — 채점은 시각 비의존. 결정성 보장.
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

# 허용 ScoreMode 집합 (models.py Literal과 동기, 재정의 금지)
_VALID_MODES = {"exact", "keyword", "cloze", "self"}


# ── 정규화 ────────────────────────────────────────────────────────────────────

def _apply_rule(s: str, rule_id: str) -> str:
    """단일 정규화 규칙 적용. 알 수 없는 rule_id는 건너뜀(엔진 무오염)."""
    if rule_id == "nfkc":
        return unicodedata.normalize("NFKC", s)
    if rule_id == "trim":
        return s.strip()
    if rule_id == "collapse_space":
        # 모든 유니코드 공백류를 단일 스페이스로 치환
        return re.sub(r"[\s　 ﻿]+", " ", s)
    if rule_id == "strip_all_space":
        return re.sub(r"[\s　 ﻿]+", "", s)
    if rule_id == "lower":
        # ASCII 영문만 소문자화(유니코드 전체 lower는 의도 밖)
        return re.sub(r"[A-Z]", lambda m: m.group(0).lower(), s)
    if rule_id == "fullwidth_to_halfwidth":
        # 전각 ASCII 영숫자·기호(U+FF01~FF5E) → 반각(U+0021~007E)
        return re.sub(
            r"[！-～]",
            lambda m: chr(ord(m.group(0)) - 0xFEE0),
            s,
        )
    if rule_id == "unify_cell_dollar":
        return s.replace("$", "")
    if rule_id == "unify_arg_sep":
        # 세미콜론·전각세미콜론·전각쉼표를 쉼표로 통일
        s = re.sub(r"[;；]", ",", s)
        s = s.replace("，", ",")
        return s
    if rule_id == "strip_trailing_paren":
        return re.sub(r"\s*\(.*?\)\s*$", "", s).rstrip()
    # 알 수 없는 규칙은 원문 그대로 반환
    return s


def _apply_synonyms(s: str, synonyms: dict[str, str] | None) -> str:
    """synonyms 치환(lower 직후, 비교 직전).

    공백 토큰 분리 후 각 토큰이 synonyms 키(동의어)이면 값(대표어)으로 교체.
    토큰 단위 정확일치만(부분문자열 치환 아님). 다어절 구 치환은 v1 밖.
    """
    if not synonyms:
        return s
    tokens = s.split(" ")
    result = [synonyms.get(tok, tok) for tok in tokens]
    return " ".join(result)


def normalize(s: str, rules: list[str], synonyms: dict[str, str] | None = None) -> str:
    """정규화 파이프라인 (엔진계약 §3.3, SoT §7.10).

    rules 배열 순서대로 결정적 적용.
    synonyms 치환은 lower 규칙 직후에 삽입한다.
    lower 규칙이 없으면 synonyms 치환은 수행하지 않는다.
    """
    if not isinstance(s, str):
        s = str(s)
    result = s
    for rule_id in rules:
        result = _apply_rule(result, rule_id)
        if rule_id == "lower":
            result = _apply_synonyms(result, synonyms)
    return result


# ── 채점 ──────────────────────────────────────────────────────────────────────

def _norm_fn(answer_spec: AnswerSpec, synonyms: dict[str, str] | None):
    """양변에 동일하게 적용할 정규화 클로저를 반환."""
    rules = answer_spec.normalize if answer_spec.normalize else []
    def _norm(s: str) -> str:
        return normalize(s, rules, synonyms)
    return _norm


def _score_exact(inp: ScoreInput) -> ScoreResult:
    """exact 모드 채점(엔진계약 §3.1, §3.2).

    recall_seq 카드는 answer_spec.sequence 존재 여부로 판별한다.
    exact 일반은 accepted OR 일치, recall_seq는 배열 순서완전일치.
    """
    norm = _norm_fn(inp.answer_spec, inp.synonyms)
    spec = inp.answer_spec

    # recall_seq 경로: sequence가 있으면 배열 비교
    if spec.sequence is not None:
        user_ans = inp.user_answer
        if isinstance(user_ans, list):
            user_steps = [norm(s) for s in user_ans]
        elif isinstance(user_ans, str):
            # 하위호환: 쉼표 분리 단일 문자열 허용
            user_steps = [norm(s.strip()) for s in user_ans.split(",")]
        else:
            raise ScoreInputError(
                "recall_seq exact 모드 user_answer는 list[str] 또는 str이어야 함"
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
        return ScoreResult(
            verdict="correct" if all_match else "incorrect",
            matched=seq_steps if all_match else [],
            missed=[] if all_match else seq_steps,
            normalized_user=user_steps,
            feedback={"highlight_missed": [] if all_match else seq_steps},
        )

    # 일반 exact 경로: user_answer는 str
    if not isinstance(inp.user_answer, str):
        raise ScoreInputError("exact 모드 user_answer는 str이어야 함")
    norm_user = norm(inp.user_answer)
    # 빈 입력은 incorrect(throw 아님, 엔진계약 §3.2)
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
    """keyword 모드 채점(엔진계약 §3.1).

    required_keywords 모든 그룹 충족(그룹별 any-of 포함검사).
    """
    if not isinstance(inp.user_answer, str):
        raise ScoreInputError("keyword 모드 user_answer는 str이어야 함")
    norm = _norm_fn(inp.answer_spec, inp.synonyms)
    norm_user = norm(inp.user_answer)
    groups = inp.answer_spec.required_keywords or []
    matched: list[str] = []
    missed: list[str] = []
    for group in groups:
        norm_group = [norm(k) for k in group] if group else []
        hit = next((k for k in norm_group if k in norm_user), None)
        if hit is not None:
            matched.append(hit)
        else:
            # 피드백용으로 그룹 첫 번째 후보(대표) 기록
            missed.append(norm_group[0] if norm_group else "")
    is_correct = len(missed) == 0 and len(groups) > 0
    return ScoreResult(
        verdict="correct" if is_correct else "incorrect",
        matched=matched,
        missed=missed,
        normalized_user=norm_user,
        feedback={"highlight_missed": missed},
    )


def _score_cloze(inp: ScoreInput) -> ScoreResult:
    """cloze 모드 채점(엔진계약 §3.1, §3.4).

    빈칸수 불일치 → ScoreInputError. matched/missed = 빈칸 인덱스 문자열.
    """
    if not isinstance(inp.user_answer, list):
        raise ScoreInputError("cloze 모드 user_answer는 list[str]이어야 함")
    blanks = inp.answer_spec.blanks or []
    if len(inp.user_answer) != len(blanks):
        raise ScoreInputError(
            f"cloze 빈칸수 불일치: 입력 {len(inp.user_answer)}개, 정답 {len(blanks)}개"
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
    is_correct = len(missed) == 0 and len(blanks) > 0
    return ScoreResult(
        verdict="correct" if is_correct else "incorrect",
        matched=matched,
        missed=missed,
        normalized_user=norm_user,
        feedback={"highlight_missed": missed},
    )


def _score_self(inp: ScoreInput) -> ScoreResult:
    """self 모드 채점(엔진계약 §3.1).

    user_answer를 그대로 verdict로 채택. 허용값 외에는 ScoreInputError.
    """
    user_ans = inp.user_answer
    if user_ans not in ("correct", "incorrect"):
        raise ScoreInputError(
            f'self 모드 user_answer는 "correct"|"incorrect"만 허용. 받은 값: {user_ans!r}'
        )
    return ScoreResult(
        verdict=user_ans,  # type: ignore[arg-type]
        matched=[],
        missed=[],
        normalized_user=user_ans,
        feedback={"highlight_missed": []},
    )


def score(inp: ScoreInput) -> ScoreResult:
    """채점 진입점 (엔진계약 §3.4).

    모드별 채점 함수로 분기. 알 수 없는 mode → ScoreInputError.
    skip은 score() 호출 안 함(엔진계약 §3.2, 봇 소관).
    """
    mode = inp.mode
    if mode not in _VALID_MODES:
        raise ScoreInputError(f"알 수 없는 grade_mode: {mode!r}")
    if mode == "exact":
        return _score_exact(inp)
    if mode == "keyword":
        return _score_keyword(inp)
    if mode == "cloze":
        return _score_cloze(inp)
    if mode == "self":
        return _score_self(inp)
    # 도달 불가(위 검사에서 처리됨)
    raise ScoreInputError(f"처리할 수 없는 mode: {mode!r}")
