# Web Module — Interactive Sheet (`web-sheet`)

> buildflow ② per-folder contract. **Conforms to `web-contract.md` (Web SoT) and the core SoT (`_interface-contract.md`); on conflict the Web SoT, then the core SoT, win.**
> Scope: `web/parts/sheet/` — a spreadsheet-style practice part with a wide formula engine. Problems are **injected** (data), graded **deterministically** (token 0). Plan: `docs/기획_web.md` §2 module ①.

---

## 0. Conformance

- Deterministic, token 0 (Web SoT §0.4): the formula engine and grading run client-side with zero AI calls.
- Binary grading (§0.5) via the engine grader port (Web SoT §3).
- Subject-agnostic (§0.1): all problem content and labels are injected; the part carries no subject literal.
- Optional AI (hints/explanation) is a backlog add-on routed through `ai_server`; v1 is fully deterministic.

---

## 1. Problem data (injected, `CardDef`-aligned)

A sheet problem is injected content (subject config `decks`-style), not AI-generated in v1.

```ts
type CellRef = string;            // A1 notation, e.g. "A1", "B3"
type SheetProblem = {
  problem_id: string;             // stable id (core SoT card_id regex)
  prompt: string;                 // task statement (injected subject content)
  grid: {
    rows: number; cols: number;   // 1..rows, A..(cols)
    cells: Record<CellRef, string>; // initial content per cell: literal or "=formula"; absent = empty
  };
  editable: CellRef[] | "all";    // cells the learner may change
  target: CellRef[];              // cells whose EVALUATED value is graded
  expected: Record<CellRef, string>; // expected evaluated value per target cell
  require_formula?: CellRef[];    // subset of target that must contain a formula (=...), not a hardcoded literal (§3.3)
  normalize?: string[];           // normalization rule ids for the value compare (default: ["nfkc","trim","collapse_space","lower"])
  tags?: { weight?: number; area?: string; subarea?: string };
};
```
- `target` cells typically contain a learner-authored formula; `expected` is the correct evaluated value.
- A problem may also grade that a specific cell *contains a formula* (not a hardcoded literal) — see §3 `require_formula`.

---

## 2. Formula engine (deterministic, pure)

A pure, client-side evaluator. No AI, no network. Reused by grading and live cell display.

- **References**: cell `A1`; range `A1:B3` (rectangular). Relative refs only in v1 (no `$` absolute; backlog).
- **Literals**: number, string, boolean (`TRUE`/`FALSE`).
- **Operators**: `+ - * / ^`, unary `-`, comparison `= <> < <= > >=`, string concat `&`.
- **v1 function set (wide; this is the spec proposal, red-pen)**:
  - Aggregate: `SUM, AVERAGE, MIN, MAX, COUNT, COUNTA`.
  - Logical: `IF, AND, OR, NOT`.
  - Math: `ROUND, ABS, MOD, INT`.
  - Text: `LEN, CONCAT, LEFT, RIGHT, TRIM, UPPER, LOWER`.
  - Lookup/cond (optional v1, else backlog): `SUMIF, COUNTIF`.
- **Evaluation**: dependency-ordered; cyclic reference → `#CYCLE`. Errors: `#REF!` (bad ref), `#DIV/0!`, `#NAME?` (unknown function), `#VALUE!` (type). Errors propagate.
- **Determinism**: no volatile functions (`NOW/RAND` excluded) — keeps grading reproducible (core SoT determinism).
- **Backlog**: absolute refs, `VLOOKUP/INDEX/MATCH`, named ranges, more text/date functions.

---

## 3. Grading (token 0, binary)

1. Evaluate the learner's grid with the §2 engine.
2. For each `target` cell, compare its evaluated value to `expected[cell]` using the **engine grader port** (Web SoT §3) in `exact` mode with the problem's `normalize` rules (number formatting normalized: e.g. `71` == `71.0`).
3. `require_formula` (optional per target): the cell's raw content must start with `=` and reference at least one other cell (rejects a hardcoded answer). Failing it = `incorrect` even if the value matches.
4. **All** targets match → `correct`; otherwise `incorrect`. Binary; no partial credit.
5. Feedback: per-target pass/fail with the expected vs evaluated value (no answer leak beyond the graded cell).

---

## 4. UI

- A grid (rows × cols) with a header row/col (`A B …`, `1 2 …`), a formula bar showing the selected cell's raw content, and the `prompt` above.
- Editable cells per `editable`; non-editable cells are locked and visually distinct.
- Live evaluation as the learner types (token 0). A "채점" action runs §3 and renders the binary result.
- Korean UI strings come from config/defaults (subject-agnostic); the part ships generic defaults only.

---

## 5. Events and progress

- On grade: emit a progress event (Web SoT §5): `{ module:"sheet", item_id: problem_id, verdict, ts }`.
- Optional `read`/seen flags are not used here. Aggregates (per area/subarea) are derived from stored verdicts.

---

## 6. Part header and index

`web/parts/sheet/sheet.ts` carries the header standard (Web SoT §1):
- `WHAT` spreadsheet practice with a formula engine and deterministic grading.
- `DEPS` none beyond the shell + `web/src/grade` port (no heavy lib in v1; a grid is hand-rolled or a tiny dep).
- `INPUT` `SheetProblem` (injected).
- `EVENTS` sheet grade verdict.
- `AI` none (v1).
- `CONSTRAINTS` `subject-agnostic, token0, binary`.
- `DEMO` `web/parts/sheet/` standalone with a mock `SheetProblem`.
Add the matching row to `web/parts/index.json`.

---

## 7. Tests (headless, gate)

- `formula_engine` — function set, ranges, error values, dependency order, no-volatile.
- `sheet_grade` — value compare via the grader port (number-format parity), `require_formula` enforcement, binary verdict on multi-target problems.
- `subject_agnostic` — no subject literal in `parts/sheet/`.
- No live AI (the v1 part makes no AI call).
