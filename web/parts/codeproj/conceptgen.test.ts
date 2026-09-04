// FR-23: the background pass that writes the concept documents.
//
// What matters here is the cost shape and the partial-result behaviour. This pass runs while the
// learner is already reading, so it must publish after every document rather than at the end, and
// one failure must not take the rest of the set down with it.
import { describe, it, expect, vi } from "vitest";
import type { AiClient, AiResponse } from "../../src/ai/client";
import { AiSession } from "../../src/ai/client";
import { outlineConcepts, writeConcept, writeConcepts } from "./session";
import { conceptProgress, type ConceptSeed, type ConceptSet } from "./concepts";

const seed = (id: string, title = "제목"): ConceptSeed => ({ area: "structure", concept_id: id, title });

const outlineReply = (ids: string[]) =>
  JSON.stringify({ concepts: ids.map((id) => ({ area: "structure", concept_id: id, title: "제목 " + id })) });

const docReply = (id: string) => JSON.stringify({ area: "structure", concept_id: id, title: "제목", body: "## 본문\n\n내용." });

/** Replies scripted per call, recording every request. Same shape the annotation tests use. */
function scripted(reply: (n: number, req: any) => Partial<AiResponse>) {
  const sent: any[] = [];
  const client = {
    ai: vi.fn(async (req: any) => {
      sent.push(req);
      return { ok: true, text: "", session_id: "s1", error: null, ...reply(sent.length, req) } as AiResponse;
    }),
    problems: vi.fn(),
    health: vi.fn(async () => true),
  } as unknown as AiClient;
  return { client, sent };
}

describe("outlineConcepts", () => {
  it("asks once and returns the seeds", async () => {
    const { client, sent } = scripted(() => ({ text: outlineReply(["a-one", "b-two"]) }));
    const seeds = await outlineConcepts(new AiSession(client));
    expect(sent).toHaveLength(1);
    expect(seeds.map((s) => s.concept_id)).toEqual(["a-one", "b-two"]);
  });

  it("returns nothing rather than throwing when the call fails", async () => {
    // An outline that never arrives means no concepts tab, not a broken study screen.
    const { client } = scripted(() => ({ ok: false, error: "boom" }));
    expect(await outlineConcepts(new AiSession(client))).toEqual([]);
  });

  it("resumes the session instead of minting a new one", async () => {
    // The whole cost model is that the codebase is already in this session's context.
    const { client, sent } = scripted(() => ({ text: outlineReply(["a-one"]) }));
    const session = new AiSession(client);
    session.adopt("existing-sid");
    await outlineConcepts(session);
    expect(sent[0].session_id).toBe("existing-sid");
  });
});

describe("writeConcept", () => {
  it("separates a failed call from an unparseable reply", async () => {
    // The list offers a retry either way, but only one of them is worth retrying immediately.
    const bad = scripted(() => ({ ok: false, error: "timeout" }));
    expect((await writeConcept(new AiSession(bad.client), seed("a"))).reason).toBe("call");

    const junk = scripted(() => ({ text: "설명입니다. JSON 아님" }));
    expect((await writeConcept(new AiSession(junk.client), seed("a"))).reason).toBe("parse");
  });

  it("sends the seed and asks for medium effort", async () => {
    // Generation is the only xhigh call in this part; everything resumed is medium.
    const { client, sent } = scripted(() => ({ text: docReply("ttl-cache") }));
    await writeConcept(new AiSession(client), seed("ttl-cache", "TTL 캐시"));
    expect(sent[0].effort).toBe("medium");
    expect(sent[0].prompt).toContain("ttl-cache");
    expect(sent[0].system).toContain("해설 문서를 쓴다");
  });
});

describe("writeConcepts", () => {
  it("makes one call per concept", async () => {
    const { client, sent } = scripted((n) => ({ text: docReply("c-" + n) }));
    await writeConcepts(new AiSession(client), [seed("a"), seed("b"), seed("c")], () => undefined);
    expect(sent).toHaveLength(3);
  });

  it("publishes the set after every document, not only at the end", async () => {
    // The learner is already on the screen. A set that only appears at the end would leave the
    // list empty for minutes and lose everything if they navigate away.
    const { client } = scripted(() => ({ text: docReply("x") }));
    const snapshots: { done: number; total: number }[] = [];
    await writeConcepts(new AiSession(client), [seed("a"), seed("b")], (set: ConceptSet) => {
      const p = conceptProgress(set);
      snapshots.push({ done: p.done, total: p.total });
    });
    // Two per concept: one when it starts being written, one when it lands.
    expect(snapshots).toEqual([
      { done: 0, total: 2 },
      { done: 1, total: 2 },
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ]);
  });

  it("marks exactly one concept as being written, and never two", async () => {
    // The list shows one 작성 중 tag at a time. Two at once would give the eye nowhere to settle,
    // and would also be a lie: the pass is one document per call by construction.
    const { client } = scripted(() => ({ text: docReply("x") }));
    const counts: number[] = [];
    const writing: string[] = [];
    await writeConcepts(new AiSession(client), [seed("a"), seed("b")], (set) => {
      const w = set.entries.filter((e) => e.status === "writing");
      counts.push(w.length);
      if (w.length) writing.push(w[0].seed.concept_id);
    });
    expect(Math.max(...counts)).toBe(1);
    expect(writing).toEqual(["a", "b"]);
  });

  it("isolates a failure to its own concept", async () => {
    // One document failing is a row the learner can retry, not a lost set.
    const { client } = scripted((n) => (n === 2 ? { ok: false, error: "boom" } : { text: docReply("x") }));
    const set = await writeConcepts(
      new AiSession(client),
      [seed("a"), seed("b"), seed("c")],
      () => undefined,
    );
    expect(set.entries.map((e) => e.status)).toEqual(["ok", "failed", "ok"]);
    expect(set.entries[1].reason).toBe("call");
    expect(conceptProgress(set)).toEqual({ done: 2, total: 3, failed: 1 });
  });

  it("keeps the seed's id even when the model answers about something else", async () => {
    const { client } = scripted(() => ({ text: docReply("완전히-다른-것") }));
    const set = await writeConcepts(new AiSession(client), [seed("ttl-cache")], () => undefined);
    expect(set.entries[0].doc!.concept_id).toBe("ttl-cache");
  });
});
