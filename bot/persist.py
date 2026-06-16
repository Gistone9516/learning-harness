# -*- coding: utf-8 -*-
"""Progress/sidecar file I/O (bot layer, SoT §2·§2.1·§3).

Handles all file I/O that the engine does not. Operates on top of the harness Store.
Atomic writes (.tmp + replace), .bak corruption fallback. Discord-agnostic.
"""
from __future__ import annotations

import os
import json
import shutil
import logging
from typing import Any

import _paths
_paths.setup()

from models import ProgressStore, CardProgress, BOX_MIN, SCHEMA_VERSION
from migrate import migrate
from bot_errors import StorageError

log = logging.getLogger(__name__)


def _progress_path(mount: str, deck_namespace: str) -> str:
    """Progress file path: <mount>/_state/progress-<deck_namespace>.json"""
    return os.path.join(mount, "_state", f"progress-{deck_namespace}.json")


def _sidecar_path(mount: str, capability_id: str, deck_namespace: str) -> str:
    """Sidecar file path: <mount>/_state/sidecar-<capability_id>-<deck_namespace>.json"""
    return os.path.join(mount, "_state", f"sidecar-{capability_id}-{deck_namespace}.json")


def _ensure_state_dir(mount: str) -> None:
    """Create the _state directory if it does not exist."""
    state_dir = os.path.join(mount, "_state")
    os.makedirs(state_dir, exist_ok=True)


def _atomic_write(path: str, data: dict) -> None:
    """Atomic JSON write. Raises StorageError on failure."""
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except OSError as e:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise StorageError(f"File write failed: {path} - {e}") from e


def _load_json_with_bak(path: str) -> dict | None:
    """Load JSON. On parse failure, try .bak. Returns None if both fail (no exception)."""
    bak = path + ".bak"
    for target in [path, bak]:
        if not os.path.exists(target):
            continue
        try:
            with open(target, encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            log.warning("JSON load failed (%s): %s", target, e)
    return None


def load_progress(mount: str, deck_namespace: str) -> ProgressStore:
    """Load progress JSON, migrate, and return a ProgressStore.

    Falls back to an empty store when the file is missing or corrupt
    (SchemaVersionError is re-raised).
    """
    path = _progress_path(mount, deck_namespace)
    raw = _load_json_with_bak(path)
    if raw is None:
        log.info("Progress file missing or corrupt (%s), starting with empty store.", path)
        return ProgressStore(schema_version=SCHEMA_VERSION, deck_namespace=deck_namespace)

    # Preserve a corrupt file as .bak
    bak = path + ".bak"
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                json.load(f)
        except (json.JSONDecodeError, OSError):
            if not os.path.exists(bak):
                shutil.copy2(path, bak)

    try:
        return migrate(raw)
    except Exception as e:
        # Re-raise SchemaVersionError (bot decides), fall back on other parse errors
        # Identify SchemaVersionError from the engine by class name
        if type(e).__name__ == "SchemaVersionError":
            raise
        log.warning("migrate failed (%s): %s, falling back to empty store.", path, e)
        if os.path.exists(path) and not os.path.exists(bak):
            shutil.copy2(path, bak)
        return ProgressStore(schema_version=SCHEMA_VERSION, deck_namespace=deck_namespace)


def save_progress(mount: str, store: ProgressStore) -> None:
    """Atomically save a ProgressStore to JSON. Raises StorageError on failure."""
    _ensure_state_dir(mount)
    path = _progress_path(mount, store.deck_namespace)

    cards_data = {}
    for card_id, cp in store.cards.items():
        cards_data[card_id] = {
            "card_id": cp.card_id,
            "box": cp.box,
            "due_at": cp.due_at,
            "graduated": cp.graduated,
            "cold_attempts": cp.cold_attempts,
            "cold_correct": cp.cold_correct,
            "last_attempt_at": cp.last_attempt_at,
            "last_verdict": cp.last_verdict,
        }

    data = {
        "schema_version": store.schema_version,
        "deck_namespace": store.deck_namespace,
        "cards": cards_data,
    }
    _atomic_write(path, data)


def load_sidecar(mount: str, capability_id: str, deck_namespace: str) -> dict:
    """Load sidecar JSON. Returns empty dict if missing or corrupt."""
    path = _sidecar_path(mount, capability_id, deck_namespace)
    raw = _load_json_with_bak(path)
    return raw if isinstance(raw, dict) else {}


def save_sidecar(mount: str, capability_id: str, deck_namespace: str, data: dict) -> None:
    """Atomically save sidecar JSON."""
    _ensure_state_dir(mount)
    path = _sidecar_path(mount, capability_id, deck_namespace)
    _atomic_write(path, data)
