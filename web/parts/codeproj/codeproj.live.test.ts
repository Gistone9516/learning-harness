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
import { request as httpRequest } from "node:http";
import { mkdirSync, writeFileSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { buildAnnotatePrompt, buildAnnotateSystem, buildExplainPrompt, buildGenerateSystem, buildGeneratePrompt } from "./prompts";
import { parseComposed } from "./components/parse";
import { parseProject, sliceLines } from "./model";
import { annotateFile, annotateProject } from "./session";
import { AiSession, createAiClient } from "../../src/ai/client";
import type { ExplainRequest, GenerateInput } from "./model";

const LIVE = process.env.LH_LIVE === "1";

const SERVER = process.env.LH_LIVE_URL ?? "http://127.0.0.1:8765";
const TOKEN = process.env.LH_LIVE_TOKEN ?? "";
const MODEL = process.env.LH_LIVE_MODEL ?? "claude-opus-5[1m]";
// cwd is learning-harness/web when run through npm; the instance sits two levels up.
const OUT = process.env.LH_LIVE_OUT ?? resolve(process.cwd(), "../../Coding-GO/docs/verification/2026-09-02-fr1");
const WATCH = process.env.LH_LIVE_WATCH ?? resolve(process.cwd(), "../../Coding-GO");

// Overridable, because the interesting runs are the ones that FAILED in the UI: the app collapses
// every failure into one `null` and throws the response body away, so re-running the same topic
// through this file is the only way to see which branch it actually took.
const INPUT: GenerateInput = {
  topic: process.env.LH_LIVE_TOPIC ?? "도서 대출 관리 REST API (등록, 대출, 반납, 연체 조회)",
  scale: (process.env.LH_LIVE_SCALE as GenerateInput["scale"]) ?? "medium",
  seed: process.env.LH_LIVE_SEED ?? "FastAPI + SQLite",
};

/**
 * POST to ai_server over node:http rather than fetch.
 *
 * Node's fetch (undici) gives up after 300s of silence with UND_ERR_HEADERS_TIMEOUT, and a
 * generation holds the connection open with no headers for exactly that long. Measured
 * 2026-09-05: a run was cut at 306.8s while the server kept generating and finished around 345s,
 * and the response body -- the entire point of this file -- was lost. The browser has no such
 * limit (measured the same day: a 420s request completed in Chrome), so the timeout was an
 * artifact of the harness and made the app look broken when it was not.
 *
 * `timeout` is left unset, so this waits as long as the server does.
 */
function postJson(url: string, headers: Record<string, string>, body: string): Promise<{ status: number; text: string }> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(body).toString() },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf-8");
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

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
      const res = await postJson(
        `${SERVER}/ai`,
        { "Content-Type": "application/json", "X-AI-Token": TOKEN },
        JSON.stringify({
          prompt: buildGeneratePrompt(INPUT),
          system: buildGenerateSystem(),
          model: MODEL,
          // Matches the only production call site (session.ts generateProject),
          // which sends xhigh. The server would otherwise default this to "low".
          effort: "xhigh",
          session_id: null,
        }),
      );
      const elapsedMs = Date.now() - started;

      // An AI-level failure still answers HTTP 200 with ok:false in the body
      // (ai_server.py always serializes a result), so status only catches transport.
      expect(res.status, "transport-level failure").toBe(200);
      // Written before parsing, so a malformed body is still on disk to look at.
      writeFileSync(join(OUT, "response.body.txt"), res.text, "utf-8");
      const body = JSON.parse(res.text) as {
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

      // G2 -- the rejection reason is in the message now, so a failure here says which
      // of prose / wrong-shape / no-files it was without opening the raw file first.
      const parsed = parseProject(body.text);
      expect(
        parsed.ok,
        parsed.ok ? "" : `parseProject rejected the reply: ${parsed.reason} (${parsed.detail ?? ""})`,
      ).toBe(true);
      const project = parsed.ok ? parsed.project : null;
      writeFileSync(join(OUT, "project.parsed.json"), JSON.stringify(project, null, 2), "utf-8");

      // G4
      const paths = project!.files.map((f) => f.path);
      expect(new Set(paths).size, "duplicate paths").toBe(paths.length);
      for (const p of paths) {
        expect(p.startsWith("/"), `absolute path: ${p}`).toBe(false);
        expect(p.includes(".."), `traversal in path: ${p}`).toBe(false);
      }

      // G3 / G5 — recorded, not gated. The band judgement used to live here as a second
      // copy of SCALE_GUIDE and had drifted from it (7-15 / 400-900 against a medium of
      // 10-16 / ~1100). The counts and the scale are recorded; whether they are
      // acceptable is a judgement for checklist.md, where the reasoning can be written.
      const lines = project!.files.reduce((n, f) => n + f.content.split(/\r?\n/).length, 0);
      const stats = {
        files: project!.files.length,
        lines,
        elapsed_ms: elapsedMs,
        session_id: body.session_id,
        title: project!.title,
        entrypoints: project!.entrypoints ?? null,
        scale: INPUT.scale,
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

// FR-19: do composed answer blocks actually come back from a live model, or does every
// answer degrade to prose? If the model ignores the block directive, the 24-type catalogue
// is dead code, which is the most expensive thing this suite can find out.
//
// It resumes an existing session instead of generating again, so it costs one small
// follow-up. Point it at the session id recorded in a previous generation run:
//
//   LH_LIVE_SESSION=<id> LH_LIVE_TOKEN=<token> npx vitest run parts/codeproj/codeproj.live.test.ts
const SESSION = process.env.LH_LIVE_SESSION ?? "";

describe.skipIf(!SESSION)("FR-19 composed answer blocks (live)", () => {
  it(
    "parses a lens explanation into typed blocks",
    async () => {
      const parsed = JSON.parse(readFileSync(join(OUT, "project.parsed.json"), "utf-8")) as {
        files: { path: string; content: string }[];
      };
      // A file with real branching, so a flow lens has something to describe.
      const file = parsed.files.find((f) => f.path.endsWith("services.py")) ?? parsed.files[0];
      const req: ExplainRequest = { target: { path: file.path, lines: [92, 120] }, lens: "flow" };

      const started = Date.now();
      const res = await fetch(`${SERVER}/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AI-Token": TOKEN },
        body: JSON.stringify({
          prompt: buildExplainPrompt(req, sliceLines(file.content, req.target.lines!)),
          model: MODEL,
          effort: "medium",
          session_id: SESSION,
        }),
      });
      const elapsedMs = Date.now() - started;
      const body = (await res.json()) as { ok: boolean; text: string; error: string | null };

      const composed = body.ok ? parseComposed(body.text) : null;
      writeFileSync(
        join(OUT, "measure-C-composed.raw.json"),
        JSON.stringify(
          {
            elapsed_ms: elapsedMs,
            target: req,
            parsed_ok: composed !== null,
            block_types: composed ? composed.blocks.map((b) => b.t) : null,
            response: body,
          },
          null,
          2,
        ),
        "utf-8",
      );

      expect(body.ok, `ok:false — ${body.error}`).toBe(true);
      expect(composed, "parseComposed returned null — answers degrade to prose").not.toBeNull();
      expect(composed!.blocks.length).toBeGreaterThan(0);
    },
    200_000,
  );
});

// FR-20: the annotation pass at real scale, against a project that already exists.
//
// The per-file cost was measured once (37.1s for 61 lines). What was never run is the whole
// sequential pass — the thing the chosen design stands on, since annotations must finish before
// the learner is let in. This resumes the generation's own session rather than paying for a
// second generation.
//
//   LH_LIVE_PASS=1 LH_LIVE_SESSION=<id> LH_LIVE_TOKEN=<token> npx vitest run parts/codeproj/codeproj.live.test.ts
const PASS = process.env.LH_LIVE_PASS === "1";

describe.skipIf(!PASS || !SESSION)("FR-20 annotation pass (live, whole project)", () => {
  it(
    "annotates every file, and reports how long the learner actually waits",
    async () => {
      const project = JSON.parse(readFileSync(join(OUT, "project.parsed.json"), "utf-8")) as {
        files: { path: string; content: string }[];
      };

      const client = createAiClient({ baseUrl: SERVER, token: TOKEN, model: MODEL });
      const session = new AiSession(client);
      session.adopt(SESSION);

      // Timings only. The set is not in scope yet while this runs, and per-file outcomes are
      // read back afterwards anyway.
      const marks: { path: string; ms: number }[] = [];
      const started = Date.now();
      let last = started;

      const set = await annotateProject(session, project as never, (done, total, path) => {
        if (done > 0) {
          const now = Date.now();
          marks.push({ path: project.files[done - 1].path, ms: now - last });
          last = now;
        }
        void total;
        void path;
      });
      const totalMs = Date.now() - started;

      // Recompute per-file results after the fact: the progress callback fires before the file
      // it reports on has finished, so the statuses above are one step behind.
      const perFile = project.files.map((f) => ({
        path: f.path,
        lines: f.content.split(/\r?\n/).length,
        status: set.files[f.path]?.status,
        items: set.files[f.path]?.items.length ?? 0,
      }));

      writeFileSync(
        join(OUT, "measure-D-pass.json"),
        JSON.stringify(
          {
            total_ms: totalMs,
            files: project.files.length,
            ok: perFile.filter((f) => f.status === "ok").length,
            failed: perFile.filter((f) => f.status === "failed").length,
            items: perFile.reduce((n, f) => n + f.items, 0),
            per_file: perFile,
            timings_ms: marks,
            set,
          },
          null,
          2,
        ),
        "utf-8",
      );

      expect(Object.keys(set.files)).toHaveLength(project.files.length);
      // Not "every file succeeded" — one failure is a legitimate outcome the design absorbs.
      // What must hold is that the pass ran to the end and produced something usable.
      expect(perFile.filter((f) => f.status === "ok").length).toBeGreaterThan(0);
    },
    3_000_000,
  );
});

// Diagnose a single file that the whole-project pass could not annotate. One call, so it is
// cheap enough to ask why rather than guess.
//
//   LH_LIVE_ONE=app/logging_setup.py LH_LIVE_SESSION=<id> LH_LIVE_TOKEN=<token> npx vitest run ...
const ONE = process.env.LH_LIVE_ONE ?? "";

describe.skipIf(!ONE || !SESSION)("FR-20 one file (live)", () => {
  it(
    "reports what went wrong, not just that it did",
    async () => {
      const project = JSON.parse(readFileSync(join(OUT, "project.parsed.json"), "utf-8")) as {
        files: { path: string; content: string }[];
      };
      const file = project.files.find((f) => f.path === ONE);
      expect(file, `no such file: ${ONE}`).toBeTruthy();

      const client = createAiClient({ baseUrl: SERVER, token: TOKEN, model: MODEL });
      const session = new AiSession(client);
      session.adopt(SESSION);

      // Capture the raw reply as well as the parsed outcome: the reason field says which of
      // the three failure shapes it was, the raw text says what the model actually sent.
      const raw = await session.send({
        prompt: buildAnnotatePrompt(file!.path, file!.content),
        system: buildAnnotateSystem(),
        effort: "medium",
      });
      const out = await annotateFile(new AiSession(client), file!.path, file!.content);

      writeFileSync(
        join(OUT, "measure-E-onefile.json"),
        JSON.stringify({ path: ONE, first_reply: raw, second_attempt: out }, null, 2),
        "utf-8",
      );
      expect(out.status === "ok" || !!out.reason).toBe(true);
    },
    400_000,
  );
});
