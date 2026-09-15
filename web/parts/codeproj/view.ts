// IDE-shaped view for the codeproj part: file panel on the left, code in the middle, AI on the
// right. Each panel is a small factory returning its element plus the handful of operations the
// mount needs, so the mount wires panels together instead of manipulating their internals.

import { buildLineIndex, fileNote, type Annotation } from "./annotations";
import { createNotePopup, type DebugView } from "./notepopup";
import type { CodeProject, Lens, TreeNode } from "./model";
import { LENS_LABELS, LENS_ORDER } from "./prompts";
import { highlightLines } from "../../src/highlight/highlight";
import { leadingColumns, readWrapPreference, WRAP_EXTRA_CH, wrappedRowEnds, writeWrapPreference } from "./wrap";

/** Stroke-only and currentColor like the other kit icons: a line, a line that turns back, a short line. */
const WRAP_ICON =
  '<svg class="lh-cp-wrap-icon" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M4 6h16" /><path d="M4 12h13a3 3 0 0 1 0 6h-4" /><path d="M15 15.5 12.5 18l2.5 2.5" />' +
  '<path d="M4 18h5" /></svg>';

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
  render(project: CodeProject, tree: TreeNode[]): void;
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
  /**
   * The annotations for the file on screen. A method rather than a callback because the two
   * callback slots this panel exposes are single-assignment and both are already taken.
   */
  setAnnotations(items: Annotation[]): void;
  /**
   * What the note slot offers when the selected line has no note to show.
   *
   * `retry` for a file whose notes failed, `make` for one that was never annotated, `pending` while
   * its notes are queued or being written (shown, not pressable), `none` otherwise. The mount only
   * passes a pressable state where something can actually run it, so the control never appears
   * where pressing it would do nothing.
   */
  setAnnotationAction(state: AnnotationAction, run: () => void): void;
  /** A reference followed from inside a note; the mount owns moving between files. */
  onNoteRef(cb: (path: string, line?: number) => void): void;
  /**
   * Promote a note to a short answer. Registering this is what makes the popup's button appear,
   * so an instance with no session never renders a control that cannot work.
   */
  onNoteExpand(cb: (lines: [number, number], what: string) => void): void;
  /** Scroll a line into view and select it, for a code reference or a scrap list entry. */
  reveal(range: [number, number]): void;

  /**
   * Where the debug run stands IN THE FILE ON SCREEN. Both null when the run is elsewhere or
   * there is no run. A method rather than state of its own, and for the same reason `markScraps`
   * is one: `show()` rebuilds every line, so the mount reapplies this after each file switch and
   * the panel never has to know what a run is.
   */
  markDebug(startLine: number | null, currentLine: number | null): void;
  /** Whether Space steps. Off means the key is left alone, so nothing else on screen loses it. */
  setDebugActive(on: boolean): void;
  /** Step forward (1) or back (-1). The only free callback slot on this panel. */
  onStepKey(cb: (dir: 1 | -1) => void): void;
  /**
   * Open the popup on a debug step, carrying that line's annotation too when it has one. Passing
   * null closes it, which is how a run ends without the mount reaching into the popup.
   */
  showDebug(line: number, view: DebugView | null): void;
  /**
   * The debug control in the panel header. One slot, four states, because a run needs both a way
   * in and a way out and the header is a single row -- the same sharing the note link already
   * does with its retry.
   */
  setDebugControl(state: "hidden" | "ready" | "loading" | "running", run: () => void): void;
}

export type AnnotationAction = "none" | "retry" | "make" | "pending";

const ACTION_LABELS: Record<Exclude<AnnotationAction, "none">, string> = {
  retry: "설명 다시 만들기",
  make: "설명 만들기",
  pending: "설명 만드는 중",
};

export function createCodePanel(): CodePanel {
  const root = el("div", "lh-cp-panel lh-cp-code-panel");
  const head = el("div", "lh-cp-panel-head");
  const pathLabel = el("button", "lh-cp-path-label", "파일을 선택하세요");
  const selectionLabel = el("span", "lh-cp-selection-label", "");
  // Shown only when the selected line actually has a note, so it is never a control that does
  // nothing. It carries the gesture too, because nothing else on screen teaches it.
  const noteLink = el("button", "lh-cp-note-link", "주석 보기 (Alt+Enter)");
  noteLink.hidden = true;
  // Appears with a selection, because "the line you picked" is the whole input to a run. Turns
  // into the way out once one is going, so the header never carries both at once.
  const debugBtn = el("button", "lh-cp-debug-btn", "디버그 실행");
  debugBtn.hidden = true;
  const scrapBtn = el("button", "lh-cp-scrap-btn", "스크랩 담기");
  scrapBtn.hidden = true;
  const clearBtn = el("button", "lh-cp-clear-selection", "선택 해제");
  clearBtn.hidden = true;
  head.appendChild(pathLabel);
  head.appendChild(selectionLabel);
  head.appendChild(noteLink);
  head.appendChild(debugBtn);
  head.appendChild(scrapBtn);
  head.appendChild(clearBtn);
  const codeArea = el("div", "lh-cp-code-scroll");
  // Focusable by script, never by Tab. A debug run parks focus here so that Space is not being
  // typed into the question box or re-pressing the button that started the run; code lines carry
  // no tabindex, so once focus is here clicking a line cannot take it away again.
  codeArea.tabIndex = -1;
  /*
   * The wrap toggle floats over the top-right of the code rather than joining the head: the head
   * is a single nowrap row that already clips its path label when a selection is up, and a sixth
   * control there would be the first thing cut. It sits in a wrapper, not in the scroll area, so it
   * stays put while the code scrolls under it.
   */
  const codeBody = el("div", "lh-cp-code-body");
  const wrapBtn = el("button", "lh-cp-wrap-toggle");
  wrapBtn.type = "button";
  wrapBtn.innerHTML = WRAP_ICON;
  let wrap = readWrapPreference();
  codeBody.appendChild(codeArea);
  codeBody.appendChild(wrapBtn);
  root.appendChild(head);
  root.appendChild(codeBody);

  let anchor: number | null = null;
  let range: [number, number] | null = null;
  let listener: ((r: [number, number] | null) => void) | null = null;
  let scrapListener: ((r: [number, number]) => void) | null = null;
  let scrapRanges: [number, number][] = [];
  let notes: Annotation[] = [];
  let noteIndex: Int32Array | null = null;
  let lineCount = 0;
  let refListener: ((path: string, line?: number) => void) | null = null;
  let expandListener: ((lines: [number, number], what: string) => void) | null = null;
  let closeTimer: number | null = null;
  let action: AnnotationAction = "none";
  let actionRun: (() => void) | null = null;
  // Where a debug run stands in the file currently shown. Deliberately outside `show()`'s reset
  // block: the mount owns the run and reapplies these after every file switch.
  let debugStart: number | null = null;
  let debugCurrent: number | null = null;
  let debugActive = false;
  let stepListener: ((dir: 1 | -1) => void) | null = null;
  let debugPress: (() => void) | null = null;
  /** The step currently on screen, kept so a scroll can re-place its popup rather than close it. */
  let debugShown: { line: number; view: DebugView } | null = null;

  debugBtn.addEventListener("click", () => debugPress?.());

  // ── soft wrap ──────────────────────────────────────────────────────────────

  function applyWrap(): void {
    codeArea.classList.toggle("lh-cp-code-scroll--wrap", wrap);
    wrapBtn.setAttribute("aria-pressed", String(wrap));
    const label = wrap ? "긴 줄 줄바꿈 끄기" : "긴 줄 줄바꿈 켜기";
    wrapBtn.setAttribute("aria-label", label);
    wrapBtn.title = label;
    scheduleWrapMarks();
  }

  /*
   * The mark at the end of each wrapped row. Where a row breaks is known only after layout, so this
   * measures the line body's inline fragments and places one absolutely positioned mark per break.
   * Absolute, never inline: a glyph inserted into the text would take width and move the break it
   * is marking. The glyph itself is CSS content on an aria-hidden span, so copying code never picks
   * it up and a screen reader never reads it.
   */
  let wrapFrame = 0;
  function scheduleWrapMarks(): void {
    if (typeof requestAnimationFrame !== "function") return;
    if (wrapFrame) cancelAnimationFrame(wrapFrame);
    wrapFrame = requestAnimationFrame(() => {
      wrapFrame = 0;
      paintWrapMarks();
    });
  }

  function paintWrapMarks(): void {
    codeArea.querySelectorAll(".lh-cp-wrap-mark").forEach((m) => m.remove());
    if (!wrap) return;
    codeArea.querySelectorAll(".lh-cp-code-line").forEach((lineEl) => {
      const body = lineEl.querySelector(".lh-cp-line-body");
      if (!body) return;
      // One fragment per visual row, so fewer than two means the line did not wrap: skip it cheaply.
      if (body.getClientRects().length < 2) return;
      const origin = lineEl.getBoundingClientRect();
      for (const row of wrappedRowEnds(glyphBoxes(body))) {
        const mark = el("span", "lh-cp-wrap-mark");
        mark.setAttribute("aria-hidden", "true");
        mark.style.left = `${row.right - origin.left}px`;
        mark.style.top = `${row.top - origin.top}px`;
        mark.style.height = `${row.bottom - row.top}px`;
        lineEl.appendChild(mark);
      }
    });
  }

  /*
   * The box of every visible character in a wrapped line, whitespace left out.
   *
   * Row fragments alone put the mark at the panel edge: `pre-wrap` keeps the space the line broke
   * at, and that space hangs to the end of the row. Measured 2026-09-15, a mark sat a third of the
   * panel away from the word it followed. Per-character boxes find where the text on each row
   * actually ends. Only wrapped lines get here, so the cost is paid on the few long ones.
   */
  function glyphBoxes(body: Element): { top: number; bottom: number; right: number }[] {
    const boxes: { top: number; bottom: number; right: number }[] = [];
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? "";
      for (let i = 0; i < text.length; i += 1) {
        if (text[i].trim() === "") continue;
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const r = range.getBoundingClientRect();
        if (r.height > 0) boxes.push({ top: r.top, bottom: r.bottom, right: r.right });
      }
    }
    return boxes;
  }

  wrapBtn.addEventListener("click", () => {
    wrap = !wrap;
    writeWrapPreference(wrap);
    // Every line just changed height, so a hover popup points at nothing; a debug step is re-placed.
    if (debugShown) placeDebugPopup();
    else closeNote();
    applyWrap();
  });

  // Breaks move with the panel's width: resizing the window, dragging a pane, or the narrow layout.
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => {
      if (wrap) scheduleWrapMarks();
    }).observe(codeArea);
  }
  /*
   * Breaks also move when the code font finishes loading, and no resize fires for that. Measured
   * 2026-09-15: marks painted against the fallback font sat 19px short of where the web font ended
   * the row, on top of the last word.
   */
  const fonts = typeof document !== "undefined" ? (document as Document & { fonts?: FontFaceSet }).fonts : undefined;
  fonts?.ready?.then(() => {
    if (wrap && root.isConnected) scheduleWrapMarks();
  });
  fonts?.addEventListener?.("loadingdone", () => {
    if (wrap && root.isConnected) scheduleWrapMarks();
  });

  // After `wrapFrame` exists: applyWrap schedules a paint, and a `let` is not hoisted.
  applyWrap();

  /**
   * Put the debug popup next to its own line, wherever that line is now.
   *
   * Hidden rather than moved once the line has scrolled out of the code area: a fixed popup
   * clamped to the viewport would otherwise sit at the edge pointing at nothing.
   */
  function placeDebugPopup(): void {
    if (!debugShown) return;
    // Any close the hover path had queued is void: this popup is not the one it was closing.
    if (closeTimer !== null) {
      window.clearTimeout(closeTimer);
      closeTimer = null;
    }
    const anchorRect = anchorFor(debugShown.line, debugShown.line);
    const box = codeArea.getBoundingClientRect();
    if (!anchorRect || anchorRect.bottom < box.top || anchorRect.top > box.bottom) {
      popup.hide();
      return;
    }
    const i = noteIndex ? noteIndex[debugShown.line] : -1;
    popup.showFor(i >= 0 ? notes[i] : null, anchorRect, debugShown.view);
  }

  function paint(): void {
    codeArea.querySelectorAll(".lh-cp-code-line").forEach((lineEl) => {
      const e = lineEl as HTMLElement;
      const n = Number(e.dataset["line"]);
      e.classList.toggle("lh-cp-line-selected", !!range && n >= range[0] && n <= range[1]);
      // Collected regions stay marked while reading, in a quieter way than the live selection.
      e.classList.toggle("lh-cp-line-scrapped", scrapRanges.some(([a, b]) => n >= a && n <= b));
      // Inert on its own; it only becomes visible while Ctrl is held. The class is static so
      // holding Ctrl costs one class toggle on the container instead of a pass over every line.
      e.classList.toggle("lh-cp-has-note", !!noteIndex && noteIndex[n] >= 0);
      // Debug takes the two channels the other three do not: the empty space left of the line
      // number, and the row's right edge. Selection owns the row background, a scrap owns the
      // left rail, an annotation owns the text underline -- all four can sit on one line.
      e.classList.toggle("lh-cp-debug-start", debugStart === n);
      e.classList.toggle("lh-cp-debug-current", debugCurrent === n);
    });

    const selected = range && noteIndex ? noteIndex[range[0]] : -1;
    selectionLabel.textContent = range ? `선택: ${range[0]}-${range[1]}행` : "";
    // The keyboard and touch way in. It is a label rather than a header button because the head
    // is a single nowrap row with overflow hidden, and a fifth control there is simply clipped.
    // One slot, two states that cannot both hold: a file whose notes failed has none on any line.
    // 설명 for the states that build notes, 주석 for looking at one that exists: the split the
    // retry label and the waiting screen already used before the two new states joined them.
    noteLink.disabled = false;
    noteLink.classList.remove("lh-cp-note-link--pending");
    if (selected >= 0) {
      noteLink.hidden = false;
      noteLink.textContent = "주석 보기 (Alt+Enter)";
    } else if (action !== "none") {
      noteLink.hidden = false;
      noteLink.textContent = ACTION_LABELS[action];
      if (action === "pending") {
        noteLink.disabled = true;
        noteLink.classList.add("lh-cp-note-link--pending");
      }
    } else {
      noteLink.hidden = true;
    }
    scrapBtn.hidden = !range;
    clearBtn.hidden = !range;
    listener?.(range);
  }

  /**
   * The rectangle a popup is placed against: vertically the whole range, horizontally the CODE
   * rather than the row.
   *
   * The row is as wide as the panel, so anchoring to it would leave no room to the right and push
   * every popup back under the code. `.lh-cp-line-text` is an inline span with `white-space: pre`
   * and no flex sizing, so its right edge is where that line's text actually ends -- the
   * semicolon, in a language that has one. Over a multi-line range the widest line wins, so the
   * popup clears all of the code it is about and not just the first line of it.
   */
  function anchorFor(lo: number, hi: number): DOMRect | null {
    const first = codeArea.querySelector(`.lh-cp-code-line[data-line="${lo}"]`);
    const last = codeArea.querySelector(`.lh-cp-code-line[data-line="${hi}"]`) ?? first;
    if (!first || !last) return null;
    const a = first.getBoundingClientRect();
    const b = last.getBoundingClientRect();
    let right = a.left;
    for (let n = lo; n <= hi; n += 1) {
      const text = codeArea.querySelector(`.lh-cp-code-line[data-line="${n}"] .lh-cp-line-text`);
      if (text) right = Math.max(right, text.getBoundingClientRect().right);
    }
    return new DOMRect(a.left, a.top, Math.max(0, right - a.left), b.bottom - a.top);
  }

  /**
   * Open the note covering a line, anchored to the whole range it explains.
   *
   * Anchoring to the hovered row alone would put the popup on top of the rest of the range when
   * it falls back to below-the-code, so a six-line note covers five of the lines it is about
   * (08 §3.5: the popup must not hide the code).
   */
  function openNoteAt(line: number): void {
    if (!noteIndex || line < 1 || line > lineCount) return;
    const i = noteIndex[line];
    if (i < 0) return;
    const [lo, hi] = notes[i].target.lines;
    const anchor = anchorFor(lo, hi);
    if (!anchor) return;
    // An explicit request for this line's note takes the popup from a run that was using it.
    // Space brings the step back; two things fighting over one popup would not be recoverable.
    debugShown = null;
    popup.showFor(notes[i], anchor);
  }

  scrapBtn.addEventListener("click", () => {
    if (range) scrapListener?.(range);
  });

  const popup = createNotePopup({
    onScrap: (r) => {
      setRange(r);
      scrapListener?.(r);
    },
    canExpand: () => expandListener !== null,
    onExpand: (lines, what) => {
      setRange(lines);
      expandListener?.(lines, what);
    },
    onRef: (path, line) => refListener?.(path, line),
  });
  root.appendChild(popup.root);

  /**
   * Dismiss whatever is in the popup, debug step included. For the explicit gestures only:
   * Escape, leaving the window, switching files.
   */
  function closeNote(): void {
    if (closeTimer !== null) window.clearTimeout(closeTimer);
    closeTimer = null;
    debugShown = null;
    popup.hide();
  }

  /**
   * The hover machinery's own close. It must not touch a debug step: that popup was not opened by
   * a pointer, so a pointer moving away is not a reason to take it down. Without this, moving the
   * mouse anywhere over the code dismisses the step the learner is on.
   */
  function closeHover(): void {
    if (debugShown) return;
    closeNote();
  }

  // Ctrl state is read off the pointer event rather than tracked with a global keydown listener.
  // That listener is the one that gets stuck "held" when the window loses focus mid-press, and
  // not having it means the bug cannot happen.
  codeArea.addEventListener("mousemove", (ev) => {
    const e = ev as MouseEvent;
    codeArea.classList.toggle("lh-cp-ctrl-held", e.ctrlKey);
    // One popup, one owner. While a run is on screen the hover path neither opens nor closes it;
    // the learner still reaches a line's note explicitly, through Alt+Enter or the header link.
    if (debugShown) return;
    if (!e.ctrlKey) {
      closeHover();
      return;
    }
    const row = (e.target as HTMLElement | null)?.closest?.(".lh-cp-code-line") as HTMLElement | null;
    if (!row) return;
    const line = Number(row.dataset["line"]);
    // A line with no note opens nothing. An empty popup is worse than no popup.
    if (!noteIndex || noteIndex[line] < 0) {
      closeHover();
      return;
    }
    if (closeTimer !== null) {
      window.clearTimeout(closeTimer);
      closeTimer = null;
    }
    openNoteAt(line);
  });

  // Leaving the code gives a moment to reach the popup, which sits outside this element.
  codeArea.addEventListener("mouseleave", () => {
    if (debugShown) return;
    if (closeTimer !== null) window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => {
      // Re-checked here, not only when the timer was set. Moving the pointer from the code up to
      // the debug button fires this leave BEFORE the run exists, and 120ms later the run has
      // started and opened its popup -- which this would then close. Measured 2026-09-05: the
      // popup rendered correctly and vanished a tenth of a second later, every single time.
      if (!popup.hovered && !debugShown) popup.hide();
      closeTimer = null;
    }, 120);
  });

  /*
   * Scrolling moves the code out from under a stationary cursor without firing any mouse event,
   * so none of the documented close triggers would fire and a hover popup would hang in place.
   *
   * A debug popup is followed instead of closed. It was not opened by a pointer that has now
   * moved on -- it belongs to a step the learner is still on, and closing it means every step
   * that has to scroll closes its own popup: `markDebug` scrolls, the scroll event arrives after
   * the popup opened, and it is shut again before anyone sees it. Measured 2026-09-05, on the
   * step that crosses into another file, which always scrolls.
   */
  codeArea.addEventListener("scroll", () => {
    if (debugShown) placeDebugPopup();
    else closeNote();
  });

  // A resize moves every line without moving the popup, which is positioned once in fixed
  // coordinates. Measured 2026-09-05 at 880px: a popup placed at 1600px stayed where it was and
  // hung 23px off the right edge and 232px below the bottom. Same split as the scroll: a step is
  // re-placed, a hover popup is closed.
  window.addEventListener("resize", () => {
    if (debugShown) placeDebugPopup();
    else closeNote();
  });

  window.addEventListener("keyup", (ev) => {
    if ((ev as KeyboardEvent).key === "Control") {
      codeArea.classList.remove("lh-cp-ctrl-held");
      closeNote();
    }
  });

  window.addEventListener("keydown", (ev) => {
    const e = ev as KeyboardEvent;
    if (e.key === "Escape") {
      codeArea.classList.remove("lh-cp-ctrl-held");
      closeNote();
      return;
    }
    const tag = (document.activeElement as HTMLElement | null)?.tagName;
    /*
     * Space steps a debug run; Shift+Space goes back.
     *
     * The guard is wider than Alt+Enter's below, which only has to stay out of the question box.
     * This one also has to survive a focused <button>, because a native button activates on the
     * Space KEYUP that follows this keydown -- and the button that started the run is holding
     * focus at exactly that moment. preventDefault here suppresses that synthetic click and the
     * page scroll in one move. The run also parks focus on the code area, so in practice this
     * fires with nothing focusable in the way; the guard is what makes it safe when it does not.
     */
    if (
      debugActive &&
      // These window listeners outlive their panel: the flow discards the study screen by
      // emptying its container, which detaches the DOM and leaves the listeners attached. The
      // other branches only repaint a node nobody can see, but this one CONSUMES a key -- a
      // learner who left mid-run would find Space dead on every screen for the rest of the page.
      root.isConnected &&
      e.code === "Space" &&
      tag !== "INPUT" &&
      tag !== "TEXTAREA" &&
      tag !== "SELECT"
    ) {
      e.preventDefault();
      stepListener?.(e.shiftKey ? -1 : 1);
      return;
    }
    // Alt+Enter is the path for a learner who is not using a mouse. It must not fire while the
    // caret is in the question box, where Enter belongs to the text.
    if (e.altKey && e.key === "Enter" && tag !== "INPUT" && tag !== "TEXTAREA" && range) {
      e.preventDefault();
      openNoteAt(range[0]);
    }
  });

  // Alt-tabbing away while Ctrl is down would otherwise leave the affordance painted on.
  window.addEventListener("blur", () => {
    codeArea.classList.remove("lh-cp-ctrl-held");
    closeNote();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      codeArea.classList.remove("lh-cp-ctrl-held");
      closeNote();
    }
  });

  function setRange(next: [number, number] | null): void {
    range = next;
    paint();
  }

  noteLink.addEventListener("click", () => {
    if (range && noteIndex && noteIndex[range[0]] >= 0) {
      openNoteAt(range[0]);
      return;
    }
    if (action === "retry" || action === "make") actionRun?.();
  });

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
      // The previous file's notes are indexed against the previous file's line numbers, so
      // they are void the instant the content changes. The mount hands the new ones over next.
      notes = [];
      noteIndex = null;
      closeNote();

      const pre = el("pre", "lh-cp-code");
      const lines = content.split("\n");
      lineCount = lines.length;
      // Highlight the whole file at once so multi-line constructs (docstrings, block comments) are
      // recognised, then take it back apart with tags balanced per row. The language comes from the
      // file's own `lang` when one was set, otherwise from its extension.
      const highlighted = highlightLines(content, lang || path);
      lines.forEach((text, i) => {
        const n = i + 1;
        const lineEl = el("div", "lh-cp-code-line");
        lineEl.dataset["line"] = String(n);
        lineEl.appendChild(el("span", "lh-cp-line-num", String(n)));
        const codeEl = el("span", "lh-cp-line-text");
        // An inline body inside the block, because only an inline box reports one fragment per
        // visual row, which is what the wrap marks are placed from.
        const body = el("span", "lh-cp-line-body");
        body.innerHTML = highlighted[i] ?? "";
        codeEl.appendChild(body);
        // A continuation row hangs from this line's own indent, not from column zero, so a wrapped
        // statement still sits inside its block. Set on every line so toggling needs no rebuild.
        codeEl.style.setProperty("--lh-wrap-indent", String(leadingColumns(text) + WRAP_EXTRA_CH));
        lineEl.appendChild(codeEl);
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
      scheduleWrapMarks();
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
    onNoteRef(cb) {
      refListener = cb;
    },
    onNoteExpand(cb) {
      expandListener = cb;
    },
    setAnnotationAction(state, run) {
      action = state;
      actionRun = state === "none" ? null : run;
      paint();
    },
    setAnnotations(items) {
      notes = items;
      noteIndex = items.length ? buildLineIndex(items, lineCount) : null;
      const file = fileNote(items);
      // The file-level note has no line range worth underlining, so it hangs off the one element
      // that is always present and always names the file.
      pathLabel.classList.toggle("lh-cp-path-label--noted", !!file);
      pathLabel.title = file ? file.what : "";
      pathLabel.onclick = file
        ? () => popup.showFor(file, pathLabel.getBoundingClientRect())
        : null;
      paint();
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
    markDebug(startLine, currentLine) {
      debugStart = startLine;
      debugCurrent = currentLine;
      paint();
      if (currentLine === null) return;
      // The learner may have scrolled away between steps, and a step they cannot see is not one.
      // Instant, not smooth: a smooth scroll keeps firing scroll events for hundreds of
      // milliseconds after the step landed, and each one re-places the popup mid-animation.
      const row = codeArea.querySelector(`[data-line="${currentLine}"]`);
      if (typeof row?.scrollIntoView === "function") {
        row.scrollIntoView({ block: "center", behavior: "auto" });
      }
    },
    setDebugActive(on) {
      debugActive = on;
      // Take focus off whatever button started the run. Nothing else on this screen wants Space,
      // and the code area cannot consume it.
      if (on && typeof codeArea.focus === "function") codeArea.focus({ preventScroll: true });
    },
    onStepKey(cb) {
      stepListener = cb;
    },
    setDebugControl(state, run) {
      debugPress = run;
      debugBtn.hidden = state === "hidden";
      debugBtn.disabled = state === "loading";
      debugBtn.textContent =
        state === "running" ? "디버그 중단" : state === "loading" ? "흐름 만드는 중" : "디버그 실행";
      debugBtn.classList.toggle("lh-cp-debug-btn--on", state === "running");
    },
    showDebug(line, view) {
      if (!view) {
        debugShown = null;
        closeNote();
        return;
      }
      // A stepped line may also carry an annotation. Both are about this line, so both are shown,
      // in one popup, in the order they were written: the standing note first, the run below it.
      // Placement goes through the same path a scroll uses, so the two cannot drift apart.
      debugShown = { line, view };
      placeDebugPopup();
    },
  };
}

// ── AI panel (right) ──────────────────────────────────────────────────────────

export type AnswerDepth = "full" | "semi";

export interface AiPanelHandlers {
  onExplain(lens: Lens): void;
  onAsk(question: string, depth: AnswerDepth): void;
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
  startEntry(title: string, opts?: { depth?: AnswerDepth }): {
    setBody(text: string): void;
    setContent(node: HTMLElement): void;
    /**
     * Offer one action under the answer. Used for the promotion path out of a short answer; the
     * entry has no footer at all until something asks for one.
     */
    setFooter(label: string, run: () => void): void;
    /**
     * Replace the pending text and mark it as a long wait. The ordinary 5-13s call keeps the
     * quiet static line; this is for the rare load-class wait, where unchanging grey text
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
  // Depth lives beside the question box, always visible: a mode tucked into a settings screen is
  // one the learner forgets is on. It is styled as a quiet selected state, not a third filled
  // button competing with 설명 요청 and 질문 for the eye.
  const depthRow = el("div", "lh-cp-depth");
  depthRow.appendChild(el("span", "lh-cp-depth-label", "답변 길이"));
  const shortBtn = el("button", "lh-cp-depth-btn", "짧게");
  const longBtn = el("button", "lh-cp-depth-btn", "자세히");
  shortBtn.type = "button";
  longBtn.type = "button";
  depthRow.appendChild(shortBtn);
  depthRow.appendChild(longBtn);
  let depth: AnswerDepth = "semi";

  root.appendChild(thread);
  root.appendChild(depthRow);
  root.appendChild(askBar);

  explainBtn.addEventListener("click", () => handlers.onExplain(lensSelect.value as Lens));
  askBar.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const question = askInput.value.trim();
    if (!question) return;
    askInput.value = "";
    handlers.onAsk(question, depth);
  });

  function setDepth(next: AnswerDepth): void {
    depth = next;
    shortBtn.classList.toggle("lh-cp-depth--on", next === "semi");
    longBtn.classList.toggle("lh-cp-depth--on", next === "full");
  }
  shortBtn.addEventListener("click", () => setDepth("semi"));
  longBtn.addEventListener("click", () => setDepth("full"));
  setDepth("semi");

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
    startEntry(title, opts) {
      empty.remove();
      const entry = el("div", "lh-cp-entry");
      const head = el("div", "lh-cp-entry-title", title);
      if (opts?.depth === "semi") {
        entry.classList.add("lh-cp-entry--semi");
        // The badge the kit already uses to qualify a title, rather than a second one that would
        // mean the same thing.
        head.appendChild(el("span", "lh-cp-ai-badge", "짧은 답"));
      }
      entry.appendChild(head);
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
        setFooter(label: string, run: () => void) {
          const foot = el("div", "lh-cp-entry-foot");
          const btn = el("button", "lh-cp-entry-promote", label);
          btn.addEventListener("click", run);
          foot.appendChild(btn);
          entry.appendChild(foot);
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
