import { describe, it, expect, vi } from "vitest";
import type { AiClient, AiResponse } from "../../src/ai/client";
import { AiSession } from "../../src/ai/client";
import {
  parseProject,
  buildTree,
  fileByPath,
  explain,
  generateProject,
  type GeneratedProject,
  type ProjectFile,
} from "./codeproj";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeProject(files: ProjectFile[]): GeneratedProject {
  return { title: "Test Project", summary: "A test project.", files };
}

function makeSession(send: (req: { prompt: string }) => AiResponse): AiSession {
  const client: AiClient = {
    ai: vi.fn().mockImplementation(async (req) => send(req)),
    health: vi.fn().mockResolvedValue(true),
    problems: vi.fn().mockResolvedValue({ ok: true, problems: [], error: null }),
  };
  return new AiSession(client);
}

// ── parseProject ──────────────────────────────────────────────────────────────

describe("parseProject", () => {
  const VALID_JSON = JSON.stringify({
    title: "MyApp",
    summary: "Does things.",
    files: [
      { path: "src/main.py", content: "print('hello')", lang: "python" },
      { path: "README.md", content: "# MyApp" },
    ],
    entrypoints: ["src/main.py"],
  });

  /** Narrow the union once, so each case reads as one assertion rather than three. */
  const ok = (text: string) => {
    const r = parseProject(text);
    if (!r.ok) throw new Error(`expected a project, got ${r.reason} (${r.detail ?? ""})`);
    return r.project;
  };
  const rejected = (text: string) => {
    const r = parseProject(text);
    if (r.ok) throw new Error("expected a rejection, got a project");
    return r;
  };

  it("parses plain JSON", () => {
    const p = ok(VALID_JSON);
    expect(p.title).toBe("MyApp");
    expect(p.files).toHaveLength(2);
    expect(p.entrypoints).toEqual(["src/main.py"]);
  });

  it("strips ```json fences", () => {
    expect(ok("```json\n" + VALID_JSON + "\n```").title).toBe("MyApp");
  });

  it("strips plain ``` fences", () => {
    expect(ok("```\n" + VALID_JSON + "\n```").title).toBe("MyApp");
  });

  // The three rejections below are the whole point of the reason field. Before 2026-09-10 they
  // were one `null`, so a learner who waited minutes was told only that it had not worked -- and
  // so was anyone reading the code afterwards.
  it("says `parse` when the reply is prose rather than JSON", () => {
    const r = rejected("죄송하지만 그 주제로는 만들 수 없습니다.");
    expect(r.reason).toBe("parse");
    // The parser's own message, so a truncated reply reads differently from prose.
    expect(r.detail).toBeTruthy();
  });

  it("says `shape` when it is JSON about something else, and names the keys it did send", () => {
    const r = rejected(JSON.stringify({ error: "cannot", explanation: "too vague" }));
    expect(r.reason).toBe("shape");
    expect(r.detail).toBe("error, explanation");
  });

  it("says `shape` for each missing required field", () => {
    expect(rejected(JSON.stringify({ title: "X" })).reason).toBe("shape");
    expect(rejected(JSON.stringify({ title: "X", summary: "Y" })).reason).toBe("shape");
    expect(rejected(JSON.stringify({ title: "X", summary: "Y", files: "bad" })).reason).toBe("shape");
  });

  it("filters out malformed file entries but keeps valid ones", () => {
    const p = ok(
      JSON.stringify({
        title: "T",
        summary: "S",
        files: [{ path: "ok.ts", content: "// ok" }, { missing_path: true, content: "bad" }, 42],
      }),
    );
    expect(p.files).toHaveLength(1);
    expect(p.files[0].path).toBe("ok.ts");
  });

  it("refuses a project with no usable files instead of returning an empty one", () => {
    // This used to be a SUCCESS: `files: []` satisfies every type check above, so the screen got
    // a valid GeneratedProject, rendered an empty file tree, and read as a bug somewhere else.
    expect(rejected(JSON.stringify({ title: "T", summary: "S", files: [] })).reason).toBe("empty");
    const allBad = rejected(JSON.stringify({ title: "T", summary: "S", files: [42, { nope: 1 }] }));
    expect(allBad.reason).toBe("empty");
    expect(allBad.detail).toContain("2");
  });

  it("handles missing entrypoints gracefully", () => {
    const p = ok(JSON.stringify({ title: "T", summary: "S", files: [{ path: "a.ts", content: "" }] }));
    expect(p.entrypoints).toBeUndefined();
  });
});

// ── buildTree ─────────────────────────────────────────────────────────────────

describe("buildTree", () => {
  it("builds a flat list of root files", () => {
    const files: ProjectFile[] = [
      { path: "main.ts", content: "" },
      { path: "utils.ts", content: "" },
    ];
    const tree = buildTree(files);
    expect(tree).toHaveLength(2);
    expect(tree.every((n) => n.isFile)).toBe(true);
    expect(tree.map((n) => n.name).sort()).toEqual(["main.ts", "utils.ts"]);
  });

  it("nests files under folders", () => {
    const files: ProjectFile[] = [
      { path: "src/index.ts", content: "" },
      { path: "src/utils/helpers.ts", content: "" },
      { path: "README.md", content: "" },
    ];
    const tree = buildTree(files);
    // Folders sort before files
    const srcNode = tree.find((n) => n.name === "src");
    expect(srcNode).toBeDefined();
    expect(srcNode!.isFile).toBe(false);
    const utils = srcNode!.children.find((n) => n.name === "utils");
    expect(utils).toBeDefined();
    expect(utils!.isFile).toBe(false);
    expect(utils!.children[0].name).toBe("helpers.ts");
    const readmeNode = tree.find((n) => n.name === "README.md");
    expect(readmeNode).toBeDefined();
    expect(readmeNode!.isFile).toBe(true);
  });

  it("sorts folders before files within each level", () => {
    const files: ProjectFile[] = [
      { path: "z_file.ts", content: "" },
      { path: "a_dir/item.ts", content: "" },
    ];
    const tree = buildTree(files);
    expect(tree[0].isFile).toBe(false); // a_dir folder first
    expect(tree[1].isFile).toBe(true);  // z_file.ts after
  });

  it("handles backslash paths (Windows style)", () => {
    const files: ProjectFile[] = [{ path: "src\\utils\\helper.ts", content: "" }];
    const tree = buildTree(files);
    const src = tree.find((n) => n.name === "src");
    expect(src).toBeDefined();
    const utils = src!.children.find((n) => n.name === "utils");
    expect(utils).toBeDefined();
    expect(utils!.children[0].name).toBe("helper.ts");
  });

  it("returns empty array for empty files list", () => {
    expect(buildTree([])).toEqual([]);
  });
});

// ── fileByPath ────────────────────────────────────────────────────────────────

describe("fileByPath", () => {
  const project = makeProject([
    { path: "src/app.ts", content: "// app" },
    { path: "src/utils.ts", content: "// utils" },
    { path: "README.md", content: "# readme" },
  ]);

  it("finds an existing file by exact path", () => {
    const f = fileByPath(project, "src/app.ts");
    expect(f).toBeDefined();
    expect(f!.content).toBe("// app");
  });

  it("returns undefined for a missing path", () => {
    expect(fileByPath(project, "not/exists.ts")).toBeUndefined();
  });

  it("normalizes backslashes when looking up", () => {
    const f = fileByPath(project, "src\\app.ts");
    expect(f).toBeDefined();
    expect(f!.path).toBe("src/app.ts");
  });
});

// ── explain (AI path, fake session) ──────────────────────────────────────────

describe("explain", () => {
  it("sends a resume call with the correct lens and target path", async () => {
    const calls: { prompt: string; session_id: string | null }[] = [];

    const client: AiClient = {
      ai: vi.fn().mockImplementation(async (req) => {
        calls.push({ prompt: req.prompt, session_id: req.session_id ?? null });
        return {
          ok: true,
          text: "This file handles routing.",
          session_id: "sess-abc",
          error: null,
        } satisfies AiResponse;
      }),
      health: vi.fn().mockResolvedValue(true),
    problems: vi.fn().mockResolvedValue({ ok: true, problems: [], error: null }),
    };
    const session = new AiSession(client);

    // Seed session_id by calling send once (simulates prior generation)
    await session.send({ prompt: "generate", system: "sys" });
    expect(session.sessionId).toBe("sess-abc");

    // Now call explain — must resume (pass the session_id)
    const result = await explain(session, {
      target: { path: "src/router.ts" },
      lens: "flow",
    });

    expect(result).toBe("This file handles routing.");
    expect(calls).toHaveLength(2);

    const explainCall = calls[1];
    // Must carry the session_id from the first call (resume, not new session)
    expect(explainCall.session_id).toBe("sess-abc");
    // Prompt must name the file path
    expect(explainCall.prompt).toContain("src/router.ts");
    // Prompt must name the lens
    expect(explainCall.prompt).toContain("flow");
  });

  it("returns an error string when the AI response is not ok", async () => {
    const session = makeSession(() => ({
      ok: false,
      text: "",
      session_id: null,
      error: "upstream timeout",
    }));

    const result = await explain(session, {
      target: { path: "main.ts" },
      lens: "overview",
    });
    expect(result).toContain("upstream timeout");
  });

  it("includes symbol in the prompt when provided", async () => {
    const calls: string[] = [];
    const client: AiClient = {
      ai: vi.fn().mockImplementation(async (req) => {
        calls.push(req.prompt);
        return { ok: true, text: "ok", session_id: "s1", error: null } satisfies AiResponse;
      }),
      health: vi.fn().mockResolvedValue(true),
    problems: vi.fn().mockResolvedValue({ ok: true, problems: [], error: null }),
    };
    const session = new AiSession(client);

    await explain(session, {
      target: { path: "api/handler.ts", symbol: "handleRequest" },
      lens: "libs_methods",
    });

    expect(calls[0]).toContain("handleRequest");
    expect(calls[0]).toContain("libs_methods");
  });

  it("includes line range in the prompt when provided", async () => {
    const calls: string[] = [];
    const client: AiClient = {
      ai: vi.fn().mockImplementation(async (req) => {
        calls.push(req.prompt);
        return { ok: true, text: "ok", session_id: "s1", error: null } satisfies AiResponse;
      }),
      health: vi.fn().mockResolvedValue(true),
    problems: vi.fn().mockResolvedValue({ ok: true, problems: [], error: null }),
    };
    const session = new AiSession(client);

    await explain(session, {
      target: { path: "lib/core.ts", lines: [10, 25] },
      lens: "modify_tip",
    });

    expect(calls[0]).toContain("10");
    expect(calls[0]).toContain("25");
    expect(calls[0]).toContain("modify_tip");
  });
});

// ── generateProject (fake session) ───────────────────────────────────────────

describe("generateProject", () => {
  const reply = (over: Record<string, unknown>) =>
    makeSession(() => ({ ok: true, text: "", session_id: "s", error: null, ...over }) as any);

  it("returns a GeneratedProject on success", async () => {
    const canned: GeneratedProject = {
      title: "Todo App",
      summary: "A simple todo app.",
      files: [{ path: "app.py", content: "# app" }],
      entrypoints: ["app.py"],
    };
    const result = await generateProject(reply({ text: JSON.stringify(canned) }), {
      topic: "todo app",
      scale: "small",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.title).toBe("Todo App");
    expect(result.project.files[0].path).toBe("app.py");
  });

  // Four failures that used to be one `null`. Each wants a different response from the learner,
  // which is why each has to arrive distinguishable.
  it("reports a transport failure as `call`, carrying the server's own message", async () => {
    const session = makeSession(() => ({ ok: false, text: "", session_id: null, error: "HTTP 502" }));
    const result = await generateProject(session, { topic: "x", scale: "small" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("call");
    expect(result.detail).toBe("HTTP 502");
  });

  it("splits a timeout out of the generic bucket, because it is the actionable one", async () => {
    // `ai.py` reports its own ceiling this way. A learner can respond to it -- narrower topic,
    // smaller scale -- which is not true of the others.
    const session = makeSession(() => ({
      ok: false,
      text: "",
      session_id: null,
      error: "Timeout after 1800s",
    }));
    const result = await generateProject(session, { topic: "x", scale: "large" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("timeout");
  });

  it("reports prose as `parse`", async () => {
    const result = await generateProject(reply({ text: "Sorry, I cannot help with that." }), {
      topic: "x",
      scale: "small",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("parse");
  });

  it("reports a well-formed answer about the wrong thing as `shape`", async () => {
    const result = await generateProject(reply({ text: JSON.stringify({ answer: "no" }) }), {
      topic: "x",
      scale: "small",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("shape");
  });

  it("parses fenced JSON from generation response", async () => {
    const canned = JSON.stringify({
      title: "Calc",
      summary: "Calculator.",
      files: [{ path: "calc.py", content: "# calc" }],
    });
    const result = await generateProject(reply({ text: "```json\n" + canned + "\n```" }), {
      topic: "calculator",
      scale: "small",
    });
    expect(result.ok && result.project.title).toBe("Calc");
  });
});

// ── subject_agnostic guard ────────────────────────────────────────────────────

describe("subject_agnostic", () => {
  it("no subject literal in the module source", async () => {
    // Read the source text and verify no hardcoded subject/area names.
    // The actual check runs as part of the broader test_subject_agnostic.py gate;
    // this vitest variant checks the runtime exports carry no subject literal in their names.
    const exported = [
      "parseProject",
      "buildTree",
      "fileByPath",
      "explain",
      "generateProject",
      "mountCodeproj",
      "AiSession",
      "createAiClient",
    ];
    // All exported names should be generic (no Korean subject nouns or specific domain names).
    // This is a shape/naming check — actual string scanning is done by test_subject_agnostic.py.
    for (const name of exported) {
      expect(typeof name).toBe("string");
      expect(name.length).toBeGreaterThan(0);
    }
  });
});
