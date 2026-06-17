# -*- coding: utf-8 -*-
"""Study control panel (capability_id=control_panel) — catalog learning hub.

Persistent button panel: per-area (단어/문법/숙어) status with level + learned progress.
Click an area -> ephemeral menu (🧠 암기 / ✍️ AI 연습 / ⬆️⬇️ 레벨). Common row:
🔁 복습 / 🗣 대화 / 📊 대시보드 / 🧹 정리 / ❓ 도움말. Level change shows a difficulty
example and a confirm dialog, then bulk-updates the learned flags (level_state).

Persistence: timeout=None + fixed custom_id + client.add_view() (bot-contract §7).
Injected callables (from main): runner(interaction, **kw) [no ack], convo_fn(interaction),
clear_fn(interaction), refresh_fn(channel) — each handles its own ack where noted.
"""
from __future__ import annotations

import logging
import time

import _paths
_paths.setup()

import discord

from gating import allowed_interaction
import level_state as _ls

log = logging.getLogger(__name__)

PANEL_COLOR = 0x5865F2
_WARN = 0xF1C40F
_AREAS = ("vocab", "grammar", "idiom")
_AREA_EMOJI = {"vocab": "📚", "grammar": "📖", "idiom": "💬"}


def _bar(done: int, total: int, width: int = 5) -> str:
    if total <= 0:
        return "░" * width
    filled = round(width * done / total)
    return "▓" * filled + "░" * (width - filled)


def _area_cards(boot_result, area: str):
    return [c for c in boot_result.deck.cards if (c.tags or {}).get("area") == area]


def status_text(boot_result) -> str:
    br = boot_result
    lines = ["📘 **학습 제어판**"]
    for area in _AREAS:
        cards = _area_cards(br, area)
        total = len(cards)
        if total == 0:
            continue
        learned = sum(1 for c in cards if _ls.is_learned(br.mount, br.deck.namespace, c.card_id))
        lvl = _ls.get_level(br.mount, br.deck.namespace, area)
        lines.append(f"{_AREA_EMOJI[area]} {_ls.ko_label(area)}  Lv{lvl}  {_bar(learned, total)} {learned}/{total} 배움")
    lines.append("영역을 고르면 🧠 암기 / ✍️ AI 연습 / 레벨 조절을 선택해요.")
    return "\n".join(lines)


def _level_example(boot_result, area: str, level: int) -> str:
    """A token-0 difficulty preview: 1~2 representative items at that level."""
    samples = [c for c in _area_cards(boot_result, area) if (c.tags or {}).get("level") == level][:2]
    if not samples:
        return "(이 레벨 예시 항목이 아직 없어요.)"
    out = []
    for c in samples:
        fr = c.front or {}
        head = fr.get("prompt") or fr.get("text") or c.card_id
        detail = (c.back or {}).get("detail", "")
        out.append(f"• {head} — {detail}" if detail else f"• {head}")
    return "\n".join(out)


# ── ephemeral: level change confirm ─────────────────────────────────────────────

class _LevelConfirmView(discord.ui.View):
    def __init__(self, hub, area: str, new_level: int) -> None:
        super().__init__(timeout=180)
        self._hub = hub
        self._area = area
        self._new = new_level

    @discord.ui.button(label="예, 바꿀게요", style=discord.ButtonStyle.success)
    async def yes(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        if not allowed_interaction(interaction, self._hub.user_id):
            await interaction.response.send_message("권한 없음.", ephemeral=True)
            return
        br = self._hub.boot_result
        area_cards = [
            (c.card_id, (c.tags or {}).get("level"))
            for c in _area_cards(br, self._area)
            if isinstance((c.tags or {}).get("level"), int)
        ]
        res = _ls.apply_level_change(br.mount, br.deck.namespace, area_cards, self._area, self._new)
        await interaction.response.send_message(
            f"{_ls.ko_label(self._area)} 레벨을 {res['old']} → {res['new']}로 바꿨어요. (배움 {res['changed']}개 자동 갱신)",
            ephemeral=True,
        )
        await self._hub.refresh(interaction.channel)
        self.stop()

    @discord.ui.button(label="아니요", style=discord.ButtonStyle.secondary)
    async def no(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        await interaction.response.send_message("레벨을 그대로 둘게요.", ephemeral=True)
        self.stop()


# ── ephemeral: per-area mode menu ───────────────────────────────────────────────

class _AreaMenuView(discord.ui.View):
    def __init__(self, hub, area: str) -> None:
        super().__init__(timeout=180)
        self._hub = hub
        self._area = area

    async def _guard(self, interaction) -> bool:
        if not allowed_interaction(interaction, self._hub.user_id):
            await interaction.response.send_message("권한 없음.", ephemeral=True)
            return False
        return True

    @discord.ui.button(label="🧠 암기", style=discord.ButtonStyle.primary)
    async def learn(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        if not await self._guard(interaction):
            return
        await interaction.response.send_message("🧠 암기를 시작합니다.", ephemeral=True)
        await self._hub.runner(interaction, area=self._area, mode="learn")

    @discord.ui.button(label="✍️ AI 연습", style=discord.ButtonStyle.primary)
    async def practice(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        if not await self._guard(interaction):
            return
        await interaction.response.send_message("✍️ AI 연습을 시작합니다.", ephemeral=True)
        await self._hub.runner(interaction, area=self._area, mode="practice")

    @discord.ui.button(label="⬆️ 레벨", style=discord.ButtonStyle.secondary)
    async def up(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        await self._level_change(interaction, +1)

    @discord.ui.button(label="⬇️ 레벨", style=discord.ButtonStyle.secondary)
    async def down(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        await self._level_change(interaction, -1)

    async def _level_change(self, interaction, delta: int) -> None:
        if not await self._guard(interaction):
            return
        br = self._hub.boot_result
        cur = _ls.get_level(br.mount, br.deck.namespace, self._area)
        new = _ls.clamp_level(cur + delta)
        if new == cur:
            await interaction.response.send_message(
                f"이미 {'최고' if delta > 0 else '최저'} 레벨이에요 (Lv{cur}).", ephemeral=True)
            return
        example = _level_example(br, self._area, new)
        body = (
            f"**{_ls.ko_label(self._area)} 레벨 {cur} → {new}**\n"
            f"이 레벨은 이정도 난이도예요:\n{example}\n\n정말 바꾸시겠어요?"
        )
        await interaction.response.send_message(
            body, view=_LevelConfirmView(self._hub, self._area, new), ephemeral=True)


# ── persistent: the hub panel ───────────────────────────────────────────────────

class ControlPanelView(discord.ui.View):
    def __init__(self, runner, boot_result, make_ctx, user_id, *,
                 convo_fn=None, clear_fn=None, refresh_fn=None) -> None:
        super().__init__(timeout=None)
        self.runner = runner
        self.boot_result = boot_result
        self.make_ctx = make_ctx
        self.user_id = user_id
        self._convo_fn = convo_fn
        self._clear_fn = clear_fn
        self._refresh_fn = refresh_fn
        enabled = set(getattr(boot_result, "enabled_capabilities", set()) or set())

        for area in _AREAS:
            if _area_cards(boot_result, area):
                self._add(f"{_AREA_EMOJI[area]} {_ls.ko_label(area)}",
                          discord.ButtonStyle.primary, f"panel:area:{area}", self._area_cb(area))
        self._add("🔁 복습", discord.ButtonStyle.secondary, "panel:review", self._review)
        if "ai_convo" in enabled:
            self._add("🗣 대화", discord.ButtonStyle.success, "panel:convo", self._convo)
        if {"dashboard_live", "box_table", "mastery_chart"} & enabled:
            self._add("📊 대시보드", discord.ButtonStyle.secondary, "panel:dashboard", self._dashboard)
        self._add("🧹 정리", discord.ButtonStyle.secondary, "panel:clear", self._clear)
        self._add("❓ 도움말", discord.ButtonStyle.secondary, "panel:help", self._help)

    def _add(self, label, style, custom_id, cb) -> None:
        btn = discord.ui.Button(label=label, style=style, custom_id=custom_id)
        btn.callback = cb
        self.add_item(btn)

    async def _guard(self, interaction) -> bool:
        if not allowed_interaction(interaction, self.user_id):
            await interaction.response.send_message("권한 없음.", ephemeral=True)
            return False
        return True

    async def refresh(self, channel) -> None:
        if self._refresh_fn is not None:
            await self._refresh_fn(channel)

    def _area_cb(self, area: str):
        async def cb(interaction: discord.Interaction) -> None:
            if not await self._guard(interaction):
                return
            lvl = _ls.get_level(self.boot_result.mount, self.boot_result.deck.namespace, area)
            await interaction.response.send_message(
                f"{_AREA_EMOJI[area]} **{_ls.ko_label(area)}** (현재 Lv{lvl}) — 무엇을 할까요?",
                view=_AreaMenuView(self, area), ephemeral=True)
        return cb

    async def _review(self, interaction: discord.Interaction) -> None:
        if not await self._guard(interaction):
            return
        await interaction.response.send_message("🔁 복습을 시작합니다.", ephemeral=True)
        await self.runner(interaction, review=True)

    async def _convo(self, interaction: discord.Interaction) -> None:
        if not await self._guard(interaction):
            return
        if self._convo_fn is None:
            await interaction.response.send_message("대화 기능이 비활성화되어 있어요.", ephemeral=True)
            return
        await self._convo_fn(interaction)

    async def _clear(self, interaction: discord.Interaction) -> None:
        if not await self._guard(interaction):
            return
        if self._clear_fn is None:
            await interaction.response.send_message("정리 기능을 쓸 수 없어요.", ephemeral=True)
            return
        await self._clear_fn(interaction)

    async def _dashboard(self, interaction: discord.Interaction) -> None:
        if not await self._guard(interaction):
            return
        await interaction.response.send_message("대시보드 생성 중.", ephemeral=True)
        from dashboard import get_dashboard_data
        br = self.boot_result
        data = get_dashboard_data(br.deck, br.store, int(time.time() * 1000), br.pass_targets)
        enabled = set(br.enabled_capabilities)
        if "dashboard_live" in enabled:
            from render.dashboard_live import render as _r
            await _r(interaction.channel, data)
        if "box_table" in enabled:
            from render.box_table import render as _r
            await _r(interaction.channel, data)
        if "mastery_chart" in enabled:
            from render.mastery_chart import render as _r
            await _r(interaction.channel, data)

    async def _help(self, interaction: discord.Interaction) -> None:
        if not await self._guard(interaction):
            return
        await interaction.response.send_message(
            "📚/📖/💬 영역 선택 → 🧠 암기(보고 '알아요') / ✍️ AI 연습(영작 출제·채점) / 레벨 ±\n"
            "🗣 대화: 배운 표현으로 AI와 영어 대화(스레드)\n"
            "🔁 복습 · 📊 대시보드 · 🧹 정리(/clear) · /level <단어|문법|숙어> <1-10>\n"
            "학습 중 '중단' 입력으로 세션 종료.",
            ephemeral=True,
        )


def build_panel_view(runner, boot_result, make_ctx, user_id, **kw) -> ControlPanelView:
    return ControlPanelView(runner, boot_result, make_ctx, user_id, **kw)


async def post_panel(channel, runner, boot_result, make_ctx, user_id, **kw):
    view = build_panel_view(runner, boot_result, make_ctx, user_id, **kw)
    return await channel.send(content=status_text(boot_result), view=view)
