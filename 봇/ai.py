# -*- coding: utf-8 -*-
"""AI 어댑터 (AI모드골격 §1, SoT §5).

claude -p --input-format stream-json --output-format stream-json 패턴을 복제.
브리지 import 없음(복사 모델, SoT §7.2).
discord 무관.
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
    """invoke 반환값 (SoT §5)."""
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
    """claude -p stream-json 어댑터 (AI모드골격 §1, SoT §5).

    Windows: subprocess.list2cmdline + create_subprocess_shell로 claude.CMD 구동.
    stdin에 JSON 한 줄로 메시지 전송.
    stdout 줄 파싱: type==assistant -> on_stream 콜백, type==result -> 최종값.
    실패(프로세스 오류, 타임아웃) -> ok=False (throw 아님, AIInvokeError graceful).
    """
    # 세션 처리 (AI모드골격 §1, §4)
    is_new_session = session_id is None
    effective_sid = session_id or str(uuid.uuid4())

    # claude CLI 인수 구성
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

    # stdin 페이로드
    payload: dict[str, Any] = {
        "type": "user",
        "message": {"role": "user", "content": prompt},
    }
    if system:
        payload["system"] = system

    stdin_data = (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")

    # Windows: list2cmdline + create_subprocess_shell (AI모드골격 §1)
    import subprocess as _sp
    cmd_str = _sp.list2cmdline(cmd_parts)

    try:
        proc = await asyncio.create_subprocess_shell(
            cmd_str,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            limit=1024 * 1024,  # 긴 추론 줄 대비 (AI모드골격 §1)
        )
    except Exception as e:
        return AIResult(text="", ok=False, error=f"프로세스 생성 실패: {e}")

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
        return AIResult(text="", ok=False, error="타임아웃")
    except Exception as e:
        return AIResult(text="", ok=False, error=f"communicate 오류: {e}")

    if proc.returncode != 0:
        err_msg = stderr_bytes.decode("utf-8", errors="replace").strip()
        return AIResult(text="", ok=False, error=f"claude 종료코드 {proc.returncode}: {err_msg}")

    # stdout 줄 파싱 (AI모드골격 §1)
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
            # 중간 스트림 텍스트
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
            # 최종 결과
            result_val = obj.get("result", "")
            if isinstance(result_val, str):
                final_text = result_val
            elif isinstance(result_val, dict):
                final_text = result_val.get("content", "")

    if not final_text:
        # result 줄이 없었으면 stderr 참조
        err = stderr_bytes.decode("utf-8", errors="replace").strip()
        if err:
            return AIResult(text="", ok=False, error=f"출력 없음: {err}")

    return AIResult(text=final_text, ok=True)
