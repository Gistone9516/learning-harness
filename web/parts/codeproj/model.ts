// Pure model for the codeproj part: types plus the parsing, tree building and lookup used by both
// the view and the tests. No DOM and no AI here, so this layer stays trivially testable.

export interface ProjectFile {
  path: string;
  content: string;
  lang?: string;
}

export interface GeneratedProject {
  title: string;
  summary: string;
  files: ProjectFile[];
  entrypoints?: string[];
}

export interface TreeNode {
  name: string;
  path: string;
  isFile: boolean;
  children: TreeNode[];
}

export type Lens = "overview" | "libs_methods" | "flow" | "modify_tip" | "concepts";

export interface ExplainTarget {
  path: string;
  symbol?: string;
  lines?: [number, number];
}

export interface ExplainRequest {
  target: ExplainTarget;
  lens: Lens;
}

/**
 * One collected code region. The interesting questions in a codebase usually span places that are
 * not next to each other ("how do these two connect"), often across files, so regions are gathered
 * into a basket and asked about together.
 */
export interface Scrap {
  id: string;
  path: string;
  lines: [number, number];
  /** The source of those lines, quoted into the prompt so the model sees exactly what was picked. */
  code: string;
}

/** A learner's own question about a target, optionally narrowed to a selected line range. */
export interface AskRequest {
  target: ExplainTarget;
  question: string;
  /** When set, these regions are the subject instead of `target` alone. */
  scraps?: Scrap[];
  /**
   * How much answer to ask for. Required, not defaulted: depth decides what the call costs and
   * how long the learner waits, and a cost that can be chosen implicitly is one nobody chose.
   * Lens explanations are always full; only free questions carry this.
   */
  depth: "full" | "semi";
  /**
   * The annotation covering the asked-about lines, when there is one. Sent as prior knowledge so
   * a short answer can start from what is already known instead of rediscovering it.
   */
  grounds?: { what: string; why?: string };
}

/** Total size guard: past this the call gets slow and the answer unfocused. */
export const SCRAP_MAX_COUNT = 8;
export const SCRAP_MAX_LINES = 200;

export function scrapLineCount(scraps: Scrap[]): number {
  return scraps.reduce((n, s) => n + (s.lines[1] - s.lines[0] + 1), 0);
}

export function canAddScrap(scraps: Scrap[], next: [number, number]): boolean {
  if (scraps.length >= SCRAP_MAX_COUNT) return false;
  return scrapLineCount(scraps) + (next[1] - next[0] + 1) <= SCRAP_MAX_LINES;
}

export interface GenerateInput {
  topic: string;
  scale: "small" | "medium" | "large";
  seed?: string;
}

/**
 * The verdict on a topic, taken before the expensive call.
 *
 * `scale` always carries a value: on `go` it is the scale generation will be bound to, and on a
 * failed or unreadable assessment it is the learner's own pick. Nothing downstream has to handle
 * an absent scale, which is the difference between a gate and a new failure mode.
 */
export interface TopicAssessment {
  verdict: "go" | "reword";
  scale: GenerateInput["scale"];
  /** Why the scale moved, or empty when it did not. */
  scaleReason: string;
  /** Why the topic was refused, or empty on `go`. */
  why: string;
  /** Ready-to-paste replacement topics. Empty on `go`. */
  suggestions: string[];
}

const SCALES: readonly GenerateInput["scale"][] = ["small", "medium", "large"];

/**
 * Read the assessment, and FAIL OPEN.
 *
 * A gate that refuses on its own malfunction is worse than no gate: the learner would be locked
 * out of generation by a broken pre-check instead of by a bad topic. So anything unreadable comes
 * back as `go` with the learner's own scale, and the only thing that can stop a generation is the
 * model explicitly saying `reword` with something to say about it.
 */
export function parseAssessment(text: string, fallback: GenerateInput["scale"]): TopicAssessment {
  const open: TopicAssessment = { verdict: "go", scale: fallback, scaleReason: "", why: "", suggestions: [] };

  let cleaned = text.trim().replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "").trim();
  let raw: unknown;
  try {
    raw = JSON.parse(cleaned);
  } catch {
    return open;
  }
  if (typeof raw !== "object" || raw === null) return open;
  const o = raw as Record<string, unknown>;

  const str = (k: string): string => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
  const scale = SCALES.includes(o["scale"] as GenerateInput["scale"])
    ? (o["scale"] as GenerateInput["scale"])
    : fallback;
  const suggestions = Array.isArray(o["suggestions"])
    ? (o["suggestions"] as unknown[])
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.trim())
        .slice(0, 3)
    : [];

  // A refusal with nothing to say is not actionable, so it is not honoured. The learner would be
  // stopped and told only that they were stopped -- exactly the dead end this feature exists to
  // remove, rebuilt one layer earlier.
  const why = str("why");
  if (str("verdict") === "reword" && why) {
    return { verdict: "reword", scale, scaleReason: str("scale_reason"), why, suggestions };
  }
  return { verdict: "go", scale, scaleReason: str("scale_reason"), why: "", suggestions: [] };
}

/**
 * Why a reply could not become a project. Three causes wanting three different responses:
 * `parse` means prose or a reply cut off mid-JSON, `shape` means JSON about something else,
 * `empty` means it agreed to the schema and then filled in no files.
 */
export type ProjectRejection = "parse" | "shape" | "empty";

export type ParsedProject =
  | { ok: true; project: GeneratedProject }
  | { ok: false; reason: ProjectRejection; detail?: string };

/**
 * parseProject: tolerant JSON parse — strips markdown code fences, then JSON.parse.
 *
 * Returns a REASON rather than a bare null. Generation is the one call a learner waits minutes
 * for, and until 2026-09-10 every way it could fail reached the screen as the same sentence:
 * nothing downstream could tell a truncated reply from prose from a well-formed answer about the
 * wrong thing. A learner reported burning two or three attempts of tens of minutes each with
 * nothing to go on, which is what that collapse costs.
 *
 * `empty` is a rejection now, not a success. A `files: []` satisfies every check below and used
 * to return a perfectly valid `GeneratedProject`, which then rendered an empty file tree and read
 * as a bug somewhere else entirely.
 */
export function parseProject(text: string): ParsedProject {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "");
  cleaned = cleaned.replace(/\n?```\s*$/, "");
  cleaned = cleaned.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    // The parser's own message says where it broke, which separates prose from a cut-off reply.
    return { ok: false, reason: "parse", detail: String((e as Error)?.message ?? e) };
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>)["title"] !== "string" ||
    typeof (parsed as Record<string, unknown>)["summary"] !== "string" ||
    !Array.isArray((parsed as Record<string, unknown>)["files"])
  ) {
    // The keys it did send are the fastest way to see what it answered instead.
    const detail =
      typeof parsed === "object" && parsed !== null
        ? Object.keys(parsed as Record<string, unknown>).slice(0, 8).join(", ")
        : typeof parsed;
    return { ok: false, reason: "shape", detail };
  }

  const raw = parsed as Record<string, unknown>;
  const all = raw["files"] as unknown[];
  const files: ProjectFile[] = all.filter(
    (f): f is ProjectFile =>
      typeof f === "object" &&
      f !== null &&
      typeof (f as Record<string, unknown>)["path"] === "string" &&
      typeof (f as Record<string, unknown>)["content"] === "string",
  );

  if (files.length === 0) {
    return { ok: false, reason: "empty", detail: `files: ${all.length}개 중 0개 사용 가능` };
  }

  const entrypoints = Array.isArray(raw["entrypoints"])
    ? (raw["entrypoints"] as unknown[]).filter((e): e is string => typeof e === "string")
    : undefined;

  return {
    ok: true,
    project: {
      title: raw["title"] as string,
      summary: raw["summary"] as string,
      files,
      entrypoints,
    },
  };
}

/**
 * buildTree: converts a flat list of ProjectFile paths into a nested TreeNode tree.
 * Paths are split on "/" and "\". Folders sort before files; siblings sort alphabetically.
 */
export function buildTree(files: ProjectFile[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", isFile: false, children: [] };

  for (const file of files) {
    const parts = file.path.split(/[\\/]/).filter((p) => p.length > 0);
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      const segName = parts[i];
      const segPath = parts.slice(0, i + 1).join("/");
      let child = node.children.find((c) => c.name === segName);
      if (!child) {
        child = { name: segName, path: segPath, isFile: isLast, children: [] };
        node.children.push(child);
      } else if (isLast) {
        child.isFile = true;
      }
      node = child;
    }
  }

  function sortNodes(nodes: TreeNode[]): void {
    nodes.sort((a, b) => {
      if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) sortNodes(n.children);
  }
  sortNodes(root.children);

  return root.children;
}

/**
 * fileByPath: lookup a file by its path in a GeneratedProject.
 * Path comparison is case-sensitive and slash-normalized (/ vs \).
 */
export function fileByPath(project: GeneratedProject, path: string): ProjectFile | undefined {
  const norm = (p: string) => p.replace(/\\/g, "/");
  const target = norm(path);
  return project.files.find((f) => norm(f.path) === target);
}

/** Extract a 1-based inclusive line range from a file's content, for quoting a selection. */
export function sliceLines(content: string, lines: [number, number]): string {
  const all = content.split("\n");
  const from = Math.max(1, Math.min(lines[0], all.length));
  const to = Math.max(from, Math.min(lines[1], all.length));
  return all.slice(from - 1, to).join("\n");
}
