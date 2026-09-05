# Web Module — Project Code Comprehension (`web-codeproj`)

> buildflow ② per-folder contract. **Conforms to `web-contract.md` (Web SoT) and the core SoT; on conflict the Web SoT, then the core SoT, win.**
> Scope: `web/parts/codeproj/` — top-down comprehension of an AI-generated project. The learner reads the whole codebase and learns where to change things; no authoring, no execution. Plan: `docs/기획_web.md` §2 module ②.

---

## 0. Conformance and shape

- **Comprehension, not execution** — v1 has no code sandbox. The learner reads; AI explains. (A sandbox is backlog.)
- **AI-centric** — project generation and explanations go through `ai_server` (Web SoT §2); navigation and rendering are token 0.
- **Session load-once → resume** (Web SoT §2 lifecycle) is the cost model: generate the project once (codebase enters the session context), then each click resumes that session for a small targeted explanation. The instance names the model; the kit does not. Generation runs at `xhigh` and everything else at `medium`. Project scale is the difficulty knob and the natural ceiling.
- Subject-agnostic: topic/scale/seed are injected or user-chosen; the part carries no subject literal.

---

## 1. Project generation contract

One `POST /ai` (force_json) generates a coherent project and seeds the session.

**Input** (web → `/ai`):
- `system`: generator role (from config `tasks.codeproj`, subject-agnostic) + the §6 JSON directive.
- `prompt`: `{ topic, scale, seed? }` rendered to text — `topic` (what the project does), `scale` (difficulty, §4), optional `seed` (constraints/stack).
- `session_id: null` (new session), `effort:"xhigh"`, model from the instance config.

**Return** (parsed from `text`):
```ts
type ProjectFile = { path: string; content: string; lang?: string };  // lang for highlighting
type GeneratedProject = {
  title: string;
  summary: string;            // one-paragraph overview of the whole project
  files: ProjectFile[];       // the full codebase (paths form the tree)
  entrypoints?: string[];     // suggested reading order (file paths)
};
```
- The web stores the response `session_id`; the codebase is now in that session's context.
- The web builds the left tree from `files[].path`. No file is fetched again from AI; the content is already in `files`.

---

### 1.1 Generation quality clause (mandatory)

The generator preamble carries a fixed quality clause (`prompts.ts` `QUALITY_CLAUSE`), because the learner is reading this code *to learn from it*: code that teaches bad habits fails the module's purpose. It requires the generated project to imitate how professionals ship software in the chosen stack (conventional layout, naming, config separated from code, error handling, validation, logging, a test file, a README), to keep layers apart (entry point / domain / storage / config), to persist data as one record per file behind an index rather than appending to one growing file, and to avoid toy or textbook-abridged code. The clause is subject-agnostic; topic, scale and stack always arrive as injected input.

---

## 2. Explanation contract (click → resume)

Clicking a file, a symbol, or a line range requests a targeted explanation from the **same session** (so the codebase is not re-sent).

**Request** (web → `/ai`): `session_id` = the project's id; `effort:"medium"`; `prompt` names the target and the lens:
```ts
type ExplainRequest = {
  target: { path: string; symbol?: string; lines?: [number, number] };
  lens: "overview" | "libs_methods" | "flow" | "modify_tip" | "concepts";
};

/** The learner's own question about the same target. Same resume path, same cost model. */
type AskRequest = {
  target: { path: string; symbol?: string; lines?: [number, number] };
  question: string;      // passed through verbatim
};
```
- `overview` what this file/part does; `libs_methods` libraries/methods used and why; `flow` how it is called from input to output; `modify_tip` if you wanted to change this, what to touch.
- **`concepts`** answers in a fixed four-part shape — concept definition, general application, industry practice, how it is used in *this* project — so a line of code connects to the idea behind it. The prompt caps the third part at widely documented practice and forbids asserting unverified internals of a named company (hallucination guard).
- **Line selection**: when the learner selects a line range in the code panel, `lines` is set and the quoted source of exactly that range is included, so the model sees the same thing the learner pointed at.
- **Response**: `text` (Markdown, in `output_lang`), appended to the AI pane as one entry. Graceful on `ok:false` (a readable message, never a throw).

---

## 3. UI — three panes, IDE shape

- **Left, files**: file/folder tree (from `files[].path`), collapsible, with a read marker per file and a seen/total counter.
- **Centre, code**: read-only code with line numbers. Clicking a line selects it, shift-clicking extends the range; the selection is the target for §2. Clearing the selection returns the target to the whole file.
- **Right, AI**: lens picker plus explain button, a thread of exchanges (explanations and questions in order), and a free-form question box at the bottom. With no session the pane is hidden entirely rather than left as dead controls, and reading keeps working.
- Panes stack into one column on narrow screens. Korean UI from config/defaults (subject-agnostic).

**Module layout** (one concern per file, so the view can change without touching prompts or transport): `model.ts` pure types/parse/tree, `prompts.ts` all wording including the quality clause and lens formats, `session.ts` the three AI calls, `view.ts` the three panel factories, `launcher.ts` the proposal and archive entry screen, `components/` the composed-answer block system (§3.2), `codeproj.ts` assembly plus the public surface.

### 3.1 Code rendering — highlighting and scrap

- **Syntax highlighting is dependency-free and lives in `web/src/highlight`**, shared by every part; `parts/conceptprob/highlight.ts` is a re-export of it, not a second implementation. No CDN, because the tool must work offline.
- Five token classes only (keyword, string, comment, number, call). More classes means more colour and less legibility.
- **Selection and syntax occupy different layers**: selection paints the background, syntax paints the glyphs, so neither can hide the other.
- **Scrap**: several non-adjacent ranges, possibly across files, can be collected into one explanation target. The scrap set is what §2 sends; clearing it returns the target to the current file.

### 3.2 Composed answers — the block system

An explanation is not free prose. The model returns `{blocks: [...]}` and the renderer draws each block; a block type it does not know **degrades to plain text and is never dropped silently**.

- `components/types.ts` is the type SoT: `KNOWN_BLOCKS` is the closed list the renderer handles — 24 types covering the 25 catalogue entries, since an inline and a block code reference are one `ref` type separated by the optional `lines` field.
- `components/parse.ts` parses tolerantly (a malformed block becomes text, never an exception); `components/render.ts` builds the DOM; `components/catalog.ts` carries the per-type label and assembly rules.
- Blocks that point into code (`ref`, `focus`, `related`, `next`) navigate the centre pane; that is the whole reason the system exists, so those types must keep working when a renderer changes.

---

## 4. Difficulty = project scale

- A `scale` parameter maps to generation targets (this is the red-pen detail): e.g. `small` ≈ 3–6 files / ≤ ~300 lines; larger tiers increase file count and total lines, bounded by the 1M context window and per-call token budget.
- Scale is the only difficulty axis in v1 (more files, more cross-file flow to trace).

---

## 5. Progress and (fast-follow) scored tasks

- v1 is exploratory: optionally store `read`/seen flags per file (Web SoT §5) so the learner tracks coverage. No binary grade in v1.
- **Fast-follow (backlog)**: scored comprehension tasks — "to change X, which file/function?" The learner points at a file/symbol; graded **deterministically** by comparing to a known answer pointer (token 0). The answer pointer is produced at generation time alongside the project (a `tasks` array with `answer: {path, symbol}`), so grading needs no AI.

---

## 6. JSON directive (generation)

The generator system preamble forces the §1 `GeneratedProject` JSON only (no prose outside it), in addition to the shared safety preamble and `output_lang` (code stays code; `summary`/comments may be localized per config). Parse tolerantly (strip fences); on parse failure, show a regenerate action (no partial project).

---

## 7. Part header and index

`web/parts/codeproj/codeproj.ts` header (Web SoT §1):
- `WHAT` AI-generated project, read-only comprehension with session-based click explanations.
- `DEPS` shell + `web/src/ai` (ai_server client) + `web/src/highlight` (own highlighter; no third-party editor, no CDN) + `web/src/storage` (record store port).
- `INPUT` `{topic, scale, seed?}`; consumes `GeneratedProject`, plus the three injected layers
  `annotations` (AnnotationSet), `concepts` (ConceptSet) and `traces` (TraceSet) — rendered, never
  stored here, because every record is keyed by a project id only the flow holds.
- `EVENTS` file-seen flags; `onAnnotations` / `onConcepts` / `onTraces` hand each layer back to the
  owner as it is built (and, fast-follow, scored-task verdicts).
- `AI` yes — generation (`/ai` new session) + explanations (`/ai` resume).
- `CONSTRAINTS` `subject-agnostic, secrets-gated, session-resume`.
- `DEMO` standalone with a canned `GeneratedProject` (no live AI) for the tree + viewer + lens UI.
Add the matching `web/parts/index.json` row (`ai: true`).

---

## 8. Tests (headless, gate)

- `project_model` — parse a canned `GeneratedProject`, build the tree from paths, file lookup.
- `explain_request` — `ExplainRequest` → request shape carries `session_id` and lens; resume path asserted against a mock `/ai` (no live claude).
- `subject_agnostic` — no subject literal in `parts/codeproj/`.
- Generation/explanation quality is live-smoke only (needs the real model), not a unit gate.

## 개념 문서 (FR-23)

The part carries a second AI-written layer beside the annotations: concept documents about what
the generated codebase teaches, read in a `개념` view that shares the study grid.

- **Two calls.** An outline (`buildConceptOutlineSystem`) returns seeds only; each document is its
  own resumed call (`buildConceptDocSystem`). One call for a whole set is far past the 180s
  follow-up cap. Measured 2026-09-03 on a 9-file project: outline 12.2s for 8 concepts, one
  document 33.0s for 2,088 characters.
- **Background, after entry.** Unlike the annotation pass this does not gate the learner. Notes
  attach to the code being read and are needed immediately; a concept page is elsewhere on screen.
- **`effort: "medium"`**, like every other resumed call. Generation stays the only `xhigh` one.
- **The document dialect is `src/doc`**, shared verbatim with conceptprob — same `DOC_DIALECT` in
  the prompt, same `parseBody`, same `renderBlock`. What is not shared: `problems`, grading, tiers,
  and every exam literal. A subject with no exam behind it must not carry that structure.
- **Ids are content, not storage.** `concept_id` must satisfy `^[a-z0-9][a-z0-9-]{0,63}$`; a seed
  that fails it is dropped rather than repaired, because a repaired id no longer matches the one
  the model uses when it writes that document.
- **The set is emitted per document**, not once at the end, and the record is replaced whole each
  time. Reopening an archived project reads it and makes no call.
- **`mountCodeproj` returns a handle** (`setView`, `hasConcepts`). The view tabs belong to whoever
  owns the surrounding chrome; the part owns only the panels.

## 디버그 실행 (FR-24)

A third AI-written layer: a step-by-step walkthrough of where control goes from a line the learner
picks, replayed locally. **The code does not run.** Nothing in the browser can execute a generated
FastAPI project, so this is the model's *prediction* of an execution order — which is why the popup
carries a standing `예측` label and why every name in `trace.ts` says trace and none says execution.

- **Legs, one file each.** A leg restates one file with `000|` line-number prefixes and asks for the
  steps inside it; when control leaves, the model names the destination in `leaves_to` and the next
  leg opens there. Within a leg the model is never asked for a path per step, so a path can be
  invented in exactly one place — which is the one place the parser checks it.
- **Measured 2026-09-05** against a live session holding a 16-file FastAPI project
  (`app/api/routes.py:93`, effort medium): one leg 14.1s, 8% of the 180s follow-up ceiling. Eight
  steps asked, two returned — layered code crosses files constantly, so a leg is worth about two
  steps. Every line inside the file, and `leaves_to` came back structured and semantically right
  (`app/api/deps.py:46`, exactly the `def pagination_params(` it named). Hence `TRACE_MAX_LEGS = 8`,
  `TRACE_STEP_CAP = 24`.
- **The first leg blocks, the rest prefetch.** The learner waits once (~15s) and then steps with no
  network at all; later legs land behind them and extend the run in place. Measured: 2 → 18 → 24
  steps while the learner sat on step 1.
- **A trace is a chain, so a bad step CUTS it** rather than being dropped and stepped over the way a
  bad annotation is. Skipping a link makes the pointer jump with nothing said about why control
  moved. Out-of-range lines and unknown `leaves_to` paths are never clamped or repaired.
- **`truncated` is load-bearing.** A run that hit a budget, lost a later leg, or ended on a leg that
  said neither `done` nor `leaves_to` stopped before the program did, and the popup must say so —
  otherwise a walkthrough that ends mid-statement reads as a finished one.
- **Failure is asymmetric.** The first leg failing leaves nothing to walk, so the run is `failed`
  and a retry is offered; a later leg failing leaves a real, shorter walkthrough worth reading.
- **Variables are stored as a full snapshot per step, never a delta.** A delta the model carries
  forward compounds, and "forgot to mention it" is indistinguishable from "unchanged". The diff is
  derived at render time (`changedSince`), like `conceptProgress` and `buildLineIndex`.
- **Runs are keyed by entry point inside one per-project record** (`traces`), because neither half
  of `path:line` can be a record id. A cached run replays with zero calls, including on a project
  reopened months later — which is why this is the first layer whose owner needs a write-back on
  the reopen path.
- **The popup is the annotation popup.** One element, one owner: a stepped line that also carries a
  note shows both, the note first. While a step is on screen the hover machinery neither opens nor
  closes it, and a scroll or resize re-places it rather than dismissing it.
