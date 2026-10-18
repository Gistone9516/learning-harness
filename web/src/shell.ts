// Generic app shell (web-contract.md §1). Mounts the part named by an injected AppConfig. Carries no
// subject or instance literal: the part id, its data, and AI config all come from the consuming
// instance (or a dev fixture). This is the only place that knows the full part roster.
import { mountSheet, type SheetProblem } from "../parts/sheet/sheet";
import { mountCodeproj } from "../parts/codeproj/codeproj";
import { CONCEPT_COLLECTION, makeAbbrCollapser, mountConceptprob, type ConceptStore, type GeneratedConcept } from "../parts/conceptprob/conceptprob";
import { mountCompose, type ComposeProps } from "../parts/compose/compose";
import { composePrefillKey } from "../parts/compose/model";
import { mountQuiz, type QuizProps } from "../parts/quiz/quiz";
import { TERMS as NOTEBOOK_TERMS } from "../parts/notebook/store";
import type { TermData } from "../parts/notebook/model";
import { mountDashboard } from "../parts/dashboard/dashboard";
import { mountNotebook, notebookPrefillKey, type NotebookProps } from "../parts/notebook/notebook";
import { mountRoadmap, type RoadmapProps } from "../parts/roadmap/roadmap";
import { quizPreselect } from "../parts/quiz/bankload";
import { createAiClient, AiSession, type AiClient, type AiClientConfig } from "./ai/client";
import { createApiStorage } from "./storage/api";
import { createLocalStorage } from "./storage/local";
import { createBufferedStorage } from "./storage/buffered";
import { makeRecord, type StoragePort } from "./storage/port";
import { createStudyFlow } from "./flow/study";
import { createWorkspace } from "./flow/workspace";

export type PartId = "sheet" | "codeproj" | "conceptprob" | "dashboard" | "notebook" | "compose" | "quiz" | "roadmap";

const CONCEPTS = CONCEPT_COLLECTION;

/** State layer for instances whose records must also be readable outside the browser. */
export interface StateConfig {
  baseUrl: string;          // state API origin (same server as ai_server)
  token: string;            // AI_SERVER_TOKEN, obtained out-of-band; never bundled
  namespace: string;        // localStorage namespace for the offline buffer
}

export interface AppConfig {
  part: PartId;
  data?: unknown;           // part-specific injected data (problem / project / {areas, conceptOutline, concepts?})
  ai?: AiClientConfig;      // optional: AI parts also run from pre-baked injected content with no ai_server
  state?: StateConfig;      // optional: enables the archive/history workspace
}

/**
 * Source of truth is the state API; localStorage is the offline buffer in front of it. With no
 * state config an instance keeps working browser-only.
 */
function buildStorage(state: StateConfig): StoragePort {
  const primary = createApiStorage({ baseUrl: state.baseUrl, token: state.token });
  const buffer = createLocalStorage({ namespace: state.namespace });
  return createBufferedStorage({ primary, buffer });
}

export function mountApp(container: HTMLElement, config: AppConfig): void {
  if (config.part === "sheet") {
    mountSheet(container, config.data as SheetProblem);
    return;
  }

  if (config.part === "dashboard") {
    if (!config.state) {
      container.textContent = "이 모듈은 상태 설정(state)이 필요합니다.";
      return;
    }
    void mountDashboard(container, { storage: buildStorage(config.state) });
    return;
  }

  // AI is optional: a part can run from pre-baked injected content with no ai_server (token 0,
  // offline). The client/session are built only when ai is configured; null otherwise.
  const client = config.ai ? createAiClient(config.ai) : null;
  const session = client ? new AiSession(client) : null;
  const data = (config.data ?? {}) as Record<string, unknown>;

  if (config.part === "codeproj") {
    // The server reads repositories, so loading one needs the same client the AI calls use.
    const loadRepo = client ? client.repos : undefined;

    // With a state layer the part runs inside the workspace (archive, history); without one it is
    // the plain single-project view.
    if (config.state) {
      const flow = createStudyFlow({ storage: buildStorage(config.state) });
      const workspace = createWorkspace({
        container,
        flow,
        // A fresh session per project: loading puts the codebase in once, then follow-ups resume.
        newSession: () => (client ? new AiSession(client) : null),
        loadRepo,
      });
      void workspace.showLauncher();
      return;
    }

    const project = data.project as never;
    if (!session && !project) {
      container.textContent = "이 모듈은 AI 설정(ai_server) 또는 미리 준비된 프로젝트가 필요합니다.";
      return;
    }
    mountCodeproj(container, { session, project, loadRepo });
  } else if (config.part === "conceptprob") {
    const concepts = data.concepts as Record<string, unknown> | undefined;
    const hasPrebaked = !!concepts && Object.keys(concepts).length > 0;
    if (!session && !hasPrebaked) {
      container.textContent = "이 모듈은 AI 설정(ai_server) 또는 사전 생성 개념이 필요합니다.";
      return;
    }
    void mountConceptprobWithState(container, data, client, session, config.state ? buildStorage(config.state) : null);
  } else if (config.part === "notebook") {
    if (!config.state) {
      container.textContent = "이 모듈은 상태 설정(state)이 필요합니다.";
      return;
    }
    mountNotebook(container, {
      ...(data as unknown as Omit<NotebookProps, "storage" | "aiClient">),
      storage: buildStorage(config.state),
      aiClient: client,
      useTerm: wordsTo(data.useTermIn, data.subjectKey),
    });
  } else if (config.part === "compose") {
    if (!config.state) {
      container.textContent = "이 모듈은 상태 설정(state)이 필요합니다.";
      return;
    }
    mountCompose(container, {
      ...(data as unknown as Omit<ComposeProps, "storage" | "aiClient">),
      storage: buildStorage(config.state),
      aiClient: client,
    });
  } else if (config.part === "quiz") {
    if (!config.state) {
      container.textContent = "이 모듈은 상태 설정(state)이 필요합니다.";
      return;
    }
    void mountQuizWithState(container, data, client, buildStorage(config.state));
  } else if (config.part === "roadmap") {
    if (!config.state) {
      container.textContent = "이 모듈은 상태 설정(state)이 필요합니다.";
      return;
    }
    void mountRoadmapWithState(container, data, client, buildStorage(config.state));
  } else {
    container.textContent = "unknown part";
  }
}

/**
 * conceptprob with an optional state layer. `data.outlineDoc` names the state doc that owns the
 * curriculum (N-11): it wins over injected areas, and injected areas seed it only when it is absent.
 * `data.persistConcepts` keeps live-generated concepts in the state API (N-12). Without a state layer
 * or those keys, the part mounts exactly as before.
 */
async function mountConceptprobWithState(
  container: HTMLElement,
  data: Record<string, unknown>,
  client: AiClient | null,
  session: AiSession | null,
  storage: StoragePort | null,
): Promise<void> {
  const { areas, conceptOutline } = await syncOutline(data, storage);
  const conceptStore: ConceptStore | undefined = storage && data.persistConcepts
    ? {
        load: async (id) => (await storage.get<GeneratedConcept>(CONCEPTS, id))?.data ?? null,
        save: async (c) => {
          await storage.put(CONCEPTS, makeRecord("concept", c.concept_id, { title: c.title, area: c.area }, c));
        },
      }
    : undefined;
  mountConceptprob(container, {
    session,
    aiClient: client,
    areas,
    conceptOutline,
    concepts: data.concepts as never,
    subjectKey: data.subjectKey as string | undefined,
    courseTitle: data.courseTitle as string | undefined,
    labels: data.labels as never,
    author: data.author as never,
    conceptStore,
    problemStyle: data.problemStyle as string | undefined,
    askElsewhere: handoffTo(data.askElsewhere, data.subjectKey),
    rewriteFront: data.collapseAbbreviations ? await abbreviationCollapser(data, storage) : undefined,
  });
}

/**
 * The curriculum outline (N-11): the state doc `data.outlineDoc` wins over injected areas, and injected
 * areas seed the doc only when it is absent. Shared by every part that reads the outline.
 */
async function syncOutline(data: Record<string, unknown>, storage: StoragePort | null): Promise<{ areas: never[]; conceptOutline: Record<string, never[]> }> {
  let areas = (data.areas as never[] | undefined) ?? [];
  let conceptOutline = (data.conceptOutline as Record<string, never[]> | undefined) ?? {};
  const outlineDoc = typeof data.outlineDoc === "string" ? data.outlineDoc : null;
  if (storage && outlineDoc) {
    const doc = await storage.getDoc<{ areas?: never[]; conceptOutline?: Record<string, never[]> }>(outlineDoc);
    if (doc && Array.isArray(doc.areas)) {
      areas = doc.areas;
      conceptOutline = doc.conceptOutline ?? {};
    } else if (areas.length) {
      await storage.putDoc(outlineDoc, { areas, conceptOutline });
    }
  }
  return { areas, conceptOutline };
}

/** quiz needs the outline doc to exist; it is seeded here exactly as for conceptprob. */
async function mountQuizWithState(container: HTMLElement, data: Record<string, unknown>, client: AiClient | null, storage: StoragePort): Promise<void> {
  const outlineDoc = typeof data.outlineDoc === "string" ? data.outlineDoc : "outline";
  await syncOutline({ ...data, outlineDoc }, storage);
  mountQuiz(container, {
    ...(data as unknown as Omit<QuizProps, "storage" | "aiClient" | "outline" | "rewriteFront" | "askElsewhere">),
    storage,
    aiClient: client,
    outline: { doc: outlineDoc },
    askElsewhere: handoffTo(data.askElsewhere, data.subjectKey),
    rewriteFront: data.collapseAbbreviations ? await abbreviationCollapser(data, storage) : undefined,
  });
}

/**
 * roadmap (specs/web-roadmap.md): the outline doc is seeded exactly as for quiz, and the links in
 * `data.links` become the two handoffs (RM-8) -- the quiz opened on the step's unit, the notebook prefilled.
 */
async function mountRoadmapWithState(container: HTMLElement, data: Record<string, unknown>, client: AiClient | null, storage: StoragePort): Promise<void> {
  const outlineDoc = (data.outline as { doc?: string } | undefined)?.doc ?? "outline";
  await syncOutline({ ...data, outlineDoc }, storage);
  const subjectKey = typeof data.subjectKey === "string" ? data.subjectKey : "roadmap";
  const links = (data.links ?? {}) as { quiz?: { hash?: unknown; label?: unknown }; notebook?: { hash?: unknown; label?: unknown } };
  const quiz = links.quiz && typeof links.quiz.hash === "string" ? links.quiz : null;
  mountRoadmap(container, {
    ...(data as unknown as Omit<RoadmapProps, "storage" | "aiClient" | "solve" | "ask">),
    storage,
    aiClient: client,
    subjectKey,
    outline: { doc: outlineDoc },
    solve: quiz
      ? {
          label: typeof quiz.label === "string" ? quiz.label : "문제 풀기",
          run: (unit, hasProblems) => {
            quizPreselect(subjectKey, [unit], hasProblems ? "play" : "bank");
            window.location.hash = quiz.hash as string;
          },
        }
      : undefined,
    ask: handoffTo(links.notebook ? { label: links.notebook.label ?? "질문하기", hash: links.notebook.hash } : undefined, subjectKey),
  });
}

/** `data.useTermIn = {label, hash}`: a dictionary entry hands its headword to compose (W-11). */
function wordsTo(cfg: unknown, subjectKey: unknown): { label: string; run: (headword: string) => void } | undefined {
  const c = cfg as { label?: unknown; hash?: unknown } | undefined;
  if (!c || typeof c.label !== "string" || typeof c.hash !== "string") return undefined;
  const key = composePrefillKey(typeof subjectKey === "string" ? subjectKey : "compose");
  const hash = c.hash;
  return {
    label: c.label,
    run: (headword) => {
      try { localStorage.setItem(key, JSON.stringify({ words: [headword] })); } catch { /* private mode */ }
      window.location.hash = hash;
    },
  };
}

/**
 * `data.collapseAbbreviations`: build the front rewrite from every known abbreviation — the injected
 * `data.seed.terms` plus the notebook dictionary in the state API, so one the learner saved later is
 * covered too. Without any pairs there is nothing to rewrite.
 */
async function abbreviationCollapser(data: Record<string, unknown>, storage: StoragePort | null): Promise<((s: string) => string) | undefined> {
  const pairs: { abbr: string; expansion: string }[] = [];
  const seedTerms = ((data.seed as { terms?: unknown[] } | undefined)?.terms ?? []) as { headword?: string; type?: string; expansion?: string }[];
  for (const t of seedTerms) if (t.type === "acronym" && t.headword && t.expansion) pairs.push({ abbr: t.headword, expansion: t.expansion });
  if (storage) {
    const acronyms = (await storage.list(NOTEBOOK_TERMS)).filter((e) => e.summary["type"] === "acronym");
    for (const e of acronyms) {
      const d = (await storage.get<TermData>(NOTEBOOK_TERMS, e.id))?.data;
      if (d?.expansion) pairs.push({ abbr: d.headword, expansion: d.expansion });
    }
  }
  return pairs.length ? makeAbbrCollapser(pairs) : undefined;
}

/**
 * `data.askElsewhere = {label, hash}`: a selection is handed to the notebook of the same subject by
 * leaving it where the notebook looks on mount (notebookPrefillKey) and switching the host view.
 */
function handoffTo(cfg: unknown, subjectKey: unknown): { label: string; onAsk: (t: string) => void } | undefined {
  const c = cfg as { label?: unknown; hash?: unknown } | undefined;
  if (!c || typeof c.label !== "string" || typeof c.hash !== "string") return undefined;
  const key = notebookPrefillKey(typeof subjectKey === "string" ? subjectKey : "notebook");
  const hash = c.hash;
  return {
    label: c.label,
    onAsk: (text) => {
      try { localStorage.setItem(key, text); } catch { /* private mode: the switch still happens */ }
      window.location.hash = hash;
    },
  };
}
