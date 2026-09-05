// The annotation popup. A small widget with no knowledge of where annotations come from: it is
// handed one and shown at a rectangle, which keeps the geometry decision in `annotations.ts`
// where it can be tested without a layout engine.
//
// It is appended inside the codeproj root so its rules can be written as
// `.lh-codeproj .lh-cp-note-popup` — the `lh-cp-` prefix is shared with conceptprob, and a bare
// selector there has already put one panel off the screen once.

import { placePopup, type Annotation } from "./annotations";
import { el } from "./view";

export interface NotePopupHandlers {
  /** Collect the annotated range, exactly as the header's own button does. */
  onScrap(range: [number, number]): void;
  /** Promote what is on screen to a short answer. Takes a range and a sentence, not a note,
   * because a debug step has both and is not an annotation. */
  onExpand(lines: [number, number], what: string): void;
  /**
   * Whether promotion is possible at all, asked when the popup is drawn rather than when it is
   * built: the mount registers its handlers after this exists, so construction time is too early
   * to know. Without it an instance with no session draws a button that does nothing.
   */
  canExpand(): boolean;
  /** A reference the learner followed. Closing is the popup's job; navigating is the mount's. */
  onRef(path: string, line?: number): void;
}

/**
 * One step of a debug run, ready to draw.
 *
 * It arrives already diffed: `changed` per variable is computed by the mount from the neighbouring
 * step, because the popup has no idea what came before it and the trace model deliberately stores
 * a full snapshot rather than a delta.
 */
export interface DebugView {
  /** Position in the run, 1-based, and its length. */
  at: number;
  total: number;
  /** The line this step is on, so the footer can collect it when there is no annotation. */
  line: number;
  explain: string;
  vars: { name: string; value: string; scope?: string; changed: boolean }[];
  /** At the end of a run that stopped before the program did. */
  truncated: boolean;
  /** The next file's steps have not arrived yet. */
  pending?: boolean;
}

export interface NotePopup {
  /**
   * Show an annotation, a debug step, or both on the same line at once. Neither means nothing to
   * say, and the popup stays closed rather than opening empty.
   */
  showFor(note: Annotation | null, anchor: DOMRect, debug?: DebugView): void;
  root: HTMLElement;
  hide(): void;
  readonly open: boolean;
  /** True while the pointer is inside the popup, so a mouseout over code does not close it. */
  readonly hovered: boolean;
}

export function createNotePopup(handlers: NotePopupHandlers): NotePopup {
  const root = el("div", "lh-cp-note-popup");
  root.hidden = true;
  let open = false;
  let hovered = false;

  root.addEventListener("mouseenter", () => {
    hovered = true;
  });
  root.addEventListener("mouseleave", () => {
    hovered = false;
  });

  /**
   * The debug half: the step counter, the standing honesty label, the step's sentence, and the
   * live variable set.
   *
   * The label is constant and always shown. A per-step confidence flag was considered and left
   * out: marking some steps uncertain reads as verification of the ones without a mark, and every
   * step in a predicted walkthrough is equally a guess.
   */
  function renderDebug(debug: DebugView, hasNote: boolean): void {
    // Only between two things. A divider above nothing is a line for its own sake.
    if (hasNote) root.appendChild(el("div", "lh-cp-debug-sep"));

    const meta = el("div", "lh-cp-debug-meta");
    meta.appendChild(el("span", "lh-cp-debug-counter", `${debug.at}/${debug.total}단계`));
    meta.appendChild(el("span", "lh-cp-debug-predicted", "예측"));
    root.appendChild(meta);

    root.appendChild(el("p", "lh-cp-debug-what", debug.explain));

    if (debug.pending) {
      root.appendChild(el("p", "lh-cp-debug-note", "다음 파일의 흐름을 받아오는 중입니다."));
    } else if (debug.at >= debug.total) {
      root.appendChild(
        el(
          "p",
          "lh-cp-debug-note",
          debug.truncated
            ? "여기까지만 따라갔습니다. 프로그램이 끝난 지점은 아닙니다."
            : "마지막 단계입니다.",
        ),
      );
    }

    if (debug.vars.length) {
      const table = el("div", "lh-cp-debug-vars");
      for (const v of debug.vars) {
        const name = el("div", "lh-cp-debug-var-name", v.scope ? `${v.scope}.${v.name}` : v.name);
        const value = el("div", "lh-cp-debug-var-value", v.value);
        if (v.changed) {
          name.classList.add("lh-cp-debug-var--changed");
          value.classList.add("lh-cp-debug-var--changed");
        }
        table.appendChild(name);
        table.appendChild(value);
      }
      root.appendChild(table);
    }
  }

  function render(note: Annotation | null, debug?: DebugView): void {
    root.innerHTML = "";
    root.classList.toggle("lh-cp-note-popup--debug", !!debug);

    if (note) renderNote(note);
    if (debug) renderDebug(debug, !!note);

    const target: [number, number] = note ? note.target.lines : [debug!.line, debug!.line];
    const what = note ? note.what : debug!.explain;

    const foot = el("div", "lh-cp-note-foot");
    // Named exactly as the header button that does the same thing. Two names for one action is
    // how an interface stops teaching itself.
    const scrap = el("button", "lh-cp-note-scrap", "스크랩 담기");
    scrap.addEventListener("click", () => {
      hide();
      handlers.onScrap(target);
    });
    foot.appendChild(scrap);
    if (handlers.canExpand()) {
      const expand = el("button", "lh-cp-note-expand", "더 알아보기");
      expand.addEventListener("click", () => {
        hide();
        handlers.onExpand(target, what);
      });
      foot.appendChild(expand);
    }
    root.appendChild(foot);
  }

  function renderNote(note: Annotation): void {
    const head = el("div", "lh-cp-note-head");
    const [lo, hi] = note.target.lines;
    head.appendChild(el("span", "lh-cp-note-where", lo === hi ? `${lo}행` : `${lo}-${hi}행`));
    if (note.target.symbol) head.appendChild(el("span", "lh-cp-note-symbol", note.target.symbol));
    root.appendChild(head);

    root.appendChild(el("p", "lh-cp-note-what", note.what));
    if (note.why) root.appendChild(el("p", "lh-cp-note-why", note.why));

    // The concept is a single word, so it gets the chip the rest of the screen already uses for
    // short meta information rather than a label of its own.
    if (note.concept) {
      const row = el("div", "lh-cp-note-tags");
      row.appendChild(el("span", "lh-cp-chip", note.concept));
      root.appendChild(row);
    }

    // A pitfall is a different kind of sentence from a rationale, and the kit already has the
    // treatment for it: the caution block used by composed answers, without its title row.
    if (note.watch) root.appendChild(el("div", "lh-cb-caution", note.watch));

    if (note.refs?.length) {
      const refs = el("div", "lh-cp-note-refs");
      for (const ref of note.refs) {
        const label = ref.label
          ? `${ref.path}${ref.line ? `:${ref.line}` : ""} · ${ref.label}`
          : `${ref.path}${ref.line ? `:${ref.line}` : ""}`;
        const link = el("button", "lh-cp-note-ref", label);
        link.addEventListener("click", () => {
          hide();
          handlers.onRef(ref.path, ref.line);
        });
        refs.appendChild(link);
      }
      root.appendChild(refs);
    }
  }

  function showFor(note: Annotation | null, anchor: DOMRect, debug?: DebugView): void {
    if (!note && !debug) return;
    render(note, debug);
    // Measured after rendering and before positioning: the popup's height depends on which
    // optional fields this annotation actually has.
    root.hidden = false;
    root.style.visibility = "hidden";
    const size = { width: root.offsetWidth, height: root.offsetHeight };
    const at = placePopup(
      { left: anchor.left, top: anchor.top, width: anchor.width, height: anchor.height },
      size,
      { width: window.innerWidth, height: window.innerHeight },
    );
    root.style.left = `${at.left}px`;
    root.style.top = `${at.top}px`;
    root.classList.toggle("lh-cp-note-popup--above", at.above);
    root.classList.toggle("lh-cp-note-popup--beside", at.beside);
    root.style.visibility = "";
    open = true;
  }

  function hide(): void {
    if (!open) return;
    root.hidden = true;
    open = false;
    hovered = false;
  }

  return {
    root,
    showFor,
    hide,
    get open() {
      return open;
    },
    get hovered() {
      return hovered;
    },
  };
}
