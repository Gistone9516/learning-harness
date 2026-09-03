// @vitest-environment jsdom
//
// The project summary's expand toggle.
//
// jsdom has no layout, so `scrollHeight` and `clientHeight` are both 0 and the real measurement
// cannot happen here. They are stubbed on the prototype instead, which is the whole point: what
// these pin down is not whether the browser clamps, but what the part does with the answer —
// including the two cases that are only wrong later. A toggle drawn over text that is not
// truncated promises content that does not exist, and a re-measure taken while open would report
// no overflow, hide the button, and leave the learner expanded with no way back.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mountCodeproj } from "./codeproj";

const PROJECT = {
  title: "도서 관리 API",
  summary: "FastAPI + SQLite 기반의 도서 대출 관리 API. 라우터, 서비스, 저장소 세 계층으로 나눠 구현한다.",
  files: [{ path: "app/db.py", content: "one\ntwo" }],
};

/** Drives the stubbed geometry: the summary reports more content than box when true. */
let overflowing = true;
/** Callbacks of every ResizeObserver the mount created, with what each observes. */
let observed: { fire: () => void; targets: Element[] }[] = [];

beforeEach(() => {
  document.body.innerHTML = "";
  overflowing = true;
  observed = [];

  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return overflowing ? 100 : 20;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 20 });

  // jsdom ships no ResizeObserver. A recording stub both satisfies the guard and lets a test
  // fire the re-measure, which is the only way to reach the "already open" branch.
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    private targets: Element[] = [];
    constructor(cb: () => void) {
      observed.push({ fire: cb, targets: this.targets });
    }
    observe(el: Element) {
      this.targets.push(el);
    }
    disconnect() {}
    unobserve() {}
  };
});

afterEach(() => {
  delete (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver;
});

function mount(project: unknown = PROJECT) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  mountCodeproj(host, { session: null, project: project as never });
  return {
    host,
    summary: host.querySelector(".lh-cp-summary") as HTMLElement,
    toggle: host.querySelector(".lh-cp-summary-toggle") as HTMLButtonElement,
  };
}

describe("where the toggle sits", () => {
  it("shares the title's row, so the collapsed state costs no extra line", () => {
    // The header's vertical budget is the reason the summary is clamped at all. A control on its
    // own row would hand most of that back to reveal two lines.
    const { host, toggle } = mount();
    const row = host.querySelector(".lh-cp-head-row") as HTMLElement;
    expect(row).toBeTruthy();
    expect(toggle.parentElement).toBe(row);
    expect(row.querySelector(".lh-cp-title")).toBeTruthy();
  });

  it("names the summary it controls, and starts collapsed", () => {
    const { summary, toggle } = mount();
    expect(toggle.getAttribute("aria-controls")).toBe(summary.id);
    expect(summary.id).not.toBe("");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(summary.classList.contains("lh-cp-summary--open")).toBe(false);
  });

  it("does not borrow conceptprob's row class", () => {
    // `lh-cp-` is shared with the other part, whose `.lh-cp-title-row` is unscoped. Claiming it
    // here is the shape that once rendered this part's AI pane off the screen.
    const { host } = mount();
    expect(host.querySelector(".lh-cp-title-row")).toBeNull();
  });
});

describe("whether the toggle is offered at all", () => {
  it("is hidden when nothing is truncated", () => {
    // The kit does not clamp; only an instance does. So on a bare kit, and on a summary short
    // enough to fit, there is nothing behind the button and it must not be drawn.
    overflowing = false;
    const { toggle } = mount();
    expect(toggle.hidden).toBe(true);
  });

  it("appears when the text is cut off", () => {
    const { toggle } = mount();
    expect(toggle.hidden).toBe(false);
  });

  it("re-measures when the summary's box changes", () => {
    // The clamp is a line count, so the same text overflows at one width and fits at another.
    const { summary, toggle } = mount();
    expect(observed.some((o) => o.targets.includes(summary))).toBe(true);

    overflowing = false;
    observed.forEach((o) => o.fire());
    expect(toggle.hidden).toBe(true);
  });

  it("never withdraws the toggle while it is open", () => {
    // An expanded paragraph reports no overflow. Re-measuring then would hide the only control
    // that can collapse it again.
    const { toggle } = mount();
    toggle.click();

    overflowing = false;
    observed.forEach((o) => o.fire());
    expect(toggle.hidden).toBe(false);
    expect(toggle.textContent).toBe("접기");
  });
});

describe("clicking it", () => {
  it("opens, relabels, and closes again", () => {
    const { summary, toggle } = mount();
    expect(toggle.textContent).toBe("더 보기");

    toggle.click();
    expect(summary.classList.contains("lh-cp-summary--open")).toBe(true);
    expect(toggle.textContent).toBe("접기");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    toggle.click();
    expect(summary.classList.contains("lh-cp-summary--open")).toBe(false);
    expect(toggle.textContent).toBe("더 보기");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("does not submit anything it happens to sit inside", () => {
    const { toggle } = mount();
    expect(toggle.type).toBe("button");
  });

  it("says nothing that means an AI call elsewhere on this screen", () => {
    // 자세히 is the answer-depth control and 더 알아보기 promotes an annotation: both wait on the
    // model. A local expand borrowing either word would promise a reply that never comes.
    const { toggle } = mount();
    toggle.click();
    const labels = ["더 보기", "접기"];
    expect(labels).toContain(toggle.textContent);
  });
});

describe("the empty state", () => {
  it("measures the fallback sentence too, instead of carrying the last verdict over", () => {
    // Both writers of the summary go through one path. The no-project sentence is short, so the
    // toggle it inherits from a previous verdict would be a button over nothing.
    overflowing = false;
    const { host, toggle } = mount(null);
    expect((host.querySelector(".lh-cp-summary") as HTMLElement).textContent).toContain(
      "표시할 프로젝트가 없습니다",
    );
    expect(toggle.hidden).toBe(true);
  });
});
