// In-memory StoragePort for part tests (not a test file itself; vitest only runs *.test.ts).
import type { IndexEntry, StoragePort, StorageRecord } from "../src/storage/port";

export type MemoryStorage = StoragePort & { cols: Map<string, Map<string, StorageRecord>>; docs: Map<string, unknown> };

export function memoryStorage(): MemoryStorage {
  const cols = new Map<string, Map<string, StorageRecord>>();
  const docs = new Map<string, unknown>();
  const col = (c: string) => cols.get(c) ?? (cols.set(c, new Map()), cols.get(c)!);
  let t = 0;
  return {
    cols, docs, online: true,
    async list(c) {
      return Array.from(col(c).values()).map((r): IndexEntry => ({ id: r.id, kind: r.kind, created_at: r.created_at ?? 0, updated_at: r.updated_at ?? 0, summary: r.summary }));
    },
    async get<T>(c: string, id: string) { return (col(c).get(id) as StorageRecord<T> | undefined) ?? null; },
    async put(c, r) { const prev = col(c).get(r.id); col(c).set(r.id, JSON.parse(JSON.stringify({ ...r, created_at: prev?.created_at ?? ++t, updated_at: ++t }))); return true; },
    async remove(c, id) { return col(c).delete(id); },
    async getDoc<T>(n: string) { return (docs.get(n) as T | undefined) ?? null; },
    async putDoc(n, d) { docs.set(n, JSON.parse(JSON.stringify(d))); return true; },
  };
}
