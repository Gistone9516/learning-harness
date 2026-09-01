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

import session_guard

log = logging.getLogger(__name__)

# Generation loads a whole artifact into the session and is slow; follow-ups resume an existing
# session and must not hang for half an hour when something goes wrong. Callers pick a kind.
TIMEOUT_BY_KIND = {"generate": 1800, "followup": 180}
DEFAULT_TIMEOUT_SEC = 1800

# Replaces the CLI's coding-agent system prompt. Without this the model keeps acting like an agent
# even with tools disabled: it announces a plan and emits imitation tool-call blocks as text instead
# of answering (measured 2026-07-21). Deliberately one line of plain ASCII with no shell
# metacharacters, because it travels as a Windows command-line argument.
TEXT_ONLY_SYSTEM = (
    "You are a non-interactive text service. You have no tools and no filesystem access. "
    "Never emit tool calls or blocks that imitate tool calls. "
    "Follow the instructions at the start of the user message exactly and reply with the requested content only."
)


@dataclass
class AIResult:
    """Return value of invoke (SoT §5)."""
    text: str
    ok: bool
    error: str | None = None
    session_id: str | None = None   # the effective claude session id used (lets the caller --resume on later turns)


async def invoke(
    prompt: str,
    *,
    system: str | None = None,
    model: str | None = None,
    effort: str = "low",
    max_tokens: int | None = None,
    session_id: str | None = None,
    on_stream: Callable[[str], Awaitable[None]] | None = None,
    kind: str = "generate",
    timeout_sec: int | None = None,
    tools: str | None = "",
) -> AIResult:
    """claude -p stream-json adapter (ai-mode §1, SoT §5).

    Windows: drives claude.CMD via subprocess.list2cmdline + create_subprocess_shell.
    Sends the message as a single JSON line on stdin.
    Parses stdout lines: type==assistant -> on_stream callback, type==result -> final value.
    On failure (process error, timeout) -> ok=False (no raise, AIInvokeError graceful).

    tools: passed to `--tools`. Default "" disables every tool so the call can only return text
    (see the note where the argument list is built). Pass None to leave the CLI default in place.
    """
    # Session handling (ai-mode §1, §4)
    is_new_session = session_id is None
    effective_sid = session_id or str(uuid.uuid4())

    # Build claude CLI arguments
    cmd_parts = ["claude", "-p",
                 "--input-format", "stream-json",
                 "--output-format", "stream-json",
                 "--verbose"]

    # `claude -p` is an agent, not a completion endpoint: with its default toolset a prompt like
    # "generate a project" makes it WRITE THE FILES into the server's working directory and reply
    # with a prose report, so the caller's structured output never arrives and the instance folder
    # gets polluted (measured 2026-07-21). The kit only ever wants text back, so tools are off
    # unless a caller explicitly asks for them.
    if tools is not None:
        cmd_parts += ["--tools", tools]
        # Tools off is not enough on its own: the agent persona lives in the CLI's own system
        # prompt, so it has to be replaced too. Only done when the caller wants the text-only mode.
        cmd_parts += ["--system-prompt", TEXT_ONLY_SYSTEM]

    if is_new_session:
        cmd_parts += ["--session-id", effective_sid]
    else:
        cmd_parts += ["--resume", effective_sid]

    if model:
        cmd_parts += ["--model", model]

    if effort:
        cmd_parts += ["--effort", effort]
    # This claude CLI has no output-token cap flag, so max_tokens is accepted for
    # signature compatibility but never forwarded. Passing --max-tokens used to make
    # the CLI exit with "unknown option" -> every AI call failed (ok=False).
    _ = max_tokens

    # stdin payload.
    #
    # The preamble rides at the head of the user message rather than in a `system` key: the CLI
    # ignores that key entirely (measured 2026-07-21 — a sentinel instruction sent that way never
    # took effect, so every kit preamble, safety clause included, was silently dropped). This CLI
    # version offers only --system-prompt, with no file variant, and passing a multi-line preamble
    # with quotes as a Windows command-line argument is its own well-known breakage. stdin is JSON,
    # so newlines, quotes and non-ASCII survive intact.
    content = f"{system}\n\n---\n\n{prompt}" if system else prompt
    payload: dict[str, Any] = {
        "type": "user",
        "message": {"role": "user", "content": content},
    }

    stdin_data = (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")

    # Windows: list2cmdline + create_subprocess_shell (ai-mode §1)
    import subprocess as _sp
    cmd_str = _sp.list2cmdline(cmd_parts)

    effective_timeout = timeout_sec if timeout_sec else TIMEOUT_BY_KIND.get(kind, DEFAULT_TIMEOUT_SEC)

    # The guard owns the child from here on: it kills and reaps the process on every exit path,
    # including timeout, error and task cancellation, so no orphan claude process survives.
    async with session_guard.track(kind=kind, session_id=effective_sid) as slot:
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
        slot.attach(proc)

        try:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                proc.communicate(input=stdin_data),
                timeout=effective_timeout,
            )
        except asyncio.TimeoutError:
            return AIResult(text="", ok=False, error=f"Timeout after {effective_timeout}s")
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
        # No result event in the output: treat as failure so callers fall back
        # (an empty response is never a valid AI result).
        err = stderr_bytes.decode("utf-8", errors="replace").strip()
        msg = f"No output: {err}" if err else "No result event in output"
        return AIResult(text="", ok=False, error=msg)

    return AIResult(text=final_text, ok=True, session_id=effective_sid)
