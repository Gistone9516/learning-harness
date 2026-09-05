// Deleting an archived project.
//
// The interesting part is not that the record goes away — it is the boundary between what only
// existed to serve the project and what records something the learner did. Those are different
// kinds of thing and only the first kind is deletable.
import { describe, it, expect } from "vitest";
import { createLocalStorage } from "../storage/local";
import type { StoragePort } from "../storage/port";
import { COLLECTIONS, createStudyFlow, type ProposalData } from "./study";
import { makeRecord } from "../storage/port";

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

async function seedProposal(storage: StoragePort, id: string) {
  await storage.put(
    COLLECTIONS.proposals,
    makeRecord<ProposalData>("proposal", id,
      { title: "3계층 REST", stack: "FastAPI", scale: "small", status: "open", order: 1 },
      { topic: "REST", seed: "FastAPI", briefing: { why: "계층 분리를 코드로 보려고", learning_points: ["라우터와 서비스 분리"] } }),
  );
}

/** A project with every per-project record it can accumulate, plus a session and a conversation. */
async function seed(flow: ReturnType<typeof createStudyFlow>, storage: StoragePort) {
  const started = await flow.startProject({ project: PROJECT, topic: "도서 대출", scale: "small", stack: "FastAPI" });
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

  it("walks a started proposal back to open so it can be run again", async () => {
    // Nothing else ever writes this status back. Left alone the proposal would be invisible
    // forever: only `open` ones are ever offered.
    const { flow, storage } = setup();
    await seedProposal(storage, "prop-a");
    const started = await flow.startProject({ project: PROJECT, topic: "REST", scale: "small", stack: "FastAPI" });
    await flow.markProposalStarted("prop-a", started.projectId);
    expect(await flow.openProposals()).toHaveLength(0);

    await flow.deleteProject(started.projectId);

    const open = await flow.openProposals();
    expect(open.map((p) => p.id)).toEqual(["prop-a"]);
    const rec = await storage.get<{ started_project_id: string | null }>(COLLECTIONS.proposals, "prop-a");
    expect(rec!.data.started_project_id).toBeNull();
  });

  it("leaves a proposal that was started on a different project alone", async () => {
    const { flow, storage } = setup();
    await seedProposal(storage, "prop-keep");
    const other = await flow.startProject({ project: PROJECT, topic: "A", scale: "small", stack: "X" });
    await flow.markProposalStarted("prop-keep", other.projectId);
    const doomed = await flow.startProject({ project: PROJECT, topic: "B", scale: "small", stack: "Y" });

    await flow.deleteProject(doomed.projectId);

    const all = await flow.listProposals();
    expect(all.find((p) => p.id === "prop-keep")!.status).toBe("started");
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
