# -*- coding: utf-8 -*-
"""Tests for the study control panel (bot/control_panel.py)."""
import os
import sys
from types import SimpleNamespace

_BOT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _BOT_ROOT)

import _paths
_paths.setup()

import control_panel


def test_unit_for_mapping():
    assert control_panel.unit_for("learn", 1) == "day-01-learn"
    assert control_panel.unit_for("learn", 30) == "day-30-learn"
    assert control_panel.unit_for("quiz", 1) == "day-01"
    assert control_panel.unit_for("quiz", 7) == "day-07"


def _panel(caps):
    br = SimpleNamespace(enabled_capabilities=set(caps))
    return control_panel.ControlPanelView(None, br, None, 1)


def test_core_buttons_always_present():
    ids = {c.custom_id for c in _panel({"recall_self"}).children}
    for cid in ("panel:study", "panel:learn", "panel:quiz", "panel:review", "panel:stats", "panel:help"):
        assert cid in ids


def test_dashboard_button_gated():
    with_dash = {c.custom_id for c in _panel({"recall_self", "dashboard_live"}).children}
    without_dash = {c.custom_id for c in _panel({"recall_self"}).children}
    assert "panel:dashboard" in with_dash
    assert "panel:dashboard" not in without_dash
