// @vitest-environment jsdom
//
// The shared tab layout publishes its state for a host menu (specs/web-notebook.md N-21).
import { describe, it, expect, beforeEach } from "vitest";
import { buildTabbedLayout, TABS_EVENT, type TabsState } from "../src/ui/tabs";

describe("tab state for a host menu (N-21)", () => {
  beforeEach(() => { document.body.innerHTML = ""; delete (globalThis as { LH_TABS?: unknown }).LH_TABS; });

  it("publishes tabs, current tab, counts and flags on every change; select acts like a click", () => {
    const seen: TabsState[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent<TabsState>).detail);
    window.addEventListener(TABS_EVENT, listener);
    const clicked: string[] = [];
    const root = document.createElement("div");
    document.body.appendChild(root);
    const layout = buildTabbedLayout(root, "x", [{ id: "a", label: "A" }, { id: "b", label: "B" }], "offline", (id) => { clicked.push(id); layout.show(id); });
    layout.show("a");
    layout.setCount("b", "7");
    layout.setCount("b", "7");           // no change -> no event
    layout.setFlag("b", "due", true);
    window.removeEventListener(TABS_EVENT, listener);

    expect(seen).toHaveLength(4);        // build, show, count, flag
    const last = seen[seen.length - 1];
    expect(last.tabs).toEqual([
      { id: "a", label: "A", count: "", on: true, flagged: false },
      { id: "b", label: "B", count: "7", on: false, flagged: true },
    ]);
    expect((globalThis as { LH_TABS?: TabsState }).LH_TABS).toBe(last);
    last.select("b");
    expect(clicked).toEqual(["b"]);
    expect(layout.current()).toBe("b");
  });
});
