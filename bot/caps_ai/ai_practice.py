# -*- coding: utf-8 -*-
"""ai_practice capability (layer 3) — AI dynamically generates a practice problem for a
catalog item, collects the learner's answer, and grades it.

The learner produces an answer that uses the item; the AI grades for correctness and gives
a short Korean explanation. All subject framing (the task wording, model answer expectation,
UI labels) comes from the injected SubjectProfile (task_of), so this stays subject-agnostic.
Falls back to the recall_self flashcard when the capability is disabled or the AI call fails.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import discord

import ai_caps
from models import CardDef, HandlerResult
from gating import allowed_interaction
from dispatch import HANDLERS
from subject import task_of
from text_format import format_tables

log = logging.getLogger(__name__)

_CAP_ID = "ai_practice"
_COLOR_MAIN = 0x5865F2
_COLOR_DONE = 0x57F287
_COLOR_DANGER = 0xED4245

# Generation/grading roles and UI strings are subject-agnostic: they come from
# task_of(ctx, "practice", ...) — the injected SubjectProfile override else a generic
# default (bot/subject.py). Subject identity is carried by the persona auto-injected
# into every preamble; the area is passed via the data slice, not baked into the role.


def _extract_json(text: str) -> dict | None:
    if not text:
        return None
    s = text.strip()
    a, b = s.find("{"), s.rfind("}")
    if a == -1 or b == -1 or b <= a:
        return None
    try:
        obj = json.loads(s[a:b + 1])
    except (json.JSONDecodeError, ValueError):
        return None
    return obj if isinstance(obj, dict) else None


def _item_text(card: CardDef) -> str:
    front = card.front or {}
    return front.get("prompt") or front.get("text") or front.get("scenario") or card.card_id


async def _fallback(ctx, card) -> HandlerResult:
    fb = HANDLERS.get("recall_self")
    if fb is not None:
        return await fb(ctx, card)
    return HandlerResult(card_id=card.card_id, verdict="skip", done=True)


async def _collect_answer(ctx, problem_text: str) -> str | None:
    """Show the AI problem with a modal trigger button; return the learner's text or None."""
    channel = ctx.channel
    user_id = ctx.user_id
    loop = asyncio.get_running_loop()
    future: asyncio.Future[str | None] = loop.create_future()

    modal_title = task_of(ctx, "practice", "modal_title")
    input_label = task_of(ctx, "practice", "modal_input_label")
    problem_prefix = task_of(ctx, "practice", "problem_prefix")

    class _Modal(discord.ui.Modal):
        def __init__(self) -> None:
            super().__init__(title=modal_title)
            self.answer = discord.ui.TextInput(
                label=input_label, style=discord.TextStyle.paragraph, max_length=500,
            )
            self.add_item(self.answer)

        async def on_submit(self, interaction: discord.Interaction) -> None:
            if not future.done():
                future.set_result(self.answer.value)
            await interaction.response.send_message("제출됨.", ephemeral=True)

        async def on_error(self, interaction, error) -> None:
            if not future.done():
                future.set_result(None)

    class _Trigger(discord.ui.View):
        def __init__(self) -> None:
            super().__init__(timeout=None)
            self._opened = False

        @discord.ui.button(label="✍️ 답 작성", style=discord.ButtonStyle.primary)
        async def open(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
            if not allowed_interaction(interaction, user_id):
                await interaction.response.send_message("권한 없음.", ephemeral=True)
                return
            if self._opened:
                await interaction.response.defer()
                return
            try:
                await interaction.response.send_modal(_Modal())
            except Exception:
                if not future.done():
                    future.set_result(None)
                return
            self._opened = True
            self.stop()

        async def on_timeout(self) -> None:
            if not future.done():
                future.set_result(None)

    await channel.send(content=format_tables(f"**{problem_prefix}** {problem_text}"), view=_Trigger())
    return await future


async def handle(ctx, card: CardDef) -> HandlerResult:
    """ai_practice handler: generate a problem for `card`, collect an answer, grade it."""
    enabled = _CAP_ID in getattr(ctx, "enabled_capabilities", set())
    if not ai_caps.should_invoke(enabled=enabled):
        return await _fallback(ctx, card)

    area = (card.tags or {}).get("area", "")
    subj = getattr(ctx, "subject", None)
    area_label = subj.ko_label(area) if (subj is not None and area) else area
    item = _item_text(card)
    meaning = (card.back or {}).get("detail", "")

    # 1. generate the problem
    # NOTE: no force_json here — the role already mandates {"problem","answer"} JSON.
    # force_json would append the grader's {"verdict","reason"} schema and break generation.
    gen = await ai_caps.one_shot(
        "이 학습 항목으로 풀 연습 문제 1개를 만들어 주세요. JSON만.",
        capability_id=_CAP_ID, ctx=ctx,
        role=task_of(ctx, "practice", "role"),
        data=f"영역: {area_label}\n학습 항목: {item}\n뜻/설명: {meaning}",
    )
    obj = _extract_json(gen.text) if gen.ok else None
    problem = (obj or {}).get("problem")
    model_answer = (obj or {}).get("answer", "")
    if not problem:
        log.info("ai_practice: generation failed (card=%s), fallback to flashcard", card.card_id)
        return await _fallback(ctx, card)

    # 2. collect the learner's answer
    user_answer = await _collect_answer(ctx, problem)
    if user_answer is None:
        return HandlerResult(card_id=card.card_id, verdict="skip", done=True)

    # 3. grade (force JSON verdict + Korean reason)
    gr = await ai_caps.one_shot(
        "Grade the learner answer now.",
        capability_id=_CAP_ID, ctx=ctx, role=task_of(ctx, "practice", "grader_role"),
        data=f"항목: {item}\n문제: {problem}\n모범답안: {model_answer}\n학습자 답: {user_answer}",
        force_json=True,
    )
    verdict, reason = ai_caps.parse_verdict(gr.text) if gr.ok else (None, "")

    if verdict is None:
        if gr.ok:
            log.warning("ai_practice: grader ok=True but parse failed (card=%s, text=%.80r)",
                        card.card_id, gr.text)
        # could not grade: show the model answer, count as skip (no Leitner penalty)
        await ctx.channel.send(
            view=_feedback_view(f"⚠️ 채점을 못했어요. 모범답안: **{model_answer}**", _COLOR_MAIN)
        )
        return HandlerResult(card_id=card.card_id, verdict="skip", done=True)

    ok = verdict == "correct"
    head = "✅ 좋아요!" if ok else "❌ 다시 볼까요"
    body = f"{head}\n{reason}".strip()
    if model_answer:
        body += f"\n\n모범답안: **{model_answer}**"
    await ctx.channel.send(view=_feedback_view(format_tables(body), _COLOR_DONE if ok else _COLOR_DANGER))

    return HandlerResult(card_id=card.card_id, verdict=verdict, requeue=not ok, done=True)


def _feedback_view(text: str, color: int) -> discord.ui.LayoutView:
    v = discord.ui.LayoutView(timeout=None)
    v.add_item(discord.ui.Container(discord.ui.TextDisplay(text), accent_colour=color))
    return v
