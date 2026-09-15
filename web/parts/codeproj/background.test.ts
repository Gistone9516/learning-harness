// The background queue: one worker, jobs in order, and a file the learner opens jumps the line.
import { describe, it, expect } from "vitest";
import { createJobQueue } from "./background";

/** A run whose jobs finish only when the test says so, so ordering can be observed mid-flight. */
function gated() {
  const started: string[] = [];
  const release = new Map<string, () => void>();
  const run = (job: string) =>
    new Promise<void>((resolve) => {
      started.push(job);
      release.set(job, resolve);
    });
  const finish = async (job: string) => {
    release.get(job)?.();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { started, run, finish };
}

describe("createJobQueue", () => {
  it("runs one job at a time, in the order pushed", async () => {
    const g = gated();
    const q = createJobQueue<string>((j) => j, g.run);
    q.push(["a", "b", "c"]);
    expect(g.started).toEqual(["a"]);          // never two at once
    await g.finish("a");
    expect(g.started).toEqual(["a", "b"]);
    await g.finish("b");
    await g.finish("c");
    await q.idle();
    expect(g.started).toEqual(["a", "b", "c"]);
  });

  it("moves a waiting job to the front when bumped, and leaves the running one alone", async () => {
    const g = gated();
    const q = createJobQueue<string>((j) => j, g.run);
    q.push(["a", "b", "c", "d"]);
    q.bump("d");
    q.bump("a");                                 // already running: nothing to move
    await g.finish("a");
    expect(g.started).toEqual(["a", "d"]);
    q.bump("zzz");                               // unknown: nothing happens
    await g.finish("d");
    expect(g.started).toEqual(["a", "d", "b"]);
  });

  it("puts front-pushed jobs ahead of what is waiting, and skips jobs already queued", async () => {
    const g = gated();
    const q = createJobQueue<string>((j) => j, g.run);
    q.push(["a", "b"]);
    q.push(["x", "b"], { front: true });         // b is already waiting, so it is not added twice
    await g.finish("a");
    await g.finish("x");
    await g.finish("b");
    await q.idle();
    expect(g.started).toEqual(["a", "x", "b"]);
  });

  it("reports waiting and running jobs through has(), and forgets them once done", async () => {
    const g = gated();
    const done: string[] = [];
    const q = createJobQueue<string>((j) => j, g.run, {
      // has() is already false inside onDone, which is what lets a repaint there read the truth.
      onDone: (j) => done.push(`${j}:${q.has(j)}`),
    });
    q.push(["a", "b"]);
    expect(q.running()).toBe("a");
    expect(q.has("a") && q.has("b")).toBe(true);
    await g.finish("a");
    expect(q.has("a")).toBe(false);
    expect(done).toEqual(["a:false"]);
  });

  it("keeps going after a job throws", async () => {
    const ran: string[] = [];
    const q = createJobQueue<string>((j) => j, async (j) => {
      ran.push(j);
      if (j === "a") throw new Error("boom");
    });
    q.push(["a", "b"]);
    await q.idle();
    expect(ran).toEqual(["a", "b"]);
  });

  it("finishes the job in flight and runs nothing after stop()", async () => {
    const g = gated();
    const q = createJobQueue<string>((j) => j, g.run);
    q.push(["a", "b"]);
    q.stop();
    await g.finish("a");
    await q.idle();
    expect(g.started).toEqual(["a"]);
    q.push(["c"]);
    expect(g.started).toEqual(["a"]);
  });
});
