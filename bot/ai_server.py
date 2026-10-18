# -*- coding: utf-8 -*-
"""Gated local AI HTTP server (Discord-independent). Bridges a web client to the claude subscription.

Path: web client -> this local HTTP server -> ai.invoke -> `claude -p` (subscription) -> back. No Discord.
Run as its own process (separate from the Discord bot):  python bot/ai_server.py

Security (SoT 7.12): binds to 127.0.0.1 by default; every /ai call must present a shared token
(`AI_SERVER_TOKEN`), so even when exposed through a tunnel an unauthenticated caller is rejected. The
server refuses to start without a token. It never logs the token or full prompt text, and never returns
secrets. To reach it from another device, put a tunnel (Cloudflare Tunnel / ngrok) in front of the local
port; the token still gates every request.

Besides /ai it exposes a generic state store (state_store.py) so a browser can persist instance
state as one-record-per-file collections that an operator can also read and write directly,
/sessions for observing in-flight claude processes, and /repos/load (repo_loader.py) which reads a
learner-given git repo (remote URL or local folder) and returns its filtered file contents as text
-- the browser cannot read disks or clone, and the claude CLI runs with tools disabled, so this
server is the only place that touches the filesystem or spawns `git` for that flow.

Config (env / .env):
    AI_SERVER_TOKEN   required shared secret; without it the server refuses to start.
    AI_SERVER_HOST    bind host (default 127.0.0.1).
    AI_SERVER_PORT    bind port (default 8765).
    AI_SERVER_ORIGIN  CORS Access-Control-Allow-Origin (default '*'; token gates anyway).
    STATE_ROOT        state folder to mount (or pass it as the first CLI argument).
                      Unset -> state endpoints answer 503 instead of failing silently.
"""
from __future__ import annotations

import asyncio
import collections
import json
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _paths
_paths.setup()

from env_load import load_instance_env

import ai
import probgen
import repo_loader
import live
import session_guard
from state_store import StateError, StateStore

log = logging.getLogger("ai_server")

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
_MAX_BODY = 4 * 1024 * 1024   # generated projects are stored through this server, so allow a few MB

# One lock per collection serialises record writes with their index update, so two concurrent
# writes cannot interleave into a lost index entry.
_locks: dict[str, asyncio.Lock] = collections.defaultdict(asyncio.Lock)


def _cors_headers(origin: str) -> str:
    # PUT and DELETE are the state store's write verbs. Without them here the browser's preflight
    # rejects every write and the page silently falls back to its offline buffer, so the source of
    # truth never sees a record (measured 2026-07-21 — a Python client passes, a browser does not).
    return (
        f"Access-Control-Allow-Origin: {origin}\r\n"
        "Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS\r\n"
        "Access-Control-Allow-Headers: Content-Type, Authorization, X-AI-Token\r\n"
        "Access-Control-Max-Age: 600\r\n"
    )


def check_auth(headers: dict, token: str) -> bool:
    """True when the request carries the shared token (Authorization: Bearer, or X-AI-Token)."""
    if not token:
        return False
    auth = headers.get("authorization", "")
    if auth.startswith("Bearer ") and auth[7:].strip() == token:
        return True
    return headers.get("x-ai-token", "").strip() == token


def _response(status: str, body: bytes, origin: str, ctype: str = "application/json") -> bytes:
    head = (
        f"HTTP/1.1 {status}\r\n"
        f"Content-Type: {ctype}\r\n"
        f"Content-Length: {len(body)}\r\n"
        + _cors_headers(origin) +
        "Connection: close\r\n\r\n"
    ).encode("utf-8")
    return head + body


async def _read_request(reader):
    """Minimal HTTP request reader. Returns (method, path, headers dict, body bytes) or None."""
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = await reader.read(4096)
        if not chunk:
            break
        data += chunk
        if len(data) > _MAX_BODY:
            break
    if b"\r\n\r\n" not in data:
        return None
    head, _, rest = data.partition(b"\r\n\r\n")
    lines = head.split(b"\r\n")
    try:
        method, path, _ver = lines[0].decode("latin-1").split(" ", 2)
    except ValueError:
        return None
    headers = {}
    for line in lines[1:]:
        k, _, v = line.partition(b":")
        if k:
            headers[k.decode("latin-1").strip().lower()] = v.decode("latin-1").strip()
    clen = int(headers.get("content-length", "0") or 0)
    body = rest
    while len(body) < clen and len(body) <= _MAX_BODY:
        chunk = await reader.read(min(4096, clen - len(body)))
        if not chunk:
            break
        body += chunk
    return method, path, headers, body


def _json_bytes(payload) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


async def handle_state(method: str, path: str, payload, store: StateStore | None):
    """Route a /state/... request. Returns (status, body_object).

    Shapes (state layer contract):
        GET    /state/doc/<name>            -> {ok, doc}
        PUT    /state/doc/<name>            -> {ok, doc}
        GET    /state/<coll>                -> {ok, index}
        GET    /state/<coll>/<id>           -> {ok, record}
        PUT    /state/<coll>/<id>           -> {ok, entry}
        DELETE /state/<coll>/<id>           -> {ok, deleted}
        GET    /state/<coll>/_verify        -> {ok, issues}
        POST   /state/<coll>/_rebuild       -> {ok, count}
    """
    if store is None:
        return 503, {"ok": False, "error": "state root not configured (set STATE_ROOT)"}

    parts = [p for p in path.split("/") if p]      # ["state", ...]
    rest = parts[1:]
    if not rest:
        return 404, {"ok": False, "error": "not found"}

    try:
        if rest[0] == "doc":
            if len(rest) != 2:
                return 404, {"ok": False, "error": "not found"}
            name = rest[1]
            if method == "GET":
                return 200, {"ok": True, "doc": store.read_doc(name)}
            if method == "PUT":
                return 200, {"ok": True, "doc": store.write_doc(name, payload if isinstance(payload, dict) else {})}
            return 405, {"ok": False, "error": "method not allowed"}

        collection = rest[0]
        if len(rest) == 1:
            if method != "GET":
                return 405, {"ok": False, "error": "method not allowed"}
            return 200, {"ok": True, "index": store.read_index(collection)}

        if len(rest) != 2:
            return 404, {"ok": False, "error": "not found"}
        target = rest[1]

        # Reserved actions; the id pattern forbids underscores so these cannot shadow a record.
        if target == "_verify":
            if method != "GET":
                return 405, {"ok": False, "error": "method not allowed"}
            return 200, {"ok": True, "issues": store.verify(collection)}
        if target == "_rebuild":
            if method != "POST":
                return 405, {"ok": False, "error": "method not allowed"}
            async with _locks[collection]:
                return 200, {"ok": True, "count": store.rebuild(collection)}

        if method == "GET":
            record = store.read_record(collection, target)
            if record is None:
                return 404, {"ok": False, "error": "record not found"}
            return 200, {"ok": True, "record": record}
        if method == "PUT":
            if not isinstance(payload, dict):
                return 400, {"ok": False, "error": "record must be an object"}
            async with _locks[collection]:
                return 200, {"ok": True, "entry": store.write_record(collection, target, payload)}
        if method == "DELETE":
            async with _locks[collection]:
                return 200, {"ok": True, "deleted": store.delete_record(collection, target)}
        return 405, {"ok": False, "error": "method not allowed"}

    except StateError as e:
        return e.status, {"ok": False, "error": e.message}


class _CallerGone(Exception):
    """The caller closed its connection while a call ran; there is no one to answer."""


async def _unless_dropped(reader, coro):
    """Run `coro`, cancelling it if the caller hangs up first (web-contract §2, session lifetime).

    asyncio never cancels a handler because its peer left, so without this a closed tab keeps a claude
    child generating until it finishes. The body is already read, so the next read returns b"" only when
    the caller closed (or reset) its side; any bytes it does send are ignored.
    """
    work = asyncio.ensure_future(coro)
    while True:
        watch = asyncio.ensure_future(reader.read(1))
        try:
            done, _ = await asyncio.wait({work, watch}, return_when=asyncio.FIRST_COMPLETED)
        finally:
            if not watch.done():
                watch.cancel()
        if work in done:
            return work.result()
        try:
            gone = watch.result() == b""
        except (ConnectionError, OSError):
            gone = True
        if gone:
            work.cancel()
            try:
                await work
            except BaseException:
                pass
            raise _CallerGone()


def _make_handler(token: str, origin: str, store: StateStore | None = None):
    async def handle(reader, writer):
        try:
            parsed = await _read_request(reader)
            if parsed is None:
                writer.write(_response("400 Bad Request", b'{"ok":false,"error":"bad request"}', origin))
                await writer.drain()
                return
            method, path, headers, body = parsed
            path = path.split("?", 1)[0]

            # CORS preflight.
            if method == "OPTIONS":
                writer.write(_response("204 No Content", b"", origin))
                await writer.drain()
                return

            # Health check (no auth) so a tunnel can be probed without the token.
            if method == "GET" and path == "/health":
                writer.write(_response("200 OK", b'{"ok":true,"service":"ai_server"}', origin))
                await writer.drain()
                return

            is_state = path == "/state" or path.startswith("/state/")
            is_ai = method == "POST" and path in ("/ai", "/problems", "/repos/load")
            is_sessions = method == "GET" and path == "/sessions"
            if not (is_state or is_ai or is_sessions):
                writer.write(_response("404 Not Found", b'{"ok":false,"error":"not found"}', origin))
                await writer.drain()
                return

            if not check_auth(headers, token):
                writer.write(_response("401 Unauthorized", b'{"ok":false,"error":"unauthorized"}', origin))
                await writer.drain()
                return

            try:
                payload = json.loads(body or b"{}")
            except Exception:
                writer.write(_response("400 Bad Request", b'{"ok":false,"error":"invalid json"}', origin))
                await writer.drain()
                return

            # In-flight claude processes, for operators and for asserting no orphans remain.
            if is_sessions:
                out = _json_bytes({"ok": True, "active": session_guard.active_count(),
                                   "sessions": session_guard.snapshot()})
                writer.write(_response("200 OK", out, origin))
                await writer.drain()
                return

            if is_state:
                status, result = await handle_state(method, path, payload, store)
                reason = {200: "200 OK", 400: "400 Bad Request", 404: "404 Not Found",
                          405: "405 Method Not Allowed", 500: "500 Internal Server Error",
                          503: "503 Service Unavailable"}.get(status, "500 Internal Server Error")
                writer.write(_response(reason, _json_bytes(result), origin))
                await writer.drain()
                return

            # Repo intake: the browser sends a git URL or local path, this server reads and
            # filters it, and the result is folded into a later /ai call by the caller.
            if path == "/repos/load":
                source = payload.get("source")
                if not isinstance(source, str):
                    writer.write(_response("400 Bad Request", b'{"ok":false,"error":"missing source"}', origin))
                    await writer.drain()
                    return
                result = await repo_loader.load(
                    source,
                    ref=payload.get("ref"),
                    include=payload.get("include"),
                )
                writer.write(_response("200 OK", _json_bytes(result), origin))
                await writer.drain()
                return

            # Practice-problem generation + deterministic execution verification (probgen).
            if path == "/problems":
                concept = payload.get("concept")
                if not isinstance(concept, dict) or not concept.get("title"):
                    writer.write(_response("400 Bad Request", b'{"ok":false,"error":"missing concept"}', origin))
                    await writer.drain()
                    return
                gen = await _unless_dropped(reader, probgen.generate_and_verify(
                    concept=concept,
                    existing=[str(x) for x in (payload.get("existing") or []) if isinstance(x, (str, int, float))],
                    feedback=[str(x) for x in (payload.get("feedback") or []) if isinstance(x, (str, int, float))],
                    count=payload.get("count", 5),
                    course_title=str(payload.get("course_title") or "학습 과정"),
                    model=payload.get("model"),
                    style=payload.get("style") if isinstance(payload.get("style"), str) else None,
                ))
                out = json.dumps(gen, ensure_ascii=False).encode("utf-8")
                writer.write(_response("200 OK", out, origin))
                await writer.drain()
                return

            prompt = payload.get("prompt", "")
            if not isinstance(prompt, str) or not prompt.strip():
                writer.write(_response("400 Bad Request", b'{"ok":false,"error":"empty prompt"}', origin))
                await writer.drain()
                return

            # Resuming an existing session is a small follow-up; a fresh session may be loading a
            # whole artifact. The kind picks the matching timeout (ai.TIMEOUT_BY_KIND).
            # `live: true` (ai-mode §4.1) answers from a long-lived process; everything else spawns one.
            if payload.get("live") is True:
                result = await live.invoke_live(
                    prompt,
                    system=payload.get("system"),
                    model=payload.get("model"),
                    effort=payload.get("effort", "low"),
                    session_id=payload.get("session_id"),
                )
            else:
                result = await _unless_dropped(reader, ai.invoke(
                    prompt,
                    system=payload.get("system"),
                    model=payload.get("model"),
                    effort=payload.get("effort", "low"),
                    session_id=payload.get("session_id"),
                    kind="followup" if payload.get("session_id") else "generate",
                ))
            out = json.dumps({
                "ok": result.ok,
                "text": result.text,
                "session_id": result.session_id,
                "error": result.error,
                # Without this key the browser can never see a lost session, and the reseed
                # path in the web client degrades silently to "never reseed".
                "error_kind": result.error_kind,
            }, ensure_ascii=False).encode("utf-8")
            writer.write(_response("200 OK", out, origin))
            await writer.drain()
        except _CallerGone:
            log.info("caller left; call cancelled")
        except Exception as e:
            log.warning("request handling error: %s", e)
            try:
                writer.write(_response("500 Internal Server Error", b'{"ok":false,"error":"server error"}', origin))
                await writer.drain()
            except Exception:
                pass
        finally:
            try:
                writer.close()
            except Exception:
                pass

    return handle


async def serve(host: str, port: int, token: str, origin: str, store: StateStore | None = None) -> None:
    server = await asyncio.start_server(_make_handler(token, origin, store), host, port)
    log.info("ai_server listening on http://%s:%d  (token gating on, origin=%s)", host, port, origin)
    log.info("state root: %s", store.root if store else "(not configured)")
    try:
        async with server:
            await server.serve_forever()
    finally:
        # Shutdown must not leave claude processes behind, whatever stopped the loop.
        await live.close_all()
        cleaned = await session_guard.shutdown_all()
        if cleaned:
            log.info("terminated %d in-flight session(s)", cleaned)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    # The state root doubles as the hint for which instance this is, so its .env is the one loaded.
    state_arg = (sys.argv[1] if len(sys.argv) > 1 else os.environ.get("STATE_ROOT", "")).strip()
    env_file = load_instance_env(state_arg or None)
    log.info("env: %s", env_file or "(no .env found; using the environment as-is)")

    token = os.environ.get("AI_SERVER_TOKEN", "").strip()
    if not token:
        sys.exit("[ai_server] AI_SERVER_TOKEN is not set. Refusing to start an ungated AI server (SoT 7.12).")
    host = os.environ.get("AI_SERVER_HOST", DEFAULT_HOST).strip() or DEFAULT_HOST
    port = int(os.environ.get("AI_SERVER_PORT", str(DEFAULT_PORT)))
    origin = os.environ.get("AI_SERVER_ORIGIN", "*").strip() or "*"

    # State root: the CLI argument wins, then STATE_ROOT (which the .env just loaded may define).
    state_root = state_arg or os.environ.get("STATE_ROOT", "").strip()
    store = None
    if state_root:
        os.makedirs(state_root, exist_ok=True)
        store = StateStore(state_root)
    else:
        log.warning("STATE_ROOT is not set; /state endpoints will answer 503.")

    try:
        asyncio.run(serve(host, port, token, origin, store))
    except KeyboardInterrupt:
        print("\n[ai_server] stopped.")


if __name__ == "__main__":
    main()
