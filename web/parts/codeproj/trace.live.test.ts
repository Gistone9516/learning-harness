// FR-24 live measurement. Opt-in.
//
//   LH_LIVE=1 LH_LIVE_TOKEN=<token> npx vitest run parts/codeproj/trace.live.test.ts
//
// The one number in this feature with no evidence behind it is how long a leg takes. The nearest
// measured neighbour is the annotation pass (61-line file, effort medium, 37.1s on 2026-09-02),
// but that labels structure that already exists while this predicts an order of execution, so it
// cannot be carried across. And the ceiling is hard: a call carrying a session_id is classed
// "followup" and cut at 180s (bot/ai_server.py -> bot/ai.py TIMEOUT_BY_KIND), and a timeout
// returns nothing at all rather than a partial answer.
//
// It calls POST /ai directly rather than going through `traceRun`, because that helper collapses
// a transport failure and an unparseable body into one shape and the raw text is exactly what
// this exists to capture. The prompt builders and the parser are imported, never re-typed: a
// prompt copied by hand stops being the one that ships the moment either changes.
//
// Three things are being decided here, not just timed:
//   1. does one leg fit inside 180s
//   2. are the line numbers inside the file (the join key holding at all)
//   3. does `leaves_to` come back as a STRUCTURED field, or only as prose
// The third is the riskiest ask in this part -- nothing else asks the model for a cross-file
// target as a parseable value -- and if it fails, multi-file stepping silently degrades to
// single-file walkthroughs even where the code obviously calls elsewhere.
import { describe, it, expect } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildTraceLegPrompt, buildTraceSystem } from "./prompts";
import { carveJson } from "./components/parse";
import { parseTraceLeg, TRACE_LEG_STEPS } from "./trace";

const LIVE = process.env.LH_LIVE === "1";
const SERVER = process.env.LH_LIVE_URL ?? "http://127.0.0.1:8765";
const TOKEN = process.env.LH_LIVE_TOKEN ?? "";
const MODEL = process.env.LH_LIVE_MODEL ?? "claude-opus-5[1m]";

// cwd is learning-harness/web when run through npm; the instance sits two levels up.
const INSTANCE = process.env.LH_LIVE_INSTANCE ?? resolve(process.cwd(), "../../Coding-GO");
const OUT = resolve(INSTANCE, "docs/verification/2026-09-05-fr24");

/**
 * A real generated project and the session that already holds it, straight off disk. This is the
 * production path: a trace leg is a resumed call on the session the codebase was generated in.
 */
const PROJECT_ID = process.env.LH_LIVE_PROJECT ?? "prj-mtmhonko-n82lu6";
// A layered call: the route handler delegates to a service, which delegates to a repository.
// If `leaves_to` ever works, it works here.
const ENTRY = { path: "app/api/routes.py", line: 93 };

interface StoredFile {
  path: string;
  content: string;
}

function loadProject(): { files: StoredFile[]; sessionId: string } {
  const project = JSON.parse(readFileSync(resolve(INSTANCE, `state/projects/${PROJECT_ID}.json`), "utf-8"));
  const session = JSON.parse(readFileSync(resolve(INSTANCE, `state/ai-sessions/${PROJECT_ID}.json`), "utf-8"));
  return { files: project.data.project.files as StoredFile[], sessionId: session.data.session_id as string };
}

describe.skipIf(!LIVE)("FR-24 live trace leg", () => {
  it(
    "returns a usable leg inside the follow-up ceiling",
    async () => {
      expect(TOKEN, "LH_LIVE_TOKEN must be set for a live run").not.toBe("");
      mkdirSync(OUT, { recursive: true });

      const { files, sessionId } = loadProject();
      const entryFile = files.find((f) => f.path === ENTRY.path);
      expect(entryFile, `${ENTRY.path} must exist in ${PROJECT_ID}`).toBeTruthy();

      const prompt = buildTraceLegPrompt({
        path: ENTRY.path,
        content: entryFile!.content,
        startLine: ENTRY.line,
        carried: [],
        steps: TRACE_LEG_STEPS,
        paths: files.map((f) => f.path),
      });
      writeFileSync(resolve(OUT, "prompt.txt"), prompt, "utf-8");

      const started = Date.now();
      const res = await fetch(`${SERVER}/ai`, {
        method: "POST",
        headers: { "content-type": "application/json", "X-AI-Token": TOKEN },
        body: JSON.stringify({
          prompt,
          system: buildTraceSystem(),
          session_id: sessionId,
          model: MODEL,
          effort: "medium",
        }),
      });
      const elapsed = (Date.now() - started) / 1000;
      const body = await res.json();
      // Written BEFORE parsing, so a parse failure is diagnosable instead of just failing.
      writeFileSync(resolve(OUT, "response.raw.json"), JSON.stringify(body, null, 2), "utf-8");

      const lineCount = entryFile!.content.split("\n").length;
      const fileLines = new Map(files.map((f) => [f.path, f.content.split("\n").length]));
      const carved = body.ok ? carveJson(body.text ?? "") : null;
      const parsed = carved
        ? parseTraceLeg(
            JSON.parse(carved),
            { path: ENTRY.path, lineCount, startIndex: 0, budget: TRACE_LEG_STEPS },
            fileLines,
          )
        : null;

      const report = {
        measured_at: new Date().toISOString(),
        project: PROJECT_ID,
        entry: ENTRY,
        model: MODEL,
        elapsed_seconds: elapsed,
        followup_ceiling_seconds: 180,
        ok: body.ok,
        error: body.error ?? null,
        json_carved: !!carved,
        steps_asked: TRACE_LEG_STEPS,
        steps_returned: parsed?.steps.length ?? 0,
        lines: parsed?.steps.map((s) => s.line) ?? [],
        // The whole point of the entry-file restatement: are the numbers real?
        lines_in_range: (parsed?.steps ?? []).every((s) => s.line >= 1 && s.line <= lineCount),
        leaves_to: parsed?.leavesTo ?? null,
        done: parsed?.done ?? null,
        truncated: parsed?.truncated ?? null,
        vars_per_step: parsed?.steps.map((s) => s.vars.length) ?? [],
      };
      writeFileSync(resolve(OUT, "leg.measured.json"), JSON.stringify(report, null, 2), "utf-8");

      expect(body.ok, `call failed: ${body.error}`).toBe(true);
      expect(elapsed, "one leg must fit inside the 180s follow-up ceiling").toBeLessThan(180);
      expect(carved, "the reply must contain JSON, not prose").toBeTruthy();
      expect(report.steps_returned).toBeGreaterThan(0);
      expect(report.lines_in_range, `lines outside 1..${lineCount}: ${report.lines}`).toBe(true);
    },
    200_000,
  );
});
