# -*- coding: utf-8 -*-
"""Sidecar accessor (SoT 2.1). Auxiliary capability state kept outside the engine CardProgress schema.

One sidecar file per (capability_id, deck): <mount>/_state/sidecar-<capability_id>-<deck>.json. The shape
is {key: value} where key is usually a card_id, or the deck namespace for deck-level state. This is a thin
typed wrapper over persist.load_sidecar/save_sidecar so the six sidecar capabilities share one seam and do
not each reimplement load-modify-save.
"""
from __future__ import annotations

from typing import Any

import _paths
_paths.setup()

import persist as _persist


def get(mount: str, capability_id: str, deck_namespace: str, key: str, default: Any = None) -> Any:
    """Read one entry from a capability's sidecar. Returns default when the key or file is absent."""
    data = _persist.load_sidecar(mount, capability_id, deck_namespace)
    return data.get(key, default)


def set(mount: str, capability_id: str, deck_namespace: str, key: str, value: Any) -> dict:
    """Write one entry into a capability's sidecar (load, modify, atomic save). Returns the updated dict."""
    data = _persist.load_sidecar(mount, capability_id, deck_namespace)
    data[key] = value
    _persist.save_sidecar(mount, capability_id, deck_namespace, data)
    return data


def load_all(mount: str, capability_id: str, deck_namespace: str) -> dict:
    """Return the whole sidecar dict for a capability (empty dict when absent)."""
    return _persist.load_sidecar(mount, capability_id, deck_namespace)


def save_all(mount: str, capability_id: str, deck_namespace: str, data: dict) -> None:
    """Overwrite the whole sidecar dict for a capability (atomic)."""
    _persist.save_sidecar(mount, capability_id, deck_namespace, data)
