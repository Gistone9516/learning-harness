# -*- coding: utf-8 -*-
"""Live claude sessions (ai-mode §4.1, rules L-1..L-6).

`ai.invoke` spawns one `claude -p` process per call. A caller sending many short turns in a row (the
web review grader) may instead ask for a live session: the first turn spawns the process and keeps its
stdin open, later turns are one JSON line written to that same process and read back up to its
`result` line. Starting the CLI is most of a short call on this machine (4.7-5.9 s per call against
2.2-3.1 s per live follow-up, measured 2026-10-05), so this is purely a latency path; the session and
its contract are the same as `invoke`'s.

Opt-in per request (`live: true` on POST /ai). Nothing else in the kit goes through here.
"""
from __future__ import annotations

import asyncio
import json
import logging
import subprocess
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

import ai
import session_guard

log = logging.getLogger(__name__)

LIVE_IDLE_SEC = 600        # L-4: a review visit is short; the learner leaves without telling the server
LIVE_MAX = 4               # L-4: bound memory when tabs are reopened
_CLOSE_GRACE_SEC = 5.0     # L-5: stdin EOF ends the tree in ~2.6 s (measured); then force it
_REAPER_PERIOD_SEC = 30.0
_STDERR_KEEP = 4096


@dataclass(eq=False)
class _Live:
    sid: str
    proc: Any
    slot: session_guard.Slot
    resumed: bool                       # spawned with --resume: an early exit may mean "unknown session"
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    last_used: float = field(default_factory=time.time)
    stderr: bytearray = field(default_factory=bytearray)
    drain: asyncio.Task | None = None

    @property
    def alive(self) -> bool:
        return self.proc.returncode is None


_live: dict[str, _Live] = {}
_reaper: asyncio.Task | None = None


async def _drain_stderr(entry: _Live) -> None:
    """Keep reading stderr so a full pipe can never block the child; keep the tail for diagnosis."""
    try:
        while True:
            chunk = await entry.proc.stderr.read(1024)
            if not chunk:
                return
            entry.stderr.extend(chunk)
            del entry.stderr[:-_STDERR_KEEP]
    except Exception:  # noqa: BLE001 - diagnostics only
        return


async def _close(entry: _Live) -> None:
    """L-5: close stdin, give the CLI a moment to exit cleanly, then end the whole tree."""
    if _live.get(entry.sid) is entry:
        del _live[entry.sid]
    proc = entry.proc
    try:
        if proc.returncode is None and proc.stdin is not None and not proc.stdin.is_closing():
            proc.stdin.close()
        await asyncio.wait_for(asyncio.shield(proc.wait()), timeout=_CLOSE_GRACE_SEC)
    except asyncio.TimeoutError:
        await session_guard._terminate(entry.slot)
    except Exception as e:  # noqa: BLE001 - cleanup must never raise
        log.debug("live close: %s", e)
        await session_guard._terminate(entry.slot)
    finally:
        if entry.drain is not None:
            entry.drain.cancel()
        session_guard.unregister(entry.slot)


async def _evict_for_room() -> None:
    """L-4: before opening one more, close the least recently used idle process."""
    while len(_live) >= LIVE_MAX:
        idle = [e for e in _live.values() if not e.lock.locked()]
        if not idle:
            return
        await _close(min(idle, key=lambda e: e.last_used))


async def reap_idle(now: float | None = None) -> int:
    """Close live processes idle for LIVE_IDLE_SEC (L-4). Returns how many were closed."""
    now = time.time() if now is None else now
    stale = [e for e in _live.values() if not e.lock.locked() and now - e.last_used >= LIVE_IDLE_SEC]
    for e in stale:
        await _close(e)
    return len(stale)


async def _reaper_loop() -> None:
    while True:
        await asyncio.sleep(_REAPER_PERIOD_SEC)
        try:
            await reap_idle()
        except Exception as e:  # noqa: BLE001 - the loop must survive
            log.debug("live reaper: %s", e)


def _ensure_reaper() -> None:
    global _reaper
    if _reaper is None or _reaper.done():
        _reaper = asyncio.get_running_loop().create_task(_reaper_loop())


async def _spawn(sid: str, *, resumed: bool, model: str | None, effort: str | None, tools: str | None) -> _Live:
    cmd = ai.build_cmd(session_id=sid, is_new_session=not resumed, model=model, effort=effort, tools=tools)
    proc = await asyncio.create_subprocess_shell(
        subprocess.list2cmdline(cmd),
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        limit=1024 * 1024,
    )
    slot = session_guard.Slot(kind="live", session_id=sid)
    slot.attach(proc)
    session_guard.register(slot)
    entry = _Live(sid=sid, proc=proc, slot=slot, resumed=resumed)
    entry.drain = asyncio.get_running_loop().create_task(_drain_stderr(entry))
    _live[sid] = entry
    return entry


async def _turn(entry: _Live, line: bytes) -> ai.AIResult:
    """Write one message, read up to its `result` line. The caller holds the entry lock."""
    proc = entry.proc
    proc.stdin.write(line)
    await proc.stdin.drain()
    while True:
        raw = await proc.stdout.readline()
        if not raw:
            # L-3: the process ended before answering.
            await asyncio.sleep(0)   # let the stderr drain catch up
            err = entry.stderr.decode("utf-8", errors="replace").strip()
            lost = entry.resumed and ai.RESUME_LOST_MARK in err.lower()
            return ai.AIResult(text="", ok=False, error=f"live session ended: {err or 'no output'}",
                               error_kind="resume_missing" if lost else None)
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if obj.get("type") != "result":
            continue
        text = ai.result_text(obj)
        if obj.get("is_error") or not text:
            return ai.AIResult(text="", ok=False, error=text or f"result: {obj.get('subtype', 'no text')}")
        return ai.AIResult(text=text, ok=True, session_id=entry.sid)


async def invoke_live(prompt: str, *, system: str | None = None, model: str | None = None,
                      effort: str | None = "low", session_id: str | None = None,
                      timeout_sec: int | None = None, tools: str | None = "") -> ai.AIResult:
    """L-1: answer one turn from a long-lived process for `session_id` (new one when None)."""
    _ensure_reaper()
    entry = _live.get(session_id) if session_id else None
    if entry is not None and not entry.alive:
        await _close(entry)
        entry = None
    if entry is None:
        await _evict_for_room()
        sid = session_id or str(uuid.uuid4())
        try:
            entry = await _spawn(sid, resumed=session_id is not None, model=model, effort=effort, tools=tools)
        except Exception as e:  # noqa: BLE001
            return ai.AIResult(text="", ok=False, error=f"Process creation failed: {e}")
    kind = "followup" if session_id else "generate"
    timeout = timeout_sec or ai.TIMEOUT_BY_KIND.get(kind, ai.DEFAULT_TIMEOUT_SEC)
    async with entry.lock:
        entry.last_used = time.time()
        try:
            result = await asyncio.wait_for(_turn(entry, ai.user_line(prompt, system)), timeout=timeout)
        except asyncio.TimeoutError:
            await _close(entry)                       # L-2: a half-read stdout would corrupt the next turn
            return ai.AIResult(text="", ok=False, error=f"Timeout after {timeout}s")
        except asyncio.CancelledError:
            await asyncio.shield(_close(entry))
            raise
        except Exception as e:  # noqa: BLE001
            await _close(entry)
            return ai.AIResult(text="", ok=False, error=f"live turn failed: {e}")
        finally:
            entry.last_used = time.time()
    if not result.ok and not entry.alive:
        await _close(entry)
    return result


async def close_all() -> int:
    """Close every live process (server shutdown)."""
    global _reaper
    entries = list(_live.values())
    for e in entries:
        await _close(e)
    if _reaper is not None:
        _reaper.cancel()
        _reaper = None
    return len(entries)


def live_count() -> int:
    return len(_live)
