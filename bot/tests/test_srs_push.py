# -*- coding: utf-8 -*-
"""Headless test for srs_push: due notification + dedup, no live discord."""
import asyncio
import os
import sys
import tempfile
import types

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import srs_push
from models import CardProgress, ProgressStore


class _FakeChannel:
    def __init__(self):
        self.sent = []

    async def send(self, content=None, **kw):
        self.sent.append(content)
        return None


def _br(mount, store, caps):
    return types.SimpleNamespace(
        mount=mount,
        deck=types.SimpleNamespace(namespace="d"),
        store=store,
        enabled_capabilities=set(caps),
        ai_model=None, ai_effort="low", ai_persona=None,
    )


def test_build_alert_text():
    assert "3장" in srs_push.build_alert_text(3)


def test_due_notice_then_dedup():
    # run_due_check uses real time.time(); use due_at in the real past/future accordingly.
    with tempfile.TemporaryDirectory() as mount:
        store = ProgressStore(schema_version=1, deck_namespace="d", cards={
            "due-a": CardProgress(card_id="due-a", due_at=1),            # due (past)
            "due-b": CardProgress(card_id="due-b", due_at=1),            # due (past)
            "future": CardProgress(card_id="future", due_at=10**13),    # not due (year ~2286)
        })
        ch = _FakeChannel()
        br = _br(mount, store, {"srs_due_alert"})

        # first tick: 2 due cards -> one notice sent, alerts recorded
        n1 = asyncio.run(srs_push.run_due_check(ch, 42, br))
        assert n1 == 2
        assert len(ch.sent) == 1 and "2장" in ch.sent[0]

        # second tick immediately: deduped within the interval -> nothing fires
        n2 = asyncio.run(srs_push.run_due_check(ch, 42, br))
        assert n2 == 0
        assert len(ch.sent) == 1


def test_start_disabled_returns_none():
    with tempfile.TemporaryDirectory() as mount:
        store = ProgressStore(schema_version=1, deck_namespace="d", cards={})
        br = _br(mount, store, set())  # srs_due_alert not enabled
        assert srs_push.start_srs_push(_FakeChannel(), 1, br) is None
