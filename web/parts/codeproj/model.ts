// Pure model for the codeproj part: types plus the parsing, tree building and lookup used by both
// the view and the tests. No DOM and no AI here, so this layer stays trivially testable.

export interface ProjectFile {
  path: string;
  content: string;
  lang?: string;
}

export interface CodeProject {
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

/**
 * What the learner hands over with a repository: where it is, and what they want out of reading it.
 *
 * The three reading fields land in different places, which is why they are three fields and not
 * one box. `scope` is applied by the server before a single file is read, so it decides what
 * exists at all. `goal` and `focus` go into every annotation prompt, and they decide which files
 * are annotated before the learner is let in. None is required: a repository with no request is
 * still worth reading, only in tree order and at the default level.
 */
export interface RepoRequest {
  source: string;
  ref?: string;
  /** Why they are reading it and at what level, in their own words. */
  goal: string;
  /** What to concentrate on, in their own words. */
  focus: string;
  /** Paths or globs to load. Empty loads everything the server's default filters keep. */
  scope: string[];
}

/** The scope box holds one path or glob per line. */
export function parseScope(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** The part of a request that shapes prompts, as stored with the project. */
export type ReadingRequest = Pick<RepoRequest, "goal" | "focus" | "scope">;

/**
 * Where a project came from.
 *
 * The request is stored with it rather than kept for the one visit, because annotation continues
 * after the learner leaves and resumes when they come back: a file annotated on the second visit
 * has to be written for the same goal as the files annotated on the first.
 */
export interface RepoOrigin {
  kind: "repo";
  source: string;
  ref: string | null;
  commit: string | null;
  loaded_at: number;
  request: ReadingRequest;
}

const EXT_LANG: Record<string, string> = {
  py: "Python",
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  java: "Java",
  kt: "Kotlin",
  go: "Go",
  rs: "Rust",
  c: "C",
  h: "C",
  cpp: "C++",
  cc: "C++",
  hpp: "C++",
  cs: "C#",
  rb: "Ruby",
  php: "PHP",
  swift: "Swift",
  scala: "Scala",
  sql: "SQL",
  sh: "Shell",
  vue: "Vue",
  svelte: "Svelte",
  dart: "Dart",
};

/**
 * The stack label on the archive list: the languages with the most files, most first.
 *
 * Derived from extensions rather than asked for, because the label only has to tell two archived
 * projects apart at a glance, and a model call for that would cost more than the list is worth.
 * Files in no listed language (Markdown, JSON, config) do not vote.
 */
export function stackOf(files: ProjectFile[], max = 3): string {
  const counts = new Map<string, number>();
  for (const file of files) {
    const ext = file.path.split(".").pop()?.toLowerCase() ?? "";
    const lang = EXT_LANG[ext];
    if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([lang]) => lang)
    .join(" · ");
}

/**
 * Turn what the server read into the project every other layer consumes.
 *
 * The summary is built here from facts, never asked of a model: it is the header line the learner
 * sees on every visit, and it has to say which repository and which commit this is, which only
 * the loader knows.
 */
export function projectFromRepo(loaded: {
  title: string;
  source: string;
  ref: string | null;
  commit: string | null;
  files: { path: string; content: string }[];
}): CodeProject {
  const where = [loaded.source, loaded.ref, loaded.commit ? loaded.commit.slice(0, 7) : null]
    .filter(Boolean)
    .join(" · ");
  return {
    title: loaded.title,
    summary: `${where} · 파일 ${loaded.files.length}개`,
    files: loaded.files.map((f) => ({ path: f.path, content: f.content })),
  };
}

/**
 * The order files are annotated in: the chosen ones first, in the order they were chosen, then
 * everything else in project order. Unknown and repeated paths in `first` are ignored, so a model
 * that names a file twice or invents one cannot drop a real file from the pass.
 */
export function annotationOrder(paths: string[], first: string[]): string[] {
  const known = new Set(paths);
  const head: string[] = [];
  for (const p of first) {
    if (known.has(p) && !head.includes(p)) head.push(p);
  }
  const chosen = new Set(head);
  return [...head, ...paths.filter((p) => !chosen.has(p))];
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
 * fileByPath: lookup a file by its path in a CodeProject.
 * Path comparison is case-sensitive and slash-normalized (/ vs \).
 */
export function fileByPath(project: CodeProject, path: string): ProjectFile | undefined {
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
