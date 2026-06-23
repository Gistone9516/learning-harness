import { describe, it, expect } from "vitest";
import { evaluateSheet, formatValue, type Grid, type CellValue } from "./formula";

function ev(grid: Grid): Record<string, CellValue> {
  return evaluateSheet(grid);
}
function val(grid: Grid, ref: string): string {
  return formatValue(evaluateSheet(grid)[ref]);
}

describe("formula engine — literals and arithmetic", () => {
  it("literals", () => {
    const c = ev({ A1: "5", A2: "text", A3: "TRUE", A4: "FALSE" });
    expect(c.A1).toBe(5);
    expect(c.A2).toBe("text");
    expect(c.A3).toBe(true);
    expect(c.A4).toBe(false);
  });
  it("arithmetic + precedence", () => {
    expect(val({ B1: "=1+2*3" }, "B1")).toBe("7");
    expect(val({ B1: "=(1+2)*3" }, "B1")).toBe("9");
    expect(val({ B1: "=2^3" }, "B1")).toBe("8");
    expect(val({ B1: "=-5+2" }, "B1")).toBe("-3");
  });
  it("references and dependency order", () => {
    const g = { A1: "5", B1: "=A1*2", C1: "=B1+1" };
    expect(val(g, "B1")).toBe("10");
    expect(val(g, "C1")).toBe("11");
  });
});

describe("formula engine — functions", () => {
  const data = { A1: "1", A2: "2", A3: "3", A4: "10" };
  it("aggregate over a range", () => {
    expect(val({ ...data, C1: "=SUM(A1:A4)" }, "C1")).toBe("16");
    expect(val({ ...data, C1: "=AVERAGE(A1:A3)" }, "C1")).toBe("2");
    expect(val({ ...data, C1: "=MIN(A1:A4)" }, "C1")).toBe("1");
    expect(val({ ...data, C1: "=MAX(A1:A4)" }, "C1")).toBe("10");
    expect(val({ ...data, C1: "=COUNT(A1:A4)" }, "C1")).toBe("4");
  });
  it("logical", () => {
    expect(val({ A1: "8", B1: '=IF(A1>5,"big","small")' }, "B1")).toBe("big");
    expect(val({ A1: "3", B1: '=IF(A1>5,"big","small")' }, "B1")).toBe("small");
    expect(val({ B1: "=AND(TRUE,1>0)" }, "B1")).toBe("TRUE");
    expect(val({ B1: "=OR(FALSE,1>2)" }, "B1")).toBe("FALSE");
    expect(val({ B1: "=NOT(1>2)" }, "B1")).toBe("TRUE");
  });
  it("math", () => {
    expect(val({ B1: "=ROUND(3.14159,2)" }, "B1")).toBe("3.14");
    expect(val({ B1: "=ABS(-7)" }, "B1")).toBe("7");
    expect(val({ B1: "=MOD(10,3)" }, "B1")).toBe("1");
    expect(val({ B1: "=INT(3.9)" }, "B1")).toBe("3");
  });
  it("text", () => {
    expect(val({ B1: '=LEN("hello")' }, "B1")).toBe("5");
    expect(val({ B1: '=CONCAT("a","b","c")' }, "B1")).toBe("abc");
    expect(val({ B1: '=UPPER("ab")' }, "B1")).toBe("AB");
    expect(val({ B1: '="a"&"b"' }, "B1")).toBe("ab");
  });
  it("conditional aggregate", () => {
    const g = { A1: "5", A2: "12", A3: "8", C1: "=SUMIF(A1:A3,\">7\")", C2: "=COUNTIF(A1:A3,\">7\")" };
    expect(val(g, "C1")).toBe("20");
    expect(val(g, "C2")).toBe("2");
  });
});

describe("formula engine — comparisons and errors", () => {
  it("comparison", () => {
    expect(val({ B1: "=3>2" }, "B1")).toBe("TRUE");
    expect(val({ B1: "=2>=3" }, "B1")).toBe("FALSE");
    expect(val({ A1: "5", B1: "=A1=5" }, "B1")).toBe("TRUE");
  });
  it("division by zero", () => {
    expect(val({ B1: "=1/0" }, "B1")).toBe("#DIV/0!");
  });
  it("cycle detection", () => {
    const c = ev({ A1: "=B1", B1: "=A1" });
    expect(formatValue(c.A1)).toBe("#CYCLE");
  });
  it("unknown function", () => {
    expect(val({ B1: "=FOO(1)" }, "B1")).toBe("#NAME?");
  });
  it("error propagates through arithmetic", () => {
    expect(val({ A1: "=1/0", B1: "=A1+1" }, "B1")).toBe("#DIV/0!");
  });
});
