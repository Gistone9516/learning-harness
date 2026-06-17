# -*- coding: utf-8 -*-
"""Per-area level + learned-flag state for the catalog learning model (sidecar-backed).

- level: per-area current level (1..10), independent per area. sidecar cap "level", key=area.
- learned: per-card boolean. sidecar cap "learned", key=card_id. Set by 암기 "알아요"
  and bulk-updated on level change (raise -> lower levels learned; lower -> higher unlearned).

relevel_learned_updates is a pure function (headless-testable, no I/O).
"""
from __future__ import annotations

import _paths
_paths.setup()

import sidecar

CAP_LEVEL = "level"
CAP_LEARNED = "learned"

AREAS = ("vocab", "grammar", "idiom")
MIN_LEVEL = 1
MAX_LEVEL = 10

# Korean label <-> internal area id (for /level and the panel).
_KO_TO_AREA = {"단어": "vocab", "어휘": "vocab", "문법": "grammar", "숙어": "idiom"}
_AREA_TO_KO = {"vocab": "단어", "grammar": "문법", "idiom": "숙어"}


def area_from_ko(label: str) -> str | None:
    return _KO_TO_AREA.get((label or "").strip())


def ko_label(area: str) -> str:
    return _AREA_TO_KO.get(area, area)


def clamp_level(n) -> int:
    try:
        n = int(n)
    except (ValueError, TypeError):
        return MIN_LEVEL
    return max(MIN_LEVEL, min(MAX_LEVEL, n))


# ── level ──────────────────────────────────────────────────────────────────────

def get_level(mount: str, deck_ns: str, area: str) -> int:
    return clamp_level(sidecar.get(mount, CAP_LEVEL, deck_ns, area, MIN_LEVEL))


def set_level(mount: str, deck_ns: str, area: str, n: int) -> int:
    n = clamp_level(n)
    sidecar.set(mount, CAP_LEVEL, deck_ns, area, n)
    return n


# ── learned flags ───────────────────────────────────────────────────────────────

def is_learned(mount: str, deck_ns: str, card_id: str) -> bool:
    return bool(sidecar.get(mount, CAP_LEARNED, deck_ns, card_id, False))


def set_learned(mount: str, deck_ns: str, card_id: str, value: bool = True) -> None:
    sidecar.set(mount, CAP_LEARNED, deck_ns, card_id, bool(value))


def learned_ids(mount: str, deck_ns: str) -> set[str]:
    return {k for k, v in sidecar.load_all(mount, CAP_LEARNED, deck_ns).items() if v}


# ── bulk re-level (pure) ─────────────────────────────────────────────────────────

def relevel_learned_updates(area_cards, old_level: int, new_level: int) -> dict[str, bool]:
    """Pure. area_cards = iterable of (card_id, level) for ONE area.

    Raise (new>old): every item below the new level becomes learned=True.
    Lower (new<old): every item above the new level becomes learned=False.
    Items at the new level are left unchanged. No change when new==old.
    """
    updates: dict[str, bool] = {}
    if new_level > old_level:
        for cid, lvl in area_cards:
            if lvl < new_level:
                updates[cid] = True
    elif new_level < old_level:
        for cid, lvl in area_cards:
            if lvl > new_level:
                updates[cid] = False
    return updates


def apply_level_change(mount: str, deck_ns: str, area_cards, area: str, new_level: int) -> dict:
    """Set the area level and bulk-update learned flags accordingly. area_cards = [(card_id, level)].

    Returns {"old", "new", "changed"} for the confirmation/report message.
    """
    old = get_level(mount, deck_ns, area)
    new = clamp_level(new_level)
    updates = relevel_learned_updates(area_cards, old, new)
    if updates:
        data = sidecar.load_all(mount, CAP_LEARNED, deck_ns)
        data.update(updates)
        sidecar.save_all(mount, CAP_LEARNED, deck_ns, data)
    set_level(mount, deck_ns, area, new)
    return {"old": old, "new": new, "changed": len(updates)}
