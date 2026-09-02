// @vitest-environment jsdom
//
// Workspace integration: launcher -> start -> study -> back, and the guarantee that nothing is
// generated without the learner's explicit action.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AiClient, AiResponse } from "../ai/client";
import { AiSession } from "../ai/client";
import { createLocalStorage } from "../storage/local";
import { makeRecord, type StoragePort } from "../storage/port";
import { COLLECTIONS, createStudyFlow, type ProposalData } from "./study";
import { createWorkspace } from "./workspace";

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

const PROJECT = {
  title: "도서 관리 API",
  summary: "요약",
  files: [
    { path: "src/main.py", content: "a\nb\nc" },
    { path: "src/service.py", content: "d" },
  ],
};

function stubClient() {
  const sent: any[] = [];
  const client = {
    ai: vi.fn(async (req: any) => {
      sent.push(req);
      const text = req.system ? JSON.stringify(PROJECT) : "ANSWER";
      return { ok: true, text, session_id: "s1", error: null } as AiResponse;
    }),
    problems: vi.fn(),
    health: vi.fn(async () => true),
  } as unknown as AiClient;
  return { client, sent };
}

async function setup(opts: { offline?: boolean } = {}) {
  const store = memStorage();
  const storage: StoragePort = createLocalStorage({ namespace: "ws", store });
  const flow = createStudyFlow({ storage });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const { client, sent } = stubClient();
  const workspace = createWorkspace({
    container,
    flow,
    // offline = an instance with no ai_server at all (NFR-3), which is a different thing from
    // a project whose session is gone: the first hides the pane, the second reseeds.
    newSession: () => (opts.offline ? null : new AiSession(client)),
  });
  return { storage, flow, container, workspace, sent };
}

async function seedProposal(storage: StoragePort) {
  await storage.put(
    COLLECTIONS.proposals,
    makeRecord<ProposalData>(
      "proposal",
      "prop-a",
      { title: "도서 관리 API", stack: "FastAPI + SQLite", scale: "small", status: "open", order: 1 },
      {
        topic: "도서 대출 관리 API",
        seed: "FastAPI + SQLite",
        briefing: { why: "계층 분리를 코드로 확인", learning_points: ["라우터와 서비스 분리"] },
      },
    ),
  );
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("launcher", () => {
  it("shows the operator's proposal with its briefing", async () => {
    const { storage, container, workspace } = await setup();
    await seedProposal(storage);
    await workspace.showLauncher();

    expect(container.querySelector(".lh-cp-proposal-title")!.textContent).toBe("도서 관리 API");
    expect(container.querySelector(".lh-cp-proposal-why")!.textContent).toContain("계층 분리");
    expect(container.querySelector(".lh-cp-proposal-points li")!.textContent).toBe("라우터와 서비스 분리");
    expect(container.querySelector(".lh-cp-chip")!.textContent).toBe("FastAPI + SQLite");
  });

  it("explains the empty state instead of showing a bare screen", async () => {
    const { container, workspace } = await setup();
    await workspace.showLauncher();
    expect(container.querySelector(".lh-cp-launcher-empty")!.textContent).toContain("추천이 없습니다");
    expect(container.querySelector(".lh-cp-free-start")).toBeTruthy();
  });
});

describe("propose then start (FR-14)", () => {
  it("only pre-fills the form when a proposal is picked; generation waits for the learner", async () => {
    const { storage, container, workspace, sent } = await setup();
    await seedProposal(storage);
    await workspace.showLauncher();

    (container.querySelector(".lh-cp-start-btn") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.querySelector(".lh-cp-topic-input")).toBeTruthy());

    expect((container.querySelector(".lh-cp-topic-input") as HTMLInputElement).value).toBe("도서 대출 관리 API");
    expect((container.querySelector(".lh-cp-seed-input") as HTMLInputElement).value).toBe("FastAPI + SQLite");
    expect(sent).toHaveLength(0);         // nothing sent until the learner starts it
  });

  it("archives the project, links the proposal and records reading once generation is started", async () => {
    const { storage, flow, container, workspace } = await setup();
    await seedProposal(storage);
    await workspace.showLauncher();
    (container.querySelector(".lh-cp-start-btn") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.querySelector(".lh-cp-generate-btn")).toBeTruthy());

    (container.querySelector(".lh-cp-generate-btn") as HTMLButtonElement).click();
    await vi.waitFor(async () => expect(await flow.listArchived()).toHaveLength(1));

    const archived = (await flow.listArchived())[0];
    expect(archived).toMatchObject({ title: "도서 관리 API", stack: "FastAPI + SQLite", file_count: 2 });
    expect((await flow.listProposals())[0].status).toBe("started");

    // Opening the first file is already recorded against this project.
    await vi.waitFor(async () => expect(await flow.seenPaths(archived.id)).toContain("src/main.py"));
  });

  it("records explanations and questions into the session's history record", async () => {
    const { storage, flow, container, workspace } = await setup();
    await seedProposal(storage);
    await workspace.showLauncher();
    (container.querySelector(".lh-cp-start-btn") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.querySelector(".lh-cp-generate-btn")).toBeTruthy());
    (container.querySelector(".lh-cp-generate-btn") as HTMLButtonElement).click();
    // Wait for the project to be on screen: the AI controls exist from mount, so waiting on them
    // would fire the explain before there is anything to explain.
    await vi.waitFor(() => expect(container.querySelector(".lh-cp-code-line")).toBeTruthy());

    (container.querySelector(".lh-cp-lens-select") as HTMLSelectElement).value = "concepts";
    (container.querySelector(".lh-cp-explain-btn") as HTMLButtonElement).click();
    await vi.waitFor(async () => {
      const entries = await storage.list(COLLECTIONS.history);
      expect(entries[0].summary["explains"]).toBe(1);
    });

    const historyId = (await storage.list(COLLECTIONS.history))[0].id;
    const record = await storage.get<any>(COLLECTIONS.history, historyId);
    expect(record?.data.lens_counts).toEqual({ concepts: 1 });
  });
});

describe("archive (FR-7)", () => {
  it("reopens a stored project with no ai_server at all and hides the pane", async () => {
    // NFR-3: an instance without an AI server still reads its archive. The pane is hidden
    // rather than left as a row of dead buttons.
    const { flow, container, workspace } = await setup({ offline: true });
    const { projectId } = await flow.startProject({
      project: PROJECT, topic: "t", stack: "FastAPI", scale: "small",
    });
    await flow.recordFileSeen(projectId, "src/main.py");

    await workspace.showLauncher();
    expect(container.querySelector(".lh-cp-archive-title")!.textContent).toBe("도서 관리 API");

    (container.querySelector(".lh-cp-archive-btn") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.querySelector(".lh-cp-code")).toBeTruthy());

    expect(container.querySelectorAll(".lh-cp-tree-file")).toHaveLength(2);
    expect((container.querySelector(".lh-cp-ai") as HTMLElement).style.display).toBe("none");
    expect(await flow.seenPaths(projectId)).toContain("src/main.py");
  });

  it("reopens with the AI pane live, and spends nothing to do it (FR-9)", async () => {
    const { flow, container, workspace, sent } = await setup();
    const { projectId } = await flow.startProject({
      project: PROJECT, topic: "t", stack: "FastAPI", scale: "small",
    });
    await flow.rememberSession(projectId, "sid-from-last-visit");

    await workspace.showLauncher();
    (container.querySelector(".lh-cp-archive-btn") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.querySelector(".lh-cp-code")).toBeTruthy());

    expect((container.querySelector(".lh-cp-ai") as HTMLElement).style.display).not.toBe("none");
    // The whole point of adopting rather than probing: opening costs no call, even though
    // loadProject selects the first file on its own.
    expect(sent).toHaveLength(0);

    // ...and the first question resumes the stored session instead of minting a new one.
    (container.querySelector(".lh-cp-explain-btn") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].session_id).toBe("sid-from-last-visit");
  });

  it("counts files read in this visit, not the total on disk", async () => {
    // endSession stamps this number as the session's files_seen. Seeding it from the persisted
    // total would report more files read than the project has.
    const { flow, storage, container, workspace } = await setup();
    const { projectId } = await flow.startProject({
      project: PROJECT, topic: "t", stack: "FastAPI", scale: "small",
    });
    await flow.recordFileSeen(projectId, "src/main.py");
    await flow.recordFileSeen(projectId, "src/service.py");

    await workspace.showLauncher();
    (container.querySelector(".lh-cp-archive-btn") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.querySelector(".lh-cp-code")).toBeTruthy());

    // loadProject opens the first file; nothing else is touched.
    await vi.waitFor(async () => {
      const entries = await storage.list(COLLECTIONS.history);
      expect(entries).toHaveLength(2);           // the generation's session, plus this revisit
    });
    await workspace.showLauncher();

    const entries = await storage.list(COLLECTIONS.history);
    const revisit = entries.sort((a, b) => b.updated_at - a.updated_at)[0];
    expect(revisit.summary["files_seen"]).toBe(1);
  });

  it("returns to the launcher and closes the session record", async () => {
    const { storage, flow, container, workspace } = await setup();
    await seedProposal(storage);
    await workspace.showLauncher();
    (container.querySelector(".lh-cp-start-btn") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.querySelector(".lh-cp-generate-btn")).toBeTruthy());
    (container.querySelector(".lh-cp-generate-btn") as HTMLButtonElement).click();
    await vi.waitFor(async () => expect(await flow.listArchived()).toHaveLength(1));

    (container.querySelector(".lh-cp-back") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.querySelector(".lh-cp-launcher")).toBeTruthy());

    const entry = (await storage.list(COLLECTIONS.history))[0];
    expect(entry.summary["ended_at"]).toBeGreaterThan(0);
    expect(entry.summary["files_seen"]).toBeGreaterThan(0);
  });
});

describe("leaving while the annotation pass is still running", () => {
  it("writes the notes under their own project, not whichever one is current by then", async () => {
    // The pass runs for minutes and [목록으로] stays live the whole time. Keying the write on
    // the workspace's shared projectId lets a first project's notes land on a second one --
    // and the write replaces the whole record, so the second project's notes are destroyed.
    const { flow, container, workspace } = await setup();
    const a = await flow.startProject({ project: PROJECT, topic: "먼저", stack: "s", scale: "small" });
    const b = await flow.startProject({ project: PROJECT, topic: "나중", stack: "s", scale: "small" });

    await flow.writeAnnotations(b.projectId, { files: { "src/main.py": { status: "ok", items: [{ what: "B의 주석" }] } } });

    // A's pass finishes long after the learner moved on to B.
    await workspace.showLauncher();
    await flow.writeAnnotations(a.projectId, { files: { "src/main.py": { status: "ok", items: [{ what: "A의 주석" }] } } });

    const forB = await flow.readAnnotations(b.projectId);
    expect((forB!.files["src/main.py"].items[0] as { what: string }).what).toBe("B의 주석");
    const forA = await flow.readAnnotations(a.projectId);
    expect((forA!.files["src/main.py"].items[0] as { what: string }).what).toBe("A의 주석");
  });

  it("does not count files opened by a visit the learner already left", async () => {
    // A part the learner walked away from still opens its first file when its project finally
    // loads. That is not reading, and counting it inflates a session that never happened.
    const { flow, storage, container, workspace } = await setup();
    const { projectId } = await flow.startProject({ project: PROJECT, topic: "t", stack: "s", scale: "small" });

    await workspace.showLauncher();
    (container.querySelector(".lh-cp-archive-btn") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.querySelector(".lh-cp-code")).toBeTruthy());
    await workspace.showLauncher();          // leave

    const before = (await flow.seenPaths(projectId)).length;
    (container.querySelector(".lh-cp-archive-btn") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.querySelector(".lh-cp-code")).toBeTruthy());
    await workspace.showLauncher();

    // Reopening the same project reads the same first file; the total on disk does not double.
    expect((await flow.seenPaths(projectId)).length).toBe(before);
    void storage;
  });
});

describe("the transcript (FR-15a)", () => {
  it("writes both the counter and the words for one exchange", async () => {
    // The counters answer how much studying happened; only the transcript can answer what
    // about. Neither replaces the other.
    const { storage, container, workspace } = await setup();
    await seedProposal(storage);
    await workspace.showLauncher();
    (container.querySelector(".lh-cp-start-btn") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.querySelector(".lh-cp-generate-btn")).toBeTruthy());
    (container.querySelector(".lh-cp-generate-btn") as HTMLButtonElement).click();
    // The AI controls exist from mount, so wait for the code itself before asking about it.
    await vi.waitFor(() => expect(container.querySelector(".lh-cp-code-line")).toBeTruthy());
    (container.querySelector(".lh-cp-explain-btn") as HTMLButtonElement).click();

    const day = await vi.waitFor(async () => {
      const entries = await storage.list(COLLECTIONS.conversations);
      expect(entries).toHaveLength(1);
      return entries[0];
    });
    expect(day.summary["explains"]).toBe(1);

    const rec = await storage.get<{ entries: { answer: string; kind: string }[] }>(
      COLLECTIONS.conversations,
      day.id,
    );
    expect(rec!.data.entries[0].kind).toBe("explain");
    // The answer itself, not a count of it.
    expect(rec!.data.entries[0].answer).toBe("ANSWER");
  });

  it("records nothing for a visit the learner already left", async () => {
    const { flow, storage, container, workspace } = await setup();
    await flow.startProject({ project: PROJECT, topic: "t", stack: "s", scale: "small" });
    await workspace.showLauncher();
    (container.querySelector(".lh-cp-archive-btn") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.querySelector(".lh-cp-code")).toBeTruthy());
    await workspace.showLauncher();

    expect(await storage.list(COLLECTIONS.conversations)).toHaveLength(0);
  });
});
