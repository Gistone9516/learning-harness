# -*- coding: utf-8 -*-
"""Capability wiring — gate handler registration and verify required files against the
enabled capability set. Driven by capability_registry (single source of truth).

- verify_capability_files: boot-time guard. Raises ContentInjectionError naming the
  capability and the missing file when an enabled capability's bundle is absent
  (e.g. a partial clone that enabled a capability it did not copy).
- register_enabled_handlers: register dispatch handlers only for enabled capabilities
  (plus recall_self, which is always needed as the dispatch fallback).
"""
from __future__ import annotations

import os
import importlib
import logging

import _paths
_paths.setup()

import capability_registry as _reg
from bot_errors import ContentInjectionError
from dispatch import register as _register

log = logging.getLogger(__name__)

# Repo root = parent of bot/ (this file is bot/wiring.py).
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# recall_self is the dispatch fallback (dispatch.py), so it is always registered.
_ALWAYS_HANDLERS = frozenset({"recall_self"})


def verify_capability_files(enabled) -> None:
    """Raise ContentInjectionError if any enabled capability's required files are absent.

    Checks each capability's own files plus its shared bases. Paths are resolved against
    the repo root, so a cloned project verifies its own (subset) tree.
    """
    missing: list[tuple[str, str]] = []
    for cid in sorted(enabled):
        spec = _reg.REGISTRY.get(cid)
        if spec is None:
            continue
        for rel in tuple(spec.files) + tuple(spec.shared_bases):
            if not os.path.exists(os.path.join(_ROOT, rel)):
                missing.append((cid, rel))
    if missing:
        detail = "; ".join(f"'{cid}' requires {rel}" for cid, rel in missing)
        raise ContentInjectionError(
            "enabled capabilities are missing required files: " + detail +
            ". Clone the capability bundle into this project, or remove the capability "
            "from config.capabilities.enabled."
        )


def register_enabled_handlers(enabled) -> list[str]:
    """Import and register dispatch handlers for enabled capabilities (+ recall_self).

    Returns the list of registered capability_ids. Raises ContentInjectionError if an
    enabled capability declares a handler that cannot be imported (clear boot failure
    instead of a late AttributeError).
    """
    targets = set(enabled) | _ALWAYS_HANDLERS
    registered: list[str] = []
    for cid, (module, fn) in _reg.handlers_for(targets).items():
        try:
            mod = importlib.import_module(module)
            handler = getattr(mod, fn)
        except (ImportError, AttributeError) as e:
            raise ContentInjectionError(
                f"capability '{cid}' is enabled but its handler {module}.{fn} "
                f"could not be loaded: {e}"
            ) from e
        _register(cid, handler)
        registered.append(cid)
    log.info("registered handlers: %s", sorted(registered))
    return registered
