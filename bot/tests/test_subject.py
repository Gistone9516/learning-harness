# -*- coding: utf-8 -*-
"""Tests for SubjectProfile (area taxonomy + AI task injection) — bot/subject.py."""
import os
import sys

_BOT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _BOT_ROOT)

import _paths
_paths.setup()

from subject import build_subject_profile, task_of, SubjectProfile


def _english_cfg():
    return {
        "areas": [
            {"key": "vocab", "label": "단어", "icon": "📚", "aliases": ["어휘"]},
            {"key": "grammar", "label": "문법", "icon": "📖"},
        ],
        "capabilities": {"ai": {"tasks": {
            "practice": {"role": "OVERRIDE_ROLE", "problem_prefix": "✍️ 영작 문제."},
        }}},
    }


def test_areas_parsed():
    s = build_subject_profile(_english_cfg())
    assert s.area_keys() == ["vocab", "grammar"]
    assert s.ko_label("vocab") == "단어"
    assert s.icon_of("grammar") == "📖"
    assert s.area_from_label("어휘") == "vocab"
    assert s.has_areas() is True


def test_unknown_area_key_passthrough():
    s = build_subject_profile(_english_cfg())
    assert s.ko_label("nope") == "nope"   # unknown key returns itself
    assert s.icon_of("nope") == ""
    assert s.area_from_label("nope") is None


def test_empty_profile_is_subject_agnostic():
    s = build_subject_profile({})
    assert s.area_keys() == [] and s.has_areas() is False
    # falls back to generic defaults (no subject literal)
    assert "영작" not in s.task("practice", "role")
    assert s.task("practice", "modal_title") == "답안 작성"


def test_task_override_wins_else_default():
    s = build_subject_profile(_english_cfg())
    assert s.task("practice", "role") == "OVERRIDE_ROLE"          # override
    assert s.task("practice", "problem_prefix") == "✍️ 영작 문제."  # override
    assert s.task("practice", "modal_title") == "답안 작성"        # default (not overridden)
    assert s.task("convo", "thread_title") == "🗣 대화 연습"        # default


def test_task_of_ctx_fallback_when_no_subject():
    class _Ctx:
        subject = None
    assert task_of(_Ctx(), "explain", "role")                      # returns generic default
    assert task_of(_Ctx(), "nope", "nope") == ""

    class _Ctx2:
        subject = build_subject_profile(_english_cfg())
    assert task_of(_Ctx2(), "practice", "role") == "OVERRIDE_ROLE"
