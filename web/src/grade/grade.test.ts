// Parity guard (web-contract.md §3): the TS grader port must produce the same verdict/matched/missed/
// normalized_user as the canonical Python engine. Vectors in golden.json are generated FROM the engine
// (web/tools/gen_golden.py), so this asserts parity by construction, not by hand calculation.
import { describe, it, expect } from "vitest";
import { score, ScoreInputError, type ScoreInput } from "./grade";
import golden from "./golden.json";

type GoldenCase = {
  name: string;
  input: { mode: string; user_answer: string | string[]; answer_spec: any; synonyms: any };
  expected: { verdict: string; matched: string[]; missed: string[]; normalized_user: string | string[] };
};

describe("grader parity vs engine golden vectors", () => {
  for (const c of golden as GoldenCase[]) {
    it(c.name, () => {
      const inp: ScoreInput = {
        mode: c.input.mode as ScoreInput["mode"],
        user_answer: c.input.user_answer,
        answer_spec: c.input.answer_spec,
        synonyms: c.input.synonyms,
      };
      const r = score(inp);
      expect({
        verdict: r.verdict,
        matched: r.matched,
        missed: r.missed,
        normalized_user: r.normalized_user,
      }).toEqual(c.expected);
    });
  }
});

describe("grader error cases (parity with engine raises)", () => {
  it("cloze blank-count mismatch throws", () => {
    expect(() =>
      score({ mode: "cloze", user_answer: ["1"], answer_spec: { normalize: [], blanks: [["1"], ["2"]] } }),
    ).toThrow(ScoreInputError);
  });
  it("self invalid verdict throws", () => {
    expect(() =>
      score({ mode: "self", user_answer: "maybe", answer_spec: { normalize: [] } }),
    ).toThrow(ScoreInputError);
  });
  it("unknown mode throws", () => {
    expect(() =>
      score({ mode: "bogus" as any, user_answer: "x", answer_spec: { normalize: [] } }),
    ).toThrow(ScoreInputError);
  });
});
