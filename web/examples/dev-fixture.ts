// Dev-only fixture for `npm run dev` preview. NOT kit content — a consuming instance injects its own
// AppConfig (globalThis.LH_CONFIG). Lives under examples/, excluded from the subject-agnostic guard.
import type { AppConfig } from "../src/shell";
import type { SheetProblem } from "../parts/sheet/sheet";

const demoSheet: SheetProblem = {
  problem_id: "demo-sheet-sum",
  prompt: "A1:A4의 합을 B1에 SUM 함수로 구하세요.",
  grid: { rows: 4, cols: 2, cells: { A1: "1", A2: "2", A3: "3", A4: "10" } },
  editable: ["B1"],
  target: ["B1"],
  expected: { B1: "16" },
  require_formula: ["B1"],
};

export const devConfig: AppConfig = { part: "sheet", data: demoSheet };
