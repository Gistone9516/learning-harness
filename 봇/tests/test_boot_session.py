# -*- coding: utf-8 -*-
"""헤드리스 테스트 (봇계약 §9).

discord 없이 boot + session 전 루프 검증.
인라인 목업 콘텐츠(자체 작은 덱) + 가짜 핸들러(preset verdict 반환).
테스트 대상: boot(정상/위반 ContentInjectionError), session 루프(제시->분류->verdict->전이->저장->재큐).
pytest 스타일.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
import time

# 봇 루트를 sys.path에 추가
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


# ── 목업 콘텐츠 작성 헬퍼 ────────────────────────────────────────────────────

def _write_json(path: str, data: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _make_minimal_mount(tmp_dir: str) -> str:
    """테스트용 최소 마운트 폴더 구성. 자체 목업 덱(3장)."""
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
    """ContentInjectionError 유발: card_id 정규식 위반."""
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
                "card_id": "BAD:ID",  # 정규식 위반 + 콜론
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
    """ContentInjectionError 유발: exact 모드인데 answer_spec.accepted 없음."""
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
                "answer_spec": {"accepted": [], "normalize": []},  # accepted 비어있음
                "tags": {}, "links": {}, "enabled": True,
            }
        ],
    }
    _write_json(os.path.join(mount, "decks", "bad2.json"), deck_data)
    return mount


# ── 가짜 핸들러 ───────────────────────────────────────────────────────────────

def _make_fake_handler(verdicts: list[str]):
    """preset verdict 순서대로 반환하는 가짜 핸들러."""
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
    """테스트용 Ctx 구성."""
    br = boot_result
    return Ctx(
        channel=None,
        user_id=0,
        store=br.store,
        deck=br.deck,
        synonyms=br.synonyms,
        grade_mode_of=lambda cid: br.grade_mode_map.get(cid, "exact"),
        leitner_cfg=br.leitner_cfg,
        ai_model=None,
        ai_effort="low",
        sid=None,
        session=session,
        emit=None,
    )


# ── 테스트 함수 ───────────────────────────────────────────────────────────────

def test_boot_ok():
    """정상 마운트 -> boot.load 성공, 덱/synonyms/grade_mode_map 로드 확인."""
    with tempfile.TemporaryDirectory() as tmp:
        mount = _make_minimal_mount(tmp)
        br = _boot.load(mount)

    assert br.deck.namespace == "test-deck"
    assert len(br.deck.cards) == 3
    # grade_mode_map 컴파일됨
    card_ids = {c.card_id for c in br.deck.cards}
    assert "tst-func-01" in card_ids
    assert "tst-self-01" in card_ids
    # self 카드는 grade_mode_map에 self
    assert br.grade_mode_map["tst-self-01"] == "self"
    assert br.grade_mode_map["tst-func-01"] == "exact"
    # ProgressStore 로드됨 (신규 = 빈 스토어)
    assert br.store.schema_version == SCHEMA_VERSION
    assert br.store.deck_namespace == "test-deck"


def test_boot_content_injection_bad_card_id():
    """card_id 정규식 위반 -> ContentInjectionError."""
    with tempfile.TemporaryDirectory() as tmp:
        mount = _make_invalid_mount_card_id(tmp)
        with pytest.raises(ContentInjectionError):
            _boot.load(mount)


def test_boot_content_injection_no_accepted():
    """exact 모드 accepted 비어있음 -> ContentInjectionError."""
    with tempfile.TemporaryDirectory() as tmp:
        mount = _make_invalid_mount_no_answer(tmp)
        with pytest.raises(ContentInjectionError):
            _boot.load(mount)


def test_boot_manifest_missing():
    """manifest.json 없음 -> ManifestMissingError."""
    with tempfile.TemporaryDirectory() as tmp:
        mount = os.path.join(tmp, "empty_mount")
        os.makedirs(mount, exist_ok=True)
        with pytest.raises(ManifestMissingError):
            _boot.load(mount)


def test_session_full_loop_correct():
    """전 루프: 모든 카드 correct -> box 승급 + 저장 확인."""
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

        # 총 3장 시도
        assert sess.stats.total_attempts == 3
        # self 카드는 self 모드지만 verdict="correct"가 fake로 주입됨
        # box 승급이 일어나야 함 (cold+correct -> box 승급)
        for cp in br.store.cards.values():
            assert cp.box >= 2 or cp.graduated, f"{cp.card_id}: box={cp.box}"

        # 저장 파일 확인
        saved_path = os.path.join(mount, "_상태", "progress-test-deck.json")
        assert os.path.exists(saved_path)
        with open(saved_path, encoding="utf-8") as f:
            saved = json.load(f)
        assert saved["deck_namespace"] == "test-deck"
        assert len(saved["cards"]) == 3


def test_session_full_loop_incorrect_requeue():
    """전 루프: 첫 번째 카드 incorrect -> requeue에 추가 -> 두 번 시도."""
    with tempfile.TemporaryDirectory() as tmp:
        mount = _make_minimal_mount(tmp)
        br = _boot.load(mount)

        sess = Session()
        ctx = _make_ctx(br, sess, mount)
        opts = QueueOptions(deck_namespace="test-deck")

        now_ms = int(time.time() * 1000)
        # 첫 번째 incorrect, 이후 모두 correct
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

        # 3장 중 1장 incorrect -> requeue -> 4회 시도
        assert sess.stats.total_attempts == 4
        assert sess.stats.incorrect == 1


def test_seen_timing_cold_warm():
    """seen_card_ids 타이밍: 제시 직전 add -> warm 판정이 올바른지 확인."""
    with tempfile.TemporaryDirectory() as tmp:
        mount = _make_minimal_mount(tmp)
        br = _boot.load(mount)

        sess = Session()
        ctx = _make_ctx(br, sess, mount)
        opts = QueueOptions(deck_namespace="test-deck")

        seen_states: list[tuple[str, str]] = []  # (card_id, attempt_kind)
        now_ms = int(time.time() * 1000)

        async def recording_handler(ctx, card: CardDef) -> HandlerResult:
            # 핸들러 진입 시 이미 seen에 들어가 있어야 함
            kind = "warm" if card.card_id in sess.seen_card_ids else "cold"
            # 실제로는 session.py에서 seen.add 후 핸들러 호출이므로 무조건 warm처럼 보임
            # 하지만 첫 시도는 add 직후라 seen에 있음 -> "warm"처럼 보임
            # 핵심 불변: seen에 들어가는 시점 = 핸들러 호출 직전
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

        # 모든 카드는 핸들러 진입 시 이미 seen에 있음 (seen.add가 핸들러 직전에 실행됨)
        for card_id, kind in seen_states:
            assert kind == "warm", f"{card_id}: seen.add가 핸들러 직전에 안 됨"


def test_routing():
    """라우팅 테이블: type x grade_mode -> capability_id 매핑 검증."""
    from dispatch import route
    from models import CardDef, AnswerSpec

    def gm(cid):
        return _grade_modes.get(cid, "exact")

    # 테스트 카드들
    cards_and_expected = [
        # (card_id, type, grade_mode 설정, options_count, expected capability_id)
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
    """저장/로드 왕복 검증."""
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
    # pytest 없이 직접 실행 가능
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
