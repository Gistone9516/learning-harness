# -*- coding: utf-8 -*-
"""Boot module (bot-contract §2, SoT §3 implementation).

Content load (manifest -> deck -> config) -> validation (ContentInjectionError) ->
compile (normalized profiles, synonyms reverse index, effective grade_mode map, pass_targets) ->
capability registry -> progress load (persist + engine.migrate).

No discord imports allowed - pure logic, headless-testable.
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
import capability_registry as _reg

log = logging.getLogger(__name__)

# Allowed card_id regex (SoT §2)
_CARD_ID_RE = re.compile(r"^[a-z][a-z0-9-]{2,63}$")

# Allowed normalization rule ids (9 types defined in engine-contract §3.4)
_VALID_NORM_RULES = {
    "nfkc", "trim", "collapse_space", "strip_all_space", "lower",
    "fullwidth_to_halfwidth", "unify_cell_dollar", "unify_arg_sep",
    "strip_trailing_paren",
}

_VALID_CARD_TYPES = {"func", "proc", "recall_seq", "cloze", "judge"}
_VALID_GRADE_MODES = {"exact", "keyword", "cloze", "self"}

# Capability id whitelist + layer-4-always set are derived from the capability
# registry (single source of truth). See bot/capability_registry.py.
_CORE_CAPABILITY_IDS = set(_reg.all_ids())

# Layer 4 always active (regardless of the enabled set).
_LAYER4_ALWAYS = set(_reg.layer4_always())


from subject import SubjectProfile, build_subject_profile


@dataclass
class BootResult:
    """Return value of boot.load()."""
    mount: str
    deck: DeckData
    config: dict
    store: ProgressStore
    # Compiled results
    normalize_profiles: dict[str, list[str]]        # type -> normalization rule list
    synonyms: dict[str, str]                        # reverse index: alias -> canonical
    grade_mode_map: dict[str, str]                  # card_id -> effective grade_mode
    pass_targets: dict[str, int]                    # subarea -> target score
    leitner_cfg: LeitnerConfig | None
    enabled_capabilities: set[str]
    ai_model: str | None
    ai_effort: str
    ai_persona: str | None = None
    ai_model_explain: str | None = None
    subject: SubjectProfile | None = None           # injected area taxonomy + AI task overrides
    output_lang: str = "Korean"                      # AI natural-language output language (.env USER_LANG)


# -- Validation helpers -------------------------------------------------------

def _check(cond: bool, msg: str) -> None:
    if not cond:
        raise ContentInjectionError(msg)


def _validate_card_id(card_id: str, seen: set[str]) -> None:
    _check(bool(_CARD_ID_RE.match(card_id)),
           f"card_id regex violation: {card_id!r}")
    _check(":" not in card_id, f"colon not allowed in card_id: {card_id!r}")
    _check(card_id not in seen, f"duplicate card_id: {card_id!r}")


def _validate_answer_spec(card_id: str, ctype: str, grade_mode: str, spec_raw: Any) -> AnswerSpec | None:
    if grade_mode == "self":
        _check(spec_raw is None,
               f"{card_id}: answer_spec must be null for self grade_mode")
        return None

    _check(spec_raw is not None,
           f"{card_id}: answer_spec required when grade_mode={grade_mode}")
    _check(isinstance(spec_raw, dict),
           f"{card_id}: answer_spec must be an object")

    normalize = spec_raw.get("normalize", [])
    _check(isinstance(normalize, list),
           f"{card_id}: answer_spec.normalize must be an array")
    for rule in normalize:
        _check(rule in _VALID_NORM_RULES,
               f"{card_id}: unknown normalize rule id: {rule!r}")

    accepted = spec_raw.get("accepted")
    required_keywords = spec_raw.get("required_keywords")
    blanks = spec_raw.get("blanks")
    sequence = spec_raw.get("sequence")

    if grade_mode == "exact" and ctype != "recall_seq":
        _check(isinstance(accepted, list) and len(accepted) >= 1,
               f"{card_id}: exact mode requires accepted array (>=1)")
    elif grade_mode == "keyword":
        _check(isinstance(required_keywords, list) and len(required_keywords) >= 1,
               f"{card_id}: keyword mode requires required_keywords array (>=1 group)")
    elif grade_mode == "cloze":
        _check(isinstance(blanks, list) and len(blanks) >= 1,
               f"{card_id}: cloze mode requires blanks array")
        if ctype == "cloze":
            # marker count vs blanks count consistency is checked in load_deck
            pass
    elif grade_mode == "exact" and ctype == "recall_seq":
        pass  # sequence is handled via front/back structure

    return AnswerSpec(
        normalize=normalize,
        accepted=accepted,
        required_keywords=required_keywords,
        blanks=blanks,
        sequence=sequence,
    )


def _count_cloze_markers(text: str) -> int:
    """Return the number of {{N}} markers (indices must be contiguous from 0)."""
    markers = re.findall(r"\{\{(\d+)\}\}", text)
    return len(set(markers))


def _validate_front(card_id: str, ctype: str, front: dict, spec_raw: Any) -> None:
    """Validate front key consistency per type (injection-interface §4)."""
    if ctype in ("func", "proc"):
        _check("prompt" in front,
               f"{card_id}: {ctype} card front requires 'prompt'")
    elif ctype == "recall_seq":
        _check("prompt" in front,
               f"{card_id}: recall_seq card front requires 'prompt'")
        if spec_raw and isinstance(spec_raw, dict):
            seq = spec_raw.get("sequence")
            _check(isinstance(seq, list) and len(seq) >= 1,
                   f"{card_id}: recall_seq answer_spec.sequence must be array (>=1)")
    elif ctype == "cloze":
        _check("text" in front,
               f"{card_id}: cloze card front requires 'text'")
        if spec_raw and isinstance(spec_raw, dict):
            blanks = spec_raw.get("blanks")
            if isinstance(blanks, list):
                marker_count = _count_cloze_markers(str(front.get("text", "")))
                _check(marker_count == len(blanks),
                       f"{card_id}: cloze marker count ({marker_count}) != blanks count ({len(blanks)})")
    elif ctype == "judge":
        _check("scenario" in front or "prompt" in front,
               f"{card_id}: judge card front requires 'scenario' or 'prompt'")
        _check("options" in front and isinstance(front["options"], list),
               f"{card_id}: judge card front requires 'options' array")


def _parse_card(raw: dict, seen_ids: set[str]) -> CardDef:
    """Parse a card dict into CardDef with validation."""
    card_id = raw.get("card_id", "")
    _validate_card_id(card_id, seen_ids)
    seen_ids.add(card_id)

    subject = raw.get("subject", "")
    unit = raw.get("unit", "")
    _check(bool(subject), f"{card_id}: 'subject' required")
    _check(bool(unit), f"{card_id}: 'unit' required")

    ctype = raw.get("type", "")
    _check(ctype in _VALID_CARD_TYPES,
           f"{card_id}: unknown type: {ctype!r}")

    grade_mode = raw.get("grade_mode", "")
    _check(grade_mode in _VALID_GRADE_MODES,
           f"{card_id}: unknown grade_mode: {grade_mode!r}")

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


# -- Load functions -----------------------------------------------------------

def _load_manifest(mount: str) -> dict:
    path = os.path.join(mount, "manifest.json")
    if not os.path.exists(path):
        raise ManifestMissingError(f"manifest.json not found: {path}")
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        raise ManifestMissingError(f"failed to load manifest.json: {e}") from e


def _load_deck(mount: str, namespace: str) -> DeckData:
    path = os.path.join(mount, "decks", f"{namespace}.json")
    if not os.path.exists(path):
        raise DeckNotFoundError(f"deck file not found: {path}")
    try:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        raise ContentInjectionError(f"failed to load deck file ({path}): {e}") from e

    _check(":" not in namespace,
           f"colon not allowed in deck namespace: {namespace!r}")

    raw_cards = raw.get("cards", [])
    _check(isinstance(raw_cards, list),
           f"{namespace}: cards must be an array")

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
        return {}  # use defaults when config is absent

    try:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        raise ContentInjectionError(f"failed to load config ({path}): {e}") from e

    # Validate synonyms shape
    syns = raw.get("synonyms", {})
    _check(isinstance(syns, dict),
           "config.synonyms must be an object")

    # Validate normalize_profiles shape
    nprofiles = raw.get("normalize_profiles", {})
    _check(isinstance(nprofiles, dict),
           "config.normalize_profiles must be an object")
    for ctype, rules in nprofiles.items():
        _check(isinstance(rules, list),
               f"normalize_profiles.{ctype} must be an array")
        for rule in rules:
            _check(rule in _VALID_NORM_RULES,
                   f"normalize_profiles.{ctype}: unknown rule id: {rule!r}")

    # Validate capabilities enabled list
    caps = raw.get("capabilities", {})
    if caps:
        enabled_list = caps.get("enabled", [])
        _check(isinstance(enabled_list, list),
               "capabilities.enabled must be an array")
        for cap_id in enabled_list:
            _check(cap_id in _CORE_CAPABILITY_IDS,
                   f"unknown capability_id: {cap_id!r}")

    return raw


# -- Compile functions --------------------------------------------------------

def _compile_synonyms(synonyms_raw: dict) -> dict[str, str]:
    """Convert synonyms {canonical: [alias...]} to reverse index {alias: canonical}."""
    result: dict[str, str] = {}
    for canonical, aliases in synonyms_raw.items():
        if isinstance(aliases, list):
            for alias in aliases:
                if isinstance(alias, str):
                    result[alias.lower()] = canonical.lower()
    return result


def _compile_grade_mode_map(cards: list[CardDef], scoring_overrides: dict) -> dict[str, str]:
    """Build card_id -> effective grade_mode map, applying scoring_overrides."""
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
    """Build capability registry. If enabled is not specified, activate all core capabilities."""
    enabled_list = caps_config.get("enabled", [])
    if not enabled_list:
        # Default: full core tier (layer 2 + layer 4 core), derived from the registry.
        return set(_reg.default_core_ids())

    return set(enabled_list) | _LAYER4_ALWAYS


# -- Public API ---------------------------------------------------------------

def load(mount: str) -> BootResult:
    """Load, validate, compile content, then load progress. Implements bot-contract §2.

    ContentInjectionError -> caller (boot) blocks.
    ManifestMissingError -> boot fails.
    """
    manifest = _load_manifest(mount)

    decks_meta = manifest.get("decks", [])
    _check(isinstance(decks_meta, list) and len(decks_meta) >= 1,
           "manifest.decks must be an array (>=1)")

    # Use the first deck as default (multi-deck selection is handled in commands.py)
    deck_meta = decks_meta[0]
    namespace = deck_meta.get("namespace", "")
    _check(bool(namespace), "manifest.decks[0].namespace required")
    _check(":" not in namespace, f"colon not allowed in deck namespace: {namespace!r}")

    config_ref = deck_meta.get("config_ref")
    deck = _load_deck(mount, namespace)
    config = _load_config(mount, namespace, config_ref)

    # Warn on card_count mismatch (non-blocking, injection-interface §6)
    expected_count = deck_meta.get("card_count")
    actual_count = len(deck.cards)
    if expected_count is not None and expected_count != actual_count:
        log.warning("card_count mismatch: manifest=%d, actual=%d", expected_count, actual_count)

    # Compile
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
    # Model ids come from .env (single source; swappable) with config as fallback.
    ai_model: str | None = os.environ.get("AI_MODEL") or ai_config.get("model")
    ai_effort: str = ai_config.get("effort", "low")
    ai_persona: str | None = ai_config.get("persona")
    ai_model_explain: str | None = (
        os.environ.get("AI_MODEL_EXPLAIN") or ai_config.get("model_explain") or ai_model
    )

    # Output language for AI natural-language text (.env USER_LANG; default Korean). Injected into
    # every AI preamble so the kit need not hardcode a language (stays subject/locale-agnostic).
    _LANG_NAMES = {"ko": "Korean", "en": "English", "ja": "Japanese", "zh": "Chinese",
                   "es": "Spanish", "fr": "French", "de": "German"}
    user_lang = (os.environ.get("USER_LANG") or "ko").strip().lower()
    output_lang = _LANG_NAMES.get(user_lang, "Korean")

    # Subject profile: area taxonomy + per-capability AI task overrides (injection §5).
    subject = build_subject_profile(config)

    # Verify the enabled capabilities have their required files present (partial-clone guard).
    from wiring import verify_capability_files
    verify_capability_files(enabled_capabilities)

    # Load progress
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
        ai_persona=ai_persona,
        ai_model_explain=ai_model_explain,
        subject=subject,
        output_lang=output_lang,
    )
