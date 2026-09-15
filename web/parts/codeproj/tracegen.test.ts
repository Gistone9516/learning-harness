// FR-24: the leg-by-leg pass that produces one debug run.
//
// What matters here is the cost shape and the partial-result behaviour, the same two things the
// concept pass is pinned on. A leg is one file because a resumed call is cut at 180s and a timeout
// returns nothing at all, so the design has to turn "the whole walkthrough is lost" into "the
// walkthrough stops one file early" — and then say so.
import { describe, it, expect, vi } from "vitest";
import type { AiClient, AiResponse } from "../../src/ai/client";
import { AiSession } from "../../src/ai/client";
import { traceRun } from "./session";
import { buildTraceLegPrompt, buildTraceSystem } from "./prompts";
import { TRACE_MAX_LEGS, TRACE_STEP_CAP, type TraceRun } from "./trace";
import type { CodeProject } from "./model";

const lines = (n: number, tag: string) =>
  Array.from({ length: n }, (_, i) => `${tag}_line_${i + 1}()`).join("\n");

const PROJECT: CodeProject = {
  title: "도서 대출",
  summary: "요약",
  files: [
    { path: "app.py", content: lines(20, "app") },
    { path: "service.py", content: lines(12, "svc") },
    { path: "store.py", content: lines(12, "store") },
    { path: "models.py", content: lines(12, "model") },
    { path: "config.py", content: lines(12, "cfg") },
  ],
};

const legReply = (
  startLine: number,
  count: number,
  over: { leaves_to?: unknown; done?: boolean; vars?: unknown } = {},
) =>
  JSON.stringify({
    steps: Array.from({ length: count }, (_, i) => ({
      line: startLine + i,
      explain: `${startLine + i}행에서 하는 일`,
      vars: over.vars ?? [{ name: "n", value: String(i) }],
    })),
    leaves_to: over.leaves_to ?? null,
    done: over.done ?? true,
  });

/** Replies scripted per call, recording every request. Same shape the concept tests use. */
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

const ENTRY = { path: "app.py", line: 3 };

describe("one file, one leg", () => {
  it("returns a run of the steps the model gave, numbered from one", async () => {
    const { client, sent } = scripted(() => ({ text: legReply(3, 5) }));
    const run = await traceRun(new AiSession(client), PROJECT, ENTRY, () => {});
    expect(sent).toHaveLength(1);
    expect(run.status).toBe("ok");
    expect(run.steps.map((s) => s.index)).toEqual([1, 2, 3, 4, 5]);
    expect(run.steps.every((s) => s.path === "app.py")).toBe(true);
    expect(run.truncated).toBeFalsy();
  });

  it("restates the numbered source and the project's real paths", async () => {
    // The line number is the only join between a step and the code, and `leaves_to.path` has to
    // be comparable as a string rather than guessed at.
    const { client, sent } = scripted(() => ({ text: legReply(3, 4) }));
    await traceRun(new AiSession(client), PROJECT, ENTRY, () => {});
    expect(sent[0].prompt).toContain("001| app_line_1()");
    expect(sent[0].prompt).toContain("시작 줄: 3");
    expect(sent[0].prompt).toContain("app.py, service.py");
  });

  it("resumes the session rather than minting one, at the medium default", async () => {
    // The whole cost model is that the codebase is already in this session's context.
    const { client, sent } = scripted(() => ({ text: legReply(3, 4) }));
    const session = new AiSession(client);
    session.adopt("existing-sid");
    await traceRun(session, PROJECT, ENTRY, () => {});
    expect(sent[0].session_id).toBe("existing-sid");
    expect(sent[0].effort).toBe("medium");
  });
});

describe("what earns a step (user directive 2026-09-10)", () => {
  // Nothing pinned the prompt's step-selection rule before this, and that is how the first
  // version went wrong unnoticed: it said "실제로 실행되는 줄만 단계로 삼는다", the model obeyed
  // it exactly, and a 24-step run still reached the service logic only at step 16. Measured on
  // `state/traces/prj-mtmhonko-n82lu6.json`: 18 of 32 steps sat on a signature, a parameter
  // default, constructor plumbing, or a condition that did not fire.
  const legPrompt = () =>
    buildTraceLegPrompt({
      path: "app.py",
      content: lines(12, "app"),
      startLine: 3,
      carried: [],
      steps: 8,
      paths: ["app.py", "service.py"],
    });

  it("tells the model to bundle wiring instead of stepping through it", () => {
    const prompt = legPrompt();
    for (const category of ["시그니처", "기본값", "의존성", "대입"]) {
      expect(prompt, `wiring category missing: ${category}`).toContain(category);
    }
    expect(prompt).toMatch(/묶어서 한 단계/);
  });

  it("covers module loading, which is a different waste from the wiring one", () => {
    // `state/traces/prj-mtnxg62p-jie43p.json`: all 23 steps of a real run were imports and
    // function definitions, and it never reached what the program does. A rule written only
    // against the FastAPI dependency case does not catch this.
    expect(legPrompt()).toContain("import");
    expect(buildTraceSystem()).toMatch(/모듈이 적재되는 과정도 배선이다/);
    // A definition is entered when it is called, not where it sits.
    expect(buildTraceSystem()).toMatch(/실제로 호출될 때 따라 들어간다/);
  });

  it("does not start reading downwards when the chosen line is an import or a definition", () => {
    // The measured run was started at `src/server.js:1`, an import. Reading on from there is how
    // a whole walkthrough goes to module load.
    expect(legPrompt()).toMatch(/시작 줄이 import나 정의라면/);
  });

  it("forbids the same line twice in a row", () => {
    // Measured: `src/lib/metrics.js:11` appeared as both step 17 and step 18 of one run.
    expect(legPrompt()).toMatch(/같은 줄을 연달아 두 번/);
  });

  it("names the same rule in the system preamble, so it survives a leg-prompt rewrite", () => {
    expect(buildTraceSystem()).toMatch(/한 단계로 묶는다/);
  });

  it("still refuses to bundle silently, because a trace is a chain", () => {
    // A pointer that jumps with nothing said is the exact defect `parseTraceLeg` avoids by
    // cutting rather than skipping. Bundling must say what came out of the bundle.
    expect(buildTraceSystem()).toMatch(/말없이 건너뛰지는 마라/);
  });

  it("keeps leaves_to off wiring, which is what removed the dependency detour", () => {
    // Measured: five steps and a file boundary were spent in deps.py resolving two default values.
    expect(legPrompt()).toMatch(/배선을 따라가려고 다른 파일로 넘어가지 마라/);
  });

  it("does not use 생략 for this, because AUDIENCE_CLAUSE already claimed that word", () => {
    // There it forbids shortening the explanation of a step that IS narrated. One word doing both
    // jobs leaves the model guessing which was meant.
    expect(legPrompt()).not.toContain("생략");
  });

  it("no longer filters on the wrong axis", () => {
    // The superseded sentence. Its return would reinstate the measured failure.
    expect(legPrompt()).not.toContain("실제로 실행되는 줄만 단계로 삼는다");
  });
});

describe("crossing a file", () => {
  it("opens the named file and carries the previous leg's state into it", async () => {
    const { client, sent } = scripted((n) =>
      n === 1
        ? {
            text: legReply(3, 3, {
              leaves_to: { path: "service.py", line: 2 },
              done: false,
              vars: [{ name: "book_id", value: "7" }],
            }),
          }
        : { text: legReply(2, 3) },
    );
    const run = await traceRun(new AiSession(client), PROJECT, ENTRY, () => {});

    expect(sent).toHaveLength(2);
    expect(sent[1].prompt).toContain("대상 파일: service.py");
    expect(sent[1].prompt).toContain("시작 줄: 2");
    // A variable bound in the caller is still on screen inside the callee.
    expect(sent[1].prompt).toContain("book_id");
    expect(run.steps.map((s) => s.path)).toEqual(
      ["app.py", "app.py", "app.py", "service.py", "service.py", "service.py"],
    );
    expect(run.steps.map((s) => s.index)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("sends nothing at all for a file the project does not have", async () => {
    // An invented path must not become a second call, let alone an opened file.
    const { client, sent } = scripted(() => ({
      text: legReply(3, 3, { leaves_to: { path: "sqlalchemy/orm.py", line: 5 }, done: false }),
    }));
    const run = await traceRun(new AiSession(client), PROJECT, ENTRY, () => {});
    expect(sent).toHaveLength(1);
    expect(run.status).toBe("ok");
    expect(run.truncated).toBe(true);
  });
});

describe("failure is asymmetric, on purpose", () => {
  it("fails the run when the first leg fails, because there is nothing to walk", async () => {
    const { client } = scripted(() => ({ ok: false, error: "timeout" }));
    const run = await traceRun(new AiSession(client), PROJECT, ENTRY, () => {});
    expect(run.status).toBe("failed");
    expect(run.reason).toBe("call");
    expect(run.steps).toEqual([]);
  });

  it("separates a failed call from a reply that was not JSON", async () => {
    const { client } = scripted(() => ({ text: "먼저 라우터가 실행되고, 그 다음 서비스로 갑니다." }));
    const run = await traceRun(new AiSession(client), PROJECT, ENTRY, () => {});
    expect(run.reason).toBe("parse");
  });

  it("keeps a shorter walkthrough when a later leg fails, and admits it is shorter", async () => {
    const { client } = scripted((n) =>
      n === 1
        ? { text: legReply(3, 4, { leaves_to: { path: "service.py", line: 2 }, done: false }) }
        : { ok: false, error: "timeout" },
    );
    const run = await traceRun(new AiSession(client), PROJECT, ENTRY, () => {});
    expect(run.status).toBe("ok");
    expect(run.steps).toHaveLength(4);
    expect(run.truncated).toBe(true);
  });

  it("refuses a walkthrough too short to be one, and clears it rather than showing a stub", async () => {
    const { client } = scripted(() => ({ text: legReply(3, 1) }));
    const run = await traceRun(new AiSession(client), PROJECT, ENTRY, () => {});
    expect(run.status).toBe("failed");
    expect(run.reason).toBe("dropped");
    expect(run.steps).toEqual([]);
  });
});

describe("admitting where it stopped", () => {
  it("marks a run truncated when a leg has more to say in its own file", async () => {
    // `done: false` with no `leaves_to` means the model was mid-flow in the file it was given and
    // ran out of its step budget. The next leg is addressed by file, so there is no way to ask
    // for the rest -- the walkthrough ends in the middle of something and must say so.
    // Measured 2026-09-05: a real run ended on a `select` being assembled and, without this, the
    // popup told the learner it was the last step.
    const { client, sent } = scripted(() => ({ text: legReply(3, 4, { done: false, leaves_to: null }) }));
    const run = await traceRun(new AiSession(client), PROJECT, ENTRY, () => {});
    expect(sent).toHaveLength(1);
    expect(run.status).toBe("ok");
    expect(run.truncated).toBe(true);
  });

  it("does not mark a run that reached a real stop", async () => {
    const { client } = scripted(() => ({ text: legReply(3, 4, { done: true }) }));
    const run = await traceRun(new AiSession(client), PROJECT, ENTRY, () => {});
    expect(run.truncated).toBeFalsy();
  });
});

describe("budgets", () => {
  it("stops crossing files once the leg budget is spent, and says the run was cut", async () => {
    // Every leg hands on to the next file and never says done.
    const { client, sent } = scripted(() => ({
      text: legReply(2, 2, { leaves_to: { path: "service.py", line: 2 }, done: false }),
    }));
    const run = await traceRun(new AiSession(client), PROJECT, ENTRY, () => {});
    expect(sent).toHaveLength(TRACE_MAX_LEGS);
    expect(run.truncated).toBe(true);
  });

  it("never exceeds the whole-run step cap", async () => {
    const { client } = scripted(() => ({
      text: legReply(2, 10, { leaves_to: { path: "service.py", line: 2 }, done: false }),
    }));
    const run = await traceRun(new AiSession(client), PROJECT, ENTRY, () => {});
    expect(run.steps.length).toBeLessThanOrEqual(TRACE_STEP_CAP);
  });
});

describe("publishing", () => {
  it("hands the run back after every leg, so the learner can start on the first one", async () => {
    // This is what makes the wait bearable: the first leg plays while the next is being written.
    const { client } = scripted((n) =>
      n === 1
        ? { text: legReply(3, 3, { leaves_to: { path: "service.py", line: 2 }, done: false }) }
        : { text: legReply(2, 3) },
    );
    const seen: number[] = [];
    await traceRun(new AiSession(client), PROJECT, ENTRY, (run: TraceRun) => seen.push(run.steps.length));
    // After leg 1, after leg 2, and once more with the final status.
    expect(seen).toEqual([3, 6, 6]);
  });

  it("publishes the failure too, so a retry can be offered without polling", async () => {
    const { client } = scripted(() => ({ ok: false, error: "boom" }));
    const seen: TraceRun[] = [];
    await traceRun(new AiSession(client), PROJECT, ENTRY, (run) => seen.push({ ...run }));
    expect(seen).toHaveLength(1);
    expect(seen[0].status).toBe("failed");
  });
});
