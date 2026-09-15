// FR-25 live check. Opt-in.
//
//   LH_LIVE=1 LH_LIVE_TOKEN=<token> npx vitest run parts/codeproj/assess.live.test.ts
//
// The gate in front of generation is only worth having if it is fast and if it is right about
// real topics. Both have to be measured against the actual model: the unit tests pin the parsing
// and the fail-open behaviour, but nothing offline can tell whether the model actually refuses a
// topic that cannot be built, or whether it refuses ones that can.
//
// The cases below are real. The first is the topic a learner lost two or three attempts of tens
// of minutes on (2026-09-10) before this gate existed.
import { describe, it, expect } from "vitest";
import { request as httpRequest } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildAssessPrompt, buildAssessSystem } from "./prompts";
import { parseAssessment } from "./model";
import type { GenerateInput } from "./model";

const LIVE = process.env.LH_LIVE === "1";
const SERVER = process.env.LH_LIVE_URL ?? "http://127.0.0.1:8765";
const TOKEN = process.env.LH_LIVE_TOKEN ?? "";
const MODEL = process.env.LH_LIVE_MODEL ?? "claude-opus-5[1m]";
const OUT = resolve(process.cwd(), "../../Coding-GO/docs/verification/2026-09-10-fr25");

function postJson(url: string, headers: Record<string, string>, body: string): Promise<string> {
  const t = new URL(url);
  return new Promise((res, rej) => {
    const req = httpRequest(
      {
        hostname: t.hostname,
        port: t.port,
        path: t.pathname,
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(body).toString() },
      },
      (r) => {
        let text = "";
        r.setEncoding("utf-8");
        r.on("data", (c) => (text += c));
        r.on("end", () => res(text));
      },
    );
    req.on("error", rej);
    req.write(body);
    req.end();
  });
}

async function assess(input: GenerateInput) {
  const started = Date.now();
  const raw = await postJson(
    `${SERVER}/ai`,
    { "Content-Type": "application/json", "X-AI-Token": TOKEN },
    JSON.stringify({
      prompt: buildAssessPrompt(input),
      system: buildAssessSystem(),
      model: MODEL,
      effort: "medium",
      session_id: null,
    }),
  );
  const body = JSON.parse(raw) as { ok: boolean; text: string; error: string | null };
  return {
    seconds: (Date.now() - started) / 1000,
    ok: body.ok,
    error: body.error,
    text: body.text,
    verdict: parseAssessment(body.text ?? "", input.scale),
  };
}

/** The learner's own failing topic, plus one that must NOT be refused, plus a scale that is wrong
 *  for its topic. A gate that refuses everything is as useless as one that refuses nothing. */
const CASES: { name: string; input: GenerateInput; expect: "go" | "reword" }[] = [
  {
    name: "운영 절차 (실제 실패 사례)",
    input: { topic: "무중단 배포(Zero-downtime) 및 Chaos Engineering 실습", scale: "small" },
    expect: "reword",
  },
  {
    name: "평범한 서비스 — 막으면 안 됨",
    input: { topic: "도서 대출 관리 REST API (등록, 대출, 반납, 연체 조회)", scale: "medium", seed: "FastAPI + SQLite" },
    expect: "go",
  },
  {
    name: "규모가 주제에 비해 과함",
    input: { topic: "숫자 두 개를 더하는 계산기", scale: "large" },
    expect: "go",
  },
];

describe.skipIf(!LIVE)("FR-25 live topic assessment", () => {
  it(
    "refuses what cannot be built, allows what can, and moves the scale to fit",
    async () => {
      expect(TOKEN, "LH_LIVE_TOKEN must be set").not.toBe("");
      mkdirSync(OUT, { recursive: true });

      const results = [];
      for (const c of CASES) {
        const r = await assess(c.input);
        results.push({
          case: c.name,
          input: c.input,
          expected: c.expect,
          seconds: r.seconds,
          call_ok: r.ok,
          error: r.error,
          got: r.verdict.verdict,
          scale_in: c.input.scale,
          scale_out: r.verdict.scale,
          scale_reason: r.verdict.scaleReason,
          why: r.verdict.why,
          suggestions: r.verdict.suggestions,
          raw: r.text,
        });
      }
      writeFileSync(resolve(OUT, "assess.measured.json"), JSON.stringify(results, null, 2), "utf-8");

      for (const r of results) {
        expect(r.call_ok, `${r.case}: call failed — ${r.error}`).toBe(true);
        // The whole point is that this is cheap next to a generation. If it is not, it is a
        // second wait rather than a way of avoiding one.
        expect(r.seconds, `${r.case}: took ${r.seconds}s`).toBeLessThan(60);
        expect(r.got, `${r.case}: expected ${r.expected}`).toBe(r.expected);
      }

      // A refusal has to hand back something to do, or it is the dead end it replaced.
      const refused = results.find((r) => r.got === "reword")!;
      expect(refused.why.length).toBeGreaterThan(0);
      expect(refused.suggestions.length).toBeGreaterThan(0);

      // The oversized scale must actually come down; otherwise "recommendation" means nothing.
      const oversized = results.find((r) => r.case.startsWith("규모가"))!;
      expect(oversized.scale_out, "large was not reduced for a trivial topic").not.toBe("large");
      expect(oversized.scale_reason.length, "the scale moved with no reason given").toBeGreaterThan(0);
    },
    240_000,
  );
});
