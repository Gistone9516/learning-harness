# -*- coding: utf-8 -*-
"""Cycle 0 seam tests: sidecar accessor and the ai_caps helper layer.

All headless: sidecar uses a tempfile mount, ai_caps uses a monkeypatched _invoke (no subprocess, no
network, no live claude CLI).
"""
import asyncio
import os
import sys
import tempfile
import types

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import sidecar
import ai_caps
from ai import AIResult
from models import CardDef, AnswerSpec


# ── sidecar accessor ────────────────────────────────────────────────────────────

def test_sidecar_get_set_roundtrip():
    with tempfile.TemporaryDirectory() as mount:
        # absent key returns default
        assert sidecar.get(mount, "confidence_rate", "deck1", "card-a", None) is None
        # set then get
        sidecar.set(mount, "confidence_rate", "deck1", "card-a", "hard")
        assert sidecar.get(mount, "confidence_rate", "deck1", "card-a") == "hard"
        # second key coexists; load_all returns the whole dict
        sidecar.set(mount, "confidence_rate", "deck1", "card-b", "easy")
        alld = sidecar.load_all(mount, "confidence_rate", "deck1")
        assert alld == {"card-a": "hard", "card-b": "easy"}


def test_sidecar_isolated_per_capability_and_deck():
    with tempfile.TemporaryDirectory() as mount:
        sidecar.set(mount, "hint_progressive", "deck1", "card-a", 2)
        sidecar.set(mount, "read_resume", "deck1", "deck1", 5)
        # different capability files do not collide
        assert sidecar.get(mount, "hint_progressive", "deck1", "card-a") == 2
        assert sidecar.get(mount, "read_resume", "deck1", "deck1") == 5
        assert sidecar.load_all(mount, "hint_progressive", "deck2") == {}


# ── parse_verdict ────────────────────────────────────────────────────────────────

def test_parse_verdict_clean():
    v, r = ai_caps.parse_verdict('{"verdict":"correct","reason":"matches"}')
    assert v == "correct" and r == "matches"


def test_parse_verdict_fenced_and_stray_text():
    raw = 'Sure!\n```json\n{"verdict": "incorrect", "reason": "missing key term"}\n```\n'
    v, r = ai_caps.parse_verdict(raw)
    assert v == "incorrect" and "missing" in r


def test_parse_verdict_garbage_returns_none():
    assert ai_caps.parse_verdict("not json at all")[0] is None
    assert ai_caps.parse_verdict("")[0] is None
    assert ai_caps.parse_verdict('{"verdict":"maybe"}')[0] is None


# ── one_shot (mock invoke) ──────────────────────────────────────────────────────

def _ctx(**kw):
    base = dict(ai_model=None, ai_effort="low", ai_persona=None)
    base.update(kw)
    return types.SimpleNamespace(**base)


def test_one_shot_passes_no_session_and_token_cap(monkeypatch):
    captured = {}

    async def fake_invoke(prompt, *, system=None, model=None, effort="low",
                          max_tokens=None, session_id=None, on_stream=None):
        captured.update(prompt=prompt, system=system, model=model, effort=effort,
                        max_tokens=max_tokens, session_id=session_id)
        return AIResult(text="ok", ok=True, session_id=session_id or "minted")

    monkeypatch.setattr(ai_caps, "_invoke", fake_invoke)
    res = asyncio.run(ai_caps.one_shot(
        "do it", capability_id="ai_hint", ctx=_ctx(ai_persona="strict coach"), role="Give a hint."))
    assert res.ok
    assert captured["session_id"] is None          # one-shot: no session
    assert captured["effort"] == "low"          # effort from ctx.ai_effort (config-driven)
    assert captured["max_tokens"] is None        # output uncapped (CLI has no token-cap flag)
    assert "strict coach" in captured["system"] and "Give a hint." in captured["system"]


# ── ConvManager (session lifecycle + window) ────────────────────────────────────

def test_convmanager_mints_then_resumes_and_trims_window(monkeypatch):
    calls = []

    async def fake_invoke(prompt, *, system=None, model=None, effort="low",
                          max_tokens=None, session_id=None, on_stream=None):
        calls.append(dict(prompt=prompt, session_id=session_id))
        # first call has no session id; mint one. later calls echo the resumed id.
        return AIResult(text=f"reply{len(calls)}", ok=True, session_id=session_id or "sid-123")

    monkeypatch.setattr(ai_caps, "_invoke", fake_invoke)
    sess = types.SimpleNamespace(claude_sid=None, turns=[])
    cm = ai_caps.ConvManager(sess, window=4)

    asyncio.run(cm.turn("q1", ctx=_ctx(), role="Socratic tutor."))
    assert calls[0]["session_id"] is None           # first turn mints
    assert sess.claude_sid == "sid-123"             # captured for resume

    asyncio.run(cm.turn("q2", ctx=_ctx(), role="Socratic tutor."))
    assert calls[1]["session_id"] == "sid-123"      # second turn resumes
    assert "q1" in calls[1]["prompt"]               # window carries prior turn

    # drive past the window; oldest turns get trimmed
    for i in range(6):
        asyncio.run(cm.turn(f"more{i}", ctx=_ctx(), role="Socratic tutor."))
    assert len(sess.turns) <= 4 * 2                 # window * (user+assistant)


# ── grade_or_self_fallback (binary verdict + self fallback) ─────────────────────

def _card():
    return CardDef(
        card_id="c-1", schema_version=1, subject="s", unit="u", type="func", grade_mode="exact",
        front={"prompt": "q"}, back={}, answer_spec=AnswerSpec(normalize=["trim"], accepted=["yes"]),
        tags={}, links={},
    )


def _handlers_with_self():
    async def recall_self(ctx, card):
        from models import HandlerResult
        return HandlerResult(card_id=card.card_id, verdict="correct", done=True)
    return {"recall_self": recall_self}


def test_grade_ok_valid_json_maps_to_verdict(monkeypatch):
    async def fake_invoke(prompt, *, system=None, **kw):
        return AIResult(text='{"verdict":"incorrect","reason":"x"}', ok=True, session_id="s")
    monkeypatch.setattr(ai_caps, "_invoke", fake_invoke)
    res = asyncio.run(ai_caps.grade_or_self_fallback(_ctx(), _card(), "no", _handlers_with_self()))
    assert res.verdict == "incorrect" and res.requeue is True


def test_grade_parse_failure_falls_back_to_self(monkeypatch):
    async def fake_invoke(prompt, *, system=None, **kw):
        return AIResult(text="garbage no json", ok=True, session_id="s")
    monkeypatch.setattr(ai_caps, "_invoke", fake_invoke)
    res = asyncio.run(ai_caps.grade_or_self_fallback(_ctx(), _card(), "no", _handlers_with_self()))
    assert res.verdict == "correct"   # came from the self fallback handler


def test_grade_ai_error_falls_back_to_self(monkeypatch):
    async def fake_invoke(prompt, *, system=None, **kw):
        return AIResult(text="", ok=False, error="boom")
    monkeypatch.setattr(ai_caps, "_invoke", fake_invoke)
    res = asyncio.run(ai_caps.grade_or_self_fallback(_ctx(), _card(), "no", _handlers_with_self()))
    assert res.verdict == "correct"   # self fallback


def test_should_invoke_gate():
    assert ai_caps.should_invoke(enabled=True, condition=True)
    assert not ai_caps.should_invoke(enabled=False, condition=True)
    assert not ai_caps.should_invoke(enabled=True, condition=False)
