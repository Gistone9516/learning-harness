# Web Module — Concept and Problem (`web-conceptprob`)

> buildflow ② per-folder contract. **Conforms to `web-contract.md` (Web SoT) and the core SoT; on conflict the Web SoT, then the core SoT, win.**
> Scope: `web/parts/conceptprob/` — study a concept (long-form reading) then solve its linked problems. Concepts are AI-generated; problems are graded deterministically (token 0). Plan: `docs/기획_개념문제킷.md`. Subsumes the deferred long-form reading.
> Rules: CP-1..CP-3 (3), in §10.

---

## 0. Conformance and shape

- **Concept → problem flow** in a three-level hierarchy: **area → concept → problem**.
- **Concept = pre-baked or AI-generated.** A concept can be **injected pre-baked** (a verified `GeneratedConcept`, rendered and graded with zero AI) or, when a session is present, **generated live** (session-loaded; reading deepened on click via `--resume`). **Problems = deterministically graded** by the engine grader port (Web SoT §3), token 0 at grade time, in both modes.
- **AI is optional.** With every needed concept pre-baked, the part runs **fully offline** (no `ai_server`); deepen (live-only) is hidden. This is the graceful-degradation contract (Web SoT §7) and the deterministic = token 0 invariant.
- The instance names the model, effort `medium` (live mode only). Subject-agnostic: the area taxonomy and any concept outline are injected (Web SoT §4); the part carries no subject literal.

---

## 1. Hierarchy and index (injected outline, generated content)

- **`area`** — from the injected subject taxonomy (Web SoT §4; same shape as `bot/subject.py` `areas`): `[{key,label,icon?,aliases?}]`.
- **concept index** — per area, the subject config provides an outline of concept seeds `[{concept_id, title}]` (the curriculum table of contents). The **left toggle panel** renders `area → concept` as an accordion from this outline. Selecting a concept loads its content: a **pre-baked** `GeneratedConcept` for that `concept_id` if injected (§2.1), otherwise generate live (§2) when a session exists, otherwise a "not yet prepared" notice.
- **problem** — generated with the concept (§2); graded deterministically (§4).
- Backlog: AI-proposed concept index (no injected outline). v1 uses the injected outline for a stable, curated structure.

---

## 2. Concept + problems generation contract

Selecting a concept does one `POST /ai` (force_json) that returns the reading and its linked problems, and seeds the session.

**Input**: `system` = concept-author role (config `tasks.conceptprob`) + §6 directive; `prompt` = `{area, concept_id, title, scope?}`; `session_id:null`; `effort:"medium"`.

**Return** (parsed):
```ts
type ProblemDef = {                 // subset of core SoT CardDef (§1); deterministic-gradable
  card_id: string;
  type: "func"|"proc"|"cloze"|"judge";
  grade_mode: "exact"|"keyword"|"cloze";   // deterministic modes only in v1 (self/AI = backlog)
  front: Record<string, any>;       // prompt | text(cloze {{i}}) | scenario+options(judge); optional code?+lang? for an output-prediction/SQL block (engine/bot ignore the extra keys)
  answer_spec: {                    // core SoT AnswerSpec
    normalize: string[];
    accepted?: string[]|null;
    required_keywords?: string[][]|null;
    blanks?: string[][]|null;
    sequence?: string[]|null;
  };
  links?: { concept_ref?: string }; // anchor id into the concept body (retrace on wrong)
};
type GeneratedConcept = {
  area: string; concept_id: string; title: string;
  body: string;                     // long-form reading (Markdown, output_lang), with anchor ids
  problems: ProblemDef[];           // linked problems carrying answer_spec
};
```
- The web stores the `session_id`. The concept body and problems are now in the session context (for click-to-deepen).
- **Problems carry their own `answer_spec`** so grading (§4) needs no further AI (Web SoT §6).

### 2.1 Pre-baked injection (verified content, zero AI)

A first-class alternative to live generation: the consuming instance injects **verified** concepts ahead of time.

- **Input**: `props.concepts: Record<concept_id, GeneratedConcept>` (same `GeneratedConcept` shape as §2). Authored/generated offline, reviewed, then frozen into the instance data (e.g. `decks/conceptprob.json`, Web SoT §4).
- **Resolution order** on selecting a concept: session cache → injected `concepts[concept_id]` → live generate (only if a session exists) → "not yet prepared" notice.
- **No `ai_server` needed.** With every outline concept pre-baked, mount with `session:null`: reading renders and problems grade with **zero AI** (deterministic = token 0, fully offline). Live-only affordances (deepen) are hidden.
- **Intent-first still applies to the live path only** (Web SoT §6.1): pre-baked is the *already-decided* content; live generation is what must elicit intent first.

---

## 3. Concept reading (top) + click-to-deepen

- The concept `body` renders at the **top** of the main area (Markdown, anchors per section/term).
- Clicking a term/section (or asking) requests deeper explanation from the **same session** (`session_id` resume, small call): `{ target: anchor|selection, lens: "explain"|"example"|"simpler" }` → `text`. Avoids pre-generating every explanation.

---

## 4. Linked problems (bottom) — deterministic grading

- The linked `problems` render in a **block below** the concept.
- The learner answers; the **engine grader port** (Web SoT §3) scores against `answer_spec` in `grade_mode` (`exact`/`keyword`/`cloze`), binary verdict, token 0.
- On `incorrect`, offer a **retrace link** to the concept anchor in `links.concept_ref` (concept → problem connection made bidirectional).
- No partial credit; matched/missed shown for feedback without leaking unrelated answers.

---

## 5. Layout / UI

```
┌───────────────┬─────────────────────────────┐
│ left toggle   │  concept (top): long-form    │
│ area ▸ concept│  reading + click-to-deepen   │
│  (accordion)  ├─────────────────────────────┤
│  index        │  problems (bottom): linked   │
│               │  problem block + grade       │
└───────────────┴─────────────────────────────┘
```
- Left panel from the injected `area → concept` outline (§1). Selecting a concept loads the main panel (generate if not cached; cache the generated concept + session for the view's lifetime).
- Korean UI from config/defaults (subject-agnostic).

---

## 6. JSON directive (generation)

The author system preamble forces the §2 `GeneratedConcept` JSON only, plus the shared safety preamble and `output_lang` (the `body`, problem `front`, and any `reason` text in the learner's language). Each `ProblemDef.answer_spec` must be valid (core SoT) so the deterministic grader can score it. Parse tolerantly; on failure, offer regenerate (no partial concept).

---

## 7. Progress

- Concept read flag and per-problem verdicts (Web SoT §5): `{module:"conceptprob", item_id:<concept_id|card_id>, read?|verdict?, ts}`.
- Mastery per concept/area is derived from stored verdicts (no engine `_state` in v1).

---

## 8. Part header and index

`web/parts/conceptprob/conceptprob.ts` header (Web SoT §1):
- `WHAT` area→concept→problem study: AI concept reading + deterministically graded linked problems.
- `DEPS` shell + `web/src/ai` + `web/src/grade` (grader port) + a Markdown renderer.
- `INPUT` injected `areas` + concept outline + optional pre-baked `concepts {concept_id: GeneratedConcept}`.
- `EVENTS` concept-read flag, problem verdicts.
- `AI` optional — pre-baked concepts render/grade with zero AI (offline); with a session, missing concepts generate live (`/ai` new session) + deepen (`/ai` resume). Grading is always token 0.
- `CONSTRAINTS` `subject-agnostic, secrets-gated, token0-grading, binary`.
- `DEMO` standalone with a canned `GeneratedConcept` and `session:null`: index + reading + problem grading via the port, fully offline.
Add the matching `web/parts/index.json` row (`ai: true` — AI is supported but optional; the part also runs from pre-baked content).

---

## 9. Tests (headless, gate)

- `concept_model` — parse a canned `GeneratedConcept`; build the area→concept index; resolve `concept_ref` anchors.
- `problem_grade` — each `grade_mode` scored via the grader port against `answer_spec`, binary verdict, retrace link on wrong (no live AI).
- `pre_baked` (jsdom) — mount with injected `concepts` + `session:null`: the concept loads, its Markdown body renders (heading/table/code), the title anchors `concept_id`, deepen is hidden, each `grade_mode` grades, and the wrong-answer retrace resolves — all with **zero AI**. Locks the offline / token-0 invariant.
- `subject_agnostic` — no subject literal in `parts/conceptprob/`.
- Generation quality is live-smoke only (real model), not a unit gate.

---

## 10. Behaviour rules

| ID | Rule | Source | Why | Test |
|---|---|---|---|---|
| CP-1 | A `$$ … $$` block and an inline `\( … \)` are typeset by KaTeX as MathML (`web/src/doc/math.ts`), loaded lazily on the first formula. Until it loads, or if it fails, the raw TeX stays visible. A single `$` is never math. | User report 2026-10-20: every formula showed raw TeX, because `DOC_DIALECT` asks authors for `$$` while the renderer only printed the text. | Single `$` stays literal because cost content writes prices as `$0.0116`. MathML needs no font or CSS files, so it survives offline use and the fixed `assets/index[extname]` names in `vite.config.ts`, which would collide for KaTeX's font files. Lazy, because remote first paint is bound by round trips and most pages hold no formula. | `math.test.ts` |
| CP-2 | Judge options are shown in a stable order derived from `card_id` (`optionOrder`, `web/src/grade/order.ts`), never in stored order. Grading still compares option text. | Measured 2026-10-20: 16 of 16 stored cloudrobot judge items had the answer as the first option. | The generator's few-shot puts the answer first and models follow it; a display-side order fixes stored items without regenerating them. Derived from the id, so a reload or resumed set shows the same order. | `order.test.ts`; dom "judge options follow optionOrder" |
| CP-3 | The buttons offered for one text selection live in one positioned group (`.lh-cp-askgroup`); only the group is positioned, never a button inside it. | User report 2026-10-20: "AI 질문" and the `askElsewhere` button overlapped. | Each button was centred and offset by a guessed width; the overlap held whenever the second label was wider than the first by 12px or more. One group makes overlap impossible instead of computed. | dom "selection buttons share one group" |
