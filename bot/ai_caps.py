# -*- coding: utf-8 -*-
"""AI capability helper layer (ai-mode spec). Sits between the 12 ai_* capabilities and raw ai.invoke.

Centralizes the cross-cutting AI concerns so the individual capabilities stay thin:
- token control: the should_invoke gate, the CAP_LIMITS table, and persona/preamble building
- session + sliding window: ConvManager, which only ai_socratic needs (one study session = one claude session)
- binary verdict parsing plus self fallback: parse_verdict and grade_or_self_fallback (ai_openend_grade)
- streaming transport: stream_to_livecard (ai_stream_render)

Testability: the invoke function is reached through the module level _invoke so headless tests can
monkeypatch ai_caps._invoke with a fake. No subprocess or network is needed in tests.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Awaitable, Callable

import _paths
_paths.setup()

import ai as _ai
from models import HandlerResult

log = logging.getLogger(__name__)

# Default invoke seam. Tests monkeypatch ai_caps._invoke to a fake returning a canned AIResult.
_invoke = _ai.invoke

# Per-capability token limits: capability_id maps to (effort, max_tokens). From the ai-mode token table.
CAP_LIMITS: dict[str, tuple[str, int]] = {
    "ai_openend_grade":     ("low", 150),
    "ai_socratic":          ("low", 200),
    "ai_hint":              ("low", 80),
    "ai_personal_feedback": ("low", 250),
    "ai_generate_items":    ("low", 400),
    "ai_variant_q":         ("low", 300),
    "ai_misconception":     ("medium", 300),
    "ai_adaptive_weight":   ("low", 200),
    "ai_session_summary":   ("low", 300),
    "ai_proactive_remind":  ("low", 120),
    "ai_practice":          ("low", 250),
    "ai_convo":             ("low", 350),
}


def should_invoke(*, enabled: bool, condition: bool = True) -> bool:
    """Token-zero gate. Only call AI when the capability is enabled and its trigger condition holds.

    Examples of condition: due_count > 0 for ai_proactive_remind, a wrong verdict for personal feedback.
    """
    return bool(enabled and condition)


def build_preamble(role: str, data: str = "", *, persona: str | None = None, force_json: bool = False) -> str:
    """Build a short system preamble: optional persona clause, then role, then a data slice, then an
    optional JSON directive. Keep it short. The caller passes only the data slice the call needs, never
    the full deck or full history.
    """
    parts: list[str] = []
    if persona:
        parts.append(f"Persona: {persona}.")
    parts.append(role.strip())
    if data:
        parts.append(data.strip())
    if force_json:
        parts.append(
            'Respond ONLY with JSON of the form {"verdict":"correct"|"incorrect","reason":"<short>"}. '
            "Do not output anything else."
        )
    return "\n".join(parts)


async def one_shot(
    prompt: str,
    *,
    capability_id: str,
    ctx: Any,
    role: str,
    data: str = "",
    force_json: bool = False,
    on_stream: Callable[[str], Awaitable[None]] | None = None,
) -> "_ai.AIResult":
    """Single AI call with no session. Used by eleven of the twelve capabilities.

    Pulls model and persona from ctx, effort and max_tokens from CAP_LIMITS. Never raises; the underlying
    invoke returns an AIResult with ok=False on failure so the caller can degrade gracefully.
    """
    effort, max_tokens = CAP_LIMITS.get(capability_id, (getattr(ctx, "ai_effort", "low"), 200))
    system = build_preamble(role, data, persona=getattr(ctx, "ai_persona", None), force_json=force_json)
    return await _invoke(
        prompt,
        system=system,
        model=getattr(ctx, "ai_model", None),
        effort=effort,
        max_tokens=max_tokens,
        session_id=None,
        on_stream=on_stream,
    )


class ConvManager:
    """Multi-turn conversation manager. Only ai_socratic needs it.

    Wraps the volatile Session.claude_sid and Session.turns. Rebuilds the windowed context on each turn so
    the prompt is deterministic for tests, regardless of what the claude session retains server side.
    """

    def __init__(self, session: Any, *, window: int = 4, capability_id: str = "ai_socratic") -> None:
        self._session = session
        self._window = window
        self._capability_id = capability_id

    def _windowed_prompt(self, user_text: str) -> str:
        # Keep the last `window` exchanges (a user turn plus an assistant turn each).
        turns = list(getattr(self._session, "turns", []))[-(self._window * 2):]
        lines = [f"{role}: {text}" for role, text in turns]
        lines.append(f"user: {user_text}")
        return "\n".join(lines)

    async def turn(
        self,
        user_text: str,
        *,
        ctx: Any,
        role: str,
        on_stream: Callable[[str], Awaitable[None]] | None = None,
    ) -> "_ai.AIResult":
        effort, max_tokens = CAP_LIMITS.get(self._capability_id, ("low", 200))
        system = build_preamble(role, persona=getattr(ctx, "ai_persona", None))
        prompt = self._windowed_prompt(user_text)
        self._session.turns.append(("user", user_text))
        result = await _invoke(
            prompt,
            system=system,
            model=getattr(ctx, "ai_model", None),
            effort=effort,
            max_tokens=max_tokens,
            session_id=self._session.claude_sid,
            on_stream=on_stream,
        )
        if result.ok:
            # Capture the newly minted session id on the first turn so later turns resume it.
            if self._session.claude_sid is None and result.session_id:
                self._session.claude_sid = result.session_id
            self._session.turns.append(("assistant", result.text))
            maxlen = self._window * 2
            if len(self._session.turns) > maxlen:
                del self._session.turns[:-maxlen]
        else:
            # Roll back the user turn so the window never holds an orphan user entry.
            if self._session.turns and self._session.turns[-1][0] == "user":
                self._session.turns.pop()
        return result


def parse_verdict(text: str) -> tuple[str | None, str]:
    """Parse a forced-JSON grade response of the form {"verdict","reason"}.

    Tolerates fenced code blocks and stray prose by extracting the first balanced-looking object. Returns
    (verdict, reason) where verdict is "correct" or "incorrect", or None when parsing fails.
    """
    if not text:
        return None, ""
    s = text.strip()
    start = s.find("{")
    end = s.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None, ""
    try:
        obj = json.loads(s[start:end + 1])
    except (json.JSONDecodeError, ValueError):
        return None, ""
    if not isinstance(obj, dict):
        return None, ""
    verdict = obj.get("verdict")
    reason = obj.get("reason", "") or ""
    if verdict in ("correct", "incorrect"):
        return verdict, reason
    return None, reason


def _answer_key(card: Any) -> str:
    """A short answer-key string for the grader preamble. Never the full card."""
    spec = getattr(card, "answer_spec", None)
    if spec is None:
        return "(no answer key; judge by meaning)"
    accepted = getattr(spec, "accepted", None)
    if accepted:
        return " / ".join(accepted)
    return "(see rubric)"


async def grade_or_self_fallback(ctx: Any, card: Any, user_answer: str, handlers: dict) -> HandlerResult:
    """ai_openend_grade flow.

    Force a JSON binary verdict, map it to a HandlerResult for Leitner. On parse failure or AI error, fall
    back to the self handler so the card is still scorable and the bot stays up. The AI emits only the
    binary token, never a score, preserving the binary-grading invariant (SoT 7.5).

    `handlers` is the dispatch HANDLERS registry, passed in so we fall back to recall_self without importing
    it (mirrors the dispatch fallback idiom).
    """
    role = "You are a strict grader. Decide whether the learner answer is correct."
    data = f"Correct answer or criteria: {_answer_key(card)}\nLearner answer: {user_answer}"
    result = await one_shot(
        "Grade the learner answer now.",
        capability_id="ai_openend_grade",
        ctx=ctx,
        role=role,
        data=data,
        force_json=True,
    )
    if result.ok:
        verdict, _reason = parse_verdict(result.text)
        if verdict is not None:
            return HandlerResult(
                card_id=card.card_id,
                verdict=verdict,
                requeue=(verdict == "incorrect"),
                done=True,
            )
    log.info("ai_openend_grade fallback to self (card=%s, ok=%s)", card.card_id, result.ok)
    fallback = handlers.get("recall_self")
    if fallback is not None:
        return await fallback(ctx, card)
    return HandlerResult(card_id=card.card_id, verdict="skip", done=True)


def stream_to_livecard(channel: Any):
    """Return (on_stream, finalize) that wire an AI token stream into a coalesced LiveCard.

    This is the ai_stream_render transport, reused by whichever capability streams. The LiveCard import is
    lazy because it is discord dependent; call this only from a live bot, not in headless tests.
    """
    from livecard import LiveCard  # harness/live is on sys.path via _paths

    card = LiveCard(channel, title="AI", color=0x5865F2)
    state = {"buf": "", "started": False}

    async def on_stream(chunk: str) -> None:
        if not state["started"]:
            await card.start()
            state["started"] = True
        state["buf"] += chunk
        card.set_text(state["buf"])

    async def finalize() -> None:
        if state["started"]:
            await card.finalize()

    return on_stream, finalize
