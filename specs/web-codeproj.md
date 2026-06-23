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

## 2. Explanation contract (click → resume)

Clicking a file, a symbol, or a line range requests a targeted explanation from the **same session** (so the codebase is not re-sent).

**Request** (web → `/ai`): `session_id` = the project's id; `effort:"medium"`; `prompt` names the target and the lens:
```ts
type ExplainRequest = {
  target: { path: string; symbol?: string; lines?: [number, number] };
  lens: "overview" | "libs_methods" | "flow" | "modify_tip";
};
```
- `overview` what this file/part does; `libs_methods` libraries/methods used and why; `flow` how it is called from input to output; `modify_tip` if you wanted to change this, what to touch.
- **Response**: `text` (Markdown, in `output_lang`), rendered in the explanation pane. Tables in the text follow the kit table standard. Graceful on `ok:false`.

---

## 3. UI

- **Left**: file/folder tree (from `files[].path`), collapsible. Selecting a file loads it on the right.
- **Right**: read-only code panel with syntax highlighting (CodeMirror, read-only mode). Clicking a symbol or selecting lines triggers §2 with the chosen `lens`; a lens menu offers overview/libs_methods/flow/modify_tip.
- **Explanation pane**: streamed/rendered Markdown of the §2 response, anchored to the clicked target.
- Korean UI from config/defaults (subject-agnostic).

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
- `DEPS` shell + `web/src/ai` (ai_server client) + CodeMirror (read-only).
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
