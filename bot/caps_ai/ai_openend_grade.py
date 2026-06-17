# -*- coding: utf-8 -*-
"""ai_openend_grade capability (layer 3, AI-graded open-ended answers).

Handles essay, translation, and short free-text cards that require AI grading instead of
exact/keyword matching. Collects the learner's answer via a Discord modal (same pattern as
short_modal), then delegates grading to ai_caps.grade_or_self_fallback, which emits a
JSON binary verdict and maps it to a HandlerResult for Leitner.

When the capability is disabled in ctx.enabled_capabilities, falls straight through to the
self fallback (recall_self) without invoking the AI at all.
"""
from __future__ import annotations

import asyncio
import logging
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import discord

import ai_caps
from models import CardDef, HandlerResult
from dispatch import HANDLERS

log = logging.getLogger(__name__)

_CAPABILITY_ID = "ai_openend_grade"

_COLOR_MAIN = 0x5865F2
_COLOR_DONE = 0x57F287
_COLOR_DANGER = 0xED4245


class _OpenEndModal(discord.ui.Modal):
    """Single-field modal for collecting a free-text learner answer."""

    def __init__(self, title: str, future: asyncio.Future) -> None:
        super().__init__(title=title[:45])
        self._future = future
        self.answer = discord.ui.TextInput(
            label="답변",
            placeholder="자유롭게 서술하세요.",
            style=discord.TextStyle.paragraph,
            max_length=1000,
        )
        self.add_item(self.answer)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        if not self._future.done():
            self._future.set_result(self.answer.value)
        await interaction.response.send_message("답변이 제출되었습니다.", ephemeral=True)

    async def on_error(self, interaction: discord.Interaction, error: Exception) -> None:
        log.warning("modal error: %s", error)
        if not self._future.done():
            self._future.set_result(None)


def _allowed_interaction(interaction: discord.Interaction, user_id: int) -> bool:
    """Return True when the interaction came from the expected learner."""
    return interaction.user.id == user_id


async def _collect_answer(ctx, card: CardDef) -> str | None:
    """Present the card front with a modal trigger button, wait for learner input.

    Returns the submitted text or None on timeout/cancel.
    """
    channel = ctx.channel
    user_id = ctx.user_id

    front = card.front or {}
    prompt = front.get("prompt", "")
    hint = front.get("hint", "")

    front_text = f"**Q (서술형).** {prompt}"
    if hint:
        front_text += f"\n\n*힌트: {hint}*"

    loop = asyncio.get_running_loop()
    future: asyncio.Future[str | None] = loop.create_future()

    class _ModalTriggerView(discord.ui.View):
        def __init__(self) -> None:
            super().__init__(timeout=None)
            self._opened = False

        @discord.ui.button(label="답변 작성", style=discord.ButtonStyle.primary)
        async def open_modal(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
            if not _allowed_interaction(interaction, user_id):
                await interaction.response.send_message("권한 없음.", ephemeral=True)
                return
            if self._opened:
                await interaction.response.defer()
                return
            self._opened = True
            modal = _OpenEndModal(f"Q. {prompt[:40]}", future)
            await interaction.response.send_modal(modal)
            self.stop()

        async def on_timeout(self) -> None:
            if not future.done():
                future.set_result(None)

    view = _ModalTriggerView()
    await channel.send(content=front_text, view=view)
    return await future


async def handle(ctx, card: CardDef) -> HandlerResult:
    """ai_openend_grade handler.

    Flow:
    1. Check the should_invoke gate. If disabled, fall straight to recall_self.
    2. Collect a free-text answer via Discord modal (_collect_answer).
    3. On timeout/cancel, return a skip HandlerResult.
    4. Delegate grading to ai_caps.grade_or_self_fallback, which forces a JSON binary verdict
       and self-falls-back on AI failure. The returned HandlerResult feeds Leitner directly.
    """
    enabled = _CAPABILITY_ID in getattr(ctx, "enabled_capabilities", set())

    if not ai_caps.should_invoke(enabled=enabled):
        log.info("ai_openend_grade disabled, delegating to recall_self (card=%s)", card.card_id)
        fallback = HANDLERS.get("recall_self")
        if fallback is not None:
            return await fallback(ctx, card)
        return HandlerResult(card_id=card.card_id, verdict="skip", done=True)

    user_answer = await _collect_answer(ctx, card)

    if user_answer is None:
        return HandlerResult(card_id=card.card_id, verdict="skip", done=True)

    return await ai_caps.grade_or_self_fallback(ctx, card, user_answer, HANDLERS)
