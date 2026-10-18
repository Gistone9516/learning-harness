# -*- coding: utf-8 -*-
"""A caller that hangs up cancels its call (web-contract §2, session lifetime: `_unless_dropped`).

asyncio does not cancel a connection handler when its peer leaves, so the server watches the socket while
a call runs. Measured 2026-10-18: before the watch, a caller that hung up after 6 s left its claude child
running. Both branches are exercised: a caller that leaves, and one that stays for the answer.
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

CRLF = chr(13) + chr(10)


def _raw(body: bytes) -> bytes:
    head = ["POST /ai HTTP/1.1", "Host: x", "Content-Type: application/json", "X-AI-Token: secret",
            f"Content-Length: {len(body)}"]
    return (CRLF.join(head) + CRLF + CRLF).encode("ascii") + body


def _patch(monkeypatch, delay: float):
    seen = {"started": asyncio.Event(), "cancelled": False, "finished": False}

    async def slow_invoke(prompt, **kwargs):
        seen["started"].set()
        try:
            await asyncio.sleep(delay)
        except asyncio.CancelledError:
            seen["cancelled"] = True
            raise
        seen["finished"] = True
        return AIResult(text="done", ok=True, session_id="sid")

    monkeypatch.setattr(ai, "invoke", slow_invoke)
    return seen


async def _serve():
    server = await asyncio.start_server(ai_server._make_handler("secret", "*"), "127.0.0.1", 0)
    return server, server.sockets[0].getsockname()[1]


def test_caller_that_leaves_cancels_the_call(monkeypatch):
    async def run():
        seen = _patch(monkeypatch, 30)
        server, port = await _serve()
        try:
            rd, wr = await asyncio.open_connection("127.0.0.1", port)
            wr.write(_raw(b'{"prompt":"long"}'))
            await wr.drain()
            await asyncio.wait_for(seen["started"].wait(), 5)
            wr.close()
            for _ in range(50):
                if seen["cancelled"]:
                    break
                await asyncio.sleep(0.05)
        finally:
            server.close()
            await server.wait_closed()
        return seen

    seen = asyncio.run(run())
    assert seen["cancelled"] and not seen["finished"]


def test_caller_that_stays_gets_the_answer(monkeypatch):
    async def run():
        seen = _patch(monkeypatch, 0.3)
        server, port = await _serve()
        try:
            rd, wr = await asyncio.open_connection("127.0.0.1", port)
            wr.write(_raw(b'{"prompt":"short"}'))
            await wr.drain()
            resp = await asyncio.wait_for(rd.read(), 5)
            wr.close()
        finally:
            server.close()
            await server.wait_closed()
        return seen, resp

    seen, resp = asyncio.run(run())
    body = resp.split((CRLF + CRLF).encode("ascii"), 1)[1]
    assert seen["finished"] and not seen["cancelled"]
    assert json.loads(body)["text"] == "done"
