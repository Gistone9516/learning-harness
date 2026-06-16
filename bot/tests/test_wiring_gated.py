# -*- coding: utf-8 -*-
"""Tests for gated capability wiring (bot/wiring.py)."""
import os
import sys

import pytest

_BOT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _BOT_ROOT)

import _paths
_paths.setup()

import capability_registry as reg
import bot_errors
import dispatch
import wiring


def test_verify_all_present_ok():
    # Full kit: every declared file exists, so no raise for the whole whitelist.
    wiring.verify_capability_files(set(reg.all_ids()))


def test_verify_missing_raises_named(monkeypatch):
    fake = reg.CapSpec(
        "fake_cap", 2, "core",
        files=("bot/handlers/__definitely_missing__.py",),
    )
    monkeypatch.setitem(reg.REGISTRY, "fake_cap", fake)
    with pytest.raises(bot_errors.ContentInjectionError) as ei:
        wiring.verify_capability_files({"fake_cap"})
    msg = str(ei.value)
    assert "fake_cap" in msg and "__definitely_missing__" in msg


def test_register_subset_only_enabled_plus_fallback():
    saved = dict(dispatch.HANDLERS)
    dispatch.HANDLERS.clear()
    try:
        registered = wiring.register_enabled_handlers({"mcq_buttons"})
        assert "mcq_buttons" in dispatch.HANDLERS
        assert "recall_self" in dispatch.HANDLERS   # always-on fallback
        assert "short_modal" not in dispatch.HANDLERS
        assert "seq_modal" not in dispatch.HANDLERS
        assert "ai_openend_grade" not in dispatch.HANDLERS
        assert set(registered) == {"mcq_buttons", "recall_self"}
    finally:
        dispatch.HANDLERS.clear()
        dispatch.HANDLERS.update(saved)


def test_register_ai_grade_when_enabled():
    saved = dict(dispatch.HANDLERS)
    dispatch.HANDLERS.clear()
    try:
        wiring.register_enabled_handlers({"cloze_modal", "ai_openend_grade"})
        assert "cloze_modal" in dispatch.HANDLERS
        assert "ai_openend_grade" in dispatch.HANDLERS
        assert "recall_self" in dispatch.HANDLERS
    finally:
        dispatch.HANDLERS.clear()
        dispatch.HANDLERS.update(saved)
