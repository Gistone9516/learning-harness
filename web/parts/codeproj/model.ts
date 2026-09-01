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
 * parseProject: tolerant JSON parse — strips markdown code fences, then JSON.parse.
 * Returns null if the text is unparseable or structurally invalid (missing title/summary/files).
 */
export function parseProject(text: string): GeneratedProject | null {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "");
  cleaned = cleaned.replace(/\n?```\s*$/, "");
  cleaned = cleaned.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>)["title"] !== "string" ||
    typeof (parsed as Record<string, unknown>)["summary"] !== "string" ||
    !Array.isArray((parsed as Record<string, unknown>)["files"])
  ) {
    return null;
  }

  const raw = parsed as Record<string, unknown>;
  const files: ProjectFile[] = (raw["files"] as unknown[]).filter(
    (f): f is ProjectFile =>
      typeof f === "object" &&
      f !== null &&
      typeof (f as Record<string, unknown>)["path"] === "string" &&
      typeof (f as Record<string, unknown>)["content"] === "string",
  );

  const entrypoints = Array.isArray(raw["entrypoints"])
    ? (raw["entrypoints"] as unknown[]).filter((e): e is string => typeof e === "string")
    : undefined;

  return {
    title: raw["title"] as string,
    summary: raw["summary"] as string,
    files,
    entrypoints,
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
