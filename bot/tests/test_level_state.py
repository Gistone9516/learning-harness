# -*- coding: utf-8 -*-
"""Tests for per-area level state (pure logic) and area/level card filters."""
import os
import sys
from types import SimpleNamespace

_BOT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _BOT_ROOT)

import _paths
_paths.setup()

import level_state as ls
from study_select import cards_in_area_level, cards_in_area_upto


def test_relevel_raise_marks_lower_learned():
    cards = [("v1", 1), ("v2", 2), ("v3", 3)]
    assert ls.relevel_learned_updates(cards, 1, 3) == {"v1": True, "v2": True}


def test_relevel_lower_unmarks_higher():
    cards = [("v1", 1), ("v2", 2), ("v3", 3)]
    assert ls.relevel_learned_updates(cards, 3, 1) == {"v2": False, "v3": False}


def test_relevel_same_no_change():
    assert ls.relevel_learned_updates([("v1", 1)], 2, 2) == {}


def test_area_from_label_and_clamp():
    # Area taxonomy now lives in the injected SubjectProfile, not in level_state.
    from subject import build_subject_profile
    s = build_subject_profile({"areas": [
        {"key": "vocab", "label": "단어", "aliases": ["어휘"]},
        {"key": "grammar", "label": "문법"},
        {"key": "idiom", "label": "숙어"},
    ]})
    assert s.area_from_label("단어") == "vocab"
    assert s.area_from_label("어휘") == "vocab"
    assert s.area_from_label("문법") == "grammar"
    assert s.area_from_label("숙어") == "idiom"
    assert s.area_from_label("없는라벨") is None
    assert ls.clamp_level(0) == 1 and ls.clamp_level(11) == 10 and ls.clamp_level(5) == 5


def _c(cid, area, lvl):
    return SimpleNamespace(card_id=cid, tags={"area": area, "level": lvl}, unit="")


def test_area_level_filters_never_above():
    cards = [_c("a", "vocab", 1), _c("b", "vocab", 2), _c("c", "vocab", 3), _c("d", "grammar", 2)]
    assert {x.card_id for x in cards_in_area_level(cards, "vocab", 2)} == {"b"}
    # upto level 2 must include 1 and 2 but NEVER level 3 (difficulty continuity)
    assert {x.card_id for x in cards_in_area_upto(cards, "vocab", 2)} == {"a", "b"}
