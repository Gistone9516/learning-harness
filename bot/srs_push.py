# -*- coding: utf-8 -*-
"""SRS due-card push (Cycle 7). Periodic scheduler that notifies the learner when cards come due.

Reuses the pure rising-edge dedup core in caps/srs_due_alert (already tested). This module is the
scheduler glue plus the Korean alert message builder. It requires a persistent bot process: the loop is
started from on_ready and runs until the bot stops.

Opt-in: only starts when "srs_due_alert" is in the deck's enabled_capabilities. When "ai_proactive_remind"
is also enabled, an AI encouragement message follows the plain due notice (token 0 when due == 0).
"""
from __future__ import annotations

import logging
import time

import _paths
_paths.setup()

import sidecar as _sidecar
from caps.srs_due_alert import cards_to_alert, record_alert, CAP_ID as _SRS_CAP

log = logging.getLogger(__name__)


def build_alert_text(due_count: int) -> str:
    """Pure Korean notice for a due-card alert."""
    return f"복습할 카드 {due_count}장이 준비됐어요. /study 또는 /review 로 시작하세요."


async def run_due_check(channel, user_id: int, br) -> int:
    """One tick: find newly-due cards, notify once (deduped), optionally add an AI nudge.

    Returns the number of cards that fired this tick (0 when nothing is due or all are deduped).
    Sends nothing and records nothing when there are no fresh due cards.
    """
    mount = br.mount
    deck_ns = br.deck.namespace
    now = int(time.time() * 1000)

    alert_state = _sidecar.load_all(mount, _SRS_CAP, deck_ns)
    due = cards_to_alert(br.store, now, alert_state)
    if not due:
        return 0

    from mention import ping
    await ping(channel, user_id, build_alert_text(len(due)))
    record_alert(mount, deck_ns, due, now)

    caps = getattr(br, "enabled_capabilities", set()) or set()
    if "ai_proactive_remind" in caps and channel is not None:
        try:
            from types import SimpleNamespace
            from caps_ai.ai_proactive_remind import proactive_remind
            ctx = SimpleNamespace(
                ai_model=br.ai_model, ai_effort=br.ai_effort,
                ai_persona=getattr(br, "ai_persona", None), enabled_capabilities=caps,
            )
            text = await proactive_remind(ctx, len(due))
            if text:
                await channel.send(text)
        except Exception as e:
            log.warning("ai_proactive_remind failed: %s", e)

    return len(due)


def start_srs_push(channel, user_id: int, br, interval_sec: float = 3600):
    """Start the periodic due-card push loop. Returns the scheduler task, or None when disabled.

    No-op (returns None) unless "srs_due_alert" is enabled for the deck.
    """
    caps = getattr(br, "enabled_capabilities", set()) or set()
    if "srs_due_alert" not in caps:
        return None
    from scheduler import every
    log.info("SRS push started (interval=%ss)", interval_sec)
    return every(interval_sec, lambda: run_due_check(channel, user_id, br))
