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
