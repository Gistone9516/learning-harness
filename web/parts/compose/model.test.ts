// Pure rules of the compose part (specs/web-compose.md W-2, W-6, W-8, W-10, W-13).
import { describe, it, expect } from "vitest";
import { errorStats, isPass, parseGrade, parseTasks, scheduleTask, taskId, taskSummary, wordDiff, type TaskData } from "./model";
import { STORAGE_NAME_RE } from "../../src/storage/port";
import { extractJsonObject } from "../../src/ai/json";

const DAY = 86_400_000;

describe("extractJsonObject", () => {
  it("prefers the last json fence, falls back to the outer braces, rejects arrays and junk", () => {
    expect(extractJsonObject('x ```json\n{"a":1}\n``` y ```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJsonObject('Sure: {"a":3} done')).toEqual({ a: 3 });
    expect(extractJsonObject("[1,2]")).toBeNull();
    expect(extractJsonObject("nothing")).toBeNull();
  });
});

describe("parseGrade (W-2)", () => {
  it("reads a full grade", () => {
    const g = parseGrade(JSON.stringify({ verdict: "incorrect", reason: "관사", corrected: "I use an EBS volume.", natural: "I'm using an EBS volume.",
      errors: [{ category: "articles", from: "a EBS", to: "an EBS", explain: "모음 소리" }], terms: [{ headword: "volume" }] }));
    expect(g).toMatchObject({ verdict: "incorrect", corrected: "I use an EBS volume.", errors: [{ category: "articles" }], terms: [{ headword: "volume" }] });
  });
  it("accepts the three verdicts and returns null for anything else", () => {
    expect(parseGrade('{"verdict":"partial"}')!.verdict).toBe("partial");
    expect(parseGrade('{"verdict":"almost"}')).toBeNull();
    expect(parseGrade('{"verdict":"ungraded"}')).toBeNull();
    expect(parseGrade("good job")).toBeNull();
  });
  it("keeps at most two examples per error, each needing its sentence (W-13)", () => {
    const g = parseGrade(JSON.stringify({ verdict: "incorrect", errors: [
      { category: "tense", from: "go", to: "went", explain: "과거", examples: [{ en: "I went home.", ko: "집에 갔다." }, { ko: "문장 없음" }, { en: "She went out." }, { en: "Third." }] },
      { category: "article", from: "a", to: "an", explain: "모음" },
    ] }))!;
    expect(g.errors[0].examples).toEqual([{ en: "I went home.", ko: "집에 갔다." }, { en: "She went out." }]);
    expect(g.errors[1].examples).toBeUndefined();
  });
  it("partial is a pass; ungraded and incorrect are not (W-2)", () => {
    expect([isPass("correct"), isPass("partial"), isPass("incorrect"), isPass("ungraded"), isPass("none"), isPass(null)]).toEqual([true, true, false, false, false, false]);
  });
});

describe("parseTasks", () => {
  it("keeps tasks with a prompt", () => {
    const t = parseTasks('{"tasks":[{"prompt":"번역하세요","model_answer":"A","expressions":["x"],"skeleton":"_ is _"},{"words":["y"]}]}');
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ prompt: "번역하세요", model_answer: "A", expressions: ["x"], skeleton: "_ is _", words: [] });
  });
});

describe("wordDiff (W-6)", () => {
  it("marks removed and inserted words", () => {
    expect(wordDiff("I use a EBS volume", "I use an EBS volume")).toEqual([
      { op: "eq", text: "I use" }, { op: "del", text: "a" }, { op: "ins", text: "an" }, { op: "eq", text: "EBS volume" },
    ]);
    expect(wordDiff("", "new")).toEqual([{ op: "ins", text: "new" }]);
  });
});

describe("scheduleTask (W-8)", () => {
  it("queues an incorrect answer for tomorrow and never queues a first-time pass", () => {
    const s = scheduleTask(null, "incorrect", 0)!;
    expect(s.box).toBe(1);
    expect(s.due_at).toBe(DAY);
    expect(scheduleTask(null, "correct", 0)).toBeNull();
    expect(scheduleTask(null, "partial", 0)).toBeNull();
  });
  it("moves a queued task up on a pass and leaves it alone when ungraded", () => {
    const q = { box: 1, due_at: 0, reps: 1, lapses: 1 };
    expect(scheduleTask(q, "correct", 0)!.box).toBe(2);
    expect(scheduleTask(q, "partial", 0)!.box).toBe(2);
    expect(scheduleTask(q, "ungraded", 0)).toBe(q);
  });
});

describe("records", () => {
  it("task id is a valid state id and the summary carries the list fields (W-10)", () => {
    expect(STORAGE_NAME_RE.test(taskId(Date.UTC(2026, 9, 1), () => 0.3))).toBe(true);
    const d: TaskData = { mode: "translate", prompt: "p", words: [], expressions: [], session_id: null, revealed: false, srs: { box: 1, due_at: 5, reps: 1, lapses: 1 },
      attempts: [{ text: "a", at: 1, verdict: "incorrect" }, { text: "b", at: 2, verdict: "ungraded" }] };
    expect(taskSummary(d, 9)).toMatchObject({ verdict: "ungraded", attempts: 2, queued: true, due_at: 5, box: 1, updated: 9 });
    expect(errorStats([{ ...d, attempts: [{ text: "a", at: 1, verdict: "incorrect", errors: [{ category: "x", from: "", to: "", explain: "e" }, { category: "x", from: "", to: "", explain: "f" }] }] }]))
      .toEqual([{ category: "x", count: 2 }]);
  });
});
