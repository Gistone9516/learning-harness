// The debug layer's model: parsing one leg's reply, and the variable diff. No DOM, no transport.
//
// This code does not run. The learner reads an AI-generated project in a browser, so a "debug run"
// is the model's *prediction* of where control goes and what is live at each point, replayed
// locally. That is why every name here says trace and none says execution, and why the popup
// carries a standing label rather than a per-step confidence flag: a flag on some steps would read
// as verification of the ones without it, and all of them are equally a guess.
//
// The parse discipline is inherited from `annotations.ts` with one deliberate divergence, marked
// at `parseTraceLeg`.

/** One live binding at a point in the trace. `value` is the model's prose, never coerced. */
export interface TraceVar {
  name: string;
  value: string;
  /** The frame this binding belongs to, when the model distinguishes more than one. */
  scope?: string;
}

export interface TraceStep {
  /** Position in the flattened run, 1-based. Assigned here, never read from the reply. */
  index: number;
  /** Filled in from the leg's own file. The model is never asked for a path per step. */
  path: string;
  line: number;
  explain: string;
  /**
   * Everything live at this point, not the delta.
   *
   * A delta the model has to carry forward compounds: one missed reassignment and every later
   * step is silently wrong, and "forgot to mention it" is indistinguishable from "unchanged".
   * The diff is derived at render time by `changedSince` instead, the same discipline as
   * `conceptProgress` and `buildLineIndex`, which are computed rather than stored.
   */
  vars: TraceVar[];
}

/** Why a run has no usable steps. Same vocabulary as AnnotationFailure, for the same reasons. */
export type TraceFailure = "call" | "parse" | "dropped";

export type TraceStatus = "pending" | "running" | "ok" | "failed";

export interface TraceRun {
  status: TraceStatus;
  /** Where the learner started it. Not necessarily `steps[0]`: the model may open elsewhere. */
  entry: { path: string; line: number };
  steps: TraceStep[];
  reason?: TraceFailure;
  /**
   * The run stopped before the program did: a cap was hit, a leg failed after the first, or a
   * step could not be trusted. The screen has to say this, or the learner reads a truncated
   * walkthrough as a finished one.
   */
  truncated?: boolean;
}

/** Every run known for one project, keyed by entry point. */
export interface TraceSet {
  runs: Record<string, TraceRun>;
}

export function emptyTraceSet(): TraceSet {
  return { runs: {} };
}

/**
 * The lookup key for one run inside a project's record.
 *
 * Deliberately a plain object key and not an id: it holds slashes and dots, which
 * `STORAGE_NAME_RE` forbids. `AnnotationSet.files` already keys by path the same way, and
 * `study.ts` states why the record is per project rather than per path.
 */
export function traceKey(path: string, line: number): string {
  return `${path}:${line}`;
}

/*
 * Measured 2026-09-05, a real leg against a live session holding a 16-file FastAPI project
 * (`app/api/routes.py:93`, effort medium, claude-opus-5[1m]):
 *
 *   14.1s for one leg -- 8% of the 180s follow-up ceiling, so the ceiling is not the constraint
 *   8 steps asked, 2 returned -- the model stopped at the first file boundary, correctly
 *   every line inside the file, and `leaves_to` came back as a structured, real target
 *   (`app/api/deps.py:46`, which is exactly the `def pagination_params(` it named)
 *
 * The surprise was the step count. Layered code crosses files constantly -- FastAPI resolves a
 * `Depends` before the handler body runs -- so a leg is worth about two steps, not eight. That
 * is what sets the leg budget below: at four legs a run would end after eight steps, well short
 * of a walkthrough. At 14s each, and with every leg after the first prefetched while the learner
 * reads, more legs cost wall-clock only on the one they are waiting for.
 *
 * STALE IN ONE RESPECT, 2026-09-10. The prompt changed under these numbers: it now bundles wiring
 * and module loading into one step instead of walking them (see the FR-24 block in `prompts.ts`).
 * The 14.1s and the 180s headroom still hold -- neither depends on step selection. The "two steps
 * per leg" does not: the two steps that run produced were a signature and a `Depends` line, and
 * both are now bundled. Whether a leg is worth more useful steps, fewer total ones, or crosses
 * fewer files has NOT been re-measured, so treat TRACE_MAX_LEGS below as inherited rather than
 * currently evidenced.
 */

/** How many steps one run may have, across every file it visits. A reading limit, not a cost one. */
export const TRACE_STEP_CAP = 24;

/** How many files one run may cross. Raised from 4 on the 2026-09-05 measurement above. */
export const TRACE_MAX_LEGS = 8;

/** Below this a walkthrough is not one, however well-formed the reply was. */
export const TRACE_MIN_STEPS = 3;

/**
 * Steps asked for per leg. An upper bound, not a target: measured, the model returns as many as
 * it can before control leaves the file, which was two.
 */
export const TRACE_LEG_STEPS = 8;

function asText(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asVars(v: unknown): TraceVar[] {
  if (!Array.isArray(v)) return [];
  const out: TraceVar[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = asText(o["name"]);
    if (!name) continue;
    const scope = asText(o["scope"]);
    out.push({ name, value: asText(o["value"]), ...(scope ? { scope } : {}) });
  }
  return out;
}

/** Where one leg handed control on, once it has been checked against the real project. */
export interface TraceJump {
  path: string;
  line: number;
}

export interface LegResult {
  steps: TraceStep[];
  /** Validated: the path exists in the project and the line is inside it. Otherwise null. */
  leavesTo: TraceJump | null;
  /** The model said the trace reaches a natural stop here. */
  done: boolean;
  /** Something was rejected, so what came back is shorter than what was asked for. */
  truncated: boolean;
}

/**
 * Parse one leg's reply into steps.
 *
 * Inherits `asRange`'s rule: a line outside the file is dropped, never clamped, because a step
 * pointing at the wrong code is worse than no step. It DIVERGES from `parseAnnotations` on what
 * happens next. Annotations are independent, so dropping one and keeping the rest still leaves
 * every survivor meaningful, and a ratio limit is the right guard there. A trace is a chain the
 * learner walks one link at a time, and skipping a bad link makes the pointer jump from step 6
 * to step 8 with nothing said about why control moved. So the run is CUT at the first step that
 * cannot be trusted, and `truncated` says so.
 *
 * `files` maps every project path to its line count. It is the only thing that can tell a real
 * cross-file jump from an invented one.
 */
export function parseTraceLeg(
  raw: unknown,
  leg: { path: string; lineCount: number; startIndex: number; budget: number },
  files: ReadonlyMap<string, number>,
): LegResult {
  const container = (raw ?? null) as { steps?: unknown; leaves_to?: unknown; done?: unknown } | null;
  const list = Array.isArray(container?.steps) ? (container.steps as unknown[]) : null;
  if (!list) return { steps: [], leavesTo: null, done: false, truncated: true };

  const steps: TraceStep[] = [];
  let truncated = false;
  for (const entry of list) {
    if (steps.length >= leg.budget) {
      truncated = true;
      break;
    }
    if (!entry || typeof entry !== "object") {
      truncated = true;
      break;
    }
    const e = entry as Record<string, unknown>;
    const explain = asText(e["explain"]);
    const line = Math.trunc(Number(e["line"]));
    if (!explain || !Number.isFinite(line) || line < 1 || line > leg.lineCount) {
      truncated = true;
      break;
    }
    steps.push({
      index: leg.startIndex + steps.length + 1,
      path: leg.path,
      line,
      explain,
      vars: asVars(e["vars"]),
    });
  }

  // The one place a path can be invented. Checked here; a jump that fails ends the run rather
  // than being repaired, for the same reason a bad line is not clamped.
  let leavesTo: TraceJump | null = null;
  const jump = (container?.leaves_to ?? null) as Record<string, unknown> | null;
  if (jump && typeof jump === "object") {
    const path = asText(jump["path"]);
    const line = Math.trunc(Number(jump["line"]));
    const count = files.get(path);
    if (count !== undefined && Number.isFinite(line) && line >= 1 && line <= count) {
      leavesTo = { path, line };
    } else if (path) {
      truncated = true;
    }
  }

  return { steps, leavesTo, done: container?.done === true, truncated };
}

/** Identity of one binding across steps. Two frames may hold the same name. */
export function varKey(v: TraceVar): string {
  return `${v.scope ?? ""} ${v.name}`;
}

/**
 * Which bindings this step changed, as `varKey`s.
 *
 * The first step returns nothing: everything is new there, and marking all of it says only
 * "this is the beginning", which the step counter already says. A binding that appears later,
 * or whose value differs, is a real change and is marked.
 */
export function changedSince(prev: TraceVar[] | undefined, cur: TraceVar[]): Set<string> {
  const out = new Set<string>();
  if (!prev) return out;
  const before = new Map(prev.map((v) => [varKey(v), v.value]));
  for (const v of cur) {
    const key = varKey(v);
    if (!before.has(key) || before.get(key) !== v.value) out.add(key);
  }
  return out;
}
