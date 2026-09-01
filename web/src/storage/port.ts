// Storage port (web-contract.md §5). One interface over instance state so parts never learn which
// medium answered: the gated state API (source of truth), localStorage (offline buffer), or a
// buffered decorator combining both. Records are one-per-id; a collection listing reads only the
// derived index, never the payloads.

export interface StorageRecord<T = unknown> {
  schema_version?: number;
  kind: string;
  id: string;
  created_at?: number;
  updated_at?: number;
  summary: Record<string, unknown>;
  data: T;
}

export interface IndexEntry {
  id: string;
  kind: string;
  created_at: number;
  updated_at: number;
  summary: Record<string, unknown>;
}

export interface StoragePort {
  /** Index entries of a collection. Cheap: payloads are not read. */
  list(collection: string): Promise<IndexEntry[]>;
  get<T>(collection: string, id: string): Promise<StorageRecord<T> | null>;
  /** Upsert. Returns false when the write could not be persisted anywhere. */
  put<T>(collection: string, record: StorageRecord<T>): Promise<boolean>;
  remove(collection: string, id: string): Promise<boolean>;
  getDoc<T>(name: string): Promise<T | null>;
  putDoc<T>(name: string, doc: T): Promise<boolean>;
  /** False when the source of truth is currently unreachable (UI degrades, never dead-buttons). */
  readonly online: boolean;
}

/** Shared id rule with the server; rejecting early gives a better error than a 400 round trip. */
export const STORAGE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isValidName(name: string): boolean {
  return STORAGE_NAME_RE.test(name);
}

/** Build a record envelope. Timestamps are server-stamped; kept optional here on purpose. */
export function makeRecord<T>(
  kind: string,
  id: string,
  summary: Record<string, unknown>,
  data: T,
): StorageRecord<T> {
  return { schema_version: 1, kind, id, summary, data };
}
