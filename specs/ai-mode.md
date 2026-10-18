# v5 AI Mode Skeleton

> buildflow ② per-folder contract. **Conforms to SoT(`_interface-contract.md`)**, especially §5 `invoke`.
> Scope: common skeleton for AI learning capabilities (layer 3) — `_invoke` adapter, token control, AI mode plug, multi-turn.
> **Copy model (SoT §7.2)**: replicate the stream-json adapter **pattern** from discord-bridge `bridge.py` (~140 lines). Zero bridge imports or execution.
> Concrete AI modes (vocabulary, grammar, etc.) are injected via content/config — this spec covers the **skeleton only**.

---

## 1. `_invoke` Adapter (subscription-driven, stream-json)

> **Authority separation (SoT §5)**: the `invoke` interface (signature, return type, parameter semantics) is owned by SoT §5. This §1 covers the **launch details** (CLI flags, `--session-id`/`--resume` branching, Windows execution). SoT §5 takes precedence on conflicts.

Launch = `claude -p --input-format stream-json --output-format stream-json --verbose --session-id <uuid>`
(subsequent resume: `--resume <uuid>`). **Not an API key — subscription OAuth.** Message sent as one JSON line on stdin:
`{"type":"user","message":{"role":"user","content":<text>}}`. Among output lines, `.result` of `{"type":"result",...}` is the final response.

```python
async def invoke(prompt, *, system=None, model=None, effort="low",
                 max_tokens=None, session_id=None, on_stream=None) -> AIResult: ...
```
- **Windows**: launch `claude.CMD` via `subprocess.list2cmdline` + `create_subprocess_shell`. Arbitrary text goes via **stdin, not argv** (no injection). Increase line-buffer `limit` to handle long reasoning lines.
- **Streaming**: parse stdout lines — intermediate `{"type":"assistant",...}` text goes to `on_stream` callback (if provided); `{"type":"result"}` is the final response.
- **No session specified**: one-shot (generate a new session_id, no resume). **Session specified**: `--resume` with that session_id (multi-turn).
- Returns `AIResult{text, ok, error}`. On failure (subprocess error or timeout): `ok=False`, `error` set (no throw — caller handles gracefully).

### 1.1 Two rules the CLI forces on us (measured 2026-07-21)

`claude -p` is an **agent**, not a completion endpoint. Two consequences are contract, not preference:

- **Tools off (`--tools ""`).** With the default toolset a task-shaped prompt ("generate a project") makes it do the work on disk — it wrote a full project into the server's working directory, ran the tests, and replied with a prose report, so the caller's structured output never arrived and the mounted instance folder was polluted. The kit only ever wants text back, so `invoke` passes `--tools ""` by default; `tools=None` restores the CLI default for a caller that genuinely wants an agent.
- **The preamble travels in the user message.** A `system` key in the stdin JSON is **ignored** by the CLI (a sentinel instruction sent that way had no effect), which silently dropped every preamble the kit believed it was sending, safety clause included. This CLI version exposes only `--system-prompt` with no file variant, and passing a multi-line preamble containing quotes as a Windows command-line argument is its own breakage, so `invoke` prepends the preamble to the message content (`<system>\n\n---\n\n<prompt>`). stdin is JSON, so newlines, quotes and non-ASCII survive intact.

Guarded by `bot/tests/test_ai_invocation.py`. A structured-output caller should also state the rule in its own prompt ("return JSON only, do not create files"), since defence in depth costs nothing here.

---

## 2. Token Control Discipline (contract, all AI capabilities)

Deterministic learning costs zero tokens (SoT §7.8). AI uses **selective tokens with control guardrails**:
1. **Short system preamble** — role, exit conditions, and required data only (e.g. answer + grading criteria ~100 tokens). Do not inject the full deck or history.
2. **Default `effort=low`** — learning generation and grading do not need deep reasoning. Raise only for hard cases.
3. **Cheaper model first** — config `capabilities.ai.model` (e.g. haiku tier). Falls back to account default if unset.
4. **max_tokens cap** — per capability (hint 80, grading 150, feedback 250, summary 300, etc. recommended).
5. **Conditional no-call (zero tokens)** — skip LLM call when trigger condition is unmet: due=0 → skip reminder / no repeated errors → plain fallback / rule-based logic sufficient (adaptive weight) → no AI call.
6. **Context slicing** — history uses only the most recent N items (wrong answers 3, conversation 4 turns, representative cards 5).

Bot must pass `gating` (layer 4) before calling AI. Show `typing_indicator` during AI calls (not while idle).

---

## 3. AI Mode Plug Interface

AI capability handlers (learning-types layer 3) depend only on `_invoke` (no bridge or global imports). Common skeleton:
```python
async def ai_capability(ctx, card_or_input) -> HandlerResult:   # HandlerResult = SoT §1
    if not should_invoke(ctx): return fallback(ctx)        # conditional no-call (§2.5)
    sys = build_preamble(card_or_input)                    # short preamble (§2.1)
    async with typing(ctx.channel):
        r = await invoke(prompt, system=sys, model=ctx.ai_model,
                         effort=ctx.ai_effort, max_tokens=CAP_MAX, session_id=ctx.sid)
    if not r.ok: return graceful(ctx, r.error)             # AIInvokeError graceful
    return parse_and_render(r.text)                        # cards/webhook render
```
- **`ai_openend_grade` special case (binary grading)**: preamble includes answer and criteria; **force** output as `{"verdict":"correct"|"incorrect","reason":"..."}` JSON. On parse success, pass verdict to Leitner (complies with SoT binary contract). **On parse failure, fall back to self mode** (user self-evaluation). AI must not produce scores or pass probabilities (SoT §7.5).
- producer to consumer: deterministic data (e.g. user-curated lists, memorized items) fed as prompt material → AI generates practice (pipeline, not concurrent parallel).

---

## 4. Multi-turn (Socratic / conversational)

- Multi-turn via `session_id` with `--resume`. **Sliding window** (last 4 turns only as context) = caller's responsibility (token control).
- [OPEN-C] resolved: **session_id is per thread; bot memory is volatile** (new session on bot restart). Unlike progress (store), conversation context is not persisted (v1). Long batch generation is resumed by `driver` using its own state (see below).

### 4.1 Live sessions (opt-in, `bot/live.py`). Rules: L-1..L-6 (6)

Every `invoke` call spawns a process, and on this machine that start costs most of a short call: a review
grade took 4.7-5.9 s per answer that way, against 2.2-3.1 s for follow-ups written to one process that
stays open (measured 2026-10-05, same three answers, sonnet, effort low). A caller that sends many short
turns in a row may therefore ask for a **live** session; everything else keeps one process per call.

| ID | Rule | Why | Test |
|---|---|---|---|
| L-1 | `live: true` on a `/ai` request routes it to `live.invoke_live`; without it nothing changes. The first turn spawns `claude -p` with the same flags as `invoke` (`--session-id` for a new session, `--resume` for a known id the server holds no process for) and keeps stdin open; later turns with that session id are one JSON line written to the same process, read until the `result` line. | Opt-in keeps every existing caller (bot capabilities, probgen, the other web parts) on the proven path. | `test_live_sessions.py` "reuses one process" / "resumes an id it holds no process for" |
| L-2 | One turn at a time per live process (a per-session lock). A turn that times out or is cancelled discards the process, because a half-read stdout would corrupt the next turn; the next request falls back to a `--resume` spawn. | One stdin, one stdout: interleaved turns cannot be told apart. | "a timed-out turn discards the process" |
| L-3 | A process that ends before its `result` line is dropped; when it was a `--resume` spawn and stderr says the conversation is unknown, the reply carries `error_kind: "resume_missing"`, exactly as `invoke` does. A `result` with `is_error: true` is `ok: false`. | Same contract for callers as the per-call path (`_interface-contract.md` §5). With no exit code per turn, `is_error` is the only failure signal. | "ended process is tagged resume_missing", "is_error result fails" |
| L-4 | A live process idle for `LIVE_IDLE_SEC` (600) is closed; at most `LIVE_MAX` (4) live processes exist, and opening one more closes the least recently used idle one. | A review visit is short and the learner leaves the tab without telling the server; the cap bounds memory if tabs are reopened. | "idle processes are closed", "the cap closes the least recently used" |
| L-5 | Closing = close stdin, wait up to 5 s, then kill the whole process tree (`taskkill /F /T` on Windows). Live processes are registered in `session_guard`, so `/sessions` lists them (`kind: "live"`) and server shutdown closes them. | Measured 2026-10-05: `proc.kill()` on a shell-spawned child ends only `cmd.exe`; `claude.exe` survived as an orphan holding the pipes, so even `wait()` hung. Closing stdin ended the whole tree in 2.6 s. | "close_all closes every process" |
| L-6 | The preamble rides only on the first turn of a live process (§1.1); a `--resume` spawn sends the turn as given. | The session already holds the preamble; resending it costs input every turn. | "later turns carry no preamble" |

---

## 5. Batch / Resilience (driver + heartbeat)

- Bulk AI generation/grading uses harness `automation/driver.py` (crash-tolerant, per-key resume, webhook milestones) + `_invoke` (`attempt` callback).
- `driver` progress shown via `progressbar`/webhook. asyncio loop crashes detected by `heartbeat` (layer 4) with a mention alert.
- Tokens: one call per job, serial. Batch jobs also subject to §2 controls.

---

## 6. Errors and Security
- `AIInvokeError` (subprocess failure or timeout) → catch, handle gracefully (fall back to non-AI path, bot stays up). SoT §6.
- No secrets exposed (no tokens or keys in prompts or output). Subscription OAuth is for personal use only (no public or multi-user deployment).
- All AI input paths must pass `gating`.
