# -*- coding: utf-8 -*-
"""Session lifetime: a spawned claude process must never outlive its call (no orphans).

Exercises every exit path the guard promises to clean: normal return, timeout, error and task
cancellation, plus a server shutdown while calls are in flight. A fake process stands in for the
real child, so these tests need no claude CLI. Async bodies run through asyncio.run (kit style).
"""
import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import session_guard  # noqa: E402


class FakeProc:
    """Minimal asyncio.subprocess stand-in: it hangs until killed, and records the kill/reap."""

    def __init__(self, pid=4242, hang=True):
        self.pid = pid
        self.returncode = None
        self.killed = False
        self.reaped = False
        self._hang = hang

    def kill(self):
        self.killed = True
        self.returncode = -9

    async def wait(self):
        while self.returncode is None:
            await asyncio.sleep(0.01)
        self.reaped = True
        return self.returncode

    async def communicate(self, input=None):
        if self._hang:
            await asyncio.sleep(3600)
        self.returncode = 0
        return b"", b""


def run(coro_fn):
    """Run one scenario in a fresh loop, always clearing the registry afterwards."""
    async def wrapper():
        try:
            return await coro_fn()
        finally:
            await session_guard.shutdown_all()

    return asyncio.run(wrapper())


def test_normal_completion_leaves_nothing_tracked():
    proc = FakeProc(hang=False)

    async def scenario():
        async with session_guard.track(kind="generate") as slot:
            slot.attach(proc)
            await proc.communicate()

    run(scenario)
    assert session_guard.active_count() == 0
    assert proc.killed is False       # it exited on its own; no kill needed


def test_timeout_kills_and_reaps():
    proc = FakeProc()

    async def scenario():
        async with session_guard.track(kind="followup") as slot:
            slot.attach(proc)
            with pytest.raises(asyncio.TimeoutError):
                await asyncio.wait_for(proc.communicate(), timeout=0.05)

    run(scenario)
    assert proc.killed and proc.reaped
    assert session_guard.active_count() == 0


def test_error_path_kills_the_process():
    proc = FakeProc()

    async def scenario():
        with pytest.raises(RuntimeError):
            async with session_guard.track(kind="generate") as slot:
                slot.attach(proc)
                raise RuntimeError("boom")

    run(scenario)
    assert proc.killed and proc.reaped
    assert session_guard.active_count() == 0


def test_cancellation_kills_the_process():
    """A dropped browser connection cancels the serving task; the child must not survive it."""
    proc = FakeProc()

    async def scenario():
        started = asyncio.Event()

        async def call():
            async with session_guard.track(kind="followup") as slot:
                slot.attach(proc)
                started.set()
                await proc.communicate()

        task = asyncio.create_task(call())
        await started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    run(scenario)
    assert proc.killed and proc.reaped
    assert session_guard.active_count() == 0


def test_shutdown_terminates_everything_in_flight():
    procs = [FakeProc(pid=i) for i in range(3)]

    async def scenario():
        started = asyncio.Event()

        async def call(proc):
            async with session_guard.track(kind="generate") as slot:
                slot.attach(proc)
                started.set()
                await proc.communicate()

        tasks = [asyncio.create_task(call(p)) for p in procs]
        await started.wait()
        await asyncio.sleep(0.02)
        assert session_guard.active_count() == 3

        assert await session_guard.shutdown_all() == 3

        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    run(scenario)
    assert all(p.killed and p.reaped for p in procs)
    assert session_guard.active_count() == 0


def test_snapshot_reports_in_flight_calls():
    proc = FakeProc()
    seen = {}

    async def scenario():
        async with session_guard.track(kind="followup", session_id="sid-1") as slot:
            slot.attach(proc)
            seen["snap"] = session_guard.snapshot()
            proc.kill()

    run(scenario)
    snap = seen["snap"]
    assert len(snap) == 1
    assert snap[0]["kind"] == "followup"
    assert snap[0]["session_id"] == "sid-1"
    assert snap[0]["pid"] == 4242


def test_ai_invoke_splits_timeouts_by_kind():
    import ai

    assert ai.TIMEOUT_BY_KIND["followup"] < ai.TIMEOUT_BY_KIND["generate"]
