# -*- coding: utf-8 -*-
"""mcq_buttons handler (learning-types layer2, capability_id=mcq_buttons).

Flow: present judge card front (scenario + options) -> button selection (<=5) -> immediate verdict + explanation.
discord import OK.
"""
from __future__ import annotations

import logging
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import discord
from models import CardDef, HandlerResult, ScoreInput
from scoring import score
from gating import allowed_interaction

log = logging.getLogger(__name__)

_COLOR_MAIN = 0x5865F2
_COLOR_DONE = 0x57F287
_COLOR_WARN = 0xF1C40F
_COLOR_DANGER = 0xED4245


def _progress_prefix(ctx) -> str:
    p = getattr(ctx, "progress", None)
    return f"📘 카드 {p[0]}/{p[1]}\n\n" if p else ""


async def handle(ctx, card: CardDef) -> HandlerResult:
    """mcq_buttons handler."""
    channel = ctx.channel
    user_id = ctx.user_id
    synonyms = ctx.synonyms
    grade_mode_of = ctx.grade_mode_of

    front = card.front or {}
    scenario = front.get("scenario") or front.get("prompt", "")
    options: list[str] = front.get("options", [])
    if not isinstance(options, list):
        options = []

    options = options[:5]  # max 5 (mcq_buttons)

    import asyncio
    loop = asyncio.get_running_loop()
    future: asyncio.Future[str] = loop.create_future()

    class MCQView(discord.ui.View):
        def __init__(self) -> None:
            super().__init__(timeout=600)
            self._answered = False
            for i, opt in enumerate(options):
                btn = discord.ui.Button(
                    label=opt[:80],
                    style=discord.ButtonStyle.primary,
                    custom_id=f"mcq:{i}",
                )
                btn.callback = self._make_cb(opt)
                self.add_item(btn)

        def _make_cb(self, option: str):
            async def cb(interaction: discord.Interaction) -> None:
                if not allowed_interaction(interaction, user_id):
                    await interaction.response.send_message("권한 없음.", ephemeral=True)
                    return
                if self._answered:
                    await interaction.response.defer()
                    return
                self._answered = True
                if not future.done():
                    future.set_result(option)
                self.stop()
                try:
                    await interaction.response.defer()
                except Exception:
                    pass
            return cb

        async def on_timeout(self) -> None:
            if not future.done():
                future.set_result("__timeout__")

    # send question text + option buttons
    q_text = f"{_progress_prefix(ctx)}**Q.** {scenario}"
    await channel.send(content=q_text, view=_build_mcq_view(scenario, options, user_id, future))

    user_answer = await future
    if user_answer == "__timeout__":
        return HandlerResult(card_id=card.card_id, verdict="skip", done=True)

    # grade
    effective_mode = grade_mode_of(card.card_id)
    spec = card.answer_spec
    if spec is None or effective_mode == "self":
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

    # feedback
    back = card.back or {}
    detail = back.get("detail", "")
    if result.matched:
        fb = f"✅ 정답! **{result.matched[0]}**"
    else:
        acc = spec.accepted or []
        correct_ans = acc[0] if acc else "?"
        fb = f"❌ 오답. 정답: **{correct_ans}**"
    if detail:
        fb += f"\n{detail}"

    fb_view = discord.ui.LayoutView(timeout=None)
    color = _COLOR_DONE if verdict == "correct" else _COLOR_DANGER
    fb_view.add_item(discord.ui.Container(
        discord.ui.TextDisplay(fb),
        accent_colour=color,
    ))
    await channel.send(view=fb_view)

    return HandlerResult(
        card_id=card.card_id,
        verdict=verdict,
        requeue=is_incorrect,
        done=True,
    )


def _build_mcq_view(
    scenario: str,
    options: list[str],
    user_id: int,
    future: "asyncio.Future[str]",
) -> discord.ui.View:
    """Build MCQ button View (discord.ui.View based, no discord.ui.LayoutView)."""
    import asyncio

    class _MCQView(discord.ui.View):
        def __init__(self) -> None:
            super().__init__(timeout=600)
            self._answered = False
            for i, opt in enumerate(options):
                btn = discord.ui.Button(
                    label=opt[:80],
                    style=discord.ButtonStyle.primary,
                )
                btn.callback = self._make_cb(opt)
                self.add_item(btn)

        def _make_cb(self, option: str):
            async def cb(interaction: discord.Interaction) -> None:
                if not allowed_interaction(interaction, user_id):
                    await interaction.response.send_message("권한 없음.", ephemeral=True)
                    return
                if self._answered:
                    await interaction.response.defer()
                    return
                self._answered = True
                if not future.done():
                    future.set_result(option)
                self.stop()
                await interaction.response.defer()
            return cb

        async def on_timeout(self) -> None:
            if not future.done():
                future.set_result("__timeout__")

    v = _MCQView()
    return v
