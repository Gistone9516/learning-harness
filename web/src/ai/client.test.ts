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
    const client = createAiClient({ baseUrl: "http://x:8765", token: "tok", model: "claude-opus-4-8[1m]", fetchImpl: f });
    const res = await client.ai({ prompt: "hello" });
    expect(res).toEqual({ ok: true, text: "hi", session_id: "s1", error: null } satisfies AiResponse);
    expect(calls[0].url).toBe("http://x:8765/ai");
    expect((calls[0].init as any).method).toBe("POST");
    expect((calls[0].init as any).headers["X-AI-Token"]).toBe("tok");
    const body = JSON.parse((calls[0].init as any).body);
    expect(body).toMatchObject({ prompt: "hello", effort: "medium", model: "claude-opus-4-8[1m]" });
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
});
