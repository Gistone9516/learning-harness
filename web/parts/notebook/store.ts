// WHAT: the notebook's persistence layer over StoragePort (specs/web-notebook.md §2). The views call
//       these functions and never build records themselves, so the record shape has one owner.
// DEPS: web/src/storage/port, ./model.

import { makeRecord, type IndexEntry, type StoragePort } from "../../src/storage/port";
import {
  isStopword, mergeTerm, slugTerm, termSummary, threadSummary,
  type TermData, type TermInput, type TermSummary, type ThreadData, type ThreadSummary,
} from "./model";

export const TERMS = "terms";
export const THREADS = "threads";
export const META_DOC = "notebook-meta";

export interface TermEntry extends IndexEntry { summary: TermSummary & Record<string, unknown> }
export interface ThreadEntry extends IndexEntry { summary: ThreadSummary & Record<string, unknown> }

export function createNotebookStore(storage: StoragePort, stopwords: ReadonlySet<string>) {
  async function listTerms(): Promise<TermEntry[]> {
    return (await storage.list(TERMS)) as TermEntry[];
  }
  async function listThreads(): Promise<ThreadEntry[]> {
    const all = (await storage.list(THREADS)) as ThreadEntry[];
    return all.slice().sort((a, b) => (b.summary.updated ?? 0) - (a.summary.updated ?? 0));
  }
  async function getTerm(id: string): Promise<TermData | null> {
    return (await storage.get<TermData>(TERMS, id))?.data ?? null;
  }
  async function putTerm(id: string, d: TermData): Promise<boolean> {
    return storage.put(TERMS, makeRecord("term", id, termSummary(d) as unknown as Record<string, unknown>, d));
  }

  /** Merge each input into its record, one write per term (N-5, N-6). With `skipExisting`, a term already
   *  saved is left alone unless its id is `keep` (N-19). Returns the ids written. */
  async function captureTerms(inputs: TermInput[], ctx: { now: number; via: string; thread?: string; countLookup?: boolean; skipExisting?: boolean; keep?: string }): Promise<string[]> {
    const ids: string[] = [];
    if (!inputs.length) return ids;
    // One index read tells which terms exist, so a new term costs one write instead of a failed
    // read (a 404 in the console) plus a write.
    const existing = new Set((await listTerms()).map((e) => e.id));
    for (const inp of inputs) {
      if (isStopword(inp.headword, stopwords)) continue;
      const id = slugTerm(inp.headword);
      if (!id || ids.includes(id)) continue;
      if (ctx.skipExisting && existing.has(id) && id !== ctx.keep) continue;   // N-19: no re-capture of a saved term
      const merged = mergeTerm(existing.has(id) ? await getTerm(id) : null, inp, ctx);
      if (await putTerm(id, merged)) ids.push(id);
    }
    return ids;
  }

  /** Seed once per version; an existing record is never touched (N-10). */
  async function seed(version: string, terms: TermInput[], now: number): Promise<number> {
    const meta = (await storage.getDoc<{ seed_version?: string }>(META_DOC)) ?? {};
    if (meta.seed_version === version) return 0;
    const have = new Set((await listTerms()).map((e) => e.id));
    let n = 0;
    for (const t of terms) {
      const id = slugTerm(t.headword);
      if (!id || have.has(id)) continue;
      if (await putTerm(id, mergeTerm(null, t, { now, via: "seed" }))) { n++; have.add(id); }
    }
    await storage.putDoc(META_DOC, { ...meta, seed_version: version });
    return n;
  }

  async function getThread(id: string): Promise<{ title: string; data: ThreadData } | null> {
    const r = await storage.get<ThreadData>(THREADS, id);
    return r ? { title: String(r.summary["title"] ?? id), data: r.data } : null;
  }
  async function putThread(id: string, title: string, d: ThreadData, now: number): Promise<boolean> {
    return storage.put(THREADS, makeRecord("thread", id, threadSummary(title, d, now) as unknown as Record<string, unknown>, d));
  }

  return {
    listTerms, listThreads, getTerm, putTerm, captureTerms, seed, getThread, putThread,
    removeTerm: (id: string) => storage.remove(TERMS, id),
    removeThread: (id: string) => storage.remove(THREADS, id),
    getDoc: <T>(name: string) => storage.getDoc<T>(name),
    putDoc: <T>(name: string, doc: T) => storage.putDoc<T>(name, doc),
    get online() { return storage.online; },
  };
}

export type NotebookStore = ReturnType<typeof createNotebookStore>;
