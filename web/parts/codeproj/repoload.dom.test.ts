// @vitest-environment jsdom
//
// FR-1, FR-14, FR-20: the load form, what it sends, and what is written before and after entry.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AiClient, AiResponse, RepoLoadResponse } from "../../src/ai/client";
import { AiSession } from "../../src/ai/client";
import { mountCodeproj } from "./codeproj";

const NOTES = JSON.stringify({ items: [{ target: { lines: [1, 1] }, kind: "function", what: "무엇" }] });

const files = (n: number) => Array.from({ length: n }, (_, i) => ({ path: `src/f${i}.py`, content: "a\nb" }));

function loaded(n: number): RepoLoadResponse {
  return {
    ok: true,
    title: "repo",
    source: "https://example.test/o/repo",
    ref: null,
    commit: "abcdef1234567",
    files: files(n),
    skipped: {},
    total_bytes: 2048,
  };
}

/**
 * A client that answers each kind of call with the shape it expects. `hold` names a file whose
 * annotation call waits until released, so a state that normally lasts one tick can be observed.
 */
function setup(
  opts: { load?: RepoLoadResponse; focus?: string[]; reseedFails?: boolean; hold?: string; concepts?: string[]; failConcept?: string } = {},
) {
  const sent: any[] = [];
  let release: () => void = () => undefined;
  const held = new Promise<void>((r) => (release = r));
  const client = {
    ai: vi.fn(async (req: any) => {
      sent.push(req);
      if (req.prompt.startsWith("[코드베이스 적재]")) {
        return (opts.reseedFails
          ? { ok: false, text: "", session_id: null, error: "HTTP 502" }
          : { ok: true, text: "loaded", session_id: "s1", error: null }) as AiResponse;
      }
      let text = "OK";
      if (req.prompt.startsWith("[주석 생성 요청]")) {
        if (opts.hold && req.prompt.includes(`대상 파일: ${opts.hold}\n`)) await held;
        text = NOTES;
      } else if (req.system?.includes("먼저 읽을 파일")) text = JSON.stringify({ paths: opts.focus ?? [] });
      else if (req.system?.includes("개념의 목록")) {
        text = JSON.stringify({ concepts: (opts.concepts ?? []).map((id) => ({ area: "structure", concept_id: id, title: id })) });
      } else if (req.system?.includes("해설 문서를 쓴다")) {
        const id = JSON.parse(req.prompt).concept_id as string;
        if (id === opts.failConcept) return { ok: false, text: "", session_id: null, error: "boom" } as AiResponse;
        text = JSON.stringify({ area: "structure", concept_id: id, title: id, body: "## 본문\n\n내용." });
      }
      return { ok: true, text, session_id: "s1", error: null } as AiResponse;
    }),
    problems: vi.fn(),
    repos: vi.fn(),
    health: vi.fn(async () => true),
  } as unknown as AiClient;

  const loadRepo = vi.fn(async () => opts.load ?? loaded(3));
  const onProjectLoaded = vi.fn();
  const onAnnotations = vi.fn();
  const onConcepts = vi.fn();
  const host = document.createElement("div");
  document.body.appendChild(host);
  mountCodeproj(host, {
    session: new AiSession(client),
    loadRepo,
    onProjectLoaded,
    onAnnotations,
    // Snapshotted, because the set is one object mutated in place as each document lands.
    onConcepts: (set) => onConcepts(set.entries.map((e) => e.status)),
  });

  const q = <T extends Element>(sel: string) => host.querySelector(sel) as T;
  const fill = (sel: string, value: string) => (q<HTMLInputElement>(sel).value = value);
  const press = () => q<HTMLButtonElement>(".lh-cp-load-btn").click();
  const annotated = () => sent.filter((r) => r.prompt.startsWith("[주석 생성 요청]")).map((r) => /대상 파일: (\S+)/.exec(r.prompt)![1]);
  return { host, sent, q, fill, press, loadRepo, onProjectLoaded, onAnnotations, onConcepts, annotated, release: () => release() };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("before load is pressed (FR-14)", () => {
  it("shows the form, hides the empty grid, and sends nothing", () => {
    const { q, sent, loadRepo } = setup();
    expect(q(".lh-cp-load-source")).toBeTruthy();
    expect(q(".lh-cp-load-scope")).toBeTruthy();
    // The grid shares the column with the form; left visible it pushed the button off-screen.
    expect(q<HTMLElement>(".lh-cp-panes").style.display).toBe("none");
    expect(loadRepo).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it("asks for a source instead of calling the server with nothing", () => {
    const { q, press, loadRepo } = setup();
    press();
    expect(loadRepo).not.toHaveBeenCalled();
    expect(q(".lh-cp-load-phase").textContent).toContain("입력해 주세요");
  });
});

describe("loading a repository (FR-1, FR-20)", () => {
  it("reads it, puts it in a fresh session, annotates it for the request, and enters", async () => {
    const t = setup();
    t.fill(".lh-cp-load-source", "  https://example.test/o/repo ");
    t.fill(".lh-cp-load-goal", "구조 익히기, 초급");
    t.fill(".lh-cp-load-focus", "저장 계층");
    t.fill(".lh-cp-load-scope", "src\n\n*.py\n");
    t.press();
    await vi.waitFor(() => expect(t.q(".lh-cp-code-line")).toBeTruthy());

    expect(t.loadRepo).toHaveBeenCalledWith({ source: "https://example.test/o/repo", ref: null, include: ["src", "*.py"] });
    // Load mints the session; nothing before it reused an old one.
    expect(t.sent[0].prompt.startsWith("[코드베이스 적재]")).toBe(true);
    expect(t.sent[0].session_id).toBeNull();
    expect(t.onProjectLoaded).toHaveBeenCalledWith(
      expect.objectContaining({ title: "repo" }),
      {
        kind: "repo",
        source: "https://example.test/o/repo",
        ref: null,
        commit: "abcdef1234567",
        request: { goal: "구조 익히기, 초급", focus: "저장 계층", scope: ["src", "*.py"] },
      },
    );
    // Small enough to annotate whole, so no call is spent choosing, and all of it is done at entry.
    expect(t.sent.some((r) => r.system?.includes("먼저 읽을 파일"))).toBe(false);
    expect(Object.keys(t.onAnnotations.mock.calls[0][0].files)).toHaveLength(3);
    for (const r of t.sent.filter((x) => x.prompt.startsWith("[주석 생성 요청]"))) {
      expect(r.prompt).toContain("학습 목적과 수준: 구조 익히기, 초급");
    }
    expect(t.q<HTMLElement>(".lh-cp-panes").style.display).toBe("");
    expect(t.q(".lh-cp-load-panel")).toBeNull();
    expect(t.q(".lh-cp-summary").textContent).toContain("abcdef1");
  });

  it("annotates the chosen files before entry, opens the first of them, and does the rest behind", async () => {
    const t = setup({ load: loaded(12), focus: ["src/f11.py", "src/f5.py"] });
    t.fill(".lh-cp-load-source", "https://example.test/o/repo");
    t.fill(".lh-cp-load-focus", "f11 위주");
    t.press();
    await vi.waitFor(() => expect(t.q(".lh-cp-code-line")).toBeTruthy());

    const atEntry = Object.keys(t.onAnnotations.mock.calls[0][0].files);
    expect(atEntry).toHaveLength(8);
    expect(atEntry.slice(0, 2)).toEqual(["src/f11.py", "src/f5.py"]);
    expect(t.q(".lh-cp-path-label").textContent).toBe("src/f11.py");

    // The rest land one at a time behind the learner, each written back as it arrives.
    await vi.waitFor(() => {
      const last = t.onAnnotations.mock.calls.at(-1)![0];
      expect(Object.keys(last.files)).toHaveLength(12);
    });
    expect(t.annotated()).toHaveLength(12);
    expect(new Set(t.annotated()).size).toBe(12);
  });

  it("writes the concept documents behind the learner, one at a time, ahead of the remaining notes", async () => {
    const t = setup({ load: loaded(10), concepts: ["c-one", "c-two", "c-three"], failConcept: "c-two" });
    t.fill(".lh-cp-load-source", "https://example.test/o/repo");
    t.press();
    await vi.waitFor(() => {
      const last = t.onAnnotations.mock.calls.at(-1)![0];
      expect(Object.keys(last.files)).toHaveLength(10);
    });

    // A document is published as it starts and as it lands, never two in progress at once, and
    // one failing is a row to retry rather than a lost set.
    const snapshots = t.onConcepts.mock.calls.map((c) => c[0] as string[]);
    expect(snapshots[0]).toEqual(["pending", "pending", "pending"]);
    expect(Math.max(...snapshots.map((s) => s.filter((x) => x === "writing").length))).toBe(1);
    expect(snapshots.at(-1)).toEqual(["ok", "failed", "ok"]);

    // Every concept call happens before the two notes that were left for after entry: a whole set
    // is minutes, the rest of a large repository can be hours.
    const kinds = t.sent.map((r) =>
      r.system?.includes("해설 문서를 쓴다") ? "doc" : r.prompt.startsWith("[주석 생성 요청]") ? "note" : "other",
    );
    expect(kinds.lastIndexOf("doc")).toBeLessThan(kinds.lastIndexOf("note"));
    expect(kinds.slice(kinds.indexOf("doc")).filter((k) => k === "note")).toHaveLength(2);
  });

  it("says a file's notes are on their way, then drops the notice when they land", async () => {
    const t = setup({ load: loaded(10), hold: "src/f9.py" });
    t.fill(".lh-cp-load-source", "https://example.test/o/repo");
    t.press();
    await vi.waitFor(() => expect(t.q(".lh-cp-code-line")).toBeTruthy());

    const tree = Array.from(t.host.querySelectorAll<HTMLElement>(".lh-cp-tree-file"));
    tree.find((b) => b.dataset["path"] === "src/f9.py")!.click();
    await vi.waitFor(() => expect(t.q(".lh-cp-note-link").textContent).toBe("설명 만드는 중"));
    expect(t.q<HTMLButtonElement>(".lh-cp-note-link").disabled).toBe(true);

    t.release();
    await vi.waitFor(() => expect(t.q<HTMLButtonElement>(".lh-cp-note-link").hidden).toBe(true));
  });

  it("names too many files as a scope problem and turns each directory into a control", async () => {
    const t = setup({
      load: {
        ok: false,
        reason: "too_large",
        error: "파일이 너무 많습니다",
        found: { files: 900, bytes: 5 * 1024 * 1024 },
        limits: { files: 300, bytes: 1500000 },
        dirs: [
          { dir: "src", files: 600, bytes: 4 * 1024 * 1024 },
          { dir: ".", files: 3, bytes: 900 },
        ],
      },
    });
    t.fill(".lh-cp-load-source", "https://example.test/o/repo");
    t.fill(".lh-cp-load-scope", "docs");
    t.press();
    await vi.waitFor(() => expect(t.q<HTMLElement>(".lh-cp-load-advice").hidden).toBe(false));

    expect(t.q(".lh-cp-load-phase").textContent).toContain("볼 파일 범위를 좁혀");
    const dirs = t.host.querySelectorAll<HTMLButtonElement>(".lh-cp-load-dir");
    expect(dirs).toHaveLength(1);                     // root files cannot be named as a directory
    dirs[0].click();
    expect(t.q<HTMLTextAreaElement>(".lh-cp-load-scope").value).toBe("docs\nsrc");
    expect(t.q<HTMLButtonElement>(".lh-cp-load-btn").disabled).toBe(false);
    expect(t.sent).toHaveLength(0);
  });

  it("stops before anything is archived when the session will not take the codebase", async () => {
    const t = setup({ reseedFails: true });
    t.fill(".lh-cp-load-source", "https://example.test/o/repo");
    t.press();
    await vi.waitFor(() => expect(t.q(".lh-cp-load-phase").textContent).toContain("싣지 못했습니다"));
    expect(t.onProjectLoaded).not.toHaveBeenCalled();
    expect(t.q<HTMLButtonElement>(".lh-cp-load-btn").disabled).toBe(false);
  });
});

describe("a reopened project with files the first visit did not reach", () => {
  it("offers to make a file's notes, spends nothing until pressed, and uses the stored request", async () => {
    const sent: any[] = [];
    const client = {
      ai: vi.fn(async (req: any) => {
        sent.push(req);
        return { ok: true, text: NOTES, session_id: "s1", error: null } as AiResponse;
      }),
      problems: vi.fn(),
      repos: vi.fn(),
      health: vi.fn(async () => true),
    } as unknown as AiClient;
    const onAnnotations = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    mountCodeproj(host, {
      session: new AiSession(client),
      project: { title: "repo", summary: "s", files: files(2) },
      annotations: { files: { "src/f0.py": { status: "ok", items: [] } } },
      request: { goal: "저장 목적", focus: "", scope: [] },
      onAnnotations,
    });

    const link = () => host.querySelector(".lh-cp-note-link") as HTMLButtonElement;
    expect(link().hidden).toBe(true);                   // f0 has its notes
    Array.from(host.querySelectorAll<HTMLElement>(".lh-cp-tree-file")).find((b) => b.dataset["path"] === "src/f1.py")!.click();
    expect(link().textContent).toBe("설명 만들기");
    expect(sent).toHaveLength(0);                       // opening costs nothing

    link().click();
    await vi.waitFor(() => expect(onAnnotations).toHaveBeenCalled());
    expect(sent).toHaveLength(1);
    expect(sent[0].prompt).toContain("학습 목적과 수준: 저장 목적");
    expect(Object.keys(onAnnotations.mock.calls[0][0].files)).toEqual(["src/f0.py", "src/f1.py"]);
  });
});
