// WHAT: pure model of the notebook part (specs/web-notebook.md §2-§3) -- record shapes, the ask reply
//       contract and its parser, term merging, and Leitner review scheduling. No DOM, no I/O.
// CONSTRAINTS: subject-agnostic (N-1). Every rule here is tested in model.test.ts.

import { stripFences } from "../../src/doc/doc";
import { extractJsonObject } from "../../src/ai/json";

export type TermType = "word" | "phrase" | "acronym";
export type ThreadType = TermType | "sentence" | "question";
const TERM_TYPES: TermType[] = ["word", "phrase", "acronym"];
const THREAD_TYPES: ThreadType[] = ["word", "phrase", "acronym", "sentence", "question"];

export interface Sense { gloss: string; domain?: string }
export interface Example { en: string; ko?: string; thread?: string }
export interface SrsState { box: number; due_at: number; reps: number; lapses: number }

export interface TermData {
  headword: string;
  type: TermType;
  pos?: string;
  ipa?: string;
  expansion?: string;
  senses: Sense[];
  examples: Example[];
  related: string[];
  threads: string[];
  lookups: number;
  known: boolean;
  srs: SrsState;
  first_seen: number;
  last_seen: number;
  via: string[];
  unit?: string;
}

export interface TermSummary {
  headword: string;
  type: TermType;
  gloss: string;
  lookups: number;
  known: boolean;
  box: number;
  due_at: number;
  last_seen: number;
}

export interface Turn { q: string; a: string; at: number; terms: string[]; error?: boolean }
export interface ThreadData { session_id: string | null; type: ThreadType; turns: Turn[] }
export interface ThreadSummary { title: string; type: ThreadType; turns: number; updated: number }

/** One term as the AI (or a seed file) describes it. Everything but the headword is optional. */
export interface TermInput {
  headword: string;
  type?: string;
  pos?: string;
  ipa?: string;
  expansion?: string;
  gloss?: string;
  senses?: Sense[];
  example?: { en?: string; ko?: string };
  related?: string[];
  unit?: string;
}

export interface ReplyMeta { type?: ThreadType; title?: string; terms: TermInput[] }
export interface ParsedReply { answer: string; meta: ReplyMeta | null }

export const MAX_EXAMPLES = 5;
export const MAX_THREAD_REFS = 20;
export const BOX_MIN = 1;
export const BOX_MAX = 5;
export const DEFAULT_INTERVALS_DAYS: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16 };
const DAY_MS = 86_400_000;

// ── ids ──────────────────────────────────────────────────────────────────────

/** Record id for a headword: lowercase ASCII slug (the state API's id rule). Null when nothing is left. */
export function slugTerm(headword: string): string | null {
  const s = headword
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return s ? s : null;
}

/** Thread id from a timestamp: t-YYYYMMDD-HHMMSS-xxx (local time, sortable). */
export function threadId(now: number, rand: () => number = Math.random): string {
  const d = new Date(now);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const tail = Math.floor(rand() * 36 ** 3).toString(36).padStart(3, "0");
  return `t-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${tail}`;
}

// ── ask reply contract (N-4) ─────────────────────────────────────────────────

/** N-19: the dictionary as the model must see it before naming terms. Empty dictionary -> no block. */
export function savedTermsBlock(headwords: string[]): string {
  return headwords.length ? `[Saved terms — already in the dictionary]\n${headwords.join(", ")}` : "";
}

/** Appended to the subject's own role text. The subject decides language and tone; this fixes the shape. */
export const ASK_CONTRACT = [
  "[Output format — follow exactly]",
  "1. First write the explanation for the learner in Markdown.",
  "2. Then end the reply with exactly one fenced block tagged json, and nothing after it:",
  "```json",
  '{"type":"word|phrase|acronym|sentence|question","title":"<short title for this question>",',
  ' "terms":[{"headword":"...","type":"word|phrase|acronym","pos":"...","ipa":"...","expansion":"...",',
  '           "senses":[{"gloss":"...","domain":"general|subject"}],"example":{"en":"...","ko":"..."}}]}',
  "```",
  "- terms: every content word or fixed phrase worth studying from the learner's input. For a sentence, list each content word separately. Skip articles, pronouns, auxiliaries and other function words.",
  "- Never list a term that is already in [Saved terms], nor another form of it (plural, tense, -ing) or a phrase that only wraps a saved word in the same sense. The one exception is the word or phrase the learner asked about directly.",
  "- expansion: only for abbreviations; omit otherwise.",
  "- gloss: short meaning in the learner's language. domain 'subject' marks the meaning specific to the subject being studied.",
  "- For a follow-up turn, list only terms that are new in that turn (an empty list is fine).",
].join("\n");

function asThreadType(v: unknown): ThreadType | undefined {
  return typeof v === "string" && (THREAD_TYPES as string[]).includes(v) ? (v as ThreadType) : undefined;
}
function asTermType(v: unknown): TermType {
  return typeof v === "string" && (TERM_TYPES as string[]).includes(v) ? (v as TermType) : "word";
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function coerceTermInput(raw: unknown): TermInput | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const headword = str(o["headword"]);
  if (!headword) return null;
  const senses = Array.isArray(o["senses"])
    ? (o["senses"] as unknown[])
        .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>) : {}))
        .map((s) => ({ gloss: str(s["gloss"]) ?? "", ...(str(s["domain"]) ? { domain: str(s["domain"]) } : {}) }))
        .filter((s) => s.gloss)
    : undefined;
  const ex = o["example"] && typeof o["example"] === "object" ? (o["example"] as Record<string, unknown>) : null;
  return {
    headword,
    type: asTermType(o["type"]),
    ...(str(o["pos"]) ? { pos: str(o["pos"]) } : {}),
    ...(str(o["ipa"]) ? { ipa: str(o["ipa"]) } : {}),
    ...(str(o["expansion"]) ? { expansion: str(o["expansion"]) } : {}),
    ...(str(o["gloss"]) ? { gloss: str(o["gloss"]) } : {}),
    ...(senses && senses.length ? { senses } : {}),
    ...(ex && str(ex["en"]) ? { example: { en: str(ex["en"]), ...(str(ex["ko"]) ? { ko: str(ex["ko"]) } : {}) } } : {}),
    ...(Array.isArray(o["related"]) ? { related: (o["related"] as unknown[]).map(String).filter(Boolean) } : {}),
    ...(str(o["unit"]) ? { unit: str(o["unit"]) } : {}),
  };
}

/** Split a reply into the learner-facing Markdown and the trailing json block (N-4). */
export function parseReply(text: string): ParsedReply {
  const src = text ?? "";
  const re = /```json\s*([\s\S]*?)```/gi;
  let last: RegExpExecArray | null = null;
  for (let m = re.exec(src); m; m = re.exec(src)) last = m;
  if (!last) return { answer: src.trim(), meta: null };
  const answer = (src.slice(0, last.index) + src.slice(last.index + last[0].length)).trim();
  try {
    const raw = JSON.parse(stripFences(last[1])) as Record<string, unknown>;
    if (!raw || typeof raw !== "object") return { answer, meta: null };
    const terms = Array.isArray(raw["terms"])
      ? (raw["terms"] as unknown[]).map(coerceTermInput).filter((t): t is TermInput => t !== null)
      : [];
    return { answer, meta: { type: asThreadType(raw["type"]), title: str(raw["title"]), terms } };
  } catch {
    return { answer, meta: null };
  }
}

// ── terms (N-5, N-6, N-9) ────────────────────────────────────────────────────

export function isStopword(headword: string, stopwords: ReadonlySet<string>): boolean {
  return stopwords.has(headword.normalize("NFKC").trim().toLowerCase());
}

function sensesOf(inp: TermInput): Sense[] {
  if (inp.senses && inp.senses.length) return inp.senses;
  return inp.gloss ? [{ gloss: inp.gloss }] : [];
}

/** countLookup (default true): false for captures that are practice, not a lookup (they must not raise review priority). */
export interface MergeCtx { now: number; via: string; thread?: string; countLookup?: boolean }

/** Create or update a term. A repeat lookup increments `lookups` and merges; it never drops what was there. */
export function mergeTerm(existing: TermData | null, inp: TermInput, ctx: MergeCtx): TermData {
  const counts = ctx.via !== "seed" && ctx.countLookup !== false;
  const example = inp.example?.en ? [{ en: inp.example.en, ...(inp.example.ko ? { ko: inp.example.ko } : {}), ...(ctx.thread ? { thread: ctx.thread } : {}) }] : [];
  if (!existing) {
    return {
      headword: inp.headword,
      type: asTermType(inp.type),
      ...(inp.pos ? { pos: inp.pos } : {}),
      ...(inp.ipa ? { ipa: inp.ipa } : {}),
      ...(inp.expansion ? { expansion: inp.expansion } : {}),
      senses: sensesOf(inp),
      examples: example,
      related: inp.related ?? [],
      threads: ctx.thread ? [ctx.thread] : [],
      lookups: counts ? 1 : 0,
      known: false,
      srs: { box: BOX_MIN, due_at: ctx.now, reps: 0, lapses: 0 },
      first_seen: ctx.now,
      last_seen: ctx.now,
      via: [ctx.via],
      ...(inp.unit ? { unit: inp.unit } : {}),
    };
  }
  const glosses = new Set(existing.senses.map((s) => s.gloss));
  const senses = existing.senses.concat(sensesOf(inp).filter((s) => !glosses.has(s.gloss)));
  const exSeen = new Set(existing.examples.map((e) => e.en));
  const examples = example.filter((e) => !exSeen.has(e.en)).concat(existing.examples).slice(0, MAX_EXAMPLES);
  const threads = ctx.thread && !existing.threads.includes(ctx.thread)
    ? [ctx.thread].concat(existing.threads).slice(0, MAX_THREAD_REFS)
    : existing.threads;
  const related = Array.from(new Set(existing.related.concat(inp.related ?? [])));
  return {
    ...existing,
    pos: existing.pos ?? inp.pos,
    ipa: existing.ipa ?? inp.ipa,
    expansion: existing.expansion ?? inp.expansion,
    senses,
    examples,
    related,
    threads,
    lookups: existing.lookups + (counts ? 1 : 0),
    last_seen: ctx.now,
    via: existing.via.includes(ctx.via) ? existing.via : existing.via.concat(ctx.via),
    unit: existing.unit ?? inp.unit,
  };
}

export function termSummary(d: TermData): TermSummary {
  return {
    headword: d.headword,
    type: d.type,
    gloss: d.senses.map((s) => s.gloss).slice(0, 2).join(", "),
    lookups: d.lookups,
    known: d.known,
    box: d.srs.box,
    due_at: d.srs.due_at,
    last_seen: d.last_seen,
  };
}

// ── review (N-8) ─────────────────────────────────────────────────────────────

export function review(srs: SrsState, correct: boolean, now: number, intervals: Record<number, number> = DEFAULT_INTERVALS_DAYS): SrsState {
  if (!correct) return { box: BOX_MIN, due_at: now, reps: srs.reps + 1, lapses: srs.lapses + 1 };
  const box = Math.min(srs.box + 1, BOX_MAX);
  const days = intervals[box] ?? DEFAULT_INTERVALS_DAYS[box] ?? 1;
  return { box, due_at: now + days * DAY_MS, reps: srs.reps + 1, lapses: srs.lapses };
}

// ── typed-meaning grading (N-20) ─────────────────────────────────────────────

/** Appended to the subject's review role text on the first answer of a session. Fixes the shape only. */
export const REVIEW_CONTRACT = [
  "[Response contract] Each message is a term, its reference meanings and the learner's answer.",
  'Reply with one JSON object only: {"verdict":"correct"|"incorrect","feedback":"<one short sentence in the learner\'s language, or empty>"}',
  "- Judge the meaning, not the wording. The card shows the full meanings afterwards, so feedback names only the key miss or confusion.",
].join("\n");

export interface ReviewGrade { verdict: "correct" | "incorrect"; feedback: string }

/** The per-answer message, kept to three short lines: the grader only grades (N-20). */
export function reviewPrompt(d: Pick<TermData, "headword" | "expansion" | "senses">, answer: string): string {
  return [`Term: ${d.headword}${d.expansion ? ` (${d.expansion})` : ""}`, `Meanings: ${d.senses.map((s) => s.gloss).join("; ")}`, `Answer: ${answer}`].join("\n");
}

/** Anything without a known verdict is null -> ungraded, never a fail (N-8). */
export function parseReviewGrade(text: string): ReviewGrade | null {
  const o = extractJsonObject(text);
  const v = o?.["verdict"];
  if (v !== "correct" && v !== "incorrect") return null;
  const f = o?.["feedback"];
  return { verdict: v, feedback: typeof f === "string" ? f.trim() : "" };
}

export function isDue(s: Pick<TermSummary, "known" | "due_at">, now: number): boolean {
  return !s.known && s.due_at <= now;
}

/** Review order: most looked-up first (the learner keeps needing them), then the longest overdue. */
export function reviewOrder<T>(items: T[], of: (t: T) => Pick<TermSummary, "lookups" | "due_at">): T[] {
  return items.slice().sort((a, b) => of(b).lookups - of(a).lookups || of(a).due_at - of(b).due_at);
}

// ── threads (N-3) ────────────────────────────────────────────────────────────

export function transcript(turns: Turn[], learner = "Learner", tutor = "Tutor"): string {
  return turns
    .filter((t) => !t.error && t.a)
    .map((t) => `${learner}: ${t.q}\n\n${tutor}: ${t.a}`)
    .join("\n\n");
}

export function threadSummary(title: string, d: ThreadData, updated: number): ThreadSummary {
  return { title, type: d.type, turns: d.turns.length, updated };
}

/** A title when the AI gave none: the first line of the question, shortened. */
export function fallbackTitle(q: string): string {
  const line = q.trim().split(/\r?\n/)[0] ?? "";
  return line.length > 60 ? line.slice(0, 57) + "…" : line;
}

/** Curriculum lines (unit label: concept titles) for grounding a question in what has been studied. */
export function curriculumText(outline: { areas?: { key: string; label: string }[]; conceptOutline?: Record<string, { title: string }[]> } | null): string {
  if (!outline?.areas?.length) return "";
  return outline.areas
    .map((a) => `- ${a.label}: ${(outline.conceptOutline?.[a.key] ?? []).map((c) => c.title).join(", ")}`)
    .join("\n");
}
