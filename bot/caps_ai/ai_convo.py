# -*- coding: utf-8 -*-
"""ai_convo capability (layer 3) — continuous conversation practice in a thread.

Seeded by the learner's "learned" item list. The AI asks a Korean question nudging the
learner to use one item, the learner replies, the AI corrects/encourages in plain Korean and
moves to the next item. Multi-turn via ConvManager; the learner replies in the thread; "중단"
ends it. Subject framing (role, thread title, seed hint) comes from the injected
SubjectProfile (task_of); identity comes from the persona. Runs on the main AI model.
"""
from __future__ import annotations

import asyncio
import logging
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import ai_caps
from threads import thread_in_channel, delete_thread         # harness/channels on sys.path
from caps_ai.ai_socratic import _wait_for_reply               # client-based wait_for
from subject import task_of
from text_format import format_tables

log = logging.getLogger(__name__)

_CAP_ID = "ai_convo"
_REPLY_TIMEOUT = None
_SEED_ITEMS = 12   # max learned items injected into the seed; keeps the prompt bounded as the learned set grows
# Words that end the conversation (and delete the thread). Includes the user-requested 삭제/닫기/종료.
_STOP = {"중단", "취소", "정지", "그만", "종료", "끝", "삭제", "닫기",
         "stop", "cancel", "quit", "exit", "end", "close", "delete"}


def _is_stop_word(text: str) -> bool:
    """True if the learner's reply is a stop/close word (tolerant of trailing punctuation/space)."""
    t = (text or "").strip().lower().strip(".!?~。… ")
    return t in _STOP


async def _send(target, text: str) -> None:
    if target is None:
        return
    try:
        await target.send(format_tables(text))
    except Exception as e:
        log.warning("ai_convo: send failed: %s", e)


async def run_convo(ctx, client, learned_items: list[str], max_turns: int = 100000) -> None:
    """Run a threaded multi-turn conversation seeded by the learned items."""
    enabled = _CAP_ID in getattr(ctx, "enabled_capabilities", set())
    if not ai_caps.should_invoke(enabled=enabled):
        return
    channel = ctx.channel
    if channel is None:
        return

    role = task_of(ctx, "convo", "role")
    try:
        thread = await thread_in_channel(channel, task_of(ctx, "convo", "thread_title"))
    except Exception as e:
        log.warning("ai_convo: thread create failed (%s); using the channel", e)
        thread = channel

    # Inject only a small sample of the learned items so the seed stays bounded no matter how many
    # items the learner has accumulated (context-limit guard); note the remainder by count.
    pool = [s for s in (learned_items or []) if s]
    if len(pool) > _SEED_ITEMS:
        # Random sample only; do NOT leak a hidden count ("+N more") — that would invite the model
        # to infer/confabulate unlisted items (deepflow hallucination lens). The shown set is "the set".
        items_str = ", ".join(random.sample(pool, _SEED_ITEMS))
    elif pool:
        items_str = ", ".join(pool)
    else:
        items_str = task_of(ctx, "convo", "seed_hint")
    cm = ai_caps.ConvManager(ctx.session, window=4, capability_id=_CAP_ID)

    # Stop signal: allow "중단" (in the main channel) to interrupt a pending reply wait.
    stop_event = getattr(ctx.session, "stop_event", None)
    if stop_event is None:
        try:
            stop_event = asyncio.Event()
            ctx.session.stop_event = stop_event
        except Exception:
            stop_event = None

    seed = (
        f"Items available for this session: {items_str}.\n"
        "Ask one short question that nudges the learner to use one of these items. "
        "Keep to simple language and do not assume the learner knows other words."
    )
    res = await cm.turn(seed, ctx=ctx, role=role)
    if not res.ok:
        await _send(thread, "AI 연결 문제로 대화를 시작하지 못했어요. 잠시 후 다시 시도해 주세요.")
        return
    await _send(thread, res.text)
    await _send(thread, "💬 답을 적어보세요. 끝내려면 '종료'(또는 그만/중단/삭제)를 입력하면 돼요.")

    ended = False
    for _ in range(max_turns):
        if stop_event is not None and stop_event.is_set():
            ended = True
            break
        reply_task = asyncio.ensure_future(_wait_for_reply(client, thread, ctx.user_id, _REPLY_TIMEOUT))
        if stop_event is not None:
            stop_task = asyncio.ensure_future(stop_event.wait())
            await asyncio.wait({reply_task, stop_task}, return_when=asyncio.FIRST_COMPLETED)
            if stop_event.is_set():
                reply_task.cancel()
                try:
                    await reply_task
                except BaseException:
                    pass
                stop_task.cancel()
                ended = True
                break
            stop_task.cancel()
            reply = reply_task.result()
        else:
            reply = await reply_task
        if reply is None:
            break
        if _is_stop_word(reply):
            await _send(thread, "대화를 마칠게요. 이 스레드는 정리됩니다. 👏")
            ended = True
            break
        res = await cm.turn(reply, ctx=ctx, role=role)
        if not res.ok:
            await _send(thread, "(일시적 문제로 잠시 멈출게요.)")
            ended = True
            break
        await _send(thread, res.text)
    if not ended:
        await _send(thread, "오늘은 여기까지 할게요. 잘했어요! 👏")

    try:
        if thread is not channel:
            await delete_thread(thread)   # delete on end (삭제/닫기/종료); archive fallback inside delete_thread
    except Exception:
        pass
