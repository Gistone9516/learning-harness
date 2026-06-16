# -*- coding: utf-8 -*-
"""부트 (봇계약 §2, SoT §3 구현).

콘텐츠 로드(manifest -> deck -> config) -> 검증(ContentInjectionError) ->
컴파일(정규화 프로파일, synonyms 역인덱스, 실효 grade_mode 맵, pass_targets) ->
능력 레지스트리 -> 진도 로드(persist + engine.migrate).

discord import 금지 - 순수 로직, 헤드리스 테스트 대상.
"""
from __future__ import annotations

import os
import json
import re
import logging
from dataclasses import dataclass, field
from typing import Any

import _paths
_paths.setup()

from models import (
    CardDef, AnswerSpec, DeckData,
    ProgressStore, LeitnerConfig,
    SCHEMA_VERSION,
)
from bot_errors import (
    ManifestMissingError,
    ContentInjectionError,
    DeckNotFoundError,
)
import persist as _persist

log = logging.getLogger(__name__)

# card_id 허용 정규식 (SoT §2)
_CARD_ID_RE = re.compile(r"^[a-z][a-z0-9-]{2,63}$")

# 허용 정규화 규칙 id (엔진계약 §3.4에서 정의한 9종)
_VALID_NORM_RULES = {
    "nfkc", "trim", "collapse_space", "strip_all_space", "lower",
    "fullwidth_to_halfwidth", "unify_cell_dollar", "unify_arg_sep",
    "strip_trailing_paren",
}

_VALID_CARD_TYPES = {"func", "proc", "recall_seq", "cloze", "judge"}
_VALID_GRADE_MODES = {"exact", "keyword", "cloze", "self"}

# core tier 능력 id 집합 (학습타입규격 layer 2 core, layer 4 core)
_CORE_CAPABILITY_IDS = {
    "card_render", "recall_self", "mcq_buttons", "mcq_select", "short_modal",
    "cloze_modal", "seq_modal", "reaction_quick",
    "feedback_inline", "paginate",
    "confidence_rate", "hint_progressive", "elaborate_ask", "read_resume",
    "srs_due_alert", "session_progress",
    "dashboard_live", "box_table", "digest_weekly",
    "gating", "event_trigger", "heartbeat", "coalesce_base",
    # extension 포함(알 수 없는 id가 아닌 경우만 허용)
    "quiz_poll", "concept_link", "preview_then_test", "session_thread",
    "exam_delayed", "mastery_chart", "weakness_wiki", "content_hotreload",
    "curate_contextmenu", "pin_rotate",
    "perm_preflight", "presence_signal", "channel_scaffold", "dm_private",
    # layer 3 AI
    "ai_openend_grade", "ai_socratic", "ai_hint", "ai_generate_items",
    "ai_personal_feedback", "ai_misconception", "ai_adaptive_weight",
    "ai_session_summary", "ai_stream_render", "ai_variant_q",
    "ai_persona", "ai_proactive_remind",
}

# layer 4 항상 활성 (레지스트리 enabled와 무관)
_LAYER4_ALWAYS = {"gating", "event_trigger", "heartbeat", "coalesce_base"}


@dataclass
class BootResult:
    """boot.load() 반환값."""
    mount: str
    deck: DeckData
    config: dict
    store: ProgressStore
    # 컴파일 결과
    normalize_profiles: dict[str, list[str]]        # type -> 정규화 규칙 배열
    synonyms: dict[str, str]                        # 역인덱스 동의어->대표어
    grade_mode_map: dict[str, str]                  # card_id -> 실효 grade_mode
    pass_targets: dict[str, int]                    # subarea -> 목표점수
    leitner_cfg: LeitnerConfig | None
    enabled_capabilities: set[str]
    ai_model: str | None
    ai_effort: str


# ── 검증 헬퍼 ────────────────────────────────────────────────────────────────

def _check(cond: bool, msg: str) -> None:
    if not cond:
        raise ContentInjectionError(msg)


def _validate_card_id(card_id: str, seen: set[str]) -> None:
    _check(bool(_CARD_ID_RE.match(card_id)),
           f"card_id 정규식 위반: {card_id!r}")
    _check(":" not in card_id, f"card_id에 콜론 금지: {card_id!r}")
    _check(card_id not in seen, f"card_id 중복: {card_id!r}")


def _validate_answer_spec(card_id: str, ctype: str, grade_mode: str, spec_raw: Any) -> AnswerSpec | None:
    if grade_mode == "self":
        _check(spec_raw is None,
               f"{card_id}: self grade_mode이면 answer_spec은 null이어야 함")
        return None

    _check(spec_raw is not None,
           f"{card_id}: grade_mode={grade_mode}이면 answer_spec 필수")
    _check(isinstance(spec_raw, dict),
           f"{card_id}: answer_spec은 객체여야 함")

    normalize = spec_raw.get("normalize", [])
    _check(isinstance(normalize, list),
           f"{card_id}: answer_spec.normalize는 배열이어야 함")
    for rule in normalize:
        _check(rule in _VALID_NORM_RULES,
               f"{card_id}: 알 수 없는 normalize 규칙 id: {rule!r}")

    accepted = spec_raw.get("accepted")
    required_keywords = spec_raw.get("required_keywords")
    blanks = spec_raw.get("blanks")
    sequence = spec_raw.get("sequence")

    if grade_mode == "exact" and ctype != "recall_seq":
        _check(isinstance(accepted, list) and len(accepted) >= 1,
               f"{card_id}: exact 모드는 accepted 배열(>=1) 필수")
    elif grade_mode == "keyword":
        _check(isinstance(required_keywords, list) and len(required_keywords) >= 1,
               f"{card_id}: keyword 모드는 required_keywords 배열(>=1그룹) 필수")
    elif grade_mode == "cloze":
        _check(isinstance(blanks, list) and len(blanks) >= 1,
               f"{card_id}: cloze 모드는 blanks 배열 필수")
        if ctype == "cloze":
            # front.text 안 마커 수와 blanks 수 일치 검증은 load_deck에서 처리
            pass
    elif grade_mode == "exact" and ctype == "recall_seq":
        pass  # sequence는 front/back 구조에서 처리

    return AnswerSpec(
        normalize=normalize,
        accepted=accepted,
        required_keywords=required_keywords,
        blanks=blanks,
        sequence=sequence,
    )


def _count_cloze_markers(text: str) -> int:
    """{{N}} 마커 수 반환 (0-base 인덱스는 연속이어야 함)."""
    markers = re.findall(r"\{\{(\d+)\}\}", text)
    return len(set(markers))


def _validate_front(card_id: str, ctype: str, front: dict, spec_raw: Any) -> None:
    """type별 front 키 정합 검증 (주입인터페이스 §4)."""
    if ctype in ("func", "proc"):
        _check("prompt" in front,
               f"{card_id}: {ctype} 카드 front에 'prompt' 필수")
    elif ctype == "recall_seq":
        _check("prompt" in front,
               f"{card_id}: recall_seq 카드 front에 'prompt' 필수")
        if spec_raw and isinstance(spec_raw, dict):
            seq = spec_raw.get("sequence")
            _check(isinstance(seq, list) and len(seq) >= 1,
                   f"{card_id}: recall_seq answer_spec.sequence 배열(>=1) 필수")
    elif ctype == "cloze":
        _check("text" in front,
               f"{card_id}: cloze 카드 front에 'text' 필수")
        if spec_raw and isinstance(spec_raw, dict):
            blanks = spec_raw.get("blanks")
            if isinstance(blanks, list):
                marker_count = _count_cloze_markers(str(front.get("text", "")))
                _check(marker_count == len(blanks),
                       f"{card_id}: cloze 마커 수({marker_count}) != blanks 수({len(blanks)})")
    elif ctype == "judge":
        _check("scenario" in front or "prompt" in front,
               f"{card_id}: judge 카드 front에 'scenario' 또는 'prompt' 필수")
        _check("options" in front and isinstance(front["options"], list),
               f"{card_id}: judge 카드 front에 'options' 배열 필수")


def _parse_card(raw: dict, seen_ids: set[str]) -> CardDef:
    """카드 dict -> CardDef. 검증 포함."""
    card_id = raw.get("card_id", "")
    _validate_card_id(card_id, seen_ids)
    seen_ids.add(card_id)

    subject = raw.get("subject", "")
    unit = raw.get("unit", "")
    _check(bool(subject), f"{card_id}: 'subject' 필수")
    _check(bool(unit), f"{card_id}: 'unit' 필수")

    ctype = raw.get("type", "")
    _check(ctype in _VALID_CARD_TYPES,
           f"{card_id}: 알 수 없는 type: {ctype!r}")

    grade_mode = raw.get("grade_mode", "")
    _check(grade_mode in _VALID_GRADE_MODES,
           f"{card_id}: 알 수 없는 grade_mode: {grade_mode!r}")

    front = raw.get("front", {})
    spec_raw = raw.get("answer_spec")
    _validate_front(card_id, ctype, front if isinstance(front, dict) else {}, spec_raw)

    answer_spec = _validate_answer_spec(card_id, ctype, grade_mode, spec_raw)

    schema_ver = int(raw.get("schema_version", SCHEMA_VERSION))
    tags = raw.get("tags", {}) or {}
    links = raw.get("links", {}) or {}
    enabled = bool(raw.get("enabled", True))
    back = raw.get("back", {}) or {}

    return CardDef(
        card_id=card_id,
        schema_version=schema_ver,
        subject=subject,
        unit=unit,
        type=ctype,
        grade_mode=grade_mode,
        front=front if isinstance(front, dict) else {},
        back=back if isinstance(back, dict) else {},
        answer_spec=answer_spec,
        tags=tags if isinstance(tags, dict) else {},
        links=links if isinstance(links, dict) else {},
        enabled=enabled,
    )


# ── 로드 함수 ─────────────────────────────────────────────────────────────────

def _load_manifest(mount: str) -> dict:
    path = os.path.join(mount, "manifest.json")
    if not os.path.exists(path):
        raise ManifestMissingError(f"manifest.json 없음: {path}")
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        raise ManifestMissingError(f"manifest.json 로드 실패: {e}") from e


def _load_deck(mount: str, namespace: str) -> DeckData:
    path = os.path.join(mount, "decks", f"{namespace}.json")
    if not os.path.exists(path):
        raise DeckNotFoundError(f"덱 파일 없음: {path}")
    try:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        raise ContentInjectionError(f"덱 파일 로드 실패({path}): {e}") from e

    _check(":" not in namespace,
           f"deck namespace에 콜론 금지: {namespace!r}")

    raw_cards = raw.get("cards", [])
    _check(isinstance(raw_cards, list),
           f"{namespace}: cards는 배열이어야 함")

    seen_ids: set[str] = set()
    cards: list[CardDef] = []
    for card_raw in raw_cards:
        cards.append(_parse_card(card_raw, seen_ids))

    return DeckData(namespace=namespace, cards=cards)


def _load_config(mount: str, namespace: str, config_ref: str | None) -> dict:
    if config_ref:
        path = os.path.join(mount, config_ref)
    else:
        path = os.path.join(mount, "config", f"{namespace}.json")

    if not os.path.exists(path):
        return {}  # config 없으면 기본값

    try:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        raise ContentInjectionError(f"config 로드 실패({path}): {e}") from e

    # synonyms 형태 검증
    syns = raw.get("synonyms", {})
    _check(isinstance(syns, dict),
           "config.synonyms는 객체여야 함")

    # normalize_profiles 형태 검증
    nprofiles = raw.get("normalize_profiles", {})
    _check(isinstance(nprofiles, dict),
           "config.normalize_profiles는 객체여야 함")
    for ctype, rules in nprofiles.items():
        _check(isinstance(rules, list),
               f"normalize_profiles.{ctype}는 배열이어야 함")
        for rule in rules:
            _check(rule in _VALID_NORM_RULES,
                   f"normalize_profiles.{ctype}: 알 수 없는 규칙 id: {rule!r}")

    # capabilities enabled 검증
    caps = raw.get("capabilities", {})
    if caps:
        enabled_list = caps.get("enabled", [])
        if enabled_list:
            _check(isinstance(enabled_list, list),
                   "capabilities.enabled는 배열이어야 함")
            for cap_id in enabled_list:
                _check(cap_id in _CORE_CAPABILITY_IDS,
                       f"알 수 없는 capability_id: {cap_id!r}")

    return raw


# ── 컴파일 함수 ───────────────────────────────────────────────────────────────

def _compile_synonyms(synonyms_raw: dict) -> dict[str, str]:
    """synonyms {대표어: [동의어...]} -> 역인덱스 {동의어: 대표어}."""
    result: dict[str, str] = {}
    for canonical, aliases in synonyms_raw.items():
        if isinstance(aliases, list):
            for alias in aliases:
                if isinstance(alias, str):
                    result[alias.lower()] = canonical.lower()
    return result


def _compile_grade_mode_map(cards: list[CardDef], scoring_overrides: dict) -> dict[str, str]:
    """card_id -> 실효 grade_mode (scoring_overrides 반영)."""
    result: dict[str, str] = {}
    for card in cards:
        override = scoring_overrides.get(card.card_id)
        if override and override in _VALID_GRADE_MODES:
            result[card.card_id] = override
        else:
            result[card.card_id] = card.grade_mode
    return result


def _compile_leitner_cfg(leitner_raw: dict | None) -> LeitnerConfig | None:
    if not leitner_raw:
        return None
    intervals_raw = leitner_raw.get("intervals_days", {})
    intervals = {int(k): int(v) for k, v in intervals_raw.items()}
    dday = int(leitner_raw.get("dday_compress_days", 1))
    return LeitnerConfig(intervals_days=intervals, dday_compress_days=dday)


def _compile_enabled_capabilities(caps_config: dict) -> set[str]:
    """능력 레지스트리. enabled 미지정이면 core 전체 활성."""
    enabled_list = caps_config.get("enabled", [])
    if not enabled_list:
        # 기본: core tier 전체 + layer4 core
        core_caps = {
            "card_render", "recall_self", "mcq_buttons", "mcq_select",
            "short_modal", "cloze_modal", "seq_modal", "reaction_quick",
            "feedback_inline", "paginate",
            "confidence_rate", "hint_progressive", "elaborate_ask", "read_resume",
            "srs_due_alert", "session_progress",
            "dashboard_live", "box_table", "digest_weekly",
            "gating", "event_trigger", "heartbeat", "coalesce_base",
        }
        return core_caps

    return set(enabled_list) | _LAYER4_ALWAYS


# ── 공개 API ──────────────────────────────────────────────────────────────────

def load(mount: str) -> BootResult:
    """콘텐츠 로드 + 검증 + 컴파일 + 진도 로드. 봇계약 §2 구현.

    ContentInjectionError -> 호출자(부트)에서 차단.
    ManifestMissingError -> 부트 실패.
    """
    manifest = _load_manifest(mount)

    decks_meta = manifest.get("decks", [])
    _check(isinstance(decks_meta, list) and len(decks_meta) >= 1,
           "manifest.decks는 배열(>=1)이어야 함")

    # 첫 번째 덱을 기본으로 사용 (다중 덱은 commands.py에서 선택)
    deck_meta = decks_meta[0]
    namespace = deck_meta.get("namespace", "")
    _check(bool(namespace), "manifest.decks[0].namespace 필수")
    _check(":" not in namespace, f"deck namespace에 콜론 금지: {namespace!r}")

    config_ref = deck_meta.get("config_ref")
    deck = _load_deck(mount, namespace)
    config = _load_config(mount, namespace, config_ref)

    # card_count 불일치 경고 (부트 차단은 아님, 주입인터페이스 §6)
    expected_count = deck_meta.get("card_count")
    actual_count = len(deck.cards)
    if expected_count is not None and expected_count != actual_count:
        log.warning("card_count 불일치: manifest=%d, 실제=%d", expected_count, actual_count)

    # 컴파일
    normalize_profiles: dict[str, list[str]] = config.get("normalize_profiles", {})
    synonyms_raw: dict = config.get("synonyms", {})
    synonyms = _compile_synonyms(synonyms_raw)

    scoring_overrides: dict = config.get("scoring_overrides", {})
    grade_mode_map = _compile_grade_mode_map(deck.cards, scoring_overrides)

    pass_targets: dict[str, int] = {
        k: int(v) for k, v in config.get("pass_targets", {}).items()
    }

    leitner_raw = config.get("leitner")
    leitner_cfg = _compile_leitner_cfg(leitner_raw) if leitner_raw else None

    caps_config: dict = config.get("capabilities", {})
    enabled_capabilities = _compile_enabled_capabilities(caps_config)

    ai_config: dict = caps_config.get("ai", {})
    ai_model: str | None = ai_config.get("model")
    ai_effort: str = ai_config.get("effort", "low")

    # 진도 로드
    store = _persist.load_progress(mount, namespace)

    return BootResult(
        mount=mount,
        deck=deck,
        config=config,
        store=store,
        normalize_profiles=normalize_profiles,
        synonyms=synonyms,
        grade_mode_map=grade_mode_map,
        pass_targets=pass_targets,
        leitner_cfg=leitner_cfg,
        enabled_capabilities=enabled_capabilities,
        ai_model=ai_model,
        ai_effort=ai_effort,
    )
