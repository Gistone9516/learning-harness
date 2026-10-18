// WHAT: pure model of the quiz part (specs/web-quiz.md): bank assembly, set building, the answer log,
//       statistics, and the translation contract. No DOM, no I/O. Tested in model.test.ts.

import { extractJsonObject } from "../../src/ai/json";
import type { GeneratedConcept, ProblemDef } from "../conceptprob/conceptprob";

export interface FrontKo { scenario?: string; prompt?: string; text?: string; options?: string[] }
export interface QuizProblem extends ProblemDef { front_ko?: FrontKo; area: string; concept_id: string }
export interface ProblemSet { generated: QuizProblem[]; ko: Record<string, FrontKo> }
export interface LogItem { h: ("c" | "i")[]; f?: boolean; d?: string; at?: number }
export interface QuizLog { items: Record<string, LogItem> }
export type Source = "all" | "unseen" | "wrong" | "flagged";
export type QuizMode = "practice" | "exam";

export interface AnswerState { value: string | string[]; verdict?: "correct" | "incorrect" }
export interface ActiveSet {
  mode: QuizMode;
  ids: string[];
  answers: Record<string, AnswerState>;
  idx: number;
  started: number;
  limitSec: number;          // 0 = no timer
  finished: boolean;
}

export const LOG_DOC = "quiz-log";
export const PROBLEMS = "problems";
export const HISTORY_CAP = 10;

const TEXT_KEYS = ["scenario", "prompt", "text"] as const;

/** The stem of a front, whichever key carries it. */
export function stemOf(front: Record<string, unknown> | FrontKo): string {
  for (const k of TEXT_KEYS) { const v = (front as Record<string, unknown>)[k]; if (typeof v === "string" && v) return v; }
  return "";
}

/** Keep the fields this part needs from a raw generated problem (conceptprob's coercion drops front_ko). */
export function coerceQuizProblem(raw: unknown, area: string, conceptId: string): QuizProblem | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const card_id = typeof p["card_id"] === "string" ? p["card_id"] : "";
  if (!card_id || !p["front"] || typeof p["front"] !== "object") return null;
  const ko = coerceFrontKo(p["front_ko"]);
  return {
    card_id,
    type: (p["type"] ?? "func") as ProblemDef["type"],
    grade_mode: (p["grade_mode"] ?? "exact") as ProblemDef["grade_mode"],
    front: p["front"] as Record<string, unknown>,
    answer_spec: (p["answer_spec"] ?? { normalize: [] }) as ProblemDef["answer_spec"],
    ...(typeof p["explain"] === "string" && p["explain"] ? { explain: p["explain"] as string } : {}),
    ...(ko ? { front_ko: ko } : {}),
    area,
    concept_id: conceptId,
  };
}

export function coerceFrontKo(raw: unknown): FrontKo | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const out: FrontKo = {};
  for (const k of TEXT_KEYS) if (typeof o[k] === "string" && (o[k] as string).trim()) out[k] = (o[k] as string).trim();
  if (Array.isArray(o["options"])) out.options = (o["options"] as unknown[]).map((x) => String(x ?? ""));
  return stemOf(out) ? out : null;
}

/** A translation is usable only if it has a stem and, for a judge item, the same number of options (Q-4). */
export function validKo(p: ProblemDef, ko: FrontKo | null | undefined): ko is FrontKo {
  if (!ko || !stemOf(ko)) return false;
  const opts = p.front["options"];
  if (p.type === "judge" && Array.isArray(opts)) return Array.isArray(ko.options) && ko.options.length === opts.length;
  return true;
}

/** Q-2: concept problems + generated problems, minus deleted ones; each tagged with its area and concept. */
export function assembleBank(
  outline: { areas: { key: string }[]; conceptOutline: Record<string, { concept_id: string }[]> },
  concepts: Record<string, GeneratedConcept | null>,
  sets: Record<string, ProblemSet | null>,
  log: QuizLog,
): QuizProblem[] {
  const out: QuizProblem[] = [];
  const seen = new Set<string>();
  for (const a of outline.areas) {
    for (const seed of outline.conceptOutline[a.key] ?? []) {
      const set = sets[seed.concept_id];
      const fromConcept = (concepts[seed.concept_id]?.problems ?? []).map((p) => ({ ...p, area: a.key, concept_id: seed.concept_id }) as QuizProblem);
      for (const p of fromConcept.concat(set?.generated ?? [])) {
        if (!p.card_id || seen.has(p.card_id) || log.items[p.card_id]?.d !== undefined) continue;
        seen.add(p.card_id);
        const ko = set?.ko[p.card_id] ?? p.front_ko;
        out.push({ ...p, area: a.key, concept_id: seed.concept_id, ...(validKo(p, ko) ? { front_ko: ko } : {}) });
      }
    }
  }
  return out;
}

export function lastVerdict(log: QuizLog, id: string): "c" | "i" | null {
  const h = log.items[id]?.h;
  return h && h.length ? h[h.length - 1] : null;
}

export function matchesSource(log: QuizLog, id: string, source: Source): boolean {
  if (source === "all") return true;
  if (source === "unseen") return !log.items[id]?.h?.length;
  if (source === "wrong") return lastVerdict(log, id) === "i";
  return !!log.items[id]?.f;
}

export function shuffle<T>(arr: T[], rand: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Q-6: units x source x count, shuffled. */
export function buildSet(bank: QuizProblem[], log: QuizLog, opts: { units: string[]; source: Source; count: number; mode: QuizMode; secondsPerItem: number; now: number }, rand?: () => number): ActiveSet {
  const pool = bank.filter((p) => (!opts.units.length || opts.units.includes(p.area)) && matchesSource(log, p.card_id, opts.source));
  const ids = shuffle(pool, rand).slice(0, Math.max(1, opts.count)).map((p) => p.card_id);
  return { mode: opts.mode, ids, answers: {}, idx: 0, started: opts.now, limitSec: opts.mode === "exam" ? ids.length * opts.secondsPerItem : 0, finished: false };
}

/** Q-8: append a verdict, keep the last HISTORY_CAP. Returns a new log. */
export function logAnswer(log: QuizLog, id: string, correct: boolean, now: number): QuizLog {
  const cur = log.items[id] ?? { h: [] };
  const h = cur.h.concat(correct ? "c" : "i").slice(-HISTORY_CAP);
  return { items: { ...log.items, [id]: { ...cur, h, at: now } } };
}

export function setFlag(log: QuizLog, id: string, on: boolean): QuizLog {
  const cur = log.items[id] ?? { h: [] };
  const next: LogItem = { ...cur };
  if (on) next.f = true; else delete next.f;
  return { items: { ...log.items, [id]: next } };
}

export function markDeleted(log: QuizLog, id: string, reason: string): QuizLog {
  const cur = log.items[id] ?? { h: [] };
  return { items: { ...log.items, [id]: { ...cur, d: reason } } };
}

/** Deletion reasons for one concept's problems, sent as feedback to the next generation. */
export function deletionFeedback(log: QuizLog, ids: string[]): string[] {
  return ids.map((id) => log.items[id]?.d ?? "").filter((r) => r.trim());
}

export interface UnitStat { area: string; total: number; seen: number; correct: number; attempts: number }

/** Per-unit counts: problems, problems answered at least once, and correct / total attempts. */
export function unitStats(bank: QuizProblem[], log: QuizLog): Map<string, UnitStat> {
  const m = new Map<string, UnitStat>();
  for (const p of bank) {
    const s = m.get(p.area) ?? { area: p.area, total: 0, seen: 0, correct: 0, attempts: 0 };
    const h = log.items[p.card_id]?.h ?? [];
    s.total++;
    if (h.length) s.seen++;
    s.attempts += h.length;
    s.correct += h.filter((v) => v === "c").length;
    m.set(p.area, s);
  }
  return m;
}

export interface UnitProgress { total: number; answered: number; lastCorrect: number }

/** Per unit, by each problem's last verdict (web-roadmap RM-5); unitStats above counts every attempt instead. */
export function unitProgress(bank: QuizProblem[], log: QuizLog): Map<string, UnitProgress> {
  const m = new Map<string, UnitProgress>();
  for (const p of bank) {
    const s = m.get(p.area) ?? { total: 0, answered: 0, lastCorrect: 0 };
    const v = lastVerdict(log, p.card_id);
    s.total++;
    if (v) s.answered++;
    if (v === "c") s.lastCorrect++;
    m.set(p.area, s);
  }
  return m;
}

export const TRANSLATE_CONTRACT = [
  "[Response contract] Translate the given exam item into the learner's language.",
  "Reply with exactly one JSON object holding the same keys as the input (scenario, prompt or text, and options if present),",
  "with options in the same order and the same count. Keep abbreviations, service names and code exactly as written. No other text.",
].join("\n");

export function parseTranslation(text: string, p: ProblemDef): FrontKo | null {
  const ko = coerceFrontKo(extractJsonObject(text));
  return validKo(p, ko) ? ko : null;
}
