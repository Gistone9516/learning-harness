// @vitest-environment jsdom
//
// quiz part (specs/web-quiz.md): pure rules and behaviour against in-memory storage and a scripted AI.
import { describe, it, expect, beforeEach } from "vitest";
import { assembleBank, buildSet, logAnswer, markDeleted, parseTranslation, setFlag, validKo, type QuizLog } from "./model";
import { mountQuiz } from "./quiz";
import type { GeneratedConcept } from "../conceptprob/conceptprob";
import type { AiClient, AiRequest, GenProblemsRequest } from "../../src/ai/client";
import { memoryStorage } from "../../tests/memoryStorage";

const OUTLINE = { areas: [{ key: "p04", label: "04 Storage" }], conceptOutline: { p04: [{ concept_id: "p04-ebs", title: "EBS" }] } };
const judge = (id: string, ok = "EBS") => ({
  card_id: id, type: "judge" as const, grade_mode: "exact" as const,
  front: { scenario: `Which is block storage? (${id})`, options: ["EBS", "EFS", "S3", "Glacier"] },
  answer_spec: { normalize: ["lower"], accepted: [ok] }, explain: "EFS는 **파일**",
});
const CONCEPT: GeneratedConcept = { area: "p04", concept_id: "p04-ebs", title: "EBS", body: "b", problems: [judge("q1"), judge("q2")] };
const empty: QuizLog = { items: {} };

describe("quiz model", () => {
  it("assembles concept + generated problems, skipping deleted ones and keeping valid translations (Q-2)", () => {
    const bank = assembleBank(OUTLINE, { "p04-ebs": CONCEPT }, { "p04-ebs": { generated: [{ ...judge("g1"), area: "x", concept_id: "y" }], ko: { q1: { scenario: "블록?", options: ["a", "b", "c", "d"] }, q2: { scenario: "x", options: ["a"] } } } }, markDeleted(empty, "q2", "dup"));
    expect(bank.map((p) => p.card_id)).toEqual(["q1", "g1"]);
    expect(bank[0].front_ko?.scenario).toBe("블록?");
    expect(bank[1].area).toBe("p04");
  });
  it("builds sets by source and keeps the last 10 verdicts (Q-6, Q-8)", () => {
    const bank = assembleBank(OUTLINE, { "p04-ebs": CONCEPT }, {}, empty);
    let log = logAnswer(empty, "q1", false, 1);
    for (let i = 0; i < 12; i++) log = logAnswer(log, "q2", true, i);
    expect(log.items["q2"].h).toHaveLength(10);
    log = setFlag(log, "q2", true);
    const opts = { units: [], count: 10, mode: "practice" as const, secondsPerItem: 120, now: 0 };
    expect(buildSet(bank, log, { ...opts, source: "wrong" }).ids).toEqual(["q1"]);
    expect(buildSet(bank, log, { ...opts, source: "flagged" }).ids).toEqual(["q2"]);
    expect(buildSet(bank, empty, { ...opts, source: "unseen", mode: "exam" }).limitSec).toBe(240);
  });
  it("rejects a translation whose option count differs (Q-4)", () => {
    expect(validKo(judge("a"), { scenario: "x", options: ["1", "2"] })).toBe(false);
    expect(parseTranslation('{"scenario":"번역","options":["a","b","c","d"]}', judge("a"))?.scenario).toBe("번역");
  });
});

function scriptedAi(onAi: (r: AiRequest) => string, onProblems?: (r: GenProblemsRequest) => unknown[]): AiClient & { calls: AiRequest[]; gen: GenProblemsRequest[] } {
  const calls: AiRequest[] = [], gen: GenProblemsRequest[] = [];
  return {
    calls, gen,
    async ai(r) { calls.push(r); return { ok: true, text: onAi(r), session_id: null, error: null }; },
    async problems(r) { gen.push(r); return { ok: true, problems: onProblems ? onProblems(r) : [], error: null }; },
    async repos() { return { ok: false, reason: "call", error: "n/a" }; },
    async health() { return true; },
  } as AiClient & { calls: AiRequest[]; gen: GenProblemsRequest[] };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle(n = 30) { for (let i = 0; i < n; i++) await tick(); }
const click = (root: HTMLElement, sel: string, text?: string) => {
  const b = Array.from(root.querySelectorAll<HTMLButtonElement>(sel)).find((x) => text === undefined || (x.textContent ?? "").includes(text));
  if (!b) throw new Error(`no ${sel} ${text ?? ""}`);
  b.click();
};

describe("quiz part", () => {
  let root: HTMLElement;
  let storage: ReturnType<typeof memoryStorage>;
  beforeEach(async () => {
    localStorage.clear(); document.body.innerHTML = ""; root = document.createElement("div"); document.body.appendChild(root);
    storage = memoryStorage();
    storage.docs.set("outline", OUTLINE);
    await storage.put("concepts", { kind: "concept", id: "p04-ebs", summary: {}, data: CONCEPT });
  });

  it("practice: answer, grade, log, explanation (Q-7, Q-8)", async () => {
    mountQuiz(root, { storage, aiClient: null, outline: { doc: "outline" }, subjectKey: "s" });
    await settle();
    click(root, ".lh-qz-start");
    await settle();
    click(root, ".lh-qz-opt", "EBS");
    click(root, ".lh-qz-nav .lh-nb-btn--primary", "확인");
    await settle();
    expect(root.querySelector(".lh-qz-verdict")!.textContent).toBe("✓ 맞았습니다");
    expect(root.querySelector(".lh-qz-explain")!.textContent).toContain("파일");
    const log = storage.docs.get("quiz-log") as QuizLog;
    expect(Object.values(log.items)[0].h).toEqual(["c"]);
  });

  it("toggle translates once, stores it, and grades by option position (Q-3, Q-4)", async () => {
    const ai = scriptedAi(() => JSON.stringify({ scenario: "블록 스토리지는?", options: ["가", "나", "다", "라"] }));
    mountQuiz(root, { storage, aiClient: ai, outline: { doc: "outline" }, subjectKey: "s", translate: { system: "TR" } });
    await settle();
    click(root, ".lh-qz-start");
    await settle();
    const card = root.querySelector<HTMLElement>(".lh-qz-card")!;
    expect(card.querySelector(".lh-qz-stem")!.textContent).toContain("Which is block storage?");
    click(root, ".lh-qz-lang");
    await settle();
    expect(card.querySelector(".lh-qz-stem")!.textContent).toBe("블록 스토리지는?");
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0].system).toContain("TR");
    const stored = storage.cols.get("problems")!.get("p04-ebs")!.data as { ko: Record<string, unknown> };
    expect(Object.keys(stored.ko)).toHaveLength(1);
    click(root, ".lh-qz-lang"); click(root, ".lh-qz-lang");
    await settle();
    expect(ai.calls).toHaveLength(1);
    click(root, ".lh-qz-opt", "가");        // position 0 = "EBS" in the primary options
    click(root, ".lh-qz-nav .lh-nb-btn--primary", "확인");
    await settle();
    expect(root.querySelector(".lh-qz-verdict")!.textContent).toBe("✓ 맞았습니다");
    expect(root.querySelector(".lh-qz-stem")!.textContent).toBe("블록 스토리지는?");   // the chosen language survives the repaint
  });

  it("langToggle false hides the switch and ignores T (Q-4)", async () => {
    const ai = scriptedAi(() => "{}");
    mountQuiz(root, { storage, aiClient: ai, outline: { doc: "outline" }, subjectKey: "s", langToggle: false });
    await settle();
    click(root, ".lh-qz-start");
    await settle();
    expect(root.querySelector<HTMLElement>(".lh-qz-lang")!.hidden).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "t" }));
    await settle();
    expect(ai.calls).toHaveLength(0);
  });

  it("exam mode grades everything at the end and offers retry-wrong (Q-7, Q-12)", async () => {
    localStorage.setItem("lh:s:quiz:mode", "exam");
    mountQuiz(root, { storage, aiClient: null, outline: { doc: "outline" }, subjectKey: "s" });
    await settle();
    click(root, ".lh-qz-start");
    await settle();
    expect(root.querySelector(".lh-qz-clock")).not.toBeNull();
    click(root, ".lh-qz-opt", "EFS");
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));   // submit -> next
    await settle();
    click(root, ".lh-qz-opt", "EBS");
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));   // submit -> finish
    await settle();
    expect(root.querySelector(".lh-qz-score")!.textContent).toContain("1 / 2");
    click(root, ".lh-nb-btn--primary", "틀린 것만");
    await settle();
    expect(root.querySelector(".lh-qz-num")!.textContent).toBe("1 / 1");
  });

  it("generated problems persist in the state API with their translation (Q-5)", async () => {
    const ai = scriptedAi(() => "", (r) => [{ ...judge("p04-ebs-gen-1"), front_ko: { scenario: "생성", options: ["1", "2", "3", "4"] }, concept: r.concept.concept_id }]);
    mountQuiz(root, { storage, aiClient: ai, outline: { doc: "outline" }, subjectKey: "s", problemStyle: "STYLE", courseTitle: "C" });
    await settle();
    click(root, '[data-tab="bank"]');
    await settle();
    click(root, ".lh-qz-concept-row .lh-nb-btn", "5문제");
    await settle(40);
    expect(ai.gen[0].style).toBe("STYLE");
    const set = storage.cols.get("problems")!.get("p04-ebs")!.data as { generated: { card_id: string; front_ko?: { scenario: string } }[] };
    expect(set.generated[0]).toMatchObject({ card_id: "p04-ebs-gen-1", front_ko: { scenario: "생성" } });
    expect(root.querySelector(".lh-qz-tile-v")!.textContent).toBe("3");
  });
});
