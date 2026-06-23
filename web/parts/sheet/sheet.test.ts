import { describe, it, expect } from "vitest";
import { gradeSheet, type SheetProblem } from "./sheet";

function sumProblem(extra: Partial<SheetProblem> = {}): SheetProblem {
  return {
    problem_id: "p-sum",
    prompt: "sum A1:A4 into B1",
    grid: { rows: 4, cols: 2, cells: { A1: "1", A2: "2", A3: "3", A4: "10" } },
    editable: ["B1"],
    target: ["B1"],
    expected: { B1: "16" },
    ...extra,
  };
}

describe("gradeSheet", () => {
  it("correct when the target formula evaluates to expected", () => {
    const p = sumProblem();
    const cells = { ...p.grid.cells, B1: "=SUM(A1:A4)" };
    const r = gradeSheet(p, cells);
    expect(r.verdict).toBe("correct");
    expect(r.perTarget[0]).toMatchObject({ ref: "B1", got: "16", ok: true });
  });

  it("incorrect when the value is wrong", () => {
    const p = sumProblem();
    const cells = { ...p.grid.cells, B1: "=SUM(A1:A3)" }; // 6, not 16
    expect(gradeSheet(p, cells).verdict).toBe("incorrect");
  });

  it("require_formula rejects a hardcoded literal even if the value matches", () => {
    const p = sumProblem({ require_formula: ["B1"] });
    const hard = { ...p.grid.cells, B1: "16" };       // correct value but no formula
    expect(gradeSheet(p, hard).verdict).toBe("incorrect");
    const formula = { ...p.grid.cells, B1: "=SUM(A1:A4)" };
    expect(gradeSheet(p, formula).verdict).toBe("correct");
  });

  it("number-format parity: 71 vs 71.0 via the grader port", () => {
    const p: SheetProblem = {
      problem_id: "p-num", prompt: "x", grid: { rows: 1, cols: 2, cells: { A1: "71" } },
      editable: ["B1"], target: ["B1"], expected: { B1: "71" },
    };
    expect(gradeSheet(p, { ...p.grid.cells, B1: "=A1" }).verdict).toBe("correct");
  });

  it("multi-target requires all cells correct", () => {
    const p: SheetProblem = {
      problem_id: "p-multi", prompt: "x",
      grid: { rows: 2, cols: 3, cells: { A1: "4", A2: "6" } },
      editable: ["B1", "C1"], target: ["B1", "C1"],
      expected: { B1: "10", C1: "24" },
    };
    expect(gradeSheet(p, { ...p.grid.cells, B1: "=A1+A2", C1: "=A1*A2" }).verdict).toBe("correct");
    expect(gradeSheet(p, { ...p.grid.cells, B1: "=A1+A2", C1: "=A1+A2" }).verdict).toBe("incorrect");
  });
});
