# -*- coding: utf-8 -*-
"""cloze_modal 핸들러 (학습타입규격 layer2, capability_id=cloze_modal).

흐름: cloze 카드 텍스트(빈칸 마커 표시) 제시 -> 모달 N칸 입력 -> 빈칸별 채점 -> 피드백.
discord import OK.
"""
from __future__ import annotations

import logging
import sys
import os
import re

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


def _display_cloze_text(text: str) -> str:
    """{{0}} -> [빈칸1], {{1}} -> [빈칸2] 등으로 표시."""
    def replace_marker(m: re.Match) -> str:
        idx = int(m.group(1))
        return f"[빈칸{idx+1}]"
    return re.sub(r"\{\{(\d+)\}\}", replace_marker, text)


class _ClozeModal(discord.ui.Modal):
    def __init__(self, title: str, blank_count: int, future: asyncio.Future) -> None:
        super().__init__(title=title[:45])
        self._future = future
        self._inputs: list[discord.ui.TextInput] = []
        for i in range(min(blank_count, 5)):  # 모달 최대 5칸
            ti = discord.ui.TextInput(
                label=f"빈칸 {i+1}",
                placeholder=f"{i+1}번째 빈칸의 답",
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


async def handle(ctx, card: CardDef) -> HandlerResult:
    """cloze_modal 핸들러."""
    channel = ctx.channel
    user_id = ctx.user_id
    synonyms = ctx.synonyms
    grade_mode_of = ctx.grade_mode_of

    front = card.front or {}
    raw_text = front.get("text", "")
    display_text = _display_cloze_text(raw_text)

    spec = card.answer_spec
    blank_count = len(spec.blanks) if (spec and spec.blanks) else 0

    if blank_count == 0:
        return HandlerResult(card_id=card.card_id, verdict="skip", done=True)

    loop = asyncio.get_running_loop()
    future: asyncio.Future[list[str] | None] = loop.create_future()

    class ClozeView(discord.ui.View):
        def __init__(self) -> None:
            super().__init__(timeout=600)
            self._opened = False

        @discord.ui.button(label="빈칸 채우기", style=discord.ButtonStyle.primary)
        async def open_modal(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
            if not allowed_interaction(interaction, user_id):
                await interaction.response.send_message("권한 없음.", ephemeral=True)
                return
            if self._opened:
                await interaction.response.defer()
                return
            self._opened = True
            modal = _ClozeModal("빈칸 채우기", blank_count, future)
            await interaction.response.send_modal(modal)
            self.stop()

        async def on_timeout(self) -> None:
            if not future.done():
                future.set_result(None)

    cloze_view = ClozeView()
    await channel.send(content=f"**빈칸 채우기**\n\n{display_text}", view=cloze_view)

    user_answers = await future
    if user_answers is None:
        return HandlerResult(card_id=card.card_id, verdict="skip", done=True)

    # 채점 (cloze 모드)
    effective_mode = grade_mode_of(card.card_id)
    if spec is None:
        return HandlerResult(card_id=card.card_id, verdict="skip", done=True)

    try:
        result = score(ScoreInput(
            mode=effective_mode,
            user_answer=user_answers,
            answer_spec=spec,
            synonyms=synonyms if synonyms else None,
        ))
    except Exception as e:
        log.warning("채점 오류(card=%s): %s", card.card_id, e)
        return HandlerResult(card_id=card.card_id, verdict="incorrect", requeue=True, done=True)

    verdict = result.verdict
    is_incorrect = verdict == "incorrect"

    # 피드백: 빈칸별 맞음/틀림
    blanks = spec.blanks or []
    fb_lines = []
    for i, (user_val, candidates) in enumerate(zip(user_answers, blanks)):
        idx_str = str(i)
        if idx_str in result.matched:
            fb_lines.append(f"빈칸{i+1}: ✓ {user_val}")
        else:
            correct = candidates[0] if candidates else "?"
            fb_lines.append(f"빈칸{i+1}: ✗ {user_val} (정답: {correct})")

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
