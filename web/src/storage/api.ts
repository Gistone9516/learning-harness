// State API adapter (web-contract.md §2.2): the source-of-truth medium behind StoragePort.
// Talks to the gated local server, which owns the record files and their derived index. The token
// comes from runtime config and is never bundled. fetch is injectable for tests.
//
// Two things keep a remote page from paying one round trip per read (web-contract §5):
// reads issued in the same task go out as one POST /state/_batch, and a boot snapshot (docs and
// indexes taken when the page was served) answers the first reads of docs and collection listings.

import type { IndexEntry, StoragePort, StorageRecord } from "./port";
import { isValidName } from "./port";

/** `/state/_snapshot` as the page received it. */
export interface StateSnapshot {
  docs: Record<string, unknown>;
  indexes: Record<string, { entries?: IndexEntry[] } | null | undefined>;
}

export interface ApiStorageConfig {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  /** Notified whenever reachability flips, so the shell can show one notice instead of polling. */
  onOnlineChange?: (online: boolean) => void;
  snapshot?: StateSnapshot | null;
}

type Read = { doc: string } | { list: string } | { get: [string, string] };
interface Pending { read: Read; path: string; field: "doc" | "index" | "record"; resolve: (v: any) => void }

export const BATCH_MAX = 200;   // same bound as bot/ai_server.py BATCH_MAX

export function createApiStorage(cfg: ApiStorageConfig): StoragePort {
  const f: typeof fetch = cfg.fetchImpl ?? globalThis.fetch;
  let online = true;
  const snapshot = cfg.snapshot ?? null;
  const dropped = new Set<string>();   // "doc:<name>" / "coll:<name>" written since the snapshot

  function setOnline(next: boolean): void {
    if (next !== online) {
      online = next;
      cfg.onOnlineChange?.(next);
    }
  }

  async function call(method: string, path: string, body?: unknown): Promise<any | null> {
    try {
      const res = await f(`${cfg.baseUrl}/state/${path}`, {
        method,
        headers: { "Content-Type": "application/json", "X-AI-Token": cfg.token },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      // A 4xx is a real answer from a reachable server: the request was wrong, not the connection.
      setOnline(true);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      setOnline(false);
      return null;
    }
  }

  // ── read coalescing ──────────────────────────────────────────────────────────
  let queue: Pending[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  function read(r: Read, path: string, field: Pending["field"]): Promise<any | null> {
    return new Promise((resolve) => {
      queue.push({ read: r, path, field, resolve });
      if (!timer) timer = setTimeout(() => void flush(), 0);
    });
  }

  async function single(p: Pending): Promise<void> {
    const out = await call("GET", p.path);
    p.resolve(out?.[p.field] ?? null);
  }

  async function flush(): Promise<void> {
    const all = queue;
    queue = [];
    timer = null;
    if (all.length === 1) return single(all[0]);
    for (let i = 0; i < all.length; i += BATCH_MAX) {
      const chunk = all.slice(i, i + BATCH_MAX);
      const out = await call("POST", "_batch", { reads: chunk.map((p) => p.read) });
      const results = out?.results;
      if (Array.isArray(results) && results.length === chunk.length) {
        chunk.forEach((p, k) => p.resolve(results[k] ?? null));
      } else if (online) {
        // A server without _batch (or a refused batch): the reads still have to be answered.
        await Promise.all(chunk.map(single));
      } else {
        chunk.forEach((p) => p.resolve(null));
      }
    }
  }

  function guard(...names: string[]): boolean {
    return names.every(isValidName);
  }

  function fromSnapshot(key: string): boolean {
    return !!snapshot && !dropped.has(key);
  }

  return {
    get online() {
      return online;
    },

    async list(collection: string): Promise<IndexEntry[]> {
      if (!guard(collection)) return [];
      // A collection absent from the snapshot did not exist when the page was served.
      if (fromSnapshot(`coll:${collection}`)) return snapshot!.indexes[collection]?.entries ?? [];
      const index = await read({ list: collection }, collection, "index");
      return (index?.entries as IndexEntry[]) ?? [];
    },

    async get<T>(collection: string, id: string): Promise<StorageRecord<T> | null> {
      if (!guard(collection, id)) return null;
      return ((await read({ get: [collection, id] }, `${collection}/${id}`, "record")) as StorageRecord<T>) ?? null;
    },

    async put<T>(collection: string, record: StorageRecord<T>): Promise<boolean> {
      if (!guard(collection, record.id)) return false;
      dropped.add(`coll:${collection}`);
      const out = await call("PUT", `${collection}/${record.id}`, record);
      return !!out?.ok;
    },

    async remove(collection: string, id: string): Promise<boolean> {
      if (!guard(collection, id)) return false;
      dropped.add(`coll:${collection}`);
      const out = await call("DELETE", `${collection}/${id}`);
      return !!out?.ok;
    },

    async getDoc<T>(name: string): Promise<T | null> {
      if (!guard(name)) return null;
      if (fromSnapshot(`doc:${name}`)) return (snapshot!.docs[name] as T) ?? null;
      return ((await read({ doc: name }, `doc/${name}`, "doc")) as T) ?? null;
    },

    async putDoc<T>(name: string, doc: T): Promise<boolean> {
      if (!guard(name)) return false;
      dropped.add(`doc:${name}`);
      const out = await call("PUT", `doc/${name}`, doc);
      return !!out?.ok;
    },
  };
}
