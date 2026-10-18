// WHAT: reads what the quiz bank is made of from the state API -- the outline doc, the answer log, concept
//       records and generated problem sets -- and the localStorage keys of the quiz view. Shared by the quiz
//       part and by any view that must count the same problems (roadmap, RM-5), so the two cannot disagree.
// DEPS: web/src/storage/port, ../conceptprob (CONCEPT_COLLECTION), ./model.
// AI: none.

import type { StoragePort } from "../../src/storage/port";
import { CONCEPT_COLLECTION, type GeneratedConcept } from "../conceptprob/conceptprob";
import { assembleBank, LOG_DOC, PROBLEMS, type ProblemSet, type QuizLog, type QuizProblem } from "./model";

export type Outline = { areas: { key: string; label: string }[]; conceptOutline: Record<string, { concept_id: string; title: string }[]> };

export interface BankParts {
  outline: Outline;
  log: QuizLog;
  concepts: Record<string, GeneratedConcept | null>;
  sets: Record<string, ProblemSet | null>;
}

export async function loadBankParts(storage: StoragePort, outlineDoc: string): Promise<BankParts> {
  const [doc, rawLog, conceptIndex, setIndex] = await Promise.all([
    storage.getDoc<Outline>(outlineDoc), storage.getDoc<QuizLog>(LOG_DOC), storage.list(CONCEPT_COLLECTION), storage.list(PROBLEMS),
  ]);
  const outline: Outline = { areas: doc?.areas ?? [], conceptOutline: doc?.conceptOutline ?? {} };
  const log: QuizLog = rawLog && rawLog.items ? rawLog : { items: {} };
  const conceptIds = new Set(conceptIndex.map((e) => e.id));
  const setIds = new Set(setIndex.map((e) => e.id));
  const concepts: BankParts["concepts"] = {};
  const sets: BankParts["sets"] = {};
  // Every record at once (web-contract §5): one round trip each over a tunnel, so a sequential loop is the page's load time.
  const ids = Object.values(outline.conceptOutline).flat().map((s) => s.concept_id);
  await Promise.all(ids.flatMap((id) => [
    conceptIds.has(id) ? storage.get<GeneratedConcept>(CONCEPT_COLLECTION, id).then((r) => { concepts[id] = r?.data ?? null; }) : null,
    setIds.has(id) ? storage.get<ProblemSet>(PROBLEMS, id).then((r) => { sets[id] = r?.data ?? null; }) : null,
  ]));
  return { outline, log, concepts, sets };
}

/** The bank exactly as the quiz builds it (Q-2). */
export async function loadBank(storage: StoragePort, outlineDoc: string): Promise<{ parts: BankParts; bank: QuizProblem[] }> {
  const parts = await loadBankParts(storage, outlineDoc);
  return { parts, bank: assembleBank(parts.outline, parts.concepts, parts.sets, parts.log) };
}

/** localStorage key of one quiz view setting (units, tab, set, ...). One definition: quiz and its callers. */
export function quizStateKey(subjectKey: string | undefined, key: string): string {
  return `lh:${subjectKey ?? "quiz"}:quiz:${key}`;
}

/**
 * Open the quiz on given units next time it mounts (RM-8): select them and a tab -- play, or the bank when
 * the units have no problem yet (the play builder drops an empty unit from its selection). A set still in
 * progress is kept, because dropping it would lose the learner's answers; a finished one is cleared so the
 * builder shows.
 */
export function quizPreselect(subjectKey: string | undefined, units: string[], tab: "play" | "bank" = "play"): void {
  try {
    localStorage.setItem(quizStateKey(subjectKey, "units"), JSON.stringify(units));
    localStorage.setItem(quizStateKey(subjectKey, "tab"), tab);
    const raw = localStorage.getItem(quizStateKey(subjectKey, "set"));
    const set = raw ? (JSON.parse(raw) as { finished?: boolean } | null) : null;
    if (set && set.finished) localStorage.removeItem(quizStateKey(subjectKey, "set"));
  } catch { /* private mode: the quiz opens with its own defaults */ }
}
