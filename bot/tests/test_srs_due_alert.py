# -*- coding: utf-8 -*-
"""Headless tests for srs_due_alert pure core.

Tests cards_to_alert and record_alert directly with a tempfile sidecar mount.
No live Discord connection required.
"""
from __future__ import annotations

import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import pytest

from models import CardProgress, ProgressStore, MS_PER_DAY
from caps.srs_due_alert import cards_to_alert, record_alert, CAP_ID, DAY_MS
import sidecar


# Helpers to build test fixtures ──────────────────────────────────────────────

def make_progress(card_id: str, due_at: int) -> CardProgress:
    """Build a CardProgress that is due when now >= due_at."""
    return CardProgress(card_id=card_id, due_at=due_at)


def make_store(entries: list[CardProgress]) -> ProgressStore:
    """Build a ProgressStore from a list of CardProgress objects."""
    return ProgressStore(
        schema_version=1,
        deck_namespace="test-deck",
        cards={p.card_id: p for p in entries},
    )


NOW = 1_000_000_000_000  # fixed epoch ms for determinism
ONE_DAY = MS_PER_DAY


# cards_to_alert: basic due / not-due filtering ───────────────────────────────

def test_due_card_returned():
    """A card whose due_at <= now is returned."""
    store = make_store([make_progress("card-a", NOW - 1)])
    result = cards_to_alert(store, NOW, {})
    assert result == ["card-a"]


def test_not_due_card_excluded():
    """A card whose due_at > now is not returned."""
    store = make_store([make_progress("card-a", NOW + ONE_DAY)])
    result = cards_to_alert(store, NOW, {})
    assert result == []


def test_due_at_exactly_now_is_due():
    """due_at == now counts as due (boundary inclusive)."""
    store = make_store([make_progress("card-a", NOW)])
    result = cards_to_alert(store, NOW, {})
    assert result == ["card-a"]


def test_mixed_due_and_not_due():
    """Only the due card surfaces when mixed with a not-due card."""
    store = make_store([
        make_progress("due-card", NOW - 1),
        make_progress("future-card", NOW + ONE_DAY),
    ])
    result = cards_to_alert(store, NOW, {})
    assert result == ["due-card"]


def test_empty_store_returns_empty():
    """Empty store returns empty list."""
    store = make_store([])
    result = cards_to_alert(store, NOW, {})
    assert result == []


# cards_to_alert: deduplication (min_interval_ms) ─────────────────────────────

def test_never_alerted_card_returns():
    """A due card with no prior alert entry is returned."""
    store = make_store([make_progress("card-a", NOW - 1)])
    result = cards_to_alert(store, NOW, {}, min_interval_ms=ONE_DAY)
    assert "card-a" in result


def test_alerted_within_interval_suppressed():
    """A card alerted recently (within min_interval_ms) is suppressed."""
    store = make_store([make_progress("card-a", NOW - 1)])
    alert_state = {"card-a": NOW - ONE_DAY + 1}  # alerted 1 ms less than a day ago
    result = cards_to_alert(store, NOW, alert_state, min_interval_ms=ONE_DAY)
    assert result == []


def test_alerted_exactly_at_interval_returns():
    """A card alerted exactly min_interval_ms ago passes the gate."""
    store = make_store([make_progress("card-a", NOW - 1)])
    alert_state = {"card-a": NOW - ONE_DAY}  # exactly one day ago
    result = cards_to_alert(store, NOW, alert_state, min_interval_ms=ONE_DAY)
    assert "card-a" in result


def test_alerted_past_interval_returns():
    """A card alerted more than min_interval_ms ago is returned again."""
    store = make_store([make_progress("card-a", NOW - 1)])
    alert_state = {"card-a": NOW - 2 * ONE_DAY}
    result = cards_to_alert(store, NOW, alert_state, min_interval_ms=ONE_DAY)
    assert "card-a" in result


def test_dedup_does_not_affect_other_cards():
    """Suppressing one card does not suppress a separate card in the same store."""
    store = make_store([
        make_progress("card-a", NOW - 1),
        make_progress("card-b", NOW - 1),
    ])
    alert_state = {"card-a": NOW - 100}  # card-a suppressed, card-b is new
    result = cards_to_alert(store, NOW, alert_state, min_interval_ms=ONE_DAY)
    assert "card-a" not in result
    assert "card-b" in result


# record_alert: sidecar persistence ───────────────────────────────────────────

def test_record_alert_writes_sidecar():
    """record_alert writes the alert timestamp to the sidecar file."""
    with tempfile.TemporaryDirectory() as mount:
        record_alert(mount, "test-deck", ["card-a"], NOW)
        state = sidecar.load_all(mount, CAP_ID, "test-deck")
        assert state["card-a"] == NOW


def test_record_alert_multiple_cards():
    """record_alert writes all card_ids in one call."""
    with tempfile.TemporaryDirectory() as mount:
        record_alert(mount, "test-deck", ["card-a", "card-b", "card-c"], NOW)
        state = sidecar.load_all(mount, CAP_ID, "test-deck")
        assert state["card-a"] == NOW
        assert state["card-b"] == NOW
        assert state["card-c"] == NOW


def test_record_alert_empty_list_is_noop():
    """record_alert with empty list does not create or modify the sidecar."""
    with tempfile.TemporaryDirectory() as mount:
        record_alert(mount, "test-deck", [], NOW)
        state = sidecar.load_all(mount, CAP_ID, "test-deck")
        assert state == {}


def test_record_alert_overwrites_previous():
    """record_alert updates an existing entry with the new timestamp."""
    with tempfile.TemporaryDirectory() as mount:
        record_alert(mount, "test-deck", ["card-a"], NOW - ONE_DAY)
        record_alert(mount, "test-deck", ["card-a"], NOW)
        state = sidecar.load_all(mount, CAP_ID, "test-deck")
        assert state["card-a"] == NOW


def test_record_alert_preserves_other_entries():
    """record_alert updates only the named cards, leaving others intact."""
    with tempfile.TemporaryDirectory() as mount:
        record_alert(mount, "test-deck", ["card-a"], NOW - ONE_DAY)
        record_alert(mount, "test-deck", ["card-b"], NOW)
        state = sidecar.load_all(mount, CAP_ID, "test-deck")
        assert state["card-a"] == NOW - ONE_DAY  # unchanged
        assert state["card-b"] == NOW


def test_record_alert_isolated_per_deck():
    """record_alert for deck1 does not affect deck2 sidecar."""
    with tempfile.TemporaryDirectory() as mount:
        record_alert(mount, "deck1", ["card-a"], NOW)
        state2 = sidecar.load_all(mount, CAP_ID, "deck2")
        assert state2 == {}


# Full round-trip: due card -> record -> dedup gate ────────────────────────────

def test_full_roundtrip_dedup():
    """Due card appears on first call; second call within interval returns empty."""
    with tempfile.TemporaryDirectory() as mount:
        store = make_store([make_progress("card-a", NOW - 1)])

        # First call: card-a is due and has no prior alert.
        state1 = sidecar.load_all(mount, CAP_ID, "deck-x")
        due1 = cards_to_alert(store, NOW, state1, min_interval_ms=ONE_DAY)
        assert due1 == ["card-a"]
        record_alert(mount, "deck-x", due1, NOW)

        # Second call within interval: card-a is still due but suppressed by dedup.
        state2 = sidecar.load_all(mount, CAP_ID, "deck-x")
        due2 = cards_to_alert(store, NOW + 1, state2, min_interval_ms=ONE_DAY)
        assert due2 == []

        # Third call after interval passes: card-a fires again.
        state3 = sidecar.load_all(mount, CAP_ID, "deck-x")
        due3 = cards_to_alert(store, NOW + ONE_DAY, state3, min_interval_ms=ONE_DAY)
        assert due3 == ["card-a"]


def test_custom_min_interval():
    """min_interval_ms can be set to a short value for fast dedup."""
    with tempfile.TemporaryDirectory() as mount:
        store = make_store([make_progress("card-a", NOW - 1)])
        short_interval = 5_000  # 5 seconds

        state = {"card-a": NOW - 10_000}  # alerted 10 s ago, > 5 s interval
        result = cards_to_alert(store, NOW, state, min_interval_ms=short_interval)
        assert "card-a" in result


def test_cap_id_constant():
    """CAP_ID must be the expected string."""
    assert CAP_ID == "srs_due_alert"


def test_day_ms_constant():
    """DAY_MS must equal MS_PER_DAY."""
    assert DAY_MS == MS_PER_DAY
