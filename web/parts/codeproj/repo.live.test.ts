// FR-1 live measurement: a real repository through the real server and the real CLI. Opt-in.
//
//   LH_LIVE=1 LH_LIVE_TOKEN=<token> LH_LIVE_REPO=<url or folder> npx vitest run parts/codeproj/repo.live.test.ts
//
// Optional: LH_LIVE_REF, LH_LIVE_GOAL, LH_LIVE_FOCUS, LH_LIVE_SCOPE (comma separated),
// LH_LIVE_ANNOTATE (files to annotate, default 2), LH_LIVE_OUT (evidence folder).
//
// The numbers this exists for have none behind them yet: how long the server takes to read a
// repository, how long a session takes to hold one of a given size (the only neighbour is a
// 14-file generated project), and whether the per-file annotation time measured on generated code
// (37s) carries over to code nobody wrote for the prompt.
//
// It talks to the server over node:http rather than fetch: Node's fetch gives up after 300s with no
// headers (measured 2026-09-05 on the generation this replaced), and loading a large codebase can
// be that slow. The prompt builders and parsers are imported, never re-typed, so what is measured is
// what ships.
import { describe, it, expect } from "vitest";
import { request as httpRequest } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RepoLoadResponse } from "../../src/ai/client";
import { annotationOrder, parseScope, projectFromRepo } from "./model";
import { buildAnnotatePrompt, buildAnnotateSystem, buildFocusPrompt, buildFocusSystem, buildReseedPrompt, buildReseedSystem } from "./prompts";
import { carveJson } from "./components/parse";
import { parseAnnotations } from "./annotations";
import { ENTRY_ANNOTATE_MAX } from "./session";

const LIVE = process.env.LH_LIVE === "1";
const SERVER = process.env.LH_LIVE_URL ?? "http://127.0.0.1:8765";
const TOKEN = process.env.LH_LIVE_TOKEN ?? "";
const MODEL = process.env.LH_LIVE_MODEL ?? "claude-opus-5[1m]";
const SOURCE = process.env.LH_LIVE_REPO ?? "";
const REF = process.env.LH_LIVE_REF || null;
const REQUEST = {
  goal: process.env.LH_LIVE_GOAL ?? "",
  focus: process.env.LH_LIVE_FOCUS ?? "",
  scope: parseScope((process.env.LH_LIVE_SCOPE ?? "").split(",").join("\n")),
};
const ANNOTATE = Number(process.env.LH_LIVE_ANNOTATE ?? "2");
// cwd is learning-harness/web when run through npm; the instance sits two levels up.
const OUT = process.env.LH_LIVE_OUT ?? resolve(process.cwd(), "../../Coding-GO/docs/verification/repo-live");

function post(path: string, body: unknown): Promise<{ status: number; json: any; seconds: number }> {
  const target = new URL(SERVER + path);
  const text = JSON.stringify(body);
  const started = Date.now();
  return new Promise((done, fail) => {
    const req = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AI-Token": TOKEN, "Content-Length": Buffer.byteLength(text).toString() },
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf-8");
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => done({ status: res.statusCode ?? 0, json: JSON.parse(raw || "{}"), seconds: (Date.now() - started) / 1000 }));
      },
    );
    req.on("error", fail);
    req.write(text);
    req.end();
  });
}

describe.skipIf(!LIVE)("FR-1 live repository load", () => {
  it(
    "reads a repository, holds it in a session, and annotates the first files for the request",
    async () => {
      expect(TOKEN, "LH_LIVE_TOKEN must be set for a live run").not.toBe("");
      expect(SOURCE, "LH_LIVE_REPO must name a repository URL or folder").not.toBe("");
      mkdirSync(OUT, { recursive: true });
      const report: Record<string, unknown> = { measured_at: new Date().toISOString(), source: SOURCE, ref: REF, model: MODEL, request: REQUEST };
      const save = () => writeFileSync(resolve(OUT, "repo.measured.json"), JSON.stringify(report, null, 2), "utf-8");

      const load = await post("/repos/load", { source: SOURCE, ref: REF, include: REQUEST.scope });
      const loaded = load.json as RepoLoadResponse;
      report.load = loaded.ok
        ? { seconds: load.seconds, files: loaded.files.length, bytes: loaded.total_bytes, commit: loaded.commit, skipped: loaded.skipped }
        : { seconds: load.seconds, failed: loaded };
      save();
      expect(loaded.ok, `load failed: ${JSON.stringify(loaded)}`).toBe(true);
      if (!loaded.ok) return;

      const project = projectFromRepo(loaded);
      const seed = await post("/ai", { prompt: buildReseedPrompt(project), system: buildReseedSystem(), model: MODEL, effort: "medium" });
      report.session = { seconds: seed.seconds, ok: seed.json.ok, error: seed.json.error ?? null };
      save();
      expect(seed.json.ok, `session load failed: ${seed.json.error}`).toBe(true);
      const sessionId = seed.json.session_id as string;

      const paths = project.files.map((f) => f.path);
      let first: string[] = [];
      if (paths.length > ENTRY_ANNOTATE_MAX && (REQUEST.goal || REQUEST.focus)) {
        const pick = await post("/ai", {
          prompt: buildFocusPrompt(paths, REQUEST, ENTRY_ANNOTATE_MAX),
          system: buildFocusSystem(),
          session_id: sessionId,
          model: MODEL,
          effort: "medium",
        });
        const carved = pick.json.ok ? carveJson(pick.json.text ?? "") : null;
        const listed = carved ? ((JSON.parse(carved).paths ?? []) as unknown[]) : [];
        first = listed.filter((p): p is string => typeof p === "string" && paths.includes(p));
        report.focus = { seconds: pick.seconds, asked: listed.length, usable: first.length, picked: first };
        save();
      }

      const notes: Record<string, unknown>[] = [];
      for (const path of annotationOrder(paths, first).slice(0, ANNOTATE)) {
        const file = project.files.find((f) => f.path === path)!;
        const res = await post("/ai", {
          prompt: buildAnnotatePrompt(path, file.content, REQUEST),
          system: buildAnnotateSystem(),
          session_id: sessionId,
          model: MODEL,
          effort: "medium",
        });
        const carved = res.json.ok ? carveJson(res.json.text ?? "") : null;
        const parsed = carved ? parseAnnotations(JSON.parse(carved), file.content.split("\n").length) : null;
        notes.push({ path, lines: file.content.split("\n").length, seconds: res.seconds, ok: res.json.ok, status: parsed?.status ?? "failed", items: parsed?.items.length ?? 0 });
        report.annotations = notes;
        save();
      }
      expect(notes.every((n) => (n.seconds as number) < 180), "each file must fit inside the 180s follow-up ceiling").toBe(true);
    },
    3_600_000,
  );
});
