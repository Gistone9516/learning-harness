# Web Contract (Web SoT)

> buildflow ② per-folder contract. **Conforms to the core SoT (`_interface-contract.md`); on conflict the core SoT wins.**
> Scope: `web/` — the frontend kit (Vite + vanilla TypeScript). This is the shared interface every web module/part conforms to: the part standard, the `ai_server` HTTP boundary, deterministic-grade reuse, subject injection, and the progress store.
> Plans (intent): `docs/기획_web.md` (frame + sheet + codeproj), `docs/기획_개념문제킷.md` (concept-problem). On conflict, this spec is authority over the plans.
> Module-specific contracts: `web-sheet.md`, `web-codeproj.md`, `web-conceptprob.md` (each conforms to this Web SoT).

---

## 0. Conformance and invariants

Inherits the core SoT §7 invariants. Restated for the web layer (machine-checkable where possible):

1. **Subject-agnostic** — zero subject literal in `web/` code (areas, persona, task wording, UI copy, content all injected via subject config). Guarded by a test (`web/tests/subject_agnostic`, §8).
2. **Canonical kit (§7.11)** — one web code copy; subjects differ only by injected data/config. No per-subject fork.
3. **Secrets and gating (§7.12)** — no secret in the web bundle. AI only via `ai_server` with a token the bundle never embeds. Personal use.
4. **Deterministic = token 0 (§8)** — sheet formula evaluation, code-structure navigation, and answer grading run client-side with zero AI calls. AI (generation, explanation, open-ended) is opt-in and goes through `ai_server`.
5. **Binary grading (§7.5)** — graded answers reduce to `correct | incorrect` via the engine grader; no partial credit.
6. **Reuse core types** — `CardDef`, `AnswerSpec`, `ScoreMode`, `Verdict` are reused verbatim (core SoT §1). The web does not invent a parallel problem schema.

---

## 1. Part standard and catalog

Mirrors the Discord `harness` model: a catalog of self-contained, opt-in parts.

- A **part** is a self-contained module at `web/parts/<id>/` (own TS + CSS, minimal deps). Nothing runs until the app shell registers it.
- **Header standard** (top-of-file doc comment, every part entry file):
  `WHAT` (one line) · `DEPS` (libraries + other parts) · `INPUT` (injected data shape it consumes) · `EVENTS` (results/progress events it emits) · `AI` (does it call `ai_server`, and how) · `CONSTRAINTS` (which §0 invariants it must observe) · `DEMO` (how to run it standalone).
- **Catalog index** `web/parts/index.json` (machine-readable):
```ts
type PartEntry = {
  id: string;            // matches the parts/<id>/ folder
  dir: string;           // "parts/<id>"
  entry: string;         // entry file, e.g. "parts/<id>/<id>.ts"
  what: string;
  deps: string[];        // npm libs + part ids
  ai: boolean;           // true if it calls ai_server
  constraints: string[]; // invariant ids it observes, e.g. ["subject-agnostic","token0"]
};
type PartsIndex = { version: number; parts: PartEntry[] };
```
- **Enablement** — the app shell enables only the parts named by the subject config's enabled list (the web analog of `bot/capability_registry`). A part whose files are absent must fail loudly at load, never silently.

---

## 2. `ai_server` HTTP boundary

The web reaches the claude subscription only through `bot/ai_server.py` (built and verified: local + public-tunnel round trip). This section is the wire contract; `ai_server.py` is its reference implementation.

**Endpoints**
- `GET /health` — no auth. → `200 {"ok": true, "service": "ai_server"}`. For tunnel/liveness probes.
- `OPTIONS /ai` — CORS preflight. → `204` with CORS headers.
- `POST /ai` — token-gated. The single AI entry point.

**Auth** — every `POST /ai` carries the shared token in `Authorization: Bearer <token>` or `X-AI-Token: <token>`. Missing/wrong → `401`. The token comes from the server's `AI_SERVER_TOKEN`; the web client obtains it out-of-band (config fetched at runtime from a non-committed local source, or a dev prompt) and **never** ships it in the bundle.

**Request body**
```ts
type AiRequest = {
  prompt: string;                 // required, non-empty
  system?: string;                // optional preamble
  model?: string;                 // default = server/ctx model (claude-opus-4-8[1m])
  effort?: "low"|"medium"|"high"; // default "low"; web modules pass "medium"
  session_id?: string|null;       // null/absent = new session; a prior id = --resume
};
```

**Response body** (`200`)
```ts
type AiResponse = {
  ok: boolean;
  text: string;
  session_id: string|null;        // the effective session id; store it to --resume later
  error: string|null;
};
```
- Failure of the underlying call is reported as `ok:false` with `error` (HTTP still `200`); transport/auth/shape errors use `401`/`400`/`404`/`500` with `{"ok":false,"error":...}`.

**Session lifecycle (load-once, then resume)** — the cost lever for codeproj/conceptprob:
1. First call sends `session_id: null` and the heavy content (generate the project / concept+problems). The whole content is now in that claude session's context.
2. The response's `session_id` is stored by the web client.
3. Subsequent calls (click-to-explain, deepen) send that `session_id` → `--resume`, so only the small targeted ask is added; the content is not re-sent by the client.
4. The session is volatile (no server persistence); a new generation starts a new session. The web client owns the id for the lifetime of that artifact view.

**Config (server env / `.env`)** — `AI_SERVER_TOKEN` (required; server refuses to start without it), `AI_SERVER_HOST` (default `127.0.0.1`), `AI_SERVER_PORT` (default `8765`), `AI_SERVER_ORIGIN` (CORS, default `*`; token gates regardless). Remote access is via a tunnel in front of the local bind only.

---

## 3. Deterministic grading reuse (client-side, token 0)

Graded answers are scored on the web with **zero AI calls**, reusing the engine's logic.

- **Source of truth = the engine** (`engine/scoring.py` `score`/`normalize`, pure). The web ships a **TypeScript port** (`web/src/grade/` or a part's `grade.ts`) of `normalize()` and `score()` for the deterministic modes.
- **Parity guard (required)** — a golden-vector test (`web/tests/grade_parity`) feeds the **same vectors used by `engine/tests/test_scoring.py`** through the TS port and asserts identical `Verdict`. CI/dev fails on any divergence. The port is never edited without updating both sides against the vectors.
- **Modes** — `exact`, `keyword`, `cloze` are graded by the port (deterministic). `self` = manual learner judgment (no port). `judge` = `exact` against `accepted`. Normalization rule ids and the synonym-substitution point (core SoT §7.10) match the engine exactly.
- **Input** — the port consumes `AnswerSpec` (core SoT §1) and a learner answer, returns a binary `Verdict` plus matched/missed for feedback. Problems carry a `CardDef`-compatible `answer_spec` (generated by AI or injected); grading never calls AI.

> Alternative considered: a token-0 deterministic-grade endpoint on the bot. Rejected for v1 because it would force the bot to run even for deterministic study; the TS port keeps the web self-standing (frame decision). The parity guard contains the drift risk.

---

## 4. Subject injection (config → web)

The web consumes the **same injection source** as the bot (injection-interface), staying subject-agnostic.

- The app loads a **SubjectProfile-equivalent** from the subject's `config` (the web analog of `bot/subject.py`): `areas` taxonomy `[{key,label,icon?,aliases?}]`, `persona`, AI `tasks` templates (e.g. concept-generation, project-generation roles/wording), `output_lang` (default Korean), and the enabled parts list.
- `areas` drives the concept-problem index (§ web-conceptprob). All learner-facing copy and domain wording come from config; web code carries none.
- Problems/content data (where injected rather than generated) follow `CardDef` (core SoT §1).

---

## 5. Progress store (localStorage, v1)

- **Scope** — browser `localStorage`, namespaced per subject. No engine/`_state` sharing in v1 (decoupled by decision; hybrid is backlog).
- **Key scheme** — `lh:<subject>:<module>:<rest>` (e.g. `lh:demo:conceptprob:<area>/<concept>`).
- **Record** — binary results plus light module state:
```ts
type ProgressRecord = {
  module: string;            // "sheet" | "codeproj" | "conceptprob"
  item_id: string;           // problem/card id (or file/section id for read flags)
  verdict?: "correct"|"incorrect"|"skip";
  read?: boolean;            // e.g. concept-read or file-seen flag
  ts: number;                // epoch ms
};
```
- Writes are idempotent per `item_id`; aggregates (per area/concept mastery) are derived, not stored redundantly.

---

## 6. AI generation contract (shared shape)

Modules that generate content do one `POST /ai` with `effort:"medium"`, model `claude-opus-4-8[1m]`, and (when structured) a `force_json`-style system directive. The **generated problems carry a `CardDef`-compatible `answer_spec`** so the deterministic grader (§3) can score them with zero further AI. Per-module return schemas (project tree, concept+problems, etc.) are defined in the module specs. The safety preamble and `output_lang` discipline (bot `ai_caps.build_preamble`) apply to every call.

---

## 7. Errors and graceful degradation

- `ai_server` unreachable or `ok:false` → AI features (generation, explanation, AI-graded) disable gracefully with a visible notice; deterministic features (formula eval, navigation, deterministic grading) keep working.
- Token misconfigured → surfaced as a setup error; the token value is never shown.
- A missing/disabled part → the shell hides it; enabling a part whose files are absent fails loudly at load.

---

## 8. Tests (gate)

- `grade_parity` — TS grader vs engine golden vectors, identical verdicts (§3).
- `subject_agnostic` — no subject literal in `web/` code (§0.1).
- `parts_index` — every `parts/<id>/` has a header-standard entry and an `index.json` row; ids match.
- `ai_client` — request/response shape, token header, session_id round-trip (against a mock `/ai`, no live claude).
