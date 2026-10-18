import { describe, it, expect, vi } from "vitest";
import { createApiStorage } from "./api";
import { createLocalStorage } from "./local";
import { createBufferedStorage } from "./buffered";
import { makeRecord, type StoragePort } from "./port";

// ── helpers ───────────────────────────────────────────────────────────────────

/** In-memory Storage stand-in (jsdom-free, and lets a test simulate a quota failure). */
function memStorage(): Storage & { failNext?: boolean } {
  const map = new Map<string, string>();
  const api: any = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (api.failNext) {
        api.failNext = false;
        throw new Error("QuotaExceededError");
      }
      map.set(k, v);
    },
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
  return api as Storage & { failNext?: boolean };
}

/** Fake state server: holds records in memory and can be switched offline. */
function fakeServer() {
  const records = new Map<string, any>();
  const docs = new Map<string, any>();
  let reachable = true;
  const calls: string[] = [];

  const f = (async (url: any, init?: any) => {
    calls.push(`${init?.method ?? "GET"} ${String(url)}`);
    if (!reachable) throw new Error("connection refused");
    const path = String(url).split("/state/")[1] ?? "";
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) : undefined;
    const json = (status: number, payload: any) => ({
      ok: status < 300,
      status,
      json: async () => payload,
    }) as Response;

    if (path === "_batch") {
      const results = [];
      for (const r of body.reads) {
        const sub = r.doc !== undefined ? `doc/${r.doc}` : r.list !== undefined ? r.list : `${r.get[0]}/${r.get[1]}`;
        const res = await f(`${String(url).split("/state/")[0]}/state/${sub}`, { method: "GET" });
        calls.pop();
        const out = await res.json();
        results.push(res.ok ? (out.doc ?? out.index ?? out.record ?? null) : null);
      }
      return json(200, { ok: true, results });
    }
    if (path.startsWith("doc/")) {
      const name = path.slice(4);
      if (method === "GET") return json(200, { ok: true, doc: docs.get(name) ?? null });
      docs.set(name, body);
      return json(200, { ok: true, doc: body });
    }
    const [collection, id] = path.split("/");
    if (!id) {
      const entries = [...records.entries()]
        .filter(([k]) => k.startsWith(`${collection}/`))
        .map(([, r]) => ({ id: r.id, kind: r.kind, created_at: r.created_at ?? 1, updated_at: r.updated_at ?? 1, summary: r.summary }));
      return json(200, { ok: true, index: { entries } });
    }
    const key = `${collection}/${id}`;
    if (method === "GET") {
      const rec = records.get(key);
      return rec ? json(200, { ok: true, record: rec }) : json(404, { ok: false, error: "record not found" });
    }
    if (method === "PUT") {
      records.set(key, { ...body, created_at: body.created_at ?? 1, updated_at: 2 });
      return json(200, { ok: true, entry: { id, summary: body.summary } });
    }
    if (method === "DELETE") {
      const existed = records.delete(key);
      return json(200, { ok: true, deleted: existed });
    }
    return json(405, { ok: false, error: "method not allowed" });
  }) as unknown as typeof fetch;

  return {
    fetchImpl: f,
    records,
    calls,
    goOffline: () => void (reachable = false),
    goOnline: () => void (reachable = true),
  };
}

function buffered(server: ReturnType<typeof fakeServer>, onOnlineChange?: (v: boolean) => void) {
  const primary = createApiStorage({ baseUrl: "http://x", token: "t", fetchImpl: server.fetchImpl, onOnlineChange });
  const buffer = createLocalStorage({ namespace: "test", store: memStorage(), now: () => 7 });
  return { port: createBufferedStorage({ primary, buffer }), primary, buffer };
}

const rec = (id: string, title = id) => makeRecord("project", id, { title }, { body: "x" });

// ── shared contract ───────────────────────────────────────────────────────────

function contractTests(name: string, make: () => StoragePort) {
  describe(`${name} (StoragePort contract)`, () => {
    it("round-trips a record and lists it from the index", async () => {
      const port = make();
      expect(await port.put("projects", rec("prj-a", "A"))).toBe(true);
      const got = await port.get<{ body: string }>("projects", "prj-a");
      expect(got?.data.body).toBe("x");
      const entries = await port.list("projects");
      expect(entries.map((e) => e.id)).toEqual(["prj-a"]);
      expect(entries[0].summary).toEqual({ title: "A" });
    });

    it("upserts rather than duplicating", async () => {
      const port = make();
      await port.put("projects", rec("prj-a", "A"));
      await port.put("projects", rec("prj-a", "A2"));
      const entries = await port.list("projects");
      expect(entries).toHaveLength(1);
      expect(entries[0].summary).toEqual({ title: "A2" });
    });

    it("removes a record and its entry", async () => {
      const port = make();
      await port.put("projects", rec("prj-a"));
      expect(await port.remove("projects", "prj-a")).toBe(true);
      expect(await port.get("projects", "prj-a")).toBeNull();
      expect(await port.list("projects")).toEqual([]);
    });

    it("round-trips a doc and reads a missing one as null", async () => {
      const port = make();
      expect(await port.getDoc("tuning")).toBeNull();
      await port.putDoc("tuning", { defaults: { scale: "medium" } });
      expect(await port.getDoc<any>("tuning")).toEqual({ defaults: { scale: "medium" } });
    });

    it("rejects names that could escape the store", async () => {
      const port = make();
      expect(await port.put("../escape", rec("prj-a"))).toBe(false);
      expect(await port.put("projects", rec("../escape" as string))).toBe(false);
      expect(await port.get("projects", "UPPER")).toBeNull();
    });
  });
}

contractTests("api adapter", () => createApiStorage({ baseUrl: "http://x", token: "t", fetchImpl: fakeServer().fetchImpl }));
contractTests("local adapter", () => createLocalStorage({ namespace: "test", store: memStorage() }));
contractTests("buffered decorator", () => buffered(fakeServer()).port);

// ── medium-specific behaviour ────────────────────────────────────────────────

describe("api adapter", () => {
  it("sends the token header and never puts it in the URL", async () => {
    const server = fakeServer();
    const port = createApiStorage({ baseUrl: "http://x", token: "secret", fetchImpl: server.fetchImpl });
    await port.list("projects");
    expect(server.calls[0]).toBe("GET http://x/state/projects");
    expect(server.calls[0]).not.toContain("secret");
  });

  it("reports offline only for transport failures, not for a 4xx answer", async () => {
    const server = fakeServer();
    const port = createApiStorage({ baseUrl: "http://x", token: "t", fetchImpl: server.fetchImpl });
    expect(await port.get("projects", "missing")).toBeNull();
    expect(port.online).toBe(true);          // a 404 means the server answered
    server.goOffline();
    await port.list("projects");
    expect(port.online).toBe(false);
  });
});

describe("local adapter", () => {
  it("stores one key per record, never an accumulating array", async () => {
    const store = memStorage();
    const port = createLocalStorage({ namespace: "test", store });
    await port.put("projects", rec("prj-a"));
    await port.put("projects", rec("prj-b"));
    const keys = Array.from({ length: store.length }, (_, i) => store.key(i)!);
    expect(keys).toContain("lh:test:projects:prj-a");
    expect(keys).toContain("lh:test:projects:prj-b");
  });

  it("reports a failed write instead of pretending it saved", async () => {
    const store = memStorage();
    const port = createLocalStorage({ namespace: "test", store });
    store.failNext = true;
    expect(await port.put("projects", rec("prj-a"))).toBe(false);
  });
});

describe("buffered decorator", () => {
  it("keeps accepting writes while the server is down, then flushes them in order", async () => {
    const server = fakeServer();
    const { port } = buffered(server);

    server.goOffline();
    await port.list("projects");                       // notice the outage
    expect(await port.put("projects", rec("prj-a"))).toBe(true);
    expect(await port.put("projects", rec("prj-b"))).toBe(true);
    expect(server.records.size).toBe(0);
    // Reads still work offline, from the buffer.
    expect((await port.get("projects", "prj-a"))?.id).toBe("prj-a");

    server.goOnline();
    const moved = await port.flush();
    expect(moved).toBe(2);
    expect([...server.records.keys()].sort()).toEqual(["projects/prj-a", "projects/prj-b"]);
  });

  it("flushing twice is idempotent", async () => {
    const server = fakeServer();
    const { port } = buffered(server);
    server.goOffline();
    await port.list("projects");
    await port.put("projects", rec("prj-a"));
    server.goOnline();

    expect(await port.flush()).toBe(1);
    expect(await port.flush()).toBe(0);
    expect(server.records.size).toBe(1);
  });

  it("surfaces reachability changes once, for a single UI notice", async () => {
    const server = fakeServer();
    const onOnlineChange = vi.fn();
    const { port } = buffered(server, onOnlineChange);

    server.goOffline();
    await port.list("projects");
    await port.list("projects");
    expect(onOnlineChange).toHaveBeenCalledTimes(1);
    expect(onOnlineChange).toHaveBeenLastCalledWith(false);

    server.goOnline();
    await port.list("projects");
    expect(onOnlineChange).toHaveBeenLastCalledWith(true);
  });
});

// ── read coalescing and the boot snapshot (web-contract §5) ─────────────────────

describe("api adapter round trips", () => {
  it("reads issued together go out as one _batch; a lone read stays plain", async () => {
    const server = fakeServer();
    const port = createApiStorage({ baseUrl: "http://x", token: "t", fetchImpl: server.fetchImpl });
    await port.put("terms", rec("ebs"));
    await port.put("terms", rec("efs"));
    await port.putDoc("outline", { areas: [] });
    server.calls.length = 0;
    const [a, b, missing, doc] = await Promise.all([
      port.get("terms", "ebs"), port.get("terms", "efs"), port.get("terms", "nope"), port.getDoc("outline"),
    ]);
    expect(server.calls).toEqual(["POST http://x/state/_batch"]);
    expect([a?.id, b?.id, missing, doc]).toEqual(["ebs", "efs", null, { areas: [] }]);
    server.calls.length = 0;
    expect((await port.get("terms", "ebs"))?.id).toBe("ebs");
    expect(server.calls).toEqual(["GET http://x/state/terms/ebs"]);
  });

  it("falls back to single reads when the server has no _batch", async () => {
    const server = fakeServer();
    const plain = (async (url: any, init?: any) => {
      if (String(url).endsWith("/state/_batch")) return { ok: false, status: 404, json: async () => ({ ok: false }) } as Response;
      return server.fetchImpl(url, init);
    }) as unknown as typeof fetch;
    const port = createApiStorage({ baseUrl: "http://x", token: "t", fetchImpl: plain });
    await port.put("terms", rec("ebs"));
    const [a, b] = await Promise.all([port.get("terms", "ebs"), port.get("terms", "nope")]);
    expect([a?.id, b]).toEqual(["ebs", null]);
  });

  it("the snapshot answers docs and listings until a write drops them", async () => {
    const server = fakeServer();
    const snapshot = {
      docs: { outline: { areas: ["snap"] } },
      indexes: { terms: { entries: [{ id: "ebs", kind: "term", created_at: 1, updated_at: 1, summary: {} }] } },
    };
    const port = createApiStorage({ baseUrl: "http://x", token: "t", fetchImpl: server.fetchImpl, snapshot });
    expect(await port.getDoc("outline")).toEqual({ areas: ["snap"] });
    expect(await port.getDoc("notebook-meta")).toBeNull();
    expect((await port.list("terms")).map((e) => e.id)).toEqual(["ebs"]);
    expect(await port.list("threads")).toEqual([]);
    expect(server.calls).toEqual([]);
    await port.putDoc("outline", { areas: ["new"] });
    await port.put("terms", rec("efs"));
    server.calls.length = 0;
    expect(await port.getDoc("outline")).toEqual({ areas: ["new"] });
    expect((await port.list("terms")).map((e) => e.id)).toEqual(["efs"]);
    expect(server.calls).toEqual(["GET http://x/state/doc/outline", "GET http://x/state/terms"]);
  });
});

