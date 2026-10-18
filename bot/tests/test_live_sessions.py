# -*- coding: utf-8 -*-
"""Live claude sessions (ai-mode §4.1, L-1..L-6): one long-lived process per session id.

A fake process stands in for the CLI: it reads JSON lines from stdin and answers each with a
`result` line, so these tests need no claude binary. Async bodies run through asyncio.run (kit style).
"""
import asyncio
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import live  # noqa: E402
import session_guard  # noqa: E402


class _Reader:
    def __init__(self):
        self.q: asyncio.Queue = asyncio.Queue()

    async def readline(self):
        return await self.q.get()

    async def read(self, n):
        return await self.q.get()


class _Writer:
    def __init__(self, proc):
        self.proc = proc
        self.closed = False

    def write(self, data):
        for raw in data.decode("utf-8").splitlines():
            msg = json.loads(raw)
            self.proc.received.append(msg["message"]["content"])
            self.proc.respond(msg["message"]["content"])

    async def drain(self):
        return None

    def is_closing(self):
        return self.closed

    def close(self):
        self.closed = True
        self.proc.exit(0)


class FakeLiveProc:
    """Answers each message per `mode`: ok | lost (exits as an unknown session) | error | hang."""

    def __init__(self, cmd, mode):
        self.cmd = cmd
        self.mode = mode
        self.pid = 9999
        self.returncode = None
        self.received = []
        self.killed = False
        self.stdout = _Reader()
        self.stderr = _Reader()
        self.stdin = _Writer(self)
        self._exited = asyncio.Event()

    def respond(self, content):
        if self.mode == "ok":
            self.stdout.q.put_nowait(b'{"type":"assistant","message":{"content":"..."}}\n')
            line = {"type": "result", "subtype": "success", "is_error": False, "result": f"echo:{content[-12:]}"}
            self.stdout.q.put_nowait((json.dumps(line) + "\n").encode())
        elif self.mode == "error":
            line = {"type": "result", "subtype": "error_during_execution", "is_error": True, "result": "API Error"}
            self.stdout.q.put_nowait((json.dumps(line) + "\n").encode())
        elif self.mode == "lost":
            self.stderr.q.put_nowait(b"No conversation found with session ID: abc\n")
            self.exit(1)

    def exit(self, code):
        if self.returncode is None:
            self.returncode = code
            self.stdout.q.put_nowait(b"")
            self.stderr.q.put_nowait(b"")
            self._exited.set()

    def kill(self):
        self.killed = True
        self.exit(-9)

    async def wait(self):
        await self._exited.wait()
        return self.returncode


@pytest.fixture
def spawned(monkeypatch):
    """Patch process creation; every spawn is recorded with its command line."""
    procs = []
    state = {"mode": "ok"}

    async def fake_shell(cmd, **kwargs):
        p = FakeLiveProc(cmd, state["mode"])
        procs.append(p)
        return p

    monkeypatch.setattr(live.asyncio, "create_subprocess_shell", fake_shell)
    live._live.clear()
    yield procs, state
    live._live.clear()
    session_guard._active.clear()


def _run(coro):
    async def wrapped():
        try:
            return await coro
        finally:
            await live.close_all()
    return asyncio.run(wrapped())


def test_reuses_one_process_and_later_turns_carry_no_preamble(spawned):
    procs, _ = spawned

    async def body():
        a = await live.invoke_live("first", system="ROLE")
        b = await live.invoke_live("second", session_id=a.session_id)
        return a, b

    a, b = _run(body())
    assert a.ok and b.ok and a.session_id == b.session_id
    assert len(procs) == 1                                   # L-1: one process for both turns
    assert "--session-id" in procs[0].cmd and "--tools" in procs[0].cmd
    assert procs[0].received[0].startswith("ROLE")           # L-6: preamble on the first turn only
    assert procs[0].received[1] == "second"


def test_resumes_an_id_it_holds_no_process_for(spawned):
    procs, _ = spawned
    r = _run(live.invoke_live("again", session_id="known-sid"))
    assert r.ok and r.session_id == "known-sid"
    assert "--resume" in procs[0].cmd and "known-sid" in procs[0].cmd


def test_ended_process_is_tagged_resume_missing(spawned):
    procs, state = spawned
    state["mode"] = "lost"
    r = _run(live.invoke_live("again", session_id="gone-sid"))
    assert not r.ok and r.error_kind == "resume_missing"     # L-3
    assert live.live_count() == 0


def test_is_error_result_fails(spawned):
    _, state = spawned
    state["mode"] = "error"
    r = _run(live.invoke_live("x"))
    assert not r.ok and r.error_kind is None and "API Error" in (r.error or "")


def test_a_timed_out_turn_discards_the_process(spawned):
    procs, state = spawned
    state["mode"] = "hang"
    r = _run(live.invoke_live("x", timeout_sec=0.05))
    assert not r.ok and "Timeout" in (r.error or "")
    assert live.live_count() == 0 and procs[0].returncode is not None   # L-2


def test_idle_processes_are_closed(spawned):
    procs, _ = spawned

    async def body():
        a = await live.invoke_live("x")
        assert live.live_count() == 1
        closed = await live.reap_idle(now=live._live[a.session_id].last_used + live.LIVE_IDLE_SEC + 1)
        return closed

    assert _run(body()) == 1                                 # L-4
    assert procs[0].stdin.closed and live.live_count() == 0


def test_the_cap_closes_the_least_recently_used(spawned, monkeypatch):
    procs, _ = spawned
    monkeypatch.setattr(live, "LIVE_MAX", 2)

    async def body():
        a = await live.invoke_live("a")
        await live.invoke_live("b")
        await live.invoke_live("a2", session_id=a.session_id)   # a is now the most recent
        await live.invoke_live("c")                              # evicts b
        return a

    a = _run(body())
    assert len(procs) == 3
    assert procs[1].stdin.closed and not procs[0].killed
    assert procs[0].received == [procs[0].received[0], "a2"]


def test_close_all_closes_every_process_and_unregisters(spawned):
    procs, _ = spawned

    async def body():
        await live.invoke_live("a")
        await live.invoke_live("b")
        assert [s["kind"] for s in session_guard.snapshot()] == ["live", "live"]   # L-5: visible in /sessions
        return await live.close_all()

    assert asyncio.run(body()) == 2
    assert all(p.stdin.closed for p in procs)
    assert session_guard.snapshot() == []
