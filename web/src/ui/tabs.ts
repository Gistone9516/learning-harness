// Shared tab layout for the state-backed parts (notebook, compose, quiz): a tab bar with optional counts,
// an offline banner, and one pane per tab. One implementation so the three parts look and behave alike;
// the styles are the `.lh-nb-*` primitives in styles/notebook.css.
//
// Host contract (web-notebook N-21): every change of the tab state is published as `TABS_EVENT` on window
// (and kept in `globalThis.LH_TABS`), so a host page can offer the same tabs in its own menu -- on a narrow
// screen the kit host lists them in the ☰ popup and hides this bar. `select(id)` behaves like a click.

import { el } from "../doc/doc";

export interface TabDef { id: string; label: string }

export const TABS_EVENT = "lh:tabs";
export interface TabsState {
  tabs: { id: string; label: string; count: string; on: boolean; flagged: boolean }[];
  select(id: string): void;
}

export interface TabbedLayout {
  panes: Map<string, HTMLElement>;
  banner: HTMLElement;
  /** Show a tab; returns false when it was already showing. */
  show(id: string): boolean;
  current(): string | null;
  setCount(id: string, text: string): void;
  setFlag(id: string, cls: string, on: boolean): void;
}

export function buildTabbedLayout(container: HTMLElement, rootClass: string, tabs: TabDef[], bannerText: string, onClick: (id: string) => void): TabbedLayout {
  container.innerHTML = "";
  container.className = rootClass;
  const bar = el("div", "lh-nb-bar");
  const tabsEl = el("div", "lh-nb-tabs");
  tabsEl.setAttribute("role", "tablist");
  bar.appendChild(tabsEl);
  const banner = el("div", "lh-nb-banner", bannerText);
  banner.hidden = true;
  bar.appendChild(banner);
  container.appendChild(bar);
  const body = el("div", "lh-nb-body");
  container.appendChild(body);

  const btns = new Map<string, { btn: HTMLButtonElement; count: HTMLElement; flags: Set<string> }>();
  const panes = new Map<string, HTMLElement>();
  for (const t of tabs) {
    const btn = el("button", "lh-nb-tab");
    btn.type = "button";
    btn.setAttribute("role", "tab");
    btn.dataset["tab"] = t.id;
    btn.appendChild(el("span", "lh-nb-tab-label", t.label));
    const count = el("span", "lh-nb-tab-count");
    btn.appendChild(count);
    btn.addEventListener("click", () => onClick(t.id));
    tabsEl.appendChild(btn);
    btns.set(t.id, { btn, count, flags: new Set() });
    const pane = el("section", "lh-nb-pane lh-nb-pane--" + t.id);
    pane.hidden = true;
    body.appendChild(pane);
    panes.set(t.id, pane);
  }

  let cur: string | null = null;
  function publish(): void {
    const state: TabsState = {
      tabs: tabs.map((t) => {
        const b = btns.get(t.id)!;
        return { id: t.id, label: t.label, count: b.count.textContent ?? "", on: t.id === cur, flagged: b.flags.size > 0 };
      }),
      select: (id) => onClick(id),
    };
    (globalThis as unknown as { LH_TABS?: TabsState }).LH_TABS = state;
    globalThis.dispatchEvent?.(new CustomEvent<TabsState>(TABS_EVENT, { detail: state }));
  }

  publish();
  return {
    panes,
    banner,
    show(id) {
      if (cur === id || !panes.has(id)) return false;
      cur = id;
      for (const [k, p] of panes) p.hidden = k !== id;
      for (const [k, { btn }] of btns) {
        btn.classList.toggle("lh-nb-tab--on", k === id);
        btn.setAttribute("aria-selected", String(k === id));
      }
      publish();
      return true;
    },
    current: () => cur,
    setCount(id, text) {
      const b = btns.get(id);
      if (!b || b.count.textContent === text) return;
      b.count.textContent = text;
      publish();
    },
    setFlag(id, cls, on) {
      const b = btns.get(id);
      if (!b || b.flags.has(cls) === on) return;
      b.btn.classList.toggle(cls, on);
      if (on) b.flags.add(cls); else b.flags.delete(cls);
      publish();
    },
  };
}
