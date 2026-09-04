// The concept layer's model: what survives a reply and what is dropped.
//
// Both parsers are tolerant per item and strict per field, and the strictness is the part worth
// pinning: a repaired id or a renamed concept produces a list row that nothing will ever fill,
// which reads to the learner as a document that never finished rather than as a rejected one.
import { describe, it, expect } from "vitest";
import {
  CONCEPT_MAX,
  conceptProgress,
  docSteps,
  parseDoc,
  parseSeeds,
  seedSet,
  type ConceptSeed,
} from "./concepts";

const seed = (over: Partial<ConceptSeed> = {}): ConceptSeed => ({
  area: "structure",
  concept_id: "layered-architecture",
  title: "계층 분리 구조",
  ...over,
});

const outline = (concepts: unknown[]) => JSON.stringify({ concepts });

describe("parseSeeds", () => {
  it("keeps a well-formed outline in the order it arrived", () => {
    // The model groups related concepts next to each other; that ordering is the reading order
    // and re-sorting it here would throw away the only structure the list has.
    const seeds = parseSeeds(
      outline([
        { area: "structure", concept_id: "layered-architecture", title: "계층 분리 구조" },
        { area: "storage", concept_id: "record-file-index", title: "레코드 파일과 인덱스" },
      ]),
    );
    expect(seeds.map((s) => s.concept_id)).toEqual(["layered-architecture", "record-file-index"]);
  });

  it("drops an id the storage rule would reject rather than repairing it", () => {
    // A repaired id stops matching the one the model uses when it writes that document, so the
    // two silently fail to join and the row never fills.
    const seeds = parseSeeds(
      outline([
        { area: "a", concept_id: "TTL_Cache", title: "안 됨" },
        { area: "a", concept_id: "app/db.py", title: "안 됨" },
        { area: "a", concept_id: "-leading", title: "안 됨" },
        { area: "a", concept_id: "ttl-cache", title: "됨" },
      ]),
    );
    expect(seeds.map((s) => s.title)).toEqual(["됨"]);
  });

  it("drops a duplicate id, keeping the first", () => {
    const seeds = parseSeeds(
      outline([
        { area: "a", concept_id: "ttl-cache", title: "먼저" },
        { area: "a", concept_id: "ttl-cache", title: "나중" },
      ]),
    );
    expect(seeds).toHaveLength(1);
    expect(seeds[0].title).toBe("먼저");
  });

  it("drops an item with no title but keeps its neighbours", () => {
    const seeds = parseSeeds(
      outline([
        { area: "a", concept_id: "ok-one", title: "있음" },
        { area: "a", concept_id: "no-title" },
        { area: "a", concept_id: "ok-two", title: "있음2" },
      ]),
    );
    expect(seeds.map((s) => s.concept_id)).toEqual(["ok-one", "ok-two"]);
  });

  it("defaults a missing area instead of dropping the concept", () => {
    // area only groups the list. Losing a whole concept over a missing grouping key would trade
    // something the learner reads for something they barely see.
    expect(parseSeeds(outline([{ concept_id: "ok", title: "제목" }]))[0].area).toBe("general");
  });

  it("caps the outline", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      area: "a",
      concept_id: `c-${i}`,
      title: `제목 ${i}`,
    }));
    expect(parseSeeds(outline(many))).toHaveLength(CONCEPT_MAX);
  });

  it("survives a fenced reply, and returns nothing for junk", () => {
    expect(parseSeeds("```json\n" + outline([seed()]) + "\n```")).toHaveLength(1);
    expect(parseSeeds("설명입니다. JSON 아님")).toEqual([]);
    expect(parseSeeds(JSON.stringify({ concepts: "not an array" }))).toEqual([]);
  });
});

describe("parseDoc", () => {
  it("takes the body and a better title, but never a different id", () => {
    // A model that renames the concept mid-answer would orphan the document against its seed.
    const doc = parseDoc(
      JSON.stringify({ area: "other", concept_id: "something-else", title: "더 나은 제목", body: "## 본문" }),
      seed(),
    );
    expect(doc).toEqual({
      area: "other",
      concept_id: "layered-architecture",
      title: "더 나은 제목",
      body: "## 본문",
    });
  });

  it("falls back to the seed's own title and area", () => {
    const doc = parseDoc(JSON.stringify({ body: "## 본문" }), seed());
    expect(doc!.title).toBe("계층 분리 구조");
    expect(doc!.area).toBe("structure");
  });

  it("rejects a document with no body at all", () => {
    // An empty body renders as a blank page, which reads as a bug rather than as a failure the
    // list could offer to retry.
    expect(parseDoc(JSON.stringify({ title: "제목" }), seed())).toBeNull();
    expect(parseDoc(JSON.stringify({ title: "제목", body: "   " }), seed())).toBeNull();
    expect(parseDoc("JSON 아님", seed())).toBeNull();
  });
});

describe("the set the learner walks into", () => {
  it("knows every concept before any is written", () => {
    // The list is a table of contents filling in, so all rows exist from the first moment.
    const set = seedSet([seed(), seed({ concept_id: "ttl-cache", title: "TTL 캐시" })]);
    expect(set.entries).toHaveLength(2);
    expect(set.entries.every((e) => e.status === "pending")).toBe(true);
    expect(conceptProgress(set)).toEqual({ done: 0, total: 2, failed: 0 });
  });

  it("counts written and failed apart", () => {
    const set = seedSet([seed(), seed({ concept_id: "b", title: "B" }), seed({ concept_id: "c", title: "C" })]);
    set.entries[0].status = "ok";
    set.entries[1].status = "failed";
    expect(conceptProgress(set)).toEqual({ done: 1, total: 3, failed: 1 });
  });

  it("renders a written document through the shared dialect", () => {
    const set = seedSet([seed()]);
    expect(docSteps(set.entries[0])).toBeNull();
    set.entries[0].doc = { ...seed(), body: "## 첫 절\n\n본문입니다.\n\n## 둘째 절\n\n본문2." };
    set.entries[0].status = "ok";
    const parsed = docSteps(set.entries[0])!;
    expect(parsed.steps.map((s) => s.title)).toEqual(["첫 절", "둘째 절"]);
  });
});
