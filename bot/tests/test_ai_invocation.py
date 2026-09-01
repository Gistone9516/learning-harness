# -*- coding: utf-8 -*-
"""How ai.invoke drives the claude CLI: no tools, and the preamble actually reaches the model.

Both rules come from measured failures (2026-07-21):
  * with the default toolset, a "generate a project" prompt made the agent WRITE FILES into the
    server's working directory and answer with a prose report, so the caller's structured output
    never arrived and the instance folder got polluted;
  * a `system` key in the stdin payload is ignored by the CLI, so every preamble the kit thought
    it was sending (safety clause included) was silently dropped.

The subprocess is faked, so these assert the invocation contract without running claude.
"""
import asyncio
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import ai  # noqa: E402


class FakeProc:
    returncode = 0

    def __init__(self):
        self.stdin_data = None

    async def communicate(self, input=None):
        self.stdin_data = input
        result = json.dumps({"type": "result", "result": "OK"}).encode("utf-8")
        return result, b""

    def kill(self):
        pass

    async def wait(self):
        return 0


@pytest.fixture()
def spawned(monkeypatch):
    """Capture the command line and the stdin payload of one invoke()."""
    captured = {}
    proc = FakeProc()

    async def fake_spawn(cmd_str, **kwargs):
        captured["cmd"] = cmd_str
        captured["kwargs"] = kwargs
        return proc

    monkeypatch.setattr(ai.asyncio, "create_subprocess_shell", fake_spawn)
    captured["proc"] = proc
    return captured


def run(**kwargs):
    return asyncio.run(ai.invoke("PROMPT", **kwargs))


def test_tools_are_disabled_by_default(spawned):
    result = run()
    assert result.ok
    # `--tools ""` leaves the model with no way to touch the filesystem.
    assert "--tools" in spawned["cmd"]
    assert '--tools ""' in spawned["cmd"] or "--tools ''" in spawned["cmd"]


def test_tools_can_be_re_enabled_explicitly(spawned):
    run(tools=None)
    assert "--tools" not in spawned["cmd"]


def test_system_preamble_is_delivered_in_the_message(spawned):
    run(system="SAFETY PREAMBLE")
    payload = json.loads(spawned["proc"].stdin_data.decode("utf-8"))

    content = payload["message"]["content"]
    assert "SAFETY PREAMBLE" in content
    assert "PROMPT" in content
    assert content.index("SAFETY PREAMBLE") < content.index("PROMPT")
    # The CLI ignores this key, so nothing may rely on it any more.
    assert "system" not in payload


def test_prompt_is_unchanged_without_a_preamble(spawned):
    run()
    payload = json.loads(spawned["proc"].stdin_data.decode("utf-8"))
    assert payload["message"]["content"] == "PROMPT"


def test_resume_uses_the_session_id(spawned):
    run(session_id="sid-42")
    assert "--resume sid-42" in spawned["cmd"]
    assert "--session-id" not in spawned["cmd"]


def test_new_session_mints_an_id(spawned):
    result = run()
    assert "--session-id" in spawned["cmd"]
    assert result.session_id
