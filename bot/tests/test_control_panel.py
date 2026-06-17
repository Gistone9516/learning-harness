# -*- coding: utf-8 -*-
"""Tests for the catalog learning-hub control panel (bot/control_panel.py)."""
import os
import sys
from types import SimpleNamespace

_BOT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _BOT_ROOT)

import _paths
_paths.setup()

import control_panel


def _card(cid, area, level=1):
    return SimpleNamespace(card_id=cid, tags={"area": area, "level": level},
                           front={"prompt": cid}, back={})


def _panel(caps, cards):
    br = SimpleNamespace(
        mount=".", deck=SimpleNamespace(namespace="t", cards=cards),
        enabled_capabilities=set(caps),
    )
    return control_panel.ControlPanelView(None, br, None, 1)


def test_area_buttons_only_for_areas_with_cards():
    ids = {c.custom_id for c in _panel({"recall_self"}, [_card("a", "vocab"), _card("b", "grammar")]).children}
    assert "panel:area:vocab" in ids
    assert "panel:area:grammar" in ids
    assert "panel:area:idiom" not in ids   # no idiom cards


def test_common_buttons_present():
    ids = {c.custom_id for c in _panel({"recall_self"}, [_card("a", "vocab")]).children}
    for cid in ("panel:review", "panel:clear", "panel:help"):
        assert cid in ids


def test_convo_and_dashboard_gated():
    on = {c.custom_id for c in _panel({"ai_convo", "dashboard_live"}, [_card("a", "vocab")]).children}
    assert "panel:convo" in on and "panel:dashboard" in on
    off = {c.custom_id for c in _panel({"recall_self"}, [_card("a", "vocab")]).children}
    assert "panel:convo" not in off and "panel:dashboard" not in off


def test_status_text_lists_areas():
    br = SimpleNamespace(mount=".", deck=SimpleNamespace(namespace="t", cards=[_card("a", "vocab")]),
                         enabled_capabilities=set())
    txt = control_panel.status_text(br)
    assert "학습 제어판" in txt and "단어" in txt
