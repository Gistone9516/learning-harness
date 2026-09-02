// @vitest-environment jsdom
//
// The annotation layer's DOM behaviour. jsdom has no layout, so this asserts existence and
// disappearance only — where the popup lands is `placePopup`'s job and is tested as pure maths
// in annotations.test.ts.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountCodeproj } from "./codeproj";
import type { AnnotationSet } from "./annotations";

const PROJECT = {
  title: "도서 관리 API",
  summary: "요약",
  files: [
    { path: "app/db.py", content: "one\ntwo\nthree\nfour\nfive" },
    { path: "app/main.py", content: "alpha\nbeta" },
  ],
};

const ANNOTATIONS: AnnotationSet = {
  files: {
    "app/db.py": {
      status: "ok",
      items: [
        { target: { lines: [1, 5] }, kind: "file", what: "이 파일의 역할" },
        {
          target: { lines: [2, 3], symbol: "connect" },
          kind: "function",
          what: "커넥션을 연다",
          why: "요청마다 새로 연다",
          concept: "커넥션 수명",
          watch: "중첩 호출은 지원하지 않는다",
          refs: [{ path: "app/main.py", line: 1, label: "호출부" }],
        },
      ],
    },
    "app/main.py": { status: "failed", items: [] },
  },
};

function mount(annotations?: AnnotationSet) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  mountCodeproj(host, { session: null, project: PROJECT, annotations });
  return host;
}

const lineEl = (host: HTMLElement, n: number) =>
  host.querySelector(`.lh-cp-code-line[data-line="${n}"]`) as HTMLElement;

/** jsdom dispatches no real pointer events, so drive the handler the way a mouse would. */
function hover(host: HTMLElement, line: number, ctrlKey: boolean) {
  const scroll = host.querySelector(".lh-cp-code-scroll") as HTMLElement;
  const target = lineEl(host, line);
  const ev = new MouseEvent("mousemove", { bubbles: true, ctrlKey });
  target.dispatchEvent(ev);
  return scroll;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("annotation markers", () => {
  it("marks only the lines an annotation actually covers", () => {
    const host = mount(ANNOTATIONS);
    expect(lineEl(host, 1).classList.contains("lh-cp-has-note")).toBe(false);
    expect(lineEl(host, 2).classList.contains("lh-cp-has-note")).toBe(true);
    expect(lineEl(host, 3).classList.contains("lh-cp-has-note")).toBe(true);
    expect(lineEl(host, 4).classList.contains("lh-cp-has-note")).toBe(false);
  });

  it("does not let the file-level note light up every line", () => {
    // Its range is the whole file. If it were indexed, the affordance would say "there is
    // something here" about every single line, which is the same as saying nothing.
    const host = mount(ANNOTATIONS);
    const lit = [1, 2, 3, 4, 5].filter((n) => lineEl(host, n).classList.contains("lh-cp-has-note"));
    expect(lit).toEqual([2, 3]);
  });

  it("survives leaving the file and coming back", () => {
    // show() tears down and rebuilds every line, so a marker applied once would be gone.
    const host = mount(ANNOTATIONS);
    const files = host.querySelectorAll(".lh-cp-tree-file");
    (files[1] as HTMLButtonElement).click();
    (files[0] as HTMLButtonElement).click();
    expect(lineEl(host, 2).classList.contains("lh-cp-has-note")).toBe(true);
  });

  it("drops the previous file's markers when another file opens", () => {
    // The index is built against one file's line numbers; carrying it over would underline
    // whatever happened to be on those lines in the next file.
    const host = mount(ANNOTATIONS);
    (host.querySelectorAll(".lh-cp-tree-file")[1] as HTMLButtonElement).click();
    expect(lineEl(host, 1).classList.contains("lh-cp-has-note")).toBe(false);
    expect(lineEl(host, 2).classList.contains("lh-cp-has-note")).toBe(false);
  });

  it("marks nothing when the file's annotations failed", () => {
    const host = mount(ANNOTATIONS);
    (host.querySelectorAll(".lh-cp-tree-file")[1] as HTMLButtonElement).click();
    expect(host.querySelectorAll(".lh-cp-has-note")).toHaveLength(0);
  });

  it("marks nothing at all when no annotations were injected", () => {
    const host = mount();
    expect(host.querySelectorAll(".lh-cp-has-note")).toHaveLength(0);
  });
});

describe("Ctrl affordance and popup", () => {
  it("paints the affordance only while Ctrl is down", () => {
    const host = mount(ANNOTATIONS);
    const scroll = hover(host, 2, false);
    expect(scroll.classList.contains("lh-cp-ctrl-held")).toBe(false);
    hover(host, 2, true);
    expect(scroll.classList.contains("lh-cp-ctrl-held")).toBe(true);
  });

  it("opens on Ctrl+hover over an annotated line", () => {
    const host = mount(ANNOTATIONS);
    hover(host, 2, true);
    const popup = host.querySelector(".lh-cp-note-popup") as HTMLElement;
    expect(popup.hidden).toBe(false);
    expect(popup.textContent).toContain("커넥션을 연다");
    expect(popup.textContent).toContain("중첩 호출은 지원하지 않는다");
    expect(popup.querySelector(".lh-cp-chip")!.textContent).toBe("커넥션 수명");
  });

  it("opens nothing on a line with no annotation", () => {
    // An empty popup is worse than no popup: it teaches that the gesture is broken.
    const host = mount(ANNOTATIONS);
    hover(host, 4, true);
    expect((host.querySelector(".lh-cp-note-popup") as HTMLElement).hidden).toBe(true);
  });

  it("opens nothing without Ctrl", () => {
    const host = mount(ANNOTATIONS);
    hover(host, 2, false);
    expect((host.querySelector(".lh-cp-note-popup") as HTMLElement).hidden).toBe(true);
  });

  it("closes when Ctrl is released", () => {
    const host = mount(ANNOTATIONS);
    hover(host, 2, true);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Control" }));
    expect((host.querySelector(".lh-cp-note-popup") as HTMLElement).hidden).toBe(true);
  });

  it("closes on Escape", () => {
    const host = mount(ANNOTATIONS);
    hover(host, 2, true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect((host.querySelector(".lh-cp-note-popup") as HTMLElement).hidden).toBe(true);
  });

  it("closes on scroll", () => {
    // Scrolling moves the code out from under a stationary cursor without firing any mouse
    // event, so without this the popup would hang over unrelated lines.
    const host = mount(ANNOTATIONS);
    const scroll = hover(host, 2, true);
    scroll.dispatchEvent(new Event("scroll"));
    expect((host.querySelector(".lh-cp-note-popup") as HTMLElement).hidden).toBe(true);
  });

  it("closes when the window loses focus, so the affordance is not left painted on", () => {
    const host = mount(ANNOTATIONS);
    const scroll = hover(host, 2, true);
    window.dispatchEvent(new Event("blur"));
    expect(scroll.classList.contains("lh-cp-ctrl-held")).toBe(false);
    expect((host.querySelector(".lh-cp-note-popup") as HTMLElement).hidden).toBe(true);
  });
});

describe("entry points that need no mouse", () => {
  it("offers the note on the selected line, and hides the offer otherwise", () => {
    const host = mount(ANNOTATIONS);
    const link = host.querySelector(".lh-cp-note-link") as HTMLElement;
    expect(link.hidden).toBe(true);

    lineEl(host, 2).click();
    expect(link.hidden).toBe(false);

    lineEl(host, 4).click();
    expect(link.hidden).toBe(true);
  });

  it("opens the note with Alt+Enter on a selection", () => {
    const host = mount(ANNOTATIONS);
    lineEl(host, 2).click();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", altKey: true }));
    expect((host.querySelector(".lh-cp-note-popup") as HTMLElement).hidden).toBe(false);
  });

  it("leaves Alt+Enter alone while the caret is in a text field", () => {
    // Enter belongs to the text there; the question box must not be hijacked.
    const host = mount(ANNOTATIONS);
    lineEl(host, 2).click();
    const input = document.createElement("textarea");
    document.body.appendChild(input);
    input.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", altKey: true }));
    expect((host.querySelector(".lh-cp-note-popup") as HTMLElement).hidden).toBe(true);
  });

  it("hangs the file-level note off the path label, and only when there is one", () => {
    const host = mount(ANNOTATIONS);
    const path = host.querySelector(".lh-cp-path-label") as HTMLButtonElement;
    expect(path.classList.contains("lh-cp-path-label--noted")).toBe(true);
    path.click();
    const popup = host.querySelector(".lh-cp-note-popup") as HTMLElement;
    expect(popup.hidden).toBe(false);
    expect(popup.textContent).toContain("이 파일의 역할");

    (host.querySelectorAll(".lh-cp-tree-file")[1] as HTMLButtonElement).click();
    expect(path.classList.contains("lh-cp-path-label--noted")).toBe(false);
  });
});

describe("promotion out of the popup", () => {
  it("collects the annotated range with the same wording as the header button", () => {
    const host = mount(ANNOTATIONS);
    hover(host, 2, true);
    const scrap = host.querySelector(".lh-cp-note-scrap") as HTMLButtonElement;
    expect(scrap.textContent).toBe("스크랩 담기");
    scrap.click();
    expect((host.querySelector(".lh-cp-note-popup") as HTMLElement).hidden).toBe(true);
    expect(host.querySelectorAll(".lh-cp-line-scrapped").length).toBeGreaterThan(0);
  });

  it("follows a reference to another file and closes on the way", () => {
    const host = mount(ANNOTATIONS);
    hover(host, 2, true);
    (host.querySelector(".lh-cp-note-ref") as HTMLButtonElement).click();
    expect((host.querySelector(".lh-cp-note-popup") as HTMLElement).hidden).toBe(true);
    expect((host.querySelector(".lh-cp-path-label") as HTMLElement).textContent).toBe("app/main.py");
  });
});
