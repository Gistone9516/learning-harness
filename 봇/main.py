# -*- coding: utf-8 -*-
"""봇 진입점 (봇계약 §1, §2).

.env 4키 검증 -> 마운트 결정(argv > .env MOUNT > cwd) -> boot.load ->
Discord Client.run.
"""
from __future__ import annotations

import sys
import os
import logging

# 봇 루트 sys.path에 추가 (다른 모듈 import 전에)
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

# ── .env 필수 4키 검증 ──────────────────────────────────────────────────────

REQUIRED_KEYS = [
    "DISCORD_BOT_TOKEN",
    "DISCORD_GUILD_ID",
    "DISCORD_CHANNEL_ID",
    "DISCORD_ALLOWED_USER_ID",
]


def _load_env() -> dict[str, str]:
    missing = [k for k in REQUIRED_KEYS if not os.environ.get(k)]
    if missing:
        sys.exit(f"[봇] 필수 .env 키 누락: {', '.join(missing)}")
    return {k: os.environ[k] for k in REQUIRED_KEYS}


def _resolve_mount() -> str:
    """마운트 결정: argv[1] > .env MOUNT > cwd (봇계약 §2)."""
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
            async def _runner(interaction: discord.Interaction, *, deck=None, unit=None, dday_mode=False):
                channel = interaction.channel
                user_id = interaction.user.id
                br = self.boot_result

                sess = Session()
                self._sessions[user_id] = sess

                ctx = Ctx(
                    channel=channel,
                    user_id=user_id,
                    store=br.store,
                    deck=br.deck,
                    synonyms=br.synonyms,
                    grade_mode_of=lambda cid: br.grade_mode_map.get(cid, "exact"),
                    leitner_cfg=br.leitner_cfg,
                    ai_model=br.ai_model,
                    ai_effort=br.ai_effort,
                    sid=None,
                    session=sess,
                    emit=None,  # run_session에서 바인딩
                )

                opts = QueueOptions(
                    deck_namespace=br.deck.namespace,
                    dday_mode=dday_mode,
                )

                async def on_finish(ctx, session: Session):
                    stats = session.stats
                    rate = (stats.correct / stats.total_attempts * 100) if stats.total_attempts else 0
                    summary = (
                        f"<@{user_id}> 세션 종료!\n"
                        f"총 시도: {stats.total_attempts} | "
                        f"정답률: {rate:.0f}% | "
                        f"박스 승급: {stats.box_advances} | "
                        f"박스 강등: {stats.box_demotions}"
                    )
                    await channel.send(summary)

                await run_session(
                    ctx=ctx,
                    deck_cards=br.deck.cards,
                    store=br.store,
                    mount=br.mount,
                    opts=opts,
                    handler=dispatch,
                    on_finish=on_finish,
                )
                self._sessions.pop(user_id, None)
            return _runner

        _cmds.setup_commands(self.tree, discord.Object(id=self.guild_id), self.boot_result, _get_runner)

        # persistviews 재등록 (봇계약 §7)
        from handlers import recall_self as _rs
        # 핸들러 등록
        register_handler("recall_self", _rs.handle)
        from handlers import mcq_buttons as _mcq
        register_handler("mcq_buttons", _mcq.handle)
        from handlers import short_modal as _sm
        register_handler("short_modal", _sm.handle)
        from handlers import cloze_modal as _cm
        register_handler("cloze_modal", _cm.handle)

        await self.tree.sync(guild=guild)

    async def on_ready(self) -> None:
        log.info("봇 준비됨: %s (guild=%d, channel=%d)", self.user, self.guild_id, self.channel_id)

        # presence (layer 4, perm_preflight)
        await self.change_presence(
            activity=discord.CustomActivity(name="학습 대기 중")
        )

    async def on_message(self, message: discord.Message) -> None:
        # 봇 자신 무시
        if message.author.bot:
            return

        # 게이팅 (봇계약 §5)
        if not allowed_msg(message, self.allowed_user_id, self.channel_id):
            return

        # 매직워드 체크
        handled = await _cmds.check_stop_word(message, self._sessions)
        if handled:
            return


# ── 진입점 ────────────────────────────────────────────────────────────────────

def main() -> None:
    env = _load_env()
    mount = _resolve_mount()

    log.info("마운트: %s", mount)

    try:
        br = _boot.load(mount)
    except Exception as e:
        sys.exit(f"[봇] 부트 실패: {e}")

    log.info("덱 로드: %s (%d카드)", br.deck.namespace, len(br.deck.cards))

    channel_id = int(env["DISCORD_CHANNEL_ID"])
    allowed_user_id = int(env["DISCORD_ALLOWED_USER_ID"])

    bot = StudyBot(env, br, channel_id, allowed_user_id)
    bot.run(env["DISCORD_BOT_TOKEN"])


if __name__ == "__main__":
    main()
