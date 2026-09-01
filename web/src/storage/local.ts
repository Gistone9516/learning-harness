// localStorage adapter (web-contract.md §5). Used alone for a browser-only instance, or as the
// offline buffer behind the buffered decorator. One record is one key, mirroring the file model on
// the server: nothing is ever appended into a growing array.
//
// Keys:  lh:<ns>:<collection>:<id>          record
//        lh:<ns>:<collection>:_index        id list of that collection (derived, rebuildable)
//        lh:<ns>:doc:<name>                 doc

import type { IndexEntry, StoragePort, StorageRecord } from "./port";
import { isValidName } from "./port";

export interface LocalStorageConfig {
  namespace: string;
  store?: Storage;
  now?: () => number;
}

export function createLocalStorage(cfg: LocalStorageConfig): StoragePort {
  const mem = cfg.store ?? globalThis.localStorage;
  const now = cfg.now ?? (() => Date.now());
  const prefix = `lh:${cfg.namespace}`;

  const recordKey = (c: string, id: string) => `${prefix}:${c}:${id}`;
  const indexKey = (c: string) => `${prefix}:${c}:_index`;
  const docKey = (n: string) => `${prefix}:doc:${n}`;

  function readJson<T>(key: string): T | null {
    try {
      const raw = mem.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  function writeJson(key: string, value: unknown): boolean {
    try {
      mem.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      // Quota exceeded or storage disabled: report failure rather than pretending it was saved.
      return false;
    }
  }

  function ids(collection: string): string[] {
    return readJson<string[]>(indexKey(collection)) ?? [];
  }

  return {
    get online() {
      return true; // local storage is always reachable; it is the fallback, not the truth
    },

    async list(collection: string): Promise<IndexEntry[]> {
      if (!isValidName(collection)) return [];
      const entries: IndexEntry[] = [];
      for (const id of ids(collection)) {
        const rec = readJson<StorageRecord>(recordKey(collection, id));
        if (!rec) continue;
        entries.push({
          id: rec.id,
          kind: rec.kind,
          created_at: rec.created_at ?? 0,
          updated_at: rec.updated_at ?? 0,
          summary: rec.summary ?? {},
        });
      }
      entries.sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
      return entries;
    },

    async get<T>(collection: string, id: string): Promise<StorageRecord<T> | null> {
      if (!isValidName(collection) || !isValidName(id)) return null;
      return readJson<StorageRecord<T>>(recordKey(collection, id));
    },

    async put<T>(collection: string, record: StorageRecord<T>): Promise<boolean> {
      if (!isValidName(collection) || !isValidName(record.id)) return false;
      const existing = readJson<StorageRecord>(recordKey(collection, record.id));
      const stamped: StorageRecord<T> = {
        schema_version: record.schema_version ?? 1,
        ...record,
        created_at: record.created_at ?? existing?.created_at ?? now(),
        updated_at: now(),
      };
      if (!writeJson(recordKey(collection, record.id), stamped)) return false;
      const list = ids(collection);
      if (!list.includes(record.id)) writeJson(indexKey(collection), [...list, record.id]);
      return true;
    },

    async remove(collection: string, id: string): Promise<boolean> {
      if (!isValidName(collection) || !isValidName(id)) return false;
      const existed = mem.getItem(recordKey(collection, id)) !== null;
      mem.removeItem(recordKey(collection, id));
      writeJson(indexKey(collection), ids(collection).filter((x) => x !== id));
      return existed;
    },

    async getDoc<T>(name: string): Promise<T | null> {
      if (!isValidName(name)) return null;
      return readJson<T>(docKey(name));
    },

    async putDoc<T>(name: string, doc: T): Promise<boolean> {
      if (!isValidName(name)) return false;
      return writeJson(docKey(name), doc);
    },
  };
}
