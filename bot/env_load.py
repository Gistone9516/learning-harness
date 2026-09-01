# -*- coding: utf-8 -*-
"""Load the .env of the *instance* being run, not of wherever the kit happens to live.

One kit serves many mounted instances, each with its own .env (its own token, channel, state).
`dotenv.load_dotenv()` with no argument resolves relative to the calling *script*, so it walks up
from bot/ and never sees the mounted instance's file: the instance looks unconfigured even when the
learner launched it from that folder. Measured 2026-07-21.

Lookup order, first hit wins: the explicit hints a caller passes (a mount or state root, and its
parent), then the working directory and its parents. Values already in the environment win over
the file, so an explicit `VAR=... python ...` still overrides.
"""
from __future__ import annotations

import os
from pathlib import Path

try:
    from dotenv import load_dotenv as _load_dotenv
except Exception:  # python-dotenv is optional; plain environment variables still work
    _load_dotenv = None


def candidate_dirs(*hints: str | os.PathLike | None) -> list[Path]:
    """Directories to look in, most specific first, without duplicates."""
    out: list[Path] = []

    def push(path: Path) -> None:
        if path not in out:
            out.append(path)

    for hint in hints:
        if not hint:
            continue
        base = Path(hint).expanduser()
        try:
            base = base.resolve()
        except OSError:
            continue
        push(base)
        push(base.parent)     # a state/ or mount/ folder usually sits inside the instance folder

    cwd = Path.cwd().resolve()
    push(cwd)
    for parent in cwd.parents:
        push(parent)
    return out


def load_instance_env(*hints: str | os.PathLike | None) -> Path | None:
    """Load the first .env found for this instance. Returns the file used, or None."""
    if _load_dotenv is None:
        return None
    for folder in candidate_dirs(*hints):
        env_file = folder / ".env"
        if env_file.is_file():
            _load_dotenv(env_file, override=False)
            return env_file
    return None
