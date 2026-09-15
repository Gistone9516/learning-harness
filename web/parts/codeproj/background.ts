// One worker for everything written behind a learner who is already reading: the files not
// annotated before entry, the concept outline and each concept document.
//
// One worker rather than one per layer, because every job resumes the same AI session. Two
// concurrent resumes were measured once (2026-09-03) and both returned; three never were. The
// learner's own question is the second, so everything in the background takes turns in the first.
//
// A queue rather than a fixed order, because what the learner wants next changes while they read:
// opening a file that has no notes yet moves that file to the front, so the wait is at most the
// job already in flight instead of every file ahead of it in tree order.

export interface JobQueue<J> {
  /** Add jobs at the back, or at the front when they should run before what is already waiting. */
  push(jobs: J[], opts?: { front?: boolean }): void;
  /** Move a waiting job to the front. Nothing happens to a job that is running, done or unknown. */
  bump(key: string): void;
  /** True while a job with this key is waiting or running. */
  has(key: string): boolean;
  /** Key of the job running now, or null. */
  running(): string | null;
  /** Finish the job in flight and run nothing after it. */
  stop(): void;
  /** Resolves when nothing is waiting or running. */
  idle(): Promise<void>;
}

/**
 * `run` owns its own failure. A job that throws is dropped and the worker moves on: one file whose
 * annotation call broke must not leave every file after it unannotated.
 */
export function createJobQueue<J>(
  key: (job: J) => string,
  run: (job: J) => Promise<void>,
  opts: {
    /** Called once a job has left the queue, so `has` is already false for it. */
    onDone?: (job: J) => void;
  } = {},
): JobQueue<J> {
  let waiting: J[] = [];
  let current: J | null = null;
  let stopped = false;
  let active: Promise<void> | null = null;

  async function drain(): Promise<void> {
    while (!stopped && waiting.length) {
      const job = waiting.shift() as J;
      current = job;
      try {
        await run(job);
      } catch {
        // Contained by contract: see the doc comment above.
      }
      current = null;
      opts.onDone?.(job);
    }
    active = null;
  }

  function wake(): void {
    if (!active && !stopped) active = drain();
  }

  function has(k: string): boolean {
    return (current !== null && key(current) === k) || waiting.some((j) => key(j) === k);
  }

  return {
    push(jobs, opts = {}) {
      const fresh = jobs.filter((j) => !has(key(j)));
      waiting = opts.front ? [...fresh, ...waiting] : [...waiting, ...fresh];
      wake();
    },
    bump(k) {
      const i = waiting.findIndex((j) => key(j) === k);
      if (i <= 0) return;
      const [job] = waiting.splice(i, 1);
      waiting.unshift(job);
    },
    has,
    running() {
      return current === null ? null : key(current);
    },
    stop() {
      stopped = true;
      waiting = [];
    },
    idle() {
      return active ?? Promise.resolve();
    },
  };
}
