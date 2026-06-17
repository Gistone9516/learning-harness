# -*- coding: utf-8 -*-
"""confidence_rate capability (SoT 2.1, capability_id=confidence_rate).

Learner self-rates confidence BEFORE answer reveal: Easy / Med / Hard.
Rating is stored in the sidecar keyed by card_id so downstream analysis
can correlate confidence with actual verdict.

Pure core (no discord):
    store_confidence(mount, deck_ns, card_id, level) -> None
    get_confidence(mount, deck_ns, card_id) -> str | None

Discord shell (thin):
    async ask_confidence(ctx, card_id) -> str | None
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import sidecar

log = logging.getLogger(__name__)

CAP_ID = "confidence_rate"

# Valid confidence levels and their Korean labels shown on buttons.
LEVELS: dict[str, str] = {
    "easy": "쉬움",
    "med": "보통",
    "hard": "어려움",
}


# ── Pure core ────────────────────────────────────────────────────────────────

def store_confidence(mount: str, deck_ns: str, card_id: str, level: str) -> None:
    """Persist the confidence rating for one card.

    level must be one of "easy", "med", or "hard". Raises ValueError otherwise.
    """
    if level not in LEVELS:
        raise ValueError(f"Unknown confidence level: {level!r}. Must be one of {list(LEVELS)}")
    sidecar.set(mount, CAP_ID, deck_ns, card_id, level)


def get_confidence(mount: str, deck_ns: str, card_id: str) -> str | None:
    """Return the stored confidence level for one card, or None when absent."""
    return sidecar.get(mount, CAP_ID, deck_ns, card_id, None)


# ── Discord shell ─────────────────────────────────────────────────────────────

async def ask_confidence(ctx, card_id: str) -> str | None:
    """Show three confidence buttons and return the chosen level ("easy"/"med"/"hard").

    Returns None on timeout or when the interaction is not allowed.
    Stores the result in the sidecar before returning.
    """
    import discord
    from gating import allowed_interaction

    channel = ctx.channel
    user_id = ctx.user_id
    mount = ctx.mount
    deck_ns = ctx.deck_namespace

    loop = asyncio.get_running_loop()
    future: asyncio.Future[str | None] = loop.create_future()

    class ConfidenceView(discord.ui.View):
        def __init__(self) -> None:
            super().__init__(timeout=120)
            self._picked = False
            for level_key, label in LEVELS.items():
                btn = discord.ui.Button(
                    label=label,
                    style=discord.ButtonStyle.primary,
                )
                btn.callback = self._make_cb(level_key)
                self.add_item(btn)

        def _make_cb(self, level_key: str):
            async def cb(interaction: discord.Interaction) -> None:
                if not allowed_interaction(interaction, user_id):
                    await interaction.response.send_message("권한 없음.", ephemeral=True)
                    return
                if self._picked:
                    await interaction.response.defer()
                    return
                self._picked = True
                if not future.done():
                    future.set_result(level_key)
                self.stop()
                try:
                    await interaction.response.defer()
                except Exception:
                    pass
            return cb

        async def on_timeout(self) -> None:
            if not future.done():
                future.set_result(None)

    view = ConfidenceView()
    await channel.send(content="이 카드가 얼마나 어렵게 느껴지나요?", view=view)

    chosen = await future

    if chosen is not None:
        try:
            store_confidence(mount, deck_ns, card_id, chosen)
        except Exception as exc:
            log.warning("confidence_rate: failed to store for card=%s: %s", card_id, exc)

    return chosen
