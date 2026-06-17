# -*- coding: utf-8 -*-
"""Bot entry point (bot-contract §1, §2).

Validates 4 required .env keys -> resolves mount (argv > .env MOUNT > cwd) -> boot.load ->
Discord Client.run.
"""
from __future__ import annotations

import sys
import os
import logging

# Add bot root to sys.path before importing other modules.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _paths
_paths.setup()

from dotenv import load_dotenv
load_dotenv()

import discord
from discord import app_commands

import boot as _boot
import commands as _cmds
from context import Ctx
from session import Session, run_session
from dispatch import dispatch, register as register_handler
from gating import allowed_msg, allowed_interaction
from models import QueueOptions, SCHEMA_VERSION

log = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

# ── Required .env key validation (4 keys) ──────────────────────────────────────

REQUIRED_KEYS = [
    "DISCORD_BOT_TOKEN",
    "DISCORD_GUILD_ID",
    "DISCORD_CHANNEL_ID",
    "DISCORD_ALLOWED_USER_ID",
]


def _load_env() -> dict[str, str]:
    missing = [k for k in REQUIRED_KEYS if not os.environ.get(k)]
    if missing:
        sys.exit(f"[bot] Missing required .env keys: {', '.join(missing)}")
    return {k: os.environ[k] for k in REQUIRED_KEYS}


def _resolve_mount() -> str:
    """Resolve mount path: argv[1] > .env MOUNT > cwd (bot-contract §2)."""
    if len(sys.argv) > 1:
        return sys.argv[1]
    env_mount = os.environ.get("MOUNT", "").strip()
    if env_mount:
        return env_mount
    return os.getcwd()


# ── Discord Client ────────────────────────────────────────────────────────────

class StudyBot(discord.Client):
    def __init__(self, env: dict, boot_result: "_boot.BootResult", channel_id: int, allowed_user_id: int) -> None:
        intents = discord.Intents.default()
        intents.message_content = True
        super().__init__(intents=intents)
        self.tree = app_commands.CommandTree(self)
        self.env = env
        self.boot_result = boot_result
        self.channel_id = channel_id
        self.allowed_user_id = allowed_user_id
        self.guild_id = int(env["DISCORD_GUILD_ID"])
        # user_id -> Session
        self._sessions: dict[int, Session] = {}

    async def setup_hook(self) -> None:
        guild = discord.Object(id=self.guild_id)

        def _get_runner():
            async def _runner(interaction: discord.Interaction, *, deck=None, unit=None,
                              area=None, level=None, mode="learn", dday_mode=False, review=False):
                channel = interaction.channel
                user_id = interaction.user.id
                br = self.boot_result

                # Guard against concurrent sessions for the same user (would orphan
                # the first Session and break stop-word handling).
                if user_id in self._sessions:
                    try:
                        await channel.send(
                            f"<@{user_id}> 이미 학습 세션이 진행 중입니다. 끝내거나 '중단'을 입력한 뒤 다시 시작하세요."
                        )
                    except Exception:
                        pass
                    return

                sess = Session()
                self._sessions[user_id] = sess

                ctx = Ctx(
                    channel=channel,
                    user_id=user_id,
                    store=br.store,
                    deck=br.deck,
                    mount=br.mount,
                    deck_namespace=br.deck.namespace,
                    synonyms=br.synonyms,
                    grade_mode_of=lambda cid: br.grade_mode_map.get(cid, "exact"),
                    leitner_cfg=br.leitner_cfg,
                    ai_model=br.ai_model,
                    ai_effort=br.ai_effort,
                    sid=None,
                    session=sess,
                    emit=None,  # bound inside run_session
                    ai_persona=br.ai_persona,
                    enabled_capabilities=br.enabled_capabilities,
                    ai_model_explain=br.ai_model_explain,
                )

                # adaptive_weight (layer 2, token 0): recompute weight overrides when enabled
                weight_overrides = None
                if "adaptive_weight" in br.enabled_capabilities:
                    try:
                        from caps.adaptive_weight import recompute_weights, save_weight_overrides
                        weight_overrides = recompute_weights(br.store, br.deck)
                        save_weight_overrides(br.mount, br.deck.namespace, weight_overrides)
                    except Exception as e:
                        log.warning("adaptive_weight recompute failed: %s", e)

                opts = QueueOptions(
                    deck_namespace=br.deck.namespace,
                    dday_mode=dday_mode,
                    weight_overrides=weight_overrides,
                )

                ns = br.deck.namespace
                deck_cards = br.deck.cards
                handler = dispatch  # default: route self/quiz cards by type
                learn_area = None   # set when in 암기 mode -> end-of-session shows 초기화/종료
                learn_level = None

                async def _stop(msg: str):
                    await channel.send(f"<@{user_id}> {msg}")
                    self._sessions.pop(user_id, None)

                if deck and deck != ns:
                    await channel.send(
                        f"<@{user_id}> 현재 단일 덱 '{ns}'만 로드되어 deck='{deck}'는 무시됩니다."
                    )

                if area:
                    # Catalog model: bound to the area's current level (difficulty continuity).
                    import study_select as _sel
                    import level_state as _ls
                    lvl = int(level) if level is not None else _ls.get_level(br.mount, ns, area)
                    if mode == "practice":
                        from caps_ai.ai_practice import handle as _ai_practice
                        base = _sel.cards_in_area_upto(deck_cards, area, lvl)
                        deck_cards = [c for c in base if _ls.is_learned(br.mount, ns, c.card_id)]
                        handler = _ai_practice
                        if not deck_cards:
                            await _stop("아직 '알아요'로 배운 항목이 없어요. 먼저 🧠 암기로 익혀 주세요.")
                            return
                    else:  # learn: not-yet-learned self flashcards at this level
                        learn_area, learn_level = area, lvl
                        deck_cards = [c for c in _sel.cards_in_area_level(deck_cards, area, lvl)
                                      if not _ls.is_learned(br.mount, ns, c.card_id)]

                        async def handler(ctx, card):  # noqa: F811 (learn wrapper)
                            res = await dispatch(ctx, card)
                            if res.verdict == "correct":
                                _ls.set_learned(br.mount, ns, card.card_id, True)
                            # learn mode: 몰라요(incorrect)는 다음으로 넘어가고 이번 세션에 다시 안 띄움
                            res.requeue = False
                            return res

                        if not deck_cards:
                            await channel.send(
                                f"<@{user_id}> {_ls.ko_label(area)} 레벨 {lvl} 항목을 모두 외웠어요. "
                                "⬆️ 레벨을 올리거나 🔄 초기화하세요.")
                            try:
                                from control_panel import post_learn_end
                                await post_learn_end(channel, br, user_id, area, lvl, self._refresh_panel)
                            except Exception as e:
                                log.warning("learn end view failed: %s", e)
                            self._sessions.pop(user_id, None)
                            return
                elif unit:
                    from study_select import filter_cards_by_unit
                    deck_cards = filter_cards_by_unit(deck_cards, unit)
                    if not deck_cards:
                        await _stop(f"'{unit}' 단원에 해당하는 카드가 없습니다.")
                        return

                if review:
                    import time as _t
                    from review_select import select_review_cards
                    deck_cards = select_review_cards(br.store, deck_cards, int(_t.time() * 1000))
                    if not deck_cards:
                        await _stop("복습할 카드가 없습니다.")
                        return

                async def on_finish(ctx, session: Session):
                    # 암기 한 바퀴 끝: 초기화/종료 버튼만 보여 준다.
                    if learn_area:
                        try:
                            from control_panel import post_learn_end
                            await post_learn_end(channel, br, user_id, learn_area, learn_level, self._refresh_panel)
                        except Exception as e:
                            log.warning("learn end view failed: %s", e)
                        return
                    stats = session.stats
                    rate = (stats.correct / stats.total_attempts * 100) if stats.total_attempts else 0
                    body = (
                        f"총 시도: {stats.total_attempts}\n"
                        f"정답률: {rate:.0f}%\n"
                        f"박스 승급: {stats.box_advances}\n"
                        f"박스 강등: {stats.box_demotions}"
                    )
                    # Components V2 card for the content (SoT §7.13); mention is a separate plain ping.
                    from cards import titled_card
                    await channel.send(view=titled_card("세션 종료", body, 0x57F287))
                    await channel.send(
                        f"<@{user_id}> 학습 세션이 끝났어요.",
                        allowed_mentions=discord.AllowedMentions(users=True),
                    )
                    if "ai_session_summary" in br.enabled_capabilities:
                        try:
                            from caps_ai.ai_session_summary import session_summary
                            journal = await session_summary(ctx, stats)
                            if journal:
                                await channel.send(journal)
                        except Exception as e:
                            log.warning("ai_session_summary failed: %s", e)
                    # Re-post the control panel so the user can pick the next action.
                    if "control_panel" in br.enabled_capabilities:
                        await self._refresh_panel(channel)

                await run_session(
                    ctx=ctx,
                    deck_cards=deck_cards,
                    store=br.store,
                    mount=br.mount,
                    opts=opts,
                    handler=handler,
                    on_finish=on_finish,
                )
                self._sessions.pop(user_id, None)
            return _runner

        _cmds.setup_commands(self.tree, discord.Object(id=self.guild_id), self.boot_result, _get_runner, self._make_command_ctx, self.allowed_user_id)

        # Register dispatch handlers for enabled capabilities only (+ recall_self fallback).
        from wiring import register_enabled_handlers
        register_enabled_handlers(self.boot_result.enabled_capabilities)

        await self.tree.sync(guild=guild)

        # Control panel: keep a runner for panel-driven sessions; register the persistent
        # view so its buttons keep working after a restart (bot-contract §7).
        self._panel_runner = _get_runner()
        if "control_panel" in self.boot_result.enabled_capabilities:
            from control_panel import build_panel_view
            self.add_view(build_panel_view(
                self._panel_runner, self.boot_result, self._make_command_ctx, self.allowed_user_id,
                convo_fn=self._run_convo, clear_fn=self._clear_chat, refresh_fn=self._refresh_panel))

    async def on_ready(self) -> None:
        log.info("Bot ready: %s (guild=%d, channel=%d)", self.user, self.guild_id, self.channel_id)

        # presence (layer 4, perm_preflight)
        await self.change_presence(
            activity=discord.CustomActivity(name="학습 대기 중")
        )

        # SRS due-card push (Cycle 7): start the periodic loop when the deck enables it
        channel = self.get_channel(self.channel_id)
        if channel is not None:
            try:
                from srs_push import start_srs_push
                start_srs_push(channel, self.allowed_user_id, self.boot_result)
            except Exception as e:
                log.warning("SRS push start failed: %s", e)

            # Control panel: post on bot online.
            if "control_panel" in self.boot_result.enabled_capabilities:
                await self._refresh_panel(channel)

    async def on_message(self, message: discord.Message) -> None:
        # Ignore messages from the bot itself.
        if message.author.bot:
            return

        # Gating (bot-contract §5).
        if not allowed_msg(message, self.allowed_user_id, self.channel_id):
            return

        # Check for stop word.
        handled = await _cmds.check_stop_word(message, self._sessions)
        if handled:
            return

    def _make_command_ctx(self, channel, user_id: int):
        """Build a Ctx for slash commands that need engine/AI context outside a study session."""
        br = self.boot_result
        sess = self._sessions.get(user_id) or Session()
        return Ctx(
            channel=channel, user_id=user_id, store=br.store, deck=br.deck, mount=br.mount,
            deck_namespace=br.deck.namespace, synonyms=br.synonyms,
            grade_mode_of=lambda cid: br.grade_mode_map.get(cid, "exact"),
            leitner_cfg=br.leitner_cfg, ai_model=br.ai_model, ai_effort=br.ai_effort,
            sid=None, session=sess, emit=None, ai_persona=br.ai_persona,
            enabled_capabilities=br.enabled_capabilities,
            ai_model_explain=br.ai_model_explain,
        )

    async def _refresh_panel(self, channel) -> None:
        """Delete the previously posted control panel (if any) and post a fresh one."""
        old = getattr(self, "_panel_message", None)
        if old is not None:
            try:
                await old.delete()
            except Exception:
                pass
        try:
            from control_panel import post_panel
            self._panel_message = await post_panel(
                channel, self._panel_runner, self.boot_result,
                self._make_command_ctx, self.allowed_user_id,
                convo_fn=self._run_convo, clear_fn=self._clear_chat, refresh_fn=self._refresh_panel)
        except Exception as e:
            log.warning("control panel post failed: %s", e)

    async def _run_convo(self, interaction) -> None:
        """Start a threaded AI conversation seeded by the learner's learned items."""
        user_id = interaction.user.id
        if user_id in self._sessions:
            try:
                await interaction.response.send_message(
                    "이미 학습/대화 세션이 진행 중이에요. '중단' 후 다시 시도하세요.", ephemeral=True)
            except Exception:
                pass
            return
        try:
            await interaction.response.send_message("🗣 대화 스레드를 시작할게요.", ephemeral=True)
        except Exception:
            pass
        # Register a session sentinel so the concurrent-session guard + stop word apply.
        sess = Session()
        self._sessions[user_id] = sess
        br = self.boot_result
        ns = br.deck.namespace
        import level_state as _ls
        from caps_ai.ai_convo import run_convo
        learned = _ls.learned_ids(br.mount, ns)
        items = []
        for c in br.deck.cards:
            if c.card_id in learned:
                fr = c.front or {}
                items.append(fr.get("prompt") or fr.get("text") or c.card_id)
        ctx = self._make_command_ctx(interaction.channel, user_id)
        try:
            await run_convo(ctx, self, items)
        except Exception as e:
            log.warning("ai_convo failed: %s", e)
        finally:
            self._sessions.pop(user_id, None)

    async def _clear_chat(self, interaction, n: int = 100) -> None:
        """Purge recent channel messages (best-effort), then re-post one panel."""
        channel = interaction.channel
        try:
            await interaction.response.send_message(f"🧹 최근 메시지 {n}개를 정리할게요.", ephemeral=True)
        except Exception:
            pass
        self._panel_message = None  # the old panel will be purged
        deleted = 0
        try:
            purged = await channel.purge(limit=int(n))
            deleted = len(purged)
        except discord.Forbidden:
            await channel.send("정리하려면 봇에 '메시지 관리' 권한이 필요해요.")
            await self._refresh_panel(channel)
            return
        except Exception as e:
            log.warning("clear purge failed: %s", e)
        await channel.send(f"🧹 {deleted}개 정리했어요. (14일 지난 메시지는 일괄삭제가 안 돼요.)")
        await self._refresh_panel(channel)


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    env = _load_env()
    mount = _resolve_mount()

    log.info("Mount: %s", mount)

    try:
        br = _boot.load(mount)
    except Exception as e:
        sys.exit(f"[bot] Boot failed: {e}")

    log.info("Deck loaded: %s (%d cards)", br.deck.namespace, len(br.deck.cards))

    channel_id = int(env["DISCORD_CHANNEL_ID"])
    allowed_user_id = int(env["DISCORD_ALLOWED_USER_ID"])

    bot = StudyBot(env, br, channel_id, allowed_user_id)
    bot.run(env["DISCORD_BOT_TOKEN"])


if __name__ == "__main__":
    main()
