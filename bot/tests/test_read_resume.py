# -*- coding: utf-8 -*-
"""Headless tests for read_resume (pure core: get_pos / set_pos roundtrip)."""
from __future__ import annotations

import os
import sys
import tempfile

_BOT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _BOT_ROOT)
import _paths
_paths.setup()

from caps.read_resume import get_pos, set_pos, CAP_ID


def test_get_pos_default_when_absent():
    """get_pos returns 0 when no sidecar file exists yet."""
    with tempfile.TemporaryDirectory() as tmp:
        mount = os.path.join(tmp, "mount")
        os.makedirs(mount)
        result = get_pos(mount, "test-deck")
        assert result == 0, f"expected 0, got {result}"


def test_set_then_get_roundtrip():
    """set_pos then get_pos returns the stored index."""
    with tempfile.TemporaryDirectory() as tmp:
        mount = os.path.join(tmp, "mount")
        os.makedirs(mount)
        set_pos(mount, "test-deck", 5)
        result = get_pos(mount, "test-deck")
        assert result == 5, f"expected 5, got {result}"


def test_set_pos_zero():
    """set_pos(0) can be stored and retrieved."""
    with tempfile.TemporaryDirectory() as tmp:
        mount = os.path.join(tmp, "mount")
        os.makedirs(mount)
        set_pos(mount, "test-deck", 3)
        set_pos(mount, "test-deck", 0)
        result = get_pos(mount, "test-deck")
        assert result == 0, f"expected 0, got {result}"


def test_separate_decks_do_not_collide():
    """Two different deck namespaces store independent positions."""
    with tempfile.TemporaryDirectory() as tmp:
        mount = os.path.join(tmp, "mount")
        os.makedirs(mount)
        set_pos(mount, "deck-a", 7)
        set_pos(mount, "deck-b", 2)
        assert get_pos(mount, "deck-a") == 7
        assert get_pos(mount, "deck-b") == 2


def test_overwrite_updates_position():
    """Calling set_pos twice keeps only the latest value."""
    with tempfile.TemporaryDirectory() as tmp:
        mount = os.path.join(tmp, "mount")
        os.makedirs(mount)
        set_pos(mount, "ns", 1)
        set_pos(mount, "ns", 9)
        assert get_pos(mount, "ns") == 9


def test_sidecar_file_written_to_correct_path():
    """Sidecar file lands at _state/sidecar-read_resume-<deck_ns>.json."""
    with tempfile.TemporaryDirectory() as tmp:
        mount = os.path.join(tmp, "mount")
        os.makedirs(mount)
        set_pos(mount, "my-deck", 4)
        expected = os.path.join(mount, "_state", f"sidecar-{CAP_ID}-my-deck.json")
        assert os.path.exists(expected), f"sidecar file not found at {expected}"


if __name__ == "__main__":
    import traceback
    tests = [
        test_get_pos_default_when_absent,
        test_set_then_get_roundtrip,
        test_set_pos_zero,
        test_separate_decks_do_not_collide,
        test_overwrite_updates_position,
        test_sidecar_file_written_to_correct_path,
    ]
    passed = 0
    failed = 0
    for fn in tests:
        try:
            fn()
            print(f"  PASS  {fn.__name__}")
            passed += 1
        except Exception:
            print(f"  FAIL  {fn.__name__}")
            traceback.print_exc()
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(0 if failed == 0 else 1)
