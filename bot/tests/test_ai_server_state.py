# -*- coding: utf-8 -*-
"""Headless tests for the /state endpoints and /sessions on bot/ai_server.py.

Same style as test_ai_server.py: a real socket against an ephemeral port, no live claude. Covers
the wire contract (routing, auth, status codes), the unconfigured-root case, and the guarantee
that a bad name is rejected at the boundary rather than reaching the filesystem.
"""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import ai_server
from state_store import StateStore

TOKEN = "secret"
AUTH = {"Content-Type": "application/json", "X-AI-Token": TOKEN}


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


async def _serve(store, cases):
    server = await asyncio.start_server(ai_server._make_handler(TOKEN, "*", store), "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    try:
        return await cases(port)
    finally:
        server.close()
        await server.wait_closed()


def _json(resp):
    return json.loads(resp[1])


def test_record_round_trip_and_index(tmp_path):
    store = StateStore(tmp_path)
    record = json.dumps({"id": "prj-a", "kind": "project",
                         "summary": {"title": "A"}, "data": {"files": []}}).encode("utf-8")

    async def cases(port):
        put = await _request(port, "PUT", "/state/projects/prj-a", AUTH, record)
        got = await _request(port, "GET", "/state/projects/prj-a", AUTH)
        index = await _request(port, "GET", "/state/projects", AUTH)
        missing = await _request(port, "GET", "/state/projects/prj-zz", AUTH)
        gone = await _request(port, "DELETE", "/state/projects/prj-a", AUTH)
        after = await _request(port, "GET", "/state/projects", AUTH)
        return put, got, index, missing, gone, after

    put, got, index, missing, gone, after = asyncio.run(_serve(store, cases))

    assert put[0].startswith("HTTP/1.1 200")
    assert _json(put)["entry"]["summary"] == {"title": "A"}
    assert _json(got)["record"]["data"] == {"files": []}
    assert [e["id"] for e in _json(index)["index"]["entries"]] == ["prj-a"]
    assert missing[0].startswith("HTTP/1.1 404")
    assert _json(gone)["deleted"] is True
    assert _json(after)["index"]["entries"] == []


def test_doc_round_trip(tmp_path):
    store = StateStore(tmp_path)
    body = json.dumps({"defaults": {"scale": "medium"}}).encode("utf-8")

    async def cases(port):
        empty = await _request(port, "GET", "/state/doc/tuning", AUTH)
        put = await _request(port, "PUT", "/state/doc/tuning", AUTH, body)
        got = await _request(port, "GET", "/state/doc/tuning", AUTH)
        return empty, put, got

    empty, put, got = asyncio.run(_serve(store, cases))
    assert _json(empty)["doc"] is None
    assert put[0].startswith("HTTP/1.1 200")
    assert _json(got)["doc"]["defaults"]["scale"] == "medium"
    assert _json(got)["doc"]["updated_at"] > 0


def test_verify_and_rebuild_actions(tmp_path):
    store = StateStore(tmp_path)
    store.write_record("history", "h-1", {"id": "h-1", "kind": "history", "summary": {}, "data": {}})
    # Drop the index behind the server's back: verify must notice, rebuild must repair.
    (tmp_path / "history" / "index.json").unlink()

    async def cases(port):
        issues = await _request(port, "GET", "/state/history/_verify", AUTH)
        rebuilt = await _request(port, "POST", "/state/history/_rebuild", AUTH)
        after = await _request(port, "GET", "/state/history/_verify", AUTH)
        return issues, rebuilt, after

    issues, rebuilt, after = asyncio.run(_serve(store, cases))
    assert [i["issue"] for i in _json(issues)["issues"]] == ["missing_entry"]
    assert _json(rebuilt)["count"] == 1
    assert _json(after)["issues"] == []


def test_auth_and_bad_names_are_rejected(tmp_path):
    store = StateStore(tmp_path)

    async def cases(port):
        unauth = await _request(port, "GET", "/state/projects", {"Content-Type": "application/json"})
        traversal = await _request(port, "GET", "/state/projects/..%2Fescape", AUTH)
        bad_method = await _request(port, "POST", "/state/projects/prj-a", AUTH, b"{}")
        return unauth, traversal, bad_method

    unauth, traversal, bad_method = asyncio.run(_serve(store, cases))
    assert unauth[0].startswith("HTTP/1.1 401")
    assert traversal[0].startswith("HTTP/1.1 400")
    assert bad_method[0].startswith("HTTP/1.1 405")
    # Nothing escaped the state root.
    assert not (tmp_path.parent / "escape.json").exists()


def test_unconfigured_state_root_reports_503(tmp_path):
    async def cases(port):
        return await _request(port, "GET", "/state/projects", AUTH)

    resp = asyncio.run(_serve(None, cases))
    assert resp[0].startswith("HTTP/1.1 503")
    assert "STATE_ROOT" in _json(resp)["error"]


def test_preflight_allows_the_write_verbs(tmp_path):
    """A browser preflights PUT/DELETE. If the response omits them every state write is blocked
    and the page silently falls back to its offline buffer (measured 2026-07-21)."""
    store = StateStore(tmp_path)

    async def cases(port):
        return await _request(port, "OPTIONS", "/state/projects/prj-a", {"Origin": "http://127.0.0.1:8080"})

    status, _ = asyncio.run(_serve(store, cases))
    assert status.startswith("HTTP/1.1 204")


def test_cors_header_lists_put_and_delete():
    header = ai_server._cors_headers("*")
    for verb in ("GET", "POST", "PUT", "DELETE", "OPTIONS"):
        assert verb in header, f"{verb} missing from Access-Control-Allow-Methods"


def test_sessions_endpoint_reports_idle(tmp_path):
    store = StateStore(tmp_path)

    async def cases(port):
        return await _request(port, "GET", "/sessions", AUTH)

    resp = asyncio.run(_serve(store, cases))
    assert resp[0].startswith("HTTP/1.1 200")
    payload = _json(resp)
    assert payload["active"] == 0 and payload["sessions"] == []
