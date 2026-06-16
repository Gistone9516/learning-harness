# v5 engine-contract (pure Python core)

> buildflow per-folder contract. **Conforms to SoT (`_interface-contract.md`). SoT is authoritative on conflict.**
> Scope: `engine/` — Leitner, queue builder, scoring core, normalization, dashboard aggregation, migrate. **Fully pure**: zero discord/harness imports, zero file I/O (progress/sidecar file I/O belongs to bot/harness; engine is in-memory only).
> Ported from `_archive_v4/규격/엔진규격.md` + `app.js`. Same semantics, language = Python (snake_case). Types = SoT §1. `now` is injected.
> (G2 applied: fully pure engine, DashboardData entry definitions, pass_targets injection, weight override.)

---

## 1. Leitner Core

### 1.1 Boxes and graduation
- `box ∈ {1..3}`. New cards start at box=BOX_MIN. Intervals = `LeitnerConfig.intervals_days` or defaults.
- **Graduation**: answering correctly (cold) while at `box==BOX_MAX` sets `graduated=True` (box kept, due reset). Graduated cards are still queued when due (not permanently excluded).

### 1.2 Attempt classification
- **cold**: first attempt in the session (once per card_id). **warm**: second or later attempt after re-queuing. Skips also count as attempts (classified and added).
- Classification uses the session-volatile `seen_card_ids: set[str]`. **Before each attempt (before score/verdict is called)**: absent = cold, present = warm — classified **then immediately added** (per bot-contract §4 ordering).

### 1.3 Promotion/demotion (transition table)
Input `(state, attempt_kind, verdict, now, cfg?, dday_mode)` → new `CardProgress` (immutable copy).

| attempt_kind | verdict | box | due_at | graduated |
|---|---|---|---|---|
| cold | correct | `min(box+1, BOX_MAX)` | `now + interval[new_box]*MS_PER_DAY` | True if box was BOX_MAX and answer is correct |
| cold | incorrect | `BOX_MIN` | `now + interval[BOX_MIN]*MS_PER_DAY` | False |
| warm | correct/incorrect | unchanged | unchanged | unchanged |
| cold/warm | skip | unchanged | unchanged | unchanged |

- Box movement only on cold first-attempt correct (immutable). Binary (no partial).
- cold increments `cold_attempts += 1` (regardless of verdict); cold+correct also increments `cold_correct += 1`. skip increments cold_attempts but not cold_correct.
- D-day compression (correct): `due_at = now + min(original_interval, dday_compress_days)*MS_PER_DAY`. Incorrect follows normal logic.
- Graduated card re-transition: cold correct → box=MAX kept, due reset, graduated kept. cold incorrect → normal demotion (graduated → False).

### 1.4 Signatures
```python
def leitner_transition(state, attempt_kind, verdict, now, cfg=None, dday_mode=False) -> CardProgress: ...
def next_due_at(box, now, cfg=None) -> int: ...
def is_due(state, now) -> bool: ...   # now >= state.due_at
```

---

## 2. Queue Builder

### 2.1 Sources
- `new` = `cold_attempts==0` (includes cards with no progress entry). `review` = `cold_attempts>0` and `is_due` (graduated cards that are due count as review). Cards with history but not due are excluded (D-day exception applies).

### 2.2 Priority and weight
Sort keys (high to low): 1) review > new 2) within review: `weight DESC` 3) within new: `weight DESC` 4) **interleaving** (round-robin by unit within due group, priority not broken) 5) tie-break `card_id ASC`.
- **Weight resolution**: use `opts.weight_overrides[card_id]` (sidecar injection, SoT §2.1) if present, otherwise `CardDef.tags.weight`. Normalization: out-of-range or non-integer → clamp to [1,10], NaN/non-numeric → 5.
```python
def build_queue(cards, progress: ProgressStore, now, opts: QueueOptions) -> list[str]: ...   # ordered list of card_ids
# progress = ProgressStore (same type as get_dashboard_data). Card lookup via progress.cards.get(id).
```
- Empty result = `[]`. Orphan progress entries (card not in cards) are excluded from queue, not deleted.

### 2.3 D-day mode
- `opts.dday_mode==True` (bot UI/command injects the verdict; engine does not decide). All boxes + new cards are summoned. Sort: `box ASC -> weight DESC -> unit round-robin -> card_id ASC`. Limit: cut after sorting each group (no carry-over).

---

## 3. Scoring Core

### 3.1 Four modes (all binary)
| mode | input | logic | result |
|---|---|---|---|
| exact | str | normalize then check full match against accepted (OR) | correct/incorrect |
| keyword | str | normalize then check all required_keywords groups satisfied (any-of per group) | correct/incorrect |
| cloze | list[str] | match each blank; all must match to be correct | correct/incorrect |
| self | "correct"/"incorrect" | adopt as-is | correct/incorrect |
- No partial credit. matched/missed are for feedback only.
- **recall_seq**: CardType `recall_seq` is **scored as exact mode** (full match including order per answer_spec.sequence; length mismatch = incorrect). Not a separate ScoreMode (ScoreMode has 4 variants).

### 3.2 Input contract (violation raises `ScoreInputError`)
- exact/keyword: str. cloze: list[str] (len == len(blanks)). self: "correct" | "incorrect". recall_seq scoring uses the exact path with list comparison (sequence).
- Empty input (empty after normalization) = incorrect (no throw). Skip does not call score().

### 3.3 Normalization catalog (9 rules, applied identically to both sides, in order)
| id | behavior |
|---|---|
| `nfkc` | `unicodedata.normalize("NFKC", s)` |
| `trim` | `s.strip()` |
| `collapse_space` | all Unicode whitespace to a single space |
| `strip_all_space` | remove all whitespace |
| `lower` | ASCII lowercase |
| `fullwidth_to_halfwidth` | fullwidth alphanumerics/symbols to halfwidth |
| `unify_cell_dollar` | remove `$` from cell references |
| `unify_arg_sep` | `;` and fullwidth `，` to `,` |
| `strip_trailing_paren` | remove trailing `(...)` |

- **Synonym substitution position (contract, SoT §7.10)**: immediately after `lower`, before comparison. Exact match only (no substring), multi-token phrases are out of v1 scope. (Tokenization approach is implementation-free — contract specifies position and exact-match only.)

### 3.4 Output
```python
def score(inp: ScoreInput) -> ScoreResult: ...
def normalize(s, rules: list[str], synonyms: dict[str,str] | None = None) -> str: ...
```
- cloze matched/missed/highlight_missed = blank index strings. self: user_answer returned as verdict. Deterministic output guaranteed. Does not compute pass rate or pass probability.

---

## 4. Migration (migrate, pure engine)

> **File read/write (load/save) belongs to the bot (harness store.py), not the engine.** Engine only handles version normalization via `migrate` (pure). SoT §2, §3, §7.4.

```python
def migrate(raw: dict) -> ProgressStore: ...   # v(n)->v(n+1) chain, pure, missing fields get defaults
def new_card_progress(card_id: str) -> CardProgress: ...   # create with default values (pure)
```
- New defaults: `{box:BOX_MIN, due_at:0, graduated:False, cold_attempts:0, cold_correct:0, last_attempt_at:None, last_verdict:None}` (due_at:0 = immediately due).
- **v0 (legacy) = v4 ProgressStore shape**: field names in v4 are also snake_case (`card_id, box, due_at, graduated, cold_attempts, cold_correct, last_attempt_at, last_verdict`), making this **near-identity**. v0 to v1 = inject `schema_version` field + fill missing fields with defaults. Future stages are appended to the chain.
- Bot flow: harness store reads JSON, calls `migrate(raw)` to normalize into ProgressStore. On save, forces `schema_version=SCHEMA_VERSION`. Parse failure or migrate exception: bot falls back to empty store and writes `.bak` (SoT §2).

---

## 5. Dashboard Aggregation

```python
@dataclass
class ByAreaEntry:     area: str; subarea: str; retrieval_rate: float | None   # cold_correct/cold_attempts, cold0 -> None
@dataclass
class WeaknessEntry:   area: str; subarea: str; unit: str; wrong_rate: float    # cold incorrect / cold_attempts
@dataclass
class PassPathEntry:   area: str; subarea: str; target: int; coverage: float; mastery: float; progress: float; status: Literal["safe","watch","danger"]
@dataclass
class CompletionEntry: area: str; subarea: str; box_dist: dict; mastery_rate: float   # box_dist={box1,box2,box3}

def get_dashboard_data(deck: DeckData, progress: ProgressStore, now: int,
                       pass_targets: dict[str, int] | None = None) -> DashboardData: ...
```
Pure aggregation (zero file I/O). Only `enabled==True` cards. Missing progress = not studied (cold_attempts 0, box1).
- **by_area** [(area, subarea)]: `retrieval_rate = cold_correct/cold_attempts`, cold0 -> `None`.
- **weakness** [(area, subarea, unit)]: `wrong_rate`, units with cold0 excluded. Sort: `wrong_rate DESC -> unit ASC`.
- **pass_path** [(area, subarea)]: **`target = pass_targets[subarea]`** (injected; no hardcoded subject vocab or thresholds — SoT §7.1). If `pass_targets` is not injected or the subarea key is absent, that group is **excluded from pass_path** (engine does not know the passing bar). `coverage` = cards with cold>=1 / total; `mastery` = among cold-attempted cards, fraction with correct rate >= 1 (**denominator = cards with cold>=1**, 0 if none); `progress = coverage * mastery` (= fraction of all cards mastered). status (t = target/100): `r>=t` safe / `r>=0.7t` watch / else danger. For UI rendering only.
- **completion** [(area, subarea)]: `box_dist` (not studied = box1, graduated = box3); `mastery_rate = box3 / total`.
- Cards without area/subarea: excluded from by_area, pass_path, completion (weakness uses unit-based grouping and includes them; if both are absent they are excluded). Deterministic output guaranteed.
- **`pass_targets` source**: bot boot constructs it from `SubjectConfig.pass_targets` (injection-interface §5) and injects it. Engine only consumes the dict.

---

## 6. Errors (SoT §6)
`ScoreInputError`, `SchemaVersionError`. Recoverable corruption: bot falls back to empty store and writes `.bak` (engine does not throw).

---

## 7. Test Suite (regression ~77, gate 4)

`now` injected for determinism. `pytest`/`unittest` (dev tests are not subject to the zero-dependency constraint).
- **Scoring 4 modes** (~52, ported from v4): exact multi-answer/normalization, keyword binary, cloze blank-count and binary, self pass-through, normalization 9-rule order and synonyms (immediately after lower), recall_seq exact order full match, empty input incorrect, unknown mode.
- **Leitner transition table** (new): cold/warm x correct/incorrect + skip + box boundary + graduation and post-graduation re-transition + accumulation + D-day compression.
- **Queue builder** (new): due-first, weight DESC, weight_overrides applied, interleaving round-robin, tie-break, empty queue, orphan/new, limit, D-day all-boxes.
- **Dashboard** (new): by_area None, weakness descending/exclusion/tie-break, pass_path safe/watch/danger, pass_targets injected/not-injected exclusion, progress=coverage*mastery, completion box1/box3/graduated/mastery_rate.
- **migrate** (new): v0 (no schema_version) to v1 field fill, identity case, future version (throw via bot), near-identity verification.
