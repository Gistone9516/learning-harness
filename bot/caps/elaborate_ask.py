# -*- coding: utf-8 -*-
"""elaborate_ask - after a correct answer, invite a free-text elaboration.

Presents a modal "왜 그런지 설명해보세요." and appends the submitted text to
a per-card list in the elaborate_ask sidecar.  Non-AI, not scored.

Sidecar layout: {card_id: [str, ...]}  (chronological list of elaborations)
"""
from __future__ import annotations

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

from typing import TYPE_CHECKING

import sidecar as _sidecar

if TYPE_CHECKING:
    import discord
    from context import Ctx
    from models import CardDef

# Capability ID used for the sidecar file name.
_CAP_ID = "elaborate_ask"


# Pure core (no discord dependency) ──────────────────────────────────────────

def append_elaboration(mount: str, deck_ns: str, card_id: str, text: str) -> list:
    """Append text to the elaboration list for card_id and persist.

    Returns the updated list (always a list, never None).
    """
    existing: list = _sidecar.get(mount, _CAP_ID, deck_ns, card_id, default=[])
    if not isinstance(existing, list):
        existing = []
    existing.append(text)
    _sidecar.set(mount, _CAP_ID, deck_ns, card_id, existing)
    return existing


def get_elaborations(mount: str, deck_ns: str, card_id: str) -> list:
    """Return the current elaboration list for card_id (empty list when absent)."""
    result = _sidecar.get(mount, _CAP_ID, deck_ns, card_id, default=[])
    if not isinstance(result, list):
        return []
    return result


# Discord shell (thin wrapper) ────────────────────────────────────────────────

async def ask_elaboration(ctx: "Ctx", card: "CardDef") -> None:
    """Send a modal that collects a free-text elaboration, then persist it.

    Called after a correct answer.  The result is stored in the sidecar; no
    HandlerResult is returned because this step is not scored.

    If the learner dismisses the modal or it times out, the function returns
    silently without writing anything.
    """
    from form import ask_form

    interaction = getattr(ctx, "interaction", None)
    if interaction is None:
        # No active interaction to attach a modal to; skip silently.
        return

    data = await ask_form(
        interaction,
        "설명해보세요",
        [
            (
                "elaboration",
                "왜 그런지 설명해보세요.",
                {
                    "placeholder": "자유롭게 써주세요.",
                    "style": 2,       # discord.TextStyle.long (paragraph)
                    "required": False,
                    "max_length": 1000,
                },
            )
        ],
        timeout=180,
    )

    if data is None:
        return

    text = (data.get("elaboration") or "").strip()
    if not text:
        return

    append_elaboration(ctx.mount, ctx.deck_namespace, card.card_id, text)
