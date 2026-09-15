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
  const storage: StoragePort = createLocalStorage({ namespace: "flow", store: memStorage(), now: () => 100 });
  let tick = 0;
  const flow = createStudyFlow({ storage, now: () => 1000 + tick++, token: () => "aaa" });
  return { storage, flow };
}

const PROJECT = {
  title: "도서 관리",
  summary: "s",
  files: [{ path: "src/app.py", content: "x" }, { path: "README.md", content: "y" }],
};

const ORIGIN = {
  kind: "repo" as const,
  source: "https://example.test/o/repo",
  ref: null,
  commit: null,
  request: { goal: "", focus: "", scope: [] },
};

describe("starting a project (FR-7)", () => {
  it("archives the project and initialises progress and history together", async () => {
    const { storage, flow } = setup();
    const { projectId, historyId } = await flow.startProject({
      project: PROJECT,
      origin: ORIGIN, stack: "s"
    });

    const archived = await flow.listArchived();
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatchObject({ id: projectId, title: "도서 관리", file_count: 2, source: ORIGIN.source });

    // The heavy payload is stored once, in its own record, and is not part of the index entry.
    const record = await flow.loadArchived(projectId);
    expect(record?.data.project.files).toHaveLength(2);
    expect(Object.keys(archived[0])).not.toContain("project");

    expect(await flow.seenPaths(projectId)).toEqual([]);
    const history = await storage.get(COLLECTIONS.history, historyId);
    expect(history?.summary["project_id"]).toBe(projectId);
    // The dashboard shows this column as the name of what was studied.
    expect(history?.summary["topic"]).toBe("도서 관리");
  });

  it("keeps the source and the learner's request with the project, stamped with the same moment", async () => {
    // The request outlives the visit: files left unannotated are written later for the same goal.
    const { storage, flow } = setup();
    const request = { goal: "구조 익히기", focus: "저장 계층", scope: ["src"] };
    const { projectId, historyId } = await flow.startProject({
      project: PROJECT,
      origin: { ...ORIGIN, ref: "main", commit: "abc", request },
      stack: "Python",
    });
    const record = await flow.loadArchived(projectId);
    const history = await storage.get(COLLECTIONS.history, historyId);
    expect(record?.data.origin).toEqual({ ...ORIGIN, ref: "main", commit: "abc", request, loaded_at: history?.summary["started_at"] });
  });

  it("keeps each project's records in separate files", async () => {
    const { storage, flow } = setup();
    await flow.startProject({ project: PROJECT, origin: ORIGIN, stack: "s" });
    await flow.startProject({ project: PROJECT, origin: ORIGIN, stack: "s" });

    // Two projects, two project records and two history records; nothing accumulated into one.
    expect(await storage.list(COLLECTIONS.projects)).toHaveLength(2);
    expect(await storage.list(COLLECTIONS.history)).toHaveLength(2);
  });
});

describe("reading progress (FR-6)", () => {
  it("records each file once and keeps the counter in the index summary", async () => {
    const { storage, flow } = setup();
    const { projectId } = await flow.startProject({ project: PROJECT, origin: ORIGIN, stack: "s" });

    await flow.recordFileSeen(projectId, "src/app.py");
    await flow.recordFileSeen(projectId, "src/app.py");
    await flow.recordFileSeen(projectId, "README.md");

    expect(await flow.seenPaths(projectId)).toEqual(["src/app.py", "README.md"]);
    const entry = (await storage.list(COLLECTIONS.progress)).find((e) => e.id === projectId)!;
    expect(entry.summary["seen_count"]).toBe(2);
    expect(entry.summary["file_count"]).toBe(2);
  });

  it("survives a reload, which is the point of persisting it", async () => {
    const store = memStorage();
    const first = createStudyFlow({ storage: createLocalStorage({ namespace: "flow", store }) });
    const { projectId } = await first.startProject({ project: PROJECT, origin: ORIGIN, stack: "s" });
    await first.recordFileSeen(projectId, "README.md");

    const reopened = createStudyFlow({ storage: createLocalStorage({ namespace: "flow", store }) });
    expect(await reopened.seenPaths(projectId)).toEqual(["README.md"]);
  });
});

describe("session history (FR-8)", () => {
  it("counts explains per lens and keeps question text in that session's record", async () => {
    const { storage, flow } = setup();
    const { projectId, historyId } = await flow.startProject({
      project: PROJECT, origin: ORIGIN, stack: "s"
    });

    await flow.recordExchange(historyId, { kind: "explain", lens: "concepts", path: "src/app.py" });
    await flow.recordExchange(historyId, { kind: "explain", lens: "concepts", path: "src/app.py" });
    await flow.recordExchange(historyId, { kind: "explain", lens: "flow", path: "src/app.py" });
    await flow.recordExchange(historyId, { kind: "ask", path: "src/app.py", lines: [2, 4], question: "왜 이렇게?" });
    await flow.recordFileSeen(projectId, "src/app.py");
    await flow.endSession(historyId, 1);

    const record = await storage.get<any>(COLLECTIONS.history, historyId);
    expect(record?.data.lens_counts).toEqual({ concepts: 2, flow: 1 });
    expect(record?.data.asked[0]).toMatchObject({ text: "왜 이렇게?", lines: [2, 4] });
    expect(record?.summary).toMatchObject({ explains: 3, questions: 1, files_seen: 1 });
    expect(record?.summary["ended_at"]).toBeGreaterThan(0);
  });

  it("exposes the dashboard numbers through index summaries alone", async () => {
    const { storage, flow } = setup();
    const { historyId } = await flow.startProject({ project: PROJECT, origin: ORIGIN, stack: "s" });
    await flow.recordExchange(historyId, { kind: "ask", path: "p", question: "q" });
    await flow.endSession(historyId, 2);

    // A dashboard can total these without loading a single payload.
    const entries = await storage.list(COLLECTIONS.history);
    const totals = entries.reduce(
      (acc, e) => ({
        questions: acc.questions + (e.summary["questions"] as number),
        files: acc.files + (e.summary["files_seen"] as number),
      }),
      { questions: 0, files: 0 },
    );
    expect(totals).toEqual({ questions: 1, files: 2 });
  });
  it("remembers and recalls the session that holds a project's codebase", async () => {
    const { flow } = setup();
    const { projectId } = await flow.startProject({ project: PROJECT, origin: ORIGIN, stack: "s" });

    expect(await flow.recallSession(projectId)).toBeNull();
    await flow.rememberSession(projectId, "sid-9");
    expect(await flow.recallSession(projectId)).toBe("sid-9");
  });

  it("does not touch the project record when remembering a session", async () => {
    // listArchived sorts by updated_at, so writing the session id onto the project record
    // would lift an old project to the top of the archive every time its session changed.
    const { storage, flow } = setup();
    const { projectId } = await flow.startProject({ project: PROJECT, origin: ORIGIN, stack: "s" });
    const before = await storage.get(COLLECTIONS.projects, projectId);

    await flow.rememberSession(projectId, "sid-9");

    expect(await storage.get(COLLECTIONS.projects, projectId)).toEqual(before);
    expect(await storage.list(COLLECTIONS.aiSessions)).toHaveLength(1);
  });

  it("stores an annotation layer and reports its coverage from the index alone", async () => {
    const { storage, flow } = setup();
    const { projectId } = await flow.startProject({ project: PROJECT, origin: ORIGIN, stack: "s" });

    expect(await flow.readAnnotations(projectId)).toBeNull();
    await flow.writeAnnotations(projectId, {
      files: {
        "src/main.py": { status: "ok", items: [{ what: "a" }, { what: "b" }] },
        "src/service.py": { status: "failed", items: [] },
      },
    });

    const back = await flow.readAnnotations(projectId);
    expect(back!.files["src/main.py"].items).toHaveLength(2);

    // An operator can see how well a project is annotated without opening the record.
    const [entry] = await storage.list(COLLECTIONS.annotations);
    expect(entry.summary).toMatchObject({ files_ok: 1, files_failed: 1, items: 2 });
  });
});
