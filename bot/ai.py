# -*- coding: utf-8 -*-
"""AI adapter (ai-mode §1, SoT §5).

Replicates the claude -p --input-format stream-json --output-format stream-json pattern.
No bridge import (copy model, SoT §7.2).
Discord-agnostic.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from dataclasses import dataclass
from typing import Any, Callable, Awaitable

log = logging.getLogger(__name__)


@dataclass
class AIResult:
    """Return value of invoke (SoT §5)."""
    text: str
    ok: bool
    error: str | None = None


async def invoke(
    prompt: str,
    *,
    system: str | None = None,
    model: str | None = None,
    effort: str = "low",
    max_tokens: int | None = None,
    session_id: str | None = None,
    on_stream: Callable[[str], Awaitable[None]] | None = None,
) -> AIResult:
    """claude -p stream-json adapter (ai-mode §1, SoT §5).

    Windows: drives claude.CMD via subprocess.list2cmdline + create_subprocess_shell.
    Sends the message as a single JSON line on stdin.
    Parses stdout lines: type==assistant -> on_stream callback, type==result -> final value.
    On failure (process error, timeout) -> ok=False (no raise, AIInvokeError graceful).
    """
    # Session handling (ai-mode §1, §4)
    is_new_session = session_id is None
    effective_sid = session_id or str(uuid.uuid4())

    # Build claude CLI arguments
    cmd_parts = ["claude", "-p",
                 "--input-format", "stream-json",
                 "--output-format", "stream-json",
                 "--verbose"]

    if is_new_session:
        cmd_parts += ["--session-id", effective_sid]
    else:
        cmd_parts += ["--resume", effective_sid]

    if model:
        cmd_parts += ["--model", model]

    if max_tokens is not None:
        cmd_parts += ["--max-tokens", str(max_tokens)]

    # stdin payload
    payload: dict[str, Any] = {
        "type": "user",
        "message": {"role": "user", "content": prompt},
    }
    if system:
        payload["system"] = system

    stdin_data = (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")

    # Windows: list2cmdline + create_subprocess_shell (ai-mode §1)
    import subprocess as _sp
    cmd_str = _sp.list2cmdline(cmd_parts)

    try:
        proc = await asyncio.create_subprocess_shell(
            cmd_str,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            limit=1024 * 1024,  # buffer for long reasoning lines (ai-mode §1)
        )
    except Exception as e:
        return AIResult(text="", ok=False, error=f"Process creation failed: {e}")

    try:
        timeout_sec = 120
        stdout_bytes, stderr_bytes = await asyncio.wait_for(
            proc.communicate(input=stdin_data),
            timeout=timeout_sec,
        )
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except Exception:
            pass
        return AIResult(text="", ok=False, error="Timeout")
    except Exception as e:
        return AIResult(text="", ok=False, error=f"communicate error: {e}")

    if proc.returncode != 0:
        err_msg = stderr_bytes.decode("utf-8", errors="replace").strip()
        return AIResult(text="", ok=False, error=f"claude exit code {proc.returncode}: {err_msg}")

    # Parse stdout lines (ai-mode §1)
    final_text = ""
    for raw_line in stdout_bytes.splitlines():
        line = raw_line.decode("utf-8", errors="replace").strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue

        obj_type = obj.get("type", "")

        if obj_type == "assistant":
            # Intermediate stream text
            content = obj.get("message", {}).get("content", "")
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text":
                        chunk = block.get("text", "")
                        if on_stream and chunk:
                            try:
                                await on_stream(chunk)
                            except Exception:
                                pass
            elif isinstance(content, str) and on_stream and content:
                try:
                    await on_stream(content)
                except Exception:
                    pass

        elif obj_type == "result":
            # Final result
            result_val = obj.get("result", "")
            if isinstance(result_val, str):
                final_text = result_val
            elif isinstance(result_val, dict):
                final_text = result_val.get("content", "")

    if not final_text:
        # No result line found; check stderr
        err = stderr_bytes.decode("utf-8", errors="replace").strip()
        if err:
            return AIResult(text="", ok=False, error=f"No output: {err}")

    return AIResult(text=final_text, ok=True)
