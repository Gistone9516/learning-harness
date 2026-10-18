// @vitest-environment jsdom
//
// compose part behaviour (specs/web-compose.md) against in-memory storage and a scripted AI.
import { describe, it, expect, beforeEach } from "vitest";
import { mountCompose } from "./compose";
import { composePrefillKey } from "./model";
import type { AiClient, AiRequest, AiResponse } from "../../src/ai/client";
import { memoryStorage } from "../../tests/memoryStorage";

function scriptedAi(replies: ((req: AiRequest) => AiResponse | Promise<AiResponse>)[]): AiClient & { calls: AiRequest[] } {
  const calls: AiRequest[] = [];
  return {
    calls,
    async ai(req) { calls.push(req); const f = replies.shift(); if (!f) throw new Error("unexpected AI call"); return f(req); },
    async problems() { throw new Error("n/a"); },
    async repos() { throw new Error("n/a"); },
    async health() { return true; },
  } as AiClient & { calls: AiRequest[] };
}
const ok = (text: string, sid = "s-1"): AiResponse => ({ ok: true, text, session_id: sid, error: null });
const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle(n = 25) { for (let i = 0; i < n; i++) await tick(); }

const TASKS = JSON.stringify({ tasks: [
  { prompt: "EBS 볼륨은 하나의 AZ에 묶인다.", model_answer: "An EBS volume is bound to one AZ.", expressions: ["be bound to"], skeleton: "An EBS volume ___ one AZ." },
  { prompt: "두 번째 문장", model_answer: "Second." },
] });
const GRADE_BAD = JSON.stringify({ verdict: "incorrect", reason: "동사", corrected: "An EBS volume is bound to one AZ.", natural: "An EBS volume is tied to a single AZ.",
  errors: [{ category: "verb", from: "bind", to: "is bound", explain: "수동태" }], terms: [{ headword: "be bound to", type: "phrase", senses: [{ gloss: "~에 묶이다" }] }] });
const GRADE_OK = JSON.stringify({ verdict: "correct", reason: "좋음", corrected: "An EBS volume is bound to one AZ.", errors: [], terms: [] });

const base = { tasks: { system: "GEN" }, grader: { system: "GRADE" }, subjectKey: "s1" };

function write(root: HTMLElement, text: string): void {
  const ta = root.querySelector<HTMLTextAreaElement>(".lh-cm-input")!;
  ta.value = text;
  root.querySelector<HTMLButtonElement>(".lh-cm-actions .lh-nb-btn--primary")!.click();
}

describe("compose", () => {
  let root: HTMLElement;
  beforeEach(() => { localStorage.clear(); document.body.innerHTML = ""; root = document.createElement("div"); document.body.appendChild(root); });

  it("generates a batch, saves the attempt before the grade (W-4), grades, captures without a lookup (W-7), queues (W-8)", async () => {
    const storage = memoryStorage();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const ai = scriptedAi([() => ok(TASKS), async () => { await gate; return ok(GRADE_BAD); }]);
    mountCompose(root, { ...base, storage, aiClient: ai });
    await settle();
    root.querySelector<HTMLButtonElement>(".lh-cm-gen")!.click();
    await settle(40);
    expect(storage.cols.get("compose")!.size).toBe(2);
    expect(ai.calls[0].system).toContain("GEN");
    expect(root.querySelector(".lh-cm-prompt")!.textContent).toBe("EBS 볼륨은 하나의 AZ에 묶인다.");

    write(root, "EBS volume bind one AZ.");
    await settle();
    const rec = Array.from(storage.cols.get("compose")!.values()).find((r) => (r.data as { prompt: string }).prompt.startsWith("EBS"))!;
    expect((rec.data as { attempts: { text: string; verdict: unknown }[] }).attempts[0]).toMatchObject({ text: "EBS volume bind one AZ.", verdict: null });

    release();
    await settle(40);
    const after = storage.cols.get("compose")!.get(rec.id)!.data as { attempts: { verdict: string; terms: string[] }[]; srs: { box: number } | null; session_id: string };
    expect(after.attempts[0].verdict).toBe("incorrect");
    expect(after.attempts[0].terms).toEqual(["be bound to"]);
    expect(after.srs?.box).toBe(1);
    expect(after.session_id).toBe("s-1");
    const term = storage.cols.get("terms")!.get("be-bound-to")!.data as { lookups: number; via: string[]; examples: { en: string }[] };
    expect(term.lookups).toBe(0);
    expect(term.via).toEqual(["compose"]);
    expect(term.examples[0].en).toBe("An EBS volume is bound to one AZ.");
    expect(root.querySelector(".lh-cm-del")!.textContent).toBe("bind");
    expect(ai.calls[1].system).toContain("GRADE");
  });

  it("a revision resumes the session (W-5); a lost session re-seeds with the attempts", async () => {
    const storage = memoryStorage();
    const ai = scriptedAi([
      () => ok(TASKS), () => ok(GRADE_BAD, "s-1"),
      (req) => ({ ok: false, text: "", session_id: req.session_id ?? null, error: "gone", error_kind: "resume_missing" }),
      () => ok(GRADE_OK, "s-2"),
    ]);
    mountCompose(root, { ...base, storage, aiClient: ai });
    await settle();
    root.querySelector<HTMLButtonElement>(".lh-cm-gen")!.click();
    await settle(40);
    write(root, "EBS volume bind one AZ.");
    await settle(40);
    write(root, "An EBS volume is bound to one AZ.");
    await settle(40);
    expect(ai.calls[2].session_id).toBe("s-1");
    expect(ai.calls[2].prompt).toContain("[Revised answer]");
    expect(ai.calls[3].session_id).toBeNull();
    expect(ai.calls[3].prompt).toContain("Attempt 1: EBS volume bind one AZ.");
    const d = Array.from(storage.cols.get("compose")!.values()).map((r) => r.data as { attempts: { verdict: string }[]; srs: { box: number } | null }).find((x) => x.attempts.length === 2)!;
    expect(d.attempts.map((a) => a.verdict)).toEqual(["incorrect", "correct"]);
    expect(d.srs?.box).toBe(2);
  });

  it("an unreadable grade is ungraded and not queued (W-2)", async () => {
    const storage = memoryStorage();
    const ai = scriptedAi([() => ok(TASKS), () => ok("Nice try! Looks fine to me.")]);
    mountCompose(root, { ...base, storage, aiClient: ai });
    await settle();
    root.querySelector<HTMLButtonElement>(".lh-cm-gen")!.click();
    await settle(40);
    write(root, "Anything.");
    await settle(40);
    const d = Array.from(storage.cols.get("compose")!.values()).map((r) => r.data as { attempts: { verdict: string }[]; srs: unknown }).find((x) => x.attempts.length)!;
    expect(d.attempts[0].verdict).toBe("ungraded");
    expect(d.srs).toBeNull();
  });

  it("partial is a pass: amber badge, next is the primary action, not queued; examples show under the error (W-2, W-8, W-13)", async () => {
    const storage = memoryStorage();
    const partial = JSON.stringify({ verdict: "partial", reason: "관사만", corrected: "An EBS volume is bound to one AZ.",
      errors: [{ category: "articles", from: "EBS", to: "An EBS", explain: "단수 가산명사", examples: [{ en: "An instance is running.", ko: "인스턴스가 실행 중이다." }, { en: "A bucket holds objects." }] }], terms: [] });
    const ai = scriptedAi([() => ok(TASKS), () => ok(partial)]);
    mountCompose(root, { ...base, storage, aiClient: ai });
    await settle();
    root.querySelector<HTMLButtonElement>(".lh-cm-gen")!.click();
    await settle(40);
    write(root, "EBS volume is bound to one AZ.");
    await settle(40);
    expect(root.querySelector(".lh-cm-attempt .lh-cm-badge--partial")!.textContent).toBe("△ 작은 실수");
    expect(root.querySelector(".lh-cm-actions .lh-nb-btn--primary")!.textContent).toBe("다음 문제");
    expect(root.querySelector<HTMLTextAreaElement>(".lh-cm-input")!.value).toBe("");
    const ex = root.querySelectorAll(".lh-cm-errors .lh-cm-examples li");
    expect(Array.from(ex).map((li) => li.querySelector(".lh-cm-ex-en")!.textContent)).toEqual(["An instance is running.", "A bucket holds objects."]);
    expect(ex[0].querySelector(".lh-cm-ex-ko")!.textContent).toBe("인스턴스가 실행 중이다.");
    expect(ex[1].querySelector(".lh-cm-ex-ko")).toBeNull();
    const d = Array.from(storage.cols.get("compose")!.values()).map((r) => r.data as { attempts: { verdict: string }[]; srs: unknown }).find((x) => x.attempts.length)!;
    expect(d.attempts[0].verdict).toBe("partial");
    expect(d.srs).toBeNull();
    expect(storage.cols.get("terms")?.size ?? 0).toBe(0);   // examples are never captured
  });

  it("the grader sees the saved terms and a saved expression is not re-captured (W-14)", async () => {
    const storage = memoryStorage();
    const regrade = JSON.stringify({ verdict: "correct", reason: "r", corrected: "An EBS volume is tied to a single AZ.", errors: [],
      terms: ["be bound to", "single"].map((h) => ({ headword: h, type: "phrase", senses: [{ gloss: "뜻" }] })) });
    const ai = scriptedAi([() => ok(TASKS), () => ok(GRADE_BAD, "s-1"), () => ok(regrade, "s-1")]);
    mountCompose(root, { ...base, storage, aiClient: ai });
    await settle();
    root.querySelector<HTMLButtonElement>(".lh-cm-gen")!.click();
    await settle(40);
    write(root, "EBS volume bind one AZ.");
    await settle(40);
    write(root, "An EBS volume is tied to a single AZ.");
    await settle(40);
    expect(ai.calls[2].prompt).toContain("[Saved terms");
    expect(ai.calls[2].prompt).toContain("be bound to");
    expect(Array.from(storage.cols.get("terms")!.keys()).sort()).toEqual(["be-bound-to", "single"]);
    expect((storage.cols.get("terms")!.get("be-bound-to")!.data as { examples: unknown[] }).examples).toHaveLength(1);
  });

  it("without AI, free writing is self-judged and still binary (W-9)", async () => {
    const storage = memoryStorage();
    mountCompose(root, { ...base, storage, aiClient: null, modes: ["free"] });
    await settle();
    root.querySelector<HTMLButtonElement>(".lh-cm-gen")!.click();
    await settle(30);
    write(root, "I like cloud.");
    await settle(30);
    const wrong = Array.from(root.querySelectorAll<HTMLButtonElement>(".lh-cm-self .lh-nb-btn")).find((b) => b.textContent === "틀렸어요")!;
    wrong.click();
    await settle(30);
    const d = Array.from(storage.cols.get("compose")!.values())[0].data as { attempts: { verdict: string; self: boolean }[]; srs: { box: number } };
    expect(d.attempts[0]).toMatchObject({ verdict: "incorrect", self: true });
    expect(d.srs.box).toBe(1);
  });

  it("takes words handed over by another part (W-11)", async () => {
    localStorage.setItem(composePrefillKey("s1"), JSON.stringify({ words: ["ephemeral"] }));
    mountCompose(root, { ...base, storage: memoryStorage(), aiClient: null });
    await settle(30);
    expect(Array.from(root.querySelectorAll(".lh-cm-words .lh-nb-chip")).map((c) => c.textContent)).toEqual(["ephemeral ×"]);
    expect(localStorage.getItem(composePrefillKey("s1"))).toBeNull();
  });
});
