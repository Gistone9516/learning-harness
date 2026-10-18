// WHAT: pure model of the compose part (specs/web-compose.md §2-§3): records, the two AI contracts and
//       their parsers, the local word diff, and revise-queue scheduling. No DOM, no I/O.
// CONSTRAINTS: subject-agnostic (W-1). Every rule here is tested in model.test.ts.

import { extractJsonObject } from "../../src/ai/json";
import { coerceTermInput, review, threadId, type SrsState, type TermInput } from "../notebook/model";

export type Mode = "translate" | "words" | "describe" | "free";
export const MODES: Mode[] = ["translate", "words", "describe", "free"];
export type Verdict = "correct" | "partial" | "incorrect" | "ungraded";
export type GradedVerdict = "correct" | "partial" | "incorrect";
const GRADED: GradedVerdict[] = ["correct", "partial", "incorrect"];

/** W-2: partial (minor slips only) is a pass everywhere a pass matters. One definition. */
export function isPass(v: Verdict | "none" | null | undefined): boolean {
  return v === "correct" || v === "partial";
}
export function isGraded(v: Verdict | null | undefined): v is GradedVerdict {
  return !!v && (GRADED as string[]).includes(v);
}

export interface ComposeExample { en: string; ko?: string }
export interface ComposeError { category: string; from: string; to: string; explain: string; examples?: ComposeExample[] }
export interface Attempt {
  text: string;
  at: number;
  verdict: Verdict | null;          // null = waiting for the grade
  reason?: string;
  corrected?: string;
  natural?: string;
  errors?: ComposeError[];
  terms?: string[];
  self?: boolean;                   // judged by the learner (no AI)
}
export interface TaskData {
  mode: Mode;
  prompt: string;
  words: string[];
  unit?: string;
  model_answer?: string;
  expressions: string[];
  skeleton?: string;
  session_id: string | null;
  attempts: Attempt[];
  revealed: boolean;
  srs: SrsState | null;
}
export interface TaskSummary {
  prompt: string;
  mode: Mode;
  verdict: Verdict | "none";
  attempts: number;
  updated: number;
  queued: boolean;
  due_at: number;
  box: number;
}
export interface GeneratedTask { prompt: string; words: string[]; model_answer?: string; expressions: string[]; skeleton?: string }
export interface Grade {
  verdict: GradedVerdict;
  reason: string;
  corrected?: string;
  natural?: string;
  errors: ComposeError[];
  terms: TermInput[];
}

const DAY_MS = 86_400_000;

/** Where another part leaves words for this one (W-11). One definition, imported by the shell. */
export function composePrefillKey(subjectKey: string): string {
  return `lh:${subjectKey}:compose:prefill`;
}

export function taskId(now: number, rand?: () => number): string {
  return "c" + threadId(now, rand).slice(1);
}

// ── contracts (W-3: generation and grading never share a call) ───────────────

export const GEN_CONTRACT = [
  "[Response contract] Reply with exactly one JSON object and nothing else:",
  '{"tasks":[{"prompt":"<what the learner must write, in the learner\'s language>","words":["<words the answer must use, if any>"],',
  '           "model_answer":"<one good answer>","expressions":["<2-4 key expressions useful for this answer>"],',
  '           "skeleton":"<the sentence structure with blanks, e.g. \'___ is used when ___.\'>"}]}',
  "- Produce exactly the requested count. Keep each task answerable in one to three sentences.",
  "- mode translate: prompt is a sentence to translate. mode words: prompt asks for a sentence using the given words, and words lists them. mode describe: prompt asks to explain or compare something from the curriculum.",
  "- If focus categories are given, design tasks that exercise them.",
].join("\n");

export const GRADE_CONTRACT = (categories: string[]): string => [
  "[Response contract] Reply with exactly one JSON object and nothing else:",
  '{"verdict":"correct"|"partial"|"incorrect","reason":"<one or two sentences in the learner\'s language>",',
  ' "corrected":"<the learner\'s text with the smallest edits that make it correct>","natural":"<how a fluent writer would say it>",',
  ' "errors":[{"category":"<one of the categories>","from":"<learner\'s words>","to":"<fix>","explain":"<why, in the learner\'s language>",',
  '            "examples":[{"en":"<a new sentence that uses the corrected pattern>","ko":"<its translation in the learner\'s language>"}]}],',
  ' "terms":[{"headword":"...","type":"word|phrase|acronym","senses":[{"gloss":"<learner\'s language>","domain":"general|subject"}],"example":{"en":"<the corrected sentence>","ko":"<its translation>"}}]}',
  "- verdict is correct when the text is grammatical, fulfils the task, and would be accepted as written by a fluent reader; small style preferences do not make it incorrect.",
  "- verdict is partial when the meaning is fully conveyed and the task fulfilled, and every remaining error is minor: spelling, an article, singular/plural, punctuation or capitalization.",
  "- verdict is incorrect when the meaning is wrong or unclear, the task is not fulfilled, or there is a structural error such as tense, word order, verb pattern or a missing clause.",
  "- examples: for each grammar error, two short new sentences (not the learner's) that use the corrected pattern correctly, so the learner sees the rule at work. Omit for a pure spelling slip.",
  categories.length ? `- category must be one of: ${categories.join(", ")}.` : "- category: a short name for the kind of error.",
  "- terms: 1-4 expressions from the corrected or natural sentence worth keeping (empty if none). Never one already in [Saved terms], nor another form of it or a phrase that only wraps a saved word in the same sense.",
  "- For a revised answer in the same conversation, grade the new text on its own, and mention whether the earlier problems were fixed.",
].join("\n");

// ── parsers (W-2: anything unusable is null, never a fail) ───────────────────

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean) : [];
}

export function parseTasks(text: string): GeneratedTask[] {
  const o = extractJsonObject(text);
  if (!o || !Array.isArray(o["tasks"])) return [];
  return (o["tasks"] as unknown[])
    .map((t) => (t && typeof t === "object" ? (t as Record<string, unknown>) : {}))
    .map((t) => ({
      prompt: str(t["prompt"]) ?? "",
      words: strList(t["words"]),
      ...(str(t["model_answer"]) ? { model_answer: str(t["model_answer"]) } : {}),
      expressions: strList(t["expressions"]),
      ...(str(t["skeleton"]) ? { skeleton: str(t["skeleton"]) } : {}),
    }))
    .filter((t) => t.prompt);
}

/** W-13: at most two examples, each needing its sentence; a translation is optional. */
function parseExamples(v: unknown): ComposeExample[] {
  if (!Array.isArray(v)) return [];
  const out: ComposeExample[] = [];
  for (const x of v) {
    const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    const en = str(o["en"]);
    if (!en) continue;
    const ko = str(o["ko"]);
    out.push(ko ? { en, ko } : { en });
    if (out.length === 2) break;
  }
  return out;
}

export function parseGrade(text: string): Grade | null {
  const o = extractJsonObject(text);
  if (!o) return null;
  const verdict = o["verdict"];
  if (!isGraded(verdict as Verdict)) return null;   // W-2: an unknown value is never guessed into a verdict
  const errors = Array.isArray(o["errors"])
    ? (o["errors"] as unknown[])
        .map((e) => (e && typeof e === "object" ? (e as Record<string, unknown>) : {}))
        .map((e): ComposeError => {
          const examples = parseExamples(e["examples"]);
          return { category: str(e["category"]) ?? "", from: str(e["from"]) ?? "", to: str(e["to"]) ?? "", explain: str(e["explain"]) ?? "", ...(examples.length ? { examples } : {}) };
        })
        .filter((e) => e.from || e.to || e.explain)
    : [];
  const terms = Array.isArray(o["terms"]) ? (o["terms"] as unknown[]).map(coerceTermInput).filter((t): t is TermInput => t !== null) : [];
  return {
    verdict: verdict as GradedVerdict,
    reason: str(o["reason"]) ?? "",
    ...(str(o["corrected"]) ? { corrected: str(o["corrected"]) } : {}),
    ...(str(o["natural"]) ? { natural: str(o["natural"]) } : {}),
    errors,
    terms,
  };
}

// ── local diff (W-6) ─────────────────────────────────────────────────────────

export interface DiffOp { op: "eq" | "del" | "ins"; text: string }

/** Word-level LCS diff of a → b. Whitespace is not a token; punctuation stays attached to its word. */
export function wordDiff(a: string, b: string): DiffOp[] {
  const A = a.trim() ? a.trim().split(/\s+/) : [];
  const B = b.trim() ? b.trim().split(/\s+/) : [];
  const n = A.length, m = B.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: DiffOp[] = [];
  const push = (op: DiffOp["op"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += " " + text; else out.push({ op, text });
  };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { push("eq", A[i]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) { push("del", A[i]); i++; }
    else { push("ins", B[j]); j++; }
  }
  while (i < n) push("del", A[i++]);
  while (j < m) push("ins", B[j++]);
  return out;
}

// ── revise queue (W-8) ───────────────────────────────────────────────────────

export function scheduleTask(srs: SrsState | null, verdict: Verdict, now: number, intervals?: Record<number, number>): SrsState | null {
  if (verdict === "ungraded") return srs;                    // W-2: no penalty, no change
  if (isPass(verdict)) return srs ? review(srs, true, now, intervals) : null;   // W-8: partial schedules as correct
  const base = review(srs ?? { box: 1, due_at: now, reps: 0, lapses: 0 }, false, now, intervals);
  const firstGap = (intervals?.[1] ?? 1) * DAY_MS;          // rewrite tomorrow, not in the same sitting
  return { ...base, due_at: now + firstGap };
}

export function lastVerdict(d: TaskData): Verdict | "none" {
  for (let k = d.attempts.length - 1; k >= 0; k--) { const v = d.attempts[k].verdict; if (v) return v; }
  return "none";
}

export function taskSummary(d: TaskData, now: number): TaskSummary {
  return {
    prompt: d.prompt.length > 140 ? d.prompt.slice(0, 137) + "…" : d.prompt,
    mode: d.mode,
    verdict: lastVerdict(d),
    attempts: d.attempts.length,
    updated: now,
    queued: !!d.srs,
    due_at: d.srs?.due_at ?? 0,
    box: d.srs?.box ?? 0,
  };
}

/** Error counts by category over every graded attempt, most frequent first. */
export function errorStats(tasks: TaskData[]): { category: string; count: number }[] {
  const m = new Map<string, number>();
  for (const t of tasks) for (const a of t.attempts) for (const e of a.errors ?? []) if (e.category) m.set(e.category, (m.get(e.category) ?? 0) + 1);
  return Array.from(m, ([category, count]) => ({ category, count })).sort((x, y) => y.count - x.count);
}
