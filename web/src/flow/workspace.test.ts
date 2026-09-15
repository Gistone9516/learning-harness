// @vitest-environment jsdom
//
// Workspace integration: launcher -> load -> study -> back, and the guarantee that nothing is
// loaded or annotated without the learner's explicit action.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AiClient, AiResponse, RepoLoadResponse } from "../ai/client";
import { AiSession } from "../ai/client";
import { createLocalStorage } from "../storage/local";
import type { StoragePort } from "../storage/port";
import { COLLECTIONS, createStudyFlow } from "./study";
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

const ORIGIN = {
  kind: "repo" as const,
  source: "https://example.test/o/library-api",
  ref: null,
  commit: null,
  request: { goal: "", focus: "", scope: [] },
};

const LOADED: RepoLoadResponse = {
  ok: true,
  title: "도서 관리 API",
  source: ORIGIN.source,
  ref: null,
  commit: "abc1234",
  files: PROJECT.files,
  skipped: {},
  total_bytes: 12,
};

function stubClient() {
  const sent: any[] = [];
  const client = {
    ai: vi.fn(async (req: any) => {
      sent.push(req);
      // Loading and the background passes carry a system clause and get a JSON-ish reply; the
      // learner's own explain and ask do not, and get plain text.
      const text = req.system ? "{}" : "ANSWER";
      return { ok: true, text, session_id: "s1", error: null } as AiResponse;
    }),
    problems: vi.fn(),
    repos: vi.fn(),
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
  const loadRepo = vi.fn(async () => LOADED);
  const workspace = createWorkspace({
    container,
    flow,
    // offline = an instance with no ai_server at all (NFR-3), which is a different thing from
    // a project whose session is gone: the first hides the pane, the second reseeds.
    newSession: () => (opts.offline ? null : new AiSession(client)),
    loadRepo: opts.offline ? undefined : loadRepo,
  });
  return { storage, flow, container, workspace, sent, loadRepo };
}

/** Launcher -> form -> press load, the way a learner does it. */
async function loadFromLauncher(container: HTMLElement, workspace: { showLauncher(): Promise<void> }) {
  await workspace.showLauncher();
  (container.querySelector(".lh-cp-launcher-load-btn") as HTMLButtonElement).click();
  await vi.waitFor(() => expect(container.querySelector(".lh-cp-load-source")).toBeTruthy());
  (container.querySelector(".lh-cp-load-source") as HTMLInputElement).value = ORIGIN.source;
  (container.querySelector(".lh-cp-load-btn") as HTMLButtonElement).click();
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("launcher", () => {
  it("offers loading a repository and explains an empty archive", async () => {
    const { container, workspace } = await setup();
    await workspace.showLauncher();
    expect(container.querySelector(".lh-cp-launcher-load-btn")!.textContent).toBe("저장소 불러오기");
    expect(container.querySelector(".lh-cp-launcher-empty")!.textContent).toContain("불러온 저장소가 없습니다");
  });

  it("offers no load control on an instance that cannot read a repository", async () => {
    // A control whose only outcome is failure, styled like a working one, is worse than none.
    const { container, workspace } = await setup({ offline: true });
    await workspace.showLauncher();
    expect(container.querySelector(".lh-cp-launcher-load-btn")).toBeNull();
  });
});

describe("load then study (FR-14)", () => {
  it("opens the form from the launcher and sends nothing until load is pressed", async () => {
    const { container, workspace, sent, loadRepo } = await setup();
    await workspace.showLauncher();
    (container.querySelector(".lh-cp-launcher-load-btn") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.querySelector(".lh-cp-load-source")).toBeTruthy());

    expect(loadRepo).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it("archives the project with its source and records reading once load is pressed", async () => {
    const { flow, container, workspace } = await setup();
    await loadFromLauncher(container, workspace);
    await vi.waitFor(async () => expect(await flow.listArchived()).toHaveLength(1));

    const archived = (await flow.listArchived())[0];
    expect(archived).toMatchObject({ title: "도서 관리 API", source: ORIGIN.source, stack: "Python", file_count: 2 });
    const record = await flow.loadArchived(archived.id);
    expect(record?.data.origin).toMatchObject({ kind: "repo", commit: "abc1234" });

    // Opening the first file is already recorded against this project.
    await vi.waitFor(async () => expect(await flow.seenPaths(archived.id)).toContain("src/main.py"));
  });

  it("records explanations and questions into the session's history record", async () => {
    const { storage, container, workspace } = await setup();
    await loadFromLauncher(container, workspace);
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
    const { projectId } = await flow.startProject({ project: PROJECT, origin: ORIGIN, stack: "FastAPI" });
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
    const { projectId } = await flow.startProject({ project: PROJECT, origin: ORIGIN, stack: "FastAPI" });
    await flow.rememberSession(projectId, "sid-from-last-visit");

    await workspace.showLauncher();
    (container.querySelector(".lh-cp-archive-btn") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.querySelector(".lh-cp-code")).toBeTruthy());

    expect((container.querySelector(".lh-cp-ai") as HTMLElement).style.display).not.toBe("none");
    // The whole point of adopting rather than probing: opening costs no call, even though
    // loadProject selects the first file on its own -- and even though that file has no notes.
    expect(sent).toHaveLength(0);

    // ...and the first question resumes the stored session instead of minting a new one.
    (container.querySelector(".lh-cp-explain-btn") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].session_id).toBe("sid-from-last-visit");
  });

  it("writes notes made on a reopened project back to that project", async () => {
    // Annotation resumes on a later visit, so the reopen path needs a write-back it never had.
    const { flow, container, workspace, sent } = await setup();
    const { projectId } = await flow.startProject({
      project: PROJECT,
      origin: { ...ORIGIN, request: { goal: "저장된 목적", focus: "", scope: [] } },
      stack: "FastAPI",
    });

    await workspace.showLauncher();
    (container.querySelector(".lh-cp-archive-btn") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.querySelector(".lh-cp-note-link")!.textContent).toBe("설명 만들기"));
    (container.querySelector(".lh-cp-note-link") as HTMLButtonElement).click();

    await vi.waitFor(async () => expect(await flow.readAnnotations(projectId)).not.toBeNull());
    expect(sent[0].prompt).toContain("학습 목적과 수준: 저장된 목적");
  });

  it("counts files read in this visit, not the total on disk", async () => {
    // endSession stamps this number as the session's files_seen. Seeding it from the persisted
    // total would report more files read than the project has.
    const { flow, storage, container, workspace } = await setup();
    const { projectId } = await flow.startProject({ project: PROJECT, origin: ORIGIN, stack: "FastAPI" });
    await flow.recordFileSeen(projectId, "src/main.py");
    await flow.recordFileSeen(projectId, "src/service.py");

    await workspace.showLauncher();
    (container.querySelector(".lh-cp-archive-btn") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.querySelector(".lh-cp-code")).toBeTruthy());

    // loadProject opens the first file; nothing else is touched.
    await vi.waitFor(async () => {
      const entries = await storage.list(COLLECTIONS.history);
      expect(entries).toHaveLength(2);           // the load's session, plus this revisit
    });
    await workspace.showLauncher();

    const entries = await storage.list(COLLECTIONS.history);
    const revisit = entries.sort((a, b) => b.updated_at - a.updated_at)[0];
    expect(revisit.summary["files_seen"]).toBe(1);
  });

  it("returns to the launcher and closes the session record", async () => {
    const { storage, flow, container, workspace } = await setup();
    await loadFromLauncher(container, workspace);
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
    const { flow, workspace } = await setup();
    const a = await flow.startProject({ project: PROJECT, origin: ORIGIN, stack: "s" });
    const b = await flow.startProject({ project: PROJECT, origin: ORIGIN, stack: "s" });

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
    const { flow, container, workspace } = await setup();
    const { projectId } = await flow.startProject({ project: PROJECT, origin: ORIGIN, stack: "s" });

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
  });
});

describe("the transcript (FR-15a)", () => {
  it("writes both the counter and the words for one exchange", async () => {
    // The counters answer how much studying happened; only the transcript can answer what
    // about. Neither replaces the other.
    const { storage, container, workspace } = await setup();
    await loadFromLauncher(container, workspace);
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
    await flow.startProject({ project: PROJECT, origin: ORIGIN, stack: "s" });
    await workspace.showLauncher();
    (container.querySelector(".lh-cp-archive-btn") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.querySelector(".lh-cp-code")).toBeTruthy());
    await workspace.showLauncher();

    expect(await storage.list(COLLECTIONS.conversations)).toHaveLength(0);
  });
});
