# -*- coding: utf-8 -*-
"""Headless tests for bot/ai_server.py: token gating, health, and the /ai round trip.

No live claude: ai.invoke is monkeypatched. The server is bound to an ephemeral localhost port and
driven over a real socket, so the HTTP parsing and routing are exercised end to end.
"""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import ai
import ai_server
from ai import AIResult


async def _request(port, method, path, headers=None, body=b""):
    rd, wr = await asyncio.open_connection("127.0.0.1", port)
    lines = [f"{method} {path} HTTP/1.1", "Host: x", f"Content-Length: {len(body)}", "Connection: close"]
    for k, v in (headers or {}).items():
        lines.append(f"{k}: {v}")
    wr.write(("\r\n".join(lines) + "\r\n\r\n").encode("utf-8") + body)
    await wr.drain()
    resp = await rd.read()
    wr.close()
    head, _, rest = resp.partition(b"\r\n\r\n")
    status = head.split(b"\r\n")[0].decode("latin-1")
    return status, rest


async def _run_cases():
    server = await asyncio.start_server(ai_server._make_handler("secret", "*"), "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    try:
        health = await _request(port, "GET", "/health")
        unauth = await _request(port, "POST", "/ai",
                                {"Content-Type": "application/json"}, b'{"prompt":"hi"}')
        ok = await _request(port, "POST", "/ai",
                            {"Content-Type": "application/json", "X-AI-Token": "secret"},
                            b'{"prompt":"hi"}')
        empty = await _request(port, "POST", "/ai",
                               {"Content-Type": "application/json", "X-AI-Token": "secret"},
                               b'{"prompt":"  "}')
    finally:
        server.close()
        await server.wait_closed()
    return health, unauth, ok, empty


def test_gating_health_and_roundtrip(monkeypatch):
    async def fake_invoke(prompt, *, system=None, model=None, effort="low", session_id=None, on_stream=None):
        return AIResult(text="MOCK:" + prompt, ok=True, session_id=session_id or "sid-x")

    monkeypatch.setattr(ai, "invoke", fake_invoke)
    health, unauth, ok, empty = asyncio.run(_run_cases())

    assert health[0].startswith("HTTP/1.1 200") and b'"ok":true' in health[1]   # health, no token
    assert unauth[0].startswith("HTTP/1.1 401")                                  # no token -> rejected
    assert ok[0].startswith("HTTP/1.1 200")
    data = json.loads(ok[1])
    assert data["ok"] is True and data["text"] == "MOCK:hi" and data["session_id"] == "sid-x"
    assert empty[0].startswith("HTTP/1.1 400")                                   # empty prompt rejected


def test_check_auth():
    assert ai_server.check_auth({"authorization": "Bearer secret"}, "secret")
    assert ai_server.check_auth({"x-ai-token": "secret"}, "secret")
    assert not ai_server.check_auth({"authorization": "Bearer wrong"}, "secret")
    assert not ai_server.check_auth({}, "secret")
    assert not ai_server.check_auth({"x-ai-token": "secret"}, "")   # no server token -> never authed
