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
from text_format import format_tables

log = logging.getLogger(__name__)

# Button colors
_COLOR_MAIN = 0x5865F2
_COLOR_DONE = 0x57F287
_COLOR_WARN = 0xF1C40F


def _progress_prefix(ctx) -> str:
    p = getattr(ctx, "progress", None)
    return f"📘 카드 {p[0]}/{p[1]}\n\n" if p else ""


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


def _done_card(msg: str, color: int) -> discord.ui.LayoutView:
    v = discord.ui.LayoutView(timeout=None)
    v.add_item(discord.ui.Container(discord.ui.TextDisplay(msg), accent_colour=color))
    return v


async def handle(ctx, card: CardDef) -> HandlerResult:
    """recall_self handler. Front -> 정답 보기 -> Components V2 reveal card with
    ✅ 알았어요 / ❌ 몰랐어요 / 🤖 AI 해설 buttons."""
    channel = ctx.channel
    user_id = ctx.user_id
    enabled = getattr(ctx, "enabled_capabilities", set()) or set()

    import asyncio
    loop = asyncio.get_running_loop()
    future: asyncio.Future[str] = loop.create_future()

    front_text = _progress_prefix(ctx) + _front_text(card)
    # Discord does not render markdown tables; normalize any table in the explanation to a
    # monospace code-block table (the kit-wide standard). No-op on text without tables.
    reveal_text = format_tables(f"{front_text}\n\n{_back_text(card)}")

    # Reveal as a Components V2 LayoutView (holds the long explanation + buttons).
    class RevealView(discord.ui.LayoutView):
        def __init__(self) -> None:
            super().__init__(timeout=None)
            self._explain_task = None
            b_ok = discord.ui.Button(label="✅ 알았어요", style=discord.ButtonStyle.success)
            b_ok.callback = self._correct
            b_no = discord.ui.Button(label="❌ 몰랐어요", style=discord.ButtonStyle.danger)
            b_no.callback = self._incorrect
            row = [b_ok, b_no]
            if "ai_explain" in enabled:
                b_ai = discord.ui.Button(label="🤖 AI 해설", style=discord.ButtonStyle.primary)
                b_ai.callback = self._explain
                row.append(b_ai)
            self.add_item(discord.ui.Container(
                discord.ui.TextDisplay(reveal_text),
                discord.ui.ActionRow(*row),
                accent_colour=_COLOR_MAIN,
            ))

        def _cancel_explain(self) -> None:
            t = self._explain_task
            if t is not None and not t.done():
                t.cancel()

        async def _correct(self, ia: discord.Interaction) -> None:
            if not allowed_interaction(ia, user_id):
                await ia.response.send_message("권한 없음.", ephemeral=True)
                return
            if not future.done():
                future.set_result("correct")
            self._cancel_explain()
            try:
                await ia.response.edit_message(view=_done_card("✅ 정답으로 기록했어요.", _COLOR_DONE))
            except Exception:
                try:
                    await ia.followup.send("✅ 정답으로 기록했어요.", ephemeral=True)
                except Exception:
                    pass
            finally:
                self.stop()

        async def _incorrect(self, ia: discord.Interaction) -> None:
            if not allowed_interaction(ia, user_id):
                await ia.response.send_message("권한 없음.", ephemeral=True)
                return
            if not future.done():
                future.set_result("incorrect")
            self._cancel_explain()
            try:
                await ia.response.edit_message(view=_done_card("❌ 오답으로 기록했어요.", _COLOR_WARN))
            except Exception:
                try:
                    await ia.followup.send("❌ 오답으로 기록했어요.", ephemeral=True)
                except Exception:
                    pass
            finally:
                self.stop()

        async def _explain(self, ia: discord.Interaction) -> None:
            # 학습 흐름과 무관: 해설 스레드만 띄움(알았어요/몰랐어요는 그대로 사용 가능).
            if not allowed_interaction(ia, user_id):
                await ia.response.send_message("권한 없음.", ephemeral=True)
                return
            try:
                await ia.response.send_message("🤖 개념 해설 스레드를 열게요.", ephemeral=True)
            except Exception:
                pass
            try:
                from caps_ai.ai_explain import run_explain
                # 학습 future와 독립된 태스크로 분리해, 알았어요/몰랐어요나 타임아웃 때 취소할 수 있게 한다.
                self._explain_task = asyncio.create_task(run_explain(ctx, ia.client, card))
            except Exception as e:
                log.warning("ai_explain failed: %s", e)

        async def on_timeout(self) -> None:
            self._cancel_explain()
            if not future.done():
                future.set_result("skip")

    # Show Answer button (plain View + content; reveal is a separate V2 message).
    class ShowAnswerView(discord.ui.View):
        def __init__(self) -> None:
            super().__init__(timeout=None)
            self._shown = False

        @discord.ui.button(label="👀 정답 보기", style=discord.ButtonStyle.secondary)
        async def show(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
            if not allowed_interaction(interaction, user_id):
                await interaction.response.send_message("권한 없음.", ephemeral=True)
                return
            if self._shown:
                await interaction.response.defer()
                return
            self._shown = True
            self.stop()
            try:
                await interaction.response.edit_message(content=front_text, view=None)
            except Exception:
                try:
                    await interaction.response.defer()
                except Exception:
                    pass
            try:
                await channel.send(view=RevealView())
            except Exception as exc:
                # 리빌 전송 실패 시 future가 영구 미해제되어 handle()이 무한 대기하는 것을 막는다.
                log.warning("recall_self: RevealView send failed: %s", exc)
                if not future.done():
                    future.set_result("skip")

        async def on_timeout(self) -> None:
            if not future.done():
                future.set_result("skip")

    await channel.send(content=front_text, view=ShowAnswerView())

    verdict = await future
    return HandlerResult(
        card_id=card.card_id,
        verdict=verdict,
        requeue=(verdict == "incorrect"),
        done=True,
    )
