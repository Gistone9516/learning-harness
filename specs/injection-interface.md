# v5 Injection Interface Spec

> buildflow per-folder contract. **Conforms to `_interface-contract.md` (SoT).** SoT is authoritative on conflict.
> Scope: how a consuming project **supplies content and config** (framework/consumer boundary). This repo has no real subjects (mock only).
> Format = JSON files (data, not code). md-to-JSON build helper is optional (backlog); the contract is in JSON form.

---

## 1. Mount Content Folder Structure

Content folder of the consuming project (mounted by bot, SoT §3 boot):
```
<mount>/
├ manifest.json              ← subject/deck registry (§2)
├ decks/
│   └ <deck_namespace>.json  ← cards per deck (§3)
├ config/
│   └ <deck_namespace>.json  ← subject config: normalization, synonyms, scoring map, leitner, capability activation (§5, §7)
├ _state/                    ← created by bot (progress, SoT §2). consumer does not create this
└ (optional) src/            ← consumer tools such as md-to-JSON build scripts (not part of contract)
```
- `deck_namespace` must not contain colons (Korean characters allowed). Keys must match across manifest, decks, and config.

---

## 2. manifest.json

```jsonc
{
  "schema_version": 1,
  "subject": "<subject_id>",          // subject identifier
  "decks": [
    {
      "namespace": "<deck_namespace>",
      "title": "display name",
      "card_count": 42,               // count at build time (for validation)
      "config_ref": "config/<deck_namespace>.json",  // subject config path (optional; core defaults apply if absent)
      "built_at": 1718000000000       // epoch ms
    }
  ]
}
```
- Bot reads manifest to discover available decks. Raises `ManifestMissingError` if absent (SoT §6).

---

## 3. deck JSON (cards)

```jsonc
{
  "namespace": "<deck_namespace>",
  "cards": [ CardDef, ... ]            // CardDef = SoT §1
}
```
**CardDef authoring (JSON)** — SoT §1 fields. Nested structure required (flat serialization forbidden):
```jsonc
{
  "card_id": "nlp-lda-define-01",     // ^[a-z][a-z0-9-]{2,63}$, no colons, stable id
  "schema_version": 1,
  "subject": "<subject_id>",
  "unit": "<unit_id>",
  "type": "func|proc|recall_seq|cloze|judge",
  "grade_mode": "exact|keyword|cloze|self",
  "front": { /* per type, see §4 */ },
  "back":  { "detail": "...", "note": "...", "why": "..." },   // all optional
  "answer_spec": { /* §4; null if self */ },
  "tags": { "weight": 5, "area": "...", "subarea": "..." },     // weight [1,10] default 5, area/subarea optional
  "links": { "concept_ref": "<ref_id>" },                      // optional
  "enabled": true
}
```

---

## 4. Card authoring (front / answer_spec per type)

| type | grade_mode (recommended) | front keys | answer_spec |
|---|---|---|---|
| `func` | exact or self | `{prompt, hint?}` | `{accepted:[...], normalize:[...]}` |
| `proc` | keyword or self | `{prompt, hint?}` | `{required_keywords:[[...],...], normalize:[...]}` |
| `recall_seq` | exact or self | `{prompt}` | `{sequence:[...], normalize:[...]}` (exact match with order) |
| `cloze` | cloze or self | `{text}` (markers `{{0}}`,`{{1}}`...) | `{blanks:[[...],...], normalize:[...]}` (0-based) |
| `judge` | exact or self | `{scenario, options:[...]}` | `{accepted:[correct option], normalize:[...]}` |

- **self cards**: `answer_spec=null` (app holds no answer; user self-grades). `grade_mode="self"`.
- Mapping violations (e.g. type is cloze but blanks missing) are rejected at load time (§6).
- Extra keys in `front`/`back` (supplementary notes, image URLs, etc.) are allowed (bot ignores or renders them). `answer_spec` must be an object; flat keys are forbidden.

---

## 5. SubjectConfig (config/<deck>.json)

Subject-specific. Engine stays clean: all content vocabulary and spacing is injected here (SoT §1 LeitnerConfig, normalization, synonyms).
```jsonc
{
  "normalize_profiles": {              // default normalization rule id array per type (used when card does not specify)
    "func":  ["nfkc","trim","collapse_space","lower"],
    "proc":  ["nfkc","trim","collapse_space","lower"],
    "cloze": ["nfkc","trim","strip_all_space","lower"]
  },
  "synonyms": {                        // canonical -> [synonyms...] (engine compiles reverse index; substituted right after lower)
    "함수": ["function","펑션"]
  },
  "scoring_overrides": {               // (optional) override grade_mode for specific card_id
    "nlp-xx-01": "keyword"
  },
  "pass_targets": {                    // (optional) pass-path targets. subarea -> target score [integer]. excluded from pass_path aggregation if absent
    "<subarea>": 70
  },
  "leitner": {                         // (optional) LeitnerConfig. core defaults apply if absent (SoT §0)
    "intervals_days": { "1": 1, "2": 3, "3": 7 },
    "dday_compress_days": 1
  }
}
```
- **scoring_overrides**: bot boot compiles a `card_id -> effective grade_mode` map (applying overrides over CardDef.grade_mode) and supplies it to handlers via `Ctx.grade_mode_of` (bot-contract §3, §4). Engine only sees ScoreInput.mode.
- **pass_targets**: injected via engine-contract §5 `get_dashboard_data(pass_targets=...)`. All subject vocabulary and thresholds go here (no hardcoding in engine; SoT §7.1). subarea classification (e.g. written/practical) is irrelevant — only score targets are mapped.
- Normalization rule id catalog (9 kinds) is authoritative in `engine-contract.md §3.4`. Config lists ids only.
- synonyms are written as `{canonical:[synonyms]}`. Bot boot compiles a `{synonym:canonical}` reverse index and supplies it to the engine (SoT §1 ScoreInput.synonyms).

---

### 5.1 SubjectProfile (areas + AI task injection)

The kit is subject-agnostic; a subject's shape is injected here and compiled into a `SubjectProfile`
(`bot/subject.py`). Kit code (`bot/`, `engine/`) must contain **no subject literal** — guarded by
`bot/tests/test_subject_agnostic.py`. All subject wording lives in config.

```jsonc
{
  "areas": [                                  // catalog area taxonomy (omit if the subject has no areas)
    { "key": "vocab", "label": "단어", "icon": "📚", "aliases": ["어휘"] }
  ],
  "capabilities": {
    "ai": {
      "persona": "...",                       // short identity clause, auto-injected into EVERY AI preamble
      "tasks": {                              // per-capability overrides of generic, subject-neutral defaults
        "practice": { "role": "...", "grader_role": "...", "modal_title": "...", "modal_input_label": "...", "problem_prefix": "..." },
        "convo":    { "role": "...", "thread_title": "...", "seed_hint": "..." },
        "explain":  { "role": "..." }
      }
    }
  }
}
```
- `areas` drives `/level` choices, the control panel, and per-area level state. `key` is the stable id
  (matches `CardDef.tags.area`); `label`/`icon`/`aliases` are display/input only.
- The subject **identity** is carried by `persona` (always injected), so default task `role`s describe only
  the task, never a subject. The practice generator receives the area via the data slice, so one
  `practice.role` covers every area.
- Any omitted `tasks` key falls back to the generic default in `bot/subject.py`. Provide overrides only
  where the subject needs specific wording (e.g. a different task type or UI label).

---

## 6. Validation (load-time, `ContentInjectionError`)

Bot boot (SoT §3 step 3) validates injected content; violations raise `ContentInjectionError` and **block boot** (prevents misgrading):
- card_id regex + uniqueness within deck. No colons in card_id or namespace.
- `subject`, `unit`, `enabled` required. `type`/`grade_mode` must be valid enum values.
- type-to-front key consistency (e.g. cloze requires `text` + markers; judge requires `options`).
- answer_spec consistency: exact->accepted>=1 / keyword->required_keywords>=1 group / cloze->blanks (blank count == marker count) / recall_seq->sequence>=1 / self->null.
- normalize rule ids must exist in catalog (9 kinds).
- manifest `card_count` vs actual card count (mismatch = warning).
- config synonyms and normalize_profiles shape.
- **First line of defense is the build/injection phase.** Runtime falls back gracefully to avoid crashes (static app uptime is priority) — but injection validation failure blocks boot (never reaches runtime).

---

## 7. Capability Activation (which capabilities to enable)

Consuming project selects from the 4-tier capability registry (SoT §4) via config (subtraction aesthetic = consuming app):
```jsonc
{
  "capabilities": {
    "enabled": ["recall_self","mcq_buttons","cloze_modal","srs_due_alert","dashboard_live"],
    "ai": { "enabled": ["ai_openend_grade","ai_hint"], "model": "<low-cost model id, e.g. haiku tier>", "effort": "low" }
  }
}
```
- If `enabled` is not specified, all core tier capabilities are active (default). extension and ai require explicit opt-in.
- `capability_id` authority is `learning-types.md`. Unknown ids raise `ContentInjectionError`.

---

## 8. Mock Examples (`examples/`)

Minimal deck for development and validation (not a real subject). For thin-slice use (spec §10):
```
examples/
├ manifest.json              // subject "demo", one deck "demo-core"
├ decks/demo-core.json       // 1-2 cards each of func/cloze/judge/self
└ config/demo-core.json      // minimal normalization profile
```
- Bot regression/smoke tests use this mock to verify the full loop (prompt -> input -> grade -> Leitner -> save -> re-prompt).
