# Web Module — Notebook (`web-notebook`) and the generic web host

> Conforms to `web-contract.md` (Web SoT); on conflict the Web SoT wins.
> Scope: `web/parts/notebook/`, `tools/webhost/`, `tools/serve_host.py`, `tools/start_web.ps1`, and the
> generic hooks added to `conceptprob` and `probgen` so a subject can run entirely from one page.
> Rules: N-1..N-22 (22). Contracts: §2-§5.

---

## 1. Behaviour rules

| ID | Rule | Why | Test |
|---|---|---|---|
| N-1 | The notebook part carries no subject literal. Every subject-flavoured string (tab names, placeholders, the AI role) arrives through `props.labels` and `props.ask.system`. | Web SoT §0.1; the guard in `web/tests/subject_agnostic.test.ts`. | guard test |
| N-2 | Every ask is saved as a `thread` record before the AI reply arrives (user turn first, reply patched in). | A failed or slow call must not lose what the learner typed. | `notebook.dom.test.ts` "saves the question before the reply" |
| N-3 | A thread can be continued at any time. The stored `session_id` is resumed; when the server answers `resume_missing`, a fresh session is seeded with the thread transcript. | Sessions do not survive an ai_server restart, but the conversation must. Same pattern as conceptprob's chat. | `model.test.ts` transcript; dom test "continues a thread" |
| N-4 | The AI reply is Markdown followed by one fenced `json` block (§3). Parsing is defensive: no block, or a block that does not parse, still shows the text and saves the turn with no terms. | `/ai` has no JSON mode; tools are off. | `model.test.ts` parseReply cases |
| N-5 | A term's id is the slug of its lowercase headword. The same headword always lands on the same record; a repeat increments `lookups` and merges senses, examples and thread references instead of overwriting. | One record per term keeps the dictionary and the review queue consistent (one quantity, one field). | `model.test.ts` mergeTerm |
| N-6 | Words listed in `props.stopwords` are never saved as terms. | Function words would flood the dictionary. | `model.test.ts` |
| N-7 | A review card's front shows the headword and an answer field only; senses, expansion and examples are on the back, shown after grading or after 뜻 보기. | A subject may forbid spelling out an abbreviation on the question side. | dom "review: a typed meaning is graded…" (front checked before grading) |
| N-8 | Review scheduling is Leitner, driven by the verdict on the typed meaning (N-20): correct moves up one box; incorrect — or 뜻 보기 without an answer — returns to box 1 and re-queues once in the current session; an ungraded reply leaves the record unchanged and does not re-queue. The verdict is saved as soon as it arrives; 다음 only advances. Terms marked `known` never enter the queue. | Same transition shape as `engine/leitner.py`. User 2026-10-05: the self-rating buttons (몰랐어요/알았어요) are removed. Ungraded = no penalty, as W-2. | `model.test.ts` review; dom "review: a typed meaning is graded…", "…뜻 보기 counts as wrong", "…ungraded leaves the record" |
| N-9 | Searchable fields live in the record `summary`; listing reads only the index. | The state API lists index entries only. | `model.test.ts` termSummary |
| N-10 | Seed terms are written once per `seed_version`, and never overwrite an existing record. | A reload must not reset what the learner has already studied. | dom test "seed is idempotent" |
| N-11 | The curriculum outline lives in one state doc (`props.outline.doc`). The outline tab edits it; conceptprob reads it at mount. A file in the subject folder only seeds it when the doc is absent. | One source of truth for what has been studied; the file is not a second copy that can drift. | shell wiring; dom test "outline save" |
| N-12 | conceptprob persists a live-generated concept through `conceptStore` and reads it back before generating again. | Without it every reload regenerates the concept (cost, and the reading changes under the learner). | `conceptprob.dom.test.ts` "reads a stored concept" |
| N-13 | conceptprob and probgen keep their current behaviour when no override is passed (labels, author system prompt, problem style). | Other instances consume the same code. | existing tests stay green |
| N-14 | The host page, host server and launcher are kit code; a subject folder supplies only `content/app.json`, content files and `host/local.config.js`. | One copy of the code (KT-2). | a subject folder holds no `.py/.ps1/.ts/.js` except `local.config.js` |
| N-15 | Text selected in conceptprob can be handed to the notebook (`askElsewhere`): the shell writes it under `notebookPrefillKey(subjectKey)` and switches the view; the notebook reads it once, clears it, and opens it as a new question. The key has one definition, exported by the notebook. | Reading English stems is where the learner meets unknown words; the bridge has to be one click. Two literals for one key would drift. | dom test "takes text handed over by another part" |
| N-17 | With `data.collapseAbbreviations`, every problem front is rewritten before render so a spelled-out abbreviation becomes the bare abbreviation (sources: `data.seed.terms` and the notebook's acronym records). Judge options and their accepted answer are rewritten together; cloze/short-answer answers are left alone. | A prompt instruction was measured to leak (1 of 5 generated problems spelled out MFA, 2026-09-30); a rewrite makes the leak impossible instead of checked. | hooks dom test "collapses spelled-out abbreviations" |
| N-16 | With `author` set, live concept generation appends `DOC_DIALECT` and `CONCEPT_CONTRACT` (kit-owned) to the instance's role text. | The instance owns voice; the kit owns the format its parser and renderer accept. | hooks dom test "generates with the author prompt" |
| N-18 | On a review card's back, the example sentence opens in its original language. When a translation is stored (`examples[].ko`), a toggle (the shared `.lh-qz-lang` control, labels `exampleLangPrimary` / `exampleLangSecondary`) swaps the sentence for it; key E does the same, ignored while a text field has focus or with Ctrl/Alt/Meta. Every new card starts in the original language. No stored translation means no toggle and no AI call. The dictionary entry page keeps showing both. | User intent (2026-10-02): read the English example first and switch only when needed, as the quiz does (Q-4). The translation already arrives with the term, so the review card never pays for one. | dom "review example opens in the original language…", "…without a stored translation shows no toggle" |
| N-19 | Capture never re-saves a saved term. Every ask turn sends the current dictionary headwords (`savedTermsBlock`), and the contract tells the model not to list a saved term, another form of it, or a phrase that only wraps a saved word in the same sense — except the word or phrase the learner asked about directly. `captureTerms` backs this with `skipExisting` (an existing id is skipped unless it is `keep`, the slug of the learner's input). Everyday words stay in scope. | User 2026-10-04: "중복된 영단어를 포함시키지 말란 뜻", "AI 가 단어를 지정할 때, 저장된 단어를 읽고 생성하도록"; and "내가 영어 수준이 낮아서 일상어도 포함 되어야 해" — so the fix is dedup against the dictionary, not a narrower or capped list. The prompt handles other forms; the code makes an exact re-save impossible. | dom "an ask turn sends the saved terms and does not re-save them" |
| N-20 | A typed meaning is graded by AI with `props.review` (`system`, `model`, `effort`; the kit appends `REVIEW_CONTRACT`) in **one AI session per review visit**: the first answer seeds it with the system text, later answers resume it with only the term and the answer; `resume_missing` re-seeds; entering the review tab starts a new session. Each message is three short lines (term, reference meanings, answer) and the reply is `{verdict: correct\|incorrect, feedback}` with feedback at most one short sentence; anything unparseable or a failed call is ungraded. How lenient the verdict is and how firm the feedback is are the subject's wording. Without AI or without `props.review` the answer field is hidden and 뜻 보기 only reveals the back, leaving the record unchanged. | User 2026-10-05: "내가 직접 입력할 수 있게", "sonnet low", "매 단어마다 호출이 아닌, 한번 호출하면 페이지를 바꾸기 전까지 유지", "평가 기준은 널널하게. 그러나 지적은 강력하게". Requests carry `live: true`, so the server answers follow-ups from one long-lived process (`ai-mode.md` §4.1; 2.2-3.1 s instead of 4.7-5.9 s per answer, measured 2026-10-05; user: "프로그램을 새로 띄우지 않아도 되지 않음? 세션 그대로 이어가도 됨"). A resumed session does not resend the system text and contract for every card. Later the same day, with sonnet measured at 8.4 s per answer and haiku slower (14-24 s): "sonnet 유지. 대신 입력 및 출력 프롬프트를 간소화 … sonnet 은 평가만 간단히" — the card already shows the full meanings, so the grader's text stays minimal. Each answer is still one request. | dom "review: a typed meaning is graded in one session…" |
| N-21 | At 860px and below the host nav collapses to one ☰ button; its popup holds the brand, the view links, **the part's own tabs with their counts**, and the theme toggle, and closes on outside click, Esc or a choice. The in-page tab bar is hidden there; a label top-left shows the view and tab, and a dot on ☰ marks a flagged (due) tab. The shared tab layout publishes its state as `lh:tabs` on window (`globalThis.LH_TABS`, `select(id)` acts like a click), so the host needs no knowledge of any part. Above 860px nothing changes. | User 2026-10-05: "좁은 화면에서 메뉴가 위에 있으니 불편함. 버거 버튼", then, when the first version left the part tabs in the page: "이놈들을 최상단까지 와서 선택해야 한다는게 불만이었어" — the tabs must be reachable from anywhere on the page. | `web/tests/tabs.dom.test.ts` (publishing); host popup checked by hand (plain JS, no test runner) |
| N-22 | A review card carries the dictionary's two-step delete (삭제 → 한 번 더 누르면 삭제됩니다). Deleting removes the term record and drops the card from the current session's queue, re-queued copy included; not while a grade is pending. | User 2026-10-05: "단어 삭제 버튼도 넣어줘" — a word met in review that is not worth keeping should go without a trip to the dictionary. One delete control, one wording, in both places. | dom "review: a card can be deleted…" |

## 2. Records (state API, collections under the instance's state root)

```ts
type TermType = "word" | "phrase" | "acronym";
type ThreadType = TermType | "sentence" | "question";

// collection "terms", id = slugTerm(headword)
interface TermSummary { headword: string; type: TermType; gloss: string; lookups: number; known: boolean;
                        box: number; due_at: number; last_seen: number }
interface TermData {
  headword: string; type: TermType; pos?: string; ipa?: string; expansion?: string;
  senses: { gloss: string; domain?: string }[];      // dedup by gloss
  examples: { en: string; ko?: string; thread?: string }[];   // newest first, max 5
  related: string[];                                  // headwords
  threads: string[];                                  // thread ids, newest first, max 20
  lookups: number; known: boolean;
  srs: { box: number; due_at: number; reps: number; lapses: number };
  first_seen: number; last_seen: number; via: string[];   // "ask" | "seed" | "compose"
  // lookups counts asks only: seeds and compose captures (MergeCtx.countLookup = false) never raise it
  unit?: string;
}

// collection "threads", id = "t-YYYYMMDD-HHMMSS-xxx"
interface ThreadSummary { title: string; type: ThreadType; turns: number; updated: number }
interface ThreadData {
  session_id: string | null;
  type: ThreadType;
  turns: { q: string; a: string; at: number; terms: string[]; error?: boolean }[];
}
```

Doc `props.outline.doc` = `{ areas: AreaDef[]; conceptOutline: Record<areaKey, ConceptSeed[]> }` (conceptprob's own props).
Doc `notebook-meta` = `{ seed_version?: string }`.
Collection `concepts` (conceptprob, N-12): `{ kind: "concept", id: concept_id, summary: {title, area}, data: GeneratedConcept }`.

## 3. Ask reply contract (kit-owned, appended to the subject's `ask.system`)

The model answers in Markdown, then ends with exactly one block:

````
```json
{"type":"word|phrase|acronym|sentence|question","title":"<short title>",
 "terms":[{"headword":"...","type":"word|phrase|acronym","pos":"...","ipa":"...","expansion":"...",
           "senses":[{"gloss":"...","domain":"general|subject"}],"example":{"en":"...","ko":"..."}}]}
```
````

`terms` lists every content word or fixed phrase worth keeping from the learner's input (for a sentence:
each content word), minus anything already in `[Saved terms]` (N-19). `expansion` only for abbreviations.

## 4. Props

```ts
interface NotebookProps {
  storage: StoragePort;
  aiClient: AiClient | null;
  ask: { system: string; model?: string; effort?: AiEffort };
  labels?: Partial<NotebookLabels>;          // defaults are subject-neutral Korean UI strings
  stopwords?: string[];
  seed?: { version: string; terms: TermSeed[] };
  outline?: { doc: string; propose?: { system: string; model?: string } };
  srs?: { intervalsDays?: Record<number, number> };   // default {1:1,2:2,3:4,4:8,5:16}
  review?: { system: string; model?: string; effort?: AiEffort };   // N-20: AI grading of typed meanings
}
```

conceptprob additions (all optional, N-13): `labels`, `author: {system, model?, effort?}`,
`conceptStore: {load(id), save(concept)}`, `problemStyle` (forwarded to `/problems` as `style`),
`askElsewhere: {label, onAsk(text)}` (N-15), and `ProblemDef.explain` (Markdown shown under the answer).
Shell data keys for conceptprob: `outlineDoc`, `persistConcepts`, `labels`, `author`, `problemStyle`,
`askElsewhere: {label, hash}`.

AI isolation (bot/ai.py, all instances): the CLI is started with `--setting-sources project,local`, so
the operator's user-level hooks never reach a learner's answer (measured 2026-09-30: a SessionStart
notice opened a vocabulary explanation). `AI_CLI_SETTING_SOURCES=all` restores the CLI default.

## 5. Host

- `tools/serve_host.py --subject <dir> [--port N] [--kit <kit>]`: `/` and `/host.*` → `tools/webhost/`,
  `/local.config.js` → `<dir>/host/local.config.js`, `/kit/` → `web/dist/`, `/content/` → `<dir>/content/`
  (plus `contentLinks`). Binds 127.0.0.1; refuses paths that resolve outside a root. What is served is decided
  by `tools/hostfiles.py`, shared with the gateway (`web-gateway.md` §4).
- The host page uses **relative URLs only** (`kit/assets/...`, `content/...`, `host.js`), so it works at `/` and
  under a prefix such as `/study/<slug>/` (`web-gateway.md`). It must be opened at a URL ending in `/`.
- `local.config.js` sets `window.LH_LOCAL = {token, serverUrl, model}`; behind the gateway it is
  `{serverUrl, gated: true, model}` with no token, and the page accepts either.
- `tools/start_web.ps1 -Subject <dir> [-SkipBuild]`: reads `AI_SERVER_PORT` and `HOST_PORT` from `<dir>/.env`,
  builds the bundle with `npm.cmd`, starts `bot/ai_server.py <dir>/state` with cwd `<dir>`, then the host server.
- `content/app.json`: `{ title, namespace, model?, contentLinks?, views: [{ hash, label, part, data, files?: {key: file} }] }`.
  `model` is the default AI model when `local.config.js` names none (always the case behind the gateway).
  The host fetches each `files` entry from `content/` into `data[key]` (a `.md` or `.txt` file as text, anything
  else as JSON), sets `LH_CONFIG`, then loads the bundle.
