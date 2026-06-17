# v5 Interface Contract (Core SoT)

> buildflow ② SoT-first output. **Top-level shared contract for the framework.** On conflict, priority: this document > per-folder specs.
> Scope: shared types, global constants, persistence/sidecar schemas, bot-engine-content wiring, capability registry shape, AI adapter, errors.
> Content/config injection details = `injection-interface.md`. Engine function and aggregation entry details = `engine-contract.md`. Both conform to this SoT.
> Runtime = Python 3.11+. Types = pseudo-types (dataclass/TypedDict recommended). Validation = runtime guards. Naming = snake_case.
> (G2 integrity review applied: DashboardData/HandlerResult definitions, sidecar contract, engine fully pure, target injection.)

---

## 0. Terminology and Global Constants

| Constant | Value | Description |
|---|---|---|
| `BOX_MIN` | `1` | Minimum box |
| `BOX_MAX` | `3` | Maximum box (on reaching this, a cold correct answer graduates the card) |
| `BOX_INTERVALS_DAYS` | `{1: 1, 2: 3, 3: 7}` | Box to re-queue interval (days). Overridable via config injection |
| `SCHEMA_VERSION` | `1` | Progress schema version (integer, monotonically increasing) |
| `MS_PER_DAY` | `86_400_000` | Milliseconds per day |
| `DDAY_COMPRESS_DAYS` | `1` | D-day interval compression ceiling in days (default, injectable via config) |

- **Time = epoch ms (integer, UTC).** `now` is injected by the caller (test determinism).
- **Due check**: `now >= due_at` means due (boundary inclusive).
- Constants are core **defaults**. If `LeitnerConfig` (injected) is present, its values take effect (non-renegotiable for the second subject onward).

**.env keys** — 4 required + optional:
- Required: `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_CHANNEL_ID`, `DISCORD_ALLOWED_USER_ID`. (Separate app/token/server from the bridge.)
- Optional: `USER_LANG` (user output language, default `ko`), `MOUNT` (default mount folder). Falls back to defaults if unset.

---

## 1. Shared Data Types (Pseudo-types)

```python
Verdict   = Literal["correct", "incorrect", "skip"]   # score() never produces skip
ScoreMode = Literal["exact", "keyword", "cloze", "self"]
CardType  = Literal["func", "proc", "recall_seq", "cloze", "judge"]
Effort    = Literal["low", "medium", "high"]

@dataclass
class AnswerSpec:
    accepted: list[str] | None          # exact candidates (OR)
    required_keywords: list[list[str]] | None  # keyword. inner list = synonym group (any-of); all groups required
    blanks: list[list[str]] | None      # cloze. blanks[i] = candidates for blank i (0-based)
    sequence: list[str] | None          # recall_seq ordered steps
    normalize: list[str]                # normalization rule id array in order. may be omitted for self

@dataclass
class CardDef:
    card_id: str                        # ^[a-z][a-z0-9-]{2,63}$ (colon forbidden)
    schema_version: int
    subject: str; unit: str
    type: CardType
    grade_mode: ScoreMode               # content default. effective mode is resolved by bot applying scoring_overrides (bot-contract §4)
    front: dict; back: dict
    answer_spec: AnswerSpec | None      # None for self
    tags: dict                          # {weight:int[1,10]=5, area?:str, subarea?:str}
    links: dict                         # {concept_ref?:str}
    enabled: bool

@dataclass
class DeckData:
    namespace: str
    cards: list[CardDef]

@dataclass
class CardProgress:                     # progress (persistence §2). learning algorithm state only (auxiliary state in sidecar §2.1)
    card_id: str
    box: int                            # BOX_MIN..BOX_MAX
    due_at: int                         # epoch ms
    graduated: bool
    cold_attempts: int                  # includes skips
    cold_correct: int
    last_attempt_at: int | None
    last_verdict: Verdict | None

@dataclass
class ProgressStore:
    schema_version: int
    deck_namespace: str
    cards: dict[str, CardProgress]

@dataclass
class ScoreInput:
    mode: ScoreMode
    user_answer: str | list[str] | Literal["correct", "incorrect"]
    answer_spec: AnswerSpec
    synonyms: dict[str, str] | None     # reverse index (synonym -> canonical). bot boot compiles from config and supplies this

@dataclass
class ScoreResult:
    verdict: Literal["correct", "incorrect"]
    matched: list[str]; missed: list[str]
    normalized_user: str | list[str]
    feedback: dict                      # {"highlight_missed": list[str]}

@dataclass
class HandlerResult:                    # return type for learning capability handlers (bot-contract §3/§4)
    card_id: str
    verdict: Verdict | None             # None = presented only / no response. skip = "skip"
    requeue: bool = False               # requeue within session (wrong-answer correction)
    done: bool = True                   # whether interaction for this card is complete

@dataclass
class LeitnerConfig:
    intervals_days: dict[int, int]      # {1:1,2:3,3:7}
    dday_compress_days: int             # default 1

@dataclass
class QueueOptions:
    deck_namespace: str
    dday_mode: bool = False
    new_card_limit: int | None = None
    review_limit: int | None = None
    weight_overrides: dict[str, int] | None = None   # card_id -> weight (injected from sidecar §2.1). falls back to CardDef.tags.weight

@dataclass
class DashboardData:                    # return type for get_dashboard_data. entry types defined in engine-contract §5
    by_area: list                       # ByAreaEntry[]   (engine-contract §5)
    weakness: list                      # WeaknessEntry[] (engine-contract §5)
    pass_path: list                     # PassPathEntry[] (engine-contract §5)
    completion: list                    # CompletionEntry[](engine-contract §5)
```
- Identification fields are `area` + `subarea` (area_id is forbidden). The 4 keys and identification fields are SoT authority. Entry fields = engine-contract §5.
- **SubjectConfig** (normalization profiles, synonyms, scoring mapping, Leitner, **pass_targets**) is in `injection-interface.md §5`. The engine only consumes compiled and injected values.

---

## 2. Persistence Schema (Progress)

- Progress = `<mount>/_state/progress-<deck_namespace>.json` (per deck) under the **mount folder** -> `ProgressStore`.
- Meta = `<mount>/_state/meta.json` -> `{schema_version, created_at, last_opened_at}` (ms).
- `card_id` is the primary key. Colons forbidden in keys/namespace. card_id regex = §1.
- **File I/O owner = bot (harness `automation/store.py`).** Atomic writes (`.tmp` then replace) + `.bak` corruption fallback. Engine core does not perform file I/O (§3).
- **Migration shim**: missing `schema_version` = v0 (legacy) -> migration chain; `> SCHEMA_VERSION` -> `SchemaVersionError`; parse failure = empty store fallback + `.bak` preserved (no throw). migrate (pure) is owned by engine core (engine-contract §4).
- Session state (seen_card_ids, etc.) is not persisted (volatile; bot restart = session restart). `persistviews` buttons are restored via custom_id (bot-contract §7).

### 2.1 Sidecar Storage Contract (Auxiliary State Outside Engine Schema)

Capabilities that need auxiliary state outside CardProgress (learning algorithm state) — such as confidence ratings, read positions, elaboration text, due-deduplication, weight recalculation — use a **sidecar file**. **CardProgress schema must not be polluted** (invariant §7.4).
- Path: `<mount>/_state/sidecar-<capability_id>-<deck_namespace>.json`. Shape: `{card_id: <value defined by capability>}` or `{"_meta": ...}`.
- **Owner = bot (harness store).** Engine core does not know about sidecars (no read or write). Migration is per-capability with default fallback.
- Examples: `confidence` (card_id -> "easy"|"med"|"hard"), `read_pos` (deck -> idx), `elaboration` (card_id -> list[str]), `alert_sent` (card_id -> last_ms), `adaptive_weight` (card_id -> int). The last is injected into buildQueue via `QueueOptions.weight_overrides` (bot loads from sidecar).

---

## 3. Bot / Engine / Content Wiring

**Dependency direction (one-way):**
```
bot/ (discord.py shell)  -->  engine/ (fully pure Python)
       |                 -->  harness/ (copy catalog: Discord I/O, file store)
       └── mount (read) -->  content (consumed via project injection)
```
- **engine/ is fully pure** — input -> verdict/aggregation, **zero side effects or file I/O**. Importing discord or harness is forbidden. (Progress file read/write is done by the bot via harness; only in-memory data is passed to the engine.)
- **Only bot/ knows discord, harness, and content.** It imports engine core to call scoring, Leitner, queue, dashboard, and migrate; uses harness for Discord presentation and file store.
- **Content is data** (not code): manifest, deck, and config files (injection-interface).

**Boot sequence (bot):**
1. Load `.env` (validate 4 required keys; missing keys block startup).
2. Mount = `argv[1] > .env MOUNT > cwd`.
3. Load manifest, decks, and config; validate injection (`ContentInjectionError` blocks boot); compile (normalization profiles, synonyms reverse index, card_id to effective grade_mode map, pass_targets).
4. Read progress JSON via harness store -> version-normalize via `engine.migrate` -> `ProgressStore`.
5. Build capability registry (§4) -> start discord.py Client -> `on_ready`: re-register persistviews + permission check + presence.
- Network = Discord gateway only. AI mode only via `_invoke` (§5).

---

## 4. Capability Registry (Learning Types and Primitives)

```python
@dataclass
class LearningCapability:
    capability_id: str                  # stable id
    layer: Literal[1, 2, 3, 4]
    tier: Literal["core", "extension"]
    primitives: list[str]               # harness files
    engine_fns: list[str]               # dependent engine functions
    needs_ai: bool                      # if True, depends on _invoke (layer 3). must be declared explicitly (no undecided)
    handler: str                        # bot handler identifier (bot-contract dispatch)
```
- Active set = config `capabilities.enabled` (injection-interface §7). layer/tier/primitives/needs_ai = `learning-types.md` authority (each capability holds its confirmed needs_ai value).
- Layer 4 (infrastructure) is always wired as boot/middleware, not as a handler (active regardless of registry enabled state).

---

## 5. AI Adapter Interface (`_invoke`)

AI capabilities (layer 3) depend **only on this adapter** (no discord-bridge dependency; pattern is copied). **This §5 = interface authority; launch details (CLI flags, OS) = `ai-mode.md §1`.**

```python
@dataclass
class AIResult:
    text: str; ok: bool; error: str | None

async def invoke(prompt, *, system=None, model=None, effort: Effort = "low",
                 max_tokens=None, session_id=None, on_stream=None) -> AIResult: ...
```
- `session_id=None` -> one-shot (new session). Specified -> resume that session (multi-turn). Launch command (`claude -p stream-json`, `--session-id`/`--resume`, Windows) = ai-mode §1.
- Token control (contract): short system prompt, effort low by default, max_tokens ceiling, no call when conditions are not met. Details = ai-mode §2.

---

## 6. Error Contract

| Error | When raised | Handling |
|---|---|---|
| `ScoreInputError` | mode/user_answer type mismatch, cloze blank count mismatch, self disallowed value, unknown grade_mode, colon in key | throw |
| `SchemaVersionError` | stored version > code version | throw, abort load |
| `StorageError` | file write failure, quota exceeded | throw, recommend export |
| `ManifestMissingError` | manifest absent at mount | throw, boot failure |
| `DeckNotFoundError` | requested namespace not registered | throw |
| `ContentInjectionError` | injected content/config schema violation | throw, block boot |
| `AIInvokeError` | `_invoke` failure or timeout | catch, graceful fallback |

- Recoverable corruption (parse failure, migrate exception) = fallback + `.bak` (no throw). No secrets exposed.

---

## 7. Conflict Priority and Invariants (Checklist)

**Priority:** this SoT > per-folder > content/config. Per-folder conforms to SoT.

**Invariants (no contradiction allowed):**
1. **Subject-agnostic** — no subject vocabulary, content, or hardcoded thresholds in engine, harness, or bot (pass_targets and all others must be injected).
2. **Copy model** — zero discord-bridge imports, invocations, or calls. Only harness copy + `_invoke` pattern copy.
3. **Bot isolation** — separate Discord app, token, and server. One bot per token.
4. **Engine vs harness boundary** — learning algorithm (scoring, normalization, Leitner, interleaving, queue, dashboard, migrate) = engine core **fully pure**. Discord I/O and progress/sidecar file storage = harness (called by bot). Engine core has zero file I/O, discord, or harness imports.
5. **Binary scoring** — correct/incorrect binary only (no partial credit, pass probability, or auto-scoring output).
6. **Box advancement = cold first-attempt correct only.** Warm attempts and skips are ignored.
7. **card_id stability** — author-assigned stable id; unchanged on content edits; not a content hash.
8. **Deterministic = zero external calls** — layer 1, 2, 4 have zero external calls. Only layer 3 (AI) uses `_invoke`. (Deterministic rule parts = layer 1/2; AI-suggestion parts only = layer 3.) Automated or periodic features (scheduler, SRS due push) are token-0 by default; any AI inside them is opt-in and condition-gated via `should_invoke` (for example, skipped when due == 0), never an unprompted self-driven loop.
9. **Schema version + migration shim** from v1. CardProgress schema must not be polluted (auxiliary state = sidecar §2.1).
10. **Synonym substitution point** = immediately after normalization lower, immediately before comparison.
11. **Canonical kit, clone-and-customize** — this repo is the canonical template and is never mutated by a consumer. A consumer adopts the kit one of two ways and customizes only its own side: (a) **mount model** — run `bot/main.py` from the fixed kit and mount the consumer content folder (launch-skill §1); (b) **clone model** — `tools/clone.py` copies the core kernel plus only the enabled capabilities into the consumer's own copy, which then runs standalone. Kit changes happen only in this repo; consumers pull them by re-cloning. The consumer's content (manifest, decks, config, `_state`) is never touched by the kit.
12. **Secrets and access** — the bot token and other secrets live only in the APP `.env` (gitignored); they are never printed, echoed, logged, or attached, and config is cited by path and field name, not value. Every command and interaction is gated to the allowed user(s); sensitive files (`.env`, keys, state) are never shown or attached. Personal use, one bot instance per token. When permissions or scope are incomplete the bot degrades gracefully: core chat and grading keep working, advanced features disable with a warning.
13. **UI = Components V2 only** — learner-facing content is rendered with Components V2 layout cards (`harness/output/cards.py`: `card`, `titled_card`, `container`); `discord.Embed` and `output/embeds.py` are deprecated and not used by the kit's output (catalog-only). Plain text is allowed only for short ephemeral acknowledgements and for `@mention` pings, because a V2 card cannot carry message content or a mention, so the ping is a separate plain message.

---

## 8. [OPEN] Resolution Log
- [OPEN-A] Progress file = per-deck JSON (§2). [OPEN-B] Capability handler = dispatch table (bot-contract §3). [OPEN-C] AI session_id = per-thread, volatile (ai-mode §4). All resolved in per-folder specs.
