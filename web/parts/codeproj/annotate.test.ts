// FR-20: building the annotation layer right after generation.
//
// The cost shape is what these pin down. One call per file is forced by the server's follow-up
// timeout, the pass runs before the learner can click anything, and one file failing must not
// take the rest of the project with it.
import { describe, it, expect, vi } from "vitest";
import type { AiClient, AiResponse } from "../../src/ai/client";
import { AiSession } from "../../src/ai/client";
import { annotateFile, annotateProject } from "./session";
import {
  AUDIENCE_CLAUSE,
  buildAnnotatePrompt,
  buildAnnotateSystem,
  buildAskPrompt,
  buildExplainPrompt,
  buildScrapExplainPrompt,
  QUALITY_CLAUSE,
} from "./prompts";

const PROJECT = {
  title: "도서 관리 API",
  summary: "요약",
  files: [
    { path: "app/db.py", content: "one\ntwo\nthree\nfour" },
    { path: "app/main.py", content: "alpha\nbeta" },
    { path: "README.md", content: "# 제목" },
  ],
};

const notes = (lines: [number, number]) =>
  JSON.stringify({ items: [{ target: { lines }, kind: "function", what: "무엇을 한다" }] });

/** Replies scripted per call, recording every request. */
function scripted(reply: (n: number, req: any) => Partial<AiResponse>) {
  const sent: any[] = [];
  const client = {
    ai: vi.fn(async (req: any) => {
      sent.push(req);
      return { ok: true, text: "", session_id: "s1", error: null, ...reply(sent.length, req) } as AiResponse;
    }),
    problems: vi.fn(),
    health: vi.fn(async () => true),
  } as unknown as AiClient;
  return { client, sent };
}

describe("annotateFile", () => {
  it("keeps notes that fit the file", async () => {
    const { client } = scripted(() => ({ text: notes([2, 3]) }));
    const out = await annotateFile(new AiSession(client), "app/db.py", "one\ntwo\nthree\nfour");
    expect(out.status).toBe("ok");
    expect(out.items[0].target.lines).toEqual([2, 3]);
  });

  it("survives a fenced reply and prose around the JSON", async () => {
    const { client } = scripted(() => ({ text: "설명입니다:\n```json\n" + notes([1, 1]) + "\n```\n끝." }));
    const out = await annotateFile(new AiSession(client), "app/db.py", "one\ntwo");
    expect(out.status).toBe("ok");
  });

  it("fails the file rather than inventing notes when the reply is unparseable", async () => {
    const { client } = scripted(() => ({ text: "주석을 만들지 못했습니다." }));
    const out = await annotateFile(new AiSession(client), "app/db.py", "one\ntwo");
    // The reason matters: prose back is a different problem from a call that never landed,
    // and a bare "failed" leaves nothing to act on but a blind retry.
    expect(out).toEqual({ status: "failed", items: [], reason: "parse" });
  });

  it("fails the file when the call itself failed", async () => {
    const { client } = scripted(() => ({ ok: false, error: "Timeout after 180s" }));
    const out = await annotateFile(new AiSession(client), "app/db.py", "one\ntwo");
    expect(out).toEqual({ status: "failed", items: [], reason: "call" });
  });

  it("drops a range the file cannot contain", async () => {
    // The file's own length is the only check on a line number the model made up.
    const { client } = scripted(() => ({ text: notes([40, 60]) }));
    const out = await annotateFile(new AiSession(client), "app/db.py", "one\ntwo");
    expect(out.status).toBe("failed");
    expect(out.items).toHaveLength(0);
    // Answering about lines the file does not have is not the same failure as answering in
    // prose, and only one of the two is worth spending another call on.
    expect(out.reason).toBe("dropped");
  });
});

describe("annotateProject", () => {
  it("sends exactly one call per file, in order", async () => {
    // Resuming a session puts the call in the follow-up class, which the server cuts at 180s.
    // A whole project in one call is far past that, so per-file is forced rather than chosen.
    const { client, sent } = scripted(() => ({ text: notes([1, 1]) }));
    const set = await annotateProject(new AiSession(client), PROJECT);

    expect(sent).toHaveLength(PROJECT.files.length);
    expect(sent[0].prompt).toContain("app/db.py");
    expect(sent[1].prompt).toContain("app/main.py");
    expect(sent[2].prompt).toContain("README.md");
    expect(Object.keys(set.files)).toEqual(PROJECT.files.map((f) => f.path));
  });

  it("resumes the same session instead of re-sending the codebase", async () => {
    const { client, sent } = scripted(() => ({ text: notes([1, 1]) }));
    const session = new AiSession(client);
    session.adopt("sid-from-generation");
    await annotateProject(session, PROJECT);
    expect(sent.every((r) => r.session_id === "sid-from-generation" || r.session_id === "s1")).toBe(true);
    expect(sent[0].session_id).toBe("sid-from-generation");
  });

  it("keeps going when one file fails", async () => {
    // Thirteen annotated files and one that failed is still worth reading.
    const { client } = scripted((n) => (n === 2 ? { ok: false, error: "boom" } : { text: notes([1, 1]) }));
    const set = await annotateProject(new AiSession(client), PROJECT);
    expect(set.files["app/db.py"].status).toBe("ok");
    expect(set.files["app/main.py"].status).toBe("failed");
    expect(set.files["README.md"].status).toBe("ok");
  });

  it("does not retry a file inside the pass", async () => {
    const { client, sent } = scripted(() => ({ ok: false, error: "boom" }));
    await annotateProject(new AiSession(client), PROJECT);
    expect(sent).toHaveLength(PROJECT.files.length);
  });

  it("reports progress for every file and then completion", async () => {
    const { client } = scripted(() => ({ text: notes([1, 1]) }));
    const seen: [number, number, string][] = [];
    await annotateProject(new AiSession(client), PROJECT, (d, t, p) => seen.push([d, t, p]));
    expect(seen).toEqual([
      [0, 3, "app/db.py"],
      [1, 3, "app/main.py"],
      [2, 3, "README.md"],
      [3, 3, ""],
    ]);
  });

  it("asks at the medium tier, never the generation tier", async () => {
    const { client, sent } = scripted(() => ({ text: notes([1, 1]) }));
    await annotateProject(new AiSession(client), PROJECT);
    expect(sent.every((r) => r.effort === "medium")).toBe(true);
  });
});

describe("the annotation prompt", () => {
  it("restates the source with real line numbers", () => {
    // The line numbers are the whole join key between a note and the code; a model counting them
    // out of JSON already in its context is not something to rely on.
    const p = buildAnnotatePrompt("app/db.py", "alpha\nbeta\ngamma");
    expect(p).toContain("001| alpha");
    expect(p).toContain("002| beta");
    expect(p).toContain("003| gamma");
  });

  it("does not carry the code-quality clause", () => {
    // Nothing is being written here. Offering the clause invites the model to improve the
    // project the learner is about to read.
    expect(buildAnnotateSystem()).not.toContain(QUALITY_CLAUSE);
    expect(buildAnnotateSystem()).toMatch(/Do not modify/);
  });
});

describe("who the explanation is written for", () => {
  // The level is stated once and shared. Written into each path separately it drifts, and then
  // one surface quietly explains at a harder level than the others with nothing to catch it.
  it("reaches every explaining path", () => {
    const target = { path: "app/db.py", lines: [1, 2] as [number, number] };
    const paths = {
      주석: buildAnnotateSystem(),
      렌즈: buildExplainPrompt({ target, lens: "flow" }),
      질문: buildAskPrompt({ target, question: "왜?", depth: "semi" }),
      스크랩: buildScrapExplainPrompt(
        [{ id: "s1", path: "app/db.py", lines: [1, 2] as [number, number], code: "x" }],
        "flow",
      ),
    };
    for (const [name, prompt] of Object.entries(paths)) {
      expect(prompt, name).toContain(AUDIENCE_CLAUSE);
    }
  });

  it("does not reach generation, which writes code rather than explaining it", () => {
    expect(buildAnnotateSystem()).toContain(AUDIENCE_CLAUSE);
    expect(QUALITY_CLAUSE).not.toContain(AUDIENCE_CLAUSE);
  });

  it("asks for terms to be glossed where they appear", () => {
    // The level is not "say less" but "assume less": a term may be used, it just has to be
    // explained on the spot.
    expect(AUDIENCE_CLAUSE).toContain("풀어");
    expect(AUDIENCE_CLAUSE).toContain("쉽게 쓰되 줄이지 마세요");
  });
});
