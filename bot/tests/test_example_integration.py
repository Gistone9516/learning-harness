# -*- coding: utf-8 -*-
"""Cross-partition integration tests (opus).

Verifies the full boot -> queue -> score -> transition -> persist round-trip
using real examples mock content. Copies to a temp directory before booting
to avoid polluting the examples originals.
"""
from __future__ import annotations

import os
import shutil
import sys
import tempfile

_BOT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _BOT_ROOT)
import _paths
_paths.setup()

import boot
import persist
from models import ScoreInput, QueueOptions, BOX_MIN
from selection import build_queue
from scoring import score
from leitner import leitner_transition

NOW = 1_000_000_000_000
_EXAMPLE = os.path.join(os.path.dirname(_BOT_ROOT), "examples")


def _mount_copy():
    tmp = tempfile.mkdtemp(prefix="clf_ex_")
    dst = os.path.join(tmp, "example")
    shutil.copytree(_EXAMPLE, dst)
    return tmp, dst


def test_boot_example_loads():
    tmp, mount = _mount_copy()
    try:
        r = boot.load(mount)
        assert r.deck.namespace == "demo-core"
        assert len(r.deck.cards) == 6
        # compile result
        assert isinstance(r.synonyms, dict)
        assert len(r.grade_mode_map) == 6
        assert isinstance(r.pass_targets, dict) and len(r.pass_targets) >= 1
        assert len(r.enabled_capabilities) >= 1            # not specified -> full core
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_queue_all_new():
    tmp, mount = _mount_copy()
    try:
        r = boot.load(mount)
        q = build_queue(r.deck.cards, r.store, NOW,
                        QueueOptions(deck_namespace="demo-core"))
        assert len(q) == 6                                 # all new -> entire deck queued
        assert set(q) == {c.card_id for c in r.deck.cards}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_score_exact_card_correct():
    tmp, mount = _mount_copy()
    try:
        r = boot.load(mount)
        # pick one card whose effective grade_mode is exact
        card = next(
            c for c in r.deck.cards
            if r.grade_mode_map[c.card_id] == "exact"
            and c.answer_spec and c.answer_spec.accepted
        )
        gold = card.answer_spec.accepted[0]
        res = score(ScoreInput(mode="exact", user_answer=gold,
                               answer_spec=card.answer_spec, synonyms=r.synonyms))
        assert res.verdict == "correct"
        # wrong answer
        res2 = score(ScoreInput(mode="exact", user_answer="__확실히틀린답__",
                                answer_spec=card.answer_spec, synonyms=r.synonyms))
        assert res2.verdict == "incorrect"
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_full_loop_persist_roundtrip():
    tmp, mount = _mount_copy()
    try:
        r = boot.load(mount)
        card = r.deck.cards[0]
        st = r.store.cards.get(card.card_id) or persist_new(r, card.card_id)
        # cold correct answer -> box promotion
        new_state = leitner_transition(st, "cold", "correct", NOW, r.leitner_cfg)
        assert new_state.box == BOX_MIN + 1
        assert new_state.cold_attempts == 1 and new_state.cold_correct == 1
        r.store.cards[card.card_id] = new_state
        persist.save_progress(mount, r.store)
        # reload -> verify persistence
        reloaded = persist.load_progress(mount, "demo-core")
        assert reloaded.cards[card.card_id].box == BOX_MIN + 1
        assert reloaded.cards[card.card_id].cold_correct == 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def persist_new(r, card_id):
    from migrate import new_card_progress
    return new_card_progress(card_id)
