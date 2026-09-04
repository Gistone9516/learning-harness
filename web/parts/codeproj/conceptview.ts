// The concepts view: a list rail and a reading column, sharing the study screen's grid.
//
// It is built as two panels that slot into the same `.lh-cp-panes` grid the code view uses, so the
// file rail and the AI panel do not change width when the learner switches tabs. Both views live
// in the DOM at once and are swapped by `display`; that is conceptprob's own mechanic, and it is
// what keeps scroll position, selection and the answer thread alive across a switch.
//
// The reading column takes the code panel's surface rather than a plain panel's. On this screen
// the brightest large surface is by design the thing being read (design 00 §1), and in this tab
// that role belongs to the article, not to the code.

import { docSteps, type ConceptEntry, type ConceptSet } from "./concepts";
import { el, renderBlock } from "../../src/doc/doc";

export interface ConceptViewHandlers {
  /** A concept was opened. The mount re-scopes the AI panel's target to it. */
  onOpen(entry: ConceptEntry | null): void;
  /** Retry one failed document. Absent when there is no session to retry with. */
  onRetry?(entry: ConceptEntry): void;
}

export interface ConceptView {
  /** The two panels, in grid order. The AI panel is the mount's and is shared with the code view. */
  rail: HTMLElement;
  reading: HTMLElement;
  render(set: ConceptSet | null): void;
  /** Open a concept by id, or the first written one when the id is unknown. */
  open(conceptId: string | null): void;
  readonly openId: string | null;
}

/** What a row says about itself. Only one tag is ever on screen: 작성 중 marks the current one. */
const ROW_TAG: Record<ConceptEntry["status"], string> = {
  pending: "",
  writing: "작성 중",
  ok: "",
  failed: "실패",
};

export function createConceptView(handlers: ConceptViewHandlers): ConceptView {
  const rail = el("aside", "lh-cp-panel lh-cp-concept-rail");
  const railHead = el("div", "lh-cp-panel-head");
  railHead.appendChild(el("span", "", "개념"));
  const railCount = el("span", "lh-cp-progress", "");
  railHead.appendChild(railCount);
  const railList = el("div", "lh-cp-concept-list");
  rail.appendChild(railHead);
  rail.appendChild(railList);

  const reading = el("section", "lh-cp-panel lh-cp-concept-reading");
  const readHead = el("div", "lh-cp-panel-head");
  const readTitle = el("span", "lh-cp-concept-title", "");
  readHead.appendChild(readTitle);
  const readScroll = el("div", "lh-cp-concept-scroll");
  const readBody = el("div", "lh-cp-concept-body");
  readScroll.appendChild(readBody);
  reading.appendChild(readHead);
  reading.appendChild(readScroll);

  let current: ConceptSet | null = null;
  let openId: string | null = null;

  function entryOf(id: string | null): ConceptEntry | null {
    if (!current || !id) return null;
    return current.entries.find((e) => e.seed.concept_id === id) ?? null;
  }

  function renderRail(): void {
    railList.innerHTML = "";
    const entries = current?.entries ?? [];
    const done = entries.filter((e) => e.status === "ok").length;
    // A real 0/8 is shown, not hidden: 0 here is a measured zero, not a missing number.
    railCount.textContent = entries.length ? `${done}/${entries.length}` : "";
    for (const entry of entries) {
      const row = el("button", "lh-cp-concept-row", "");
      row.type = "button";
      row.dataset["state"] = entry.status;
      if (entry.seed.concept_id === openId) row.classList.add("lh-cp-concept-row--on");
      row.appendChild(el("span", "lh-cp-concept-row-title", entry.seed.title));
      const tag = ROW_TAG[entry.status];
      if (tag) row.appendChild(el("span", "lh-cp-concept-row-tag", tag));
      // A row with nothing behind it is still clickable: opening it is how the learner learns
      // that it is coming, and the reading column says so in words.
      row.addEventListener("click", () => open(entry.seed.concept_id));
      railList.appendChild(row);
    }
  }

  function renderReading(): void {
    readBody.innerHTML = "";
    const entry = entryOf(openId);
    if (!entry) {
      readTitle.textContent = "";
      readBody.appendChild(
        el(
          "p",
          "lh-cp-concept-empty",
          current?.entries.length
            ? "왼쪽에서 개념을 고르세요."
            : "이 프로젝트의 개념은 아직 정리되지 않았습니다.",
        ),
      );
      return;
    }
    readTitle.textContent = entry.seed.title;

    if (entry.status === "failed") {
      readBody.appendChild(el("p", "lh-cp-concept-empty", "이 개념은 정리하지 못했습니다."));
      if (handlers.onRetry) {
        const again = el("button", "lh-cp-concept-retry", "다시 정리하기");
        again.type = "button";
        again.addEventListener("click", () => handlers.onRetry?.(entry));
        readBody.appendChild(again);
      }
      return;
    }

    const parsed = docSteps(entry);
    if (!parsed) {
      // The normal state for the first minutes. Says what is missing and what happens next, and
      // does not ask the learner to do anything -- nothing they can do would make it faster.
      readBody.appendChild(
        el(
          "p",
          "lh-cp-concept-empty",
          "이 개념은 아직 정리되지 않았습니다. 다 되면 이 화면에 저절로 나타납니다.",
        ),
      );
      return;
    }

    if (parsed.summary) readBody.appendChild(el("p", "lh-cp-concept-lead", parsed.summary));
    /*
     * The step's own markup, not an approximation of it. `.lh-cp-step` is a two-column grid --
     * the number in one, everything else in the other -- so wrapping the number and the title
     * together drops both into the 34px column and sets the title one character wide.
     */
    const list = el("ol", "lh-cp-steps");
    for (const [i, step] of parsed.steps.entries()) {
      const item = el("li", "lh-cp-step");
      if (i < parsed.steps.length - 1) item.appendChild(el("div", "lh-cp-step-line"));
      item.appendChild(el("div", "lh-cp-step-num", String(i + 1)));
      const main = el("div", "lh-cp-step-main");
      if (step.title) main.appendChild(el("div", "lh-cp-step-title", step.title));
      for (const block of step.blocks) main.appendChild(renderBlock(block));
      item.appendChild(main);
      list.appendChild(item);
    }
    readBody.appendChild(list);
  }

  function open(conceptId: string | null): void {
    openId = conceptId;
    renderRail();
    renderReading();
    readScroll.scrollTop = 0;
    handlers.onOpen(entryOf(openId));
  }

  function render(set: ConceptSet | null): void {
    current = set;
    // Hold the learner's place across a background update. Only move when what they had is gone.
    if (openId && !entryOf(openId)) openId = null;
    if (!openId) openId = set?.entries.find((e) => e.status === "ok")?.seed.concept_id ?? null;
    renderRail();
    renderReading();
  }

  return {
    rail,
    reading,
    render,
    open,
    get openId() {
      return openId;
    },
  };
}
