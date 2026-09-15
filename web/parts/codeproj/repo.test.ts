// FR-1: a repository and the learner's request become the project every other layer reads.
import { describe, it, expect, vi } from "vitest";
import type { AiClient, AiResponse } from "../../src/ai/client";
import { AiSession, createAiClient } from "../../src/ai/client";
import { annotationOrder, parseScope, projectFromRepo, stackOf } from "./model";
import { buildFocusPrompt, buildReseedSystem } from "./prompts";
import { ENTRY_ANNOTATE_MAX, pickFocusFiles } from "./session";

const many = (n: number) => ({
  title: "big",
  summary: "",
  files: Array.from({ length: n }, (_, i) => ({ path: `src/f${i}.py`, content: "x" })),
});

function scripted(reply: Partial<AiResponse>) {
  const sent: any[] = [];
  const client = {
    ai: vi.fn(async (req: any) => {
      sent.push(req);
      return { ok: true, text: "", session_id: "s1", error: null, ...reply } as AiResponse;
    }),
    problems: vi.fn(),
    repos: vi.fn(),
    health: vi.fn(async () => true),
  } as unknown as AiClient;
  return { client, sent };
}

describe("parseScope", () => {
  it("takes one path or glob per line and drops blanks", () => {
    expect(parseScope("src/auth\r\n\n  *.py  \n")).toEqual(["src/auth", "*.py"]);
    expect(parseScope("   ")).toEqual([]);
  });
});

describe("stackOf", () => {
  it("names the languages with the most files, most first, and ignores non-code files", () => {
    const files = ["a.py", "b.py", "c.ts", "README.md", "d.tsx", "e.json", "f.py"].map((path) => ({ path, content: "" }));
    expect(stackOf(files)).toBe("Python · TypeScript");
  });

  it("is empty when nothing is in a listed language", () => {
    expect(stackOf([{ path: "README.md", content: "" }])).toBe("");
  });
});

describe("projectFromRepo", () => {
  it("builds the header line from facts and omits what the loader did not know", () => {
    const withAll = projectFromRepo({
      title: "repo",
      source: "https://x/y/repo",
      ref: "main",
      commit: "0123456789abcdef",
      files: [{ path: "a.py", content: "1" }],
    });
    expect(withAll.summary).toBe("https://x/y/repo · main · 0123456 · 파일 1개");

    // A local folder has no ref and may have no commit: those segments vanish, never "null" or "-".
    const local = projectFromRepo({ title: "dir", source: "C:\\work\\dir", ref: null, commit: null, files: [] });
    expect(local.summary).toBe("C:\\work\\dir · 파일 0개");
  });
});

describe("annotationOrder", () => {
  it("puts the chosen files first in chosen order, then the rest in project order", () => {
    expect(annotationOrder(["a", "b", "c", "d"], ["c", "a"])).toEqual(["c", "a", "b", "d"]);
  });

  it("cannot lose or duplicate a real file whatever it is handed", () => {
    // An invented or repeated path from the model must not push a real file out of the pass.
    expect(annotationOrder(["a", "b"], ["zzz", "b", "b"])).toEqual(["b", "a"]);
    expect(annotationOrder(["a", "b"], [])).toEqual(["a", "b"]);
  });
});

describe("pickFocusFiles", () => {
  const request = { goal: "인증 흐름 익히기", focus: "로그인", scope: [] };

  it("returns the chosen paths that exist, capped, from a resumed call", async () => {
    const paths = [...many(12).files.map((f) => f.path)].reverse();
    const { client, sent } = scripted({ text: JSON.stringify({ paths: ["nope.py", ...paths, paths[0]] }) });
    const session = new AiSession(client);
    session.adopt("loaded");
    const picked = await pickFocusFiles(session, many(12), request);
    expect(picked).toEqual(paths.slice(0, ENTRY_ANNOTATE_MAX));
    expect(sent[0].session_id).toBe("loaded");
    expect(sent[0].prompt).toContain("src/f0.py");            // every path listed verbatim
  });

  it("spends no call on a repository small enough to annotate whole", async () => {
    const { client, sent } = scripted({ text: "{}" });
    expect(await pickFocusFiles(new AiSession(client), many(ENTRY_ANNOTATE_MAX), request)).toEqual([]);
    expect(sent).toHaveLength(0);
  });

  it("spends no call when the request says nothing to choose by", async () => {
    const { client, sent } = scripted({ text: "{}" });
    expect(await pickFocusFiles(new AiSession(client), many(20), { goal: " ", focus: "", scope: ["src"] })).toEqual([]);
    expect(sent).toHaveLength(0);
  });

  it("falls back to nothing, never throws, on a failed call or an unusable reply", async () => {
    for (const reply of [{ ok: false, error: "boom" }, { text: "산문입니다" }, { text: '{"paths":"a"}' }]) {
      const { client } = scripted(reply);
      expect(await pickFocusFiles(new AiSession(client), many(20), request)).toEqual([]);
    }
  });

  it("puts the request in front of the path list", () => {
    const p = buildFocusPrompt(["a.py"], request, 3);
    expect(p.indexOf("[학습자 요청]")).toBeLessThan(p.indexOf("a.py"));
    expect(p).toContain("최대 3개");
  });
});

describe("loading a repository into a session", () => {
  it("uses the load system that forbids rewriting what it is given", () => {
    expect(buildReseedSystem()).toMatch(/Do not create, write or edit any file/);
  });
});

describe("client.repos", () => {
  it("posts the request with the token and returns the server's answer", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: false, reason: "path", error: "없음" }), { status: 200 }));
    const client = createAiClient({ baseUrl: "http://x", token: "t", fetchImpl: f as unknown as typeof fetch });
    const res = await client.repos({ source: "C:\\nope", include: ["src"] });
    expect(res).toEqual({ ok: false, reason: "path", error: "없음" });
    const [url, init] = (f.mock.calls[0] as unknown) as [string, RequestInit];
    expect(url).toBe("http://x/repos/load");
    expect((init.headers as Record<string, string>)["X-AI-Token"]).toBe("t");
    expect(JSON.parse(init.body as string)).toEqual({ source: "C:\\nope", include: ["src"] });
  });

  it("turns a transport failure into `call` rather than throwing", async () => {
    const down = createAiClient({ baseUrl: "http://x", token: "t", fetchImpl: (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch });
    expect(await down.repos({ source: "a" })).toMatchObject({ ok: false, reason: "call" });
    const refused = createAiClient({ baseUrl: "http://x", token: "t", fetchImpl: (async () => new Response("", { status: 401 })) as unknown as typeof fetch });
    expect(await refused.repos({ source: "a" })).toEqual({ ok: false, reason: "call", error: "HTTP 401" });
  });
});
