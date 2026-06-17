# -*- coding: utf-8 -*-
"""Regression test: the stop word must interrupt a card mid-await."""
import asyncio
import os
import sys

_BOT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _BOT_ROOT)

import _paths
_paths.setup()

from session import _run_handler_or_stop, Session


def test_stop_event_interrupts_pending_handler():
    async def _go():
        session = Session()
        session.stop_event = asyncio.Event()

        async def slow(ctx, card):
            await asyncio.sleep(5)   # simulates waiting on a button/modal
            return "answered"

        task = asyncio.ensure_future(_run_handler_or_stop(slow, None, None, session))
        await asyncio.sleep(0.05)
        session.stop_event.set()     # 중단
        return await task

    assert asyncio.run(_go()) is None   # interrupted, no verdict recorded


def test_handler_completes_when_not_stopped():
    async def _go():
        session = Session()
        session.stop_event = asyncio.Event()

        async def quick(ctx, card):
            return "ok"

        return await _run_handler_or_stop(quick, None, None, session)

    assert asyncio.run(_go()) == "ok"
