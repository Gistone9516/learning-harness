// FR-23: the background pass that writes the concept documents.
//
// What matters here is the cost shape and the partial-result behaviour. This pass runs while the
// learner is already reading, so it must publish after every document rather than at the end, and
// one failure must not take the rest of the set down with it.
import { describe, it, expect, vi } from "vitest";
import type { AiClient, AiResponse } from "../../src/ai/client";
import { AiSession } from "../../src/ai/client";
import { outlineConcepts, writeConcept } from "./session";
import type { ConceptSeed } from "./concepts";

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
    repos: vi.fn(),
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
    // Every call in this part is medium; the measured floor is the same at any effort.
    const { client, sent } = scripted(() => ({ text: docReply("ttl-cache") }));
    await writeConcept(new AiSession(client), seed("ttl-cache", "TTL 캐시"));
    expect(sent[0].effort).toBe("medium");
    expect(sent[0].prompt).toContain("ttl-cache");
    expect(sent[0].system).toContain("해설 문서를 쓴다");
  });
});

describe("writeConcept keeps its seed", () => {
  it("keeps the seed's id even when the model answers about something else", async () => {
    // The id is the join key the queue and the stored set use; a reply cannot be allowed to move it.
    const { client } = scripted(() => ({ text: docReply("완전히-다른-것") }));
    const { doc } = await writeConcept(new AiSession(client), seed("ttl-cache"));
    expect(doc!.concept_id).toBe("ttl-cache");
  });
});
