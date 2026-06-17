# -*- coding: utf-8 -*-
"""hint_progressive capability (learning-types, capability_id=hint_progressive).

Non-AI, content-authored step-by-step hints. Up to 3 levels.
Hints come from card.front["hints"] (list) or fall back to card.front["hint"] (single string).
Level is tracked per card in sidecar: {card_id: int}.

Pure core: next_hint, bump_level.
Discord shell: show_hint (button that reveals the next hint in channel).
"""
from __future__ import annotations

import logging
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import discord
from models import CardDef
from gating import allowed_interaction
import sidecar

log = logging.getLogger(__name__)

_CAP_ID = "hint_progressive"
_MAX_LEVEL = 3

_COLOR_HINT = 0xF1C40F


# Pure core functions (no discord, fully testable headless)

def _get_hint_list(card: CardDef) -> list[str]:
    """Extract the hints list from card.front.

    Tries card.front["hints"] first (list). Falls back to card.front["hint"]
    (single string, wrapped in a list). Returns empty list when neither exists.
    """
    front = card.front or {}
    hints = front.get("hints")
    if isinstance(hints, list) and hints:
        return [str(h) for h in hints[:_MAX_LEVEL]]
    hint = front.get("hint")
    if hint:
        return [str(hint)]
    return []


def next_hint(card: CardDef, level: int) -> str | None:
    """Return the hint text for the given level (1-based).

    Returns None when level exceeds available hints or exceeds the max of 3.
    Level 1 returns the first hint, level 2 the second, and so on.
    """
    if level < 1 or level > _MAX_LEVEL:
        return None
    hints = _get_hint_list(card)
    idx = level - 1
    if idx >= len(hints):
        return None
    return hints[idx]


def bump_level(mount: str, deck_ns: str, card_id: str) -> int:
    """Increment and persist the hint level for card_id. Returns the new level (capped at _MAX_LEVEL + 1).

    Starting from 0, each call increments by 1. The returned value is the level
    that was just revealed (i.e. the level to pass to next_hint).
    """
    current = sidecar.get(mount, _CAP_ID, deck_ns, card_id, default=0)
    new_level = int(current) + 1
    sidecar.set(mount, _CAP_ID, deck_ns, card_id, new_level)
    return new_level


def get_level(mount: str, deck_ns: str, card_id: str) -> int:
    """Return the current hint level (already shown) for card_id. 0 means no hints shown yet."""
    return int(sidecar.get(mount, _CAP_ID, deck_ns, card_id, default=0))


# Discord shell

async def show_hint(ctx, card: CardDef) -> None:
    """Send a hint button to channel. On click, reveals the next unrevealed hint.

    This is a fire-and-forget helper, not a full HandlerResult flow.
    Call it from a parent handler that needs hint support alongside its own grading logic.
    Does not return a HandlerResult; the parent handler owns verdict/done signaling.
    """
    # Silent when the card has no authored hints (do not spam "no more hints").
    if not _get_hint_list(card):
        return

    channel = ctx.channel
    user_id = ctx.user_id
    mount = ctx.mount
    deck_ns = ctx.deck_namespace

    current_level = get_level(mount, deck_ns, card.card_id)
    next_level = current_level + 1
    hint_text = next_hint(card, next_level)

    if hint_text is None:
        no_more_view = discord.ui.LayoutView(timeout=None)
        no_more_view.add_item(discord.ui.Container(
            discord.ui.TextDisplay("더 이상 힌트가 없습니다."),
            accent_colour=_COLOR_HINT,
        ))
        await channel.send(view=no_more_view)
        return

    class HintView(discord.ui.View):
        def __init__(self) -> None:
            super().__init__(timeout=300)
            self._clicked = False

        @discord.ui.button(label="힌트 보기", style=discord.ButtonStyle.secondary)
        async def show(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
            if not allowed_interaction(interaction, user_id):
                await interaction.response.send_message("권한 없음.", ephemeral=True)
                return
            if self._clicked:
                await interaction.response.defer()
                return
            self._clicked = True

            revealed_level = bump_level(mount, deck_ns, card.card_id)
            revealed_text = next_hint(card, revealed_level)
            self.stop()

            if revealed_text is None:
                msg = "더 이상 힌트가 없습니다."
            else:
                msg = f"힌트 {revealed_level}: {revealed_text}"

            try:
                await interaction.response.edit_message(content=msg, view=None)
            except Exception:
                try:
                    await interaction.channel.send(content=msg)
                except Exception as e:
                    log.warning("hint fallback send failed: %s", e)

        async def on_timeout(self) -> None:
            pass

    hint_view = HintView()
    label_text = f"힌트 {next_level}/{min(len(_get_hint_list(card)), _MAX_LEVEL)} 보기"
    await channel.send(content=label_text, view=hint_view)
