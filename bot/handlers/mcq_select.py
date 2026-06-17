# -*- coding: utf-8 -*-
"""mcq_select handler (learning-types layer2, capability_id=mcq_select).

Flow: present judge card front (scenario + options) -> select dropdown (>5 options) -> immediate verdict + explanation.
Use this handler instead of mcq_buttons when the option list exceeds 5 items (buttons cap at 5; select supports up to 25).
discord import OK.
"""
from __future__ import annotations

import logging
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import discord
from models import CardDef, HandlerResult, ScoreInput
from scoring import score
from selects import pick_string

log = logging.getLogger(__name__)

_COLOR_MAIN = 0x5865F2
_COLOR_DONE = 0x57F287
_COLOR_DANGER = 0xED4245

CAPABILITY_ID = "mcq_select"


# Pure core (no discord, fully testable) ----------------------------------------

def evaluate_choice(
    card: CardDef,
    chosen: str | None,
    grade_mode: str,
    synonyms: dict[str, str] | None,
) -> HandlerResult:
    """Score a single MCQ selection and return a HandlerResult.

    Parameters
    ----------
    card:
        The card being answered.
    chosen:
        The option string the learner selected, or None on timeout.
    grade_mode:
        Effective scoring mode resolved by the bot (e.g. "exact").
    synonyms:
        Reverse-index synonym map compiled at bot boot, or None.

    Returns
    -------
    HandlerResult
        verdict is "skip" on timeout/no-spec, "correct"/"incorrect" otherwise.
    """
    if chosen is None:
        return HandlerResult(card_id=card.card_id, verdict="skip", done=True)

    spec = card.answer_spec
    if spec is None or grade_mode == "self":
        return HandlerResult(card_id=card.card_id, verdict="skip", done=True)

    try:
        result = score(ScoreInput(
            mode=grade_mode,
            user_answer=chosen,
            answer_spec=spec,
            synonyms=synonyms if synonyms else None,
        ))
    except Exception as exc:
        log.warning("scoring error (card=%s): %s", card.card_id, exc)
        return HandlerResult(card_id=card.card_id, verdict="incorrect", requeue=True, done=True)

    verdict = result.verdict
    is_incorrect = verdict == "incorrect"
    return HandlerResult(
        card_id=card.card_id,
        verdict=verdict,
        requeue=is_incorrect,
        done=True,
    )


def build_feedback_text(card: CardDef, chosen: str, result) -> str:
    """Compose the feedback string shown after scoring.

    Parameters
    ----------
    card:
        The card that was just answered.
    chosen:
        The option the learner picked.
    result:
        ScoreResult returned by score().

    Returns
    -------
    str
        Human-readable Korean feedback string.
    """
    if result.matched:
        fb = f"정답! **{result.matched[0]}**"
    else:
        spec = card.answer_spec
        acc = (spec.accepted or []) if spec else []
        correct_ans = acc[0] if acc else "?"
        fb = f"오답. 정답: **{correct_ans}**"

    back = card.back or {}
    detail = back.get("detail", "")
    if detail:
        fb += f"\n{detail}"
    return fb


# Discord shell ------------------------------------------------------------------

async def handle(ctx, card: CardDef) -> HandlerResult:
    """mcq_select handler. Presents options as a select dropdown and scores the result."""
    channel = ctx.channel
    user_id = ctx.user_id
    synonyms = ctx.synonyms
    grade_mode_of = ctx.grade_mode_of

    front = card.front or {}
    scenario = front.get("scenario") or front.get("prompt", "")
    options: list[str] = front.get("options", [])
    if not isinstance(options, list):
        options = []

    # pick_string supports up to 25 options (discord limit for select menus)
    options = options[:25]

    question_text = f"Q. {scenario}"
    chosen = await pick_string(
        channel,
        user_id,
        question_text,
        options,
        single=True,
        timeout=None,
    )

    effective_mode = grade_mode_of(card.card_id)
    result_hr = evaluate_choice(card, chosen, effective_mode, synonyms)

    # If no valid answer was obtained, return early without feedback
    if result_hr.verdict == "skip" or chosen is None:
        return result_hr

    # Re-score to get the full ScoreResult for feedback text (evaluate_choice already validated spec)
    spec = card.answer_spec
    if spec is None or effective_mode == "self":
        return result_hr

    try:
        score_result = score(ScoreInput(
            mode=effective_mode,
            user_answer=chosen,
            answer_spec=spec,
            synonyms=synonyms if synonyms else None,
        ))
    except Exception:
        return result_hr

    fb_text = build_feedback_text(card, chosen, score_result)
    color = _COLOR_DONE if result_hr.verdict == "correct" else _COLOR_DANGER

    fb_view = discord.ui.LayoutView(timeout=None)
    fb_view.add_item(discord.ui.Container(
        discord.ui.TextDisplay(fb_text),
        accent_colour=color,
    ))
    await channel.send(view=fb_view)

    return result_hr
