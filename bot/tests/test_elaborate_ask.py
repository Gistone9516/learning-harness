# -*- coding: utf-8 -*-
"""Headless tests for caps/elaborate_ask.

Tests cover the pure core only (append_elaboration, get_elaborations).
No live Discord connection required.
"""
from __future__ import annotations

import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

# Import the module under test.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "caps"))
from elaborate_ask import append_elaboration, get_elaborations


# ── get_elaborations: absent key returns empty list ───────────────────────────

def test_get_elaborations_absent_returns_empty():
    with tempfile.TemporaryDirectory() as mount:
        result = get_elaborations(mount, "deck1", "card-a")
        assert result == []


# ── append_elaboration: single entry ─────────────────────────────────────────

def test_append_single():
    with tempfile.TemporaryDirectory() as mount:
        lst = append_elaboration(mount, "deck1", "card-a", "첫 번째 설명")
        assert lst == ["첫 번째 설명"]


# ── append_elaboration: accumulates across multiple calls ─────────────────────

def test_append_accumulates():
    with tempfile.TemporaryDirectory() as mount:
        append_elaboration(mount, "deck1", "card-a", "설명 1")
        append_elaboration(mount, "deck1", "card-a", "설명 2")
        lst = append_elaboration(mount, "deck1", "card-a", "설명 3")
        assert lst == ["설명 1", "설명 2", "설명 3"]
        # get_elaborations reflects same state
        assert get_elaborations(mount, "deck1", "card-a") == ["설명 1", "설명 2", "설명 3"]


# ── multiple card_ids are isolated from each other ────────────────────────────

def test_cards_isolated():
    with tempfile.TemporaryDirectory() as mount:
        append_elaboration(mount, "deck1", "card-a", "A의 설명")
        append_elaboration(mount, "deck1", "card-b", "B의 설명 1")
        append_elaboration(mount, "deck1", "card-b", "B의 설명 2")

        assert get_elaborations(mount, "deck1", "card-a") == ["A의 설명"]
        assert get_elaborations(mount, "deck1", "card-b") == ["B의 설명 1", "B의 설명 2"]


# ── different deck namespaces do not collide ─────────────────────────────────

def test_decks_isolated():
    with tempfile.TemporaryDirectory() as mount:
        append_elaboration(mount, "deck1", "card-a", "deck1 설명")
        append_elaboration(mount, "deck2", "card-a", "deck2 설명")

        assert get_elaborations(mount, "deck1", "card-a") == ["deck1 설명"]
        assert get_elaborations(mount, "deck2", "card-a") == ["deck2 설명"]


# ── persistence: survives a new get call (data written to disk) ───────────────

def test_persistence_across_calls():
    with tempfile.TemporaryDirectory() as mount:
        append_elaboration(mount, "deck1", "card-x", "저장된 설명")
        # Simulate fresh retrieval (new call, no in-memory state)
        result = get_elaborations(mount, "deck1", "card-x")
        assert result == ["저장된 설명"]


# ── append returns the full updated list (not just the new item) ──────────────

def test_append_return_value_is_full_list():
    with tempfile.TemporaryDirectory() as mount:
        append_elaboration(mount, "deck1", "card-r", "first")
        returned = append_elaboration(mount, "deck1", "card-r", "second")
        assert returned == ["first", "second"]
