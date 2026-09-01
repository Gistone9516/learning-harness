// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import type { IndexEntry, StoragePort } from "../../src/storage/port";
import { aggregate, loadStats, mountDashboard } from "./dashboard";

const entry = (id: string, summary: Record<string, unknown>): IndexEntry => ({
  id,
  kind: "x",
  created_at: 1,
  updated_at: 1,
  summary,
});

const HISTORY = [
  entry("h1", { project_id: "p1", topic: "도서 API", stack: "FastAPI", started_at: 200, questions: 2, explains: 3, files_seen: 4 }),
  entry("h2", { project_id: "p2", topic: "메모 앱", stack: "React", started_at: 100, questions: 1, explains: 1, files_seen: 2 }),
  entry("h3", { project_id: "p1", topic: "도서 API", stack: "FastAPI", started_at: 300, questions: 0, explains: 5, files_seen: 1 }),
];
const PROJECTS = [entry("p1", { title: "도서 관리" }), entry("p2", { title: "메모" })];
const PROGRESS = [
  entry("p1", { project_id: "p1", seen_count: 5, file_count: 10 }),
  entry("p2", { project_id: "p2", seen_count: 2, file_count: 2 }),
];

describe("aggregate", () => {
  it("totals sessions, reading and AI usage", () => {
    const stats = aggregate(HISTORY, PROJECTS, PROGRESS);
    expect(stats).toMatchObject({
      sessions: 3,
      projects: 2,
      filesSeen: 7,
      filesTotal: 12,
      questions: 3,
      explains: 9,
    });
  });

  it("ranks stacks by how often they were studied", () => {
    expect(aggregate(HISTORY, PROJECTS, PROGRESS).stacks).toEqual([
      { name: "FastAPI", count: 2 },
      { name: "React", count: 1 },
    ]);
  });

  it("lists sessions newest first and names projects from their own records", () => {
    const stats = aggregate(HISTORY, PROJECTS, PROGRESS);
    expect(stats.recent.map((r) => r.started_at)).toEqual([300, 200, 100]);
    expect(stats.progress.map((p) => p.title)).toContain("도서 관리");
  });

  it("handles an empty store without inventing numbers", () => {
    const stats = aggregate([], [], []);
    expect(stats).toMatchObject({ sessions: 0, filesSeen: 0, filesTotal: 0, stacks: [], recent: [] });
  });
});

describe("loadStats", () => {
  it("reads index summaries only, never a record payload (token 0)", async () => {
    const list = vi.fn(async (c: string) =>
      c === "history" ? HISTORY : c === "projects" ? PROJECTS : PROGRESS,
    );
    const get = vi.fn();
    const storage = { list, get, put: vi.fn(), remove: vi.fn(), getDoc: vi.fn(), putDoc: vi.fn(), online: true } as unknown as StoragePort;

    const stats = await loadStats({ storage });
    expect(stats.sessions).toBe(3);
    expect(list).toHaveBeenCalledTimes(3);
    expect(get).not.toHaveBeenCalled();
  });
});

describe("render", () => {
  it("shows the tiles, stack chips, progress bars and the session table", async () => {
    const storage = {
      list: async (c: string) => (c === "history" ? HISTORY : c === "projects" ? PROJECTS : PROGRESS),
      get: vi.fn(), put: vi.fn(), remove: vi.fn(), getDoc: vi.fn(), putDoc: vi.fn(), online: true,
    } as unknown as StoragePort;

    const host = document.createElement("div");
    await mountDashboard(host, { storage });

    expect(host.querySelectorAll(".lh-db-tile")).toHaveLength(5);
    expect(host.querySelector(".lh-db-tile-value")!.textContent).toBe("3");
    expect(host.querySelectorAll(".lh-db-chip")[0].textContent).toBe("FastAPI (2)");
    expect(host.querySelectorAll(".lh-db-progress-item")).toHaveLength(2);
    expect(host.querySelectorAll(".lh-db-table tr")).toHaveLength(4);   // header + 3 sessions
  });

  it("says so plainly when there is nothing recorded yet", async () => {
    const storage = {
      list: async () => [],
      get: vi.fn(), put: vi.fn(), remove: vi.fn(), getDoc: vi.fn(), putDoc: vi.fn(), online: true,
    } as unknown as StoragePort;

    const host = document.createElement("div");
    await mountDashboard(host, { storage });
    expect(host.querySelector(".lh-db-empty")!.textContent).toContain("학습 기록이 없습니다");
  });
});
