# -*- coding: utf-8 -*-
"""read_resume - deck-level reading position (index) stored in sidecar.

Pure core: get_pos / set_pos (no discord).
Discord shell: resume_reading(ctx, pages) - sends a paginator starting at the
saved index and saves the index whenever the user navigates.
"""
from __future__ import annotations

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import asyncio
from typing import TYPE_CHECKING, List

import sidecar

if TYPE_CHECKING:
    import discord
    from context import Ctx

CAP_ID = "read_resume"


# Pure core - no discord dependency

def get_pos(mount: str, deck_ns: str) -> int:
    """Return the saved reading index for this deck. Returns 0 when absent."""
    raw = sidecar.get(mount, CAP_ID, deck_ns, deck_ns, default=0)
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 0


def set_pos(mount: str, deck_ns: str, idx: int) -> None:
    """Persist the reading index for this deck."""
    sidecar.set(mount, CAP_ID, deck_ns, deck_ns, idx)


# Discord shell

async def resume_reading(ctx: "Ctx", pages: List[str]) -> None:
    """Send a paginator starting at the saved index and save position on navigation.

    The paginator's _go callback is monkey-patched so every navigation event
    persists the new index via set_pos before editing the message.
    """
    from paginator import Paginator, send_paginator

    saved = get_pos(ctx.mount, ctx.deck_namespace)
    start = max(0, min(saved, len(pages) - 1)) if pages else 0

    view = Paginator(ctx.user_id, pages)
    view.idx = start
    view._build()

    # Wrap _go to inject persistence around each navigation step.
    _original_go = view._go

    def _persisting_go(delta: int):
        original_cb = _original_go(delta)

        async def cb(interaction: "discord.Interaction"):
            await original_cb(interaction)
            set_pos(ctx.mount, ctx.deck_namespace, view.idx)

        return cb

    view._go = _persisting_go
    # Rebuild button callbacks with the persisting wrapper.
    view.prev.callback = view._go(-1)
    view.nxt.callback = view._go(1)

    view._sent = await ctx.channel.send(view=view)
