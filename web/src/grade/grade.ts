// Deterministic grader port (web-contract.md §3). A faithful TypeScript port of the engine's
// normalize() + score() (engine/scoring.py, core SoT §7.5·§7.10). Token 0, client-side. The
// golden-vector parity test (grade.test.ts) asserts identical verdicts to the Python engine; this
// file must not diverge from engine/scoring.py without updating both against the vectors.

export type Verdict = "correct" | "incorrect" | "skip";
export type ScoreMode = "exact" | "keyword" | "cloze" | "self";

export interface AnswerSpec {
  normalize: string[];
  accepted?: string[] | null;
  required_keywords?: string[][] | null;
  blanks?: string[][] | null;
  sequence?: string[] | null;
}

export interface ScoreInput {
  mode: ScoreMode;
  user_answer: string | string[];
  answer_spec: AnswerSpec;
  synonyms?: Record<string, string> | null;
}

export interface ScoreResult {
  verdict: "correct" | "incorrect";
  matched: string[];
  missed: string[];
  normalized_user: string | string[];
  feedback: { highlight_missed: string[] };
}

export class ScoreInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScoreInputError";
  }
}

const _VALID_MODES: ReadonlySet<string> = new Set(["exact", "keyword", "cloze", "self"]);

// ── Normalization ────────────────────────────────────────────────────────────

function applyRule(s: string, ruleId: string): string {
  switch (ruleId) {
    case "nfkc":
      return s.normalize("NFKC");
    case "trim":
      return s.trim();
    case "collapse_space":
      return s.replace(/[\s　﻿]+/g, " ");
    case "strip_all_space":
      return s.replace(/[\s　﻿]+/g, "");
    case "lower":
      // ASCII A-Z only (matches the engine; full Unicode lower is out of scope).
      return s.replace(/[A-Z]/g, (c) => c.toLowerCase());
    case "fullwidth_to_halfwidth":
      return s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
    case "unify_cell_dollar":
      return s.replace(/\$/g, "");
    case "unify_arg_sep":
      return s.replace(/[;；]/g, ",").replace(/，/g, ",");
    case "strip_trailing_paren":
      return s.replace(/\s*\(.*?\)\s*$/, "").replace(/\s+$/, "");
    default:
      return s; // unknown rule: pass through
  }
}

function applySynonyms(s: string, synonyms: Record<string, string> | null | undefined): string {
  if (!synonyms) return s;
  // Token-level exact substitution (split on single space), runs right after `lower`.
  return s
    .split(" ")
    .map((tok) => (Object.prototype.hasOwnProperty.call(synonyms, tok) ? synonyms[tok] : tok))
    .join(" ");
}

export function normalize(
  s: string,
  rules: string[],
  synonyms?: Record<string, string> | null,
): string {
  let result = typeof s === "string" ? s : String(s);
  for (const ruleId of rules) {
    result = applyRule(result, ruleId);
    if (ruleId === "lower") {
      result = applySynonyms(result, synonyms);
    }
  }
  return result;
}

// ── Scoring ──────────────────────────────────────────────────────────────────

function normFn(spec: AnswerSpec, synonyms?: Record<string, string> | null) {
  const rules = spec.normalize && spec.normalize.length ? spec.normalize : [];
  return (s: string) => normalize(s, rules, synonyms);
}

function scoreExact(inp: ScoreInput): ScoreResult {
  const norm = normFn(inp.answer_spec, inp.synonyms);
  const spec = inp.answer_spec;

  if (spec.sequence != null) {
    let userSteps: string[];
    if (Array.isArray(inp.user_answer)) {
      userSteps = inp.user_answer.map((x) => norm(x));
    } else if (typeof inp.user_answer === "string") {
      userSteps = inp.user_answer.split(",").map((x) => norm(x.trim()));
    } else {
      throw new ScoreInputError("recall_seq exact mode: user_answer must be list[str] or str");
    }
    const seqSteps = spec.sequence.map((x) => norm(x));
    if (userSteps.length !== seqSteps.length) {
      return {
        verdict: "incorrect",
        matched: [],
        missed: seqSteps,
        normalized_user: userSteps,
        feedback: { highlight_missed: seqSteps },
      };
    }
    const allMatch = seqSteps.every((a, i) => userSteps[i] === a);
    const stepMatched = seqSteps.filter((a, i) => userSteps[i] === a);
    const stepMissed = seqSteps.filter((a, i) => userSteps[i] !== a);
    return {
      verdict: allMatch ? "correct" : "incorrect",
      matched: stepMatched,
      missed: stepMissed,
      normalized_user: userSteps,
      feedback: { highlight_missed: stepMissed },
    };
  }

  if (typeof inp.user_answer !== "string") {
    throw new ScoreInputError("exact mode: user_answer must be str");
  }
  const normUser = norm(inp.user_answer);
  const accepted = spec.accepted ?? [];
  const normAccepted = accepted.map((a) => norm(a));
  const matchedVal = normAccepted.find((a) => a === normUser);
  const isCorrect = matchedVal !== undefined;
  return {
    verdict: isCorrect ? "correct" : "incorrect",
    matched: isCorrect ? [matchedVal as string] : [],
    missed: [],
    normalized_user: normUser,
    feedback: { highlight_missed: [] },
  };
}

function scoreKeyword(inp: ScoreInput): ScoreResult {
  if (typeof inp.user_answer !== "string") {
    throw new ScoreInputError("keyword mode: user_answer must be str");
  }
  const norm = normFn(inp.answer_spec, inp.synonyms);
  const normUser = norm(inp.user_answer);
  const groups = inp.answer_spec.required_keywords ?? [];
  if (!groups.length) {
    throw new ScoreInputError("keyword mode: required_keywords must not be empty");
  }
  const matched: string[] = [];
  const missed: string[] = [];
  for (const group of groups) {
    const normGroup = group ? group.map((k) => norm(k)) : [];
    const hit = normGroup.find((k) => normUser.includes(k)); // substring containment
    if (hit !== undefined) matched.push(hit);
    else missed.push(normGroup.length ? normGroup[0] : "");
  }
  const isCorrect = missed.length === 0;
  return {
    verdict: isCorrect ? "correct" : "incorrect",
    matched,
    missed,
    normalized_user: normUser,
    feedback: { highlight_missed: missed },
  };
}

function scoreCloze(inp: ScoreInput): ScoreResult {
  if (!Array.isArray(inp.user_answer)) {
    throw new ScoreInputError("cloze mode: user_answer must be list[str]");
  }
  const blanks = inp.answer_spec.blanks ?? [];
  if (!blanks.length) throw new ScoreInputError("cloze mode: blanks must not be empty");
  if (inp.user_answer.length !== blanks.length) {
    throw new ScoreInputError(
      `cloze blank count mismatch: got ${inp.user_answer.length}, expected ${blanks.length}`,
    );
  }
  const norm = normFn(inp.answer_spec, inp.synonyms);
  const normUser = inp.user_answer.map((u) => norm(u));
  const matched: string[] = [];
  const missed: string[] = [];
  blanks.forEach((candidates, i) => {
    const normCands = candidates ? candidates.map((c) => norm(c)) : [];
    if (normCands.includes(normUser[i])) matched.push(String(i));
    else missed.push(String(i));
  });
  const isCorrect = missed.length === 0;
  return {
    verdict: isCorrect ? "correct" : "incorrect",
    matched,
    missed,
    normalized_user: normUser,
    feedback: { highlight_missed: missed },
  };
}

function scoreSelf(inp: ScoreInput): ScoreResult {
  const ua = inp.user_answer;
  if (ua !== "correct" && ua !== "incorrect") {
    throw new ScoreInputError(`self mode: user_answer must be "correct" or "incorrect". Got: ${JSON.stringify(ua)}`);
  }
  return {
    verdict: ua,
    matched: [],
    missed: [],
    normalized_user: ua,
    feedback: { highlight_missed: [] },
  };
}

export function score(inp: ScoreInput): ScoreResult {
  const mode = inp.mode;
  if (!_VALID_MODES.has(mode)) throw new ScoreInputError(`unknown grade_mode: ${JSON.stringify(mode)}`);
  switch (mode) {
    case "exact":
      return scoreExact(inp);
    case "keyword":
      return scoreKeyword(inp);
    case "cloze":
      return scoreCloze(inp);
    case "self":
      return scoreSelf(inp);
    default:
      throw new ScoreInputError(`unhandled mode: ${JSON.stringify(mode)}`);
  }
}
