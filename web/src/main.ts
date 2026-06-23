// App shell entry (web-contract.md §1). v1 thin slice: mounts the sheet part with a dev demo problem.
// The real shell will enable parts per the subject config and load injected problems; this demo fixture
// is generic spreadsheet practice (no specific subject), used only to drive the first slice.
import { mountSheet, type SheetProblem } from "../parts/sheet/sheet";

const DEMO: SheetProblem = {
  problem_id: "demo-sheet-sum",
  prompt: "A1:A4의 합을 B1에 SUM 함수로 구하세요.",
  grid: { rows: 4, cols: 2, cells: { A1: "1", A2: "2", A3: "3", A4: "10" } },
  editable: ["B1"],
  target: ["B1"],
  expected: { B1: "16" },
  require_formula: ["B1"],
};

const app = document.getElementById("app");
if (app) {
  mountSheet(app, DEMO, (r) => console.log("[sheet] verdict:", r.verdict));
}
