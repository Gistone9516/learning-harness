// WHAT: area->concept->problem study UI. Floating index + numbered-step concept reading + graded problems.
// DEPS: web/src/ai/client (AiSession, AiClient, AiResponse), web/src/grade/grade (score, AnswerSpec).
// INPUT: injected areas [{key,label,icon?,aliases?}] + concept outline [{concept_id,title}] per area
//        + optional pre-baked concepts {concept_id: GeneratedConcept} + optional courseTitle.
// EVENTS: concept-read flag and per-problem verdicts {module:"conceptprob",item_id,read?|verdict?,ts}.
// AI: optional -- pre-baked concepts render+grade with zero AI (offline). Grading is always token 0.
// CONSTRAINTS: subject-agnostic, secrets-gated, token0-grading, binary.
// DEMO: mountConceptprob(el, {session:null, areas, conceptOutline, concepts, courseTitle}) renders fully offline.

import { AiSession, type AiClient, type AiEffort, type AiResponse } from "../../src/ai/client";
import { score, type AnswerSpec, type ScoreInput } from "../../src/grade/grade";
import { optionOrder } from "../../src/grade/order";
import { highlightCode } from "./highlight";
import {
  areaLang, blueLabel, el, escapeHtml, inlineMd, parseBody, parseDetails, parseFlatBlocks,
  renderAiBody, renderBlock, renderFigure, sanitizeSvg, stripFences,
  DOC_DIALECT, DOC_FIGURE_CLAUSE,
  type Block, type CalloutVariant, type Figure, type Point, type Step, type Term,
} from "../../src/doc/doc";
export { areaLang, parseBody, type Figure } from "../../src/doc/doc";

// ── Types ────────────────────────────────────────────────────────────────────
export type GradeMode = "exact" | "keyword" | "cloze";

export interface ProblemDef {
  card_id: string;
  type: "func" | "proc" | "cloze" | "judge";
  grade_mode: GradeMode;
  front: Record<string, unknown>;
  answer_spec: AnswerSpec;
  links?: { concept_ref?: string };
  source?: string;   // "기출" for imported past-exam problems (shown on the 기출 page)
  round?: string;    // e.g. "2025년 3회"
  needs_exec?: boolean;
  exec?: string;     // verification status for code/SQL 기출 (confirmed/exec_corrected/unverified/…)
  explain?: string;  // Markdown explanation shown under the answer (why it is right, why the others are not)
}
// "반드시 외워야 할 것" — a must-memorize card shown at the TOP of a concept (added, not
// replacing the body). Inspired by the user's cheat-sheet study materials: a mnemonic,
// a compact key-fact list, and common traps. Optional per concept.
export interface MemorizeItem { term: string; def: string; tag?: string }  // tag: "기출" | "필수"
export interface Memorize {
  mnemonic?: { code: string; expand: string };
  items: MemorizeItem[];
  traps?: string[];
}
// A visual figure shown under the concept explanation. `svg` is inline SVG markup (self-contained,
// generated + visually verified in the build pipeline). One figure = one whole sub-concept.
export interface GeneratedConcept {
  area: string;
  concept_id: string;
  title: string;
  body: string;
  problems: ProblemDef[];
  memorize?: Memorize;
  figures?: Figure[];
}
export interface AreaDef {
  key: string;
  label: string;
  icon?: string;
  aliases?: string[];
}
export interface ConceptSeed {
  concept_id: string;
  title: string;
  priority?: string;   // legacy: "high" => exam-likely
  tier?: number;       // importance rank 1|2|3|4 (1 = 반드시 아는 핵심); shown as a colored badge
  written?: boolean;   // 필기 전용(실기 미출제) => "필기" 배지로 표시(숫자 tier 대신)
}
export interface IndexNode {
  area: AreaDef;
  concepts: ConceptSeed[];
}
// Importance badge metadata for a seed. Handles tier 1-4 and the "필기"(written-exam-only) label.
// sfx drives the CSS class suffix (--1..--4, --w); badge is the short chip text; chip is the header text.
function tierMeta(seed: ConceptSeed): { sfx: string; badge: string; chip: string; title: string } | null {
  if (seed.written) return { sfx: "w", badge: "필기", chip: "필기 전용", title: "필기 전용 · 실기 미출제" };
  const t = seed.tier;
  if (!t) return null;
  const chip =
    t === 1 ? "1순위 · 반드시 아는 핵심" : t === 2 ? "2순위 · 중요" : t === 3 ? "3순위 · 보조" : "4순위 · 참고";
  return { sfx: String(t), badge: String(t), chip, title: t === 1 ? "1순위 · 반드시 아는 핵심" : chip };
}
export interface GradeResult {
  verdict: "correct" | "incorrect";
  matched: string[];
  missed: string[];
  concept_ref?: string;
}
export interface ProgressRecord {
  module: string;
  item_id: string;
  verdict?: "correct" | "incorrect";
  read?: boolean;
  ts: number;
}

// A concept body parsed into numbered steps. Each step holds ORDERED content blocks so paragraphs,
// tables and lists keep their place — and a caption line ("…:") is absorbed into the block it introduces.

// ── Pure helpers (no DOM, no live AI) ────────────────────────────────────────

/** Coerce a raw object into a Memorize (or undefined). Tolerant of missing fields. */
export function coerceMemorize(raw: unknown): Memorize | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const itemsRaw = Array.isArray(o["items"]) ? (o["items"] as unknown[]) : [];
  const items: MemorizeItem[] = itemsRaw
    .map((it) => {
      const r = (it ?? {}) as Record<string, unknown>;
      return { term: String(r["term"] ?? ""), def: String(r["def"] ?? ""), tag: r["tag"] ? String(r["tag"]) : undefined };
    })
    .filter((it) => it.term || it.def);
  const mn = o["mnemonic"] as Record<string, unknown> | undefined;
  const mnemonic = mn && (mn["code"] || mn["expand"]) ? { code: String(mn["code"] ?? ""), expand: String(mn["expand"] ?? "") } : undefined;
  const traps = Array.isArray(o["traps"]) ? (o["traps"] as unknown[]).map((t) => String(t)).filter(Boolean) : undefined;
  if (!items.length && !mnemonic && !(traps && traps.length)) return undefined;
  return { ...(mnemonic ? { mnemonic } : {}), items, ...(traps && traps.length ? { traps } : {}) };
}

/** Coerce raw figures into Figure[] (or undefined). Keeps only entries with real inline SVG. */
export function coerceFigures(raw: unknown): Figure[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const figs = raw
    .map((f) => {
      const o = (f ?? {}) as Record<string, unknown>;
      const svg = typeof o["svg"] === "string" ? (o["svg"] as string) : "";
      const caption = typeof o["caption"] === "string" ? (o["caption"] as string) : undefined;
      const anchor = typeof o["anchor"] === "string" ? (o["anchor"] as string) : undefined;
      return { svg: svg.trim(), ...(caption ? { caption } : {}), ...(anchor ? { anchor } : {}) };
    })
    .filter((f) => f.svg.includes("<svg"));
  return figs.length ? figs : undefined;
}

export function parseConcept(text: string): GeneratedConcept | null {
  try {
    const raw = JSON.parse(stripFences(text)) as unknown;
    if (typeof raw !== "object" || raw === null) return null;
    const o = raw as Record<string, unknown>;
    if (typeof o["area"] !== "string" || typeof o["concept_id"] !== "string" ||
        typeof o["title"] !== "string" || typeof o["body"] !== "string" || !Array.isArray(o["problems"])) return null;
    const problems: ProblemDef[] = (o["problems"] as unknown[]).map((p) => {
      const pd = p as Record<string, unknown>;
      return {
        card_id: String(pd["card_id"] ?? ""),
        type: (pd["type"] ?? "func") as ProblemDef["type"],
        grade_mode: (pd["grade_mode"] ?? "exact") as GradeMode,
        front: (pd["front"] ?? {}) as Record<string, unknown>,
        answer_spec: (pd["answer_spec"] ?? { normalize: [] }) as AnswerSpec,
        links: pd["links"] as ProblemDef["links"] | undefined,
        ...(typeof pd["explain"] === "string" && pd["explain"] ? { explain: pd["explain"] as string } : {}),
      };
    });
    const memorize = coerceMemorize(o["memorize"]);
    const figures = coerceFigures(o["figures"]);
    return { area: o["area"] as string, concept_id: o["concept_id"] as string, title: o["title"] as string, body: o["body"] as string, problems, ...(memorize ? { memorize } : {}), ...(figures ? { figures } : {}) };
  } catch {
    return null;
  }
}

/**
 * Collapse spelled-out abbreviations back to the bare abbreviation, for instances whose question text must
 * never expand one. "Elastic Block Store (EBS)" and "Elastic Block Store" both become "EBS"; a leading
 * "Amazon " / "AWS " is optional. Longer expansions are tried first so a shorter one never splits them.
 */
export function makeAbbrCollapser(pairs: { abbr: string; expansion: string }[]): (s: string) => string {
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rules = pairs
    .filter((p) => p.abbr && p.expansion)
    .flatMap((p) => {
      const bare = p.expansion.replace(/^(amazon|aws)\s+/i, "");
      return Array.from(new Set([p.expansion, bare])).map((v) => ({ v, abbr: p.abbr }));
    })
    .sort((a, b) => b.v.length - a.v.length)
    .map(({ v, abbr }) => ({ re: new RegExp(`(?:(?:amazon|aws)\\s+)?${esc(v)}(?:\\s*\\(${esc(abbr)}\\))?`, "gi"), abbr }));
  return (s: string) => rules.reduce((acc, r) => acc.replace(r.re, r.abbr), s);
}

/** Apply a front rewrite to a problem. Judge options and their accepted answer move together so grading holds. */
export function rewriteProblem(p: ProblemDef, f: (s: string) => string): ProblemDef {
  const front: Record<string, unknown> = { ...p.front };
  for (const k of ["scenario", "prompt", "text"]) if (typeof front[k] === "string") front[k] = f(front[k] as string);
  const isJudge = p.type === "judge" && Array.isArray(front["options"]);
  if (isJudge) front["options"] = (front["options"] as unknown[]).map((o) => (typeof o === "string" ? f(o) : o));
  const answer_spec = isJudge && p.answer_spec.accepted ? { ...p.answer_spec, accepted: p.answer_spec.accepted.map(f) } : p.answer_spec;
  return { ...p, front, answer_spec };
}

export function buildIndex(areas: AreaDef[], conceptOutline: Record<string, ConceptSeed[]>): IndexNode[] {
  return areas.map((area) => ({ area, concepts: conceptOutline[area.key] ?? [] }));
}

export function gradeProblem(problem: ProblemDef, userAnswer: string | string[]): GradeResult {
  const mode = problem.grade_mode;
  const inp: ScoreInput =
    mode === "cloze"
      ? { mode: "cloze", user_answer: userAnswer as string[], answer_spec: problem.answer_spec }
      : { mode: mode === "keyword" ? "keyword" : "exact", user_answer: userAnswer as string, answer_spec: problem.answer_spec };
  const r = score(inp);
  return { verdict: r.verdict, matched: r.matched, missed: r.missed, concept_ref: problem.links?.concept_ref };
}


// ── AI (optional) ────────────────────────────────────────────────────────────
export interface ConceptAuthor { system: string; model?: string; effort?: AiEffort }
/**
 * The shape half of a live-generation prompt. The instance's `author.system` says who writes and in
 * what voice; this fixes what comes back, so parseConcept and the reading renderer (DOC_DIALECT) are
 * the only definitions of the format and an instance cannot drift from them.
 */
export const CONCEPT_CONTRACT = [
  "[Response contract] Reply with exactly one JSON object and nothing else (no prose, no code fence):",
  '{"area":"<given>","concept_id":"<given>","title":"<given>","body":"<markdown>",',
  ' "memorize":{"items":[{"term":"...","def":"...","tag":"..."}],"traps":["..."]},',
  ' "problems":[ ... 4 to 6 items ... ]}',
  "- body: the reading, written in the markdown dialect above. Each '## heading' becomes one numbered step.",
  "- memorize: the few facts that must be memorised (optional).",
  "- problem shapes (every item also carries explain: markdown on why the answer is right and the others are not):",
  '  judge: {"card_id":"...","type":"judge","grade_mode":"exact","front":{"scenario":"...","options":["4 options"]},"answer_spec":{"normalize":["nfkc","trim","collapse_space","lower"],"accepted":["<exact text of the correct option>"]},"explain":"..."}',
  '  cloze: {"card_id":"...","type":"cloze","grade_mode":"cloze","front":{"text":"... {{0}} ..."},"answer_spec":{"normalize":["nfkc","trim","collapse_space","lower"],"blanks":[["accepted","variants"]]},"explain":"..."}',
  '  short answer: {"card_id":"...","type":"func","grade_mode":"exact","front":{"prompt":"..."},"answer_spec":{"normalize":["nfkc","trim","collapse_space","lower"],"accepted":["variants"]},"explain":"..."}',
  "- card_id: lowercase letters, digits and hyphens, starting with the concept_id.",
].join("\n");

export async function generateConcept(session: AiSession, params: { area: string; concept_id: string; title: string; scope?: string }, author?: ConceptAuthor): Promise<{ concept: GeneratedConcept | null; response: AiResponse }> {
  const res = author
    ? await session.send({ prompt: JSON.stringify(params), system: `${author.system}\n\n${DOC_DIALECT}\n\n${CONCEPT_CONTRACT}`, model: author.model, effort: author.effort ?? "medium" })
    : await session.send({ prompt: JSON.stringify(params), effort: "medium" });
  if (!res.ok) return { concept: null, response: res };
  return { concept: parseConcept(res.text), response: res };
}

// ── Progress store (localStorage) ────────────────────────────────────────────
function progKey(subjectKey: string, itemId: string): string { return `lh:${subjectKey}:conceptprob:${itemId}`; }
// Last view (concept vs problems) + concept, so a refresh restores where the learner was.
type ViewName = "concept" | "problems" | "kichul";
type ViewState = { view: ViewName; conceptId?: string };
function viewStateKey(subjectKey: string): string { return `lh:${subjectKey}:conceptprob:viewstate`; }
function readViewState(subjectKey: string): ViewState | null {
  try {
    const r = localStorage.getItem(viewStateKey(subjectKey));
    if (!r) return null;
    const o = JSON.parse(r) as ViewState;
    if (o && (o.view === "concept" || o.view === "problems" || o.view === "kichul")) return o;
  } catch { /* ignore */ }
  return null;
}
function saveViewState(subjectKey: string, s: ViewState): void {
  try { localStorage.setItem(viewStateKey(subjectKey), JSON.stringify(s)); } catch { /* test env */ }
}
// Per-concept AI chat history, persisted so a refresh keeps the conversation (초기화 clears it).
interface StoredMsg { role: "user" | "assistant"; text: string; error?: boolean }
function chatKey(subjectKey: string, id: string): string { return `lh:${subjectKey}:conceptprob:chat:${id}`; }
function loadChatMsgs(subjectKey: string, id: string): StoredMsg[] {
  try { const r = localStorage.getItem(chatKey(subjectKey, id)); const a = r ? JSON.parse(r) : []; return Array.isArray(a) ? a : []; } catch { return []; }
}
function saveChatMsgs(subjectKey: string, id: string, msgs: StoredMsg[]): void {
  try { localStorage.setItem(chatKey(subjectKey, id), JSON.stringify(msgs)); } catch { /* test env */ }
}
function clearChatMsgs(subjectKey: string, id: string): void {
  try { localStorage.removeItem(chatKey(subjectKey, id)); } catch { /* test env */ }
}
function saveProgress(subjectKey: string, rec: ProgressRecord): void {
  try { localStorage.setItem(progKey(subjectKey, rec.item_id), JSON.stringify(rec)); } catch { /* test env */ }
}
function readDone(subjectKey: string, conceptId: string): boolean {
  try { const v = localStorage.getItem(progKey(subjectKey, "done:" + conceptId)); return v ? JSON.parse(v).read === true : false; } catch { return false; }
}
function writeDone(subjectKey: string, conceptId: string, done: boolean): void {
  try { localStorage.setItem(progKey(subjectKey, "done:" + conceptId), JSON.stringify({ module: "conceptprob", item_id: "done:" + conceptId, read: done, ts: Date.now() })); } catch { /* */ }
}
function readMemo(subjectKey: string, conceptId: string): string {
  try { return localStorage.getItem(progKey(subjectKey, "memo:" + conceptId)) ?? ""; } catch { return ""; }
}
function writeMemo(subjectKey: string, conceptId: string, text: string): void {
  try { localStorage.setItem(progKey(subjectKey, "memo:" + conceptId), text); } catch { /* */ }
}

// ── Generated problems · attempt history · deletions · feedback (localStorage) ──
function readJson<T>(subjectKey: string, itemId: string, fallback: T): T {
  try { const v = localStorage.getItem(progKey(subjectKey, itemId)); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function writeJson(subjectKey: string, itemId: string, val: unknown): void {
  try { localStorage.setItem(progKey(subjectKey, itemId), JSON.stringify(val)); } catch { /* test env */ }
}
export function readGenerated(subjectKey: string, conceptId: string): ProblemDef[] {
  return readJson<ProblemDef[]>(subjectKey, "gen:" + conceptId, []);
}
function addGenerated(subjectKey: string, conceptId: string, probs: ProblemDef[]): void {
  writeJson(subjectKey, "gen:" + conceptId, readGenerated(subjectKey, conceptId).concat(probs));
}
function readDeleted(subjectKey: string): Set<string> {
  return new Set(readJson<string[]>(subjectKey, "deleted", []));
}
function markDeleted(subjectKey: string, cardId: string): void {
  const s = readDeleted(subjectKey); s.add(cardId); writeJson(subjectKey, "deleted", Array.from(s));
}
function readFeedback(subjectKey: string, conceptId: string): string[] {
  return readJson<string[]>(subjectKey, "fb:" + conceptId, []);
}
function addFeedback(subjectKey: string, conceptId: string, reason: string): void {
  const r = reason.trim(); if (!r) return;
  const cur = readFeedback(subjectKey, conceptId); cur.push(r); writeJson(subjectKey, "fb:" + conceptId, cur);
}
type Verd = "correct" | "incorrect";
function readHistory(subjectKey: string, cardId: string): Verd[] {
  return readJson<Verd[]>(subjectKey, "hist:" + cardId, []);
}
function pushHistory(subjectKey: string, cardId: string, v: Verd): Verd[] {
  const capped = readHistory(subjectKey, cardId).concat(v).slice(-5); // keep the most recent 5 attempts
  writeJson(subjectKey, "hist:" + cardId, capped); return capped;
}
/** Coerce a server-returned raw problem object into a ProblemDef (or null if unusable). */
export function coerceProblem(raw: unknown): ProblemDef | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const card_id = String(p["card_id"] ?? "");
  if (!card_id) return null;
  return {
    card_id,
    type: (p["type"] ?? "func") as ProblemDef["type"],
    grade_mode: (p["grade_mode"] ?? "exact") as GradeMode,
    front: (p["front"] ?? {}) as Record<string, unknown>,
    answer_spec: (p["answer_spec"] ?? { normalize: [] }) as AnswerSpec,
    links: p["links"] as ProblemDef["links"] | undefined,
    ...(typeof p["explain"] === "string" && p["explain"] ? { explain: p["explain"] as string } : {}),
  };
}
/** The question text of a problem (prompt / text / scenario), for dedup context + labels. */
function problemPromptText(p: ProblemDef): string {
  const f = p.front;
  return (typeof f["prompt"] === "string" ? f["prompt"] : typeof f["text"] === "string" ? f["text"] : typeof f["scenario"] === "string" ? f["scenario"] : "") as string;
}
function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}


/** The "반드시 외워야 할 것" card: mnemonic + compact key-facts + traps. Shown atop a concept. */
function renderMemorize(m: Memorize, title: string): HTMLElement {
  const card = el("div", "lh-cp-must");
  const head = el("div", "lh-cp-must-head");
  head.appendChild(el("span", "lh-cp-must-ico", "★"));
  head.appendChild(el("span", "lh-cp-must-title", title));
  card.appendChild(head);
  if (m.mnemonic && (m.mnemonic.code || m.mnemonic.expand)) {
    const mn = el("div", "lh-cp-must-mn");
    mn.appendChild(el("span", "lh-cp-must-mnlabel", "암기법"));
    if (m.mnemonic.code) mn.appendChild(el("span", "lh-cp-must-mncode", m.mnemonic.code));
    if (m.mnemonic.expand) { const ex = el("span", "lh-cp-must-mnex"); ex.innerHTML = inlineMd(escapeHtml(m.mnemonic.expand)); mn.appendChild(ex); }
    card.appendChild(mn);
  }
  if (m.items && m.items.length) {
    const ul = el("ul", "lh-cp-must-items");
    for (const it of m.items) {
      const li = el("li", "lh-cp-must-item");
      const term = el("span", "lh-cp-must-term"); term.innerHTML = inlineMd(escapeHtml(it.term));
      li.appendChild(term);
      if (it.tag) li.appendChild(el("span", "lh-cp-must-tag" + (it.tag.includes("기출") ? " lh-cp-must-tag--hot" : ""), it.tag));
      const def = el("span", "lh-cp-must-def"); def.innerHTML = inlineMd(escapeHtml(it.def));
      li.appendChild(def);
      ul.appendChild(li);
    }
    card.appendChild(ul);
  }
  if (m.traps && m.traps.length) {
    const tr = el("div", "lh-cp-must-traps");
    tr.appendChild(el("span", "lh-cp-must-traplabel", "함정"));
    const ul = el("ul", "lh-cp-must-traplist");
    for (const t of m.traps) { const li = el("li"); li.innerHTML = inlineMd(escapeHtml(t)); ul.appendChild(li); }
    tr.appendChild(ul);
    card.appendChild(tr);
  }
  return card;
}

/** One figure: framed inline SVG + optional caption. */
// Strip active content from untrusted (AI-supplied) SVG: <script>/<foreignObject>, on* handlers,
// and javascript: hrefs. Returns "" if the markup does not parse to a clean <svg>.

const PROB_TAG: Record<string, string> = { judge: "객관식", cloze: "빈칸", proc: "서술형", func: "단답" };
function probTag(p: ProblemDef): string {
  if (p.type === "func" && typeof p.front["code"] === "string" && (p.front["code"] as string).trim()) return "코드";
  return PROB_TAG[p.type] ?? "문제";
}
function answerText(p: ProblemDef): string {
  const sp = p.answer_spec;
  if (p.grade_mode === "cloze" && sp.blanks) return sp.blanks.map((b) => b[0]).join(", ");
  if (p.grade_mode === "keyword" && sp.required_keywords) return sp.required_keywords.map((g) => g[0]).join(", ");
  return (sp.accepted ?? [])[0] ?? "";
}

// ── Mount ────────────────────────────────────────────────────────────────────
export interface ConceptprobProps {
  session: AiSession | AiClient | null;
  areas: AreaDef[];
  conceptOutline: Record<string, ConceptSeed[]>;
  concepts?: Record<string, GeneratedConcept>;
  subjectKey?: string;
  courseTitle?: string;
  aiClient?: AiClient | null;   // raw AI client for the side-panel chat (null => offline, chat disabled)
  onProgress?: (record: ProgressRecord) => void;
  // Optional instance hooks (specs/web-notebook.md N-12, N-13). Absent = the behaviour before they existed.
  labels?: Partial<ConceptprobLabels>;
  author?: ConceptAuthor;                 // system prompt for live concept generation (fresh session per concept)
  conceptStore?: ConceptStore;            // persists live-generated concepts so a reload does not regenerate
  problemStyle?: string;                  // forwarded to /problems as `style` (replaces the server default)
  askElsewhere?: { label: string; onAsk: (text: string) => void };   // second button on a text selection
  rewriteFront?: (s: string) => string;   // applied to every problem front before render (e.g. makeAbbrCollapser)
}

/** State collection holding live-generated concepts (N-12). One definition: the shell and quiz import it. */
export const CONCEPT_COLLECTION = "concepts";

/** Where live-generated concepts are kept between visits. */
export interface ConceptStore {
  load(conceptId: string): Promise<GeneratedConcept | null>;
  save(concept: GeneratedConcept): Promise<void>;
}

export const DEFAULT_CONCEPTPROB_LABELS = {
  pageTitle: "필기 핵심 이론",
  pastTab: "기출",               // "" hides the past-exam tab
  memorizeTitle: "반드시 외워야 할 것",
  regenerate: "개념 다시 생성",
  explain: "해설",
  aiSetupHint: "AI 서버가 연결되지 않았습니다. ai_server를 실행하고 이 폴더에 ai.local.json(baseUrl·token)을 두면 활성화됩니다.",
  authHint: "인증 실패입니다. ai.local.json의 token이 ai_server의 AI_SERVER_TOKEN과 일치하는지 확인하세요.",
};
export type ConceptprobLabels = typeof DEFAULT_CONCEPTPROB_LABELS;

export function mountConceptprob(container: HTMLElement, props: ConceptprobProps): void {
  const { areas, conceptOutline, concepts: prebaked = {}, subjectKey = "demo", courseTitle = "학습 과정", onProgress } = props;
  const session: AiSession | null = props.session == null ? null : props.session instanceof AiSession ? props.session : new AiSession(props.session as AiClient);
  const aiClient: AiClient | null = props.aiClient ?? null;
  const CL: ConceptprobLabels = { ...DEFAULT_CONCEPTPROB_LABELS, ...(props.labels ?? {}) };
  const { author, conceptStore, problemStyle } = props;
  let currentConcept: GeneratedConcept | null = null;

  container.innerHTML = "";
  container.className = "lh-cp";

  const index = buildIndex(areas, conceptOutline);
  const allSeeds = index.flatMap((n) => n.concepts);
  const total = allSeeds.length;
  const cache = new Map<string, GeneratedConcept>();

  // The full concept record for a seed (loaded cache first, then the injected pre-baked map).
  const conceptRecord = (conceptId: string): GeneratedConcept | undefined => cache.get(conceptId) ?? prebaked[conceptId];
  // Current problem set for a concept: baked + generated, minus deleted.
  function conceptProblems(conceptId: string): ProblemDef[] {
    const baked = conceptRecord(conceptId)?.problems ?? [];
    const deleted = readDeleted(subjectKey);
    const all = baked.concat(readGenerated(subjectKey, conceptId)).filter((p) => !deleted.has(p.card_id));
    const rw = props.rewriteFront;
    return rw ? all.map((p) => rewriteProblem(p, rw)) : all;
  }
  // Generate `count` new problems for a concept via the server (which execution-verifies them).
  async function generateProblems(conceptId: string, count: number): Promise<{ ok: boolean; added: number; dropped: number; error?: string }> {
    if (!aiClient) return { ok: false, added: 0, dropped: 0, error: "AI 미연결" };
    const rec = conceptRecord(conceptId);
    const seed = allSeeds.find((s) => s.concept_id === conceptId);
    const title = rec?.title ?? seed?.title ?? conceptId;
    const existing = conceptProblems(conceptId).map(problemPromptText).filter(Boolean);
    const feedback = readFeedback(subjectKey, conceptId);
    const res = await aiClient.problems({
      concept: { area: rec?.area, concept_id: conceptId, title, body: rec?.body ?? "" },
      existing, feedback, count, course_title: courseTitle, ...(problemStyle ? { style: problemStyle } : {}),
    });
    if (!res.ok) return { ok: false, added: 0, dropped: res.dropped ?? 0, error: res.error ?? "생성 실패" };
    const coerced = res.problems.map(coerceProblem).filter((p): p is ProblemDef => p !== null);
    if (coerced.length) addGenerated(subjectKey, conceptId, coerced);
    return { ok: true, added: coerced.length, dropped: res.dropped ?? 0 };
  }

  // ── Reopen button (shown when the panel is hidden) ──
  const reopen = el("button", "lh-cp-reopen");
  reopen.innerHTML = '<span class="lh-cp-reopen-ico">☰</span> 목차';
  reopen.style.display = "none";
  container.appendChild(reopen);

  // ── Sidebar ──
  const aside = el("aside", "lh-cp-aside");
  const head = el("div", "lh-cp-ph");
  const headTop = el("div", "lh-cp-ph-top");
  const headTitleWrap = el("div");
  headTitleWrap.appendChild(el("div", "lh-cp-ph-kicker", "LEARNING PATH"));
  headTitleWrap.appendChild(el("div", "lh-cp-ph-title", courseTitle));
  headTop.appendChild(headTitleWrap);
  const headBtns = el("div", "lh-cp-ph-btns");
  const themeBtn = el("button", "lh-cp-theme");
  themeBtn.setAttribute("aria-label", "테마 전환");
  const collapse = el("button", "lh-cp-collapse", "‹");
  collapse.title = "목차 숨기기";
  headBtns.append(themeBtn, collapse);
  headTop.appendChild(headBtns);
  // Theme (light/dark): follow the OS by default; the toggle forces + persists a choice.
  const readTheme = (): string | null => { try { const v = localStorage.getItem("lh:theme"); return v === "dark" || v === "light" ? v : null; } catch { return null; } };
  const sysDark = (): boolean => { try { return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches); } catch { return false; } };
  const isDark = (): boolean => { const s = readTheme(); return s ? s === "dark" : sysDark(); };
  const applyTheme = (): void => {
    const s = readTheme();
    if (s) document.documentElement.setAttribute("data-theme", s);
    else document.documentElement.removeAttribute("data-theme");
    themeBtn.textContent = isDark() ? "☀" : "☾";
    themeBtn.title = isDark() ? "라이트 모드로" : "다크 모드로";
  };
  themeBtn.addEventListener("click", () => {
    try { localStorage.setItem("lh:theme", isDark() ? "light" : "dark"); } catch { /* */ }
    applyTheme();
  });
  applyTheme();
  head.appendChild(headTop);
  // progress
  const prog = el("div", "lh-cp-prog");
  const progRow = el("div", "lh-cp-prog-row");
  progRow.appendChild(el("span", undefined, "학습 진도"));
  const progVal = el("span", "lh-cp-prog-val");
  progRow.appendChild(progVal);
  prog.appendChild(progRow);
  const progBar = el("div", "lh-cp-prog-bar");
  const progFill = el("div", "lh-cp-prog-fill");
  progBar.appendChild(progFill);
  prog.appendChild(progBar);
  head.appendChild(prog);
  aside.appendChild(head);

  const nav = el("nav", "lh-cp-nav");
  aside.appendChild(nav);
  container.appendChild(aside);

  // ── Main ──
  const main = el("main", "lh-cp-main");
  main.appendChild(el("div", "lh-cp-crumb", `${courseTitle} · 핵심 이론`));
  main.appendChild(el("h1", "lh-cp-h1", CL.pageTitle));
  main.appendChild(el("p", "lh-cp-sub", "개념을 단계적으로 익히고, 문제로 바로 확인하세요."));
  const stage = el("div", "lh-cp-stage");
  main.appendChild(stage);
  container.appendChild(main);

  // ── Problem-practice page (separate view) ──
  const probMain = el("main", "lh-cp-main lh-cp-probmain");
  probMain.style.display = "none";
  container.appendChild(probMain);

  // ── 기출문제 page (separate view) ──
  const kichMain = el("main", "lh-cp-main lh-cp-probmain");
  kichMain.style.display = "none";
  container.appendChild(kichMain);

  // ── View toggle (concept learning / problem practice) ──
  const vtabs = el("div", "lh-cp-vtabs");
  const navConcept = el("button", "lh-cp-vtab lh-cp-vtab--on", "개념 학습");
  const navProblems = el("button", "lh-cp-vtab", "문제 풀이");
  const navKichul = el("button", "lh-cp-vtab", CL.pastTab);
  if (!CL.pastTab) navKichul.style.display = "none";
  vtabs.append(navConcept, navProblems, navKichul);
  container.appendChild(vtabs);

  const checkedAreas = new Set<string>(index.filter((n) => n.concepts.length).map((n) => n.area.key));
  const areaProblemCount = (node: IndexNode): number => node.concepts.reduce((s, seed) => s + conceptProblems(seed.concept_id).length, 0);

  function buildProblemsPage(): void {
    probMain.innerHTML = "";
    probMain.appendChild(el("div", "lh-cp-crumb", `${courseTitle} · 문제 풀이`));
    probMain.appendChild(el("h1", "lh-cp-h1", "문제 풀이"));
    probMain.appendChild(el("p", "lh-cp-sub", "과목을 선택해 랜덤 출제하거나, 개념별로 새 문제를 생성하세요. 랜덤 출제는 과목당 20문제(개념당 최대 3문제)입니다."));

    const bar = el("div", "lh-cp-exam-bar");
    const allBtn = el("button", "lh-cp-btn-ghost");
    const examBtn = el("button", "lh-cp-btn-primary", "선택 과목 출제");
    bar.append(allBtn, examBtn);
    probMain.appendChild(bar);

    const subjWrap = el("div", "lh-cp-subjs");
    probMain.appendChild(subjWrap);
    const examOut = el("div", "lh-cp-exam-out");
    probMain.appendChild(examOut);

    const allChecked = (): boolean => index.every((n) => !n.concepts.length || checkedAreas.has(n.area.key));
    const syncAllBtn = (): void => { allBtn.textContent = allChecked() ? "전체 해제" : "전체 선택"; };

    for (const node of index) {
      if (!node.concepts.length) continue;
      const block = el("div", "lh-cp-subj");
      const headRow = el("div", "lh-cp-subj-head");
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.className = "lh-cp-subj-cb";
      cb.checked = checkedAreas.has(node.area.key);
      cb.addEventListener("change", () => { if (cb.checked) checkedAreas.add(node.area.key); else checkedAreas.delete(node.area.key); syncAllBtn(); });
      const label = el("label", "lh-cp-subj-label", (node.area.icon ? node.area.icon + " " : "") + node.area.label);
      label.prepend(cb);
      const count = el("span", "lh-cp-subj-count", `${areaProblemCount(node)}문제`);
      const chev = el("button", "lh-cp-subj-chev", "▶");
      headRow.append(label, count, chev);
      block.appendChild(headRow);

      const concepts = el("div", "lh-cp-subj-concepts"); concepts.style.display = "none";
      for (const seed of node.concepts) {
        const crow = el("div", "lh-cp-cprow");
        const ctitle = el("button", "lh-cp-cprow-title");
        const ctm = tierMeta(seed);
        if (ctm) { const b = el("span", "lh-cp-tier lh-cp-tier--" + ctm.sfx, ctm.badge); b.title = ctm.title; ctitle.appendChild(b); }
        ctitle.appendChild(document.createTextNode(seed.title));
        ctitle.addEventListener("click", () => { void selectConcept(node.area, seed); });
        const ccount = el("span", "lh-cp-cprow-count", `${conceptProblems(seed.concept_id).length}`);
        const cgen = el("button", "lh-cp-cprow-gen", "생성");
        if (!aiClient) { cgen.disabled = true; cgen.title = "AI 미연결"; }
        cgen.addEventListener("click", async () => {
          cgen.disabled = true; cgen.textContent = "…";
          const r = await generateProblems(seed.concept_id, 5);
          cgen.disabled = false;
          if (r.ok) { ccount.textContent = `${conceptProblems(seed.concept_id).length}`; count.textContent = `${areaProblemCount(node)}문제`; cgen.textContent = `+${r.added}`; }
          else cgen.textContent = "실패";
          setTimeout(() => { cgen.textContent = "생성"; }, 1600);
        });
        crow.append(ctitle, ccount, cgen);
        concepts.appendChild(crow);
      }
      block.appendChild(concepts);
      const toggle = (): void => { const open = concepts.style.display === "none"; concepts.style.display = open ? "" : "none"; chev.style.transform = open ? "rotate(90deg)" : ""; };
      chev.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
      headRow.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest(".lh-cp-subj-label")) return; toggle(); });
      subjWrap.appendChild(block);
    }
    syncAllBtn();

    allBtn.addEventListener("click", () => {
      const target = !allChecked();
      checkedAreas.clear();
      if (target) for (const n of index) if (n.concepts.length) checkedAreas.add(n.area.key);
      buildProblemsPage();
    });
    examBtn.addEventListener("click", () => {
      examOut.innerHTML = ""; let sn = 0;
      for (const node of index) {
        if (!checkedAreas.has(node.area.key) || !node.concepts.length) continue;
        sn++;
        const pool: { p: ProblemDef; seed: ConceptSeed }[] = [];
        for (const seed of node.concepts) for (const p of shuffle(conceptProblems(seed.concept_id)).slice(0, 3)) pool.push({ p, seed }); // 개념당 최대 3
        const chosen = shuffle(pool).slice(0, 20); // 과목당 20
        const secEl = el("section", "lh-cp-exam-sec");
        secEl.appendChild(el("h2", "lh-cp-exam-h", `${sn}과목 · ${node.area.label}`));
        secEl.appendChild(el("div", "lh-cp-exam-meta", `랜덤 ${chosen.length}문제`));
        if (!chosen.length) secEl.appendChild(el("div", "lh-cp-status", "이 과목에는 아직 문제가 없습니다."));
        chosen.forEach((x, i) => secEl.appendChild(renderProblem(x.p, i + 1, subjectKey, {
          onProgress, explainLabel: CL.explain,
          // 문제풀이 화면에선 그 개념 학습 페이지를 새 창으로 연다(?c= 딥링크 -> mount가 초기 선택).
          onReview: () => { try { window.open(`${window.location.pathname}?c=${encodeURIComponent(x.seed.concept_id)}`, "_blank", "noopener"); } catch { /* popup blocked */ } },
        })));
        examOut.appendChild(secEl);
      }
      if (!sn) examOut.appendChild(el("div", "lh-cp-status", "과목을 하나 이상 선택하세요."));
      examOut.scrollIntoView?.({ block: "start" });
    });
  }

  // ── 기출문제 page: past-exam problems grouped by 회차 (round chips + one round at a time) ──
  function buildKichulPage(): void {
    kichMain.innerHTML = "";
    kichMain.appendChild(el("div", "lh-cp-crumb", `${courseTitle} · 기출문제`));
    kichMain.appendChild(el("h1", "lh-cp-h1", "기출문제"));
    kichMain.appendChild(el("p", "lh-cp-sub", "2020~2026 회차별 복원 기출문제입니다. 코드·SQL 정답은 실제 실행으로 검증했습니다."));
    const byRound = new Map<string, { p: ProblemDef; cid: string }[]>();
    for (const seed of allSeeds) {
      for (const p of conceptProblems(seed.concept_id)) {
        if (p.source === "기출" && p.round) {
          let arr = byRound.get(p.round);
          if (!arr) { arr = []; byRound.set(p.round, arr); }
          arr.push({ p, cid: seed.concept_id });
        }
      }
    }
    const rk = (r: string): number => { const m = r.match(/(\d{4}).*?(\d)/); return m ? +m[1] * 10 + +m[2] : 0; };
    const rounds = [...byRound.keys()].sort((a, b) => rk(a) - rk(b));
    if (!rounds.length) { kichMain.appendChild(el("div", "lh-cp-status", "기출문제가 없습니다.")); return; }
    const chips = el("div", "lh-cp-kich-chips");
    kichMain.appendChild(chips);
    const out = el("div", "lh-cp-exam-out");
    kichMain.appendChild(out);
    const cardNo = (p: ProblemDef): number => { const m = (p.card_id || "").match(/-(\d+)$/); return m ? +m[1] : 0; };
    const showRound = (r: string): void => {
      out.innerHTML = "";
      for (const c of Array.from(chips.children)) c.classList.toggle("lh-cp-kich-chip--on", c.textContent === r);
      const items = (byRound.get(r) ?? []).slice().sort((a, b) => cardNo(a.p) - cardNo(b.p));
      const sec = el("section", "lh-cp-exam-sec");
      sec.appendChild(el("h2", "lh-cp-exam-h", r));
      sec.appendChild(el("div", "lh-cp-exam-meta", `${items.length}문제`));
      items.forEach((x, i) => sec.appendChild(renderProblem(x.p, i + 1, subjectKey, {
        onProgress, explainLabel: CL.explain,
        onReview: () => { try { window.open(`${window.location.pathname}?c=${encodeURIComponent(x.cid)}`, "_blank", "noopener"); } catch { /* popup blocked */ } },
      })));
      out.appendChild(sec);
    };
    rounds.forEach((r) => {
      const chip = el("button", "lh-cp-kich-chip", r);
      chip.addEventListener("click", () => showRound(r));
      chips.appendChild(chip);
    });
    showRound(rounds[rounds.length - 1]);   // default: latest round
  }

  let view: ViewName = "concept";
  // A "?c=" window is an ephemeral popup ("개념 다시 보기" 새 창). It must NOT overwrite the shared
  // saved view state, or refreshing the main tab would jump to the popup's concept.
  const isDeepLink = (() => { try { return new URLSearchParams(window.location.search).has("c"); } catch { return false; } })();
  const persistView = (): void => { if (!isDeepLink) saveViewState(subjectKey, { view, conceptId: activeId ?? undefined }); };
  function setView(v: ViewName): void {
    view = v;
    hideBack();
    const isConcept = v === "concept";
    aside.classList.toggle("lh-cp-hide", !isConcept);
    main.style.display = v === "concept" ? "" : "none";
    probMain.style.display = v === "problems" ? "" : "none";
    kichMain.style.display = v === "kichul" ? "" : "none";
    aiTab.style.display = isConcept ? "" : "none";
    navConcept.classList.toggle("lh-cp-vtab--on", v === "concept");
    navProblems.classList.toggle("lh-cp-vtab--on", v === "problems");
    navKichul.classList.toggle("lh-cp-vtab--on", v === "kichul");
    if (isConcept) { reopen.style.display = panelOpen ? "none" : ""; }
    else {
      reopen.style.display = "none"; if (aiClient) setAi(false); endSub();
      if (v === "problems") buildProblemsPage(); else buildKichulPage();
    }
    persistView();
  }
  navConcept.addEventListener("click", () => setView("concept"));
  navProblems.addEventListener("click", () => setView("problems"));
  navKichul.addEventListener("click", () => setView("kichul"));

  // ── AI 도우미 (right side panel) — subscription session, sonnet ──
  const aiTab = el("button", "lh-cp-ai-tab", "AI");
  aiTab.setAttribute("aria-label", "AI 도우미 열기");
  container.appendChild(aiTab);

  const ai = el("aside", "lh-cp-ai");
  const aiHead = el("div", "lh-cp-ai-head");
  const aiTitleWrap = el("div", "lh-cp-ai-titlewrap");
  aiTitleWrap.appendChild(el("span", "lh-cp-ai-title", "AI 도우미"));
  aiTitleWrap.appendChild(el("span", "lh-cp-ai-badge", "sonnet"));
  aiHead.appendChild(aiTitleWrap);
  const aiHeadBtns = el("div", "lh-cp-ai-headbtns");
  const aiReset = el("button", "lh-cp-ai-reset", "초기화");
  aiReset.setAttribute("aria-label", "대화 초기화");
  if (!aiClient) aiReset.disabled = true;
  const aiClose = el("button", "lh-cp-ai-close", "×");
  aiClose.setAttribute("aria-label", "닫기");
  aiHeadBtns.append(aiReset, aiClose);
  aiHead.appendChild(aiHeadBtns);
  ai.appendChild(aiHead);
  const aiMsgs = el("div", "lh-cp-ai-msgs");
  const aiHint = el("div", "lh-cp-ai-empty", aiClient
    ? "현재 개념에 대해 물어보세요. 본문을 드래그하면 그 문장이 자동으로 입력됩니다 — 질문에는 이 개념 전체가 함께 전달됩니다."
    : CL.aiSetupHint);
  aiMsgs.appendChild(aiHint);
  ai.appendChild(aiMsgs);
  const aiInputRow = el("div", "lh-cp-ai-inputrow");
  const aiInput = document.createElement("textarea");
  aiInput.className = "lh-cp-ai-input";
  aiInput.rows = 2;
  aiInput.placeholder = aiClient ? "질문 입력 (Ctrl+Enter 전송)" : "AI 미연결";
  if (!aiClient) aiInput.disabled = true;
  const aiSend = el("button", "lh-cp-ai-send", "보내기");
  if (!aiClient) aiSend.disabled = true;
  aiInputRow.append(aiInput, aiSend);
  ai.appendChild(aiInputRow);
  // Expand handle on the panel's left boundary — widens the panel over a blurred body, leaving
  // only enough room on the left for the sub panel.
  const aiExpand = el("button", "lh-cp-ai-expand", "«");
  aiExpand.setAttribute("aria-label", "AI 패널 확장");
  ai.appendChild(aiExpand);
  container.appendChild(ai);
  const aiBackdrop = el("div", "lh-cp-ai-backdrop");
  container.appendChild(aiBackdrop);

  let aiExpanded = false;
  function setExpand(on: boolean): void {
    aiExpanded = on;
    ai.classList.toggle("lh-cp-ai--expanded", on);
    aiBackdrop.classList.toggle("lh-cp-ai-backdrop--on", on);
    aiExpand.textContent = on ? "»" : "«";
    aiExpand.setAttribute("aria-label", on ? "AI 패널 축소" : "AI 패널 확장");
  }
  aiExpand.addEventListener("click", () => setExpand(!aiExpanded));
  aiBackdrop.addEventListener("click", () => setExpand(false));

  function setAi(open: boolean): void {
    ai.classList.toggle("lh-cp-ai--open", open);
    aiTab.classList.toggle("lh-cp-ai-tab--hidden", open);
    if (!open) setExpand(false);
    if (open && aiClient) aiInput.focus();
  }
  aiTab.addEventListener("click", () => setAi(true));
  aiClose.addEventListener("click", () => setAi(false));

  // Per-concept chat: each concept keeps its own AI session + message history, so switching concepts
  // in the index switches the conversation (and a resumed session keeps that section's context).
  interface ChatMsg { role: "user" | "assistant"; text: string; pending?: boolean; error?: boolean }
  interface ChatEntry { session: AiSession | null; msgs: ChatMsg[] }
  const chats = new Map<string, ChatEntry>();
  let panelConceptId: string | null = null;
  function getChat(id: string): ChatEntry {
    let e = chats.get(id);
    if (!e) { e = { session: null, msgs: loadChatMsgs(subjectKey, id) as ChatMsg[] }; chats.set(id, e); }
    return e;
  }
  const transcriptOf = (msgs: ChatMsg[]): string =>
    msgs.filter((m) => !m.pending && !m.error).map((m) => (m.role === "user" ? "학습자" : "AI") + ": " + m.text).join("\n\n");
  const persistChat = (id: string): void => {
    const e = chats.get(id); if (!e) return;
    saveChatMsgs(subjectKey, id, e.msgs.filter((m) => !m.pending).map((m) => ({ role: m.role, text: m.text, error: m.error })));
  };
  function renderChat(id: string | null): void {
    aiMsgs.innerHTML = "";
    const e = id ? getChat(id) : null;   // getChat hydrates from localStorage on first access
    if (!e || !e.msgs.length) { aiHint.style.display = ""; aiMsgs.appendChild(aiHint); return; }
    for (const m of e.msgs) {
      const row = el("div", "lh-cp-ai-msg lh-cp-ai-msg--" + m.role);
      const b = el("div", "lh-cp-ai-bubble");
      if (m.pending) { b.classList.add("lh-cp-ai-typing"); b.textContent = "생성 중…"; }
      else if (m.role === "assistant" && !m.error) b.appendChild(renderAiBody(m.text));
      else b.textContent = m.text;
      row.appendChild(b); aiMsgs.appendChild(row);
    }
    aiMsgs.scrollTop = aiMsgs.scrollHeight;
  }
  function friendlyError(err: string | null): string {
    const e = err ?? "알 수 없는 오류";
    if (/401|403/.test(e)) return CL.authHint;
    if (/fetch|network|failed|refused|ECONN|Load failed/i.test(e)) return "AI 서버에 연결할 수 없습니다. ai_server(bot/ai_server.py)가 실행 중인지 확인하세요.";
    if (/50\d/.test(e)) return "AI 서버 내부 오류입니다. ai_server 로그와 claude CLI 로그인 상태를 확인하세요.";
    return "오류: " + e;
  }
  // Shared system prompt (component/output spec) for both the main panel and the sub panel.
  const aiSystemPrompt = (): string =>
    `너는 '${courseTitle}' 학습 도우미다. 아래 [개념]을 근거로 학습자의 질문에 한국어로 답한다.\n` +
    DOC_DIALECT + `\n` +
    `- 비교표는 우측 패널이 좁으니 넓은 표보다 2열표와 목록을 우선하고 간결하게\n` +
    DOC_FIGURE_CLAUSE + `\n` +
    `본문 그림과 같은 수준으로 그린다. 답을 감출 땐 ':::정답'을 쓴다.\n` +
    `개념에 없는 내용은 일반 지식으로 보완하되 불확실하면 그렇게 밝혀라.`;
  async function sendChat(): Promise<void> {
    const q = aiInput.value.trim();
    if (!q) return;
    const concept = currentConcept;
    const id = concept?.concept_id ?? "__none__";
    const entry = getChat(id);
    if (!aiClient) {
      entry.msgs.push({ role: "assistant", text: CL.aiSetupHint, error: true });
      persistChat(id);
      if (panelConceptId === id) renderChat(id);
      return;
    }
    // History that preceded this turn — used to re-seed a fresh session (e.g. after a refresh) so
    // the conversation keeps its context even though the server session itself isn't persisted.
    const prior = transcriptOf(entry.msgs);
    aiInput.value = "";
    entry.msgs.push({ role: "user", text: q });
    const pending: ChatMsg = { role: "assistant", text: "생성 중…", pending: true };
    entry.msgs.push(pending);
    persistChat(id);
    if (panelConceptId === id) renderChat(id);
    aiSend.disabled = true;
    aiInput.disabled = true;
    try {
      let seed = false;
      if (!entry.session) { entry.session = new AiSession(aiClient); seed = true; }
      const sys = aiSystemPrompt();
      const ctx = seed && prior ? `[이전 대화]\n${prior}\n\n` : "";
      const prompt = seed && concept
        ? `[개념: ${concept.title}]\n${concept.body}\n\n${ctx}[학습자 요청]\n${q}`
        : q;
      const res = await entry.session.send({ prompt, system: seed ? sys : undefined, model: "sonnet", effort: "high" });
      pending.pending = false;
      if (res.ok) pending.text = res.text.trim() || "(빈 응답)";
      else { pending.text = friendlyError(res.error); pending.error = true; }
    } catch (e) {
      pending.pending = false;
      pending.text = friendlyError((e as Error)?.message ?? String(e));
      pending.error = true;
    } finally {
      aiSend.disabled = false;
      aiInput.disabled = false;
      persistChat(id);
      if (panelConceptId === id) renderChat(id);
    }
  }
  aiReset.addEventListener("click", () => {
    const id = panelConceptId ?? currentConcept?.concept_id ?? "__none__";
    const e = getChat(id);
    e.msgs.length = 0; e.session = null;   // wipe history + start a new session
    clearChatMsgs(subjectKey, id);
    renderChat(id);
    if (aiClient) aiInput.focus();
  });
  aiSend.addEventListener("click", () => void sendChat());
  aiInput.addEventListener("keydown", (e) => {
    const k = e as KeyboardEvent;
    if (k.key === "Enter" && (k.ctrlKey || k.metaKey)) { e.preventDefault(); void sendChat(); }
  });

  // ── 보조(Sub) AI 패널 — 좌측 플로팅 + 최소화. 메인 대화를 오염시키지 않는 일회성 세션이되,
  //    호출 시점의 메인 대화 맥락을 시드로 주입해 "파생 브랜치"처럼 이어서 묻는다. X = 세션 종료(재호출 없음).
  const subAi = el("aside", "lh-cp-subai");
  const subHead = el("div", "lh-cp-ai-head lh-cp-subai-head");
  const subTitleWrap = el("div", "lh-cp-ai-titlewrap");
  subTitleWrap.appendChild(el("span", "lh-cp-ai-title", "보조 질문"));
  subTitleWrap.appendChild(el("span", "lh-cp-ai-badge", "분기"));
  const subBtns = el("div", "lh-cp-subai-btns");
  const subMinBtn = el("button", "lh-cp-subai-min", "—"); subMinBtn.setAttribute("aria-label", "최소화");
  const subClose = el("button", "lh-cp-ai-close", "×"); subClose.setAttribute("aria-label", "세션 종료");
  subBtns.append(subMinBtn, subClose);
  subHead.append(subTitleWrap, subBtns);
  subAi.appendChild(subHead);
  const subMsgsEl = el("div", "lh-cp-ai-msgs lh-cp-subai-msgs");
  subAi.appendChild(subMsgsEl);
  const subInputRow = el("div", "lh-cp-ai-inputrow");
  const subInput = document.createElement("textarea");
  subInput.className = "lh-cp-ai-input"; subInput.rows = 2;
  subInput.placeholder = aiClient ? "후속 질문 (Ctrl+Enter 전송)" : "AI 미연결";
  if (!aiClient) subInput.disabled = true;
  const subSend = el("button", "lh-cp-ai-send", "보내기");
  if (!aiClient) subSend.disabled = true;
  subInputRow.append(subInput, subSend);
  subAi.appendChild(subInputRow);
  container.appendChild(subAi);

  let subSession: AiSession | null = null;
  const subMsgs: ChatMsg[] = [];
  let subBranch = "";      // main-panel transcript captured at the branch point (seeds the sub session)
  let subOpen = false;
  function renderSub(): void {
    subMsgsEl.innerHTML = "";
    if (!subMsgs.length) {
      subMsgsEl.appendChild(el("div", "lh-cp-ai-empty", aiClient
        ? "드래그한 내용에 대해 후속 질문을 하세요. 메인 AI 대화 맥락을 이어받은 별도(일회성) 세션이라 메인 대화를 건드리지 않습니다."
        : "AI 서버가 연결되지 않았습니다."));
      return;
    }
    for (const m of subMsgs) {
      const row = el("div", "lh-cp-ai-msg lh-cp-ai-msg--" + m.role);
      const b = el("div", "lh-cp-ai-bubble");
      if (m.pending) { b.classList.add("lh-cp-ai-typing"); b.textContent = "생성 중…"; }
      else if (m.role === "assistant" && !m.error) b.appendChild(renderAiBody(m.text));
      else b.textContent = m.text;
      row.appendChild(b); subMsgsEl.appendChild(row);
    }
    subMsgsEl.scrollTop = subMsgsEl.scrollHeight;
  }
  function setSub(open: boolean): void {
    subOpen = open;
    subAi.classList.toggle("lh-cp-subai--open", open);
    if (!open) subAi.classList.remove("lh-cp-subai--min");
  }
  function endSub(): void {
    setSub(false); subSession = null; subMsgs.length = 0; subBranch = ""; subInput.value = ""; renderSub();
  }
  subMinBtn.addEventListener("click", () => { subAi.classList.toggle("lh-cp-subai--min"); if (!subAi.classList.contains("lh-cp-subai--min") && aiClient) subInput.focus(); });
  subClose.addEventListener("click", endSub);   // X = 세션 종료, 재호출 없음
  function openSubWith(text: string): void {
    // Branch: on a fresh open, capture the current main conversation as seed context.
    if (!subOpen) {
      subSession = null; subMsgs.length = 0;
      const id = currentConcept?.concept_id ?? "__none__";
      subBranch = transcriptOf(getChat(id).msgs);
      renderSub();
    }
    setSub(true); subAi.classList.remove("lh-cp-subai--min");
    if (aiClient) { subInput.value = subInput.value ? subInput.value + " " + text : text; subInput.focus(); }
  }
  async function sendSubChat(): Promise<void> {
    const q = subInput.value.trim();
    if (!q) return;
    if (!aiClient) { subMsgs.push({ role: "assistant", text: "AI가 연결되지 않았습니다.", error: true }); renderSub(); return; }
    const concept = currentConcept;
    subInput.value = "";
    subMsgs.push({ role: "user", text: q });
    const pending: ChatMsg = { role: "assistant", text: "생성 중…", pending: true };
    subMsgs.push(pending); renderSub();
    subSend.disabled = true; subInput.disabled = true;
    try {
      let seed = false;
      if (!subSession) { subSession = new AiSession(aiClient); seed = true; }
      let prompt = q;
      if (seed) {
        const head = concept ? `[개념: ${concept.title}]\n${concept.body}\n\n` : "";
        const ctx = subBranch ? `[지금까지의 AI 대화]\n${subBranch}\n\n` : "";
        prompt = `${head}${ctx}[학습자 후속 질문]\n${q}`;
      }
      const subSys = aiSystemPrompt() + `\n[보조 패널] 화면이 좁으니 미니멀하게 답하라. 넓은 표와 그림(SVG)은 피하고, 짧은 문장과 간단한 목록·인라인 강조 위주로 핵심만 간결히.`;
      const res = await subSession.send({ prompt, system: seed ? subSys : undefined, model: "sonnet", effort: "high" });
      pending.pending = false;
      if (res.ok) pending.text = res.text.trim() || "(빈 응답)";
      else { pending.text = friendlyError(res.error); pending.error = true; }
    } catch (e) {
      pending.pending = false; pending.text = friendlyError((e as Error)?.message ?? String(e)); pending.error = true;
    } finally {
      subSend.disabled = false; subInput.disabled = false; renderSub();
    }
  }
  subSend.addEventListener("click", () => void sendSubChat());
  subInput.addEventListener("keydown", (e) => { const k = e as KeyboardEvent; if (k.key === "Enter" && (k.ctrlKey || k.metaKey)) { e.preventDefault(); void sendSubChat(); } });
  renderSub();

  // "Sub 질문": selecting text inside the AI panel offers a branched follow-up in the sub panel.
  const subAskBtn = el("button", "lh-cp-askbtn lh-cp-subaskbtn", "Sub 질문");
  subAskBtn.style.display = "none";
  container.appendChild(subAskBtn);
  let subPendingSel = "";
  function hideSubAsk(): void { subAskBtn.style.display = "none"; subPendingSel = ""; }
  ai.addEventListener("mouseup", () => {
    const sel = typeof window.getSelection === "function" ? window.getSelection() : null;
    const t = sel ? sel.toString().trim() : "";
    if (!sel || sel.rangeCount === 0 || t.length < 2 || !ai.contains(sel.anchorNode)) { hideSubAsk(); return; }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) { hideSubAsk(); return; }
    subPendingSel = t;
    subAskBtn.style.display = "";
    const bw = subAskBtn.offsetWidth || 92, bh = subAskBtn.offsetHeight || 34;
    let left = rect.left + rect.width / 2 - bw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - bw - 8));
    let top = rect.top - bh - 8; if (top < 8) top = rect.bottom + 8;
    subAskBtn.style.left = left + "px"; subAskBtn.style.top = top + "px";
  });
  subAskBtn.addEventListener("mousedown", (e) => e.preventDefault());
  subAskBtn.addEventListener("click", () => { if (subPendingSel) { openSubWith(subPendingSel); hideSubAsk(); } });

  // Selecting text in the concept column shows an "AI 질문" popup just above the selection.
  // It does NOT jump straight into the input — clicking the popup is a deliberate step that moves
  // the selected text into the AI panel (the user still edits + presses 보내기 to send).
  // ── "문제로 돌아가기" floating button (bottom-right). Appears after "개념 다시 보기" jumps up to
  //    the concept explanation; returns to the originating problem card and auto-hides once that card
  //    is on screen. Element-based, so it works for any current or future problem.
  const backBtn = el("button", "lh-cp-backprob");
  backBtn.innerHTML = '<span class="lh-cp-backprob-ico">▾</span> 문제로 돌아가기';
  backBtn.style.display = "none";
  container.appendChild(backBtn);
  let backOrigin: HTMLElement | null = null;
  let backObs: IntersectionObserver | null = null;
  let backLeft = false;   // has the origin card left the viewport at least once?
  function hideBack(): void { backBtn.style.display = "none"; if (backObs) { backObs.disconnect(); backObs = null; } backOrigin = null; }
  function reviewConcept(anchor: HTMLElement, card: HTMLElement): void {
    anchor.scrollIntoView?.({ behavior: "smooth", block: "start" });
    backOrigin = card;
    backLeft = false;
    backBtn.style.display = "";
    if (backObs) backObs.disconnect();
    if (typeof IntersectionObserver !== "undefined") {
      // Only auto-hide once the card has first scrolled OUT of view and then back IN — the observer's
      // initial callback (card still visible) must not dismiss the button immediately.
      backObs = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (e.target !== backOrigin) continue;
          if (!e.isIntersecting) backLeft = true;
          else if (backLeft) hideBack();
        }
      }, { threshold: 0.35 });
      backObs.observe(card);
    }
  }
  backBtn.addEventListener("click", () => { backOrigin?.scrollIntoView?.({ behavior: "smooth", block: "center" }); });

  // CP-3: every button offered for one selection sits in one group, and only the group is positioned.
  const askGroup = el("div", "lh-cp-askgroup");
  askGroup.style.display = "none";
  container.appendChild(askGroup);
  const askBtn = el("button", "lh-cp-askbtn", "AI 질문");
  askGroup.appendChild(askBtn);
  // Optional second target for a selection (props.askElsewhere): hands the text to another part,
  // e.g. a notebook that keeps the question. Offered on the concept page and the problem page.
  const elseBtn = props.askElsewhere ? el("button", "lh-cp-askbtn lh-cp-askbtn--else", props.askElsewhere.label) : null;
  if (elseBtn) askGroup.appendChild(elseBtn);
  let pendingSel = "";
  function hideAsk(): void { askGroup.style.display = "none"; pendingSel = ""; }
  function selectionRect(): { text: string; rect: DOMRect } | null {
    const sel = typeof window.getSelection === "function" ? window.getSelection() : null;
    const t = sel ? sel.toString().trim() : "";
    if (!sel || sel.rangeCount === 0 || t.length < 2) return null;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return null;
    return { text: t, rect };
  }
  /** Show the group with the given buttons and place it once: above the selection, or below it when there is no room. */
  function showAsk(rect: DOMRect, withAsk: boolean): void {
    askBtn.style.display = withAsk ? "" : "none";   // set every time: the problem page never offers "AI 질문"
    askGroup.classList.toggle("lh-cp-askgroup--else-only", !withAsk);
    askGroup.style.display = "";
    const gw = askGroup.offsetWidth || 88;
    const gh = askGroup.offsetHeight || 34;
    const cx = rect.left + rect.width / 2;
    const left = Math.max(8, Math.min(cx - gw / 2, window.innerWidth - gw - 8));
    let top = rect.top - gh - 8;
    const below = top < 8;
    if (below) top = Math.min(rect.bottom + 8, window.innerHeight - gh - 8);
    askGroup.classList.toggle("lh-cp-askgroup--below", below);
    askGroup.style.left = left + "px";
    askGroup.style.top = top + "px";
    askGroup.style.setProperty("--lh-tail-x", Math.max(12, Math.min(cx - left, gw - 12)) + "px");   // the tail points at the selection even when clamped
  }
  main.addEventListener("mouseup", () => {
    const s = selectionRect();
    if (!s) { hideAsk(); return; }
    pendingSel = s.text;
    showAsk(s.rect, true);
  });
  probMain.addEventListener("mouseup", () => {
    if (!elseBtn) return;
    const s = selectionRect();
    if (!s) { hideAsk(); return; }
    pendingSel = s.text;
    showAsk(s.rect, false);
  });
  askGroup.addEventListener("mousedown", (e) => e.preventDefault()); // keep the text selection, gap included
  if (elseBtn) elseBtn.addEventListener("click", () => { const t = pendingSel; hideAsk(); if (t) props.askElsewhere!.onAsk(t); });
  askBtn.addEventListener("click", () => {
    if (!pendingSel) return;
    if (aiClient) aiInput.value = aiInput.value ? aiInput.value + " " + pendingSel : pendingSel;
    setAi(true);
    hideAsk();
    if (aiClient) aiInput.focus();
  });
  document.addEventListener("mousedown", (e) => { if (!askGroup.contains(e.target as Node)) hideAsk(); if (e.target !== subAskBtn) hideSubAsk(); });
  window.addEventListener("scroll", () => { hideAsk(); hideSubAsk(); }, true);

  function refreshProgress(): void {
    const done = allSeeds.filter((s) => readDone(subjectKey, s.concept_id)).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    progVal.textContent = `${pct}% · ${done}/${total}개념`;
    progFill.style.width = pct + "%";
  }

  // panel collapse
  let panelOpen = true;
  function setPanel(open: boolean): void {
    panelOpen = open;
    aside.classList.toggle("lh-cp-aside--hidden", !open);
    container.classList.toggle("lh-cp--collapsed", !open);
    reopen.style.display = open ? "none" : "";
  }
  collapse.addEventListener("click", () => setPanel(false));
  reopen.addEventListener("click", () => setPanel(true));

  // ── Build the index (accordion: area -> concepts with checkbox) ──
  let activeId: string | null = null;
  const secEls = new Map<string, { row: HTMLElement; check: HTMLElement }>();

  for (const node of index) {
    const unit = el("div", "lh-cp-unit");
    const open = { v: true };
    const ubtn = el("button", "lh-cp-unit-btn");
    const chev = el("span", "lh-cp-unit-chev", "▶");
    const icon = node.area.icon ? node.area.icon + " " : "";
    const utitle = el("span", "lh-cp-unit-title", icon + node.area.label);
    const ucount = el("span", "lh-cp-unit-count");
    ubtn.append(chev, utitle, ucount);
    unit.appendChild(ubtn);
    const secWrap = el("div", "lh-cp-unit-secs");
    unit.appendChild(secWrap);

    const refreshCount = () => {
      const done = node.concepts.filter((s) => readDone(subjectKey, s.concept_id)).length;
      ucount.textContent = `${done}/${node.concepts.length}`;
    };

    for (const seed of node.concepts) {
      const row = el("div", "lh-cp-sec");
      const checkBtn = el("button", "lh-cp-check-btn");
      checkBtn.title = "완료 표시";
      const check = el("span", "lh-cp-check");
      checkBtn.appendChild(check);
      const link = el("button", "lh-cp-sec-link");
      const stm = tierMeta(seed);
      if (stm) {
        link.classList.add("lh-cp-sec-link--t" + stm.sfx);
        const badge = el("span", "lh-cp-tier lh-cp-tier--" + stm.sfx, stm.badge);
        badge.title = stm.title;
        link.appendChild(badge);
      }
      link.appendChild(document.createTextNode(seed.title));
      const applyDone = () => {
        const d = readDone(subjectKey, seed.concept_id);
        check.classList.toggle("lh-cp-check--on", d);
        check.textContent = d ? "✓" : "";
        row.classList.toggle("lh-cp-sec--done", d);
      };
      applyDone();
      checkBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const d = !readDone(subjectKey, seed.concept_id);
        writeDone(subjectKey, seed.concept_id, d);
        applyDone(); refreshCount(); refreshProgress();
      });
      link.addEventListener("click", () => { void selectConcept(node.area, seed); });
      row.append(checkBtn, link);
      secWrap.appendChild(row);
      secEls.set(seed.concept_id, { row, check });
    }

    ubtn.addEventListener("click", () => {
      open.v = !open.v;
      secWrap.style.display = open.v ? "" : "none";
      chev.style.transform = open.v ? "rotate(90deg)" : "rotate(0deg)";
    });
    chev.style.transform = "rotate(90deg)";
    refreshCount();
    nav.appendChild(unit);
  }
  refreshProgress();

  // ── Select + render a concept ──
  // With an author prompt each concept gets its own session, so one concept's reading never rides in
  // the context of the next; without one, the shared session keeps its original behaviour (N-13).
  const genSession = (): AiSession | null => (author && aiClient ? new AiSession(aiClient) : session);
  async function loadConcept(area: AreaDef, seed: ConceptSeed, regenerate = false): Promise<GeneratedConcept | null> {
    if (!regenerate) {
      if (cache.has(seed.concept_id)) return cache.get(seed.concept_id)!;
      if (prebaked[seed.concept_id]) { cache.set(seed.concept_id, prebaked[seed.concept_id]); return prebaked[seed.concept_id]; }
      if (conceptStore) {
        const stored = await conceptStore.load(seed.concept_id).catch(() => null);
        if (stored) { cache.set(seed.concept_id, stored); return stored; }
      }
    }
    const gen = genSession();
    if (!gen) return null;
    stage.innerHTML = "";
    stage.appendChild(el("div", "lh-cp-status", "개념 불러오는 중…"));
    const { concept } = await generateConcept(gen, { area: area.key, concept_id: seed.concept_id, title: seed.title }, author);
    if (concept) {
      // The outline owns the ids; a model that renames the concept must not orphan its record.
      concept.concept_id = seed.concept_id;
      concept.area = area.key;
      cache.set(seed.concept_id, concept);
      if (conceptStore) await conceptStore.save(concept).catch(() => undefined);
    }
    return concept;
  }

  async function selectConcept(area: AreaDef, seed: ConceptSeed): Promise<void> {
    hideBack();
    endSub();   // a sub branch belongs to one concept's conversation; drop it when the concept changes
    if (view !== "concept") setView("concept");
    activeId = seed.concept_id;
    for (const [id, { row }] of secEls) row.classList.toggle("lh-cp-sec--active", id === activeId);
    const concept = await loadConcept(area, seed);
    stage.innerHTML = "";
    if (!concept) {
      stage.appendChild(el("div", "lh-cp-status", "이 개념은 아직 준비되지 않았습니다."));
      return;
    }
    renderConcept(area, concept);
    // switch the AI panel to this concept's own conversation
    panelConceptId = concept.concept_id;
    renderChat(panelConceptId);
    // mark read
    const rec: ProgressRecord = { module: "conceptprob", item_id: concept.concept_id, read: true, ts: Date.now() };
    saveProgress(subjectKey, rec); onProgress?.(rec);
    persistView();
    main.scrollIntoView?.({ block: "start" });
  }

  function renderConcept(area: AreaDef, concept: GeneratedConcept): void {
    currentConcept = concept;
    const sec = el("section", "lh-cp-csec");

    // header: chip + kicker, title + actions
    const sh = el("div", "lh-cp-csec-head");
    sh.appendChild(el("span", "lh-cp-chip", area.label));
    const hseed = allSeeds.find((s) => s.concept_id === concept.concept_id);
    const htm = hseed ? tierMeta(hseed) : null;
    if (htm) sh.appendChild(el("span", "lh-cp-tier-chip lh-cp-tier-chip--" + htm.sfx, htm.chip));
    sec.appendChild(sh);
    const titleRow = el("div", "lh-cp-title-row");
    titleRow.appendChild(el("h2", "lh-cp-h2", concept.title));
    const actions = el("div", "lh-cp-actions");
    const bm = el("button", "lh-cp-act");
    const bmKey = "bm:" + concept.concept_id;
    const setBm = () => { const on = readDone(subjectKey, bmKey); bm.classList.toggle("lh-cp-act--on", on); bm.innerHTML = (on ? "★" : "☆") + " 북마크"; };
    setBm();
    bm.addEventListener("click", () => { writeDone(subjectKey, bmKey, !readDone(subjectKey, bmKey)); setBm(); });
    const memoBtn = el("button", "lh-cp-act", "메모");
    actions.append(bm, memoBtn);
    // Regenerate: only for a live concept (a pre-baked one is reviewed content, not a draft).
    if (!prebaked[concept.concept_id] && genSession()) {
      const regen = el("button", "lh-cp-act", CL.regenerate);
      regen.addEventListener("click", async () => {
        const hseed2 = allSeeds.find((s) => s.concept_id === concept.concept_id);
        if (!hseed2) return;
        regen.disabled = true;
        const fresh = await loadConcept(area, hseed2, true);
        stage.innerHTML = "";
        if (fresh) renderConcept(area, fresh);
        else stage.appendChild(el("div", "lh-cp-status", "이 개념은 아직 준비되지 않았습니다."));
      });
      actions.appendChild(regen);
    }
    titleRow.appendChild(actions);
    sec.appendChild(titleRow);

    const { summary, steps } = parseBody(concept.body, areaLang(concept.area));
    if (summary) sec.appendChild(el("p", "lh-cp-summary", summary));

    // 반드시 외워야 할 것 (top card — added above the concept explanation, not replacing it)
    if (concept.memorize) sec.appendChild(renderMemorize(concept.memorize, CL.memorizeTitle));

    // memo (toggled)
    const memoBox = el("div", "lh-cp-memo");
    memoBox.style.display = "none";
    const ta = document.createElement("textarea");
    ta.className = "lh-cp-memo-ta";
    ta.placeholder = "이 개념에 대한 메모를 남겨보세요…";
    ta.value = readMemo(subjectKey, concept.concept_id);
    ta.addEventListener("input", () => writeMemo(subjectKey, concept.concept_id, ta.value));
    memoBox.appendChild(ta);
    sec.appendChild(memoBox);
    memoBtn.addEventListener("click", () => { memoBox.style.display = memoBox.style.display === "none" ? "" : "none"; });

    // 개념 설명 (numbered steps) with each figure interleaved right under the sub-concept it
    // illustrates (개념 → 이미지 → 개념 → 이미지). reviewAnchor = where "개념 다시 보기" scrolls to.
    // Place each figure by anchor into its step (개념 → 이미지) or its ### sub-section (소개념 → 이미지);
    // unmatched → a 그림 자료 block after the explanation.
    const endFigs: Figure[] = [];
    const findFigTarget = (anchor: string): Block[] | null => {
      for (const st of steps) {
        if (st.title === anchor) return st.blocks;
        for (const b of st.blocks) if (b.kind === "subsec" && b.head === anchor) return b.blocks;
      }
      return null;
    };
    for (const f of concept.figures ?? []) {
      const a = (f.anchor ?? "").trim();
      const t = a && a !== "END" ? findFigTarget(a) : null;
      if (t) t.push({ kind: "fig", figure: f });
      else endFigs.push(f);
    }
    let reviewAnchor: HTMLElement = sec;
    if (steps.length) {
      const block = el("div", "lh-cp-explain");
      reviewAnchor = block;
      block.appendChild(blueLabel("개념 설명"));
      const ol = el("ol", "lh-cp-steps");
      steps.forEach((st, i) => {
        const li = el("li", "lh-cp-step");
        if (i < steps.length - 1) li.appendChild(el("div", "lh-cp-step-line"));
        li.appendChild(el("div", "lh-cp-step-num", String(i + 1)));
        const sbody = el("div", "lh-cp-step-main");
        if (st.title) sbody.appendChild(el("div", "lh-cp-step-title", st.title));
        let subN = 0;
        for (const blk of st.blocks) {
          if (blk.kind === "subsec" && blk.heading) { subN += 1; blk.num = `${i + 1}.${subN}`; }
          sbody.appendChild(renderBlock(blk));
        }
        li.appendChild(sbody);
        ol.appendChild(li);
      });
      block.appendChild(ol);
      sec.appendChild(block);
    }
    if (endFigs.length) {
      const fb = el("div", "lh-cp-figs");
      fb.appendChild(blueLabel("그림 자료"));
      for (const f of endFigs) fb.appendChild(renderFigure(f));
      sec.appendChild(fb);
    }

    // 확인 문제 (baked + generated, deletable, with a generate-more button)
    const pblock = el("div", "lh-cp-probs");
    pblock.appendChild(blueLabel("확인 문제"));
    const list = el("div", "lh-cp-prob-list");
    pblock.appendChild(list);
    const renderList = (): void => {
      list.innerHTML = "";
      const probs = conceptProblems(concept.concept_id);
      if (!probs.length) { list.appendChild(el("div", "lh-cp-status", "아직 문제가 없습니다. 아래 버튼으로 생성해 보세요.")); return; }
      probs.forEach((p, i) => list.appendChild(renderProblem(p, i + 1, subjectKey, {
        onProgress, explainLabel: CL.explain,
        onDelete: (reason) => { markDeleted(subjectKey, p.card_id); addFeedback(subjectKey, concept.concept_id, reason); renderList(); },
        onReview: (card) => reviewConcept(reviewAnchor, card),
      })));
    };
    renderList();
    // generate 5 more
    const genRow = el("div", "lh-cp-genrow");
    const genBtn = el("button", "lh-cp-genbtn", "＋ 문제 5개 생성");
    const genMsg = el("span", "lh-cp-genmsg");
    if (!aiClient) { genBtn.disabled = true; genBtn.title = "AI 미연결"; genMsg.textContent = "AI 서버 연결 시 생성할 수 있습니다."; }
    genBtn.addEventListener("click", async () => {
      genBtn.disabled = true; const label = genBtn.textContent; genBtn.textContent = "생성 중…"; genMsg.textContent = "";
      const r = await generateProblems(concept.concept_id, 5);
      genBtn.textContent = label; genBtn.disabled = false;
      if (r.ok) { genMsg.textContent = `${r.added}개 추가${r.dropped ? ` (검증 탈락 ${r.dropped})` : ""}`; renderList(); }
      else genMsg.textContent = r.error ?? "생성 실패";
    });
    genRow.append(genBtn, genMsg);
    pblock.appendChild(genRow);
    sec.appendChild(pblock);

    stage.appendChild(sec);
  }

  // Initial view. Priority: (1) a ?c= deep-link (개념 다시 보기 새 창) always wins → that concept.
  // (2) else restore the saved view so a refresh stays put: the problems page, or the last concept.
  // (3) else the first concept.
  const seedFor = (id: string): { area: AreaDef; seed: ConceptSeed } | null => {
    for (const n of index) { const s = n.concepts.find((c) => c.concept_id === id); if (s) return { area: n.area, seed: s }; }
    return null;
  };
  if (allSeeds.length) {
    let deepId: string | null = null;
    try { deepId = new URLSearchParams(window.location.search).get("c"); } catch { /* no location (test env) */ }
    const deep = deepId ? seedFor(deepId) : null;
    if (deep) {
      void selectConcept(deep.area, deep.seed);
    } else {
      const saved = readViewState(subjectKey);
      if (saved?.view === "problems" || saved?.view === "kichul") {
        setView(saved.view);
      } else {
        const restored = saved?.conceptId ? seedFor(saved.conceptId) : null;
        const first = index.find((n) => n.concepts.length);
        const target = restored ?? (first ? { area: first.area, seed: first.concepts[0] } : null);
        if (target) void selectConcept(target.area, target.seed);
      }
    }
  }
}

// ── Problem card (reference shape) ───────────────────────────────────────────
interface ProblemCtx {
  onProgress?: (r: ProgressRecord) => void;
  onDelete?: (reason: string) => void;   // when provided, the card shows a 삭제 control
  onReview?: (card: HTMLElement) => void; // "개념 다시 보기" — jump to the concept; card is passed so a "문제로 돌아가기" affordance can return to it
  explainLabel?: string;
}
function renderProblem(problem: ProblemDef, num: number, subjectKey: string, ctx?: ProblemCtx): HTMLElement {
  const onProgress = ctx?.onProgress;
  const card = el("div", "lh-cp-prob");
  card.dataset["cardId"] = problem.card_id;

  const meta = el("div", "lh-cp-prob-meta");
  meta.appendChild(el("span", "lh-cp-prob-tag", probTag(problem)));
  meta.appendChild(el("span", "lh-cp-prob-num", `문제 ${num}`));
  if (problem.source === "기출" && problem.round) {
    meta.appendChild(el("span", "lh-cp-prob-round", `${problem.round} 출제`));
  }
  meta.appendChild(el("span", "lh-cp-prob-spacer"));

  // attempt-history stack: up to 5 marks (✓ correct / ✗ wrong), oldest first.
  const histWrap = el("div", "lh-cp-hist");
  histWrap.title = "최근 5회 풀이 결과";
  const renderHist = (): void => {
    histWrap.innerHTML = "";
    const h = readHistory(subjectKey, problem.card_id);
    for (let i = 0; i < 5; i++) {
      const dot = el("span", "lh-cp-hist-dot");
      if (i < h.length) { const ok = h[i] === "correct"; dot.classList.add(ok ? "lh-cp-hist-dot--o" : "lh-cp-hist-dot--x"); dot.textContent = ok ? "✓" : "✗"; }
      else dot.classList.add("lh-cp-hist-dot--e");
      histWrap.appendChild(dot);
    }
  };
  renderHist();
  meta.appendChild(histWrap);

  // delete control (only where a handler is wired, e.g. the concept page)
  if (ctx?.onDelete) {
    const del = el("button", "lh-cp-prob-del", "삭제");
    del.title = "이 문제 삭제 (사유는 다음 생성에 반영)";
    meta.appendChild(del);
    const delBox = el("div", "lh-cp-del-box");
    delBox.style.display = "none";
    const dta = document.createElement("textarea");
    dta.className = "lh-cp-del-ta"; dta.rows = 2;
    dta.placeholder = "삭제 사유 (선택) — 다음 문제 생성 때 반영됩니다";
    const drow = el("div", "lh-cp-del-actions");
    const dok = el("button", "lh-cp-del-ok", "삭제 확정");
    const dcancel = el("button", "lh-cp-del-cancel", "취소");
    drow.append(dok, dcancel);
    delBox.append(dta, drow);
    del.addEventListener("click", () => { delBox.style.display = delBox.style.display === "none" ? "" : "none"; });
    dcancel.addEventListener("click", () => { delBox.style.display = "none"; });
    dok.addEventListener("click", () => { ctx.onDelete!(dta.value); });
    card.appendChild(meta);
    card.appendChild(delBox);
  } else {
    card.appendChild(meta);
  }

  const front = problem.front;
  const qtext = (typeof front["text"] === "string" ? front["text"] : typeof front["prompt"] === "string" ? front["prompt"] : typeof front["scenario"] === "string" ? front["scenario"] : "") as string;
  // Render the prompt through the shared component harness when it carries markdown structure
  // (보기 표·목록·콜아웃 등 가독성), else keep it as a prominent plain sentence. Cloze {{n}} → blanks.
  const isClozeQ = problem.grade_mode === "cloze";
  const qmd = isClozeQ ? qtext.replace(/\{\{\d+\}\}/g, " ( ___ ) ") : qtext;
  const hasMd = /(^|\n)\s*(#{1,6}\s|[-*]\s|\d+\.\s|>\s|\||:::|```|\$\$)/.test(qmd) || /\*\*|==|`/.test(qmd);
  const qEl = el("div", "lh-cp-prob-q");
  if (hasMd) qEl.appendChild(renderAiBody(qmd)); else qEl.textContent = qmd;
  card.appendChild(qEl);
  if (typeof front["code"] === "string" && (front["code"] as string).trim()) {
    const pre = el("pre", "lh-cp-prob-code");
    const lang = typeof front["lang"] === "string" ? (front["lang"] as string) : "";
    const code = el("code"); code.innerHTML = highlightCode(front["code"] as string, lang);
    if (lang) { code.dataset["lang"] = lang; pre.dataset["lang"] = lang; }
    pre.appendChild(code); card.appendChild(pre);
  }

  const isJudge = problem.type === "judge" && Array.isArray(front["options"]);
  const isCloze = problem.grade_mode === "cloze";
  let getAnswer: () => string | string[] = () => "";
  let answered = false;

  const verdict = el("div", "lh-cp-verdict");
  verdict.style.display = "none";

  if (isJudge) {
    const stored = front["options"] as string[];
    const opts = optionOrder(problem.card_id, stored.length).map((i) => stored[i]);   // CP-2: never stored order
    const wrap = el("div", "lh-cp-choices");
    const glyphs = ["A", "B", "C", "D", "E", "F"];
    let chosen = -1;
    const buttons: HTMLButtonElement[] = [];
    opts.forEach((opt, idx) => {
      const b = el("button", "lh-cp-choice");
      const g = el("span", "lh-cp-choice-glyph", glyphs[idx] ?? String(idx + 1));
      const t = el("span", "lh-cp-choice-text", opt);
      b.append(g, t);
      b.addEventListener("click", () => {
        if (answered) return;
        chosen = idx;
        buttons.forEach((bb, bi) => bb.classList.toggle("lh-cp-choice--sel", bi === idx));
      });
      buttons.push(b); wrap.appendChild(b);
    });
    card.appendChild(wrap);
    getAnswer = () => (chosen >= 0 ? opts[chosen] : "");
  } else if (isCloze) {
    const row = el("div", "lh-cp-short");
    const blanks = problem.answer_spec.blanks ?? [];
    const inputs: HTMLInputElement[] = [];
    blanks.forEach((_b, idx) => {
      const inp = document.createElement("input"); inp.type = "text"; inp.className = "lh-cp-input lh-cp-input--cloze";
      inp.placeholder = `빈칸 ${idx + 1}`; inp.setAttribute("aria-label", `빈칸 ${idx + 1}`);
      inputs.push(inp); row.appendChild(inp);
    });
    card.appendChild(row);
    getAnswer = () => inputs.map((i) => i.value);
  } else {
    const row = el("div", "lh-cp-short");
    const inp = document.createElement("input"); inp.type = "text"; inp.className = "lh-cp-input";
    inp.placeholder = "정답을 입력하세요"; inp.setAttribute("aria-label", "답변 입력");
    row.appendChild(inp);
    const btn = el("button", "lh-cp-check2", "확인");
    row.appendChild(btn);
    card.appendChild(row);
    getAnswer = () => inp.value;
    btn.addEventListener("click", () => doGrade());
    inp.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") doGrade(); });
  }

  // submit button for judge/cloze (short has its own inline 확인)
  if (isJudge || isCloze) {
    const btn = el("button", "lh-cp-check2 lh-cp-check2--block", "확인");
    btn.addEventListener("click", () => doGrade());
    card.appendChild(btn);
  }
  card.appendChild(verdict);

  // 정답·해설 reveal
  const revealWrap = el("div", "lh-cp-reveal-wrap");
  const revealBtn = el("button", "lh-cp-reveal-btn");
  revealBtn.innerHTML = '<span class="lh-cp-reveal-chev">▶</span> 정답·해설';
  const revealBody = el("div", "lh-cp-reveal");
  revealBody.style.display = "none";
  revealBody.appendChild(el("div", "lh-cp-reveal-k", "정답"));
  revealBody.appendChild(el("div", "lh-cp-reveal-ans", answerText(problem)));
  if (problem.explain) {
    revealBody.appendChild(el("div", "lh-cp-reveal-k", ctx?.explainLabel ?? DEFAULT_CONCEPTPROB_LABELS.explain));
    const ex = el("div", "lh-cp-reveal-explain");
    ex.appendChild(renderAiBody(problem.explain));
    revealBody.appendChild(ex);
  }
  if (ctx?.onReview) {
    const b = el("button", "lh-cp-reveal-link", "개념 다시 보기");
    b.addEventListener("click", () => ctx.onReview!(card));
    revealBody.appendChild(b);
  }
  let revealOpen = false;
  revealBtn.addEventListener("click", () => {
    revealOpen = !revealOpen;
    revealBody.style.display = revealOpen ? "" : "none";
    revealWrap.classList.toggle("lh-cp-reveal-wrap--open", revealOpen);
  });
  revealWrap.append(revealBtn, revealBody);
  card.appendChild(revealWrap);

  function doGrade(): void {
    const ans = getAnswer();
    if ((Array.isArray(ans) && ans.every((x) => !x)) || (!Array.isArray(ans) && !ans)) return;
    const result = gradeProblem(problem, ans);
    answered = true;
    verdict.style.display = "";
    verdict.dataset["verdict"] = result.verdict;
    verdict.textContent = result.verdict === "correct" ? "정답입니다" : "오답입니다";
    // mark choice states for judge
    if (isJudge) {
      const stored = front["options"] as string[];
      const opts = optionOrder(problem.card_id, stored.length).map((i) => stored[i]);   // same order as the buttons
      const norm = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim().replace(/[A-Z]/g, (c) => c.toLowerCase());
      const acc = (problem.answer_spec.accepted ?? []).map((a) => norm(a));
      const buttons = Array.from(card.querySelectorAll<HTMLButtonElement>(".lh-cp-choice"));
      buttons.forEach((bb, bi) => {
        const isCorrect = acc.includes(norm(opts[bi]));
        const isSel = bb.classList.contains("lh-cp-choice--sel");
        bb.classList.remove("lh-cp-choice--sel");
        if (isCorrect) bb.classList.add("lh-cp-choice--correct");
        else if (isSel) bb.classList.add("lh-cp-choice--wrong");
        bb.disabled = true;
      });
    }
    pushHistory(subjectKey, problem.card_id, result.verdict); renderHist();
    const rec: ProgressRecord = { module: "conceptprob", item_id: problem.card_id, verdict: result.verdict, ts: Date.now() };
    saveProgress(subjectKey, rec); onProgress?.(rec);
  }

  return card;
}
