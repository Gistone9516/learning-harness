# -*- coding: utf-8 -*-
"""Study control panel (capability_id=control_panel).

A persistent button panel that drives the whole study flow without typing slash
commands. Posted on bot ready and after each session ends, and re-summoned via /ui.

Persistence: timeout=None View + fixed custom_id buttons + client.add_view() at boot
(bot-contract §7), so the panel keeps working after a restart.
"""
from __future__ import annotations

import logging
import time

import _paths
_paths.setup()

import discord

from gating import allowed_interaction
import capability_registry as _reg

log = logging.getLogger(__name__)

PANEL_COLOR = 0x5865F2


def unit_for(mode: str, day: int) -> str:
    """Map a (mode, day) to the deck unit id. 'learn' -> day-NN-learn, else day-NN."""
    return f"day-{day:02d}-learn" if mode == "learn" else f"day-{day:02d}"


class DayModal(discord.ui.Modal):
    """Ask which DAY to study (1-30), then launch that unit via the runner."""

    def __init__(self, mode: str, runner) -> None:
        super().__init__(title="암기할 DAY 선택" if mode == "learn" else "시험볼 DAY 선택")
        self._mode = mode
        self._runner = runner
        self.day = discord.ui.TextInput(
            label="DAY (1-30)", placeholder="예: 1", max_length=2, required=True,
        )
        self.add_item(self.day)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        raw = (self.day.value or "").strip()
        if not raw.isdigit() or not (1 <= int(raw) <= 30):
            await interaction.response.send_message("1부터 30 사이 숫자를 입력하세요.", ephemeral=True)
            return
        unit = unit_for(self._mode, int(raw))
        label = "암기" if self._mode == "learn" else "시험"
        await interaction.response.send_message(f"{label}: {unit} 시작합니다.", ephemeral=True)
        await self._runner(interaction, unit=unit)


class ControlPanelView(discord.ui.View):
    """Persistent study control panel. Buttons are built from the enabled capability set."""

    def __init__(self, runner, boot_result, make_ctx, user_id: int) -> None:
        super().__init__(timeout=None)
        self._runner = runner
        self._br = boot_result
        self._make_ctx = make_ctx
        self._uid = user_id
        enabled = set(getattr(boot_result, "enabled_capabilities", set()) or set())

        self._add("📚 이어서 학습", discord.ButtonStyle.success, "panel:study", self._study)
        self._add("📖 암기", discord.ButtonStyle.primary, "panel:learn", self._learn)
        self._add("✏️ 시험", discord.ButtonStyle.primary, "panel:quiz", self._quiz)
        self._add("🔁 복습", discord.ButtonStyle.secondary, "panel:review", self._review)
        if {"dashboard_live", "box_table", "mastery_chart"} & enabled:
            self._add("📊 대시보드", discord.ButtonStyle.secondary, "panel:dashboard", self._dashboard)
        self._add("📈 통계", discord.ButtonStyle.secondary, "panel:stats", self._stats)
        self._add("❓ 도움말", discord.ButtonStyle.secondary, "panel:help", self._help)

    def _add(self, label, style, custom_id, callback) -> None:
        btn = discord.ui.Button(label=label, style=style, custom_id=custom_id)
        btn.callback = callback
        self.add_item(btn)

    async def _guard(self, interaction: discord.Interaction) -> bool:
        if not allowed_interaction(interaction, self._uid):
            await interaction.response.send_message("권한 없음.", ephemeral=True)
            return False
        return True

    async def _study(self, interaction: discord.Interaction) -> None:
        if not await self._guard(interaction):
            return
        await interaction.response.send_message("학습을 시작합니다.", ephemeral=True)
        await self._runner(interaction)

    async def _learn(self, interaction: discord.Interaction) -> None:
        if not await self._guard(interaction):
            return
        await interaction.response.send_modal(DayModal("learn", self._runner))

    async def _quiz(self, interaction: discord.Interaction) -> None:
        if not await self._guard(interaction):
            return
        await interaction.response.send_modal(DayModal("quiz", self._runner))

    async def _review(self, interaction: discord.Interaction) -> None:
        if not await self._guard(interaction):
            return
        await interaction.response.send_message("복습을 시작합니다.", ephemeral=True)
        await self._runner(interaction, review=True)

    async def _dashboard(self, interaction: discord.Interaction) -> None:
        if not await self._guard(interaction):
            return
        await interaction.response.send_message("대시보드 생성 중.", ephemeral=True)
        from dashboard import get_dashboard_data
        data = get_dashboard_data(
            self._br.deck, self._br.store, int(time.time() * 1000), self._br.pass_targets
        )
        enabled = set(self._br.enabled_capabilities)
        if "dashboard_live" in enabled:
            from render.dashboard_live import render as _r
            await _r(interaction.channel, data)
        if "box_table" in enabled:
            from render.box_table import render as _r
            await _r(interaction.channel, data)
        if "mastery_chart" in enabled:
            from render.mastery_chart import render as _r
            await _r(interaction.channel, data)

    async def _stats(self, interaction: discord.Interaction) -> None:
        if not await self._guard(interaction):
            return
        store = self._br.store
        total = len(store.cards)
        grad = sum(1 for cp in store.cards.values() if cp.graduated)
        await interaction.response.send_message(
            f"총 카드: {total} | 졸업: {grad} | 진행 중: {total - grad}", ephemeral=True
        )

    async def _help(self, interaction: discord.Interaction) -> None:
        if not await self._guard(interaction):
            return
        await interaction.response.send_message(
            "📚 이어서 학습: due + 신규 섞어 학습\n"
            "📖 암기: DAY 입력 → 그날 플래시카드(자기채점)\n"
            "✏️ 시험: DAY 입력 → 그날 문제 풀이\n"
            "🔁 복습: 오답·due 카드만\n"
            "📊 대시보드 · 📈 통계 · /UI 로 패널 재호출",
            ephemeral=True,
        )


def build_panel_view(runner, boot_result, make_ctx, user_id: int) -> ControlPanelView:
    return ControlPanelView(runner, boot_result, make_ctx, user_id)


async def post_panel(channel, runner, boot_result, make_ctx, user_id: int):
    """Send the control panel (header text + buttons) to a channel."""
    view = build_panel_view(runner, boot_result, make_ctx, user_id)
    content = (
        "📘 **학습 제어판**\n"
        "버튼으로 학습을 시작하세요. 암기/시험은 DAY(1-30)를 입력합니다."
    )
    await channel.send(content=content, view=view)
    return view
