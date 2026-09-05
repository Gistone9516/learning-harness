// The trace model: what a leg's reply is allowed to say, and what happens when it says something
// the project cannot support.
//
// The rule under test throughout is that a trace is a CHAIN, not a bag. `parseAnnotations` drops a
// bad note and keeps the rest because each note stands alone; here a dropped step would make the
// pointer jump with nothing said about why, so the run is cut instead.
import { describe, it, expect } from "vitest";
import {
  changedSince,
  parseTraceLeg,
  traceKey,
  varKey,
  TRACE_STEP_CAP,
  TRACE_MIN_STEPS,
  type TraceVar,
} from "./trace";

/** app.py is 20 lines, service.py is 10. Everything below is measured against these. */
const FILES = new Map([
  ["app.py", 20],
  ["service.py", 10],
]);

const leg = (over: Partial<Parameters<typeof parseTraceLeg>[1]> = {}) => ({
  path: "app.py",
  lineCount: 20,
  startIndex: 0,
  budget: 8,
  ...over,
});

const step = (line: number, over: Record<string, unknown> = {}) => ({
  line,
  explain: `${line}행`,
  vars: [],
  ...over,
});

describe("parseTraceLeg", () => {
  it("numbers steps from where the run already stands, not from one", () => {
    // The index is the position in the whole run, so a second leg continues the first's count.
    const out = parseTraceLeg({ steps: [step(3), step(4)] }, leg({ startIndex: 5 }), FILES);
    expect(out.steps.map((s) => s.index)).toEqual([6, 7]);
  });

  it("stamps every step with the leg's own file, never with anything from the reply", () => {
    // The model is not asked for a path per step; if it volunteers one it is ignored.
    const out = parseTraceLeg({ steps: [step(3, { path: "elsewhere.py" })] }, leg(), FILES);
    expect(out.steps[0].path).toBe("app.py");
  });

  it("cuts the run at a line the file does not have, and says it was cut", () => {
    // Not "drop step 2 and continue with step 3" — that would move the pointer from 1 to 3 with
    // no narration of how control got there.
    const out = parseTraceLeg({ steps: [step(1), step(999), step(4)] }, leg(), FILES);
    expect(out.steps.map((s) => s.line)).toEqual([1]);
    expect(out.truncated).toBe(true);
  });

  it("cuts at a step with nothing to say", () => {
    const out = parseTraceLeg({ steps: [step(1), { line: 2, explain: "  " }, step(3)] }, leg(), FILES);
    expect(out.steps).toHaveLength(1);
    expect(out.truncated).toBe(true);
  });

  it("never clamps a bad line onto real code", () => {
    const out = parseTraceLeg({ steps: [step(0)] }, leg(), FILES);
    expect(out.steps).toEqual([]);
  });

  it("stops at the budget it was given", () => {
    const many = Array.from({ length: 10 }, (_, i) => step(i + 1));
    const out = parseTraceLeg({ steps: many }, leg({ budget: 3 }), FILES);
    expect(out.steps).toHaveLength(3);
    expect(out.truncated).toBe(true);
  });

  it("treats a reply with no steps array as unusable", () => {
    expect(parseTraceLeg({ narration: "그 다음 서비스가 실행됩니다" }, leg(), FILES).steps).toEqual([]);
    expect(parseTraceLeg(null, leg(), FILES).truncated).toBe(true);
  });
});

describe("the cross-file jump, the one place a path can be invented", () => {
  it("accepts a jump into a real file at a real line", () => {
    const out = parseTraceLeg(
      { steps: [step(3)], leaves_to: { path: "service.py", line: 4 } },
      leg(),
      FILES,
    );
    expect(out.leavesTo).toEqual({ path: "service.py", line: 4 });
    expect(out.truncated).toBeFalsy();
  });

  it("refuses a file the project does not have, and ends the run there", () => {
    // Following an invented path would open a file that does not exist, or worse, silently
    // continue in the current one.
    const out = parseTraceLeg(
      { steps: [step(3)], leaves_to: { path: "sqlalchemy/orm.py", line: 88 } },
      leg(),
      FILES,
    );
    expect(out.leavesTo).toBeNull();
    expect(out.truncated).toBe(true);
  });

  it("refuses a real file at a line it does not have", () => {
    const out = parseTraceLeg(
      { steps: [step(3)], leaves_to: { path: "service.py", line: 400 } },
      leg(),
      FILES,
    );
    expect(out.leavesTo).toBeNull();
    expect(out.truncated).toBe(true);
  });

  it("is not a truncation when the model simply had nowhere to go", () => {
    const out = parseTraceLeg({ steps: [step(3)], leaves_to: null, done: true }, leg(), FILES);
    expect(out.leavesTo).toBeNull();
    expect(out.done).toBe(true);
    expect(out.truncated).toBe(false);
  });
});

describe("variables", () => {
  it("keeps the scope when the model distinguishes frames, and drops a nameless binding", () => {
    const out = parseTraceLeg(
      {
        steps: [
          step(1, {
            vars: [
              { name: "book_id", value: "7", scope: "borrow" },
              { name: "  ", value: "버려짐" },
              { name: "db", value: "Session(...)" },
            ],
          }),
        ],
      },
      leg(),
      FILES,
    );
    expect(out.steps[0].vars).toEqual([
      { name: "book_id", value: "7", scope: "borrow" },
      { name: "db", value: "Session(...)" },
    ]);
  });
});

describe("changedSince", () => {
  const v = (name: string, value: string, scope?: string): TraceVar =>
    scope ? { name, value, scope } : { name, value };

  it("marks nothing on the first step", () => {
    // Everything is new there. Highlighting all of it says only "this is the beginning", which
    // the step counter already says.
    expect(changedSince(undefined, [v("a", "1"), v("b", "2")]).size).toBe(0);
  });

  it("marks a value that moved and leaves the rest alone", () => {
    const changed = changedSince([v("a", "1"), v("b", "2")], [v("a", "9"), v("b", "2")]);
    expect([...changed]).toEqual([varKey(v("a", "9"))]);
  });

  it("marks a binding that did not exist before", () => {
    const changed = changedSince([v("a", "1")], [v("a", "1"), v("total", "0")]);
    expect(changed.has(varKey(v("total", "0")))).toBe(true);
  });

  it("keeps two frames' same-named variables apart", () => {
    // `db` in the handler and `db` in the service are different bindings; treating them as one
    // would show a change that never happened.
    const prev = [v("db", "A", "handler")];
    const cur = [v("db", "A", "handler"), v("db", "B", "service")];
    const changed = changedSince(prev, cur);
    expect(changed.has(varKey(v("db", "B", "service")))).toBe(true);
    expect(changed.has(varKey(v("db", "A", "handler")))).toBe(false);
  });
});

describe("traceKey", () => {
  it("carries a path verbatim, because it is a record field and not an id", () => {
    // STORAGE_NAME_RE would reject every character in here. That is fine: this never becomes an
    // id. `AnnotationSet.files` keys by path the same way.
    expect(traceKey("src/api/routes.py", 42)).toBe("src/api/routes.py:42");
  });
});

describe("the budget constants", () => {
  it("asks for fewer steps per leg than a whole run may hold", () => {
    // Otherwise one leg could spend the entire run and a cross-file trace could never happen.
    expect(TRACE_STEP_CAP).toBeGreaterThan(TRACE_MIN_STEPS);
  });
});
