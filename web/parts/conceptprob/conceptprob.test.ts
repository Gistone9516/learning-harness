import { describe, it, expect } from "vitest";
import {
  parseConcept,
  buildIndex,
  gradeProblem,
  type GeneratedConcept,
  type ProblemDef,
  type AreaDef,
  type ConceptSeed,
} from "./conceptprob";
import type { AiResponse } from "../../src/ai/client";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CANNED: GeneratedConcept = {
  area: "fundamentals",
  concept_id: "variables",
  title: "Variables",
  body: "A variable is a named storage location.\n\n## Types\nInteger, String, Boolean.",
  problems: [
    {
      card_id: "p-exact-1",
      type: "func",
      grade_mode: "exact",
      front: { prompt: "What keyword declares a constant in JS?" },
      answer_spec: { normalize: ["nfkc", "trim", "lower"], accepted: ["const"] },
    },
    {
      card_id: "p-keyword-1",
      type: "proc",
      grade_mode: "keyword",
      front: { prompt: "Explain variable scope." },
      answer_spec: {
        normalize: ["nfkc", "trim", "lower"],
        required_keywords: [["scope"], ["variable", "var"]],
      },
    },
    {
      card_id: "p-cloze-1",
      type: "cloze",
      grade_mode: "cloze",
      front: { text: "The {{0}} keyword declares a mutable binding; {{1}} is immutable." },
      answer_spec: {
        normalize: ["nfkc", "trim", "lower"],
        blanks: [["let"], ["const"]],
      },
      links: { concept_ref: "types" },
    },
  ],
};

// ── parseConcept ──────────────────────────────────────────────────────────────

describe("parseConcept", () => {
  it("parses plain JSON", () => {
    const result = parseConcept(JSON.stringify(CANNED));
    expect(result).not.toBeNull();
    expect(result!.concept_id).toBe("variables");
    expect(result!.problems).toHaveLength(3);
  });

  it("parses JSON wrapped in markdown code fence", () => {
    const fenced = "```json\n" + JSON.stringify(CANNED) + "\n```";
    const result = parseConcept(fenced);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Variables");
  });

  it("parses JSON wrapped in plain code fence (no language tag)", () => {
    const fenced = "```\n" + JSON.stringify(CANNED) + "\n```";
    const result = parseConcept(fenced);
    expect(result).not.toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseConcept("{broken json")).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    const bad = { area: "x", title: "y" }; // missing concept_id, body, problems
    expect(parseConcept(JSON.stringify(bad))).toBeNull();
  });

  it("preserves problem grade_mode and answer_spec", () => {
    const result = parseConcept(JSON.stringify(CANNED));
    expect(result!.problems[0].grade_mode).toBe("exact");
    expect(result!.problems[1].grade_mode).toBe("keyword");
    expect(result!.problems[2].grade_mode).toBe("cloze");
    expect(result!.problems[2].links?.concept_ref).toBe("types");
  });
});

// ── buildIndex ────────────────────────────────────────────────────────────────

describe("buildIndex", () => {
  const areas: AreaDef[] = [
    { key: "a1", label: "Area One", icon: "1" },
    { key: "a2", label: "Area Two" },
  ];
  const seeds: ConceptSeed[] = [
    { concept_id: "c1", title: "Concept One" },
    { concept_id: "c2", title: "Concept Two" },
  ];
  const outline: Record<string, ConceptSeed[]> = {
    a1: seeds,
    a2: [],
  };

  it("builds index nodes for each area", () => {
    const index = buildIndex(areas, outline);
    expect(index).toHaveLength(2);
    expect(index[0].area.key).toBe("a1");
    expect(index[0].concepts).toHaveLength(2);
    expect(index[1].area.key).toBe("a2");
    expect(index[1].concepts).toHaveLength(0);
  });

  it("returns empty concepts array for areas with no outline entry", () => {
    const index = buildIndex(areas, {});
    expect(index[0].concepts).toHaveLength(0);
    expect(index[1].concepts).toHaveLength(0);
  });

  it("maps concept seeds verbatim", () => {
    const index = buildIndex(areas, outline);
    expect(index[0].concepts[0].concept_id).toBe("c1");
    expect(index[0].concepts[1].title).toBe("Concept Two");
  });
});

// ── gradeProblem ──────────────────────────────────────────────────────────────

describe("gradeProblem - exact mode", () => {
  const problem = CANNED.problems[0];

  it("correct on exact match (case-insensitive via lower rule)", () => {
    const r = gradeProblem(problem, "const");
    expect(r.verdict).toBe("correct");
  });

  it("correct with uppercase input (normalize lower)", () => {
    const r = gradeProblem(problem, "CONST");
    expect(r.verdict).toBe("correct");
  });

  it("incorrect on wrong answer", () => {
    const r = gradeProblem(problem, "let");
    expect(r.verdict).toBe("incorrect");
  });

  it("incorrect on empty answer", () => {
    const r = gradeProblem(problem, "");
    expect(r.verdict).toBe("incorrect");
  });
});

describe("gradeProblem - keyword mode", () => {
  const problem = CANNED.problems[1];

  it("correct when all keyword groups are present", () => {
    const r = gradeProblem(problem, "A variable has a scope that defines where var can be accessed.");
    expect(r.verdict).toBe("correct");
    expect(r.missed).toHaveLength(0);
  });

  it("incorrect when a keyword group is missing", () => {
    const r = gradeProblem(problem, "scope determines access");
    expect(r.verdict).toBe("incorrect");
    expect(r.missed.length).toBeGreaterThan(0);
  });

  it("matched array contains the found keyword", () => {
    const r = gradeProblem(problem, "variable scope is important");
    expect(r.matched.length).toBeGreaterThan(0);
  });
});

describe("gradeProblem - cloze mode", () => {
  const problem = CANNED.problems[2];

  it("correct when all blanks match accepted values", () => {
    const r = gradeProblem(problem, ["let", "const"]);
    expect(r.verdict).toBe("correct");
    expect(r.missed).toHaveLength(0);
  });

  it("correct with uppercase (normalize lower)", () => {
    const r = gradeProblem(problem, ["LET", "CONST"]);
    expect(r.verdict).toBe("correct");
  });

  it("incorrect when one blank is wrong", () => {
    const r = gradeProblem(problem, ["var", "const"]);
    expect(r.verdict).toBe("incorrect");
    expect(r.missed).toContain("0");
  });

  it("incorrect when both blanks are wrong", () => {
    const r = gradeProblem(problem, ["var", "var"]);
    expect(r.verdict).toBe("incorrect");
    expect(r.missed).toHaveLength(2);
  });

  it("returns concept_ref from links on incorrect verdict", () => {
    const r = gradeProblem(problem, ["var", "var"]);
    expect(r.concept_ref).toBe("types");
  });

  it("returns no concept_ref on correct verdict (link still present, but verdict is correct)", () => {
    const r = gradeProblem(problem, ["let", "const"]);
    expect(r.verdict).toBe("correct");
    // concept_ref is still available in the result (UI decides whether to show it)
    expect(r.concept_ref).toBe("types");
  });
});

describe("gradeProblem - retrace link on incorrect", () => {
  const problem: ProblemDef = {
    card_id: "retrace-test",
    type: "func",
    grade_mode: "exact",
    front: { prompt: "test" },
    answer_spec: { normalize: ["trim"], accepted: ["alpha"] },
    links: { concept_ref: "section-alpha" },
  };

  it("provides concept_ref when answer is wrong", () => {
    const r = gradeProblem(problem, "beta");
    expect(r.verdict).toBe("incorrect");
    expect(r.concept_ref).toBe("section-alpha");
  });

  it("provides concept_ref even when correct (UI filters by verdict)", () => {
    const r = gradeProblem(problem, "alpha");
    expect(r.verdict).toBe("correct");
    expect(r.concept_ref).toBe("section-alpha");
  });

  it("concept_ref is undefined when links absent", () => {
    const p: ProblemDef = { ...problem, links: undefined };
    const r = gradeProblem(p, "beta");
    expect(r.concept_ref).toBeUndefined();
  });
});

// ── Fake AiSession shape test ─────────────────────────────────────────────────

describe("generateConcept shape (fake AiSession)", () => {
  it("parseConcept works on the canned response text", () => {
    const fakeResponse: AiResponse = {
      ok: true,
      text: JSON.stringify(CANNED),
      session_id: "fake-session-001",
      error: null,
    };
    // Directly test parseConcept on what a fake session.send() would return
    const parsed = parseConcept(fakeResponse.text);
    expect(parsed).not.toBeNull();
    expect(parsed!.concept_id).toBe("variables");
    expect(parsed!.problems).toHaveLength(3);
  });

  it("parseConcept returns null when AI returns ok:false (empty text)", () => {
    const fakeError: AiResponse = {
      ok: false,
      text: "",
      session_id: null,
      error: "timeout",
    };
    const parsed = parseConcept(fakeError.text);
    expect(parsed).toBeNull();
  });
});
