// WHAT: Interactive spreadsheet practice — fill cells/formulas, graded deterministically (token 0).
// DEPS: ./formula (engine), web/src/grade (grader port). No npm UI lib (grid is hand-rolled).
// INPUT: SheetProblem (injected, web-sheet.md §1).
// EVENTS: emits a SheetResult {verdict, perTarget} on grade (binary verdict).
// AI: none.
// CONSTRAINTS: subject-agnostic (content injected), token0 (no AI), binary grading via the engine port.
// DEMO: mountSheet(el, problem, onResult) with a mock SheetProblem; see web/src/main.ts.
import { evaluateSheet, formatValue, type Grid } from "./formula";
import { score } from "../../src/grade/grade";

export type CellRef = string;
export interface SheetProblem {
  problem_id: string;
  prompt: string;
  grid: { rows: number; cols: number; cells: Record<CellRef, string> };
  editable: CellRef[] | "all";
  target: CellRef[];
  expected: Record<CellRef, string>;
  require_formula?: CellRef[];
  normalize?: string[];
  tags?: { weight?: number; area?: string; subarea?: string };
}

export interface TargetResult { ref: CellRef; got: string; expected: string; ok: boolean }
export interface SheetResult { verdict: "correct" | "incorrect"; perTarget: TargetResult[] }

const DEFAULT_NORMALIZE = ["nfkc", "trim", "collapse_space", "lower"];
const CELL_REF_RE = /[A-Z]+[0-9]+/;

// ── Pure grading (web-sheet.md §3; token 0, binary) ─────────────────────────────

export function gradeSheet(problem: SheetProblem, cells: Grid): SheetResult {
  const values = evaluateSheet(cells);
  const rules = problem.normalize ?? DEFAULT_NORMALIZE;
  const requireFormula = new Set(problem.require_formula ?? []);
  const perTarget: TargetResult[] = problem.target.map((ref) => {
    const got = formatValue(values[ref] ?? "");
    const expected = problem.expected[ref] ?? "";
    let ok = true;
    if (requireFormula.has(ref)) {
      const raw = (cells[ref] ?? "").trim();
      if (!(raw.startsWith("=") && CELL_REF_RE.test(raw))) ok = false; // must be a formula referencing a cell
    }
    if (ok) {
      const r = score({ mode: "exact", user_answer: got, answer_spec: { normalize: rules, accepted: [expected] } });
      ok = r.verdict === "correct";
    }
    return { ref, got, expected, ok };
  });
  const verdict: SheetResult["verdict"] = perTarget.every((t) => t.ok) ? "correct" : "incorrect";
  return { verdict, perTarget };
}

// ── DOM UI ──────────────────────────────────────────────────────────────────────

function isEditable(problem: SheetProblem, ref: CellRef): boolean {
  return problem.editable === "all" || problem.editable.includes(ref);
}
function colLetter(n: number): string {
  let s = ""; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s;
}

export function mountSheet(
  container: HTMLElement,
  problem: SheetProblem,
  onResult?: (r: SheetResult) => void,
): void {
  const cells: Grid = { ...problem.grid.cells };
  container.innerHTML = "";
  container.classList.add("lh-sheet");

  const prompt = document.createElement("p");
  prompt.className = "lh-sheet-prompt";
  prompt.textContent = problem.prompt;
  container.appendChild(prompt);

  const table = document.createElement("table");
  table.className = "lh-sheet-grid";
  const { rows, cols } = problem.grid;

  // header row
  const head = table.insertRow();
  head.insertCell().outerHTML = "<th></th>";
  for (let c = 1; c <= cols; c++) { const th = document.createElement("th"); th.textContent = colLetter(c); head.appendChild(th); }

  const liveCells: Record<CellRef, HTMLElement> = {};
  for (let r = 1; r <= rows; r++) {
    const tr = table.insertRow();
    const rh = document.createElement("th"); rh.textContent = String(r); tr.appendChild(rh);
    for (let c = 1; c <= cols; c++) {
      const ref = colLetter(c) + r;
      const td = tr.insertCell();
      if (isEditable(problem, ref)) {
        const input = document.createElement("input");
        input.type = "text";
        input.value = cells[ref] ?? "";
        input.setAttribute("aria-label", ref);
        input.addEventListener("input", () => { cells[ref] = input.value; refresh(); });
        td.appendChild(input);
      } else {
        td.classList.add("lh-locked");
        liveCells[ref] = td;
      }
    }
  }
  container.appendChild(table);

  const gradeBtn = document.createElement("button");
  gradeBtn.className = "lh-sheet-grade";
  gradeBtn.textContent = "채점";
  container.appendChild(gradeBtn);

  const out = document.createElement("div");
  out.className = "lh-sheet-result";
  container.appendChild(out);

  function refresh(): void {
    const values = evaluateSheet(cells);
    for (const ref of Object.keys(liveCells)) liveCells[ref].textContent = formatValue(values[ref] ?? "");
  }
  gradeBtn.addEventListener("click", () => {
    const res = gradeSheet(problem, cells);
    out.textContent = res.verdict === "correct" ? "정답" : "오답";
    out.dataset.verdict = res.verdict;
    onResult?.(res);
  });

  refresh();
}
