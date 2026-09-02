// IDE-shaped view for the codeproj part: file panel on the left, code in the middle, AI on the
// right. Each panel is a small factory returning its element plus the handful of operations the
// mount needs, so the mount wires panels together instead of manipulating their internals.

import type { GeneratedProject, Lens, TreeNode } from "./model";
import { LENS_LABELS, LENS_ORDER } from "./prompts";
import { highlightLines } from "../../src/highlight/highlight";

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// ── file panel (left) ─────────────────────────────────────────────────────────

export interface FilePanel {
  root: HTMLElement;
  render(project: GeneratedProject, tree: TreeNode[]): void;
  markSelected(path: string): void;
  markSeen(paths: Iterable<string>): void;
}

function buildTreeDOM(nodes: TreeNode[], onSelect: (path: string) => void, depth = 0): HTMLElement {
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

export function createFilePanel(onSelect: (path: string) => void): FilePanel {
  const root = el("nav", "lh-cp-panel lh-cp-files");
  const head = el("div", "lh-cp-panel-head", "파일");
  const progress = el("span", "lh-cp-progress", "");
  head.appendChild(progress);
  const treeContainer = el("div", "lh-cp-tree");
  root.appendChild(head);
  root.appendChild(treeContainer);

  let total = 0;

  return {
    root,
    render(project, tree) {
      total = project.files.length;
      treeContainer.innerHTML = "";
      if (project.entrypoints?.length) {
        treeContainer.appendChild(
          el("p", "lh-cp-entrypoints-hint", `권장 읽기 순서: ${project.entrypoints.join(", ")}`),
        );
      }
      treeContainer.appendChild(buildTreeDOM(tree, onSelect));
    },
    markSelected(path) {
      treeContainer.querySelectorAll(".lh-cp-tree-file").forEach((btn) => {
        const e = btn as HTMLElement;
        e.classList.toggle("lh-cp-selected", e.dataset["path"] === path);
      });
    },
    markSeen(paths) {
      const seen = new Set(paths);
      treeContainer.querySelectorAll(".lh-cp-tree-file").forEach((btn) => {
        const e = btn as HTMLElement;
        e.classList.toggle("lh-cp-seen", seen.has(e.dataset["path"] ?? ""));
      });
      progress.textContent = total ? `${seen.size}/${total}` : "";
    },
  };
}

// ── code panel (centre) ───────────────────────────────────────────────────────

export interface CodePanel {
  root: HTMLElement;
  show(path: string, content: string, lang?: string): void;
  /** Selected line range (1-based, inclusive), or null when the whole file is the target. */
  selection(): [number, number] | null;
  clearSelection(): void;
  onSelectionChange(cb: (range: [number, number] | null) => void): void;
  /** Called when the learner collects the current selection. */
  onScrapAdd(cb: (range: [number, number]) => void): void;
  /** Ranges already collected in the file on screen, marked so they are visible while reading. */
  markScraps(ranges: [number, number][]): void;
  /** Scroll a line into view and select it, for a code reference or a scrap list entry. */
  reveal(range: [number, number]): void;
}

export function createCodePanel(): CodePanel {
  const root = el("div", "lh-cp-panel lh-cp-code-panel");
  const head = el("div", "lh-cp-panel-head");
  const pathLabel = el("span", "lh-cp-path-label", "파일을 선택하세요");
  const selectionLabel = el("span", "lh-cp-selection-label", "");
  const scrapBtn = el("button", "lh-cp-scrap-btn", "스크랩 담기");
  scrapBtn.hidden = true;
  const clearBtn = el("button", "lh-cp-clear-selection", "선택 해제");
  clearBtn.hidden = true;
  head.appendChild(pathLabel);
  head.appendChild(selectionLabel);
  head.appendChild(scrapBtn);
  head.appendChild(clearBtn);
  const codeArea = el("div", "lh-cp-code-scroll");
  root.appendChild(head);
  root.appendChild(codeArea);

  let anchor: number | null = null;
  let range: [number, number] | null = null;
  let listener: ((r: [number, number] | null) => void) | null = null;
  let scrapListener: ((r: [number, number]) => void) | null = null;
  let scrapRanges: [number, number][] = [];

  function paint(): void {
    codeArea.querySelectorAll(".lh-cp-code-line").forEach((lineEl) => {
      const e = lineEl as HTMLElement;
      const n = Number(e.dataset["line"]);
      e.classList.toggle("lh-cp-line-selected", !!range && n >= range[0] && n <= range[1]);
      // Collected regions stay marked while reading, in a quieter way than the live selection.
      e.classList.toggle("lh-cp-line-scrapped", scrapRanges.some(([a, b]) => n >= a && n <= b));
    });
    selectionLabel.textContent = range ? `선택: ${range[0]}-${range[1]}행` : "";
    scrapBtn.hidden = !range;
    clearBtn.hidden = !range;
    listener?.(range);
  }

  scrapBtn.addEventListener("click", () => {
    if (range) scrapListener?.(range);
  });

  function setRange(next: [number, number] | null): void {
    range = next;
    paint();
  }

  clearBtn.addEventListener("click", () => {
    anchor = null;
    setRange(null);
  });

  return {
    root,
    show(path, content, lang) {
      pathLabel.textContent = path;
      if (lang) pathLabel.dataset["lang"] = lang;
      anchor = null;
      range = null;
      codeArea.innerHTML = "";

      const pre = el("pre", "lh-cp-code");
      const lines = content.split("\n");
      // Highlight the whole file at once so multi-line constructs (docstrings, block comments) are
      // recognised, then take it back apart with tags balanced per row. The language comes from the
      // file's own `lang` when the generator set one, otherwise from its extension.
      const highlighted = highlightLines(content, lang || path);
      lines.forEach((text, i) => {
        const n = i + 1;
        const lineEl = el("div", "lh-cp-code-line");
        lineEl.dataset["line"] = String(n);
        lineEl.appendChild(el("span", "lh-cp-line-num", String(n)));
        const codeEl = el("span", "lh-cp-line-text");
        codeEl.innerHTML = highlighted[i] ?? "";
        lineEl.appendChild(codeEl);
        void text;
        // Click picks a line; shift-click extends from the previous one, the usual editor gesture.
        lineEl.addEventListener("click", (ev) => {
          if ((ev as MouseEvent).shiftKey && anchor !== null) {
            setRange([Math.min(anchor, n), Math.max(anchor, n)]);
          } else {
            anchor = n;
            setRange([n, n]);
          }
        });
        pre.appendChild(lineEl);
      });
      codeArea.appendChild(pre);
      paint();
    },
    selection: () => range,
    clearSelection: () => {
      anchor = null;
      setRange(null);
    },
    onSelectionChange(cb) {
      listener = cb;
    },
    onScrapAdd(cb) {
      scrapListener = cb;
    },
    markScraps(ranges) {
      scrapRanges = ranges;
      paint();
    },
    reveal(target) {
      anchor = target[0];
      setRange(target);
      const row = codeArea.querySelector(`[data-line="${target[0]}"]`);
      // Feature-detected: scrolling is a nicety, and selecting the line already did the real work.
      if (typeof row?.scrollIntoView === "function") {
        row.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    },
  };
}

// ── AI panel (right) ──────────────────────────────────────────────────────────

export interface AiPanelHandlers {
  onExplain(lens: Lens): void;
  onAsk(question: string): void;
  onScrapRemove?(id: string): void;
  onScrapReveal?(id: string): void;
  onScrapClear?(): void;
}

/** What the AI panel shows as the current subject: one place, or a basket of collected regions. */
export interface ScrapView {
  id: string;
  path: string;
  lines: [number, number];
}

export interface AiPanel {
  root: HTMLElement;
  setEnabled(enabled: boolean): void;
  setTargetHint(hint: string): void;
  /** Replaces the target line with a list once regions are collected; empty list restores it. */
  setScraps(scraps: ScrapView[]): void;
  /**
   * Append one exchange; returns a handle whose body is filled when the answer arrives.
   * `setContent` takes a rendered element (a composed answer); `setBody` takes plain text, which
   * is what a malformed or degraded answer falls back to.
   */
  startEntry(title: string): {
    setBody(text: string): void;
    setContent(node: HTMLElement): void;
    /**
     * Replace the pending text and mark it as a long wait. The ordinary 5-13s call keeps the
     * quiet static line; this is for the rare generation-class wait, where unchanging grey text
     * beside greyed buttons is indistinguishable from a hang.
     */
    setWaiting(text: string): void;
  };
  notice(text: string): void;
}

export function createAiPanel(handlers: AiPanelHandlers): AiPanel {
  const root = el("aside", "lh-cp-panel lh-cp-ai");
  const head = el("div", "lh-cp-panel-head", "AI");
  const targetHint = el("div", "lh-cp-target-hint", "");
  const scrapBox = el("div", "lh-cp-scrap-box");
  scrapBox.hidden = true;

  const lensBar = el("div", "lh-cp-lens-bar");
  const lensSelect = el("select", "lh-cp-lens-select");
  for (const lens of LENS_ORDER) {
    const o = document.createElement("option");
    o.value = lens;
    o.textContent = LENS_LABELS[lens];
    lensSelect.appendChild(o);
  }
  const explainBtn = el("button", "lh-cp-explain-btn", "설명 요청");
  lensBar.appendChild(lensSelect);
  lensBar.appendChild(explainBtn);

  const thread = el("div", "lh-cp-thread");
  const empty = el("p", "lh-cp-thread-empty", "파일을 열고 설명을 요청하거나 질문을 입력하세요.");
  thread.appendChild(empty);

  const askBar = el("form", "lh-cp-ask-bar");
  const askInput = el("textarea", "lh-cp-ask-input");
  askInput.rows = 2;
  askInput.placeholder = "이 코드에 대해 질문하기";
  const askBtn = el("button", "lh-cp-ask-btn", "질문");
  askBtn.type = "submit";
  askBar.appendChild(askInput);
  askBar.appendChild(askBtn);

  root.appendChild(head);
  root.appendChild(targetHint);
  root.appendChild(scrapBox);
  root.appendChild(lensBar);
  root.appendChild(thread);
  root.appendChild(askBar);

  explainBtn.addEventListener("click", () => handlers.onExplain(lensSelect.value as Lens));
  askBar.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const question = askInput.value.trim();
    if (!question) return;
    askInput.value = "";
    handlers.onAsk(question);
  });

  return {
    root,
    setEnabled(enabled) {
      explainBtn.disabled = !enabled;
      askBtn.disabled = !enabled;
      askInput.disabled = !enabled;
    },
    setTargetHint(hint) {
      targetHint.textContent = hint;
    },
    setScraps(scraps) {
      scrapBox.innerHTML = "";
      scrapBox.hidden = scraps.length === 0;
      // With regions collected, they are the subject; the single-target line would contradict them.
      targetHint.hidden = scraps.length > 0;
      if (!scraps.length) return;

      const bar = el("div", "lh-cp-scrap-bar");
      bar.appendChild(el("span", "lh-cp-scrap-count", `대상 · ${scraps.length}개 구간`));
      const clear = el("button", "lh-cp-scrap-clear", "전체 비우기");
      clear.addEventListener("click", () => handlers.onScrapClear?.());
      bar.appendChild(clear);
      scrapBox.appendChild(bar);

      for (const s of scraps) {
        const item = el("div", "lh-cp-scrap-item");
        const go = el("button", "lh-cp-scrap-go");
        go.appendChild(el("span", "lh-cp-scrap-path", s.path));
        const where = s.lines[0] === s.lines[1] ? `${s.lines[0]}행` : `${s.lines[0]}-${s.lines[1]}행`;
        go.appendChild(el("span", "lh-cp-scrap-lines", where));
        go.addEventListener("click", () => handlers.onScrapReveal?.(s.id));
        const drop = el("button", "lh-cp-scrap-drop", "×");
        drop.title = "이 구간 빼기";
        drop.addEventListener("click", () => handlers.onScrapRemove?.(s.id));
        item.appendChild(go);
        item.appendChild(drop);
        scrapBox.appendChild(item);
      }
    },
    startEntry(title) {
      empty.remove();
      const entry = el("div", "lh-cp-entry");
      entry.appendChild(el("div", "lh-cp-entry-title", title));
      const body = el("div", "lh-cp-entry-body", "불러오는 중...");
      entry.appendChild(body);
      thread.appendChild(entry);
      thread.scrollTop = thread.scrollHeight;
      return {
        setBody(text: string) {
          body.classList.remove("lh-cp-entry-waiting");
          body.textContent = text;
          thread.scrollTop = thread.scrollHeight;
        },
        setContent(node: HTMLElement) {
          body.classList.remove("lh-cp-entry-waiting");
          body.textContent = "";
          body.appendChild(node);
          thread.scrollTop = thread.scrollHeight;
        },
        setWaiting(text: string) {
          body.classList.add("lh-cp-entry-waiting");
          body.textContent = text;
          thread.scrollTop = thread.scrollHeight;
        },
      };
    },
    notice(text) {
      const note = el("div", "lh-cp-notice", text);
      root.insertBefore(note, thread);
    },
  };
}
