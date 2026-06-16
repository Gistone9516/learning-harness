# -*- coding: utf-8 -*-
"""Path helpers. Makes engine/ and harness available on sys.path for every module in the bot package.

Call setup() once at the top of each module, or call it once from the entry point (main.py).
Duplicate calls are safe (guarded by a set check).
"""
from __future__ import annotations

import sys
import os

_registered = False

def setup() -> None:
    """Add engine/ and harness category directories to sys.path."""
    global _registered
    if _registered:
        return
    _registered = True

    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)

    engine_core = os.path.join(root, "engine")
    harness_automation = os.path.join(here, "harness", "automation")
    harness_output = os.path.join(here, "harness", "output")
    harness_interaction = os.path.join(here, "harness", "interaction")
    harness_channels = os.path.join(here, "harness", "channels")
    harness_live = os.path.join(here, "harness", "live")
    harness_meta = os.path.join(here, "harness", "meta")

    # Add bot root first so bot-level errors.py takes priority over engine/ errors.py
    if here not in sys.path:
        sys.path.insert(0, here)

    # Add engine/ and harness categories after the bot root
    for p in [
        harness_meta,
        harness_live,
        harness_channels,
        harness_interaction,
        harness_output,
        harness_automation,
        engine_core,
    ]:
        if p not in sys.path:
            sys.path.append(p)
