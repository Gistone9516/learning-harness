// Deleting an archived project.
//
// The interesting part is not that the record goes away — it is the boundary between what only
// existed to serve the project and what records something the learner did. Those are different
// kinds of thing and only the first kind is deletable.
import { describe, it, expect } from "vitest";
import { createLocalStorage } from "../storage/local";
import type { StoragePort } from "../storage/port";
import { COLLECTIONS, createStudyFlow } from "./study";

function memStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as unknown as Storage;
}

function setup() {
  const storage: StoragePort = createLocalStorage({ namespace: "del", store: memStorage(), now: () => 100 });
  return { storage, flow: createStudyFlow({ storage }) };
}

const PROJECT = { title: "도서 관리", summary: "s", files: [{ path: "a.py", content: "x" }] };

const ORIGIN = {
  kind: "repo" as const,
  source: "https://example.test/o/repo",
  ref: null,
  commit: null,
  request: { goal: "", focus: "", scope: [] },
};

/** A project with every per-project record it can accumulate, plus a session and a conversation. */
async function seed(flow: ReturnType<typeof createStudyFlow>, storage: StoragePort) {
  const started = await flow.startProject({ project: PROJECT, origin: ORIGIN, stack: "FastAPI" });
  const id = started.projectId;
  await flow.rememberSession(id, "sid-1");
  await flow.writeAnnotations(id, { files: { "a.py": { status: "ok", items: [{}] } } });
  await flow.writeConcepts(id, { entries: [{ seed: { area: "a", concept_id: "c-one", title: "개념" }, status: "ok" }] });
  await flow.writeTraces(id, {
    runs: { "a.py:1": { status: "ok", steps: [{ index: 1, path: "a.py", line: 1, explain: "시작", vars: [] }] } },
  });
  const historyId = await flow.beginSession({ projectId: id, topic: "도서 대출", stack: "FastAPI" });
  await flow.appendConversation({
    at: Date.UTC(2026, 8, 4, 12), kind: "ask", project_id: id, history_id: historyId,
    path: "a.py", question: "왜?", answer: "이래서.",
  });
  return { id, historyId, storage };
}

describe("deleteProject", () => {
  it("removes everything that only existed to serve the project", async () => {
    const { flow, storage } = setup();
    const { id } = await seed(flow, storage);

    expect(await flow.deleteProject(id)).toBe(true);
    for (const c of [COLLECTIONS.projects, COLLECTIONS.progress, COLLECTIONS.aiSessions, COLLECTIONS.annotations, COLLECTIONS.concepts, COLLECTIONS.traces]) {
      expect(await storage.get(c, id)).toBeNull();
    }
    expect(await flow.listArchived()).toEqual([]);
  });

  it("keeps the study history, because studying happened", async () => {
    // The material is gone; the fact that the learner worked that day is not the material.
    const { flow, storage } = setup();
    const { id, historyId } = await seed(flow, storage);

    await flow.deleteProject(id);
    const session = await storage.get(COLLECTIONS.history, historyId);
    expect(session).not.toBeNull();
    // The topic was copied in at session start, so the row still renders as itself.
    expect(session!.summary["topic"]).toBe("도서 대출");
  });

  it("keeps the conversation log", async () => {
    // A day is the record boundary and one day mixes projects, so there is no per-project unit to
    // remove. The dangling project_id is the honest cost of that.
    const { flow, storage } = setup();
    const { id } = await seed(flow, storage);

    await flow.deleteProject(id);
    const days = await storage.list(COLLECTIONS.conversations);
    expect(days).toHaveLength(1);
    expect(days[0].summary["entries"]).toBe(1);
  });

  it("deletes nothing else when the project record itself cannot be removed", async () => {
    // The offline buffer has no tombstone for a delete: with the server unreachable the record
    // survives the source of truth. Carrying on would strip a live project of its notes and then
    // hand it back at the next sync, stripped.
    const { flow, storage } = setup();
    const { id } = await seed(flow, storage);
    const guarded: StoragePort = {
      ...storage,
      remove: async (c: string, rid: string) => (c === COLLECTIONS.projects ? false : storage.remove(c, rid)),
    };
    const offline = createStudyFlow({ storage: guarded });

    expect(await offline.deleteProject(id)).toBe(false);
    expect(await storage.get(COLLECTIONS.annotations, id)).not.toBeNull();
    expect(await storage.get(COLLECTIONS.concepts, id)).not.toBeNull();
    expect(await storage.get(COLLECTIONS.traces, id)).not.toBeNull();
    expect(await storage.get(COLLECTIONS.progress, id)).not.toBeNull();
  });

  it("reports false for a project that is not there", async () => {
    const { flow } = setup();
    expect(await flow.deleteProject("prj-nope")).toBe(false);
  });
});
