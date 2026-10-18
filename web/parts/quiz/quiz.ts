// WHAT: quiz part -- problem drilling: a bank built from concept records + generated problems, sets by
//       unit / source / count, practice and timed exam modes, a per-problem language toggle (translated once,
//       stored), flags, deletion with feedback, results, and generation through /problems.
// DEPS: web/src/ai/client, web/src/storage/port, web/src/ui/tabs, ../conceptprob (types, gradeProblem,
//       readGenerated), ./model, ./card, ./play, ./bank.
// INPUT: QuizProps (specs/web-quiz.md). Outline from a state doc; wording via labels / translate / problemStyle.
// EVENTS: doc "quiz-log" (verdicts, flags, deletions); collection "problems" (generated + translations).
// AI: optional -- grading is token 0; generation and translation need ai_server.
// CONSTRAINTS: subject-agnostic, secrets-gated, state-backed, token0-grading, binary.
// DEMO: mountQuiz(el, {storage: memory, aiClient: null, outline: {doc: "outline"}}) with an outline doc.

import type { AiClient, AiEffort } from "../../src/ai/client";
import { makeRecord, type StoragePort } from "../../src/storage/port";
import { buildTabbedLayout } from "../../src/ui/tabs";
import { CONCEPT_COLLECTION, readGenerated, type GeneratedConcept } from "../conceptprob/conceptprob";
import {
  assembleBank, coerceQuizProblem, LOG_DOC, PROBLEMS,
  type ProblemSet, type QuizLog, type QuizProblem,
} from "./model";
import { mountPlay } from "./play";
import { mountBank } from "./bank";

export const DEFAULT_QUIZ_LABELS = {
  tabPlay: "풀기",
  tabBank: "문제 은행",
  units: "단원",
  allUnits: "전체",
  source: "범위",
  sources: { all: "전체", unseen: "안 푼 문제", wrong: "틀린 문제", flagged: "표시한 문제" } as Record<string, string>,
  count: "문항 수",
  mode: "방식",
  modes: { practice: "연습 (바로 채점)", exam: "모의시험 (끝나고 채점)" } as Record<string, string>,
  start: "시작",
  available: "풀 수 있는 문제",
  none: "조건에 맞는 문제가 없습니다. 문제 은행에서 문제를 생성하세요.",
  progress: "진행",
  prev: "이전",
  next: "다음",
  submit: "확인",
  finish: "끝내고 채점",
  quit: "그만두기",
  timeLeft: "남은 시간",
  correct: "정답",
  incorrect: "오답",
  verdictRight: "✓ 맞았습니다",
  verdictWrong: "✗ 틀렸습니다",
  pickFirst: "보기를 먼저 선택하세요.",
  typeFirst: "답을 먼저 입력하세요.",
  startN: "{n}문제 시작",
  toBank: "문제 은행으로",
  answer: "정답",
  explain: "해설",
  langPrimary: "원문",
  langSecondary: "번역",
  translating: "번역 중…",
  translateFail: "번역하지 못했습니다",
  flag: "표시",
  unflag: "표시 해제",
  ask: "이 문제 질문하기",
  deleteProblem: "삭제",
  deleteReason: "삭제 사유 (다음 생성에 반영)",
  deleteConfirm: "삭제 확정",
  answerPlaceholder: "답 입력",
  blank: "빈칸",
  results: "결과",
  score: "점수",
  byUnit: "단원별",
  wrongList: "틀린 문제",
  retryWrong: "틀린 것만 다시 풀기",
  newSet: "새 세트",
  keys: "1-4 보기 선택 · Enter 확인/다음 · T 원문/번역",
  bankTotal: "문제",
  bankSeen: "푼 문제",
  bankAccuracy: "정답률",
  generate: "5문제 생성",
  generating: "생성 중…",
  fillUnit: "빈 개념 채우기",
  filling: "채우는 중",
  drill: "이 개념 풀기",
  genFail: "생성 실패",
  aiOff: "AI 서버가 연결되지 않아 생성과 번역은 쓸 수 없습니다. 풀기와 채점은 됩니다.",
  offline: "저장 서버에 연결할 수 없습니다. 연결되면 다시 시도하세요.",
  loading: "문제 은행 불러오는 중…",
};
export type QuizLabels = typeof DEFAULT_QUIZ_LABELS;

export interface QuizProps {
  storage: StoragePort;
  aiClient: AiClient | null;
  subjectKey?: string;
  courseTitle?: string;
  outline: { doc: string };
  labels?: Partial<QuizLabels>;
  translate?: { system: string; model?: string; effort?: AiEffort };
  problemStyle?: string;
  counts?: number[];                 // default [10, 20, 65]
  secondsPerItem?: number;           // exam timer, default 120
  fillTarget?: number;               // "fill unit" generates for concepts with fewer problems, default 5
  rewriteFront?: (s: string) => string;
  askElsewhere?: { label: string; onAsk: (text: string) => void };
}

type Outline = { areas: { key: string; label: string }[]; conceptOutline: Record<string, { concept_id: string; title: string }[]> };

export interface QuizCtx {
  props: QuizProps;
  L: QuizLabels;
  ai: AiClient | null;
  now: () => number;
  bank: () => QuizProblem[];
  byId: (id: string) => QuizProblem | undefined;
  outline: () => Outline;
  areaLabel: (key: string) => string;
  conceptTitle: (id: string) => string;
  conceptBody: (id: string) => string;
  log: () => QuizLog;
  saveLog: (next: QuizLog) => Promise<void>;
  getSet: (conceptId: string) => Promise<ProblemSet>;
  putSet: (conceptId: string, set: ProblemSet) => Promise<boolean>;
  reload: () => Promise<void>;
  drill: (ids: string[]) => void;
  goBank: () => void;
  remember: (key: string, value: string | null) => void;
  recall: (key: string) => string | null;
}

export function mountQuiz(container: HTMLElement, props: QuizProps): void {
  const L: QuizLabels = {
    ...DEFAULT_QUIZ_LABELS, ...(props.labels ?? {}),
    sources: { ...DEFAULT_QUIZ_LABELS.sources, ...(props.labels?.sources ?? {}) },
    modes: { ...DEFAULT_QUIZ_LABELS.modes, ...(props.labels?.modes ?? {}) },
  };
  const ns = props.subjectKey ?? "quiz";
  const lsKey = (k: string) => `lh:${ns}:quiz:${k}`;
  const storage = props.storage;
  const layout = buildTabbedLayout(container, "lh-nb lh-qz", [
    { id: "play", label: L.tabPlay },
    { id: "bank", label: L.tabBank },
  ], L.offline, (id) => go(id));

  let outline: Outline = { areas: [], conceptOutline: {} };
  let concepts: Record<string, GeneratedConcept | null> = {};
  let sets: Record<string, ProblemSet | null> = {};
  let log: QuizLog = { items: {} };
  let bank: QuizProblem[] = [];
  let index = new Map<string, QuizProblem>();

  const emptySet = (): ProblemSet => ({ generated: [], ko: {} });
  const ctx: QuizCtx = {
    props, L, ai: props.aiClient,
    now: () => Date.now(),
    bank: () => bank,
    byId: (id) => index.get(id),
    outline: () => outline,
    areaLabel: (k) => outline.areas.find((a) => a.key === k)?.label ?? k,
    conceptTitle: (id) => Object.values(outline.conceptOutline).flat().find((s) => s.concept_id === id)?.title ?? id,
    conceptBody: (id) => concepts[id]?.body ?? "",
    log: () => log,
    saveLog: async (next) => { log = next; await storage.putDoc(LOG_DOC, log); },
    getSet: async (cid) => sets[cid] ?? (sets[cid] = (await storage.get<ProblemSet>(PROBLEMS, cid))?.data ?? emptySet()),
    putSet: async (cid, set) => {
      sets[cid] = set;
      return storage.put(PROBLEMS, makeRecord("problem-set", cid, { generated: set.generated.length, translated: Object.keys(set.ko).length }, set));
    },
    reload: () => load(),
    drill: (ids) => { go("play"); play.startWith(ids); },
    goBank: () => go("bank"),
    remember: (k, v) => { try { if (v === null) localStorage.removeItem(lsKey(k)); else localStorage.setItem(lsKey(k), v); } catch { /* private mode */ } },
    recall: (k) => { try { return localStorage.getItem(lsKey(k)); } catch { return null; } },
  };

  const play = mountPlay(layout.panes.get("play")!, ctx);
  const bankView = mountBank(layout.panes.get("bank")!, ctx);

  /** Move problems an older conceptprob kept only in this browser into the state API, once. */
  async function migrateBrowserProblems(): Promise<void> {
    for (const a of outline.areas) {
      for (const seed of outline.conceptOutline[a.key] ?? []) {
        const local = readGenerated(ns, seed.concept_id);
        if (!local.length) continue;
        const set = await ctx.getSet(seed.concept_id);
        const have = new Set(set.generated.map((p) => p.card_id));
        const add = local.map((p) => coerceQuizProblem(p, a.key, seed.concept_id)).filter((p): p is QuizProblem => !!p && !have.has(p.card_id));
        if (add.length) await ctx.putSet(seed.concept_id, { ...set, generated: set.generated.concat(add) });
      }
    }
  }

  async function load(): Promise<void> {
    outline = (await storage.getDoc<Outline>(props.outline.doc)) ?? { areas: [], conceptOutline: {} };
    outline = { areas: outline.areas ?? [], conceptOutline: outline.conceptOutline ?? {} };
    log = (await storage.getDoc<QuizLog>(LOG_DOC)) ?? { items: {} };
    if (!log.items) log = { items: {} };
    const conceptIds = new Set((await storage.list(CONCEPT_COLLECTION)).map((e) => e.id));
    const setIds = new Set((await storage.list(PROBLEMS)).map((e) => e.id));
    concepts = {}; sets = {};
    for (const seed of Object.values(outline.conceptOutline).flat()) {
      if (conceptIds.has(seed.concept_id)) concepts[seed.concept_id] = (await storage.get<GeneratedConcept>(CONCEPT_COLLECTION, seed.concept_id))?.data ?? null;
      if (setIds.has(seed.concept_id)) sets[seed.concept_id] = (await storage.get<ProblemSet>(PROBLEMS, seed.concept_id))?.data ?? null;
    }
    if (ctx.recall("migrated") !== "1") { await migrateBrowserProblems(); ctx.remember("migrated", "1"); }
    bank = assembleBank(outline, concepts, sets, log);
    index = new Map(bank.map((p) => [p.card_id, p]));
    layout.setCount("bank", bank.length ? String(bank.length) : "");
    layout.banner.hidden = storage.online;
  }

  function go(tab: string): void {
    if (!layout.show(tab)) return;
    ctx.remember("tab", tab);
    if (tab === "bank") bankView.refresh(); else play.refresh();
  }

  void (async () => {
    await load();
    const saved = ctx.recall("tab");
    go(saved === "bank" ? "bank" : "play");
  })();
}
