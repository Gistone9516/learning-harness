// WHAT: the revise tab (queued tasks, due first -- W-8) and the history tab (filter, search, error
//       stats with a focus-generate shortcut, and the collection of passed sentences).
// DEPS: web/src/doc/doc, ./model, ./store, ./compose (ctx type only).

import { el } from "../../src/doc/doc";
import { errorStats, isPass, type TaskData } from "./model";
import { verdictBadge } from "./badge";
import type { TaskEntry } from "./store";
import type { ComposeCtx } from "./compose";

export function mountLists(root: HTMLElement, ctx: ComposeCtx, kind: "revise" | "history") {
  const { L, store } = ctx;
  const wrap = el("div", "lh-cm-lists");
  root.appendChild(wrap);
  let filter: "all" | "correct" | "partial" | "incorrect" | "ungraded" = "all";
  let query = "";

  function row(e: TaskEntry): HTMLElement {
    const li = el("li");
    const b = el("button", "lh-nb-term");
    b.type = "button";
    const top = el("span", "lh-nb-term-top");
    top.appendChild(verdictBadge(L, e.summary.verdict));
    top.appendChild(el("span", "lh-nb-badge lh-nb-badge--soft", L.modes[e.summary.mode] ?? e.summary.mode));
    top.appendChild(el("span", "lh-nb-term-count", `${e.summary.attempts}${L.attemptsN}`));
    b.appendChild(top);
    b.appendChild(el("span", "lh-nb-term-gloss", String(e.summary.prompt)));
    b.addEventListener("click", () => ctx.openTask(e.id));
    li.appendChild(b);
    return li;
  }

  async function refreshRevise(): Promise<void> {
    wrap.innerHTML = "";
    const now = ctx.now();
    const queued = (await store.list()).filter((e) => e.summary.queued);
    const due = queued.filter((e) => e.summary.due_at <= now).sort((a, b) => a.summary.due_at - b.summary.due_at);
    const later = queued.filter((e) => e.summary.due_at > now).sort((a, b) => a.summary.due_at - b.summary.due_at);
    if (!due.length) wrap.appendChild(el("div", "lh-nb-empty lh-nb-empty--center", L.reviseEmpty));
    else { const ul = el("ul", "lh-nb-term-list lh-cm-list"); due.forEach((e) => ul.appendChild(row(e))); wrap.appendChild(ul); }
    if (later.length) {
      wrap.appendChild(el("h3", "lh-nb-sec-h", `${L.reviseUpcoming} ${later.length}`));
      const ul = el("ul", "lh-nb-term-list lh-cm-list lh-cm-list--later");
      later.forEach((e) => ul.appendChild(row(e)));
      wrap.appendChild(ul);
    }
  }

  async function refreshHistory(): Promise<void> {
    wrap.innerHTML = "";
    const all = await store.list();
    const tools = el("div", "lh-cm-tools");
    const search = document.createElement("input");
    search.type = "search"; search.className = "lh-nb-input lh-nb-search"; search.placeholder = L.search; search.value = query;
    search.setAttribute("aria-label", L.search);
    const filters = el("div", "lh-nb-filters");
    const defs: [typeof filter, string][] = [["all", L.filterAll], ["correct", L.correct], ["partial", L.partial], ["incorrect", L.incorrect], ["ungraded", L.ungraded]];
    for (const [k, label] of defs) {
      const f = el("button", "lh-nb-filter" + (k === filter ? " lh-nb-filter--on" : ""), label);
      f.type = "button"; f.setAttribute("aria-pressed", String(k === filter));
      f.addEventListener("click", () => { filter = k; void refreshHistory(); });
      filters.appendChild(f);
    }
    tools.append(search, filters);
    wrap.appendChild(tools);

    const cols = el("div", "lh-cm-cols");
    const listCol = el("div");
    const ul = el("ul", "lh-nb-term-list lh-cm-list");
    const paintList = () => {
      ul.innerHTML = "";
      const q = query.toLowerCase();
      const shown = all.filter((e) => (filter === "all" || e.summary.verdict === filter) && (!q || String(e.summary.prompt).toLowerCase().includes(q)));
      if (!shown.length) ul.appendChild(el("li", "lh-nb-empty", L.historyEmpty));
      shown.forEach((e) => ul.appendChild(row(e)));
    };
    search.addEventListener("input", () => { query = search.value; paintList(); });
    paintList();
    listCol.appendChild(ul);

    const sideCol = el("aside", "lh-cm-stats");
    sideCol.appendChild(el("h3", "lh-nb-sec-h", L.stats));
    const datas = (await Promise.all(all.map((e) => store.get(e.id)))).filter((d): d is TaskData => d !== null);
    const stats = errorStats(datas).slice(0, 8);
    if (!stats.length) sideCol.appendChild(el("p", "lh-nb-hint", L.statsEmpty));
    else {
      const max = stats[0].count;
      const ol = el("ol", "lh-cm-bars");
      for (const s of stats) {
        const li = el("li");
        li.appendChild(el("span", "lh-cm-bar-k", s.category));
        const bar = el("span", "lh-cm-bar"); bar.style.width = `${Math.max(8, Math.round((s.count / max) * 100))}%`;
        li.appendChild(bar);
        li.appendChild(el("span", "lh-cm-bar-n", String(s.count)));
        ol.appendChild(li);
      }
      sideCol.appendChild(ol);
      if (ctx.ai) {
        const fb = el("button", "lh-nb-btn lh-nb-btn--primary", L.focusGenerate); fb.type = "button";
        fb.addEventListener("click", () => ctx.generateFocus(stats.slice(0, 2).map((s) => s.category)));
        sideCol.appendChild(fb);
      }
    }
    // A partial pass contributes its corrected sentence, so the collection holds no slips (W-2).
    const passed = datas.flatMap((d) => d.attempts.filter((a) => isPass(a.verdict)).map((a) => a.corrected ?? a.text));
    sideCol.appendChild(el("h3", "lh-nb-sec-h lh-cm-sec-gap", `${L.sentences} ${passed.length}`));
    const sl = el("ul", "lh-cm-sentences");
    for (const s of passed.slice(-30).reverse()) sl.appendChild(el("li", undefined, s));
    sideCol.appendChild(sl);

    cols.append(listCol, sideCol);
    wrap.appendChild(cols);
  }

  return { refresh: kind === "revise" ? refreshRevise : refreshHistory };
}
