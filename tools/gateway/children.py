# -*- coding: utf-8 -*-
"""One ai_server per subject, owned by the gateway (specs/web-gateway.md GW-6).

The child environment is built from scratch for each subject: env_load lets a variable that is already set
win over the subject's .env, so an inherited AI_SERVER_PORT or token would point a subject at another
subject's server and state.
"""
from __future__ import annotations

import logging
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

from config import Subject

log = logging.getLogger("gateway.children")

KIT = Path(__file__).resolve().parents[2]
AI_SERVER = KIT / "bot" / "ai_server.py"
_OWN_KEYS = ("STATE_ROOT",)
_OWN_PREFIX = "AI_SERVER_"


def child_env(base: dict[str, str], subject_env: dict[str, str]) -> dict[str, str]:
    env = {k: v for k, v in base.items() if not k.startswith(_OWN_PREFIX) and k not in _OWN_KEYS}
    env.update(subject_env)
    env["AI_SERVER_HOST"] = "127.0.0.1"
    env.setdefault("PYTHONIOENCODING", "utf-8")
    return env


def kill_tree(proc: subprocess.Popen) -> None:
    """End the child and everything it spawned (claude.exe survives proc.kill() on Windows)."""
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        proc.kill()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        pass


class Supervisor:
    """Starts every subject's ai_server and restarts one that exits, with backoff 1 s doubling to 60 s."""

    def __init__(self, subjects: tuple[Subject, ...], log_dir: Path):
        self.subjects = subjects
        self.log_dir = log_dir
        self._procs: dict[str, subprocess.Popen] = {}
        self._stop = threading.Event()
        self._threads: list[threading.Thread] = []

    def _spawn(self, s: Subject) -> subprocess.Popen:
        self.log_dir.mkdir(parents=True, exist_ok=True)
        out = open(self.log_dir / f"{s.slug}.log", "ab")
        flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
        state = s.dir / "state"
        state.mkdir(exist_ok=True)
        proc = subprocess.Popen([sys.executable, str(AI_SERVER), str(state)], cwd=str(s.dir),
                                env=child_env(dict(os.environ), s.env), stdout=out, stderr=subprocess.STDOUT,
                                stdin=subprocess.DEVNULL, creationflags=flags)
        out.close()
        log.info("started ai_server for %s on 127.0.0.1:%d (pid %d)", s.slug, s.ai_port, proc.pid)
        return proc

    def _watch(self, s: Subject) -> None:
        delay = 1.0
        while not self._stop.is_set():
            started = time.monotonic()
            proc = self._spawn(s)
            self._procs[s.slug] = proc
            while proc.poll() is None and not self._stop.is_set():
                self._stop.wait(1.0)
            if self._stop.is_set():
                return
            log.warning("ai_server for %s exited with %s; restarting in %.0f s", s.slug, proc.returncode, delay)
            # A child that ran a while was healthy; start the backoff over.
            delay = 1.0 if time.monotonic() - started > 120 else delay
            self._stop.wait(delay)
            delay = min(delay * 2, 60.0)

    def start(self) -> None:
        for s in self.subjects:
            t = threading.Thread(target=self._watch, args=(s,), name=f"child-{s.slug}", daemon=True)
            t.start()
            self._threads.append(t)

    def stop(self) -> None:
        self._stop.set()
        for proc in list(self._procs.values()):
            kill_tree(proc)
        for t in self._threads:
            t.join(timeout=5)
