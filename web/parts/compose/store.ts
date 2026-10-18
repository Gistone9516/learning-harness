// WHAT: compose persistence over StoragePort (specs/web-compose.md §2). Views never build records.
import { makeRecord, type IndexEntry, type StoragePort } from "../../src/storage/port";
import { taskSummary, type TaskData, type TaskSummary } from "./model";

export const TASKS = "compose";

export interface TaskEntry extends IndexEntry { summary: TaskSummary & Record<string, unknown> }

export function createComposeStore(storage: StoragePort) {
  return {
    async list(): Promise<TaskEntry[]> {
      const all = (await storage.list(TASKS)) as TaskEntry[];
      return all.slice().sort((a, b) => (b.summary.updated ?? 0) - (a.summary.updated ?? 0));
    },
    async get(id: string): Promise<TaskData | null> {
      return (await storage.get<TaskData>(TASKS, id))?.data ?? null;
    },
    async put(id: string, d: TaskData, now: number): Promise<boolean> {
      return storage.put(TASKS, makeRecord("task", id, taskSummary(d, now) as unknown as Record<string, unknown>, d));
    },
    remove: (id: string) => storage.remove(TASKS, id),
    getDoc: <T>(name: string) => storage.getDoc<T>(name),
    get online() { return storage.online; },
  };
}

export type ComposeStore = ReturnType<typeof createComposeStore>;
