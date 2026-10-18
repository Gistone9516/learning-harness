// @vitest-environment jsdom
//
// notebook part behaviour against an in-memory StoragePort and a scripted AI (specs/web-notebook.md).
import { describe, it, expect, beforeEach } from "vitest";
import { mountNotebook, notebookPrefillKey } from "./notebook";
import type { AiClient, AiRequest, AiResponse } from "../../src/ai/client";
import type { IndexEntry, StoragePort, StorageRecord } from "../../src/storage/port";

function memoryStorage(): StoragePort & { cols: Map<string, Map<string, StorageRecord>>; docs: Map<string, unknown> } {
  const cols = new Map<string, Map<string, StorageRecord>>();
  const docs = new Map<string, unknown>();
  const col = (c: string) => cols.get(c) ?? (cols.set(c, new Map()), cols.get(c)!);
  let t = 0;
  return {
    cols, docs, online: true,
    async list(c) {
      return Array.from(col(c).values()).map((r): IndexEntry => ({ id: r.id, kind: r.kind, created_at: r.created_at ?? 0, updated_at: r.updated_at ?? 0, summary: r.summary }));
    },
    async get<T>(c: string, id: string) { return (col(c).get(id) as StorageRecord<T> | undefined) ?? null; },
    async put(c, r) { const prev = col(c).get(r.id); col(c).set(r.id, JSON.parse(JSON.stringify({ ...r, created_at: prev?.created_at ?? ++t, updated_at: ++t }))); return true; },
    async remove(c, id) { return col(c).delete(id); },
    async getDoc<T>(n: string) { return (docs.get(n) as T | undefined) ?? null; },
    async putDoc(n, d) { docs.set(n, JSON.parse(JSON.stringify(d))); return true; },
  };
}

const REPLY = [
  "**provision** means to supply.",
  "```json",
  JSON.stringify({ type: "sentence", title: "Provision a volume", terms: [
    { headword: "provision", type: "word", senses: [{ gloss: "공급하다" }] },
    { headword: "volume", type: "word", senses: [{ gloss: "볼륨" }] },
    { headword: "the", type: "word" },
  ] }),
  "```",
].join("\n");

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
async function settle(n = 12) { for (let i = 0; i < n; i++) await tick(); }

const showBtn = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLButtonElement>(".lh-nb-review-actions .lh-nb-btn")).find((b) => !b.hidden && b.textContent === "뜻 보기")!;
const nextBtn = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLButtonElement>(".lh-nb-review-actions .lh-nb-btn")).find((b) => !b.hidden && b.textContent === "다음")!;
function typeAnswer(root: HTMLElement, text: string): void {
  const inp = root.querySelector<HTMLInputElement>(".lh-nb-answer-input")!;
  inp.value = text;
  inp.dispatchEvent(new Event("input"));
  inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
}
const graded = (verdict: string, feedback: string, sid = "r-1") => ok(JSON.stringify({ verdict, feedback }), sid);
const box = (storage: ReturnType<typeof memoryStorage>, id: string) => (storage.cols.get("terms")!.get(id)!.data as { srs: { box: number } }).srs.box;

function sendAsk(root: HTMLElement, text: string): void {
  const ta = root.querySelector<HTMLTextAreaElement>(".lh-nb-ask-input")!;
  ta.value = text;
  root.querySelector<HTMLButtonElement>(".lh-nb-composer .lh-nb-btn--primary")!.click();
}

describe("notebook", () => {
  let root: HTMLElement;
  beforeEach(() => { localStorage.clear(); document.body.innerHTML = ""; root = document.createElement("div"); document.body.appendChild(root); });

  it("saves the question before the reply arrives (N-2), then captures terms minus stopwords (N-5, N-6)", async () => {
    const storage = memoryStorage();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const ai = scriptedAi([async () => { await gate; return ok(REPLY); }]);
    mountNotebook(root, { storage, aiClient: ai, ask: { system: "ROLE" }, stopwords: ["the"] });
    await settle();
    sendAsk(root, "Provision the volume.");
    await settle();
    const threads = Array.from(storage.cols.get("threads")!.values());
    expect(threads).toHaveLength(1);
    expect((threads[0].data as { turns: { q: string; a: string }[] }).turns[0]).toMatchObject({ q: "Provision the volume.", a: "" });

    release();
    await settle(30);
    const t = storage.cols.get("threads")!.get(threads[0].id)!;
    expect(t.summary["title"]).toBe("Provision a volume");
    expect(t.summary["type"]).toBe("sentence");
    expect(Array.from(storage.cols.get("terms")!.keys()).sort()).toEqual(["provision", "volume"]);
    expect(ai.calls[0].system).toContain("ROLE");
    expect(ai.calls[0].system).toContain("fenced block tagged json");
    const chips = Array.from(root.querySelectorAll(".lh-nb-chip")).map((c) => c.textContent);
    expect(chips).toEqual(["provision", "volume"]);
  });

  it("continues a thread by resuming its session, and re-seeds with the transcript when it is gone (N-3)", async () => {
    const storage = memoryStorage();
    const ai = scriptedAi([
      () => ok(REPLY, "s-1"),
      (req) => ({ ok: false, text: "", session_id: req.session_id ?? null, error: "gone", error_kind: "resume_missing" }),
      () => ok("second answer\n```json\n{\"terms\":[{\"headword\":\"provision\"}]}\n```", "s-2"),
    ]);
    mountNotebook(root, { storage, aiClient: ai, ask: { system: "ROLE" } });
    await settle();
    sendAsk(root, "first");
    await settle(30);
    sendAsk(root, "and then?");
    await settle(30);
    expect(ai.calls[1].session_id).toBe("s-1");
    expect(ai.calls[1].system).toBeUndefined();
    expect(ai.calls[2].session_id).toBeNull();
    expect(ai.calls[2].prompt).toContain("Learner: first");
    const t = Array.from(storage.cols.get("threads")!.values())[0];
    const data = t.data as { session_id: string; turns: { a: string }[] };
    expect(data.session_id).toBe("s-2");
    expect(data.turns.map((x) => x.a)).toEqual(["**provision** means to supply.", "second answer"]);
    // N-19: the follow-up re-listed a saved term; it is not captured again, so its lookups stay at 1.
    expect((storage.cols.get("terms")!.get("provision")!.data as { lookups: number }).lookups).toBe(1);
  });

  it("keeps the question and shows an error when the AI is unreachable", async () => {
    const storage = memoryStorage();
    const ai = scriptedAi([() => ({ ok: false, text: "", session_id: null, error: "Failed to fetch" })]);
    mountNotebook(root, { storage, aiClient: ai, ask: { system: "ROLE" } });
    await settle();
    sendAsk(root, "hello");
    await settle(30);
    const t = Array.from(storage.cols.get("threads")!.values())[0];
    expect((t.data as { turns: { q: string; error?: boolean }[] }).turns[0]).toMatchObject({ q: "hello", error: true });
    expect(root.querySelector(".lh-nb-bubble--error")).not.toBeNull();
  });

  it("seeds once per version and never overwrites (N-10)", async () => {
    const storage = memoryStorage();
    const seed = { version: "v1", terms: [{ headword: "EBS", type: "acronym", expansion: "Elastic Block Store" }] };
    mountNotebook(root, { storage, aiClient: null, ask: { system: "" }, seed });
    await settle(20);
    const rec = storage.cols.get("terms")!.get("ebs")!;
    (rec.data as { known: boolean }).known = true;
    mountNotebook(root, { storage, aiClient: null, ask: { system: "" }, seed });
    await settle(20);
    expect((storage.cols.get("terms")!.get("ebs")!.data as { known: boolean }).known).toBe(true);
    expect(storage.docs.get("notebook-meta")).toEqual({ seed_version: "v1" });
  });

  it("review: a typed meaning is graded in one session per visit; the verdict drives Leitner and the feedback shows (N-7, N-8, N-20)", async () => {
    const storage = memoryStorage();
    const ai = scriptedAi([() => graded("correct", "핵심은 맞지만 '블록' 단위라는 점이 빠졌습니다.", "r-1"), () => graded("incorrect", "가용 영역이 아니라 리전입니다.", "r-1")]);
    mountNotebook(root, { storage, aiClient: ai, ask: { system: "" }, review: { system: "REVIEW ROLE", model: "sonnet", effort: "low" },
      seed: { version: "v1", terms: [{ headword: "EBS", type: "acronym", expansion: "Elastic Block Store", gloss: "블록 스토리지" }, { headword: "AZ", type: "acronym", expansion: "Availability Zone", gloss: "가용 영역" }] } });
    await settle(20);
    root.querySelector<HTMLButtonElement>('[data-tab="review"]')!.click();
    await settle(20);
    const first = root.querySelector(".lh-nb-card-word")!.textContent!;
    const firstId = first.toLowerCase();
    expect(root.querySelector(".lh-nb-card")!.textContent).not.toContain(first === "EBS" ? "Elastic Block Store" : "Availability Zone");   // N-7
    expect(Array.from(root.querySelectorAll(".lh-nb-review-actions .lh-nb-btn")).map((b) => b.textContent)).not.toContain("알았어요");
    typeAnswer(root, "스토리지");
    await settle(30);
    expect(ai.calls[0].system).toContain("REVIEW ROLE");
    expect(ai.calls[0].system).toContain("[Response contract]");
    expect(ai.calls[0]).toMatchObject({ model: "sonnet", effort: "low", session_id: null, live: true });
    expect(ai.calls[0].prompt).toContain(`Term: ${first}`);
    expect(ai.calls[0].prompt).toContain("스토리지");
    expect(root.querySelector(".lh-nb-verdict")!.textContent).toContain("맞았어요");
    expect(root.querySelector(".lh-nb-verdict")!.textContent).toContain("블록");
    expect(root.querySelector(".lh-nb-card-back")!.textContent).toContain(first === "EBS" ? "Elastic Block Store" : "Availability Zone");
    expect(box(storage, firstId)).toBe(2);   // saved at once, before 다음
    nextBtn(root).click();
    await settle(20);
    const second = root.querySelector(".lh-nb-card-word")!.textContent!;
    expect(second).not.toBe(first);
    typeAnswer(root, "지역");
    await settle(30);
    expect(ai.calls[1].session_id).toBe("r-1");   // same session, no second system text
    expect(ai.calls[1].system).toBeUndefined();
    expect(root.querySelector(".lh-nb-verdict")!.textContent).toContain("틀렸어요");
    expect(box(storage, second.toLowerCase())).toBe(1);
    nextBtn(root).click();
    await settle(20);
    expect(root.querySelector(".lh-nb-card-word")!.textContent).toBe(second);   // a wrong card comes back once
  });

  it("outline tab saves units and concept seeds to the doc conceptprob reads (N-11)", async () => {
    const storage = memoryStorage();
    storage.docs.set("outline", { areas: [{ key: "p01-iam", label: "01 IAM" }], conceptOutline: { "p01-iam": [{ concept_id: "p01-iam-users", title: "Users" }] } });
    mountNotebook(root, { storage, aiClient: null, ask: { system: "" }, outline: { doc: "outline" } });
    await settle();
    root.querySelector<HTMLButtonElement>('[data-tab="outline"]')!.click();
    await settle();
    const unitInput = root.querySelector<HTMLInputElement>(".lh-nb-addunit .lh-nb-input")!;
    unitInput.value = "02 EC2";
    root.querySelector<HTMLButtonElement>(".lh-nb-addunit .lh-nb-btn")!.click();
    const tas = root.querySelectorAll<HTMLTextAreaElement>(".lh-nb-seed-input");
    tas[1].value = "Instance types\nSecurity groups";
    tas[1].dispatchEvent(new Event("input"));
    root.querySelector<HTMLButtonElement>(".lh-nb-outline-foot .lh-nb-btn--primary")!.click();
    await settle();
    const doc = storage.docs.get("outline") as { areas: { key: string }[]; conceptOutline: Record<string, { concept_id: string; title: string }[]> };
    expect(doc.areas.map((a) => a.key)).toEqual(["p01-iam", "c-02-ec2"]);   // ids must start with a letter
    expect(doc.conceptOutline["c-02-ec2"].map((s) => s.title)).toEqual(["Instance types", "Security groups"]);
    expect(doc.conceptOutline["c-02-ec2"].map((s) => s.concept_id)).toEqual(["c-02-ec2-instance-types", "c-02-ec2-security-groups"]);
  });

  it("takes text handed over by another part into a new question, once", async () => {
    const storage = memoryStorage();
    storage.cols.set("threads", new Map());
    localStorage.setItem("lh:s1:notebook:thread", "t-old");
    localStorage.setItem(notebookPrefillKey("s1"), "Which volume type supports Multi-Attach?");
    mountNotebook(root, { storage, aiClient: null, ask: { system: "" }, subjectKey: "s1" });
    await settle(20);
    expect(root.querySelector<HTMLTextAreaElement>(".lh-nb-ask-input")!.value).toBe("Which volume type supports Multi-Attach?");
    expect(localStorage.getItem(notebookPrefillKey("s1"))).toBeNull();
  });

  it("review: a card can be deleted with the two-step button; it leaves the store and the queue (N-22)", async () => {
    const storage = memoryStorage();
    mountNotebook(root, { storage, aiClient: null, ask: { system: "" },
      seed: { version: "v1", terms: [{ headword: "AZ", type: "acronym", expansion: "Availability Zone" }, { headword: "ARN", type: "acronym", expansion: "Amazon Resource Name" }] } });
    await settle(20);
    root.querySelector<HTMLButtonElement>('[data-tab="review"]')!.click();
    await settle(20);
    const first = root.querySelector(".lh-nb-card-word")!.textContent!;
    const del = () => root.querySelector<HTMLButtonElement>(".lh-nb-card-del")!;
    del().click();
    await settle(5);
    expect(storage.cols.get("terms")!.has(first.toLowerCase())).toBe(true);   // first press only arms it
    expect(del().textContent).toBe("한 번 더 누르면 삭제됩니다");
    del().click();
    await settle(20);
    expect(storage.cols.get("terms")!.has(first.toLowerCase())).toBe(false);
    const second = root.querySelector(".lh-nb-card-word")!.textContent!;
    expect(second).not.toBe(first);
    expect(root.querySelector(".lh-nb-review-progress")!.textContent).toContain("1");
  });

  it("review: 뜻 보기 counts as not known; an unreadable grade leaves the record unchanged (N-8)", async () => {
    const storage = memoryStorage();
    const ai = scriptedAi([() => ok("looks fine to me")]);
    mountNotebook(root, { storage, aiClient: ai, ask: { system: "" }, review: { system: "R" },
      seed: { version: "v1", terms: [{ headword: "AZ", type: "acronym", expansion: "Availability Zone" }, { headword: "ARN", type: "acronym", expansion: "Amazon Resource Name" }] } });
    await settle(20);
    root.querySelector<HTMLButtonElement>('[data-tab="review"]')!.click();
    await settle(20);
    const a = root.querySelector(".lh-nb-card-word")!.textContent!.toLowerCase();
    const before = (storage.cols.get("terms")!.get(a)!.data as { srs: unknown }).srs;
    typeAnswer(root, "무언가");
    await settle(30);
    expect(root.querySelector(".lh-nb-verdict")!.textContent).toContain("채점하지 못했습니다");
    expect((storage.cols.get("terms")!.get(a)!.data as { srs: unknown }).srs).toEqual(before);
    nextBtn(root).click();
    await settle(20);
    const b = root.querySelector(".lh-nb-card-word")!.textContent!.toLowerCase();
    expect(b).not.toBe(a);
    showBtn(root).click();
    await settle(20);
    expect(root.querySelector(".lh-nb-verdict")!.textContent).toContain("몰랐어요");
    expect((storage.cols.get("terms")!.get(b)!.data as { srs: { lapses: number } }).srs.lapses).toBe(1);
    expect(ai.calls).toHaveLength(1);   // 뜻 보기 makes no AI call
  });

  it("review example opens in the original language; E swaps to the stored translation, the next card starts over (N-18)", async () => {
    const storage = memoryStorage();
    const term = (headword: string) => ({ headword, type: "word", senses: [{ gloss: "뜻" }], example: { en: `Use ${headword} here.`, ko: `${headword} 예문 번역` } });
    const ai = scriptedAi([() => ok(["ok", "```json", JSON.stringify({ type: "sentence", title: "t", terms: [term("provision"), term("throughput")] }), "```"].join("\n"))]);
    mountNotebook(root, { storage, aiClient: ai, ask: { system: "" } });
    await settle();
    sendAsk(root, "Provision throughput.");
    await settle(30);
    root.querySelector<HTMLButtonElement>('[data-tab="review"]')!.click();
    await settle(20);
    const key = (k: string) => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    const example = () => root.querySelector(".lh-nb-card-back .lh-nb-example")!;
    showBtn(root).click();
    await settle(20);
    const word = root.querySelector(".lh-nb-card-word")!.textContent!;
    expect(example().textContent).toContain(`Use ${word} here.`);
    expect(example().textContent).not.toContain("예문 번역");
    key("e");
    expect(example().textContent).toContain(`${word} 예문 번역`);
    expect(example().textContent).not.toContain(`Use ${word} here.`);
    expect(example().querySelector(".lh-qz-lang")!.getAttribute("aria-pressed")).toBe("true");
    key("E");
    expect(example().textContent).toContain(`Use ${word} here.`);
    key("e");
    nextBtn(root).click();
    await settle(20);
    showBtn(root).click();
    await settle(20);
    expect(root.querySelector(".lh-nb-card-word")!.textContent).not.toBe(word);
    expect(example().textContent).toContain("here.");
    expect(example().textContent).not.toContain("예문 번역");
  });

  it("review example without a stored translation shows no toggle, and E does nothing (N-18)", async () => {
    const storage = memoryStorage();
    const ai = scriptedAi([() => ok(["ok", "```json", JSON.stringify({ type: "word", title: "x", terms: [
      { headword: "latency", type: "word", senses: [{ gloss: "지연" }], example: { en: "Latency matters." } },
    ] }), "```"].join("\n"))]);
    mountNotebook(root, { storage, aiClient: ai, ask: { system: "" } });
    await settle();
    sendAsk(root, "latency");
    await settle(30);
    root.querySelector<HTMLButtonElement>('[data-tab="review"]')!.click();
    await settle(20);
    showBtn(root).click();
    await settle(20);
    const back = root.querySelector(".lh-nb-card-back")!;
    expect(back.querySelector(".lh-qz-lang")).toBeNull();
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "e", bubbles: true }));
    expect(back.textContent).toContain("Latency matters.");
  });

  it("an ask turn sends the saved terms and does not re-save them; a word asked directly is kept (N-19)", async () => {
    const storage = memoryStorage();
    const reply = (heads: string[]) => ok(["ok", "```json", JSON.stringify({ type: "sentence", title: "t", terms: heads.map((h) => ({ headword: h, type: "word", senses: [{ gloss: "뜻" }] })) }), "```"].join("\n"));
    const ai = scriptedAi([() => reply(["ephemeral", "data", "lost"]), () => reply(["data"])]);
    mountNotebook(root, { storage, aiClient: ai, ask: { system: "" }, seed: { version: "v1", terms: [{ headword: "data", type: "word", gloss: "데이터" }] } });
    await settle(20);
    sendAsk(root, "Data is lost when the instance is ephemeral.");
    await settle(30);
    expect(ai.calls[0].prompt).toContain("[Saved terms");
    expect(ai.calls[0].prompt).toContain("data");
    expect(ai.calls[0].system).toContain("Never list a term that is already in [Saved terms]");
    const data = () => storage.cols.get("terms")!.get("data")!.data as { via: string[]; lookups: number };
    expect(Array.from(storage.cols.get("terms")!.keys()).sort()).toEqual(["data", "ephemeral", "lost"]);
    expect(data().via).toEqual(["seed"]);   // saved already: not re-captured
    root.querySelector<HTMLButtonElement>(".lh-nb-new")!.click();
    await settle();
    sendAsk(root, "data");
    await settle(30);
    expect(data().via).toEqual(["seed", "ask"]);   // asked directly: kept
    expect(data().lookups).toBe(1);
  });

  it("carries no subject wording of its own: labels override the defaults (N-1)", async () => {
    mountNotebook(root, { storage: memoryStorage(), aiClient: null, ask: { system: "" }, labels: { tabDict: "MY-DICT" } });
    await settle();
    expect(root.querySelector('[data-tab="dict"]')!.textContent).toContain("MY-DICT");
  });
});
