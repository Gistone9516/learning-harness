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
  /** A reference the learner followed. Closing is the popup's job; navigating is the mount's. */
  onRef(path: string, line?: number): void;
}

export interface NotePopup {
  root: HTMLElement;
  showFor(note: Annotation, anchor: DOMRect): void;
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

  function render(note: Annotation): void {
    root.innerHTML = "";

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

    const foot = el("div", "lh-cp-note-foot");
    // Named exactly as the header button that does the same thing. Two names for one action is
    // how an interface stops teaching itself.
    const scrap = el("button", "lh-cp-note-scrap", "스크랩 담기");
    scrap.addEventListener("click", () => {
      hide();
      handlers.onScrap(note.target.lines);
    });
    foot.appendChild(scrap);
    root.appendChild(foot);
  }

  function showFor(note: Annotation, anchor: DOMRect): void {
    render(note);
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
