# -*- coding: utf-8 -*-
"""seq_modal handler (learning-types layer2, capability_id=seq_modal).

Flow: present recall_seq card front -> modal N-step input (cap 5; multiline fallback if >5) ->
grade steps in order -> feedback per step.
discord import OK.
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys

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
_COLOR_DANGER = 0xED4245

# Maximum number of individual TextInput fields a Discord modal may hold.
_MODAL_FIELD_LIMIT = 5


# Pure core

def evaluate_seq(
    card: CardDef,
    user_steps: list[str],
    grade_mode: str,
    synonyms: dict[str, str] | None,
) -> HandlerResult:
    """Grade a recall_seq card against an ordered list of user steps.

    Returns a HandlerResult. Scoring delegates entirely to score() in exact mode,
    which compares the ordered list element-by-element. Any scoring exception
    produces an incorrect verdict with requeue=True.
    """
    spec = card.answer_spec
    if spec is None or spec.sequence is None:
        return HandlerResult(card_id=card.card_id, verdict="skip", done=True)

    try:
        result = score(ScoreInput(
            mode=grade_mode,
            user_answer=user_steps,
            answer_spec=spec,
            synonyms=synonyms if synonyms else None,
        ))
    except Exception as exc:
        log.warning("scoring error (card=%s): %s", card.card_id, exc)
        return HandlerResult(card_id=card.card_id, verdict="incorrect", requeue=True, done=True)

    verdict = result.verdict
    return HandlerResult(
        card_id=card.card_id,
        verdict=verdict,
        requeue=(verdict == "incorrect"),
        done=True,
    )


# Discord modal classes

class _SeqModal(discord.ui.Modal):
    """Modal with one TextInput per sequence step (up to _MODAL_FIELD_LIMIT fields)."""

    def __init__(self, title: str, step_count: int, future: asyncio.Future) -> None:
        super().__init__(title=title[:45])
        self._future = future
        self._inputs: list[discord.ui.TextInput] = []
        for i in range(step_count):
            ti = discord.ui.TextInput(
                label=f"단계 {i + 1}",
                placeholder=f"{i + 1}번째 순서의 답",
                max_length=200,
            )
            self._inputs.append(ti)
            self.add_item(ti)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        values = [ti.value for ti in self._inputs]
        if not self._future.done():
            self._future.set_result(values)
        await interaction.response.send_message("입력됨.", ephemeral=True)

    async def on_error(self, interaction: discord.Interaction, error: Exception) -> None:
        if not self._future.done():
            self._future.set_result(None)


class _SeqMultilineModal(discord.ui.Modal):
    """Fallback modal: a single multiline TextInput when step count exceeds the field limit.

    The learner types each step on its own line.
    """

    def __init__(self, title: str, step_count: int, future: asyncio.Future) -> None:
        super().__init__(title=title[:45])
        self._future = future
        self._step_count = step_count
        self._text_input = discord.ui.TextInput(
            label=f"단계 1~{step_count} (한 줄에 하나씩)",
            placeholder="\n".join(f"{i + 1}단계: ..." for i in range(min(step_count, 3))),
            style=discord.TextStyle.paragraph,
            max_length=2000,
        )
        self.add_item(self._text_input)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        raw = self._text_input.value
        lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
        if not self._future.done():
            self._future.set_result(lines)
        await interaction.response.send_message("입력됨.", ephemeral=True)

    async def on_error(self, interaction: discord.Interaction, error: Exception) -> None:
        if not self._future.done():
            self._future.set_result(None)


# Discord shell

async def handle(ctx, card: CardDef) -> HandlerResult:
    """seq_modal handler. Presents ordered-step modal and grades the result."""
    channel = ctx.channel
    user_id = ctx.user_id
    synonyms = ctx.synonyms
    grade_mode_of = ctx.grade_mode_of

    spec = card.answer_spec
    if spec is None or spec.sequence is None:
        return HandlerResult(card_id=card.card_id, verdict="skip", done=True)

    steps = spec.sequence
    step_count = len(steps)
    use_multiline = step_count > _MODAL_FIELD_LIMIT

    front = card.front or {}
    prompt_text = front.get("text") or front.get("prompt") or card.card_id
    intro = f"**순서 배열**\n\n{prompt_text}"
    if use_multiline:
        intro += f"\n\n({step_count}단계: 한 줄에 하나씩 입력)"

    loop = asyncio.get_running_loop()
    future: asyncio.Future[list[str] | None] = loop.create_future()

    class SeqView(discord.ui.View):
        def __init__(self) -> None:
            super().__init__(timeout=600)
            self._opened = False

        @discord.ui.button(label="순서 입력", style=discord.ButtonStyle.primary)
        async def open_modal(
            self, interaction: discord.Interaction, button: discord.ui.Button
        ) -> None:
            if not allowed_interaction(interaction, user_id):
                await interaction.response.send_message("권한 없음.", ephemeral=True)
                return
            if self._opened:
                await interaction.response.defer()
                return
            self._opened = True
            if use_multiline:
                modal = _SeqMultilineModal("순서 입력", step_count, future)
            else:
                modal = _SeqModal("순서 입력", step_count, future)
            await interaction.response.send_modal(modal)
            self.stop()

        async def on_timeout(self) -> None:
            if not future.done():
                future.set_result(None)

    seq_view = SeqView()
    await channel.send(content=intro, view=seq_view)

    user_steps = await future
    if user_steps is None:
        return HandlerResult(card_id=card.card_id, verdict="skip", done=True)

    effective_mode = grade_mode_of(card.card_id)
    result = evaluate_seq(card, user_steps, effective_mode, synonyms)

    # Build per-step feedback.
    try:
        from scoring import score as _score_fn
        score_result = _score_fn(ScoreInput(
            mode=effective_mode,
            user_answer=user_steps,
            answer_spec=spec,
            synonyms=synonyms if synonyms else None,
        ))
        fb_lines = []
        for i, (user_val, correct_val) in enumerate(zip(user_steps, steps)):
            if score_result.verdict == "correct":
                fb_lines.append(f"단계{i + 1}: O {user_val}")
            else:
                # When user provided the right number of steps, highlight mismatches.
                if len(user_steps) == len(steps) and user_val == steps[i]:
                    fb_lines.append(f"단계{i + 1}: O {user_val}")
                else:
                    fb_lines.append(f"단계{i + 1}: X {user_val} (정답: {correct_val})")
        if len(user_steps) < len(steps):
            for i in range(len(user_steps), len(steps)):
                fb_lines.append(f"단계{i + 1}: (미입력) (정답: {steps[i]})")
        elif len(user_steps) > len(steps):
            for i in range(len(steps), len(user_steps)):
                fb_lines.append(f"단계{i + 1}: X {user_steps[i]} (초과 입력)")
    except Exception:
        fb_lines = ["채점 중 오류가 발생했습니다."]

    verdict = result.verdict
    color = _COLOR_DONE if verdict == "correct" else _COLOR_DANGER
    verdict_label = "정답!" if verdict == "correct" else "오답."
    fb_text = verdict_label + "\n" + "\n".join(fb_lines)

    fb_view = discord.ui.LayoutView(timeout=None)
    fb_view.add_item(discord.ui.Container(
        discord.ui.TextDisplay(fb_text),
        accent_colour=color,
    ))
    await channel.send(view=fb_view)

    return result
