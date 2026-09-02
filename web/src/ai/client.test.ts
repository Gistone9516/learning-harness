import { describe, it, expect } from "vitest";
import { createAiClient, AiSession, type AiResponse } from "./client";

function mockFetch(handler: (url: string, init?: RequestInit) => { status: number; json?: any }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: any, init?: any) => {
    calls.push({ url: String(url), init });
    const r = handler(String(url), init);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.json,
    } as Response;
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("ai client", () => {
  it("POSTs /ai with token header, effort, and model", async () => {
    const { f, calls } = mockFetch(() => ({ status: 200, json: { ok: true, text: "hi", session_id: "s1", error: null } }));
    const client = createAiClient({ baseUrl: "http://x:8765", token: "tok", model: "claude-opus-5[1m]", fetchImpl: f });
    const res = await client.ai({ prompt: "hello" });
    expect(res).toEqual({ ok: true, text: "hi", session_id: "s1", error: null } satisfies AiResponse);
    expect(calls[0].url).toBe("http://x:8765/ai");
    expect((calls[0].init as any).method).toBe("POST");
    expect((calls[0].init as any).headers["X-AI-Token"]).toBe("tok");
    const body = JSON.parse((calls[0].init as any).body);
    expect(body).toMatchObject({ prompt: "hello", effort: "medium", model: "claude-opus-5[1m]" });
  });

  it("returns ok:false on non-2xx", async () => {
    const { f } = mockFetch(() => ({ status: 401 }));
    const client = createAiClient({ baseUrl: "http://x", token: "bad", fetchImpl: f });
    const res = await client.ai({ prompt: "x" });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("HTTP 401");
  });

  it("returns ok:false when fetch throws", async () => {
    const f = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
    const client = createAiClient({ baseUrl: "http://x", token: "t", fetchImpl: f });
    const res = await client.ai({ prompt: "x" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("network down");
  });

  it("health() hits /health", async () => {
    const { f, calls } = mockFetch(() => ({ status: 200, json: { ok: true } }));
    const client = createAiClient({ baseUrl: "http://x", token: "t", fetchImpl: f });
    expect(await client.health()).toBe(true);
    expect(calls[0].url).toBe("http://x/health");
  });

  it("AiSession mints then resumes the session id", async () => {
    let n = 0;
    const { f, calls } = mockFetch(() => {
      n += 1;
      // first call mints sid-9; later calls echo whatever they were given (server resumes)
      return { status: 200, json: { ok: true, text: `r${n}`, session_id: "sid-9", error: null } };
    });
    const session = new AiSession(createAiClient({ baseUrl: "http://x", token: "t", fetchImpl: f }));
    await session.send({ prompt: "generate" });
    expect(JSON.parse((calls[0].init as any).body).session_id).toBe(null); // first: new session
    expect(session.sessionId).toBe("sid-9");
    await session.send({ prompt: "explain X" });
    expect(JSON.parse((calls[1].init as any).body).session_id).toBe("sid-9"); // second: resume
  });

  it("adopt() resumes a session minted by an earlier visit", async () => {
    // Reopening an archived project has to reach the session that already holds the codebase,
    // and it must do so without spending a call: adopt sets the id, the next send uses it.
    const { f, calls } = mockFetch(() => ({ status: 200, json: { ok: true, text: "r", session_id: "old-sid", error: null } }));
    const session = new AiSession(createAiClient({ baseUrl: "http://x", token: "t", fetchImpl: f }));
    session.adopt("old-sid");
    expect(session.sessionId).toBe("old-sid");
    expect(calls.length).toBe(0); // adopting costs nothing
    await session.send({ prompt: "explain X" });
    expect(JSON.parse((calls[0].init as any).body).session_id).toBe("old-sid");
  });

  it("adopt(null) leaves the next send minting a new session", async () => {
    const { f, calls } = mockFetch(() => ({ status: 200, json: { ok: true, text: "r", session_id: "fresh", error: null } }));
    const session = new AiSession(createAiClient({ baseUrl: "http://x", token: "t", fetchImpl: f }));
    session.adopt(null);
    await session.send({ prompt: "generate" });
    expect(JSON.parse((calls[0].init as any).body).session_id).toBe(null);
  });

  it("carries error_kind through so a lost session is distinguishable", async () => {
    // The server answers 200 with ok:false for every AI-level failure, so this field is the
    // only thing separating "your session is gone, resend the codebase" from "that model does
    // not exist" -- and reseeding on the wrong one costs a whole generation budget.
    const { f } = mockFetch(() => ({
      status: 200,
      json: { ok: false, text: "", session_id: null, error: "claude exit code 1: No conversation found", error_kind: "resume_missing" },
    }));
    const session = new AiSession(createAiClient({ baseUrl: "http://x", token: "t", fetchImpl: f }));
    session.adopt("dead-sid");
    const res = await session.send({ prompt: "explain X" });
    expect(res.ok).toBe(false);
    expect(res.error_kind).toBe("resume_missing");
    // A failed send must not clear the id: the reseed needs to know which session was lost.
    expect(session.sessionId).toBe("dead-sid");
  });
});
