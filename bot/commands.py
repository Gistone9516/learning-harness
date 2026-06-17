# -*- coding: utf-8 -*-
"""Slash commands + magic words (bot-contract §6).

Slash: /study (option --dday), /review, /due, /stats, /card, /concept, /settings, /help.
Magic words: 중단/stop.
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
import capability_registry as _reg
import level_state as _ls


class _LevelCmdConfirm(discord.ui.View):
    """Confirm dialog for /level: shows a difficulty example, applies on 예."""

    def __init__(self, boot_result, allowed_user_id: int, area: str, new_level: int) -> None:
        super().__init__(timeout=None)
        self._br = boot_result
        self._uid = allowed_user_id
        self._area = area
        self._new = new_level

    @discord.ui.button(label="예, 바꿀게요", style=discord.ButtonStyle.success)
    async def yes(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        if not allowed_interaction(interaction, self._uid):
            await interaction.response.send_message("권한 없음.", ephemeral=True)
            return
        area_cards = [
            (c.card_id, (c.tags or {}).get("level"))
            for c in self._br.deck.cards
            if (c.tags or {}).get("area") == self._area and isinstance((c.tags or {}).get("level"), int)
        ]
        res = _ls.apply_level_change(self._br.mount, self._br.deck.namespace, area_cards, self._area, self._new)
        label = self._br.subject.ko_label(self._area) if getattr(self._br, "subject", None) else self._area
        await interaction.response.send_message(
            f"{label} 레벨 {res['old']} → {res['new']} (배움 {res['changed']}개 자동 갱신). /ui 로 패널을 새로 띄워요.",
            ephemeral=True,
        )
        self.stop()

    @discord.ui.button(label="아니요", style=discord.ButtonStyle.secondary)
    async def no(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        await interaction.response.send_message("취소했어요.", ephemeral=True)
        self.stop()

if TYPE_CHECKING:
    pass

log = logging.getLogger(__name__)

# Magic word set (parity with discord-bridge stop words)
STOP_WORDS = {"중단", "취소", "정지", "stop", "cancel"}


def _gate(tree, name, description, guild, active):
    """Return the tree.command decorator when `active`, else a no-op decorator.

    Lets a slash command be registered only when its owning capability is enabled,
    so a partial-clone project never exposes (or imports for) a command it lacks.
    """
    if active:
        return tree.command(name=name, description=description, guild=guild)

    def _noop(fn):
        return fn

    return _noop


def setup_commands(
    tree: app_commands.CommandTree,
    guild: discord.Object,
    boot_result,
    get_session_runner,
    make_ctx=None,
    allowed_user_id: int = 0,
) -> None:
    """Register slash commands into the CommandTree.

    boot_result: BootResult (returned by boot.load).
    get_session_runner: () -> run_session coroutine factory.
    """

    # Capability-gated command registration: only register commands owned by an
    # enabled capability. Core commands (study/review/due/stats/card/concept/
    # settings/help) are always registered.
    enabled = set(boot_result.enabled_capabilities)
    avail_cmds = _reg.commands_for(enabled)

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
        if not allowed_interaction(interaction, allowed_user_id):
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
        if not allowed_interaction(interaction, allowed_user_id):
            await interaction.response.send_message("권한 없음.", ephemeral=True)
            return
        await interaction.response.send_message("오답 복습 시작.", ephemeral=True)
        runner = get_session_runner()
        if runner:
            await runner(interaction, review=True)

    @tree.command(name="due", description="due 카드 수 확인", guild=guild)
    async def due_cmd(interaction: discord.Interaction) -> None:
        if not allowed_interaction(interaction, allowed_user_id):
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
        if not allowed_interaction(interaction, allowed_user_id):
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
        if not allowed_interaction(interaction, allowed_user_id):
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
        if not allowed_interaction(interaction, allowed_user_id):
            await interaction.response.send_message("권한 없음.", ephemeral=True)
            return
        await interaction.response.send_message(
            f"개념 조회: {ref} (콘텐츠 링크 기능은 콘텐츠 데이터에 따라 다름.)",
            ephemeral=True,
        )

    @tree.command(name="settings", description="봇 설정 조회", guild=guild)
    async def settings_cmd(interaction: discord.Interaction) -> None:
        if not allowed_interaction(interaction, allowed_user_id):
            await interaction.response.send_message("권한 없음.", ephemeral=True)
            return
        caps = ", ".join(sorted(boot_result.enabled_capabilities))
        await interaction.response.send_message(
            f"활성 능력: {caps}", ephemeral=True
        )

    @_gate(tree, "dashboard", "학습 대시보드", guild, "dashboard" in avail_cmds)
    async def dashboard_cmd(interaction: discord.Interaction) -> None:
        if not allowed_interaction(interaction, allowed_user_id):
            await interaction.response.send_message("권한 없음.", ephemeral=True)
            return
        await interaction.response.send_message("대시보드 생성 중.", ephemeral=True)
        import time
        from dashboard import get_dashboard_data
        data = get_dashboard_data(
            boot_result.deck, boot_result.store, int(time.time() * 1000), boot_result.pass_targets
        )
        # Render only the enabled renderers (a partial clone may lack some).
        if "dashboard_live" in enabled:
            from render.dashboard_live import render as render_dashboard
            await render_dashboard(interaction.channel, data)
        if "box_table" in enabled:
            from render.box_table import render as render_box
            await render_box(interaction.channel, data)
        if "mastery_chart" in enabled:
            from render.mastery_chart import render as render_chart
            await render_chart(interaction.channel, data)

    @_gate(tree, "digest", "주간 다이제스트", guild, "digest" in avail_cmds)
    async def digest_cmd(interaction: discord.Interaction) -> None:
        if not allowed_interaction(interaction, allowed_user_id):
            await interaction.response.send_message("권한 없음.", ephemeral=True)
            return
        await interaction.response.send_message("다이제스트 생성 중.", ephemeral=True)
        import time
        from dashboard import get_dashboard_data
        data = get_dashboard_data(
            boot_result.deck, boot_result.store, int(time.time() * 1000), boot_result.pass_targets
        )
        from render.digest_weekly import render as render_digest
        await render_digest(interaction.channel, data)

    @_gate(tree, "socratic", "소크라테스식 대화", guild, "socratic" in avail_cmds)
    @app_commands.describe(card_id="대상 card_id")
    async def socratic_cmd(interaction: discord.Interaction, card_id: str) -> None:
        if not allowed_interaction(interaction, allowed_user_id) or make_ctx is None:
            await interaction.response.send_message("권한 없음.", ephemeral=True)
            return
        card = next((c for c in boot_result.deck.cards if c.card_id == card_id), None)
        if card is None:
            await interaction.response.send_message(f"카드 없음: {card_id}", ephemeral=True)
            return
        await interaction.response.send_message("소크라테스 대화 시작.", ephemeral=True)
        ctx = make_ctx(interaction.channel, interaction.user.id)
        from caps_ai.ai_socratic import run_socratic
        front = card.front or {}
        opening = front.get("prompt") or front.get("text") or front.get("scenario", "")
        await run_socratic(ctx, card, opening, client=interaction.client)

    @_gate(tree, "misconception", "오개념 진단", guild, "misconception" in avail_cmds)
    async def misconception_cmd(interaction: discord.Interaction) -> None:
        if not allowed_interaction(interaction, allowed_user_id) or make_ctx is None:
            await interaction.response.send_message("권한 없음.", ephemeral=True)
            return
        await interaction.response.send_message("오개념 진단 중.", ephemeral=True)
        ctx = make_ctx(interaction.channel, interaction.user.id)
        from caps_ai.ai_misconception import top_error_cards, diagnose
        ids = set(top_error_cards(boot_result.store, boot_result.deck, 5))
        cards = [c for c in boot_result.deck.cards if c.card_id in ids]
        text = await diagnose(ctx, cards)
        await interaction.channel.send(text or "진단할 오답 데이터가 부족합니다.")

    @_gate(tree, "strategy", "학습 전략 제안", guild, "strategy" in avail_cmds)
    async def strategy_cmd(interaction: discord.Interaction) -> None:
        if not allowed_interaction(interaction, allowed_user_id) or make_ctx is None:
            await interaction.response.send_message("권한 없음.", ephemeral=True)
            return
        await interaction.response.send_message("전략 생성 중.", ephemeral=True)
        import time
        from dashboard import get_dashboard_data
        data = get_dashboard_data(
            boot_result.deck, boot_result.store, int(time.time() * 1000), boot_result.pass_targets
        )
        weakness = "; ".join(
            f"{w.area}/{w.subarea} 오답률 {w.wrong_rate:.0%}" for w in data.weakness[:5]
        )
        ctx = make_ctx(interaction.channel, interaction.user.id)
        from caps_ai.ai_adaptive_weight_suggest import suggest_strategy
        text = await suggest_strategy(ctx, weakness)
        await interaction.channel.send(text or "전략 제안을 생성할 수 없습니다.")

    @_gate(tree, "generate", "카드 초안 생성", guild, "generate" in avail_cmds)
    @app_commands.describe(seeds="쉼표로 구분한 시드 목록")
    async def generate_cmd(interaction: discord.Interaction, seeds: str) -> None:
        if not allowed_interaction(interaction, allowed_user_id) or make_ctx is None:
            await interaction.response.send_message("권한 없음.", ephemeral=True)
            return
        seed_list = [s.strip() for s in seeds.split(",") if s.strip()]
        await interaction.response.send_message(f"{len(seed_list)}개 시드로 생성 중.", ephemeral=True)
        ctx = make_ctx(interaction.channel, interaction.user.id)
        from caps_ai.ai_generate_items import generate_cards
        drafts = await generate_cards(ctx, seed_list)
        if not drafts:
            await interaction.channel.send("생성된 카드 초안이 없습니다.")
            return
        lines = "\n".join(f"- {str(d.get('front', ''))[:80]}" for d in drafts)
        await interaction.channel.send("생성된 초안:\n" + lines)

    @_gate(tree, "variant", "변형 문제 생성", guild, "variant" in avail_cmds)
    @app_commands.describe(card_id="대상 card_id (box3 권장)")
    async def variant_cmd(interaction: discord.Interaction, card_id: str) -> None:
        if not allowed_interaction(interaction, allowed_user_id) or make_ctx is None:
            await interaction.response.send_message("권한 없음.", ephemeral=True)
            return
        card = next((c for c in boot_result.deck.cards if c.card_id == card_id), None)
        if card is None:
            await interaction.response.send_message(f"카드 없음: {card_id}", ephemeral=True)
            return
        await interaction.response.send_message("변형 생성 중.", ephemeral=True)
        ctx = make_ctx(interaction.channel, interaction.user.id)
        from caps_ai.ai_variant_q import make_variant
        v = await make_variant(ctx, card)
        await interaction.channel.send(
            ("변형 문제: " + str(v.get("front"))) if v else "변형을 생성할 수 없습니다."
        )

    # /level: choices come from the injected area taxonomy (subject-agnostic). Registered
    # only when the subject actually has catalog areas.
    _subj = getattr(boot_result, "subject", None)
    _area_choices = [app_commands.Choice(name=a.label, value=a.key) for a in (_subj.areas if _subj else ())]
    if _area_choices:
        @tree.command(name="level", description="영역별 레벨 설정 (1-10)", guild=guild)
        @app_commands.describe(area="영역", level="레벨 1-10")
        @app_commands.choices(area=_area_choices)
        async def level_cmd(interaction: discord.Interaction, area: app_commands.Choice[str], level: int) -> None:
            if not allowed_interaction(interaction, allowed_user_id):
                await interaction.response.send_message("권한 없음.", ephemeral=True)
                return
            a = area.value
            new = _ls.clamp_level(level)
            cur = _ls.get_level(boot_result.mount, boot_result.deck.namespace, a)
            samples = [c for c in boot_result.deck.cards
                       if (c.tags or {}).get("area") == a and (c.tags or {}).get("level") == new][:2]
            if samples:
                ex = "\n".join(
                    f"• {(c.front or {}).get('prompt') or (c.front or {}).get('text') or c.card_id}"
                    f" — {(c.back or {}).get('detail', '')}" for c in samples)
            else:
                ex = "(이 레벨 예시 항목이 아직 없어요.)"
            await interaction.response.send_message(
                f"**{_subj.ko_label(a)} 레벨 {cur} → {new}**\n이 레벨은 이정도 난이도예요:\n{ex}\n\n정말 바꾸시겠어요?",
                view=_LevelCmdConfirm(boot_result, allowed_user_id, a, new),
                ephemeral=True,
            )

    @tree.command(name="clear", description="채널 메시지 정리", guild=guild)
    @app_commands.describe(n="삭제할 최근 메시지 수 (기본 100)")
    async def clear_cmd(interaction: discord.Interaction, n: int = 100) -> None:
        if not allowed_interaction(interaction, allowed_user_id):
            await interaction.response.send_message("권한 없음.", ephemeral=True)
            return
        await interaction.response.send_message(f"🧹 최근 메시지 {n}개를 정리할게요.", ephemeral=True)
        try:
            purged = await interaction.channel.purge(limit=int(n))
            await interaction.channel.send(
                f"🧹 {len(purged)}개 정리했어요. (14일 지난 메시지는 일괄삭제가 안 돼요.) /ui 로 패널을 다시 띄워요.")
        except discord.Forbidden:
            try:
                await interaction.followup.send(
                    "정리하려면 봇에 '메시지 관리(Manage Messages)' 권한이 필요해요.", ephemeral=True)
            except Exception:
                pass
        except Exception as e:
            log.warning("clear purge failed: %s", e)

    @_gate(tree, "ui", "학습 제어판", guild, "ui" in avail_cmds)
    async def ui_cmd(interaction: discord.Interaction) -> None:
        if not allowed_interaction(interaction, allowed_user_id):
            await interaction.response.send_message("권한 없음.", ephemeral=True)
            return
        await interaction.response.send_message("학습 제어판을 띄웁니다.", ephemeral=True)
        from control_panel import post_panel
        await post_panel(interaction.channel, get_session_runner(), boot_result, make_ctx, interaction.user.id)

    @tree.command(name="help", description="도움말", guild=guild)
    async def help_cmd(interaction: discord.Interaction) -> None:
        lines = [
            "/study [deck] [unit] [dday] - 학습 시작",
            "/review - 오답 복습",
            "/due - due 카드 수",
            "/stats - 통계",
            "/card <id> - 카드 조회",
            "/concept <ref> - 개념 조회",
            "/settings - 설정 조회",
            "/level <영역> <1-10> - 영역별 레벨 설정",
            "/clear [n] - 채널 메시지 정리",
        ]
        _opt = [
            ("ui", "/ui - 학습 제어판"),
            ("dashboard", "/dashboard - 학습 대시보드"),
            ("digest", "/digest - 주간 다이제스트"),
            ("socratic", "/socratic <id> - 소크라테스 대화(AI)"),
            ("misconception", "/misconception - 오개념 진단(AI)"),
            ("strategy", "/strategy - 학습 전략 제안(AI)"),
            ("generate", "/generate <seeds> - 카드 초안 생성(AI)"),
            ("variant", "/variant <id> - 변형 문제 생성(AI)"),
        ]
        for cmd, text in _opt:
            if cmd in avail_cmds:
                lines.append(text)
        lines.append("중단 / stop - 세션 중단")
        await interaction.response.send_message("\n".join(lines), ephemeral=True)


async def check_stop_word(message: discord.Message, session_store: dict) -> bool:
    """Detect magic word (중단/stop). If an active session exists, stop it. Returns whether the message was handled."""
    content = (message.content or "").strip().lower()
    if content not in STOP_WORDS:
        return False

    user_id = message.author.id
    sess = session_store.get(user_id)
    if sess is not None:
        sess.active = False
        ev = getattr(sess, "stop_event", None)
        if ev is not None:
            ev.set()
        await message.channel.send(
            f"<@{user_id}> 세션을 중단했습니다."
        )
    else:
        await message.channel.send(
            f"<@{user_id}> 진행 중인 세션이 없습니다."
        )
    return True
