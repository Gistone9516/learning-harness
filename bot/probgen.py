# -*- coding: utf-8 -*-
"""On-demand practice-problem generation + deterministic execution verification.

Flow:  web '생성' button -> ai_server POST /problems -> generate_and_verify()
       -> ai.invoke (claude subscription, sonnet) writes N+ problems as JSON
       -> code/SQL problems are EXECUTED and their answer overwritten with the real
          program output (ground truth), following the build-time rule "stdout is the
          answer". Problems that fail to compile/run are dropped. Non-code problems
          (theory/judge/cloze) keep the model answer (they can't be executed).

Toolchain (host = Windows where ai_server runs):
    Python  -> `python`         (native)
    Java    -> `javac` + `java` (native; detects the public/main class)
    C       -> WSL `gcc-14`     (no native C compiler on this host)
    SQL     -> python `sqlite3` (in-memory; the final SELECT is the answer)

Every executor is wrapped so a single failure never aborts the request: it returns
(ok, output, error) and the caller decides. The correctness guarantee for code stands
on execution, not on the model's self-reported answer.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import sqlite3
import subprocess
import tempfile
import uuid
from typing import Any

import ai

CODE_LANGS = {"python", "c", "java", "sql"}
_EXEC_TIMEOUT = 10  # seconds per program


# ── output normalization (mirror of the web grader's collapse_space + trim) ──────
def norm_line(s: str) -> str:
    """Collapse all whitespace runs to single spaces and strip. Matches the
    ['nfkc','trim','collapse_space'] answer normalization used by baked code problems,
    so a verified stdout compares equal to what the grader will accept."""
    return re.sub(r"[\s　﻿]+", " ", (s or "")).strip()


# ── executors: each returns (ok, output, error) ─────────────────────────────────
def run_python(code: str) -> tuple[bool, str, str]:
    try:
        with tempfile.TemporaryDirectory() as d:
            src = os.path.join(d, "prog.py")
            with open(src, "w", encoding="utf-8") as f:
                f.write(code)
            p = subprocess.run(
                ["python", src], capture_output=True, text=True,
                timeout=_EXEC_TIMEOUT, encoding="utf-8", errors="replace",
            )
            if p.returncode != 0 and not p.stdout.strip():
                return False, "", f"python exit {p.returncode}: {p.stderr.strip()[:400]}"
            return True, p.stdout, ""
    except subprocess.TimeoutExpired:
        return False, "", "python timeout"
    except Exception as e:  # noqa: BLE001
        return False, "", f"python error: {e}"


def run_java(code: str) -> tuple[bool, str, str]:
    m = re.search(r"public\s+class\s+(\w+)", code) or re.search(r"class\s+(\w+)", code)
    if not m:
        return False, "", "java: no class found"
    cls = m.group(1)
    try:
        with tempfile.TemporaryDirectory() as d:
            src = os.path.join(d, cls + ".java")
            with open(src, "w", encoding="utf-8") as f:
                f.write(code)
            c = subprocess.run(
                ["javac", "-encoding", "UTF-8", src], capture_output=True, text=True,
                timeout=_EXEC_TIMEOUT, encoding="utf-8", errors="replace",
            )
            if c.returncode != 0:
                return False, "", f"javac error: {c.stderr.strip()[:400]}"
            r = subprocess.run(
                ["java", "-cp", d, cls], capture_output=True, text=True,
                timeout=_EXEC_TIMEOUT, encoding="utf-8", errors="replace",
            )
            if r.returncode != 0 and not r.stdout.strip():
                return False, "", f"java exit {r.returncode}: {r.stderr.strip()[:400]}"
            return True, r.stdout, ""
    except subprocess.TimeoutExpired:
        return False, "", "java timeout"
    except Exception as e:  # noqa: BLE001
        return False, "", f"java error: {e}"


def _win_to_wsl(path: str) -> str:
    """C:\\Users\\x -> /mnt/c/Users/x  (ASCII temp path, so no Korean-path bridge issue)."""
    p = path.replace("\\", "/")
    if len(p) > 1 and p[1] == ":":
        p = "/mnt/" + p[0].lower() + p[2:]
    return p


def run_c(code: str) -> tuple[bool, str, str]:
    """Compile+run C via WSL gcc-14 (no native compiler on this host). The source lives
    in an ASCII Windows temp dir; only ASCII /mnt paths cross the PowerShell->wsl bridge,
    and compile+run happen in one wsl call (wsl clears /tmp between calls)."""
    try:
        tmp = os.path.join(tempfile.gettempdir(), "lh_cgen")
        os.makedirs(tmp, exist_ok=True)
        stem = "c_" + uuid.uuid4().hex[:8]
        src = os.path.join(tmp, stem + ".c")
        out = os.path.join(tmp, stem + ".out")
        with open(src, "w", encoding="utf-8", newline="\n") as f:
            f.write(code)
        wsrc, wout = _win_to_wsl(src), _win_to_wsl(out)
        cmd = f"gcc-14 '{wsrc}' -o '{wout}' -std=c11 -w && '{wout}'"
        r = subprocess.run(
            ["wsl", "bash", "-lc", cmd], capture_output=True, text=True,
            timeout=_EXEC_TIMEOUT + 8, encoding="utf-8", errors="replace",
        )
        try:
            os.remove(src)
            if os.path.exists(out):
                os.remove(out)
        except OSError:
            pass
        if r.returncode != 0 and not r.stdout.strip():
            return False, "", f"gcc/run error: {r.stderr.strip()[:400]}"
        return True, r.stdout, ""
    except subprocess.TimeoutExpired:
        return False, "", "c timeout"
    except FileNotFoundError:
        return False, "", "c: wsl not available"
    except Exception as e:  # noqa: BLE001
        return False, "", f"c error: {e}"


def _split_sql(script: str) -> list[str]:
    """Split a SQL script into statements on ';' outside single-quoted strings."""
    stmts, buf, in_str = [], [], False
    i = 0
    while i < len(script):
        ch = script[i]
        if ch == "'":
            in_str = not in_str
            buf.append(ch)
        elif ch == ";" and not in_str:
            s = "".join(buf).strip()
            if s:
                stmts.append(s)
            buf = []
        else:
            buf.append(ch)
        i += 1
    tail = "".join(buf).strip()
    if tail:
        stmts.append(tail)
    return stmts


def run_sql(code: str) -> tuple[bool, str, str]:
    """Execute the script in an in-memory SQLite; the answer is the LAST statement that
    returns rows, flattened row-major and space-joined (matches the single-line convention)."""
    try:
        con = sqlite3.connect(":memory:")
        cur = con.cursor()
        last_rows: list[tuple] | None = None
        try:
            for stmt in _split_sql(code):
                cur.execute(stmt)
                if cur.description is not None:  # a row-returning statement
                    last_rows = cur.fetchall()
        finally:
            con.close()
        if last_rows is None:
            return False, "", "sql: no SELECT result"
        cells = [("" if v is None else str(v)) for row in last_rows for v in row]
        return True, " ".join(cells), ""
    except Exception as e:  # noqa: BLE001
        return False, "", f"sql error: {e}"


def execute(lang: str, code: str) -> tuple[bool, str, str]:
    if lang == "python":
        return run_python(code)
    if lang == "java":
        return run_java(code)
    if lang == "c":
        return run_c(code)
    if lang == "sql":
        return run_sql(code)
    return False, "", f"unknown lang: {lang}"


# ── verification: overwrite the answer of a code problem with real output ────────
def verify_problem(p: dict[str, Any]) -> dict[str, Any] | None:
    """For a code/SQL problem: run it and set answer_spec.accepted to the real output
    (ground truth). Returns the fixed problem, or None if it fails to compile/run.
    Non-code problems pass through unchanged with verified=False."""
    front = p.get("front") or {}
    lang = front.get("lang")
    code = front.get("code")
    if not (isinstance(lang, str) and lang in CODE_LANGS and isinstance(code, str) and code.strip()):
        p["verified"] = False
        return p
    ok, out, _err = execute(lang, code)
    if not ok:
        return None  # drop: we cannot guarantee its answer
    answer = norm_line(out)
    if answer == "":
        return None  # empty output is never a useful answer
    spec = p.get("answer_spec") or {}
    spec["normalize"] = ["nfkc", "trim", "collapse_space"]
    spec["accepted"] = [answer]
    spec.pop("blanks", None)
    spec.pop("required_keywords", None)
    spec.pop("sequence", None)
    p["answer_spec"] = spec
    p["grade_mode"] = "exact"
    p["type"] = "func"
    p["verified"] = True
    return p


# ── generation prompt ────────────────────────────────────────────────────────────
# The strict "JSON only" instruction goes in the USER message with a worked example —
# a system-message instruction alone was ignored (the model returned pretty markdown).
_SCHEMA_RULES = r"""[출력 규칙 — 반드시 엄수]
- 오직 JSON 배열 하나만 출력한다. 출력의 첫 문자는 '[' 이고 마지막 문자는 ']' 이다.
- 마크다운, 코드펜스(```), 머리말, 설명 문장, "정답:" 같은 해설 텍스트를 절대 쓰지 마라. JSON 외 텍스트 금지.
- 각 원소는 아래 예시와 똑같은 형태여야 한다:
[
  {"type":"func","grade_mode":"exact","front":{"prompt":"다음 코드의 출력은?","code":"s='abcd'\nprint(s[::-1])","lang":"python"},"answer_spec":{"normalize":["nfkc","trim","collapse_space"],"accepted":["dcba"]}},
  {"type":"judge","grade_mode":"exact","front":{"scenario":"슬라이싱 s[::-1]의 의미로 옳은 것은?","options":["역순 복사","앞 절반","깊은 복사","정렬"]},"answer_spec":{"normalize":["nfkc","trim","collapse_space","lower"],"accepted":["역순 복사"]}},
  {"type":"cloze","grade_mode":"cloze","front":{"text":"리스트 얕은 복사는 a[{{0}}] 로 만든다"},"answer_spec":{"normalize":["nfkc","trim","collapse_space","lower"],"blanks":[[":"]]}},
  {"type":"proc","grade_mode":"keyword","front":{"prompt":"얕은 복사와 깊은 복사의 차이를 설명하라"},"answer_spec":{"normalize":["nfkc","trim","collapse_space","lower"],"required_keywords":[["참조","주소"],["독립","별도"]]}}
]
- 코드 추적 문제(func): front.code 에 완전히 실행 가능하고 결정적인 코드를 넣고 front.lang 을 python|c|java|sql 중 하나로 지정한다. input/scanf/난수/시간/네트워크 금지.
- 코드 문제의 정답은 프로그램 표준출력이다. accepted 에 예상 출력을 한 줄(공백 구분)로 적되, 서버가 실제 실행결과로 최종 확정한다.
- SQL 은 front.lang="sql", front.code 가 마지막에 정확히 하나의 SELECT 로 끝난다.
- Java 는 public class 하나에 main 을 둔다. C 는 stdio 로 결정적 출력.
- 객관식(judge)은 front.options 4개, accepted 에 정답 보기 문자열 그대로.
- 빈칸(cloze)은 front.text 에 {{0}}, {{1}} 표기와 blanks 를 맞춘다.
- 가독성을 위해 front.prompt/front.text 안에서 학습 화면 컴포넌트 마크다운을 쓸 수 있다: 소제목 '## 제목', 목록 '- 항목', 표 '| a | b |', 강조 박스 ':::핵심' 또는 ':::주의' 로 열고 ':::' 로 닫기, 인라인 코드 `기호`, 문장 강조 ==중요==. 보기나 예시 데이터(표·목록)는 이 컴포넌트로 정리해 자기완결형으로 보여준다.
- 한국어로 출제하고 개념 범위를 벗어나지 않는다."""


_KICHUL_STYLE = r"""[출제 성격 — 정보처리기사 실기 기출 스타일]
- 2020년 개편 이후 실기 기출의 성격에 맞춘다. 난이도는 2026년 1회 수준으로 유지(쉽게 내지 마라).
- 유형 비중: 코드 출력값 추적(python/c/java)과 SQL 결과, 단답형 용어, 개념 약술(서술), 설명문 빈칸을 우선한다. 객관식(judge)은 최소화한다.
- 코드 문제는 짧지만 함정이 있는 코드를 노린다: 연산자 우선순위, 형변환/자동 형변환, 포인터와 배열, 얕은 복사와 깊은 복사, switch fall-through, 슬라이싱, 비트 연산 등 외우지 않으면 틀리는 지점.
- 발문은 실무 시나리오형이나 정의 요구형으로 간결하게 쓴다(예: "~하는 기술은 무엇인가", "~의 개념을 서술하시오", "출력값을 쓰시오").
- 서술형은 type="proc", grade_mode="keyword"로 내고 required_keywords에 핵심어만 담아 관대하게 채점되도록 한다."""


def _build_prompt(course_title: str, concept: dict[str, Any], existing: list[str], feedback: list[str], count: int) -> str:
    parts = [
        f"너는 '{course_title}' 자격시험의 문제 출제기다. 아래 개념에 대한 연습문제 {count}개를 새로 만들어라.",
        f"\n[개념 제목] {concept.get('title', '')}",
        f"[개념 본문]\n{concept.get('body', '')}",
        "\n" + _KICHUL_STYLE,
    ]
    if existing:
        joined = "\n".join(f"- {e}" for e in existing[:40])
        parts.append(f"\n[이미 있는 문제 — 중복 금지, 반드시 다른 문제를 낼 것]\n{joined}")
    if feedback:
        joined = "\n".join(f"- {fb}" for fb in feedback[:20])
        parts.append(f"\n[이전 삭제 사유 — 반드시 반영]\n{joined}")
    parts.append("\n" + _SCHEMA_RULES)
    return "\n".join(parts)


def _extract_array(text: str) -> list[dict[str, Any]]:
    """Pull the first well-formed JSON array of objects out of the text, even if the
    model wrapped it in prose or code fences. Scans every '[' with raw_decode so a
    stray '[' in prose does not defeat parsing."""
    t = (text or "").replace("```json", "").replace("```", "")
    dec = json.JSONDecoder()
    for i, ch in enumerate(t):
        if ch != "[":
            continue
        try:
            val, _end = dec.raw_decode(t, i)
        except ValueError:
            continue
        if isinstance(val, list):
            objs = [x for x in val if isinstance(x, dict)]
            if objs:
                return objs
    return []


async def generate_and_verify(
    *,
    concept: dict[str, Any],
    existing: list[str],
    feedback: list[str],
    count: int,
    course_title: str,
    model: str | None,
) -> dict[str, Any]:
    """Generate `count` verified problems for a concept. Over-generates to absorb drops.
    Returns {ok, problems, error, dropped}."""
    count = max(1, min(int(count or 5), 10))
    want = count + 3  # over-generate so failed-execution drops still leave enough
    prompt = _build_prompt(course_title, concept, existing, feedback, want)
    try:
        res = await ai.invoke(prompt, model=model or "sonnet", effort="high")
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "problems": [], "error": f"invoke error: {e}", "dropped": 0}
    if not res.ok:
        return {"ok": False, "problems": [], "error": res.error or "ai failed", "dropped": 0}

    raw = _extract_array(res.text)
    if not raw:
        return {"ok": False, "problems": [], "error": "no JSON array in AI output", "dropped": 0}

    cid = str(concept.get("concept_id", "gen"))
    stamp = uuid.uuid4().hex[:6]
    out: list[dict[str, Any]] = []
    dropped = 0
    for i, p in enumerate(raw):
        if len(out) >= count:
            break
        p.setdefault("type", "func")
        p.setdefault("grade_mode", "exact")
        p.setdefault("front", {})
        p.setdefault("answer_spec", {"normalize": ["nfkc", "trim", "collapse_space"]})
        fixed = verify_problem(p)
        if fixed is None:
            dropped += 1
            continue
        fixed["card_id"] = f"{cid}-gen-{stamp}-{i}"
        fixed.setdefault("links", {"concept_ref": cid})
        out.append(fixed)

    if not out:
        return {"ok": False, "problems": [], "error": "all generated problems failed verification", "dropped": dropped}
    return {"ok": True, "problems": out, "error": None, "dropped": dropped}
