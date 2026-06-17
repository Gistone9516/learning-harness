# -*- coding: utf-8 -*-
"""short_modal handler (learning-types layer2, capability_id=short_modal).

Flow: present func/proc card front -> button click -> modal short-answer input -> normalized scoring -> matched/missed feedback.
discord import OK.
"""
from __future__ import annotations

import logging
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import asyncio
import discord
from models import CardDef, HandlerResult, ScoreInput
from scoring import score
from gating import allowed_interaction

log = logging.getLogger(__name__)

_COLOR_MAIN = 0x5865F2
_COLOR_DONE = 0x57F287
_COLOR_DANGER = 0xED4245


def _progress_prefix(ctx) -> str:
    p = getattr(ctx, "progress", None)
    return f"📘 카드 {p[0]}/{p[1]}\n\n" if p else ""


class _AnswerModal(discord.ui.Modal):
    def __init__(self, title: str, future: asyncio.Future) -> None:
        super().__init__(title=title[:45])
        self._future = future
        self.answer = discord.ui.TextInput(
            label="답변",
            placeholder="답을 입력하세요.",
            max_length=500,
        )
        self.add_item(self.answer)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        if not self._future.done():
            self._future.set_result(self.answer.value)
        await interaction.response.send_message("입력됨.", ephemeral=True)

    async def on_error(self, interaction: discord.Interaction, error: Exception) -> None:
        if not self._future.done():
            self._future.set_result(None)


async def handle(ctx, card: CardDef) -> HandlerResult:
    """short_modal handler."""
    channel = ctx.channel
    user_id = ctx.user_id
    synonyms = ctx.synonyms
    grade_mode_of = ctx.grade_mode_of

    front = card.front or {}
    prompt = front.get("prompt", "")
    hint = front.get("hint", "")

    front_text = f"{_progress_prefix(ctx)}**Q.** {prompt}"
    if hint:
        front_text += f"\n\n*힌트: {hint}*"

    loop = asyncio.get_running_loop()
    future: asyncio.Future[str | None] = loop.create_future()

    class ModalTriggerView(discord.ui.View):
        def __init__(self) -> None:
            super().__init__(timeout=600)
            self._opened = False

        @discord.ui.button(label="✏️ 답변 입력", style=discord.ButtonStyle.primary)
        async def open_modal(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
            if not allowed_interaction(interaction, user_id):
                await interaction.response.send_message("권한 없음.", ephemeral=True)
                return
            if self._opened:
                await interaction.response.defer()
                return
            self._opened = True
            modal = _AnswerModal(f"Q. {prompt[:40]}", future)
            await interaction.response.send_modal(modal)
            self.stop()

        async def on_timeout(self) -> None:
            if not future.done():
                future.set_result(None)

    trigger_view = ModalTriggerView()
    # Send the card front text with the trigger view
    await channel.send(content=front_text, view=trigger_view)

    user_answer = await future
    if user_answer is None:
        return HandlerResult(card_id=card.card_id, verdict="skip", done=True)

    # Score the answer
    effective_mode = grade_mode_of(card.card_id)
    spec = card.answer_spec
    if spec is None:
        return HandlerResult(card_id=card.card_id, verdict="skip", done=True)

    try:
        result = score(ScoreInput(
            mode=effective_mode,
            user_answer=user_answer,
            answer_spec=spec,
            synonyms=synonyms if synonyms else None,
        ))
    except Exception as e:
        log.warning("scoring error (card=%s): %s", card.card_id, e)
        return HandlerResult(card_id=card.card_id, verdict="incorrect", requeue=True, done=True)

    verdict = result.verdict
    is_incorrect = verdict == "incorrect"

    # Feedback with matched/missed keyword highlights
    if verdict == "correct":
        fb_lines = [f"✅ 정답! 맞은 키워드: {', '.join(result.matched) if result.matched else '-'}"]
    else:
        fb_lines = ["❌ 오답."]
        if result.missed:
            fb_lines.append(f"빠진 키워드: **{', '.join(result.missed)}**")
        back = card.back or {}
        detail = back.get("detail", "")
        if detail:
            fb_lines.append(detail)

    fb_text = "\n".join(fb_lines)
    color = _COLOR_DONE if verdict == "correct" else _COLOR_DANGER
    fb_view = discord.ui.LayoutView(timeout=None)
    fb_view.add_item(discord.ui.Container(
        discord.ui.TextDisplay(fb_text),
        accent_colour=color,
    ))
    await channel.send(view=fb_view)

    return HandlerResult(
        card_id=card.card_id,
        verdict=verdict,
        requeue=is_incorrect,
        done=True,
    )
