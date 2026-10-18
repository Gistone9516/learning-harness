# Web Module — Quiz (`web-quiz`)

> Conforms to `web-contract.md` (Web SoT). Reads conceptprob's concept records; grades with conceptprob's
> `gradeProblem` (the engine grader port). Scope: `web/parts/quiz/`. Rules: Q-1..Q-12 (12).

---

## 1. Behaviour rules

| ID | Rule | Why | Test |
|---|---|---|---|
| Q-1 | No subject literal; labels, translation role, item style arrive through props. | Web SoT §0.1. | guard test |
| Q-2 | The bank is the union of (a) problems inside concept records (`concepts/<id>`) and (b) quiz-generated problems (`problems/<concept_id>.generated`), minus problems marked deleted in the log. | Problems generated before this part existed keep working; one place lists the bank. | `model.test.ts` assembleBank |
| Q-3 | Grading is deterministic and token 0 (`gradeProblem`). A judge item shown in the secondary language is graded by option **position** against the primary-language options. | The translation is a view; the answer key stays in one language. | dom "grades by position when translated" |
| Q-4 | Every problem starts in the primary language. The toggle shows `ko[card_id]` when stored; otherwise one AI call translates it, the result is stored in `problems/<concept_id>.ko`, and later toggles cost nothing. A translation whose option count differs from the original is rejected. An instance whose primary language is the learner's own sets `langToggle: false`, which hides the switch and its key. | User intent: read in English first, switch only when needed; never pay twice. | dom "toggle translates once" |
| Q-5 | New problems are generated through `/problems` with the instance `problemStyle`, which asks for `front_ko` and `explain`; both are kept. Generated problems are stored in the state API, never only in the browser. | Survive a browser change; translation comes free with generation. | dom "generated problems persist" |
| Q-6 | A set is built from units × source (all / unseen / wrong / flagged) × count, shuffled, and saved in localStorage so a reload resumes it. | Q12 resume. | `model.test.ts` buildSet |
| Q-7 | Practice mode grades on submit and shows answer + explanation; exam mode records answers silently, runs a timer (`secondsPerItem`, default 120), and grades all at the end or at time-out. | Two study modes; the exam ratio follows the instance setting. | dom |
| Q-8 | The log keeps the last 10 verdicts per problem, a flag and a deletion reason, in one state doc (`quiz-log`). Deletion reasons are sent as `feedback` on the next generation for that concept. | One read gives every statistic; reasons improve the next batch. | `model.test.ts` logAnswer |
| Q-9 | `rewriteFront` (abbreviation collapse, N-17) applies to both language versions before render. | R-1 holds in either language. | dom |
| Q-10 | Keyboard: 1-9 choose an option, Enter submits / goes next, T toggles the language — ignored while a text field has focus. | Speed for repeated drills. | dom |
| Q-11 | `askElsewhere` hands the primary-language stem (or a text selection) to the notebook. | Same bridge as N-15. | code |
| Q-12 | Results show score, per-unit accuracy and the wrong items; "retry wrong" builds a practice set from them. | Close the loop on mistakes. | dom |

## 2. Records

```ts
interface FrontKo { scenario?: string; prompt?: string; text?: string; options?: string[] }
// collection "problems", id = concept_id
interface ProblemSet { generated: QuizProblem[]; ko: Record<card_id, FrontKo> }
interface QuizProblem extends ProblemDef { front_ko?: FrontKo; area: string; concept_id: string }
// doc "quiz-log"
interface QuizLog { items: Record<card_id, { h: ("c" | "i")[]; f?: boolean; d?: string; at?: number }> }
```

## 3. Translation contract (kit-owned, appended to `translate.system`)

Reply with one JSON object holding the same keys as the given front (`scenario` | `prompt` | `text`, and `options`
with the same count and order). Abbreviations stay bare. Parsed with `extractJsonObject`.
