// WHAT: AI-generated project, read-only comprehension with session-based click explanations.
// DEPS: web/src/ai (ai_server client). No npm UI libs; tree and viewer are hand-rolled DOM.
// INPUT: { topic: string; scale: "small"|"medium"|"large"; seed?: string } — all injected, no subject literal.
// EVENTS: file-seen flags (Set<string> per path) emitted via onFileSeen callback.
// AI: yes — generation (/ai new session, force_json) + explanations (/ai resume same session).
// CONSTRAINTS: subject-agnostic, secrets-gated, session-resume (load-once->resume cost model).
// DEMO: mountCodeproj(el, { session, project }) with a canned GeneratedProject (no live AI).

import { AiSession, type AiClient } from "../../src/ai/client";

// ── Types ─────────────────────────────────────────────────────────────────────

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

export interface ExplainRequest {
  target: { path: string; symbol?: string; lines?: [number, number] };
  lens: "overview" | "libs_methods" | "flow" | "modify_tip";
}

export interface GenerateInput {
  topic: string;
  scale: "small" | "medium" | "large";
  seed?: string;
}

export interface CodeprojProps {
  session: AiSession;
  project?: GeneratedProject;
  onFileSeen?: (path: string) => void;
}

// ── Pure core ─────────────────────────────────────────────────────────────────

/**
 * parseProject: tolerant JSON parse — strips markdown code fences, then JSON.parse.
 * Returns null if the text is unparseable or structurally invalid (missing title/summary/files).
 */
export function parseProject(text: string): GeneratedProject | null {
  let cleaned = text.trim();

  // Strip opening code fence (```json or ```)
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "");
  // Strip closing code fence
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
        // Existing folder entry becoming a file entry — mark it
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

// ── AI helpers ────────────────────────────────────────────────────────────────

const LENS_LABELS: Record<ExplainRequest["lens"], string> = {
  overview: "개요",
  libs_methods: "라이브러리/메서드",
  flow: "호출 흐름",
  modify_tip: "수정 포인트",
};

function buildExplainPrompt(req: ExplainRequest): string {
  const { target, lens } = req;
  let location = `파일: ${target.path}`;
  if (target.symbol) location += `, 심볼: ${target.symbol}`;
  if (target.lines) location += `, 라인: ${target.lines[0]}-${target.lines[1]}`;
  return `[설명 요청]\n${location}\n렌즈: ${lens} (${LENS_LABELS[lens]})\n\n위 대상에 대해 "${LENS_LABELS[lens]}" 관점에서 설명해 주세요.`;
}

/**
 * generateProject: sends one generation call (force_json) to a new session and returns
 * the parsed GeneratedProject. Returns null on AI failure or parse failure.
 */
export async function generateProject(
  session: AiSession,
  input: GenerateInput,
): Promise<GeneratedProject | null> {
  const system =
    "You are a project generator. Output ONLY valid JSON matching the GeneratedProject schema: " +
    '{ "title": string, "summary": string, "files": [{path, content, lang?}], "entrypoints"?: string[] }. ' +
    "No prose, no markdown outside the JSON. The codebase must be complete, coherent, and self-consistent.";

  const scaleGuide: Record<string, string> = {
    small: "3-6 files, ~300 lines total",
    medium: "7-15 files, ~600 lines total",
    large: "16-30 files, ~1200 lines total",
  };

  const prompt =
    `Generate a project: topic="${input.topic}", scale=${input.scale} (${scaleGuide[input.scale] ?? input.scale})` +
    (input.seed ? `, constraints/stack: ${input.seed}` : "") +
    ".";

  const res = await session.send({ prompt, system, effort: "medium" });
  if (!res.ok) return null;
  return parseProject(res.text);
}

/**
 * explain: sends a resume call to the session for a targeted explanation.
 * Returns the explanation text, or an error message string on failure.
 */
export async function explain(
  session: AiSession,
  req: ExplainRequest,
): Promise<string> {
  const prompt = buildExplainPrompt(req);
  const res = await session.send({ prompt, effort: "medium" });
  if (!res.ok) {
    return `설명을 불러오지 못했습니다. (${res.error ?? "알 수 없는 오류"})`;
  }
  return res.text;
}

// ── DOM mount ─────────────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function buildTreeDOM(
  nodes: TreeNode[],
  onSelect: (path: string) => void,
  depth = 0,
): HTMLElement {
  const ul = el("ul", "lh-cp-tree-list");
  ul.style.paddingLeft = depth > 0 ? "1rem" : "0";

  for (const node of nodes) {
    const li = el("li", "lh-cp-tree-item");

    if (node.isFile) {
      const btn = el("button", "lh-cp-tree-file", node.name);
      btn.dataset["path"] = node.path;
      btn.addEventListener("click", () => onSelect(node.path));
      li.appendChild(btn);
    } else {
      const details = document.createElement("details");
      details.open = depth < 2;
      const summary = document.createElement("summary");
      summary.className = "lh-cp-tree-folder";
      summary.textContent = node.name;
      details.appendChild(summary);
      if (node.children.length > 0) {
        details.appendChild(buildTreeDOM(node.children, onSelect, depth + 1));
      }
      li.appendChild(details);
    }

    ul.appendChild(li);
  }

  return ul;
}

function renderLineNumbers(content: string): HTMLElement {
  const pre = el("pre", "lh-cp-code");
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lineEl = document.createElement("div");
    lineEl.className = "lh-cp-code-line";

    const num = el("span", "lh-cp-line-num", String(i + 1));
    const code = el("span", "lh-cp-line-text", lines[i]);

    lineEl.appendChild(num);
    lineEl.appendChild(code);
    pre.appendChild(lineEl);
  }
  return pre;
}

export function mountCodeproj(
  container: HTMLElement,
  props: CodeprojProps,
): void {
  const { session, project, onFileSeen } = props;
  container.innerHTML = "";
  container.classList.add("lh-codeproj");

  // State
  let currentProject = project ?? null;
  const seenPaths = new Set<string>();

  // ── Layout ──────────────────────────────────────────────────────────────────

  const header = el("div", "lh-cp-header");
  const titleEl = el("h2", "lh-cp-title", "코드 프로젝트 탐색");
  const summaryEl = el("p", "lh-cp-summary", "");
  header.appendChild(titleEl);
  header.appendChild(summaryEl);
  container.appendChild(header);

  const body = el("div", "lh-cp-body");
  const sidebar = el("nav", "lh-cp-sidebar");
  const mainArea = el("div", "lh-cp-main");
  const codeArea = el("div", "lh-cp-code-area");
  const explainArea = el("div", "lh-cp-explain-area");

  const sidebarToggle = el("button", "lh-cp-sidebar-toggle", "파일 목록 접기");
  let sidebarCollapsed = false;
  sidebarToggle.addEventListener("click", () => {
    sidebarCollapsed = !sidebarCollapsed;
    sidebar.style.display = sidebarCollapsed ? "none" : "";
    sidebarToggle.textContent = sidebarCollapsed ? "파일 목록 펼치기" : "파일 목록 접기";
  });

  const treeContainer = el("div", "lh-cp-tree");
  sidebar.appendChild(treeContainer);

  // Lens menu
  const lensBar = el("div", "lh-cp-lens-bar");
  const lensLabel = el("span", "lh-cp-lens-label", "설명 렌즈: ");
  const lensSelect = el("select", "lh-cp-lens-select");
  const lensOptions: { value: ExplainRequest["lens"]; label: string }[] = [
    { value: "overview", label: "개요" },
    { value: "libs_methods", label: "라이브러리/메서드" },
    { value: "flow", label: "호출 흐름" },
    { value: "modify_tip", label: "수정 포인트" },
  ];
  for (const opt of lensOptions) {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    lensSelect.appendChild(o);
  }
  const explainBtn = el("button", "lh-cp-explain-btn", "이 파일 설명 보기");
  explainBtn.disabled = true;
  lensBar.appendChild(lensLabel);
  lensBar.appendChild(lensSelect);
  lensBar.appendChild(explainBtn);

  const explainOutput = el("div", "lh-cp-explain-output", "파일을 선택하면 설명을 요청할 수 있습니다.");

  codeArea.appendChild(lensBar);
  explainArea.appendChild(explainOutput);

  mainArea.appendChild(codeArea);
  mainArea.appendChild(explainArea);

  container.appendChild(sidebarToggle);
  body.appendChild(sidebar);
  body.appendChild(mainArea);
  container.appendChild(body);

  // ── Generate panel (shown when no project injected) ──────────────────────────

  if (!currentProject) {
    const generatePanel = el("div", "lh-cp-generate-panel");
    const topicLabel = el("label", "", "주제");
    const topicInput = el("input", "lh-cp-topic-input");
    topicInput.type = "text";
    topicInput.placeholder = "예: 간단한 메모 앱";

    const scaleLabel = el("label", "", "규모");
    const scaleSelect = el("select", "lh-cp-scale-select");
    for (const [val, label] of [
      ["small", "소 (3-6 파일)"],
      ["medium", "중 (7-15 파일)"],
      ["large", "대 (16-30 파일)"],
    ] as const) {
      const o = document.createElement("option");
      o.value = val;
      o.textContent = label;
      scaleSelect.appendChild(o);
    }

    const seedLabel = el("label", "", "제약/스택 (선택)");
    const seedInput = el("input", "lh-cp-seed-input");
    seedInput.type = "text";
    seedInput.placeholder = "예: Python, 외부 라이브러리 없이";

    const generateBtn = el("button", "lh-cp-generate-btn", "프로젝트 생성");
    const generateStatus = el("div", "lh-cp-generate-status", "");

    generateBtn.addEventListener("click", async () => {
      const topic = topicInput.value.trim();
      if (!topic) {
        generateStatus.textContent = "주제를 입력해 주세요.";
        return;
      }
      generateBtn.disabled = true;
      generateStatus.textContent = "프로젝트를 생성하는 중...";

      const result = await generateProject(session, {
        topic,
        scale: scaleSelect.value as "small" | "medium" | "large",
        seed: seedInput.value.trim() || undefined,
      });

      if (!result) {
        generateStatus.textContent = "프로젝트 생성에 실패했습니다. 다시 시도해 주세요.";
        generateBtn.disabled = false;
        return;
      }

      currentProject = result;
      generatePanel.remove();
      loadProject(result);
    });

    generatePanel.appendChild(topicLabel);
    generatePanel.appendChild(topicInput);
    generatePanel.appendChild(scaleLabel);
    generatePanel.appendChild(scaleSelect);
    generatePanel.appendChild(seedLabel);
    generatePanel.appendChild(seedInput);
    generatePanel.appendChild(generateBtn);
    generatePanel.appendChild(generateStatus);
    container.insertBefore(generatePanel, body);
  } else {
    loadProject(currentProject);
  }

  // ── Load a project into the UI ───────────────────────────────────────────────

  function loadProject(proj: GeneratedProject): void {
    titleEl.textContent = proj.title;
    summaryEl.textContent = proj.summary;

    treeContainer.innerHTML = "";
    const tree = buildTree(proj.files);
    const treeDOM = buildTreeDOM(tree, (path) => selectFile(path));
    treeContainer.appendChild(treeDOM);

    // Show entrypoints hint if present
    if (proj.entrypoints && proj.entrypoints.length > 0) {
      const hint = el("p", "lh-cp-entrypoints-hint", `권장 읽기 순서: ${proj.entrypoints.join(", ")}`);
      treeContainer.insertBefore(hint, treeDOM);
    }

    // Default: select first file
    if (proj.files.length > 0) {
      selectFile(proj.files[0].path);
    }
  }

  // ── File selection ───────────────────────────────────────────────────────────

  let selectedPath: string | null = null;

  function selectFile(path: string): void {
    if (!currentProject) return;
    selectedPath = path;
    explainBtn.disabled = false;

    // Mark seen
    if (!seenPaths.has(path)) {
      seenPaths.add(path);
      onFileSeen?.(path);
    }

    // Highlight selected in tree
    treeContainer.querySelectorAll(".lh-cp-tree-file").forEach((btn) => {
      (btn as HTMLElement).classList.toggle("lh-cp-selected", (btn as HTMLElement).dataset["path"] === path);
    });

    // Render code
    const file = fileByPath(currentProject, path);
    if (!file) return;

    // Remove old code view if any (keep lensBar)
    const existing = codeArea.querySelector(".lh-cp-code");
    if (existing) existing.remove();
    const pathLabel = codeArea.querySelector(".lh-cp-path-label");
    if (pathLabel) pathLabel.remove();

    const pathEl = el("div", "lh-cp-path-label", file.path);
    if (file.lang) pathEl.dataset["lang"] = file.lang;
    codeArea.insertBefore(pathEl, lensBar);

    const codeView = renderLineNumbers(file.content);
    codeArea.appendChild(codeView);

    // Reset explanation
    explainOutput.textContent = "렌즈를 선택하고 [이 파일 설명 보기]를 클릭하세요.";
  }

  // ── Explain button ───────────────────────────────────────────────────────────

  explainBtn.addEventListener("click", async () => {
    if (!selectedPath) return;
    explainBtn.disabled = true;
    explainOutput.textContent = "설명을 불러오는 중...";

    const lens = lensSelect.value as ExplainRequest["lens"];
    const text = await explain(session, { target: { path: selectedPath }, lens });

    explainOutput.textContent = text;
    explainBtn.disabled = false;
  });
}

// ── createAiClient re-export helper (so callers can build a session easily) ───

export { AiSession };
export { createAiClient } from "../../src/ai/client";
