# Web Module — Project Code Comprehension (`web-codeproj`)

> buildflow ② per-folder contract. **Conforms to `web-contract.md` (Web SoT) and the core SoT; on conflict the Web SoT, then the core SoT, win.**
> Scope: `web/parts/codeproj/` — top-down comprehension of an AI-generated project. The learner reads the whole codebase and learns where to change things; no authoring, no execution. Plan: `docs/기획_web.md` §2 module ②.

---

## 0. Conformance and shape

- **Comprehension, not execution** — v1 has no code sandbox. The learner reads; AI explains. (A sandbox is backlog.)
- **AI-centric** — project generation and explanations go through `ai_server` (Web SoT §2); navigation and rendering are token 0.
- **Session load-once → resume** (Web SoT §2 lifecycle) is the cost model: generate the project once (codebase enters the session context), then each click resumes that session for a small targeted explanation. Model `claude-opus-4-8[1m]`, effort `medium` (1M context holds a small-to-mid project; project scale is the difficulty knob and the natural ceiling).
- Subject-agnostic: topic/scale/seed are injected or user-chosen; the part carries no subject literal.

---

## 1. Project generation contract

One `POST /ai` (force_json) generates a coherent project and seeds the session.

**Input** (web → `/ai`):
- `system`: generator role (from config `tasks.codeproj`, subject-agnostic) + the §6 JSON directive.
- `prompt`: `{ topic, scale, seed? }` rendered to text — `topic` (what the project does), `scale` (difficulty, §4), optional `seed` (constraints/stack).
- `session_id: null` (new session), `effort:"medium"`, `model: claude-opus-4-8[1m]`.

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
- `INPUT` `{topic, scale, seed?}`; consumes `GeneratedProject`.
- `EVENTS` file-seen flags (and, fast-follow, scored-task verdicts).
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
