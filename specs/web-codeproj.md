# Web Module — Project Code Comprehension (`web-codeproj`)

> buildflow ② per-folder contract. **Conforms to `web-contract.md` (Web SoT) and the core SoT; on conflict the Web SoT, then the core SoT, win.**
> Scope: `web/parts/codeproj/` — top-down comprehension of a git repository the learner brings. The learner reads the whole codebase and learns where to change things; no authoring, no execution. Plan: `docs/기획_web.md` §2 module ②.

---

## 0. Conformance and shape

- **Comprehension, not execution** — v1 has no code sandbox. The learner reads; AI explains. (A sandbox is backlog.)
- **The code comes from the learner.** They name a git repository (a remote URL or a folder on the server's machine) plus a request, and the part annotates that code. Nothing is generated.
- **AI-centric** — loading, annotation and explanations go through `ai_server` (Web SoT §2); navigation and rendering are token 0.
- **Session load-once → resume** (Web SoT §2 lifecycle) is the cost model: load the codebase once (it enters the session context), then each annotation and click resumes that session for a small targeted call. The instance names the model; the kit does not. Every call runs at `medium`.
- Subject-agnostic: the repository and the request are injected or user-typed; the part carries no subject literal.

---

## 1. Loading contract

### 1.1 Reading the repository — `POST /repos/load`

The browser cannot read a disk or run git, and the CLI runs with tools off, so `bot/repo_loader.py` reads the repository and returns text.

- **Request** `{ source, ref?, include?[] }`. `source` starting with `http://`, `https://`, `ssh://`, `git://`, `git@` or `file://` is remote (shallow clone into a temp dir removed on every exit path, tracked by `session_guard`); anything else is a local folder, where `ref` is ignored.
- **Filtering**, in order: ignored directories (`.git`, `node_modules`, `dist`, `build`, `vendor`, `.venv`, …), symlinks, lock files and minified bundles, binary extensions, paths outside `include`, NUL or non-UTF-8 content, files over 200KB. `include` is applied **before** a file is opened, because the scope exists for repositories too large to take whole. A pattern matches as a glob, as an exact path, or as a directory prefix.
- **Limits** after filtering: 300 files, 1.5MB total (env `REPO_MAX_FILES`, `REPO_MAX_BYTES`, `REPO_MAX_FILE_BYTES`, `REPO_CLONE_TIMEOUT`). The codebase later travels as one `/ai` body under the server's 4MB cap and sits whole in one session.
- **Response**: `{ok:true, title, source, ref, commit, files[{path, content}], skipped{reason: count}, total_bytes}` or `{ok:false, reason, error, found?, limits?, dirs?}`. `reason` is `source` | `clone` | `path` | `too_large` | `empty`; the client adds `call` for a request that never got an answer. On `too_large`, `dirs` lists the first path segment's file count and bytes, largest first, so the learner can narrow the scope to part of it.
- Invalid `source`/`ref` (leading `-`, or a `ref` outside `A-Za-z0-9._/-`) is `source`, so user input can never reach git's argv as a flag.

### 1.2 The request

```ts
type RepoRequest = { source: string; ref?: string; goal: string; focus: string; scope: string[] };
type ReadingRequest = Pick<RepoRequest, "goal" | "focus" | "scope">;
```
- `scope` becomes `include` and decides what exists at all.
- `goal` (why and at what level) and `focus` (what to concentrate on) are passed verbatim into every annotation prompt as a `[학습자 요청]` section, into choosing the files read first, and into the concept outline. With both empty the section is omitted: an empty heading still reads as an instruction, and the shared audience clause is then the right default. A stated level outranks that clause.
- The request is stored with the project (`origin.request`), because annotation continues on later visits and must be written for the same goal.

### 1.3 Into the session, then annotated before entry

1. `reseedSession` loads the codebase into a fresh session (the same call a lost session uses later; its system text forbids writing, rewriting or summarising). A failure stops here and nothing is archived.
2. `onProjectLoaded(project, origin)` fires before rendering so the owner can archive first.
3. If the project has more than `ENTRY_ANNOTATE_MAX` (8) files and `goal` or `focus` is set, `pickFocusFiles` asks the session which files to read first. Unknown and repeated paths are dropped; any failure returns `[]` and project order stands. It reorders the first minutes; it never gates.
4. `annotationOrder(paths, picked)` puts the picked files first. The first 8 are annotated before entry — about 37s each (measured 2026-09-02), so the wait is bounded whatever the repository's size — and the first of them is the file opened on entry.

```ts
type ProjectFile = { path: string; content: string; lang?: string };  // lang optional; the highlighter falls back to the extension
type CodeProject = { title: string; summary: string; files: ProjectFile[]; entrypoints?: string[] };
```
`projectFromRepo` builds it from facts: `title` is the repository name, `summary` is `source · ref · commit(7) · 파일 N개` with unknown segments omitted rather than filled.

### 1.4 Behind the learner — one background queue

`background.ts` runs **one job at a time** for everything written after entry: the concept outline, each concept document, and each remaining file's annotations. Two concurrent resumes of one session were measured once and both returned (2026-09-03); three never were, and the learner's own request takes the second slot.

- On entry the queue holds the outline and the remaining files in order. When the outline lands, its documents go to the **front**: a concept set is minutes, the rest of a large repository can be hours.
- Opening a file with no notes moves its job to the front, so the wait is the job in flight. Retry and make controls push to the front too.
- The note slot in the code panel head shows `설명 만드는 중` (disabled) while a file's job is queued or running, `설명 다시 만들기` for a failed file, and `설명 만들기` for a file never annotated. Pending is read from the queue, never stored.
- The queue lives for one visit. A reopened project starts no calls; files still without notes are made one at a time from the `make` control, with the stored request.

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

**Module layout** (one concern per file, so the view can change without touching prompts or transport): `model.ts` pure types/parse/tree, `prompts.ts` all wording including the request clause and lens formats, `session.ts` the AI calls, `background.ts` the one-at-a-time queue, `view.ts` the three panel factories, `launcher.ts` the load and archive entry screen, `components/` the composed-answer block system (§3.2), `codeproj.ts` assembly plus the public surface.

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

## 4. Difficulty = what the learner brings

- There is no difficulty knob in the part. Difficulty is the repository the learner chooses and the level they state in `goal`; the scope narrows how much of it is read.
- A failed load says which failure it was (`source`, `clone`, `path`, `too_large`, `empty`, `call`), plus `session` when the codebase could not be loaded into the session. The screen keeps the elapsed clock on a failure and never clears the form.

---

## 5. Progress and (fast-follow) scored tasks

- v1 is exploratory: optionally store `read`/seen flags per file (Web SoT §5) so the learner tracks coverage. No binary grade in v1.
- **Fast-follow (backlog)**: scored comprehension tasks — "to change X, which file/function?" The learner points at a file/symbol; graded **deterministically** by comparing to a known answer pointer (token 0). The answer pointers would be written once per project after loading (a `tasks` array with `answer: {path, symbol}`), so grading needs no AI.

---

## 6. JSON directives

Every structured call (annotation, file choice, concept outline and documents, trace legs) forces JSON only and is parsed tolerantly (`carveJson` strips prose and fences). Loading is not structured: the reply is one confirmation line and only `ok` is read.

---

## 7. Part header and index

`web/parts/codeproj/codeproj.ts` header (Web SoT §1):
- `WHAT` a git repository read in an IDE shape, with an annotation layer written for the learner's request, plus session-based explanations and questions.
- `DEPS` shell + `web/src/ai` (ai_server client) + `web/src/highlight` (own highlighter; no third-party editor, no CDN) + `web/src/storage` (record store port).
- `INPUT` a pre-baked `project`, or a repository + request through `loadRepo`; `request` for a reopened project; plus the three injected layers
  `annotations` (AnnotationSet), `concepts` (ConceptSet) and `traces` (TraceSet) — rendered, never
  stored here, because every record is keyed by a project id only the flow holds.
- `EVENTS` file-seen flags; `onProjectLoaded`; `onAnnotations` / `onConcepts` / `onTraces` hand each layer back to the
  owner as it is built (and, fast-follow, scored-task verdicts).
- `AI` yes — loading (`/repos/load`, then `/ai` new session) + annotation and explanations (`/ai` resume).
- `CONSTRAINTS` `subject-agnostic, secrets-gated, session-resume`; at most one background call beside the learner's own.
- `DEMO` standalone with a canned `CodeProject` (no live AI) for the tree + viewer + lens UI.
Add the matching `web/parts/index.json` row (`ai: true`).

---

## 8. Tests (headless, gate)

- `project_model` — build the tree from paths, file lookup; `repo.test.ts` for `parseScope`, `stackOf`, `projectFromRepo`, `annotationOrder`, `pickFocusFiles` and `client.repos`.
- `explain_request` — `ExplainRequest` → request shape carries `session_id` and lens; resume path asserted against a mock `/ai` (no live claude).
- `background.test.ts` — one at a time, front push and bump, a throwing job does not stop the queue.
- `repoload.dom.test.ts` — nothing sent before load; the load sequence; 8 before entry and the rest behind; concepts ahead of remaining notes; failure reasons and the too-large directory controls; the reopen `make` path.
- `bot/tests/test_repo_loader.py` — each filter's firing and silent case, limits, remote clone and temp-dir cleanup, input validation, no orphan git process.
- `subject_agnostic` — no subject literal in `parts/codeproj/`.
- Annotation quality and real timings are live only (`repo.live.test.ts`, opt-in), not a unit gate.

## 개념 문서 (FR-23)

The part carries a second AI-written layer beside the annotations: concept documents about what
the loaded codebase teaches, read in a `개념` view that shares the study grid.

- **Two calls.** An outline (`buildConceptOutlineSystem`) returns seeds only; each document is its
  own resumed call (`buildConceptDocSystem`). One call for a whole set is far past the 180s
  follow-up cap. Measured 2026-09-03 on a 9-file project: outline 12.2s for 8 concepts, one
  document 33.0s for 2,088 characters.
- **Background, after entry, ahead of the remaining notes** (§1.4). Unlike the first annotations this does not gate the learner: notes
  attach to the code being read and are needed immediately; a concept page is elsewhere on screen.
- **`effort: "medium"`**, like every other call.
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
picks, replayed locally. **The code does not run.** Nothing in the browser can execute the loaded
repository, so this is the model's *prediction* of an execution order — which is why the popup
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
- **Wiring is bundled into one step, not walked** (user directive 2026-09-10). A step is spent only
  where the reader's understanding of the flow changes. Signatures, parameter defaults, injected
  dependencies, `self._x = x` plumbing, imports, definitions that are not yet called, and
  conditions that do not fire are collapsed into a single step that says what came out of them,
  and `leaves_to` does not follow wiring into another file. It bundles and says so; it never drops
  silently, which would be the pointer jump the rule above forbids.
  Measured on two stored runs before the change: a FastAPI walkthrough reached its service logic
  only at step 16 of 24, with 18 of 32 steps across two runs sitting on wiring; and a Node gateway
  run spent **all 23 of its steps** on imports and function definitions without reaching a single
  line of what the program does. The two fail differently, which is why the prompt names module
  load separately and says a definition is entered when it is *called*, not where it sits.
  The per-leg and per-run budgets above were measured under the previous prompt and have not been
  re-measured since.
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
