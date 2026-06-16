# -*- coding: utf-8 -*-
"""Headless tests (bot-contract §9).

Validates boot + full session loop without Discord.
Uses inline mock content (small self-contained deck) + fake handler (returns preset verdicts).
Test targets: boot (normal / ContentInjectionError violation), session loop (present -> classify -> verdict -> transition -> save -> requeue).
pytest style.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
import time

# Add bot root to sys.path
_BOT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _BOT_ROOT)
import _paths
_paths.setup()

import pytest

from models import (
    CardDef, AnswerSpec, DeckData,
    ProgressStore, QueueOptions, HandlerResult,
    BOX_MIN, BOX_MAX, SCHEMA_VERSION,
)
from bot_errors import ContentInjectionError, ManifestMissingError

import boot as _boot
from session import Session, run_session
import persist as _persist
from context import Ctx


# ── Mock content helper ───────────────────────────────────────────────────────

def _write_json(path: str, data: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _make_minimal_mount(tmp_dir: str) -> str:
    """Build a minimal mount folder for testing. Self-contained mock deck (3 cards)."""
    mount = os.path.join(tmp_dir, "test_mount")

    manifest = {
        "schema_version": 1,
        "subject": "test",
        "decks": [
            {
                "namespace": "test-deck",
                "title": "테스트 덱",
                "card_count": 3,
                "built_at": 1718000000000,
            }
        ],
    }
    _write_json(os.path.join(mount, "manifest.json"), manifest)

    deck_data = {
        "namespace": "test-deck",
        "cards": [
            {
                "card_id": "tst-func-01",
                "schema_version": 1,
                "subject": "test",
                "unit": "unit1",
                "type": "func",
                "grade_mode": "exact",
                "front": {"prompt": "1+1은?"},
                "back": {"detail": "2입니다"},
                "answer_spec": {
                    "accepted": ["2"],
                    "normalize": ["nfkc", "trim", "lower"],
                },
                "tags": {"weight": 5},
                "links": {},
                "enabled": True,
            },
            {
                "card_id": "tst-cloze-01",
                "schema_version": 1,
                "subject": "test",
                "unit": "unit2",
                "type": "cloze",
                "grade_mode": "cloze",
                "front": {"text": "파이썬은 {{0}} 언어다."},
                "back": {"detail": "동적 타이핑"},
                "answer_spec": {
                    "blanks": [["동적", "dynamic"]],
                    "normalize": ["nfkc", "trim", "lower"],
                },
                "tags": {"weight": 5},
                "links": {},
                "enabled": True,
            },
            {
                "card_id": "tst-self-01",
                "schema_version": 1,
                "subject": "test",
                "unit": "unit1",
                "type": "func",
                "grade_mode": "self",
                "front": {"prompt": "자신의 이름을 말해보세요."},
                "back": {},
                "answer_spec": None,
                "tags": {"weight": 3},
                "links": {},
                "enabled": True,
            },
        ],
    }
    _write_json(os.path.join(mount, "decks", "test-deck.json"), deck_data)

    config = {
        "normalize_profiles": {
            "func": ["nfkc", "trim", "lower"],
            "cloze": ["nfkc", "trim", "lower"],
        },
        "synonyms": {},
        "scoring_overrides": {},
        "pass_targets": {},
    }
    _write_json(os.path.join(mount, "config", "test-deck.json"), config)

    return mount


def _make_invalid_mount_card_id(tmp_dir: str) -> str:
    """Triggers ContentInjectionError: card_id fails regex validation."""
    mount = os.path.join(tmp_dir, "bad_mount")
    manifest = {
        "schema_version": 1,
        "subject": "bad",
        "decks": [{"namespace": "bad-deck", "title": "Bad", "card_count": 1, "built_at": 0}],
    }
    _write_json(os.path.join(mount, "manifest.json"), manifest)
    deck_data = {
        "namespace": "bad-deck",
        "cards": [
            {
                "card_id": "BAD:ID",  # regex violation: contains colon
                "schema_version": 1, "subject": "bad", "unit": "u1",
                "type": "func", "grade_mode": "exact",
                "front": {"prompt": "x"},
                "back": {},
                "answer_spec": {"accepted": ["x"], "normalize": []},
                "tags": {}, "links": {}, "enabled": True,
            }
        ],
    }
    _write_json(os.path.join(mount, "decks", "bad-deck.json"), deck_data)
    return mount


def _make_invalid_mount_no_answer(tmp_dir: str) -> str:
    """Triggers ContentInjectionError: exact mode with empty answer_spec.accepted."""
    mount = os.path.join(tmp_dir, "bad_mount2")
    manifest = {
        "schema_version": 1, "subject": "bad",
        "decks": [{"namespace": "bad2", "title": "Bad2", "card_count": 1, "built_at": 0}],
    }
    _write_json(os.path.join(mount, "manifest.json"), manifest)
    deck_data = {
        "namespace": "bad2",
        "cards": [
            {
                "card_id": "bad-card-01",
                "schema_version": 1, "subject": "bad", "unit": "u1",
                "type": "func", "grade_mode": "exact",
                "front": {"prompt": "x"},
                "back": {},
                "answer_spec": {"accepted": [], "normalize": []},  # accepted is empty
                "tags": {}, "links": {}, "enabled": True,
            }
        ],
    }
    _write_json(os.path.join(mount, "decks", "bad2.json"), deck_data)
    return mount


# ── Fake handler ──────────────────────────────────────────────────────────────

def _make_fake_handler(verdicts: list[str]):
    """Returns preset verdicts in order."""
    _idx = [0]

    async def handler(ctx, card: CardDef) -> HandlerResult:
        v = verdicts[_idx[0] % len(verdicts)]
        _idx[0] += 1
        is_incorrect = v == "incorrect"
        return HandlerResult(
            card_id=card.card_id,
            verdict=v,
            requeue=is_incorrect,
            done=True,
        )
    return handler


def _make_ctx(boot_result, session: Session, mount: str):
    """Build a Ctx for testing."""
    br = boot_result
    return Ctx(
        channel=None,
        user_id=0,
        store=br.store,
        deck=br.deck,
        mount=mount,
        deck_namespace=br.deck.namespace,
        synonyms=br.synonyms,
        grade_mode_of=lambda cid: br.grade_mode_map.get(cid, "exact"),
        leitner_cfg=br.leitner_cfg,
        ai_model=None,
        ai_effort="low",
        sid=None,
        session=session,
        emit=None,
    )


# ── Test functions ────────────────────────────────────────────────────────────

def test_boot_ok():
    """Valid mount: boot.load succeeds; deck, synonyms, and grade_mode_map are loaded."""
    with tempfile.TemporaryDirectory() as tmp:
        mount = _make_minimal_mount(tmp)
        br = _boot.load(mount)

    assert br.deck.namespace == "test-deck"
    assert len(br.deck.cards) == 3
    # grade_mode_map compiled
    card_ids = {c.card_id for c in br.deck.cards}
    assert "tst-func-01" in card_ids
    assert "tst-self-01" in card_ids
    # self card maps to grade_mode "self"
    assert br.grade_mode_map["tst-self-01"] == "self"
    assert br.grade_mode_map["tst-func-01"] == "exact"
    # ProgressStore loaded (new store = empty)
    assert br.store.schema_version == SCHEMA_VERSION
    assert br.store.deck_namespace == "test-deck"


def test_boot_content_injection_bad_card_id():
    """card_id regex violation raises ContentInjectionError."""
    with tempfile.TemporaryDirectory() as tmp:
        mount = _make_invalid_mount_card_id(tmp)
        with pytest.raises(ContentInjectionError):
            _boot.load(mount)


def test_boot_content_injection_no_accepted():
    """exact mode with empty accepted raises ContentInjectionError."""
    with tempfile.TemporaryDirectory() as tmp:
        mount = _make_invalid_mount_no_answer(tmp)
        with pytest.raises(ContentInjectionError):
            _boot.load(mount)


def test_boot_manifest_missing():
    """Missing manifest.json raises ManifestMissingError."""
    with tempfile.TemporaryDirectory() as tmp:
        mount = os.path.join(tmp, "empty_mount")
        os.makedirs(mount, exist_ok=True)
        with pytest.raises(ManifestMissingError):
            _boot.load(mount)


def test_session_full_loop_correct():
    """Full loop: all cards correct -> box promotion and save verified."""
    with tempfile.TemporaryDirectory() as tmp:
        mount = _make_minimal_mount(tmp)
        br = _boot.load(mount)

        sess = Session()
        ctx = _make_ctx(br, sess, mount)
        opts = QueueOptions(deck_namespace="test-deck")

        now_ms = int(time.time() * 1000)
        handler = _make_fake_handler(["correct"])

        asyncio.run(run_session(
            ctx=ctx,
            deck_cards=br.deck.cards,
            store=br.store,
            mount=mount,
            opts=opts,
            handler=handler,
            now_fn=lambda: now_ms,
        ))

        # 3 cards attempted
        assert sess.stats.total_attempts == 3
        # self card gets verdict="correct" from fake handler too
        # box promotion must occur (cold+correct -> box up)
        for cp in br.store.cards.values():
            assert cp.box >= 2 or cp.graduated, f"{cp.card_id}: box={cp.box}"

        # saved file check
        saved_path = os.path.join(mount, "_state", "progress-test-deck.json")
        assert os.path.exists(saved_path)
        with open(saved_path, encoding="utf-8") as f:
            saved = json.load(f)
        assert saved["deck_namespace"] == "test-deck"
        assert len(saved["cards"]) == 3


def test_session_full_loop_incorrect_requeue():
    """Full loop: first card incorrect -> added to requeue -> attempted twice."""
    with tempfile.TemporaryDirectory() as tmp:
        mount = _make_minimal_mount(tmp)
        br = _boot.load(mount)

        sess = Session()
        ctx = _make_ctx(br, sess, mount)
        opts = QueueOptions(deck_namespace="test-deck")

        now_ms = int(time.time() * 1000)
        # first incorrect, rest correct
        handler = _make_fake_handler(["incorrect", "correct", "correct", "correct"])

        asyncio.run(run_session(
            ctx=ctx,
            deck_cards=br.deck.cards,
            store=br.store,
            mount=mount,
            opts=opts,
            handler=handler,
            now_fn=lambda: now_ms,
        ))

        # 1 of 3 cards incorrect -> requeued -> 4 total attempts
        assert sess.stats.total_attempts == 4
        assert sess.stats.incorrect == 1


def test_seen_timing_cold_warm():
    """seen_card_ids timing: add happens before handler call, so all entries appear warm."""
    with tempfile.TemporaryDirectory() as tmp:
        mount = _make_minimal_mount(tmp)
        br = _boot.load(mount)

        sess = Session()
        ctx = _make_ctx(br, sess, mount)
        opts = QueueOptions(deck_namespace="test-deck")

        seen_states: list[tuple[str, str]] = []  # (card_id, attempt_kind)
        now_ms = int(time.time() * 1000)

        async def recording_handler(ctx, card: CardDef) -> HandlerResult:
            # on handler entry the card must already be in seen
            kind = "warm" if card.card_id in sess.seen_card_ids else "cold"
            # session.py calls seen.add before the handler, so first attempt also looks warm
            # invariant: seen.add fires immediately before handler call
            seen_states.append((card.card_id, kind))
            return HandlerResult(card_id=card.card_id, verdict="incorrect", requeue=False, done=True)

        asyncio.run(run_session(
            ctx=ctx,
            deck_cards=br.deck.cards,
            store=br.store,
            mount=mount,
            opts=opts,
            handler=recording_handler,
            now_fn=lambda: now_ms,
        ))

        # every card must be in seen by the time the handler is entered
        for card_id, kind in seen_states:
            assert kind == "warm", f"{card_id}: seen.add did not fire before handler"


def test_routing():
    """Routing table: verifies type x grade_mode -> capability_id mapping."""
    from dispatch import route
    from models import CardDef, AnswerSpec

    def gm(cid):
        return _grade_modes.get(cid, "exact")

    # test cards
    cards_and_expected = [
        # (card_id, type, grade_mode setting, options_count, expected capability_id)
        ("c1", "func", "self", 0, "recall_self"),
        ("c2", "cloze", "cloze", 0, "cloze_modal"),
        ("c3", "recall_seq", "exact", 0, "seq_modal"),
        ("c4", "judge", "exact", 3, "mcq_buttons"),
        ("c5", "judge", "exact", 6, "mcq_select"),
        ("c6", "func", "exact", 0, "short_modal"),
        ("c7", "proc", "keyword", 0, "short_modal"),
    ]

    _grade_modes: dict[str, str] = {}
    test_cards: list[CardDef] = []

    for card_id, ctype, grade_mode, opt_count, _ in cards_and_expected:
        _grade_modes[card_id] = grade_mode
        front: dict = {"prompt": "test"}
        if ctype == "judge":
            front["options"] = [f"opt{i}" for i in range(opt_count)]
        elif ctype == "cloze":
            front = {"text": "{{0}}"}
        spec = None
        if grade_mode != "self":
            if grade_mode == "cloze":
                spec = AnswerSpec(normalize=[], blanks=[["x"]])
            elif grade_mode == "keyword":
                spec = AnswerSpec(normalize=[], required_keywords=[["k"]])
            elif grade_mode == "exact":
                spec = AnswerSpec(normalize=[], accepted=["a"])

        card = CardDef(
            card_id=card_id,
            schema_version=1,
            subject="test",
            unit="u",
            type=ctype,
            grade_mode=grade_mode,
            front=front,
            back={},
            answer_spec=spec,
            tags={},
            links={},
            enabled=True,
        )
        test_cards.append(card)

    for i, (card_id, ctype, grade_mode, opt_count, expected) in enumerate(cards_and_expected):
        card = test_cards[i]
        cap = route(card, gm)
        assert cap == expected, f"{card_id}: expected {expected}, got {cap}"


def test_persist_save_load():
    """Save/load round-trip verification."""
    from models import CardProgress
    with tempfile.TemporaryDirectory() as tmp:
        mount = os.path.join(tmp, "persist_test")
        store = ProgressStore(
            schema_version=SCHEMA_VERSION,
            deck_namespace="ns-01",
            cards={
                "aaa-bbb-01": CardProgress(
                    card_id="aaa-bbb-01",
                    box=2,
                    due_at=1718000000000,
                    graduated=False,
                    cold_attempts=3,
                    cold_correct=2,
                    last_attempt_at=1718000000000,
                    last_verdict="correct",
                )
            },
        )
        _persist.save_progress(mount, store)
        loaded = _persist.load_progress(mount, "ns-01")
        assert loaded.deck_namespace == "ns-01"
        assert "aaa-bbb-01" in loaded.cards
        cp = loaded.cards["aaa-bbb-01"]
        assert cp.box == 2
        assert cp.cold_attempts == 3
        assert cp.cold_correct == 2
        assert cp.last_verdict == "correct"


if __name__ == "__main__":
    # can be run directly without pytest
    import traceback
    tests = [
        test_boot_ok,
        test_boot_content_injection_bad_card_id,
        test_boot_content_injection_no_accepted,
        test_boot_manifest_missing,
        test_session_full_loop_correct,
        test_session_full_loop_incorrect_requeue,
        test_seen_timing_cold_warm,
        test_routing,
        test_persist_save_load,
    ]
    passed = 0
    failed = 0
    for fn in tests:
        try:
            fn()
            print(f"  PASS  {fn.__name__}")
            passed += 1
        except Exception:
            print(f"  FAIL  {fn.__name__}")
            traceback.print_exc()
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(0 if failed == 0 else 1)
