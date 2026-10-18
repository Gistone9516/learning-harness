import { describe, expect, it } from "vitest";
import { currentStep, guardFences, hintId, hintRequest, levelOpen, parseRoadmap, studyStatus, unitFor, type RoadmapSource } from "./model";
import { unitProgress, type QuizLog, type QuizProblem } from "../quiz/model";

const SRC: RoadmapSource = {
  cycleHeading: "^## (Cycle .+)$",
  columns: { step: "Step", study: "Study", build: "Build", check: "Check", status: "State" },
  doneValues: ["done"],
  flags: [{ key: "cost", marker: "**COST**", label: "cost" }, { key: "opt", marker: "(optional)", label: "optional" }],
};

const MD = [
  "# Plan",
  "| Step | Study | Build | Check | State |",
  "|---|---|---|---|---|",
  "| X-1 | not a cycle | x | x | waiting |",
  "## Cycle 0. Setup",
  "| Step | Study | Build | Check | State |",
  "|---|---|---|---|---|",
  "| 0-1 | (known, skipped) | make repo | first push | done |",
  "| 0-2 | robot state | Robot class | tests pass | waiting |",
  "",
  "Some prose.",
  "## Cycle V. Video",
  "| Step | Block | Study | Build | Check | State |",
  "|---|---|---|---|---|---|",
  "| V-1 | common | codecs, fps | capture frames. **COST** bandwidth | frames arrive | waiting |",
  "| V-2 | common | (optional) WebRTC | relay | works | waiting |",
  "## Decisions",
  "| Date | Decision |",
  "|---|---|",
  "| 1 | 2 |",
].join("\n");

describe("parseRoadmap", () => {
  const cycles = parseRoadmap(MD, SRC);
  it("reads only matching headings and finds columns by name (RM-2)", () => {
    expect(cycles.map((c) => c.label)).toEqual(["Cycle 0. Setup", "Cycle V. Video"]);
    expect(cycles[1].steps[0]).toMatchObject({ key: "v-1", code: "V-1", study: "codecs, fps", check: "frames arrive" });
  });
  it("keys are lowercased step cells (RM-3)", () => {
    expect(cycles.flatMap((c) => c.steps.map((s) => s.key))).toEqual(["0-1", "0-2", "v-1", "v-2"]);
  });
  it("flags strip their marker and become keys (RM-4)", () => {
    expect(cycles[1].steps[0].build).toBe("capture frames. bandwidth");
    expect(cycles[1].steps[0].flags).toEqual(["cost"]);
    expect(cycles[1].steps[1]).toMatchObject({ study: "WebRTC", flags: ["opt"] });
  });
  it("build status comes from the document (RM-6); a parenthesised study is no study (RM-5)", () => {
    expect(cycles[0].steps[0]).toMatchObject({ built: true, noStudy: true, title: "make repo" });
    expect(cycles[0].steps[1]).toMatchObject({ built: false, noStudy: false, title: "robot state", status: "waiting" });
  });
  it("cycleFilter skips headings that match the pattern but not the filter", () => {
    const only = parseRoadmap(MD, { ...SRC, cycleFilter: "Video" });
    expect(only.map((c) => c.label)).toEqual(["Cycle V. Video"]);
  });
  it("a step finds its unit by key, else by a label that starts with its cell (RM-3)", () => {
    const [s02] = cycles[0].steps.slice(1);
    const v1 = cycles[1].steps[0];
    expect(unitFor(s02, [{ key: "0-2", label: "x" }])).toBe("0-2");
    expect(unitFor(v1, [{ key: "c-v-1", label: "V-1 codecs" }])).toBe("c-v-1");
    expect(unitFor(v1, [{ key: "c-v-10", label: "V-10 other" }])).toBeNull();
    expect(unitFor(s02, [])).toBeNull();
  });
  it("the current step is the first not built (RM-7)", () => {
    expect(currentStep(cycles)?.key).toBe("0-2");
    expect(currentStep([])).toBeNull();
  });
});

describe("studyStatus (RM-5)", () => {
  const step = parseRoadmap(MD, SRC)[0].steps[1];
  const none = parseRoadmap(MD, SRC)[0].steps[0];
  const p = (id: string, area: string) => ({ card_id: id, area, concept_id: area + "-c" }) as unknown as QuizProblem;
  const bank = ["a", "b", "c", "d", "e", "f"].map((id) => p(id, "0-2"));
  const log = (h: Record<string, ("c" | "i")[]>): QuizLog => ({ items: Object.fromEntries(Object.entries(h).map(([k, v]) => [k, { h: v }])) });
  const crit = { minAnswered: 5, minAccuracy: 0.8 };
  it("none, todo, studying, studied", () => {
    expect(studyStatus(none, undefined, crit)).toBe("none");
    expect(studyStatus(step, unitProgress(bank, log({})).get("0-2"), crit)).toBe("todo");
    expect(studyStatus(step, unitProgress(bank, log({ a: ["c"], b: ["c"] })).get("0-2"), crit)).toBe("studying");
    const four = log({ a: ["c"], b: ["c"], c: ["c"], d: ["c"], e: ["i"] });
    expect(studyStatus(step, unitProgress(bank, four).get("0-2"), crit)).toBe("studied");
    const three = log({ a: ["c"], b: ["c"], c: ["c"], d: ["i"], e: ["i"] });
    expect(studyStatus(step, unitProgress(bank, three).get("0-2"), crit)).toBe("studying");
  });
  it("uses the last verdict, not every attempt", () => {
    const fixed = log({ a: ["i", "i", "c"], b: ["c"], c: ["c"], d: ["c"], e: ["c"] });
    expect(unitProgress(bank, fixed).get("0-2")).toEqual({ total: 6, answered: 5, lastCorrect: 5 });
  });
});

describe("hints", () => {
  const levels = [{ key: "a", label: "L1", ask: "one" }, { key: "b", label: "L2", ask: "two" }];
  it("a level opens after the previous one (RM-9)", () => {
    expect(levelOpen(levels, null, 0)).toBe(true);
    expect(levelOpen(levels, null, 1)).toBe(false);
    expect(levelOpen(levels, { step: "s", levels: { a: { text: "x", at: 1 } } }, 1)).toBe(true);
  });
  it("code fences are replaced unless allowed (RM-10)", () => {
    const md = "intro\n```python\nprint(1)\n```\nmid `inline()` ok\n```text\nloop: move\n```\n```\nbare\n```\nend\n~~~js\nx\n";
    const out = guardFences(md, ["text", "pseudo"], "[removed]");
    expect(out).toBe("intro\n[removed]\nmid `inline()` ok\n```text\nloop: move\n```\n[removed]\nend\n[removed]");
  });
  it("hint ids are state-safe (RM-11)", () => {
    expect(hintId("1-1")).toBe("1-1");
    expect(hintId("V-2")).toBe("v-2");
    expect(hintId("S 1.2")).toBe("s-1-2");
  });
  it("the request carries the step, the level, earlier hints and the note (RM-9)", () => {
    const step = parseRoadmap(MD, SRC)[0].steps[1];
    const r = hintRequest(step, levels[1], { step: "0-2", levels: { a: { text: "first", at: 1 } }, note: " stuck " }, levels, { system: "ROLE", levels, model: "m" });
    expect(r.system.startsWith("ROLE\n\n[Hint rules]")).toBe(true);
    expect(r).toMatchObject({ model: "m", effort: "medium" });
    expect(JSON.parse(r.prompt)).toEqual({
      step: { id: "0-2", study: "robot state", build: "Robot class", check: "tests pass" },
      level: { label: "L2", ask: "two" },
      hints_already_given: [{ level: "L1", text: "first" }],
      learner_note: "stuck",
    });
  });
});
