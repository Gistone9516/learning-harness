# -*- coding: utf-8 -*-
"""Lifetime guard for spawned `claude -p` processes (no orphan sessions).

Every headless claude call runs as a child process. Whoever opens one owns closing it, on every
exit path: normal return, timeout, error, task cancellation (a browser dropping the connection
cancels the serving task) and server shutdown. Without that, killed-but-unreaped children linger
and an interrupted server leaves live processes behind.

Usage:

    async with track(kind="explain", session_id=sid) as slot:
        proc = await asyncio.create_subprocess_shell(...)
        slot.attach(proc)
        ...                      # any exception, timeout or cancellation still cleans up

On shutdown call `await shutdown_all()` once to terminate whatever is still running.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import subprocess
import time
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger(__name__)

# Reaping a killed child should be near-instant; this only bounds a pathological case.
_REAP_TIMEOUT_SEC = 5.0


# eq=False keeps identity hashing: every tracked call is its own entry in the registry set,
# even when two calls carry the same kind and session id.
@dataclass(eq=False)
class Slot:
    """One tracked call. The process is attached after spawn, so a spawn failure tracks nothing."""

    kind: str
    session_id: str | None
    started_at: float = field(default_factory=time.time)
    proc: Any | None = None

    def attach(self, proc: Any) -> None:
        self.proc = proc

    @property
    def pid(self) -> int | None:
        return getattr(self.proc, "pid", None) if self.proc is not None else None


_active: set[Slot] = set()


async def kill_tree(proc: Any) -> None:
    """End a real shell-spawned child together with everything under it.

    Measured 2026-10-05 on Windows: `proc.kill()` on a create_subprocess_shell child ends only
    cmd.exe; claude.exe survives as an orphan and keeps the pipes open, so even `wait()` hangs.
    `taskkill /F /T` takes the whole tree. Only real asyncio processes qualify -- a test double's
    pid must never reach taskkill, where it could name an unrelated live process.
    """
    if os.name != "nt" or not isinstance(proc, asyncio.subprocess.Process) or proc.returncode is not None:
        return
    try:
        tk = await asyncio.create_subprocess_exec(
            "taskkill", "/F", "/T", "/PID", str(proc.pid),
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        await asyncio.wait_for(tk.wait(), timeout=_REAP_TIMEOUT_SEC)
    except Exception as e:  # noqa: BLE001 - cleanup must never raise
        log.debug("taskkill failed for pid=%s: %s", getattr(proc, "pid", None), e)


async def _terminate(slot: Slot) -> None:
    """Kill the process (and on Windows its whole tree) if still running, and always reap it."""
    proc = slot.proc
    if proc is None:
        return
    if proc.returncode is None:
        await kill_tree(proc)
    if proc.returncode is None:
        try:
            proc.kill()
        except (ProcessLookupError, OSError) as e:
            log.debug("kill skipped for pid=%s: %s", slot.pid, e)
    try:
        # Shielded: this runs on cancellation paths, where an unshielded await would be
        # cancelled again and leave the child unreaped.
        await asyncio.wait_for(asyncio.shield(proc.wait()), timeout=_REAP_TIMEOUT_SEC)
    except asyncio.TimeoutError:
        log.warning("process pid=%s did not exit within %.0fs", slot.pid, _REAP_TIMEOUT_SEC)
    except Exception as e:  # noqa: BLE001 - cleanup must never raise
        log.debug("reap failed for pid=%s: %s", slot.pid, e)


@contextlib.asynccontextmanager
async def track(*, kind: str, session_id: str | None = None):
    """Register a call for its whole lifetime and guarantee cleanup when the block exits."""
    slot = Slot(kind=kind, session_id=session_id)
    _active.add(slot)
    try:
        yield slot
    except BaseException:
        # Covers CancelledError too (BaseException in 3.8+), which a bare `except Exception`
        # would miss - that is exactly how a dropped client used to leak a process.
        await _terminate(slot)
        raise
    else:
        # Normal exit: communicate() already reaped it, unless the caller returned early.
        proc = slot.proc
        if proc is not None and proc.returncode is None:
            await _terminate(slot)
    finally:
        _active.discard(slot)


async def shutdown_all() -> int:
    """Terminate every tracked process. Call once while shutting the server down."""
    slots = list(_active)
    for slot in slots:
        await _terminate(slot)
        _active.discard(slot)
    if slots:
        log.info("cleaned up %d in-flight session(s) on shutdown", len(slots))
    return len(slots)


def register(slot: Slot) -> None:
    """Track a process whose lifetime is not one `async with` block (live sessions, ai-mode L-5)."""
    _active.add(slot)


def unregister(slot: Slot) -> None:
    _active.discard(slot)


def snapshot() -> list[dict]:
    """In-flight calls, for the /sessions endpoint and for tests asserting no orphans remain."""
    now = time.time()
    return [
        {
            "kind": s.kind,
            "pid": s.pid,
            "session_id": s.session_id,
            "running_sec": round(now - s.started_at, 1),
        }
        for s in sorted(_active, key=lambda s: s.started_at)
    ]


def active_count() -> int:
    return len(_active)
