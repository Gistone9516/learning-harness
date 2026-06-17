# -*- coding: utf-8 -*-
"""Regression tests for bugs found in the harness bug audit (engine layer)."""
import os
import sys

import pytest

_BOT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _BOT_ROOT)

import _paths
_paths.setup()

from models import AnswerSpec, ScoreInput
from scoring import score
from errors import ScoreInputError, SchemaVersionError
import migrate as _migrate


def test_recall_seq_partial_feedback():
    # length-match but one wrong step: correct steps must not appear in missed.
    spec = AnswerSpec(normalize=["trim"], sequence=["a", "b", "c"])
    res = score(ScoreInput(mode="exact", user_answer=["a", "x", "c"], answer_spec=spec))
    assert res.verdict == "incorrect"
    assert res.matched == ["a", "c"]
    assert res.missed == ["b"]
    assert res.feedback["highlight_missed"] == ["b"]


def test_keyword_empty_groups_raises():
    spec = AnswerSpec(normalize=[], required_keywords=[])
    with pytest.raises(ScoreInputError):
        score(ScoreInput(mode="keyword", user_answer="anything", answer_spec=spec))


def test_cloze_empty_blanks_raises():
    spec = AnswerSpec(normalize=[], blanks=[])
    with pytest.raises(ScoreInputError):
        score(ScoreInput(mode="cloze", user_answer=[], answer_spec=spec))


def test_migrate_non_numeric_schema_version_raises():
    with pytest.raises(SchemaVersionError):
        _migrate.migrate({"schema_version": "1.0", "deck_namespace": "ns", "cards": {}})
