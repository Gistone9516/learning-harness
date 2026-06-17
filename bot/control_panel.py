# -*- coding: utf-8 -*-
"""Study control panel (capability_id=control_panel) — catalog learning hub.

Persistent button panel: per-area (areas injected via config) status with level + learned progress.
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


def _areas(boot_result):
    """Area keys from the injected SubjectProfile (subject-agnostic)."""
    subj = getattr(boot_result, "subject", None)
    return subj.area_keys() if subj is not None else []


def _emoji(boot_result, area: str) -> str:
    subj = getattr(boot_result, "subject", None)
    return subj.icon_of(area) if subj is not None else ""


def _ko(boot_result, area: str) -> str:
    subj = getattr(boot_result, "subject", None)
    return subj.ko_label(area) if subj is not None else area


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
    for area in _areas(br):
        cards = _area_cards(br, area)
        total = len(cards)
        if total == 0:
            continue
        learned = sum(1 for c in cards if _ls.is_learned(br.mount, br.deck.namespace, c.card_id))
        lvl = _ls.get_level(br.mount, br.deck.namespace, area)
        lines.append(f"{_emoji(br, area)} {_ko(br, area)}  Lv{lvl}  {_bar(learned, total)} {learned}/{total} 배움")
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
            f"{_ko(br, self._area)} 레벨을 {res['old']} → {res['new']}로 바꿨어요. (배움 {res['changed']}개 자동 갱신)",
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
            f"**{_ko(br, self._area)} 레벨 {cur} → {new}**\n"
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

        for area in _areas(boot_result):
            if _area_cards(boot_result, area):
                self._add(f"{_emoji(boot_result, area)} {_ko(boot_result, area)}".strip(),
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
                f"{_emoji(self.boot_result, area)} **{_ko(self.boot_result, area)}** (현재 Lv{lvl}) — 무엇을 할까요?",
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
        br = self.boot_result
        areas_hint = " / ".join(f"{_emoji(br, a)}{_ko(br, a)}".strip() for a in _areas(br)) or "영역"
        level_hint = "|".join(_ko(br, a) for a in _areas(br)) or "영역"
        await interaction.response.send_message(
            f"{areas_hint} 선택 → 🧠 암기(보고 '알아요') / ✍️ AI 연습(출제·채점) / 레벨 ±\n"
            "🗣 대화: 배운 항목으로 AI와 대화(스레드)\n"
            f"🔁 복습 · 📊 대시보드 · 🧹 정리(/clear) · /level <{level_hint}> <1-10>\n"
            "학습 중 '중단' 입력으로 세션 종료.",
            ephemeral=True,
        )


class LearnEndView(discord.ui.View):
    """Shown after a 암기 round: 초기화(이 레벨 '알아요' 전체 해제) / 종료."""

    def __init__(self, boot_result, user_id, area, level, refresh_fn) -> None:
        super().__init__(timeout=1800)
        self._br = boot_result
        self._uid = user_id
        self._area = area
        self._level = level
        self._refresh = refresh_fn

    async def _guard(self, interaction) -> bool:
        if not allowed_interaction(interaction, self._uid):
            await interaction.response.send_message("권한 없음.", ephemeral=True)
            return False
        return True

    @discord.ui.button(label="🔄 초기화", style=discord.ButtonStyle.success)
    async def reset(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        if not await self._guard(interaction):
            return
        ids = [c.card_id for c in _area_cards(self._br, self._area)
               if (c.tags or {}).get("level") == self._level]
        n = _ls.set_learned_many(self._br.mount, self._br.deck.namespace, ids, False)
        await interaction.response.send_message(
            f"🔄 초기화: {_ko(self._br, self._area)} 레벨 {self._level}의 '알아요' {n}개를 해제했어요. "
            "다시 🧠 암기하면 처음부터 나와요.", ephemeral=True)
        if self._refresh:
            await self._refresh(interaction.channel)
        self.stop()

    @discord.ui.button(label="✅ 종료", style=discord.ButtonStyle.secondary)
    async def end(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        if not await self._guard(interaction):
            return
        await interaction.response.send_message("✅ 학습을 마쳤어요. 수고했어요!", ephemeral=True)
        if self._refresh:
            await self._refresh(interaction.channel)
        self.stop()


async def post_learn_end(channel, boot_result, user_id, area, level, refresh_fn):
    content = (
        f"🧠 **{_ko(boot_result, area)} 레벨 {level} 암기 한 바퀴 끝!**\n"
        "'몰라요' 한 항목은 다시 🧠 암기하면 또 나와요.\n"
        "🔄 초기화: 이 레벨 '알아요' 전체 해제 · ✅ 종료: 마치기"
    )
    return await channel.send(content=content, view=LearnEndView(boot_result, user_id, area, level, refresh_fn))


def build_panel_view(runner, boot_result, make_ctx, user_id, **kw) -> ControlPanelView:
    return ControlPanelView(runner, boot_result, make_ctx, user_id, **kw)


async def post_panel(channel, runner, boot_result, make_ctx, user_id, **kw):
    view = build_panel_view(runner, boot_result, make_ctx, user_id, **kw)
    return await channel.send(content=status_text(boot_result), view=view)
