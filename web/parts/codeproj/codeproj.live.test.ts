// FR-1 live smoke test. Opt-in.
//
// There is no vitest config in this repo, so vitest applies its own default include
// glob and this file IS picked up by a plain `npm test`. The name buys nothing; the
// gate has to live inside the file. Without LH_LIVE the whole suite is skipped.
//
//   LH_LIVE=1 LH_LIVE_TOKEN=<token> npx vitest run parts/codeproj/codeproj.live.test.ts
//
// One run forks a real `claude` CLI at effort "xhigh" and may hold the socket open
// for up to 30 minutes (bot/ai.py TIMEOUT_BY_KIND.generate = 1800s).
//
// It calls POST /ai directly rather than going through AiSession.generateProject,
// because that helper collapses both a transport failure and an unparseable body
// into a bare null and the raw text is exactly what this test exists to capture.
import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { buildGenerateSystem, buildGeneratePrompt } from "./prompts";
import { parseProject } from "./model";
import type { GenerateInput } from "./model";

const LIVE = process.env.LH_LIVE === "1";

const SERVER = process.env.LH_LIVE_URL ?? "http://127.0.0.1:8765";
const TOKEN = process.env.LH_LIVE_TOKEN ?? "";
const MODEL = process.env.LH_LIVE_MODEL ?? "claude-opus-5[1m]";
// cwd is learning-harness/web when run through npm; the instance sits two levels up.
const OUT = process.env.LH_LIVE_OUT ?? resolve(process.cwd(), "../../Coding-GO/docs/verification/2026-09-02-fr1");
const WATCH = process.env.LH_LIVE_WATCH ?? resolve(process.cwd(), "../../Coding-GO");

const INPUT: GenerateInput = {
  topic: "도서 대출 관리 REST API (등록, 대출, 반납, 연체 조회)",
  scale: "medium",
  seed: "FastAPI + SQLite",
};

// Directories that churn on their own and would make G8 a false alarm.
const IGNORED = new Set(["state", ".git", "node_modules", "__pycache__", ".playwright-mcp", "docs"]);

function walk(dir: string, base: string, acc: string[]): string[] {
  for (const name of readdirSync(dir).sort()) {
    if (IGNORED.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, base, acc);
    else acc.push(relative(base, full).split(sep).join("/"));
  }
  return acc;
}

describe.skipIf(!LIVE)("FR-1 live generation smoke", () => {
  it(
    "generates a parseable project and leaves nothing on disk",
    async () => {
      expect(TOKEN, "LH_LIVE_TOKEN must be set for a live run").not.toBe("");
      mkdirSync(OUT, { recursive: true });

      // G8 baseline, taken before the call.
      const before = walk(WATCH, WATCH, []);

      const started = Date.now();
      const res = await fetch(`${SERVER}/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AI-Token": TOKEN },
        body: JSON.stringify({
          prompt: buildGeneratePrompt(INPUT),
          system: buildGenerateSystem(),
          model: MODEL,
          // Matches the only production call site (session.ts generateProject),
          // which sends xhigh. The server would otherwise default this to "low".
          effort: "xhigh",
          session_id: null,
        }),
      });
      const elapsedMs = Date.now() - started;

      // An AI-level failure still answers HTTP 200 with ok:false in the body
      // (ai_server.py always serializes a result), so status only catches transport.
      expect(res.status, "transport-level failure").toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        text: string;
        session_id: string | null;
        error: string | null;
      };

      // Write the raw response FIRST. Everything below can fail; the evidence must survive.
      writeFileSync(
        join(OUT, "response.raw.json"),
        JSON.stringify({ input: INPUT, model: MODEL, effort: "xhigh", elapsed_ms: elapsedMs, response: body }, null, 2),
        "utf-8",
      );

      // G1
      expect(body.ok, `ok:false — ${body.error}`).toBe(true);
      expect(body.session_id, "no session_id to resume").toBeTruthy();

      // G7 — the 2026-07-21 failure returned prose with fabricated tool-call blocks.
      expect(body.text).not.toContain("<invoke");
      expect(body.text).not.toContain("<parameter");

      // G2
      const project = parseProject(body.text);
      expect(project, "parseProject returned null; see response.raw.json").not.toBeNull();
      writeFileSync(join(OUT, "project.parsed.json"), JSON.stringify(project, null, 2), "utf-8");

      // G4
      const paths = project!.files.map((f) => f.path);
      expect(new Set(paths).size, "duplicate paths").toBe(paths.length);
      for (const p of paths) {
        expect(p.startsWith("/"), `absolute path: ${p}`).toBe(false);
        expect(p.includes(".."), `traversal in path: ${p}`).toBe(false);
      }

      // G3 / G5 — recorded, not gated. The 7-15 / 400-900 band comes from SCALE_GUIDE,
      // not from measurement, so a run outside it needs a written justification in
      // checklist.md rather than a hard failure here.
      const lines = project!.files.reduce((n, f) => n + f.content.split(/\r?\n/).length, 0);
      const stats = {
        files: project!.files.length,
        lines,
        elapsed_ms: elapsedMs,
        session_id: body.session_id,
        title: project!.title,
        entrypoints: project!.entrypoints ?? null,
        band_files: "7-15",
        band_lines: "400-900",
        in_band: project!.files.length >= 7 && project!.files.length <= 15 && lines >= 400 && lines <= 900,
      };
      writeFileSync(join(OUT, "stats.json"), JSON.stringify(stats, null, 2), "utf-8");
      expect(project!.files.length).toBeGreaterThan(0);
      expect(lines).toBeGreaterThan(0);

      // G8 — nothing was written to the instance tree.
      expect(walk(WATCH, WATCH, [])).toEqual(before);

      // G6 — no orphaned CLI process left behind (contract C9).
      const sess = await fetch(`${SERVER}/sessions`, { headers: { "X-AI-Token": TOKEN } });
      expect(((await sess.json()) as { active: number }).active).toBe(0);
    },
    1_900_000,
  );
});
