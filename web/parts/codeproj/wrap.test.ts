// @vitest-environment jsdom
//
// Soft wrap in the code panel. jsdom has no layout, so the row geometry is tested as pure maths and
// the DOM half is tested for what does not need layout: the toggle, its memory, the per-line indent.
import { describe, it, expect, beforeEach } from "vitest";
import { leadingColumns, readWrapPreference, WRAP_EXTRA_CH, WRAP_STORAGE_KEY, wrappedRowEnds } from "./wrap";
import { createCodePanel } from "./view";

const TAB = String.fromCharCode(9);

describe("leadingColumns", () => {
  it("counts spaces, and a tab to the next tab stop", () => {
    expect(leadingColumns("    return x")).toBe(4);
    expect(leadingColumns(TAB + "x")).toBe(8);
    expect(leadingColumns("  " + TAB + "x")).toBe(8);      // two spaces then a tab still lands on 8
    expect(leadingColumns("x = 1")).toBe(0);
    expect(leadingColumns("")).toBe(0);
  });
});

describe("wrappedRowEnds", () => {
  it("returns every row but the last, top to bottom", () => {
    const rows = wrappedRowEnds([
      { top: 40, bottom: 60, right: 300 },
      { top: 0, bottom: 20, right: 500 },
      { top: 20, bottom: 40, right: 480 },
    ]);
    expect(rows.map((r) => r.top)).toEqual([0, 20]);
    expect(rows[0].right).toBe(500);
  });

  it("merges fragments reported on the same row and keeps the rightmost edge", () => {
    const rows = wrappedRowEnds([
      { top: 0, bottom: 20, right: 120 },
      { top: 0.5, bottom: 20, right: 480 },
      { top: 20, bottom: 40, right: 90 },
    ]);
    expect(rows).toEqual([{ top: 0, bottom: 20, right: 480 }]);
  });

  it("marks nothing on a line that did not wrap, or on empty boxes", () => {
    expect(wrappedRowEnds([{ top: 0, bottom: 20, right: 300 }])).toEqual([]);
    expect(wrappedRowEnds([])).toEqual([]);
    expect(wrappedRowEnds([{ top: 0, bottom: 0, right: 0 }, { top: 0, bottom: 20, right: 10 }])).toEqual([]);
  });
});

describe("the toggle", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
  });

  function mount() {
    const panel = createCodePanel();
    document.body.appendChild(panel.root);
    panel.show("app/main.py", ["def f():", "    return 1", TAB + "x"].join(String.fromCharCode(10)));
    const q = <T extends Element>(sel: string) => panel.root.querySelector(sel) as T;
    return { panel, q };
  }

  it("starts off, keeping the horizontal scroll the design chose", () => {
    const { q } = mount();
    expect(q(".lh-cp-code-scroll").classList.contains("lh-cp-code-scroll--wrap")).toBe(false);
    expect(q(".lh-cp-wrap-toggle").getAttribute("aria-pressed")).toBe("false");
  });

  it("turns wrapping on and off, says which in its label, and remembers it", () => {
    const { q } = mount();
    q<HTMLButtonElement>(".lh-cp-wrap-toggle").click();
    expect(q(".lh-cp-code-scroll").classList.contains("lh-cp-code-scroll--wrap")).toBe(true);
    expect(q(".lh-cp-wrap-toggle").getAttribute("aria-pressed")).toBe("true");
    expect(q(".lh-cp-wrap-toggle").getAttribute("aria-label")).toBe("긴 줄 줄바꿈 끄기");
    expect(localStorage.getItem(WRAP_STORAGE_KEY)).toBe("on");
    expect(readWrapPreference()).toBe(true);

    q<HTMLButtonElement>(".lh-cp-wrap-toggle").click();
    expect(q(".lh-cp-code-scroll").classList.contains("lh-cp-code-scroll--wrap")).toBe(false);
    expect(localStorage.getItem(WRAP_STORAGE_KEY)).toBe("off");
  });

  it("opens already wrapped for a viewer who left it on", () => {
    localStorage.setItem(WRAP_STORAGE_KEY, "on");
    const { q } = mount();
    expect(q(".lh-cp-code-scroll").classList.contains("lh-cp-code-scroll--wrap")).toBe(true);
  });

  it("gives each line its own hanging indent, from its own leading whitespace", () => {
    const { panel } = mount();
    const indents = Array.from(panel.root.querySelectorAll<HTMLElement>(".lh-cp-line-text")).map((e) =>
      e.style.getPropertyValue("--lh-wrap-indent"),
    );
    expect(indents).toEqual([String(0 + WRAP_EXTRA_CH), String(4 + WRAP_EXTRA_CH), String(8 + WRAP_EXTRA_CH)]);
  });

  it("keeps the code text itself unchanged, so nothing the viewer adds is copied", () => {
    const { panel } = mount();
    const text = Array.from(panel.root.querySelectorAll(".lh-cp-line-text")).map((e) => e.textContent);
    expect(text).toEqual(["def f():", "    return 1", TAB + "x"]);
  });
});
