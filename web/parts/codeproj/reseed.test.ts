// FR-9: what happens when the session a call tried to resume is gone.
//
// The cost asymmetry is the whole point. Retrying is one small follow-up; reseeding re-sends the
// entire codebase. So the retry must fire on exactly one failure kind and never on the others,
// and it must be budgeted.
import { describe, it, expect, vi } from "vitest";
import type { AiClient, AiResponse } from "../../src/ai/client";
import { AiSession } from "../../src/ai/client";
import { explain, reseedSession } from "./session";
import { buildReseedSystem } from "./prompts";

const PROJECT = {
  title: "도서 관리 API",
  summary: "요약",
  files: [{ path: "src/main.py", content: "a\nb\nc" }],
};

const TARGET = { target: { path: "src/main.py" }, lens: "overview" as const };

/** A client whose replies are scripted turn by turn, recording what it was sent. */
function scripted(replies: Partial<AiResponse>[]) {
  const sent: any[] = [];
  let n = 0;
  const client = {
    ai: vi.fn(async (req: any) => {
      sent.push(req);
      const r = replies[Math.min(n, replies.length - 1)];
      n += 1;
      return { ok: true, text: "ANSWER", session_id: "s1", error: null, ...r } as AiResponse;
    }),
    problems: vi.fn(),
    health: vi.fn(async () => true),
  } as unknown as AiClient;
  return { client, sent };
}

const lost: Partial<AiResponse> = { ok: false, text: "", error: "no conversation found", error_kind: "resume_missing" };

describe("reseed on a lost session", () => {
  it("restores the codebase once and answers the original question", async () => {
    const { client, sent } = scripted([lost, { text: "OK" }, { text: "REAL ANSWER" }]);
    const session = new AiSession(client);
    session.adopt("dead-sid");
    const reseed = vi.fn(async () => reseedSession(session, PROJECT));

    const text = await explain(session, TARGET, "a\nb\nc", reseed);

    expect(reseed).toHaveBeenCalledTimes(1);
    expect(text).toBe("REAL ANSWER");
    expect(sent).toHaveLength(3);
    expect(sent[0].session_id).toBe("dead-sid");   // the attempt that failed
    expect(sent[1].session_id).toBe(null);         // reseed mints a fresh session
    expect(sent[2].session_id).toBe("s1");         // the retry resumes it
  });

  it("does not reseed on any other failure", async () => {
    // A timeout means the model is still working, not that the session is gone. Re-sending a
    // codebase here would spend a full context for nothing.
    const timedOut: Partial<AiResponse> = { ok: false, text: "", error: "Timeout after 180s" };
    const { client, sent } = scripted([timedOut]);
    const session = new AiSession(client);
    const reseed = vi.fn(async () => true);

    const text = await explain(session, TARGET, undefined, reseed);

    expect(reseed).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(text).toContain("설명을 불러오지 못했습니다");
  });

  it("gives up when the reseed itself is refused, instead of looping", async () => {
    const { client, sent } = scripted([lost]);
    const session = new AiSession(client);
    const reseed = vi.fn(async () => false);   // budget spent

    const text = await explain(session, TARGET, undefined, reseed);

    expect(reseed).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);              // no retry was attempted
    expect(text).toContain("설명을 불러오지 못했습니다");
  });

  it("does nothing when no reseed was supplied", async () => {
    const { client, sent } = scripted([lost]);
    const session = new AiSession(client);
    const text = await explain(session, TARGET);
    expect(sent).toHaveLength(1);
    expect(text).toContain("설명을 불러오지 못했습니다");
  });

  it("sends the codebase as a new session and asks for nothing to be generated", async () => {
    const { client, sent } = scripted([{ text: "loaded" }]);
    const session = new AiSession(client);
    session.adopt("dead-sid");

    expect(await reseedSession(session, PROJECT)).toBe(true);
    expect(sent[0].session_id).toBe(null);              // reset(), so the server gives it the
    expect(sent[0].prompt).toContain("src/main.py");    // long timeout, not the follow-up one
    expect(sent[0].effort).toBe("medium");

    // The same call loads a repository the first time. An agent CLI handed a codebase with no
    // instruction treats it as work, and the learner would read its rewrite instead of the repo.
    expect(buildReseedSystem()).toMatch(/Do not generate, rewrite, improve/);
  });
});
