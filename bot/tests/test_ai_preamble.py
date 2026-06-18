# -*- coding: utf-8 -*-
"""Tests for the safety + output-language preamble (bot/ai_caps.build_preamble)."""
import os
import sys

_BOT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _BOT_ROOT)

import _paths
_paths.setup()

import ai_caps
from ai_caps import build_preamble, _SAFETY


def test_preamble_always_has_safety_rules():
    s = build_preamble("Do the task.", persona="tutor", output_lang="Korean")
    assert _SAFETY in s                         # anti-hallucination rules always present
    assert "Do the task." in s                  # role
    assert "Persona: tutor." in s               # persona
    # the safety block forbids claiming unlisted knowledge (the user's exact concern)
    assert "not listed here" in s


def test_preamble_output_language_is_configurable():
    assert "Korean" in build_preamble("x", output_lang="Korean")
    assert "English" in build_preamble("x", output_lang="English")
    # output-language clause governs everything the learner reads
    assert "the learner reads" in build_preamble("x", output_lang="Korean")


def test_preamble_force_json_keeps_verdict_directive():
    s = build_preamble("x", force_json=True, output_lang="Korean")
    assert '"verdict"' in s and "Korean" in s   # JSON format + Korean reason coexist


def test_safety_block_is_subject_agnostic():
    # the safety constant itself must carry no subject/language literal
    for tok in ("영어", "영작", "Korean", "English"):
        assert tok not in _SAFETY
