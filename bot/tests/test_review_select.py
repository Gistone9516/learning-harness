# -*- coding: utf-8 -*-
"""Headless test for review_select.select_review_cards."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

from review_select import select_review_cards
from models import CardDef, CardProgress, ProgressStore, AnswerSpec


def _card(cid):
    return CardDef(
        card_id=cid, schema_version=1, subject="s", unit="u", type="func", grade_mode="exact",
        front={"prompt": "q"}, back={}, answer_spec=AnswerSpec(normalize=["trim"], accepted=["a"]),
        tags={}, links={},
    )


def test_selects_incorrect_and_due_skips_others():
    now = 1_000_000
    cards = [_card("c-correct-fresh"), _card("c-incorrect"), _card("c-due"), _card("c-untouched")]
    store = ProgressStore(schema_version=1, deck_namespace="d", cards={
        # correct and not due -> excluded
        "c-correct-fresh": CardProgress(card_id="c-correct-fresh", last_verdict="correct", due_at=now + 10_000),
        # incorrect -> included
        "c-incorrect": CardProgress(card_id="c-incorrect", last_verdict="incorrect", due_at=now + 10_000),
        # due (due_at <= now) -> included
        "c-due": CardProgress(card_id="c-due", last_verdict="correct", due_at=now - 10_000),
        # c-untouched has no progress entry -> skipped
    })
    picked = {c.card_id for c in select_review_cards(store, cards, now)}
    assert picked == {"c-incorrect", "c-due"}


def test_empty_when_nothing_to_review():
    now = 1_000_000
    cards = [_card("c1")]
    store = ProgressStore(schema_version=1, deck_namespace="d", cards={
        "c1": CardProgress(card_id="c1", last_verdict="correct", due_at=now + 99_999),
    })
    assert select_review_cards(store, cards, now) == []
