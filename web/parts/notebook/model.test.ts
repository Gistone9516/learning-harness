// Pure-model rules of the notebook part (specs/web-notebook.md N-3..N-9, N-20).
import { describe, it, expect } from "vitest";
import {
  isDue, isStopword, mergeTerm, parseReply, parseReviewGrade, review, reviewOrder, reviewPrompt, slugTerm, termSummary, threadId, transcript,
  BOX_MAX, type TermData,
} from "./model";
import { parseTitles, uniqueId } from "./outline";
import { STORAGE_NAME_RE } from "../../src/storage/port";

const DAY = 86_400_000;

describe("slugTerm", () => {
  it("lowercases and hyphenates into a valid state id", () => {
    expect(slugTerm("Auto Scaling")).toBe("auto-scaling");
    expect(slugTerm("S3")).toBe("s3");
    expect(slugTerm("don't")).toBe("dont");
    expect(slugTerm("  --  ")).toBeNull();
    expect(slugTerm("한글")).toBeNull();
    expect(STORAGE_NAME_RE.test(slugTerm("x".repeat(90))!)).toBe(true);
  });
});

describe("threadId", () => {
  it("is a valid, time-sortable state id", () => {
    const id = threadId(new Date(2026, 8, 30, 9, 5, 7).getTime(), () => 0.5);
    expect(id.startsWith("t-20260930-090507-")).toBe(true);
    expect(STORAGE_NAME_RE.test(id)).toBe(true);
  });
});

describe("parseReply (N-4)", () => {
  it("splits the markdown from the trailing json block", () => {
    const text = "## Meaning\nIt is temporary.\n\n```json\n{\"type\":\"word\",\"title\":\"ephemeral\",\"terms\":[{\"headword\":\"ephemeral\",\"type\":\"word\",\"senses\":[{\"gloss\":\"temporary\",\"domain\":\"general\"}],\"example\":{\"en\":\"It is ephemeral.\"}}]}\n```";
    const r = parseReply(text);
    expect(r.answer).toBe("## Meaning\nIt is temporary.");
    expect(r.meta?.type).toBe("word");
    expect(r.meta?.title).toBe("ephemeral");
    expect(r.meta?.terms[0]).toMatchObject({ headword: "ephemeral", senses: [{ gloss: "temporary", domain: "general" }], example: { en: "It is ephemeral." } });
  });
  it("keeps the text and yields no meta when the block is missing or broken", () => {
    expect(parseReply("plain answer")).toEqual({ answer: "plain answer", meta: null });
    const broken = parseReply("answer\n```json\n{not json}\n```");
    expect(broken.answer).toBe("answer");
    expect(broken.meta).toBeNull();
  });
  it("drops terms without a headword and unknown thread types", () => {
    const r = parseReply('x\n```json\n{"type":"poem","terms":[{"gloss":"no head"},{"headword":"volume"}]}\n```');
    expect(r.meta?.type).toBeUndefined();
    expect(r.meta?.terms.map((t) => t.headword)).toEqual(["volume"]);
  });
});

describe("mergeTerm (N-5)", () => {
  const first = mergeTerm(null, { headword: "provision", type: "word", gloss: "to supply", example: { en: "Provision an instance." } }, { now: 1000, via: "ask", thread: "t-a" });
  it("creates a due, box-1 record with one lookup", () => {
    expect(first.lookups).toBe(1);
    expect(first.srs).toEqual({ box: 1, due_at: 1000, reps: 0, lapses: 0 });
    expect(first.threads).toEqual(["t-a"]);
    expect(first.examples[0].thread).toBe("t-a");
  });
  it("increments lookups and merges instead of overwriting", () => {
    const again = mergeTerm(first, { headword: "provision", senses: [{ gloss: "to supply" }, { gloss: "to set up", domain: "subject" }], example: { en: "Provision storage." } }, { now: 2000, via: "ask", thread: "t-b" });
    expect(again.lookups).toBe(2);
    expect(again.senses.map((s) => s.gloss)).toEqual(["to supply", "to set up"]);
    expect(again.examples.map((e) => e.en)).toEqual(["Provision storage.", "Provision an instance."]);
    expect(again.threads).toEqual(["t-b", "t-a"]);
    expect(again.first_seen).toBe(1000);
    expect(again.last_seen).toBe(2000);
    expect(again.srs).toEqual(first.srs);
  });
  it("a seed never counts as a lookup", () => {
    expect(mergeTerm(null, { headword: "AMI", type: "acronym", expansion: "x" }, { now: 1, via: "seed" }).lookups).toBe(0);
  });
  it("summary carries the searchable fields (N-9)", () => {
    expect(termSummary(first)).toEqual({ headword: "provision", type: "word", gloss: "to supply", lookups: 1, known: false, box: 1, due_at: 1000, last_seen: 1000 });
  });
});

describe("stopwords (N-6)", () => {
  it("matches case-insensitively", () => {
    expect(isStopword("The", new Set(["the"]))).toBe(true);
    expect(isStopword("volume", new Set(["the"]))).toBe(false);
  });
});

describe("review (N-8)", () => {
  const s = { box: 1, due_at: 0, reps: 0, lapses: 0 };
  it("correct moves up one box with that box's interval", () => {
    expect(review(s, true, 0)).toEqual({ box: 2, due_at: 2 * DAY, reps: 1, lapses: 0 });
    expect(review({ ...s, box: BOX_MAX }, true, 0).box).toBe(BOX_MAX);
  });
  it("incorrect returns to box 1, due now", () => {
    expect(review({ box: 4, due_at: 9, reps: 3, lapses: 0 }, false, 50)).toEqual({ box: 1, due_at: 50, reps: 4, lapses: 1 });
  });
  it("known terms are never due; order is lookups then oldest due", () => {
    expect(isDue({ known: true, due_at: 0 }, 10)).toBe(false);
    expect(isDue({ known: false, due_at: 10 }, 10)).toBe(true);
    const items = [{ id: "a", lookups: 1, due_at: 5 }, { id: "b", lookups: 3, due_at: 9 }, { id: "c", lookups: 1, due_at: 1 }];
    expect(reviewOrder(items, (x) => x).map((x) => x.id)).toEqual(["b", "c", "a"]);
  });
});

describe("transcript (N-3)", () => {
  it("skips failed turns", () => {
    const t = transcript([{ q: "a", a: "b", at: 0, terms: [] }, { q: "c", a: "err", at: 0, terms: [], error: true }]);
    expect(t).toBe("Learner: a\n\nTutor: b");
  });
});

describe("outline helpers", () => {
  it("uniqueId is valid and suffixes collisions", () => {
    expect(uniqueId("EC2 Basics", new Set(), "u1")).toBe("ec2-basics");
    expect(uniqueId("EC2 Basics", new Set(["ec2-basics"]), "u1")).toBe("ec2-basics-2");
    expect(uniqueId("한글만", new Set(), "u3")).toBe("u3");
    expect(uniqueId("3 tier", new Set(), "u1")).toBe("c-3-tier");
  });
  it("parseTitles tolerates fences and prose", () => {
    expect(parseTitles('Here:\n```json\n["IAM users", "IAM roles"]\n```')).toEqual(["IAM users", "IAM roles"]);
    expect(parseTitles("nothing")).toEqual([]);
  });
});

// Keep the type import honest: a TermData literal must satisfy the model.
const _typecheck: TermData = mergeTerm(null, { headword: "x" }, { now: 0, via: "ask" });
void _typecheck;

describe("typed-meaning grading (N-20)", () => {
  it("reads a verdict with feedback; anything else is ungraded (null)", () => {
    expect(parseReviewGrade('```json\n{"verdict":"correct","feedback":" 좋음 "}\n```')).toEqual({ verdict: "correct", feedback: "좋음" });
    expect(parseReviewGrade('{"verdict":"incorrect"}')).toEqual({ verdict: "incorrect", feedback: "" });
    expect(parseReviewGrade('{"verdict":"partial","feedback":"x"}')).toBeNull();
    expect(parseReviewGrade("맞았어요")).toBeNull();
  });
  it("sends the term with its reference meanings and the answer", () => {
    const p = reviewPrompt({ headword: "EBS", expansion: "Elastic Block Store", senses: [{ gloss: "블록 스토리지" }] }, "디스크");
    expect(p).toBe("Term: EBS (Elastic Block Store)\nMeanings: 블록 스토리지\nAnswer: 디스크");
  });
});
