// Buffered decorator (web-contract.md §5). Composes the source of truth with a local buffer so a
// study session survives the server being down: reads fall back, writes land in the buffer and are
// replayed later. Parts see a plain StoragePort and never handle any of this.
//
// Outbox: one pending write is one key (lh:<ns>:_outbox:<collection>:<id> in the buffer's own
// medium), never a growing array. Replay is idempotent, so a flush interrupted halfway is safe to
// repeat: each pending write is an upsert, and the key is dropped only after it lands.

import type { IndexEntry, StoragePort, StorageRecord } from "./port";

// The outbox is a collection like any other, so its name must satisfy the shared name rule
// (no leading underscore). The lh- prefix keeps it clear of an instance's own collections.
const OUTBOX = "lh-outbox";

interface Pending {
  collection: string;
  record: StorageRecord;
}

export interface BufferedConfig {
  primary: StoragePort;
  buffer: StoragePort;
  /** Called after a flush that moved at least one record, so the UI can refresh. */
  onFlush?: (count: number) => void;
}

export function createBufferedStorage(cfg: BufferedConfig): StoragePort & { flush(): Promise<number> } {
  const { primary, buffer } = cfg;

  // The outbox is itself a collection in the buffer, so it inherits one-key-per-record storage.
  const pendingId = (collection: string, id: string) => `${collection}--${id}`;

  async function queue(collection: string, record: StorageRecord): Promise<boolean> {
    return buffer.put(OUTBOX, {
      kind: "pending-write",
      id: pendingId(collection, record.id),
      summary: { collection, record_id: record.id },
      data: { collection, record } as Pending,
    });
  }

  async function flush(): Promise<number> {
    // Deliberately not gated on primary.online: that flag only changes when a call is attempted,
    // so trusting it here would mean a recovered server is never retried. An empty outbox costs
    // one local read and issues no request at all.
    const entries = await buffer.list(OUTBOX);
    let moved = 0;
    for (const entry of entries) {
      const held = await buffer.get<Pending>(OUTBOX, entry.id);
      if (!held) continue;
      const { collection, record } = held.data;
      const ok = await primary.put(collection, record);
      if (!ok) break; // still unreachable: keep the rest queued, order preserved
      await buffer.remove(OUTBOX, entry.id);
      moved++;
    }
    if (moved) cfg.onFlush?.(moved);
    return moved;
  }

  return {
    get online() {
      return primary.online;
    },

    flush,

    async list(collection: string): Promise<IndexEntry[]> {
      const entries = await primary.list(collection);
      if (entries.length || primary.online) return entries;
      return buffer.list(collection);
    },

    async get<T>(collection: string, id: string): Promise<StorageRecord<T> | null> {
      const found = await primary.get<T>(collection, id);
      if (found) return found;
      return buffer.get<T>(collection, id);
    },

    async put<T>(collection: string, record: StorageRecord<T>): Promise<boolean> {
      // Write to the buffer first: if the primary write fails we still hold the data locally, and
      // a read-back right after a failed write must not come up empty.
      await buffer.put(collection, record);
      await flush();
      const ok = await primary.put(collection, record);
      if (ok) return true;
      return queue(collection, record as StorageRecord);
    },

    async remove(collection: string, id: string): Promise<boolean> {
      await buffer.remove(collection, id);
      await buffer.remove(OUTBOX, pendingId(collection, id));
      return primary.remove(collection, id);
    },

    async getDoc<T>(name: string): Promise<T | null> {
      const doc = await primary.getDoc<T>(name);
      if (doc !== null) return doc;
      return buffer.getDoc<T>(name);
    },

    async putDoc<T>(name: string, doc: T): Promise<boolean> {
      await buffer.putDoc(name, doc);
      return primary.putDoc(name, doc);
    },
  };
}
