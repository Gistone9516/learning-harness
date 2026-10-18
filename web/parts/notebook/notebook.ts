// WHAT: notebook part -- ask anything, keep every thread, collect terms into a dictionary, review them
//       with Leitner scheduling, and edit the curriculum outline that conceptprob reads.
// DEPS: web/src/ai/client, web/src/storage/port, web/src/doc/doc, ./model, ./store, ./ask, ./dict, ./review, ./outline.
// INPUT: NotebookProps (specs/web-notebook.md §4). Subject wording arrives only through labels + ask.system.
// CONSTRAINTS: subject-agnostic (N-1), secrets-gated, state-backed.

import type { AiClient, AiEffort } from "../../src/ai/client";
import type { StoragePort } from "../../src/storage/port";
import { buildTabbedLayout } from "../../src/ui/tabs";
import { isDue, type TermInput } from "./model";
import { createNotebookStore, type NotebookStore } from "./store";
import { mountAsk } from "./ask";
import { mountDict } from "./dict";
import { mountReview } from "./review";
import { mountOutline } from "./outline";

export const DEFAULT_LABELS = {
  tabAsk: "질문",
  tabDict: "용어집",
  tabReview: "복습",
  tabOutline: "단원",
  newThread: "새 질문",
  threadSearch: "지난 질문 검색",
  threadsEmpty: "아직 질문이 없습니다.",
  askEmpty: "질문을 입력하면 답변과 함께 용어가 자동으로 저장됩니다.",
  askPlaceholder: "궁금한 것을 입력하세요 (Ctrl+Enter로 보내기)",
  followPlaceholder: "이어서 질문하세요 (Ctrl+Enter로 보내기)",
  send: "보내기",
  sendHint: "Ctrl+Enter로 보내기",
  reviewKeys: "Enter 채점 · 모르면 뜻 보기",
  reviewKeysAfter: "Enter 다음 · E 예문 원문/번역",
  reviewInput: "뜻을 입력하세요",
  reviewSubmit: "확인",
  reviewGrading: "채점 중…",
  reviewNext: "다음",
  reviewCorrect: "맞았어요",
  reviewIncorrect: "틀렸어요",
  reviewUngraded: "채점하지 못했습니다. 복습 기록은 그대로 둡니다.",
  exampleLangPrimary: "원문",
  exampleLangSecondary: "번역",
  exampleLangKey: "E 키로 전환",
  pending: "답변 생성 중…",
  captured: "저장된 용어",
  deleteThread: "질문 삭제",
  confirmDelete: "한 번 더 누르면 삭제됩니다",
  aiOff: "AI 서버가 연결되지 않았습니다. ai_server 실행과 토큰 설정을 확인하세요.",
  aiError: "답변을 받지 못했습니다",
  offline: "저장 서버에 연결할 수 없습니다. 연결되면 다시 시도하세요.",
  dictSearch: "검색",
  dictEmpty: "저장된 용어가 없습니다.",
  dictPick: "왼쪽 목록에서 항목을 고르세요.",
  filterAll: "전체",
  includeKnown: "외운 것 포함",
  sortRecent: "최근순",
  sortLookups: "조회순",
  sortAlpha: "ABC순",
  lookups: "조회",
  box: "상자",
  nextDue: "다음 복습",
  expansion: "원어",
  senses: "뜻",
  examples: "예문",
  related: "관련",
  threadsOf: "나온 질문",
  markKnown: "외웠어요",
  unmarkKnown: "다시 복습하기",
  askAbout: "이 항목으로 질문",
  deleteTerm: "삭제",
  known: "외움",
  reviewEmpty: "지금 복습할 항목이 없습니다.",
  reviewShow: "뜻 보기",
  reviewWrong: "몰랐어요",
  reviewDone: "이번 복습을 마쳤습니다.",
  reviewLeft: "남음",
  outlineTitle: "학습 단원",
  outlineHelp: "여기서 고친 단원과 개념이 학습 화면의 목차가 됩니다.",
  addUnit: "단원 추가",
  unitName: "새 단원 이름",
  addConcepts: "추가할 개념 (한 줄에 하나, 아래 저장을 누르면 반영)",
  propose: "AI로 개념 목록 제안",
  proposing: "제안 받는 중…",
  removeUnit: "단원 삭제",
  removeConcept: "빼기",
  save: "저장",
  saved: "저장했습니다. 학습 화면을 다시 열면 반영됩니다.",
  saveFailed: "저장하지 못했습니다.",
  types: { word: "어휘", phrase: "구", acronym: "약어", sentence: "문장", question: "질문" } as Record<string, string>,
  domains: { general: "일반", subject: "전공" } as Record<string, string>,
};
export type NotebookLabels = typeof DEFAULT_LABELS;

export interface NotebookProps {
  storage: StoragePort;
  aiClient: AiClient | null;
  ask: { system: string; model?: string; effort?: AiEffort };
  subjectKey?: string;
  labels?: Partial<NotebookLabels>;
  stopwords?: string[];
  seed?: { version: string; terms: TermInput[] };
  outline?: { doc: string; propose?: { system: string; model?: string } };
  srs?: { intervalsDays?: Record<number, number> };
  review?: { system: string; model?: string; effort?: AiEffort };   // N-20: AI grading of typed meanings
  useTerm?: { label: string; run: (headword: string) => void };   // extra action on a dictionary entry
}

type Tab = "ask" | "dict" | "review" | "outline";

/** Where another part leaves text for the ask box (read and cleared on mount). One definition, shared. */
export function notebookPrefillKey(subjectKey: string): string {
  return `lh:${subjectKey}:notebook:prefill`;
}

/** What the views share: the store, the AI, the labels, and a way to steer each other. */
export interface NotebookCtx {
  store: NotebookStore;
  ai: AiClient | null;
  props: NotebookProps;
  L: NotebookLabels;
  now: () => number;
  go: (tab: Tab) => void;
  openTerm: (id: string) => void;
  openThread: (id: string) => void;
  prefillAsk: (text: string) => void;
  refreshCounts: () => void;
  remember: (key: string, value: string | null) => void;
  recall: (key: string) => string | null;
}

export function mountNotebook(container: HTMLElement, props: NotebookProps): void {
  const L: NotebookLabels = {
    ...DEFAULT_LABELS,
    ...(props.labels ?? {}),
    types: { ...DEFAULT_LABELS.types, ...(props.labels?.types ?? {}) },
    domains: { ...DEFAULT_LABELS.domains, ...(props.labels?.domains ?? {}) },
  };
  const ns = props.subjectKey ?? "notebook";
  const store = createNotebookStore(props.storage, new Set((props.stopwords ?? []).map((w) => w.toLowerCase())));
  const lsKey = (k: string) => `lh:${ns}:notebook:${k}`;

  const tabDefs: { id: Tab; label: string }[] = [
    { id: "ask", label: L.tabAsk },
    { id: "dict", label: L.tabDict },
    { id: "review", label: L.tabReview },
    ...(props.outline ? [{ id: "outline" as Tab, label: L.tabOutline }] : []),
  ];
  const layout = buildTabbedLayout(container, "lh-nb", tabDefs, L.offline, (id) => go(id as Tab));
  const panes = layout.panes;

  const ctx: NotebookCtx = {
    store,
    ai: props.aiClient,
    props,
    L,
    now: () => Date.now(),
    go: (tab) => go(tab),
    openTerm: (id) => { go("dict"); dict.open(id); },
    openThread: (id) => { go("ask"); void ask.open(id); },
    prefillAsk: (text) => { go("ask"); ask.prefill(text); },
    refreshCounts: () => void refreshCounts(),
    remember: (k, v) => { try { if (v === null) localStorage.removeItem(lsKey(k)); else localStorage.setItem(lsKey(k), v); } catch { /* private mode */ } },
    recall: (k) => { try { return localStorage.getItem(lsKey(k)); } catch { return null; } },
  };

  const ask = mountAsk(panes.get("ask")!, ctx);
  const dict = mountDict(panes.get("dict")!, ctx);
  const rev = mountReview(panes.get("review")!, ctx);
  const outlinePane = panes.get("outline");
  const outline = outlinePane ? mountOutline(outlinePane, ctx) : null;

  function go(tab: Tab): void {
    if (!panes.has(tab)) tab = "ask";
    if (!layout.show(tab)) return;
    ctx.remember("tab", tab);
    if (tab === "dict") void dict.refresh();
    else if (tab === "review") void rev.start();
    else if (tab === "outline") void outline?.load();
    else void ask.refreshList();
  }

  async function refreshCounts(): Promise<void> {
    const terms = await store.listTerms();
    const now = ctx.now();
    layout.setCount("dict", terms.length ? String(terms.length) : "");
    const due = terms.filter((t) => isDue(t.summary, now)).length;
    layout.setCount("review", due ? String(due) : "");
    layout.setFlag("review", "lh-nb-tab--due", due > 0);
    layout.banner.hidden = store.online;
  }

  void (async () => {
    if (props.seed?.terms?.length) await store.seed(props.seed.version, props.seed.terms, ctx.now());
    await refreshCounts();
  })();
  const saved = ctx.recall("tab") as Tab | null;
  let handed: string | null = null;
  try { handed = localStorage.getItem(notebookPrefillKey(ns)); localStorage.removeItem(notebookPrefillKey(ns)); } catch { /* private mode */ }
  if (handed) ctx.prefillAsk(handed);
  else go(saved && panes.has(saved) ? saved : "ask");
}
