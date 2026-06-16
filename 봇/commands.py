# -*- coding: utf-8 -*-
"""슬래시 명령 + 매직워드 (봇계약 §6).

슬래시: /study(옵션 --dday), /review, /due, /stats, /card, /concept, /settings, /help.
매직워드: 중단/stop.
discord import OK.
"""
from __future__ import annotations

import logging
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _paths
_paths.setup()

import discord
from discord import app_commands
from typing import TYPE_CHECKING

from gating import allowed_msg, allowed_interaction

if TYPE_CHECKING:
    pass

log = logging.getLogger(__name__)

# 매직워드 집합
STOP_WORDS = {"중단", "stop"}


def setup_commands(
    tree: app_commands.CommandTree,
    guild: discord.Object,
    boot_result,
    get_session_runner,
) -> None:
    """슬래시 명령을 CommandTree에 등록.

    boot_result: BootResult (boot.load 반환).
    get_session_runner: () -> run_session 코루틴 팩토리.
    """

    @tree.command(name="study", description="학습 세션 시작", guild=guild)
    @app_commands.describe(
        deck="덱 namespace (미지정 시 기본)",
        unit="단원 필터 (선택)",
        dday="D-day 모드 활성화",
    )
    async def study_cmd(
        interaction: discord.Interaction,
        deck: str | None = None,
        unit: str | None = None,
        dday: bool = False,
    ) -> None:
        if not allowed_interaction(interaction, boot_result.deck.namespace and interaction.user.id):
            await interaction.response.send_message("권한 없음.", ephemeral=True)
            return
        await interaction.response.send_message(
            f"학습 시작 (dday={dday}, deck={deck or '기본'}, unit={unit or '전체'}).",
            ephemeral=True,
        )
        runner = get_session_runner()
        if runner:
            await runner(interaction, deck=deck, unit=unit, dday_mode=dday)

    @tree.command(name="review", description="오답 복습", guild=guild)
    async def review_cmd(interaction: discord.Interaction) -> None:
        if not allowed_interaction(interaction, interaction.user.id):
            await interaction.response.send_message("권한 없음.", ephemeral=True)
            return
        await interaction.response.send_message("복습 모드는 준비 중.", ephemeral=True)

    @tree.command(name="due", description="due 카드 수 확인", guild=guild)
    async def due_cmd(interaction: discord.Interaction) -> None:
        if not allowed_interaction(interaction, interaction.user.id):
            await interaction.response.send_message("권한 없음.", ephemeral=True)
            return
        store = boot_result.store
        import time
        now = int(time.time() * 1000)
        from leitner import is_due
        due_count = sum(
            1 for cp in store.cards.values() if is_due(cp, now)
        )
        await interaction.response.send_message(
            f"현재 due 카드: **{due_count}장**", ephemeral=True
        )

    @tree.command(name="stats", description="학습 통계 조회", guild=guild)
    async def stats_cmd(interaction: discord.Interaction) -> None:
        if not allowed_interaction(interaction, interaction.user.id):
            await interaction.response.send_message("권한 없음.", ephemeral=True)
            return
        store = boot_result.store
        total = len(store.cards)
        graduated = sum(1 for cp in store.cards.values() if cp.graduated)
        await interaction.response.send_message(
            f"총 카드: {total} | 졸업: {graduated} | 진행 중: {total - graduated}",
            ephemeral=True,
        )

    @tree.command(name="card", description="카드 정보 조회", guild=guild)
    @app_commands.describe(card_id="조회할 card_id")
    async def card_cmd(interaction: discord.Interaction, card_id: str) -> None:
        if not allowed_interaction(interaction, interaction.user.id):
            await interaction.response.send_message("권한 없음.", ephemeral=True)
            return
        deck = boot_result.deck
        found = next((c for c in deck.cards if c.card_id == card_id), None)
        if found is None:
            await interaction.response.send_message(f"카드 없음: {card_id}", ephemeral=True)
            return
        front = found.front or {}
        prompt = front.get("prompt") or front.get("text") or front.get("scenario", "")
        await interaction.response.send_message(
            f"**{card_id}** ({found.type}/{found.grade_mode})\n{prompt}",
            ephemeral=True,
        )

    @tree.command(name="concept", description="개념 참조 조회", guild=guild)
    @app_commands.describe(ref="concept_ref id")
    async def concept_cmd(interaction: discord.Interaction, ref: str) -> None:
        if not allowed_interaction(interaction, interaction.user.id):
            await interaction.response.send_message("권한 없음.", ephemeral=True)
            return
        await interaction.response.send_message(
            f"개념 조회: {ref} (콘텐츠 링크 기능은 콘텐츠 데이터에 따라 다름.)",
            ephemeral=True,
        )

    @tree.command(name="settings", description="봇 설정 조회", guild=guild)
    async def settings_cmd(interaction: discord.Interaction) -> None:
        if not allowed_interaction(interaction, interaction.user.id):
            await interaction.response.send_message("권한 없음.", ephemeral=True)
            return
        caps = ", ".join(sorted(boot_result.enabled_capabilities))
        await interaction.response.send_message(
            f"활성 능력: {caps}", ephemeral=True
        )

    @tree.command(name="help", description="도움말", guild=guild)
    async def help_cmd(interaction: discord.Interaction) -> None:
        await interaction.response.send_message(
            "/study [deck] [unit] [dday] - 학습 시작\n"
            "/review - 오답 복습\n"
            "/due - due 카드 수\n"
            "/stats - 통계\n"
            "/card <id> - 카드 조회\n"
            "/concept <ref> - 개념 조회\n"
            "중단 / stop - 세션 중단",
            ephemeral=True,
        )


async def check_stop_word(message: discord.Message, session_store: dict) -> bool:
    """매직워드(중단/stop) 감지. 활성 세션이면 중단. 반환: 처리됨 여부."""
    content = (message.content or "").strip().lower()
    if content not in STOP_WORDS:
        return False

    user_id = message.author.id
    sess = session_store.get(user_id)
    if sess is not None:
        sess.active = False
        await message.channel.send(
            f"<@{user_id}> 세션을 중단했습니다."
        )
    else:
        await message.channel.send(
            f"<@{user_id}> 진행 중인 세션이 없습니다."
        )
    return True
