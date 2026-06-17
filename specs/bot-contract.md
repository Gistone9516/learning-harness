# v5 Bot Contract (discord.py shell)

> buildflow per-folder contract. **Conforms to SoT (`specs/_interface-contract.md`).** SoT is authoritative on conflict.
> Scope: `bot/` — discord.py Client shell, boot, handler dispatch, session loop, gating, commands, harness wiring, errors.
> Only `bot/` knows discord, harness, and content (SoT §3). Calls engine (pure) via import; uses harness for Discord rendering and file store.
> (G2 applied: Ctx type fix, routing table, effective grade_mode, seen timing, D-day trigger, non-AI summary.)

---

## 1. Shell structure (`bot/`)

```
bot/
├ main.py      ← entry point (.env, mount, boot, Client.run)
├ boot.py      ← content load, validate, compile, registry, progress (harness store + engine.migrate)
├ context.py   ← Ctx
├ session.py   ← session state and loop
├ dispatch.py  ← routing table + capability_id -> handler
├ handlers/    ← per-capability handlers (1:1 with learning-types capability_id)
├ commands.py  ← slash commands and magic words
├ ai.py        ← _invoke adapter (mirrors ai-mode, ~140 lines)
└ harness/     ← copy catalog (copy of root harness/)
```

---

## 2. Boot (SoT §3 implementation)

1. Validate 4 required `.env` keys (missing key blocks startup). Optional keys: USER_LANG (default `ko`), MOUNT.
2. Mount resolution: `argv[1] > .env MOUNT > cwd`.
3. `boot.load(mount)`: load manifest, deck, config; validate injection (`ContentInjectionError` blocks boot). Compile:
   - Normalized profile, synonyms reverse index (`dict[str,str]`), **effective grade_mode map** (`card_id -> grade_mode`, applies `SubjectConfig.scoring_overrides` over `CardDef.grade_mode`), **pass_targets** (for engine §5).
4. Progress: read `<mount>/_state/progress-<deck>.json` via harness store -> `engine.migrate(raw)` -> ProgressStore. Missing or corrupt file falls back to empty store and writes `.bak`.
5. Capability registry (`config capabilities.enabled`; omitted means all core) plus dependency validation (missing = warn + disable). Layer 4 is always wired.
6. discord.py Client (intents) -> `on_ready`: re-register persistent views (§7) + perm_preflight + presence.

---

## 3. Handler dispatch (routing + table, resolves [OPEN-B])

**Card -> capability_id routing (priority, first match top to bottom):**
| Condition | capability_id |
|---|---|
| `grade_mode == self` (any type) | `recall_self` |
| `type == cloze` | `cloze_modal` |
| `type == recall_seq` | `seq_modal` |
| `type == judge` | `mcq_buttons` (options <= 5) / `mcq_select` (> 5) |
| `type in {func, proc}` | `short_modal` |
- If config enables an alternative renderer it takes priority (e.g. `reaction_quick` replaces MCQ with emoji, `quiz_poll` uses poll). Explicit opt-in required.

```python
HANDLERS: dict[str, Handler]            # capability_id -> handler
Handler = Callable[[Ctx, CardDef], Awaitable[HandlerResult]]   # HandlerResult = SoT §1
```
- Layer 4 (gating/event/heartbeat/coalesce/perm/presence/scaffold/dm) is not in HANDLERS — always wired at boot/middleware.

**Ctx (injected into handlers):**
```python
@dataclass
class Ctx:
    channel: Any; user_id: int
    store: ProgressStore; deck: DeckData
    synonyms: dict[str, str]                 # reverse index (conforms to SoT §1)
    grade_mode_of: Callable[[str], ScoreMode]  # effective grade_mode (scoring_overrides applied)
    leitner_cfg: LeitnerConfig | None
    ai_model: str | None; ai_effort: Effort   # SoT §1 Effort (Literal), passed directly to invoke
    sid: str | None
    session: "Session"
    async def emit(self, card_id: str, verdict: Verdict, now: int) -> None: ...  # shared classify + transition + save
```

---

## 4. Session loop (full loop contract)

Session state (in-memory, volatile): `seen_card_ids: set[str]`, `queue`, `requeue`, `idx`.
1. Start: `build_queue(cards, progress, now, opts)` -> `queue`. `opts.weight_overrides` = load sidecar if present.
2. **Present card + classify**: immediately before calling the capability handler for the next card_id (routing §3), compute `attempt_kind = "warm" if card_id in seen_card_ids else "cold"`, then **immediately call `seen_card_ids.add(card_id)`** (engine-contract §1.2 alignment — fixed at presentation time, independent of scoring result).
3. Response and scoring: handler calls `score()` (or self/AI) using effective grade_mode (`ctx.grade_mode_of(card_id)`) and returns `HandlerResult` (verdict, requeue).
4. **Transition + save**: `ctx.emit(card_id, verdict, now)` = `leitner_transition(state, attempt_kind, verdict, now, cfg, dday)` -> `save` via harness store (per deck). skip = verdict "skip" (score not called).
5. **In-session requeue**: if `HandlerResult.requeue` (wrong answer), append to `requeue`. Drain `requeue` before `queue`. Warm results are box-independent.
6. **End**: `queue` and `requeue` drained -> summary (see below) + diagnostic update.

**End-of-session summary (non-AI default):** a Components V2 card (SoT §7.13) showing `total attempts, accuracy, box moves, next due info` (updates digest store), with the closing @mention sent as a separate plain message (a V2 card cannot carry a mention). Replaced by AI journal when `ai_session_summary` is enabled (learning-types layer 3).

**D-day activation:** `/study --dday` or `/dday` toggle sets `opts.dday_mode=True` (or config `capabilities.dday`). Engine does not decide this — bot injects it (engine-contract §2.3).

---

## 5. Gating middleware (always on, layer 4)

- **All** input paths (on_message, slash, button, modal, reaction, poll vote) validate `ALLOWED_USER_ID` on the first line (harness `automation/gating.py`). Channel gating (study channel only). No secret exposure (sensitive file guard).

---

## 6. Commands

- Slash commands (applications.commands, synced on on_ready): `/study` (options: deck, unit, `--dday`), `/review`, `/due`, `/stats`, `/card`, `/concept`, `/settings`, `/help`. autocomplete = deck/unit, ephemeral = hide correct answer.
- Magic words: `중단` / `stop`. Bot labels are fixed English; output language = `.env USER_LANG` (default `ko`).
- Closing mention: @mention on result, decision, error, or stop. No mention mid-session.

---

## 7. Harness wiring

- Copy = `bot/harness/` (copy of root `harness/`, discord-harness procedure). Fill placeholders (CHANNEL / ALLOWED_USER_ID).
- **Persistent view re-registration (required)**: custom_id = `srs:<verdict>:<card_id>`. Call `add_view(PersistentLearnView())` once in `on_ready` so button clicks after restart route to `emit`. **Clicks after bot restart are treated as cold because seen is volatile** (restart resets session — intended behavior, consistent with SoT §2).
- Sidecar (SoT §2.1): confidence, read_pos, elaboration, alert_sent, adaptive_weight are managed by the bot via harness store (engine-independent).
- live/* coalescing sits on top of shared `coalesce_base` (rate limit). Hard constraints: allowlist, no secret exposure, at most 1 edit/second, 1 bot per token, permission scope.
- **Output rendering = Components V2 only (SoT §7.13)**: learner-facing content uses V2 layout cards (`harness/output/cards.py`: `card`/`titled_card`/`container`). `discord.Embed` and `output/embeds.py` are deprecated and unused by the kit (catalog-only). Plain text only for short ephemeral acks and for `@mention` pings (V2 cards cannot carry content/mention, so the ping is a separate plain message).

---

## 8. Errors and survival

- Engine/injection errors (SoT §6) are surfaced on the card (no secrets). `ContentInjectionError` blocks boot. Recoverable corruption = fallback + `.bak`. `AIInvokeError` = graceful degradation. Scheduler/batch death = `heartbeat` mention. Single bot instance.

---

## 9. Tests (smoke, gate ④)

- Boot: mount mock `examples/` -> load, validate, registry OK.
- Session loop: recall_self / mcq / cloze full loop each (present -> classify -> score -> transition -> save -> requeue) green.
- Routing table: type x grade_mode -> capability mapping verified. persistviews custom_id parse -> emit.
- Gating: unauthorized user blocked. (Engine unit tests are in engine-contract §7.)

> Dependency direction (SoT §3): bot -> engine, harness, content. Engine is fully pure (no file I/O, no discord, no harness).
