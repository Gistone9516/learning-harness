// State API adapter (web-contract.md §2.2): the source-of-truth medium behind StoragePort.
// Talks to the gated local server, which owns the record files and their derived index. The token
// comes from runtime config and is never bundled. fetch is injectable for tests.

import type { IndexEntry, StoragePort, StorageRecord } from "./port";
import { isValidName } from "./port";

export interface ApiStorageConfig {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  /** Notified whenever reachability flips, so the shell can show one notice instead of polling. */
  onOnlineChange?: (online: boolean) => void;
}

export function createApiStorage(cfg: ApiStorageConfig): StoragePort {
  const f: typeof fetch = cfg.fetchImpl ?? globalThis.fetch;
  let online = true;

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

  function guard(...names: string[]): boolean {
    return names.every(isValidName);
  }

  return {
    get online() {
      return online;
    },

    async list(collection: string): Promise<IndexEntry[]> {
      if (!guard(collection)) return [];
      const out = await call("GET", collection);
      return (out?.index?.entries as IndexEntry[]) ?? [];
    },

    async get<T>(collection: string, id: string): Promise<StorageRecord<T> | null> {
      if (!guard(collection, id)) return null;
      const out = await call("GET", `${collection}/${id}`);
      return (out?.record as StorageRecord<T>) ?? null;
    },

    async put<T>(collection: string, record: StorageRecord<T>): Promise<boolean> {
      if (!guard(collection, record.id)) return false;
      const out = await call("PUT", `${collection}/${record.id}`, record);
      return !!out?.ok;
    },

    async remove(collection: string, id: string): Promise<boolean> {
      if (!guard(collection, id)) return false;
      const out = await call("DELETE", `${collection}/${id}`);
      return !!out?.ok;
    },

    async getDoc<T>(name: string): Promise<T | null> {
      if (!guard(name)) return null;
      const out = await call("GET", `doc/${name}`);
      return (out?.doc as T) ?? null;
    },

    async putDoc<T>(name: string, doc: T): Promise<boolean> {
      if (!guard(name)) return false;
      const out = await call("PUT", `doc/${name}`, doc);
      return !!out?.ok;
    },
  };
}
