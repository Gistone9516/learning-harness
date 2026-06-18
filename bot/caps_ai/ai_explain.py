# -*- coding: utf-8 -*-
"""ai_explain capability (layer 3) — per-card concept explanation in a ONE-OFF thread.

Opened from the answer-reveal '🤖 AI 해설' button. Explains the card's concept in plain
Korean and answers follow-ups for a few turns, then discards (deletes) the thread.
Uses ctx.ai_model_explain (configurable via .env AI_MODEL_EXPLAIN; set to the main model
when concept quality matters). Runs on a throwaway conversation session so it never
pollutes the learner's study session.
"""
from __future__ import annotations

import logging
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import ai_caps
from threads import thread_in_channel, delete_thread          # harness/channels on sys.path
from caps_ai.ai_socratic import _wait_for_reply
from subject import task_of
from text_format import format_tables

log = logging.getLogger(__name__)

_CAP_ID = "ai_explain"
_REPLY_TIMEOUT = None
_MAX_TURNS = 100000
_STOP = {"중단", "취소", "정지", "그만", "끝", "종료", "삭제", "닫기", "그만할래", "그만하기",
         "stop", "cancel", "quit", "exit", "end", "close", "delete"}


def _is_stop_word(text: str) -> bool:
    """True if the learner's reply is a stop word (tolerant of trailing punctuation/space)."""
    t = (text or "").strip().lower().strip(".!?~。… ")
    return t in _STOP


async def _send(target, text: str) -> None:
    if target is None:
        return
    try:
        await target.send(format_tables(text))
    except Exception as e:
        log.warning("ai_explain: send failed: %s", e)


async def run_explain(ctx, client, card) -> None:
    """Open a one-off thread, explain the card concept (multi-turn), then delete the thread."""
    enabled = _CAP_ID in getattr(ctx, "enabled_capabilities", set())
    if not ai_caps.should_invoke(enabled=enabled):
        return
    channel = ctx.channel
    if channel is None:
        return

    model = getattr(ctx, "ai_model_explain", None) or getattr(ctx, "ai_model", None)
    front = card.front or {}
    head = front.get("prompt") or front.get("text") or card.card_id
    detail = (card.back or {}).get("detail", "")

    # 카드 정체성을 system preamble(role)에 박아 매 턴 다시 들어가게 한다.
    # 윈도(=4)를 넘는 다회차에서 seed 메시지가 잘려도 무엇을 설명 중인지 잃지 않도록.
    # 과목 정체성(영역·과목)은 persona가 운반하므로 role 기본값은 subject-neutral. 지시문은 영문(토큰 절감).
    role = task_of(ctx, "explain", "role") + f"\n\nItem being explained: {head}"
    if detail:
        role += f"\nReference note: {detail}"

    try:
        thread = await thread_in_channel(channel, "🤖 개념 해설")
    except Exception as e:
        log.warning("ai_explain: thread create failed (%s); using channel", e)
        thread = channel

    # Throwaway conversation session, isolated from the learner's study session.
    sess = SimpleNamespace(turns=[], claude_sid=None)
    cm = ai_caps.ConvManager(sess, window=4, capability_id=_CAP_ID, model=model)

    # head/detail already ride in the role (system) every turn; don't duplicate them here.
    seed = (
        "Explain this item more simply and richly (include an easy example and a common mistake), "
        "and invite the learner to ask follow-up questions."
    )
    res = await cm.turn(seed, ctx=ctx, role=role)
    if not res.ok or not (res.text or "").strip():
        await _send(thread, "AI 해설을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.")
        if thread is not channel:
            await delete_thread(thread)
        return
    await _send(thread, res.text)
    await _send(thread, "💬 이어서 궁금한 걸 물어보세요. 끝내려면 '종료'(또는 그만/중단/삭제)를 입력하면 돼요.")

    for _ in range(_MAX_TURNS):
        reply = await _wait_for_reply(client, thread, ctx.user_id, _REPLY_TIMEOUT)
        if reply is None:
            break              # timeout or no reply mechanism
        if _is_stop_word(reply):
            break              # learner asked to stop
        res = await cm.turn(reply, ctx=ctx, role=role)
        if not res.ok or not (res.text or "").strip():
            await _send(thread, "(일시적 문제로 멈출게요.)")
            break
        await _send(thread, res.text)

    await _send(thread, "해설을 마칠게요. 이 스레드는 정리됩니다. 👋")
    if thread is not channel:
        await delete_thread(thread)
