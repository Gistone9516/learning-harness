# -*- coding: utf-8 -*-
"""Gated local AI HTTP server (Discord-independent). Bridges a web client to the claude subscription.

Path: web client -> this local HTTP server -> ai.invoke -> `claude -p` (subscription) -> back. No Discord.
Run as its own process (separate from the Discord bot):  python bot/ai_server.py

Security (SoT 7.12): binds to 127.0.0.1 by default; every /ai call must present a shared token
(`AI_SERVER_TOKEN`), so even when exposed through a tunnel an unauthenticated caller is rejected. The
server refuses to start without a token. It never logs the token or full prompt text, and never returns
secrets. To reach it from another device, put a tunnel (Cloudflare Tunnel / ngrok) in front of the local
port; the token still gates every request.

Config (env / .env):
    AI_SERVER_TOKEN   required shared secret; without it the server refuses to start.
    AI_SERVER_HOST    bind host (default 127.0.0.1).
    AI_SERVER_PORT    bind port (default 8765).
    AI_SERVER_ORIGIN  CORS Access-Control-Allow-Origin (default '*'; token gates anyway).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _paths
_paths.setup()

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

import ai

log = logging.getLogger("ai_server")

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
_MAX_BODY = 256 * 1024   # cap request body; prompts are small


def _cors_headers(origin: str) -> str:
    return (
        f"Access-Control-Allow-Origin: {origin}\r\n"
        "Access-Control-Allow-Methods: POST, GET, OPTIONS\r\n"
        "Access-Control-Allow-Headers: Content-Type, Authorization, X-AI-Token\r\n"
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


def _make_handler(token: str, origin: str):
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

            if method != "POST" or path != "/ai":
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

            prompt = payload.get("prompt", "")
            if not isinstance(prompt, str) or not prompt.strip():
                writer.write(_response("400 Bad Request", b'{"ok":false,"error":"empty prompt"}', origin))
                await writer.drain()
                return

            result = await ai.invoke(
                prompt,
                system=payload.get("system"),
                model=payload.get("model"),
                effort=payload.get("effort", "low"),
                session_id=payload.get("session_id"),
            )
            out = json.dumps({
                "ok": result.ok,
                "text": result.text,
                "session_id": result.session_id,
                "error": result.error,
            }, ensure_ascii=False).encode("utf-8")
            writer.write(_response("200 OK", out, origin))
            await writer.drain()
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


async def serve(host: str, port: int, token: str, origin: str) -> None:
    server = await asyncio.start_server(_make_handler(token, origin), host, port)
    log.info("ai_server listening on http://%s:%d  (token gating on, origin=%s)", host, port, origin)
    async with server:
        await server.serve_forever()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    token = os.environ.get("AI_SERVER_TOKEN", "").strip()
    if not token:
        sys.exit("[ai_server] AI_SERVER_TOKEN is not set. Refusing to start an ungated AI server (SoT 7.12).")
    host = os.environ.get("AI_SERVER_HOST", DEFAULT_HOST).strip() or DEFAULT_HOST
    port = int(os.environ.get("AI_SERVER_PORT", str(DEFAULT_PORT)))
    origin = os.environ.get("AI_SERVER_ORIGIN", "*").strip() or "*"
    try:
        asyncio.run(serve(host, port, token, origin))
    except KeyboardInterrupt:
        print("\n[ai_server] stopped.")


if __name__ == "__main__":
    main()
