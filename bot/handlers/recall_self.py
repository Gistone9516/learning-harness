# -*- coding: utf-8 -*-
"""recall_self handler (learning-types layer2, capability_id=recall_self).

Flow: show card front -> "Show Answer" button -> Yes(correct)/No(incorrect) self-judgment -> HandlerResult.
discord import OK (handlers/ folder is permitted).
"""
from __future__ import annotations

import logging
import sys
import os

# Add bot root to path (handler lives under bot/)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import discord
from models import CardDef, HandlerResult
from gating import allowed_interaction

log = logging.getLogger(__name__)

# Button colors
_COLOR_MAIN = 0x5865F2
_COLOR_DONE = 0x57F287
_COLOR_WARN = 0xF1C40F


def _front_text(card: CardDef) -> str:
    """Build card front text."""
    front = card.front or {}
    prompt = front.get("prompt") or front.get("text") or front.get("scenario", "")
    hint = front.get("hint", "")
    text = f"**Q.** {prompt}"
    if hint:
        text += f"\n\n*힌트: {hint}*"
    return text


def _back_text(card: CardDef) -> str:
    """Build card back text (answer + explanation)."""
    back = card.back or {}
    parts: list[str] = []

    spec = card.answer_spec
    if spec:
        if spec.accepted:
            parts.append("**정답:** " + " / ".join(spec.accepted))
        elif spec.sequence:
            parts.append("**순서:** " + " -> ".join(spec.sequence))

    detail = back.get("detail", "")
    note = back.get("note", "")
    why = back.get("why", "")

    if detail:
        parts.append(detail)
    if note:
        parts.append(f"*{note}*")
    if why:
        parts.append(f"이유: {why}")

    return "\n\n".join(parts) if parts else "(정답 없음)"


async def handle(ctx, card: CardDef) -> HandlerResult:
    """recall_self handler."""
    channel = ctx.channel
    user_id = ctx.user_id

    import asyncio
    loop = asyncio.get_running_loop()
    future: asyncio.Future[str] = loop.create_future()

    # Show Answer button
    class ShowAnswerView(discord.ui.View):
        def __init__(self) -> None:
            super().__init__(timeout=600)
            self._shown = False

        @discord.ui.button(label="정답보기", style=discord.ButtonStyle.secondary)
        async def show(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
            if not allowed_interaction(interaction, user_id):
                await interaction.response.send_message("권한 없음.", ephemeral=True)
                return
            if self._shown:
                await interaction.response.defer()
                return
            self._shown = True

            # Reveal answer and show Yes/No buttons
            class JudgeView(discord.ui.View):
                def __init__(self) -> None:
                    super().__init__(timeout=600)

                @discord.ui.button(label="알았어요 (correct)", style=discord.ButtonStyle.success)
                async def correct(self, ia: discord.Interaction, btn: discord.ui.Button) -> None:
                    if not allowed_interaction(ia, user_id):
                        await ia.response.send_message("권한 없음.", ephemeral=True)
                        return
                    if not future.done():
                        future.set_result("correct")
                    self.stop()
                    try:
                        await ia.response.edit_message(
                            content=None,
                            view=_done_view("정답 처리됨."),
                        )
                    except Exception:
                        await ia.response.defer()

                @discord.ui.button(label="몰랐어요 (incorrect)", style=discord.ButtonStyle.danger)
                async def incorrect(self, ia: discord.Interaction, btn: discord.ui.Button) -> None:
                    if not allowed_interaction(ia, user_id):
                        await ia.response.send_message("권한 없음.", ephemeral=True)
                        return
                    if not future.done():
                        future.set_result("incorrect")
                    self.stop()
                    try:
                        await ia.response.edit_message(
                            content=None,
                            view=_done_view("오답 처리됨."),
                        )
                    except Exception:
                        await ia.response.defer()

                async def on_timeout(self) -> None:
                    if not future.done():
                        future.set_result("skip")

            judge_view = JudgeView()
            back_text = _back_text(card)
            judge_view.add_item(discord.ui.Container(
                discord.ui.TextDisplay(back_text),
                accent_colour=_COLOR_MAIN,
            ))
            try:
                await interaction.response.edit_message(view=judge_view)
            except Exception:
                await interaction.response.send_message(view=judge_view, ephemeral=True)

        async def on_timeout(self) -> None:
            if not future.done():
                future.set_result("skip")

    show_view = ShowAnswerView()
    front_text = _front_text(card)
    show_view.add_item(discord.ui.Container(
        discord.ui.TextDisplay(front_text),
        accent_colour=_COLOR_MAIN,
    ))

    await channel.send(view=show_view)

    verdict = await future
    is_incorrect = verdict == "incorrect"

    return HandlerResult(
        card_id=card.card_id,
        verdict=verdict,
        requeue=is_incorrect,
        done=True,
    )


def _done_view(msg: str) -> discord.ui.LayoutView:
    v = discord.ui.LayoutView(timeout=None)
    v.add_item(discord.ui.Container(
        discord.ui.TextDisplay(msg),
        accent_colour=_COLOR_DONE,
    ))
    return v
