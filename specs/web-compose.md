# Web Module — Compose (`web-compose`)

> Conforms to `web-contract.md` (Web SoT); on conflict the Web SoT wins. Reuses `web-notebook.md` records.
> Scope: `web/parts/compose/` — writing practice in a target language with AI feedback. Rules: W-1..W-14 (14).

---

## 1. Behaviour rules

| ID | Rule | Why | Test |
|---|---|---|---|
| W-1 | No subject literal. Mode names, task wording, error categories, the AI roles and all UI strings arrive through props (`labels`, `tasks`, `grader`, `categories`). | Web SoT §0.1; `web/tests/subject_agnostic.test.ts`. | guard test |
| W-2 | Grading has three verdicts: `correct`; `partial` (△ — the meaning is fully conveyed and the task fulfilled, and every remaining error is minor: spelling, an article, singular/plural, punctuation, capitalization); `incorrect` (meaning wrong or unclear, task not fulfilled, or a structural error such as tense, word order or verb pattern). `partial` counts as a pass everywhere (`isPass`). A reply that cannot be parsed, or a failed call, records the attempt as **ungraded** — never as incorrect — and it does not enter the revise queue. | User decision 2026-10-04 ("간단한 오답은 그냥 '세모' 처리"): the learner drills until fluent anyway, so a minor slip must not send a task back as a failure; the correction is still shown. The only exception to Web SoT §0.5, recorded there. Unparseable → ungraded is the bot's `ai_practice` contract ("count as skip, no Leitner penalty"). | `model.test.ts` parseGrade; dom "ungraded on failure", "partial is a pass" |
| W-3 | Task generation and grading are separate calls with separate schemas. | Measured in the bot: appending the verdict schema to a generation call broke generation (`ai_practice.py` note). | code review |
| W-4 | The attempt is saved before the grade arrives and again after it (finally). | A failed or slow call must not lose what was written (same as N-2). | dom "saves the attempt first" |
| W-5 | One AI session per task. A resubmission resumes it and sends only the new text; `resume_missing` re-seeds with the task and the attempt history. | The grader should judge the revision against its earlier feedback; sessions do not survive a server restart. | dom "resubmission resumes" |
| W-6 | The word-level diff between the learner's text and the corrected text is computed locally. | Token 0, deterministic, and the model's own diff markup is unreliable. | `model.test.ts` wordDiff |
| W-7 | Expressions the grader returns are captured into the notebook's `terms` with the corrected sentence as an example, through `createNotebookStore().captureTerms` with `via: "compose"` and `countLookup: false`. | One store, one merge rule (N-5); writing with a word is practice, not a lookup, so it must not raise the word's review priority. | dom "captures expressions without a lookup" |
| W-8 | Revise queue is Leitner on the task: incorrect → box 1, due one interval later; correct or partial while queued → next box; correct or partial on first grade → never queued. Uses notebook `review()`. | One scheduling rule for the whole subject; partial schedules as correct (W-2). | `model.test.ts` scheduleTask |
| W-9 | With no AI, the part still mounts: saved tasks, history and the queue work; a submission shows the model answer (if the task has one) and asks the learner to judge it themselves — right or wrong only, since without a grader nobody tells a minor slip from a real error. | Web SoT §4/§7 (AI optional, degrade visibly). | dom "self-judge offline" |
| W-10 | Searchable fields live in the record summary (listing reads the index only). | State API lists index entries only (N-9). | `model.test.ts` taskSummary |
| W-11 | Text handed in from another part (`composePrefillKey(subjectKey)`, a JSON `{words: string[]}`) opens the word-use mode with those words, once. | One-click bridge from the dictionary; one key definition. | dom "takes handed-over words" |
| W-12 | Read-aloud uses the browser's speech synthesis only (`props.speechLang`); absent API → no button. | Zero cost, offline. | dom (button presence) |
| W-13 | Each error may carry up to two `examples` — new sentences (not the learner's) that apply the corrected pattern, each with a translation. They are shown under the error and are never captured as terms. | User request 2026-10-04: seeing the rule used in other sentences is the fast way to learn it. They illustrate grammar, not vocabulary, so they stay out of the dictionary. | `model.test.ts` parseGrade examples; dom "shows examples under an error" |
| W-14 | The grader sees the dictionary headwords (`savedTermsBlock`) on every send and proposes only expressions not yet saved; `captureTerms` runs with `skipExisting`, so a saved term is never re-captured. | Same decision as N-19 (user 2026-10-04: no duplicate words; read the saved words first). | dom "the grader sees the saved terms and a saved expression is not re-captured" |

## 2. Records — collection `compose`

```ts
type Mode = "translate" | "words" | "describe" | "free";
type Verdict = "correct" | "partial" | "incorrect" | "ungraded";   // isPass = correct | partial
interface ComposeError { category: string; from: string; to: string; explain: string;
                        examples?: { en: string; ko?: string }[] }   // W-13, max 2
interface Attempt { text: string; at: number; verdict: Verdict | null; reason?: string;
                    corrected?: string; natural?: string; errors?: ComposeError[]; terms?: string[]; self?: boolean }
interface TaskData {
  mode: Mode; prompt: string;           // learner-facing instruction (subject language)
  words: string[]; unit?: string;
  model_answer?: string; expressions: string[]; skeleton?: string;
  session_id: string | null; attempts: Attempt[]; revealed: boolean;
  srs: SrsState | null;                 // null = not in the revise queue
}
interface TaskSummary { prompt: string; mode: Mode; verdict: Verdict | "none"; attempts: number;
                        updated: number; queued: boolean; due_at: number; box: number }
```
Task id: `c-YYYYMMDD-HHMMSS-xxx` (state id rule).

## 3. AI contracts (kit-owned, appended to the instance's role text)

Generation (`tasks.system` + GEN_CONTRACT): one JSON object `{"tasks":[{"prompt","words","model_answer","expressions","skeleton"}]}`.
Input: `{mode, count, level, unit, curriculum, words, focus}`.

Grading (`grader.system` + GRADE_CONTRACT, first send of a task's session):
`{"verdict":"correct"|"partial"|"incorrect","reason","corrected","natural","errors":[{"category","from","to","explain","examples":[{"en","ko"}]}],"terms":[TermInput]}`.
`category` must be one of `props.categories` (else shown as given). `corrected` is a minimal edit of the learner's text.

Both parse the last ```json fence, else the outermost `{…}`; anything else → null (W-2).

## 4. Props

```ts
interface ComposeProps {
  storage: StoragePort; aiClient: AiClient | null; subjectKey?: string;
  tasks: { system: string; model?: string; effort?: AiEffort };
  grader: { system: string; model?: string; effort?: AiEffort };
  categories?: string[];  levels?: { key: string; label: string }[];
  modes?: Mode[];  labels?: Partial<ComposeLabels>;
  outline?: { doc: string };            // unit filter + curriculum grounding
  stopwords?: string[];  speechLang?: string;  batch?: number;   // default 5
  srs?: { intervalsDays?: Record<number, number> };
}
```

Notebook additions: `MergeCtx.countLookup` (default true), and `useTerm: {label, run(headword)}` on the dictionary entry.
Shell data keys: compose takes its props from `data`; notebook `useTermIn: {label, hash}` hands a word to compose.
