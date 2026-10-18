// @vitest-environment jsdom
//
// roadmap part (specs/web-roadmap.md): behaviour against in-memory storage and a scripted AI.
import { beforeEach, describe, expect, it } from "vitest";
import { mountRoadmap, type RoadmapProps } from "./roadmap";
import { HINTS, type RoadmapSource, type StepHints } from "./model";
import type { AiClient, AiRequest } from "../../src/ai/client";
import type { GeneratedConcept } from "../conceptprob/conceptprob";
import { quizPreselect, quizStateKey } from "../quiz/bankload";
import { memoryStorage } from "../../tests/memoryStorage";

const SRC: RoadmapSource = {
  cycleHeading: "^## (Cycle .+)$",
  columns: { step: "Step", study: "Study", build: "Build", check: "Check", status: "State" },
  doneValues: ["done"],
  flags: [{ key: "cost", marker: "**COST**", label: "cost record" }],
};
const MD = [
  "## Cycle 0. Setup",
  "| Step | Study | Build | Check | State |",
  "|---|---|---|---|---|",
  "| 0-1 | (skipped) | make repo | first push | done |",
  "| 0-2 | robot state | Robot class **COST** | tests pass | waiting |",
  "| 0-3 | loops | game loop | demo | waiting |",
  "## Cycle 1. Net",
  "| Step | Study | Build | Check | State |",
  "|---|---|---|---|---|",
  "| 1-1 | sockets | echo server | two terminals | waiting |",
].join("\n");
const OUTLINE = {
  areas: [{ key: "0-2", label: "0-2" }, { key: "1-1", label: "1-1" }],
  conceptOutline: { "0-2": [{ concept_id: "0-2-01", title: "pose" }], "1-1": [{ concept_id: "1-1-01", title: "socket" }] },
};
const judge = (id: string) => ({
  card_id: id, type: "judge" as const, grade_mode: "exact" as const,
  front: { scenario: id, options: ["a", "b", "c", "d"] }, answer_spec: { normalize: ["lower"], accepted: ["a"] },
});
const CONCEPT: GeneratedConcept = { area: "0-2", concept_id: "0-2-01", title: "pose", body: "b", problems: ["q1", "q2", "q3", "q4", "q5"].map(judge) };

function scriptedAi(reply: (r: AiRequest) => string, ok = true) {
  const calls: AiRequest[] = [];
  return {
    calls,
    async ai(r: AiRequest) { calls.push(r); return { ok, text: ok ? reply(r) : "", session_id: null, error: ok ? null : "x" }; },
    async problems() { return { ok: true, problems: [], error: null }; },
    async repos() { return { ok: false, reason: "call", error: "n/a" }; },
    async health() { return true; },
  } as unknown as AiClient & { calls: AiRequest[] };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle(n = 30) { for (let i = 0; i < n; i++) await tick(); }
const LEVELS = [{ key: "concept", label: "Concepts", ask: "L1" }, { key: "approach", label: "Approach", ask: "L2" }];

describe("roadmap part", () => {
  let root: HTMLElement;
  let storage: ReturnType<typeof memoryStorage>;
  const base = (over: Partial<RoadmapProps> = {}): RoadmapProps => ({
    storage, aiClient: null, roadmapText: MD, source: SRC, outline: { doc: "outline" }, subjectKey: "s", ...over,
  });
  beforeEach(async () => {
    localStorage.clear(); document.body.innerHTML = ""; root = document.createElement("div"); document.body.appendChild(root);
    storage = memoryStorage();
    storage.docs.set("outline", OUTLINE);
    await storage.put("concepts", { kind: "concept", id: "0-2-01", summary: {}, data: CONCEPT });
  });

  it("shows cycles, the current step open, flags and derived statuses (RM-4..RM-7)", async () => {
    storage.docs.set("quiz-log", { items: { q1: { h: ["c"] }, q2: { h: ["c"] }, q3: { h: ["c"] }, q4: { h: ["i", "c"] }, q5: { h: ["c"] } } });
    mountRoadmap(root, base());
    await settle();
    expect(Array.from(root.querySelectorAll(".lh-rm-cycle-label")).map((e) => e.textContent)).toEqual(["Cycle 0. Setup", "Cycle 1. Net"]);
    const cur = root.querySelector<HTMLDetailsElement>(".lh-rm-step--current")!;
    expect(cur.dataset.step).toBe("0-2");
    expect(cur.open).toBe(true);
    expect(root.querySelector(".lh-rm-sum-step")!.textContent).toBe("0-2 robot state");
    const tags = (key: string) => Array.from(root.querySelectorAll(`[data-step="${key}"] .lh-rm-tags > *`)).map((e) => e.textContent);
    expect(tags("0-1")).toEqual(["공부 없음", "구현 done"]);
    expect(tags("0-2")).toEqual(["지금", "cost record", "공부 끝", "구현 waiting"]);
    expect(tags("1-1")).toEqual(["공부 전", "구현 waiting"]);
    expect(cur.querySelector(".lh-rm-prog-line")!.textContent).toContain("푼 문제 5/5 · 최근 정답률 100%");
    expect(root.querySelector(".lh-rm-cycle-count")!.textContent).toBe("1/3");
  });

  it("a step without a unit says so (RM-3)", async () => {
    mountRoadmap(root, base());
    await settle();
    const d = root.querySelector<HTMLDetailsElement>('[data-step="0-3"]')!;
    d.open = true;
    d.dispatchEvent(new Event("toggle"));
    expect(d.querySelector(".lh-rm-prog")!.textContent).toContain("아직 개념이 없습니다");
  });

  it("links hand off to the quiz and the notebook (RM-8)", async () => {
    const runs: [string, boolean][] = [], asks: string[] = [];
    mountRoadmap(root, base({ solve: { label: "Solve", run: (u, h) => runs.push([u, h]) }, ask: { label: "Ask", onAsk: (t) => asks.push(t) } }));
    await settle();
    const cur = root.querySelector<HTMLElement>(".lh-rm-step--current")!;
    Array.from(cur.querySelectorAll<HTMLButtonElement>(".lh-nb-btn")).find((b) => b.textContent === "Solve")!.click();
    Array.from(cur.querySelectorAll<HTMLButtonElement>(".lh-nb-btn")).find((b) => b.textContent === "Ask")!.click();
    expect(runs).toEqual([["0-2", true]]);
    expect(asks).toEqual(["[0-2] robot state: "]);
  });

  it("quizPreselect selects the unit and tab, keeps a set in progress, clears a finished one (RM-8)", () => {
    localStorage.setItem(quizStateKey("s", "set"), JSON.stringify({ finished: false, ids: ["x"] }));
    quizPreselect("s", ["0-2"], "bank");
    expect(localStorage.getItem("lh:s:quiz:units")).toBe('["0-2"]');
    expect(localStorage.getItem("lh:s:quiz:tab")).toBe("bank");
    expect(localStorage.getItem("lh:s:quiz:set")).not.toBeNull();
    localStorage.setItem(quizStateKey("s", "set"), JSON.stringify({ finished: true }));
    quizPreselect("s", ["0-2"]);
    expect(localStorage.getItem("lh:s:quiz:set")).toBeNull();
    expect(localStorage.getItem("lh:s:quiz:tab")).toBe("play");
  });

  it("hints open in order, strip code, persist with the note (RM-9..RM-11)", async () => {
    const ai = scriptedAi((r) => (JSON.parse(r.prompt).level.label === "Concepts" ? "Use **asyncio**.\n```python\nimport asyncio\n```" : "1. move"));
    mountRoadmap(root, base({ aiClient: ai, hints: { system: "ROLE", levels: LEVELS, labels: { codeRemoved: "[no code]" } } }));
    await settle();
    const cur = root.querySelector<HTMLElement>(".lh-rm-step--current")!;
    const buttons = () => Array.from(cur.querySelectorAll<HTMLButtonElement>(".lh-rm-level-head .lh-nb-btn"));
    expect(buttons().map((b) => b.disabled)).toEqual([false, true]);
    const note = cur.querySelector<HTMLTextAreaElement>(".lh-rm-note")!;
    note.value = "stuck at the loop";
    buttons()[0].click();
    await settle();
    expect(ai.calls).toHaveLength(1);
    expect(JSON.parse(ai.calls[0].prompt).learner_note).toBe("stuck at the loop");
    const rec = storage.cols.get(HINTS)!.get("0-2")!.data as StepHints;
    expect(rec.levels["concept"].text).toBe("Use **asyncio**.\n[no code]");
    expect(rec.note).toBe("stuck at the loop");
    expect(cur.querySelector(".lh-rm-level-body")!.textContent).toContain("[no code]");
    expect(cur.textContent).not.toContain("import asyncio");
    expect(buttons().map((b) => b.disabled)).toEqual([false]);   // level 2 is now open; level 1 shows its body
    buttons()[0].click();
    await settle();
    expect(JSON.parse(ai.calls[1].prompt).hints_already_given).toEqual([{ level: "Concepts", text: "Use **asyncio**.\n[no code]" }]);
  });

  it("a failed hint stores nothing and says so", async () => {
    const ai = scriptedAi(() => "", false);
    mountRoadmap(root, base({ aiClient: ai, hints: { system: "ROLE", levels: LEVELS } }));
    await settle();
    root.querySelector<HTMLButtonElement>(".lh-rm-step--current .lh-rm-level-head .lh-nb-btn")!.click();
    await settle();
    expect(root.querySelector(".lh-nb-bubble--error")).not.toBeNull();
    expect(storage.cols.get(HINTS)?.size ?? 0).toBe(0);
  });

  it("no AI hides hints and keeps statuses (RM-12)", async () => {
    mountRoadmap(root, base({ hints: { system: "ROLE", levels: LEVELS } }));
    await settle();
    expect(root.querySelector(".lh-rm-hints")).toBeNull();
    expect(root.querySelector(".lh-rm-step--current .lh-rm-tags")!.textContent).toContain("공부 전");
  });

  it("an empty planning document is reported, not rendered blank", async () => {
    mountRoadmap(root, base({ roadmapText: "" }));
    await settle();
    expect(root.textContent).toContain("로드맵 파일을 읽지 못했습니다");
  });
});
