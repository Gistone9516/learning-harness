import { describe, it, expect } from "vitest";
import { createLocalStorage } from "../storage/local";
import { makeRecord, type StoragePort } from "../storage/port";
import { COLLECTIONS, createStudyFlow, type ProposalData } from "./study";

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

async function seedProposal(storage: StoragePort, id = "prop-a", order = 1) {
  await storage.put(
    COLLECTIONS.proposals,
    makeRecord<ProposalData>(
      "proposal",
      id,
      { title: "도서 관리 API", stack: "FastAPI + SQLite", scale: "small", status: "open", order },
      {
        topic: "도서 대출 관리 API",
        seed: "FastAPI + SQLite",
        briefing: { why: "계층 분리를 실제 코드로 보기 위해", learning_points: ["라우터와 서비스 분리"] },
      },
    ),
  );
}

describe("proposals (FR-14)", () => {
  it("lists open proposals in the operator's order, with the briefing", async () => {
    const { storage, flow } = setup();
    await seedProposal(storage, "prop-b", 2);
    await seedProposal(storage, "prop-a", 1);

    const open = await flow.openProposals();
    expect(open.map((p) => p.id)).toEqual(["prop-a", "prop-b"]);
    expect(open[0].data.briefing.learning_points).toEqual(["라우터와 서비스 분리"]);
    expect(open[0].stack).toBe("FastAPI + SQLite");
  });

  it("marks a proposal started and links it to the project it produced", async () => {
    const { storage, flow } = setup();
    await seedProposal(storage);

    const { projectId } = await flow.startProject({
      project: PROJECT,
      topic: "도서 대출 관리 API",
      stack: "FastAPI + SQLite",
      scale: "small",
      proposalId: "prop-a",
    });

    expect(await flow.openProposals()).toEqual([]);          // no longer offered
    const all = await flow.listProposals();
    expect(all[0].status).toBe("started");
    expect(all[0].data.started_project_id).toBe(projectId);
  });
});

describe("starting a project (FR-7)", () => {
  it("archives the project and initialises progress and history together", async () => {
    const { storage, flow } = setup();
    const { projectId, historyId } = await flow.startProject({
      project: PROJECT,
      topic: "t",
      stack: "s",
      scale: "small",
    });

    const archived = await flow.listArchived();
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatchObject({ id: projectId, title: "도서 관리", file_count: 2 });

    // The heavy payload is stored once, in its own record, and is not part of the index entry.
    const record = await flow.loadArchived(projectId);
    expect(record?.data.project.files).toHaveLength(2);
    expect(Object.keys(archived[0])).not.toContain("project");

    expect(await flow.seenPaths(projectId)).toEqual([]);
    const history = await storage.get(COLLECTIONS.history, historyId);
    expect(history?.summary["project_id"]).toBe(projectId);
  });

  it("keeps each project's records in separate files", async () => {
    const { storage, flow } = setup();
    await flow.startProject({ project: PROJECT, topic: "a", stack: "s", scale: "small" });
    await flow.startProject({ project: PROJECT, topic: "b", stack: "s", scale: "small" });

    // Two projects, two project records and two history records; nothing accumulated into one.
    expect(await storage.list(COLLECTIONS.projects)).toHaveLength(2);
    expect(await storage.list(COLLECTIONS.history)).toHaveLength(2);
  });
});

describe("reading progress (FR-6)", () => {
  it("records each file once and keeps the counter in the index summary", async () => {
    const { storage, flow } = setup();
    const { projectId } = await flow.startProject({ project: PROJECT, topic: "t", stack: "s", scale: "small" });

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
    const { projectId } = await first.startProject({ project: PROJECT, topic: "t", stack: "s", scale: "small" });
    await first.recordFileSeen(projectId, "README.md");

    const reopened = createStudyFlow({ storage: createLocalStorage({ namespace: "flow", store }) });
    expect(await reopened.seenPaths(projectId)).toEqual(["README.md"]);
  });
});

describe("session history (FR-8)", () => {
  it("counts explains per lens and keeps question text in that session's record", async () => {
    const { storage, flow } = setup();
    const { projectId, historyId } = await flow.startProject({
      project: PROJECT, topic: "t", stack: "s", scale: "small",
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
    const { historyId } = await flow.startProject({ project: PROJECT, topic: "t", stack: "s", scale: "small" });
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
});
