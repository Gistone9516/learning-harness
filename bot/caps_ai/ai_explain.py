# -*- coding: utf-8 -*-
"""ai_explain capability (layer 3) — per-card concept explanation in a ONE-OFF thread.

Opened from the answer-reveal '🤖 AI 해설' button. Explains the card's concept in plain
Korean and answers follow-ups for a few turns, then discards (deletes) the thread.
Uses the cheaper explain model (ctx.ai_model_explain, e.g. haiku). Runs on a throwaway
conversation session so it never pollutes the learner's study session.
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

log = logging.getLogger(__name__)

_CAP_ID = "ai_explain"
_REPLY_TIMEOUT = 300.0
_MAX_TURNS = 6
_STOP = {"중단", "취소", "정지", "그만", "끝", "stop", "cancel", "quit"}

_ROLE = (
    "너는 친절한 영어 개념 튜터다. 한국어로, 비전공자도 이해하기 쉽게 짧고 명확하게 설명한다. "
    "쉬운 예문과 자주 하는 실수를 곁들이되 장황하지 않게. 학습자가 더 물으면 이어서 답한다."
)


async def _send(target, text: str) -> None:
    if target is None:
        return
    try:
        await target.send(text)
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
    role = _ROLE + f"\n\n지금 설명 중인 학습 항목: {head}"
    if detail:
        role += f"\n참고 설명: {detail}"

    try:
        thread = await thread_in_channel(channel, "🤖 개념 해설")
    except Exception as e:
        log.warning("ai_explain: thread create failed (%s); using channel", e)
        thread = channel

    # Throwaway conversation session, isolated from the learner's study session.
    sess = SimpleNamespace(turns=[], claude_sid=None)
    cm = ai_caps.ConvManager(sess, window=4, capability_id=_CAP_ID, model=model)

    seed = (
        f"학습 항목: {head}\n현재 간단 설명: {detail}\n"
        "이 개념을 한국어로 더 쉽고 풍부하게(쉬운 예문과 자주 하는 실수 포함) 설명하고, "
        "더 궁금한 점이 있으면 물어보라고 권해."
    )
    res = await cm.turn(seed, ctx=ctx, role=role)
    if not res.ok or not (res.text or "").strip():
        await _send(thread, "AI 해설을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.")
        if thread is not channel:
            await delete_thread(thread)
        return
    await _send(thread, res.text)

    for _ in range(_MAX_TURNS):
        reply = await _wait_for_reply(client, thread, ctx.user_id, _REPLY_TIMEOUT)
        if reply is None:
            break
        if reply.strip().lower() in _STOP:
            break
        res = await cm.turn(reply, ctx=ctx, role=role)
        if not res.ok or not (res.text or "").strip():
            await _send(thread, "(일시적 문제로 멈출게요.)")
            break
        await _send(thread, res.text)

    await _send(thread, "해설을 마칠게요. 이 스레드는 정리됩니다. 👋")
    if thread is not channel:
        await delete_thread(thread)
