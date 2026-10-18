# Web Module — Roadmap (`web-roadmap`)

> Conforms to `web-contract.md` (Web SoT). Reads the quiz bank and log (`web-quiz.md`) and the outline doc
> (`web-notebook.md` N-11). Scope: `web/parts/roadmap/`. Rules: RM-1..RM-12 (12).
> Purpose: show a project curriculum as cycles and steps, tell for each step whether its study is done, and
> give graded hints for the build part of a step without handing over the answer.

---

## 1. Behaviour rules

| ID | Rule | Why | Test |
|---|---|---|---|
| RM-1 | No subject literal. Column names, flag markers, labels, the hint role and levels arrive through props. | Web SoT §0.1. | guard test |
| RM-2 | The roadmap is **read from the instance's planning document at mount** (a Markdown file named by `source.file`), never from a copy. Cycles are the headings matching `source.cycleHeading`; steps are the rows of the tables under each heading whose header row contains `source.columns.step`. Columns are found by header name, so extra columns are ignored. A step's display title is its study text, or its build text when the step has no study (RM-5). | The planning document is edited during planning sessions; a JSON copy would drift from it the first time it changes. | `model.test.ts` parse |
| RM-3 | A step's key is its step cell lowercased and trimmed (`1-1`, `v-2`). Its unit (area) in the outline doc is the one whose key equals it, else the first whose label starts with the step cell followed by a space (`7-4 Gazebo`). A step with no unit shows "no concepts yet". | One key joins the roadmap, the outline and the quiz bank, so nothing has to be kept in sync by hand. The label rule exists because the outline editor derives a key from the typed name (`7-4` becomes `c-7-4`), so a unit the learner adds can only be linked through its name. A missing unit is visible rather than silently counted as zero. | `model.test.ts` unitFor, dom "step without unit" |
| RM-4 | Flags: a cell containing a configured `marker` (for example a bold label) gives the step that flag; the marker is removed from the displayed text and shown as a badge. | The planning document marks steps inline; the badge keeps the mark visible without repeating the text. | parse flags |
| RM-5 | **Study status is derived, never stored**: from the quiz bank (`assembleBank`) and `quiz-log`, for the step's unit: `answered` = problems with at least one verdict, `accuracy` = share of answered problems whose last verdict is correct. Status: `none` (the study cell is empty or only a parenthesised note such as "(already known, skipped)"), `todo` (answered = 0), `studying`, `studied` when `answered >= criterion.minAnswered` and `accuracy >= criterion.minAccuracy`. Defaults 5 and 0.8. | A stored status would be a second counter beside the log (DG-3). Last verdict, so a problem answered right after a mistake counts as learned; the quiz's own accuracy counts every attempt, so this one is labelled "recent accuracy" to keep the two numbers from reading as one. The bank and log come from `parts/quiz/bankload.ts`, the loader the quiz itself uses. | `model.test.ts` status |
| RM-6 | **Build status is owned by the planning document**: the step's `source.columns.status` cell; a value in `source.doneValues` means built. The part only displays it. | The build is checked and recorded in planning sessions (the "완료 확인" step of the cycle); a button here would create a second owner. | parse status |
| RM-7 | The current step is the first step, in document order, that is not built. It opens expanded and the summary line names it. | The learner opens the page to continue where they stopped. | dom "current step" |
| RM-8 | A step offers: solve this step's problems (`quizPreselect`: selects the unit and the play tab, or the bank tab when the unit has no problem yet, then opens the quiz view; a set still in progress is kept), ask about this step (notebook prefill with the step key and title), and hints (RM-9). Each link is shown only when its target view is configured. | The roadmap is the entry point; the other views do the work. The quiz drops a unit with no problem from its selection, so sending the learner to the play tab would silently show every unit; dropping a set in progress would lose answers. | dom links |
| RM-9 | Hints come in the configured `hints.levels`, in order. A level opens only after the previous one was opened for that step. Each request is one `POST /ai` with `hints.system` + the kit directive (§3), the step's study, build and check text, the level's `ask`, the hints already given for the step, and the learner's optional note about where they are stuck. | The learner tries first and takes only as much help as needed; the role split (the learner writes the code) is the instance's rule, passed in its system text. | dom "level gating", "request shape" |
| RM-10 | Before a hint is stored or shown, every fenced code block whose info string is not in `hints.allowFences` (default `["text", "pseudo"]`) is replaced by `hints.labels.codeRemoved`. Inline code stays. | A prompt alone does not stop a model from writing the solution (the same lesson as N-17: a request leaked, a rewrite did not). Pseudocode is asked for in a `text` fence. | `model.test.ts` fence guard |
| RM-11 | Hints are stored in the state collection `roadmap-hints`, one record per step (id = step key with any character outside `[a-z0-9-]` replaced by `-`): `{levels: {<level key>: {text, at}}, note}`. A level can be asked again; the new text replaces the old. | They survive a reload and a device change; one record per step keeps the index small. | dom "hint persists" |
| RM-12 | AI absent → hints are hidden and everything else works (statuses are token 0). | Web SoT §7. | dom "no ai" |

## 2. Props

```ts
interface RoadmapProps {
  storage: StoragePort;
  aiClient: AiClient | null;
  roadmapText: string;                           // the Markdown file's text (host files entry, RM-2)
  source: {
    cycleHeading: string;                         // regex with one group = the cycle label, e.g. "^##\\s+(.+)$"
    cycleFilter?: string;                         // regex a cycle label must match to count (skip other headings)
    columns: { step: string; study: string; build: string; check: string; status?: string };
    doneValues?: string[];                        // RM-6
    flags?: { key: string; marker: string; label: string }[];   // RM-4
  };
  outline: { doc: string };                      // outline state doc (areas = steps)
  criterion?: { minAnswered?: number; minAccuracy?: number };   // RM-5
  links?: { quiz?: { hash: string; label?: string }; notebook?: { hash: string; label?: string } };
  subjectKey: string;                            // localStorage namespace for the cross-view handoffs
  hints?: {
    model?: string; effort?: AiEffort;
    system: string;                              // the instance's tutor role
    levels: { key: string; label: string; ask: string }[];
    allowFences?: string[];
    labels?: Partial<HintLabels>;
  };
  title?: string; intro?: string;
  labels?: Partial<RoadmapLabels>;
}
```

## 3. Kit hint directive (appended to `hints.system`)

Reply in the output language as Markdown. Give only what the requested level asks for. Write short paragraphs
and bullet lists, no headings (the shared renderer numbers each heading as its own step). Never write runnable
code; if structure helps, write pseudocode inside a fence marked `text`. Name the functions, commands or
documents the learner should look up instead of showing their use in full. Build on the hints already given
instead of repeating them.

## 4. Records

```ts
// collection "roadmap-hints", id = step key (RM-11)
interface StepHints { step: string; levels: Record<string, { text: string; at: number }>; note?: string }
```
Reads, never writes: outline doc (`outline.doc`), `quiz-log`, collections `concepts` and `problems` (through the
quiz part's bank loader, so the two views count the same problems).
